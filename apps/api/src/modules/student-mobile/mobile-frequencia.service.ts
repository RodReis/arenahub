import { Injectable } from '@nestjs/common';

import { AttendanceService } from '../health/attendance.service.js';
import type { BaldeDeFrequencia, Granularidade } from '../health/domain/frequencia.js';
import type { Periodo } from '../health/domain/periodo.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { tenantContextDoAluno } from './contexto-do-aluno.js';

export interface RespostaDaFrequencia {
  readonly asOf: string;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly periodo: Periodo;
  readonly granularidade: Granularidade;
  /** Dias treinados no periodo. Ver `totalDePassagens` para a distincao. */
  readonly totalDeSessoes: number;
  /** Entradas confirmadas. Sempre >= `totalDeSessoes`. */
  readonly totalDePassagens: number;
  readonly baldes: readonly BaldeDeFrequencia[];
  readonly consistencia: {
    readonly semanasComSessao: number;
    readonly semanasElegiveis: number;
    readonly proporcao: number | null;
  };
}

/**
 * A frequencia do aluno no app -- Slice 4.2, `M4-FR-008`.
 *
 * ---------------------------------------------------------------------------
 * ESTE ARQUIVO NAO CALCULA FREQUENCIA. ELE SO A TRADUZ PARA O APP.
 * ---------------------------------------------------------------------------
 *
 * A conta inteira -- elegibilidade da passagem, agrupamento por dia civil
 * local, agregacao por semana/mes/ano, consistencia -- ja existe em
 * `AttendanceService`, escrita e testada na F18 (Slice 3.4). Reimplementa-la
 * aqui criaria uma SEGUNDA verdade: o painel diria "treinou 3 dias" e o app
 * "4", e a divergencia so apareceria quando alguem comparasse as duas telas.
 *
 * `M4-FR-008` e explicito -- "exibir frequencia DERIVADA PELO BACKEND". O BFF
 * do app e consumidor do caso de uso publico do modulo de health (regra de
 * arquitetura no 9), nunca das tabelas dele.
 *
 * O QUE FICA AQUI: a conversao de contexto (sessao de aluno -> `TenantContext`)
 * e a forma da resposta. `sessoes` do contrato interno NAO e repassada ao app:
 * e a lista de todas as passagens com ids internos, e a tela mostra agregados.
 * Mandar o detalhe inteiro para o celular seria vazar id de passagem sem uso.
 */
@Injectable()
export class MobileFrequenciaService {
  constructor(private readonly frequencia: AttendanceService) {}

  async montar(
    ctx: StudentChannelContext,
    periodo: Periodo,
    granularidade: Granularidade,
    agora: Date,
  ): Promise<RespostaDaFrequencia> {
    const resultado = await this.frequencia.frequenciaDoAluno(
      tenantContextDoAluno(ctx),
      // O aluno sai da SESSAO, nunca da URL. Com id na rota, quem tem uma
      // sessao valida leria a frequencia de qualquer aluno do tenant.
      ctx.studentId,
      periodo,
      granularidade,
      agora,
    );

    return {
      asOf: agora.toISOString(),
      status: 'AVAILABLE',
      periodo: resultado.periodo,
      granularidade: resultado.granularidade,
      totalDeSessoes: resultado.totalDeSessoes,
      totalDePassagens: resultado.totalDePassagens,
      baldes: resultado.baldes,
      consistencia: resultado.consistencia,
    };
  }
}
