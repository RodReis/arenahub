import { Inject, Injectable } from '@nestjs/common';
import type { EntradaPublicaDoPlacar } from '@arenahub/api-contracts';
import type { RankingCategory } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { classificar, type SaldoParaClassificar } from './domain/classificacao.js';
import { resolverExposicao } from './domain/exposicao.js';
import {
  PORTA_DE_RANKING,
  type ExposicaoDoAluno,
  type PortaDeRanking,
  type SnapshotDeRanking,
} from './engagement-ranking.repository.js';

/**
 * TTL do cache do placar AO VIVO -- Emenda de 27/08/2026 (ADR-047).
 *
 * 60 s, e o motivo NAO e performance: e o `M5-NFR-003` (opt-out reflete em
 * ate 15 minutos). O placar nao muda de um jeito perceptivel num minuto, e
 * 60 s fica bem dentro da janela que o opt-out exige. O ganho de performance
 * (`M5-NFR-004`, p95 < 500 ms) e consequencia, nao motivo -- o heartbeat do
 * totem bate a cada 30 s (`INTERVALO_DE_HEARTBEAT_MS`), 2.880 vezes/dia por
 * totem, e sem cache cada batida varreria `StudentXpBalance` da unidade e
 * resolveria exposicao de todos os alunos.
 */
const TTL_DO_CACHE_AO_VIVO_MS = 60_000;

/** Uma entrada do cache do placar ao vivo -- por processo (memoria
 * `duble-com-estado-vaza-entre-testes`: instancia nova por teste). */
interface EntradaDeCache {
  calculadoEm: number;
  placar: readonly EntradaPublicaDoPlacar[];
}

/**
 * O placar como o publico o ve -- SEM `studentId` (M5-AC-001).
 *
 * REEXPORTADO de `@arenahub/api-contracts`, nunca redeclarado: e o mesmo
 * formato que atravessa o heartbeat ate o totem (F31, Task 9), e duas
 * definicoes do mesmo formato divergem na primeira mudanca.
 */
export type { EntradaPublicaDoPlacar };

/**
 * Gera, retem, publica e le o placar mensal de uma unidade.
 *
 * So o que traduz `TenantContext` e a porta de dados em decisao de dominio
 * -- as regras em si vivem em `domain/*.ts` (`classificar`, `resolverExposicao`,
 * `participaDoRanking`) e nao sao reimplementadas aqui.
 */
