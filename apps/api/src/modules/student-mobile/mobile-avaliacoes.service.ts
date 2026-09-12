import { Injectable } from '@nestjs/common';

import { AiAnalysisService } from '../health/ai-analysis.service.js';
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

@Injectable()
export class MobileAvaliacoesService {
  constructor(
    private readonly progresso: HealthProgressService,
    private readonly analises: AiAnalysisService,
  ) {}

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
