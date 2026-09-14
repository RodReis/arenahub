import { Injectable } from '@nestjs/common';

import { AiAnalysisService } from '../health/ai-analysis.service.js';
import { BodyEvolutionService } from '../health/body-evolution.service.js';
import type { Leitura } from '../health/domain/leitura-de-faixa.js';
import type { RegiaoCorporal } from '../health/domain/medida.js';
import type { Periodo } from '../health/domain/periodo.js';
import type { SaidaDaAnalise } from '../health/domain/saida-da-analise.js';
import { HealthProgressService } from '../health/health-progress.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { tenantContextDoAluno } from './contexto-do-aluno.js';

/** Um ponto do grafico -- e uma linha da tabela equivalente. */
export interface PontoDoHistorico {
  readonly avaliacaoId: string;
  readonly medidaEm: string;
  readonly valor: number;
}

export interface SerieDoHistorico {
  readonly tipo: string;
  readonly unidade: string | null;
  readonly pontos: readonly PontoDoHistorico[];
  /** Alvo combinado com o profissional, quando existe. */
  readonly meta: { readonly alvo: number; readonly prazo: string } | null;
}

export interface AnaliseDoHistorico {
  readonly geradaEm: string;
  readonly analise: SaidaDaAnalise;
  /**
   * Modelo e versao do prompt que produziram esta leitura.
   *
   * Vao ao lado do aviso na tela (`AIDisclaimerProps`): `M3-NFR-006` manda
   * numero exibido ter origem conferivel, e uma analise sem procedencia nao
   * pode ser contestada pelo aluno nem pelo profissional.
   */
  readonly model: string;
  readonly promptVersion: string;
}

export interface RespostaDoHistorico {
  readonly asOf: string;
  readonly periodo: Periodo;
  readonly series: readonly SerieDoHistorico[];
  /**
   * NULA quando nao ha analise publicada -- e a tela nao inventa texto.
   *
   * So chega aqui o que ja passou pela confirmacao humana (regra de
   * arquitetura no 8): `ultimaPublicada` le a analise que um profissional
   * endossou, e o `disclaimerCode` vem dentro de `analise`, validado na
   * geracao.
   */
  readonly analise: AnaliseDoHistorico | null;
}

export interface MetricaDoLaudo {
  readonly tipo: string;
  readonly valor: number;
  readonly unidade: string | null;
  readonly leitura: Leitura;
  readonly faixaMin: number | null;
  readonly faixaMax: number | null;
}

export interface RegiaoDoLaudo {
  readonly gorduraKg: number | null;
  readonly musculoKg: number | null;
  readonly leituraGordura: Leitura;
  readonly leituraMusculo: Leitura;
}

export interface RespostaDoLaudo {
  readonly asOf: string;
  /** `null` = o aluno ainda nao tem avaliacao PUBLICADA. */
  readonly avaliacao: {
    readonly data: string;
    readonly metricas: readonly MetricaDoLaudo[];
    readonly regioes: Readonly<Record<RegiaoCorporal, RegiaoDoLaudo>>;
  } | null;
}

@Injectable()
export class MobileAvaliacoesService {
  constructor(
    private readonly progresso: HealthProgressService,
    private readonly analises: AiAnalysisService,
    private readonly evolucaoCorporal: BodyEvolutionService,
  ) {}

