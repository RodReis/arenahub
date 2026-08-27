import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { classificar, type SaldoParaClassificar } from './domain/classificacao.js';
import { resolverExposicao } from './domain/exposicao.js';
import {
  PORTA_DE_RANKING,
  type PortaDeRanking,
  type SnapshotDeRanking,
} from './engagement-ranking.repository.js';

/** O placar como o publico o ve -- SEM `studentId` (M5-AC-001). */
export interface EntradaPublicaDoPlacar {
  position: number;
  nomeExibido: string;
  points: number;
}

/**
 * Gera, retem, publica e le o placar mensal de uma unidade.
 *
 * So o que traduz `TenantContext` e a porta de dados em decisao de dominio
 * -- as regras em si vivem em `domain/*.ts` (`classificar`, `resolverExposicao`,
 * `participaDoRanking`) e nao sao reimplementadas aqui.
 */
@Injectable()
export class EngagementRankingService {
  constructor(@Inject(PORTA_DE_RANKING) private readonly porta: PortaDeRanking) {}

  /**
   * Classifica os saldos do mes e materializa um snapshot -- DRAFT se a
   * coorte elegivel alcanca o minimo, WITHHELD caso contrario (`M5-BR-007`).
   *
   * A coorte conta APENAS quem participa: aluno em opt-out ou inativo nao
   * infla o numero. Um placar de tres pessoas alegando cinco e o defeito
   * que essa contagem evita.
   *
   * `minimumCohort` e COPIADO da configuracao do tenant no momento da
   * geracao -- a leitura nunca consulta a politica atual, entao mudar o
   * minimo depois nao reescreve o que este snapshot ja decidiu.
   */
  async gerarSnapshot(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    agora: Date,
  ): Promise<SnapshotDeRanking> {
    const [minimumCohort, saldos] = await Promise.all([
      this.porta.coorteMinima(contexto),
      this.porta.saldosDaUnidade(contexto, gymUnitId, localMonth),
    ]);

    const elegiveis = await this.filtrarElegiveis(contexto, saldos);
    const eligibleCount = elegiveis.length;

    if (eligibleCount < minimumCohort) {
      return this.porta.salvarSnapshot(contexto, {
        gymUnitId,
        localMonth,
        status: 'WITHHELD',
        minimumCohort,
        eligibleCount,
        generatedAt: agora,
        posicoes: [],
      });
    }

    const posicoes = classificar(elegiveis);

    return this.porta.salvarSnapshot(contexto, {
      gymUnitId,
      localMonth,
      status: 'DRAFT',
      minimumCohort,
      eligibleCount,
      generatedAt: agora,
      posicoes: posicoes.map((posicao) => ({
        studentId: posicao.studentId,
        position: posicao.position,
        points: posicao.points,
        lastEntryAt: posicao.lastEntryAt,
      })),
    });
  }

  /**
   * Publica um snapshot DRAFT. `M5-AC-007`: o snapshot e imutavel depois de
   * publicado -- republicar e recusado, nunca sobrescrito.
   */
  async publicar(
    contexto: TenantContext,
    snapshotId: string,
    agora: Date,
  ): Promise<SnapshotDeRanking> {
    return this.porta.publicarSnapshot(contexto, snapshotId, agora);
  }

  /**
   * O placar como o publico o ve.
   *
   * `resolverExposicao()` roda AQUI, na leitura, e nao na materializacao do
   * snapshot -- e essa e a decisao mais importante desta fatia.
   *
   * O snapshot e imutavel (`M5-AC-007`) e congela PONTUACAO E POSICAO. Se ele
   * congelasse tambem o NOME, um aluno que pedisse opt-out depois da
   * publicacao continuaria estampado nele, e a unica forma de tirar seria
   * reescrever um artefato que o proprio criterio de aceite proibe
   * reescrever. `M5-FR-003` e `M5-NFR-003` exigem que ele suma da proxima
   * leitura em ate 15 minutos; e o que acontece, sem tocar em nada.
   *
   * A posicao NAO e recalculada apos a remocao: quem era 3o continua 3o, e o
   * 2o simplesmente nao aparece. Renumerar exporia por deducao quem saiu.
   */
  async lerPlacarPublicado(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
  ): Promise<readonly EntradaPublicaDoPlacar[]> {
    const snapshot = await this.porta.snapshotPublicado(contexto, gymUnitId, localMonth);

    if (!snapshot) return [];

    const entradas = await this.porta.entradasComExposicao(contexto, snapshot.id);

    return entradas.flatMap((entrada) => {
      const exposicao = resolverExposicao({
        decisao: entrada.decisao,
        perfil: entrada.perfil,
        primeiroNome: entrada.primeiroNome,
        statusDoAluno: entrada.statusDoAluno,
      });

      return exposicao.exibe
        ? [{ position: entrada.position, nomeExibido: exposicao.nome, points: entrada.points }]
        : [];
    });
  }

  /** Posicao de um aluno especifico no placar publicado -- `null` se ele
   * nao aparece (nao publicado, retido ou nao exposto). */
  async posicaoDoAluno(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    studentId: string,
  ): Promise<EntradaPublicaDoPlacar | null> {
    const snapshot = await this.porta.snapshotPublicado(contexto, gymUnitId, localMonth);
    if (!snapshot) return null;

    const entrada = snapshot.entries.find((item) => item.studentId === studentId);
    if (!entrada) return null;

    const placar = await this.lerPlacarPublicado(contexto, gymUnitId, localMonth);
    return placar.find((item) => item.position === entrada.position) ?? null;
  }

  /**
   * Saldos filtrados a quem apareceria no placar AGORA -- exclui opt-out e
   * aluno inativo ANTES de contar a coorte e classificar.
   *
   * Usa so `decisao` + `statusDoAluno` (nunca perfil/nome): na geracao nao
   * ha exibicao nenhuma a resolver, so o SIM/NAO de `resolverExposicao` --
   * por isso `perfil: null` aqui e sempre seguro, o resultado colapsa em
   * `exibe: true` (com nome irrelevante, descartado) ou `exibe: false`.
   */
  private async filtrarElegiveis(
    contexto: TenantContext,
    saldos: readonly SaldoParaClassificar[],
  ): Promise<SaldoParaClassificar[]> {
    if (saldos.length === 0) return [];

    const elegibilidades = await this.porta.elegibilidadeDosAlunos(
      contexto,
      saldos.map((saldo) => saldo.studentId),
    );

    const elegivelPorAluno = new Map(
      elegibilidades.map((elegibilidade) => [
        elegibilidade.studentId,
        resolverExposicao({
          decisao: elegibilidade.decisao,
          perfil: null,
          primeiroNome: '',
          statusDoAluno: elegibilidade.statusDoAluno,
        }).exibe,
      ]),
    );

    return saldos.filter((saldo) => elegivelPorAluno.get(saldo.studentId) === true);
  }
}
