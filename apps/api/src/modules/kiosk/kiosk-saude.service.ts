import { Injectable } from '@nestjs/common';

import { AssessmentRepository } from '../health/assessment.repository.js';
import { BodyEvolutionService, type EvolucaoCorporal } from '../health/body-evolution.service.js';
import { HealthProgressService } from '../health/health-progress.service.js';
import type { AlunoDaSessao } from './kiosk-area-do-aluno.service.js';
import {
  METRICAS_DO_TOTEM,
  agruparSegmentos,
  resumirMetricas,
  type MetricaDoTotem,
  type SegmentoDoTotem,
} from './domain/avaliacao-do-totem.js';

/** §5.3 -- a avaliacao do mes, somente leitura. */
export interface AvaliacaoDoTotem {
  readonly medidaEm: string | null;
  /** Aparelho que mediu, dito em tela: numero sem origem nao se confere. */
  readonly aparelho: string | null;
  readonly metricas: readonly MetricaDoTotem[];
  readonly segmentos: readonly SegmentoDoTotem[];
  /**
   * Indice, classificacao e achado como o APARELHO os escreveu -- opacos.
   * Nunca calculado, classificado nem colorido por gravidade aqui.
   */
  readonly relatorioDoAparelho: Record<string, unknown> | null;
}

/** §5.5 -- uma linha por mes medido. */
export interface LinhaDoHistoricoDeAvaliacoes {
  readonly assessmentId: string;
  readonly medidaEm: string;
  readonly metricas: readonly MetricaDoTotem[];
}

/**
 * Saude no totem -- `DS-TOTEM.md` §5.3, §5.4 e §5.5.
 *
 * SOMENTE LEITURA, sempre. O totem nao mede, nao confirma medicao e nao
 * edita nada: a medicao e feita e confirmada no painel da recepcao, e aqui
 * so aparece o que ja foi publicado (`AssessmentStatus.PUBLISHED`).
 *
 * REUSA os servicos publicos do modulo de saude (regra de arquitetura no 9):
 * `BodyEvolutionService` foi escrito para o totem e o app, e a LEITURA (a
 * cor de cada faixa) e resolvida no servidor de proposito -- se cada
 * superficie calculasse a propria, o aluno veria o braco verde no celular e
 * amarelo no totem.
 *
 * O QUE ESTE ARQUIVO NAO FAZ, e nao pode passar a fazer sem ADR: interpretar.
 * A RDC 657/2022 da ANVISA isenta software que so exibe dado de saude; o que
 * enquadra como dispositivo medico e classificar, pontuar, sinalizar
 * gravidade ou recomendar conduta. A pontuacao do aparelho viaja opaca, e
 * nao ha campo derivado de "procure a recepcao" (ADR-035).
 */
@Injectable()
export class KioskSaudeService {
  constructor(
    private readonly avaliacoes: AssessmentRepository,
    private readonly evolucaoCorporal: BodyEvolutionService,
    private readonly progresso: HealthProgressService,
  ) {}

  /**
   * §5.3 -- a ultima avaliacao publicada, com delta contra a anterior.
   *
   * O delta vem de `HealthProgressService`, que ja o calcula
   * (`comparativo.desdeAAnterior`). Calcula-lo no totem a partir dos meses
   * da evolucao reintroduziria conta no cliente, e duas contas divergem no
   * primeiro arredondamento.
   */
  async avaliacaoDoMes(aluno: AlunoDaSessao, agora: Date): Promise<AvaliacaoDoTotem | null> {
    const historico = await this.progresso.historico(
      aluno.contexto,
      aluno.studentId,
      'ALL',
      agora,
    );

    const publicadas = await this.avaliacoes.listarPublicadasDoAluno(
      aluno.contexto,
      aluno.studentId,
      null,
    );

    /*
     * `listarPublicadasDoAluno` devolve em ordem CRESCENTE e inclui as
     * corrigidas; a folha de cada cadeia e quem tem `supersededBy` nulo. A
     * ultima folha e a avaliacao atual (INV-102: correcao substitui, nao
     * acrescenta).
     */
    const atual = publicadas.filter((a) => a.supersededBy === null).at(-1);

    if (!atual) return null;

    return {
      medidaEm: atual.assessedAt.toISOString(),
      aparelho: atual.deviceModel,
      metricas: resumirMetricas(historico.tipos, METRICAS_DO_TOTEM),
      segmentos: agruparSegmentos(atual.measurements),
      relatorioDoAparelho: (atual.deviceReport as Record<string, unknown> | null) ?? null,
    };
  }

  /**
   * §5.4 -- evolucao, com a analise assistiva quando existir.
   *
   * `latestAnalysis` ja chega com `disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS'`
   * pelo contrato do tipo -- e a tela do totem e obrigada a exibi-lo
   * (regra de arquitetura no 8).
   */
  async evolucao(aluno: AlunoDaSessao, agora: Date): Promise<EvolucaoCorporal> {
    return this.evolucaoCorporal.evolucao(aluno.contexto, aluno.studentId, 'ALL', agora);
  }

  /** §5.5 -- uma linha por mes medido, da mais recente para a mais antiga. */
  async historicoDeAvaliacoes(
    aluno: AlunoDaSessao,
    agora: Date,
  ): Promise<readonly LinhaDoHistoricoDeAvaliacoes[]> {
    const historico = await this.progresso.historico(
      aluno.contexto,
      aluno.studentId,
      'ALL',
      agora,
    );

    const publicadas = await this.avaliacoes.listarPublicadasDoAluno(
      aluno.contexto,
      aluno.studentId,
      null,
    );

    const folhas = publicadas.filter((a) => a.supersededBy === null);

    return folhas
      .map((a) => ({
        assessmentId: a.id,
        medidaEm: a.assessedAt.toISOString(),
        metricas: resumirMetricas(historico.tipos, METRICAS_DO_TOTEM, a.id),
      }))
      .reverse();
  }
}