  /**
   * O laudo da ULTIMA avaliacao publicada, com faixa e leitura por metrica.
   *
   * Reusa `BodyEvolutionService` -- o mesmo contrato que o totem consome
   * (F52). A LEITURA (abaixo/dentro/acima) chega pronta do servidor: o app
   * so pinta, nunca compara valor com faixa (topo de
   * `health/domain/leitura-de-faixa.ts`). Se o app calculasse, o braco
   * sairia verde no celular e amarelo no totem no dia em que uma faixa mudasse.
   *
   * `ALL` e nao a janela do grafico: "a ultima avaliacao" de quem nao mede ha
   * seis meses continua sendo aquela, e um periodo curto a faria sumir. O
   * servico devolve os meses em ordem de medicao (`selecionarFolhas`), entao
   * o ultimo e o mais recente -- ja com a correcao no lugar da original.
   */
  async laudo(ctx: StudentChannelContext, agora: Date): Promise<RespostaDoLaudo> {
    const evolucao = await this.evolucaoCorporal.evolucao(
      tenantContextDoAluno(ctx),
      ctx.studentId,
      'ALL',
      agora,
    );

    const ultima = evolucao.months.at(-1);

    if (ultima === undefined) return { asOf: agora.toISOString(), avaliacao: null };

    const regiao = (nome: RegiaoCorporal): RegiaoDoLaudo => {
      const medida = ultima.regions[nome];

      return {
        gorduraKg: medida.fatMassKg,
        musculoKg: medida.muscleMassKg,
        leituraGordura: medida.fatReading,
        leituraMusculo: medida.muscleReading,
      };
    };

    return {
      asOf: agora.toISOString(),
      avaliacao: {
        data: ultima.assessedAtLocal,
        metricas: ultima.metrics.map((metrica) => ({
          tipo: metrica.type,
          valor: metrica.value,
          unidade: metrica.unit,
          leitura: metrica.reading,
          faixaMin: metrica.referenceMin,
          faixaMax: metrica.referenceMax,
        })),
        // As cinco chaves SEMPRE presentes (INV-104): nomeadas uma a uma, e
        // nao copiadas por `Object.entries`, para que faltar uma na origem
        // seja erro de tipo aqui e nao layout quebrado no celular.
        regioes: {
          ARM_LEFT: regiao('ARM_LEFT'),
          ARM_RIGHT: regiao('ARM_RIGHT'),
          TRUNK: regiao('TRUNK'),
          LEG_LEFT: regiao('LEG_LEFT'),
          LEG_RIGHT: regiao('LEG_RIGHT'),
        },
      },
    };
  }

  /**
   * Historico corporal do aluno da SESSAO -- Slice 4.4, `M4-FR-012`.
   *
   * Nao ha regra propria aqui: quem decide o que e folha, o que a correcao
   * substitui e como o comparativo fecha e o dominio de saude, pelo
   * `HealthProgressService` que o painel ja usa. Este servico TRADUZ para o
   * formato que o grafico e a tabela do app consomem -- reimplementar a
   * selecao de folhas daria duas verdades sobre o mesmo historico.
   */
  async montar(
    ctx: StudentChannelContext,
    periodo: Periodo,
    agora: Date,
  ): Promise<RespostaDoHistorico> {
    const contexto = tenantContextDoAluno(ctx);

    const historico = await this.progresso.historico(contexto, ctx.studentId, periodo, agora);

    const series = historico.tipos.map((tipo) => ({
      tipo: tipo.type,
      unidade: tipo.unidade,
      pontos: tipo.comparativo.pontos.map((ponto) => ({
        avaliacaoId: ponto.id,
        medidaEm: ponto.assessedAt.toISOString(),
        valor: ponto.valor,
      })),
      meta:
        tipo.meta === null
          ? null
          : { alvo: tipo.meta.alvo, prazo: tipo.meta.deadline.toISOString() },
    }));

    return {
      asOf: agora.toISOString(),
      periodo,
      series,
      analise: await this.ultimaAnalise(ctx),
    };
  }

  private async ultimaAnalise(ctx: StudentChannelContext): Promise<AnaliseDoHistorico | null> {
    const ultima = await this.analises.ultimaPublicada(tenantContextDoAluno(ctx), ctx.studentId);

    if (ultima === null) return null;

    return {
      geradaEm: ultima.geradaEm.toISOString(),
      analise: ultima.saida,
      model: ultima.model,
      promptVersion: ultima.promptVersion,
    };
  }
}
