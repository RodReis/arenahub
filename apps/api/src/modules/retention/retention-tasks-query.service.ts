import { Inject, Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { FaixaDeRisco } from './domain/avaliar-baseline.js';
import { estaAtiva, type EstadoDeTarefa, type ResultadoDeTarefa } from './domain/tarefa-de-retencao.js';
import type { CanalDeContato } from './retention-tasks.repository.js';

export const PORTA_DE_CONSULTA_DE_TAREFAS = Symbol('PortaDeConsultaDeTarefas');

export interface FatorDaTarefa {
  readonly posicao: number;
  readonly feature: string;
  readonly valorObservado: number;
  readonly rotulo: string;
}

export interface InteracaoDaTarefa {
  readonly canal: CanalDeContato;
  readonly resultado: ResultadoDeTarefa;
  readonly actorId: string;
  readonly ocorreuEm: Date;
  readonly observacoes: string | null;
  readonly proximoPasso: string | null;
}

export interface TarefaNaFila {
  readonly taskId: string;
  readonly studentId: string;
  readonly gymUnitId: string;
  readonly estrategia: string;
  readonly estado: EstadoDeTarefa;
  readonly responsavelId: string | null;
  readonly resultado: ResultadoDeTarefa | null;
  readonly motivo: string | null;
  readonly venceEm: Date;
  readonly criadaEm: Date;
  readonly score: { readonly scoreId: string; readonly valor: number; readonly faixa: FaixaDeRisco };
  readonly fatores: readonly FatorDaTarefa[];
  readonly interacoes: readonly InteracaoDaTarefa[];
}

export interface TarefaParaLeitura extends TarefaNaFila {
  /** Passou do prazo e ainda está ativa. */
  readonly vencida: boolean;
}

export interface PortaDeConsultaDeTarefas {
  filaDeTarefas(contexto: TenantContext, limite: number): Promise<TarefaNaFila[]>;
  /**
   * Contagem por estado da MESMA fila que `filaDeTarefas` devolve -- via
   * `groupBy` no banco, sem teto de paginação (F75, achado do code review:
   * contar a página trunca em silêncio quando há mais tarefas que o limite).
   */
  contagemPorEstado(contexto: TenantContext): Promise<Readonly<Partial<Record<EstadoDeTarefa, number>>>>;
}

export interface OpcoesDeLeituraDeFila {
  readonly agora: Date;
  readonly limite: number;
}

/**
 * Leitura da fila de tarefas (F38, Slice 6.3).
 *
 * ---------------------------------------------------------------------------
 * "VENCIDA" SÓ FAZ SENTIDO PARA TAREFA ATIVA
 * ---------------------------------------------------------------------------
 *
 * Tarefa concluída na terça com prazo para segunda **não está atrasada** -- ela
 * foi tratada. Marcar terminal como vencida encheria o relatório de atraso com
 * trabalho que aconteceu, e a métrica que deveria dizer "a equipe não está
 * dando conta" passaria a dizer qualquer coisa.
 *
 * O prazo em si continua visível no DTO: quem quiser medir *quando* foi tratada
 * contra *quando* devia tem os dois campos.
 */
@Injectable()
export class RetentionTasksQueryService {
  constructor(
    @Inject(PORTA_DE_CONSULTA_DE_TAREFAS) private readonly porta: PortaDeConsultaDeTarefas,
  ) {}

  async fila(
    contexto: TenantContext,
    opcoes: OpcoesDeLeituraDeFila,
  ): Promise<TarefaParaLeitura[]> {
    const tarefas = await this.porta.filaDeTarefas(contexto, opcoes.limite);

    return tarefas.map((tarefa) => ({
      ...tarefa,
      vencida: estaAtiva(tarefa.estado) && tarefa.venceEm.getTime() < opcoes.agora.getTime(),
    }));
  }

  async contagemPorEstado(
    contexto: TenantContext,
  ): Promise<Readonly<Partial<Record<EstadoDeTarefa, number>>>> {
    return this.porta.contagemPorEstado(contexto);
  }
}