@Injectable()
export class EngagementRankingService {
  /** Cache em memoria do placar ao vivo, por `(tenantId, gymUnitId, localMonth)`. */
  private readonly cacheAoVivo = new Map<string, EntradaDeCache>();

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
    category: RankingCategory = 'XP_DO_MES',
  ): Promise<SnapshotDeRanking> {
    const [minimumCohort, saldos] = await Promise.all([
      this.porta.coorteMinima(contexto),
      this.porta.saldosDaUnidade(contexto, gymUnitId, localMonth, category),
    ]);

    const elegiveis = await this.filtrarElegiveis(contexto, saldos);
    const eligibleCount = elegiveis.length;

    if (eligibleCount < minimumCohort) {
      return this.porta.salvarSnapshot(contexto, {
        gymUnitId,
        localMonth,
        category,
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
      category,
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
   * Um snapshot pelo id, ja escopado por tenant -- exposto para o controller
   * checar `allowedUnitIds` ANTES de publicar (Task 11, correcao critica):
   * `publicar()` nao recebe `gymUnitId` na requisicao, so no proprio
   * snapshot, entao o escopo so pode ser verificado depois de carrega-lo.
   */
  async snapshotPorId(contexto: TenantContext, snapshotId: string): Promise<SnapshotDeRanking | null> {
    return this.porta.snapshotPorId(contexto, snapshotId);
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
   *
   * NOME ABREVIADO no caminho de primeiro nome (`entrada.nomeAbreviado`,
   * ja calculado pela porta com `abreviarNome()`) -- `DS-TOTEM.md` §3.4c e
   * §5.8 exigem nome abreviado em toda tela publica e na area interna do
   * totem. Apelido APROVADO e o `NOME_ANONIMO` continuam INTEIROS: o aluno
   * escolheu aquele apelido para aparecer exatamente assim, e ja passou por
   * moderacao.
   */
  async lerPlacarPublicado(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    category: RankingCategory = 'XP_DO_MES',
  ): Promise<readonly EntradaPublicaDoPlacar[]> {
    const snapshot = await this.porta.snapshotPublicado(contexto, gymUnitId, localMonth, category);

    if (!snapshot) return [];

    const entradas = await this.porta.entradasComExposicao(contexto, snapshot.id);

    return entradas.flatMap((entrada) => {
      const exposicao = resolverExposicao({
        decisao: entrada.decisao,
        perfil: entrada.perfil,
        primeiroNome: entrada.nomeAbreviado,
        statusDoAluno: entrada.statusDoAluno,
      });

      return exposicao.exibe
        ? [{ position: entrada.position, nomeExibido: exposicao.nome, points: entrada.points }]
        : [];
    });
  }

  /**
   * O placar publicado do mes, com NOME REAL -- para o painel (F57).
   *
   * Devolve tambem `publishedAt`: entre uma publicacao e outra o numero NAO
   * anda, e um placar parado sem marca de idade e indistinguivel de um job
   * que morreu. A tela diz de quando e (`DS-PAINEL` §4.4).
   *
   * `DRAFT` nao vaza: `snapshotPublicado` so acha publicado, e mostrar
   * rascunho de moderacao no resumo tornaria a publicacao decorativa.
   */
  async lerPlacarInterno(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    category: RankingCategory = 'XP_DO_MES',
  ): Promise<{
    publicadoEm: string | null;
    entradas: readonly { position: number; points: number; nome: string }[];
  }> {
    const snapshot = await this.porta.snapshotPublicado(contexto, gymUnitId, localMonth, category);

    if (!snapshot) return { publicadoEm: null, entradas: [] };

    const entradas = await this.porta.entradasInternas(contexto, snapshot.id);

    return {
      publicadoEm: snapshot.publishedAt?.toISOString() ?? null,
      entradas: entradas.map((e) => ({
        position: e.position,
        points: e.points,
        nome: e.fullName,
      })),
    };
  }

  /**
   * O placar do MES CORRENTE, lido ao vivo -- sem gravar snapshot nenhum.
   * Emenda de 27/08/2026 (ADR-047): publicar o parcial todo dia colidiria
   * com `M5-AC-007` (snapshot publicado e imutavel), porque o placar do mes
   * corrente muda a cada treino. Ler ao vivo elimina a colisao em vez de
   * contornar.
   *
   * Faz o que `gerarSnapshot` + `lerPlacarPublicado` fariam juntos, SEM
   * gravar nada: le os saldos, filtra por `resolverExposicao()`, aplica a
   * coorte minima e classifica -- na hora, a cada chamada (respeitado o
   * cache abaixo).
   *
   * POSICAO SEM BURACO -- diferente do placar publicado. Ali a posicao vem
   * CONGELADA do snapshot, e quem sai deixa buraco (1, 3, 4): renumerar
   * exporia por deducao quem pediu opt-out entre duas leituras. Aqui nao ha
   * posicao congelada nenhuma de onde deduzir ausencia -- quem esta fora
   * NUNCA entrou no calculo, e a lista classificada ja nasce sem ele. Os
   * dois comportamentos sao diferentes DE PROPOSITO; nao "uniformizar".
   */
  async placarAoVivo(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    agora: Date,
  ): Promise<readonly EntradaPublicaDoPlacar[]> {
    const chave = `${contexto.tenantId}::${gymUnitId}::${localMonth}`;
    const emCache = this.cacheAoVivo.get(chave);

    if (emCache && agora.getTime() - emCache.calculadoEm < TTL_DO_CACHE_AO_VIVO_MS) {
      return emCache.placar;
    }

    const [minimumCohort, saldos] = await Promise.all([
      this.porta.coorteMinima(contexto),
      this.porta.saldosDaUnidade(contexto, gymUnitId, localMonth, 'XP_DO_MES'),
    ]);

    const elegiveis = await this.filtrarElegiveis(contexto, saldos);

    const placar =
      elegiveis.length < minimumCohort
        ? []
        : await this.exposicaoDosClassificados(contexto, elegiveis);

    this.cacheAoVivo.set(chave, { calculadoEm: agora.getTime(), placar });

    return placar;
  }

  /** Classifica os saldos elegiveis e resolve o nome exibido de cada um --
   * compartilhado por `placarAoVivo`. Os alunos ja passaram por
   * `filtrarElegiveis`, entao `resolverExposicao` aqui sempre resulta em
   * `exibe: true`; ele roda de novo so para obter o NOME (apelido x primeiro
   * nome x anonimo), que `filtrarElegiveis` descarta de proposito. */
  private async exposicaoDosClassificados(
    contexto: TenantContext,
    elegiveis: readonly SaldoParaClassificar[],
  ): Promise<readonly EntradaPublicaDoPlacar[]> {
    const posicoes = classificar(elegiveis);

    const exposicoes = await this.porta.exposicaoDosAlunos(
      contexto,
      posicoes.map((posicao) => posicao.studentId),
    );
    const exposicaoPorAluno = new Map<string, ExposicaoDoAluno>(
      exposicoes.map((exposicao) => [exposicao.studentId, exposicao]),
    );

    return posicoes.flatMap((posicao) => {
      const dados = exposicaoPorAluno.get(posicao.studentId);
      if (!dados) return [];

      const exposicao = resolverExposicao({
        decisao: dados.decisao,
        perfil: dados.perfil,
        primeiroNome: dados.nomeAbreviado,
        statusDoAluno: dados.statusDoAluno,
      });

      return exposicao.exibe
        ? [{ position: posicao.position, nomeExibido: exposicao.nome, points: posicao.points }]
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
    const snapshot = await this.porta.snapshotPublicado(contexto, gymUnitId, localMonth, 'XP_DO_MES');
    if (!snapshot) return null;

    const entrada = snapshot.entries.find((item) => item.studentId === studentId);
    if (!entrada) return null;

    const placar = await this.lerPlacarPublicado(contexto, gymUnitId, localMonth);
    return placar.find((item) => item.position === entrada.position) ?? null;
  }

  /**
   * Posicao de UM aluno no placar AO VIVO do mes corrente -- a area interna
   * do totem ("Meu XP", `DS-TOTEM.md` §5.8) usa isto, nao `posicaoDoAluno`:
   * o mes corrente nunca tem snapshot publicado (Emenda de 27/08/2026), e
   * `posicaoDoAluno` so enxerga snapshot.
   *
   * NAO usa o cache de `placarAoVivo` -- essa chamada e por SESSAO de aluno
   * na area interna do totem (rara: uma pessoa entrando na propria area),
   * bem diferente do heartbeat de 30 s que justifica o cache. Ler
   * `saldosDaUnidade` direto aqui mantem o metodo simples sem espalhar o
   * cache do hero publico para um caminho com padrao de chamada diferente.
   *
   * `null` se o proprio aluno esta em opt-out, inativo, ou a coorte nao
   * alcanca o minimo -- SEM excecao para o titular: `resolverExposicao`
   * roda para ele igual roda para qualquer outro (mesma regra de
   * `posicaoDoAluno`).
   */
  async posicaoAoVivoDoAluno(
    contexto: TenantContext,
    gymUnitId: string,
    localMonth: string,
    studentId: string,
  ): Promise<EntradaPublicaDoPlacar | null> {
    const [minimumCohort, saldos, [exposicao]] = await Promise.all([
      this.porta.coorteMinima(contexto),
      this.porta.saldosDaUnidade(contexto, gymUnitId, localMonth, 'XP_DO_MES'),
      this.porta.exposicaoDosAlunos(contexto, [studentId]),
    ]);

    if (!exposicao) return null;

    const elegiveis = await this.filtrarElegiveis(contexto, saldos);
    if (elegiveis.length < minimumCohort) return null;

    const minha = classificar(elegiveis).find((posicao) => posicao.studentId === studentId);
    if (!minha) return null;

    const resultado = resolverExposicao({
      decisao: exposicao.decisao,
      perfil: exposicao.perfil,
      primeiroNome: exposicao.nomeAbreviado,
      statusDoAluno: exposicao.statusDoAluno,
    });

    return resultado.exibe
      ? { position: minha.position, nomeExibido: resultado.nome, points: minha.points }
      : null;
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
