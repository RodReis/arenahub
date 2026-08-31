import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  RetentionTasksQueryService,
  type PortaDeConsultaDeTarefas,
  type TarefaNaFila,
} from './retention-tasks-query.service.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL',
};

const agora = new Date('2026-09-16T09:00:00.000Z');

const naFila = (parcial: Partial<TarefaNaFila> = {}): TarefaNaFila => ({
  taskId: 'tk1',
  studentId: 'e1',
  gymUnitId: 'u1',
  estrategia: 'DAYS_PAST_DUE',
  estado: 'ABERTA',
  responsavelId: null,
  resultado: null,
  motivo: null,
  venceEm: new Date('2026-09-15T09:00:00.000Z'),
  criadaEm: new Date('2026-09-10T09:00:00.000Z'),
  score: { scoreId: 'sc1', valor: 60, faixa: 'ALTO' },
  fatores: [
    { posicao: 1, feature: 'days_past_due', valorObservado: 41, rotulo: 'Cobranca vencida' },
  ],
  interacoes: [],
  ...parcial,
});

class PortaFake implements PortaDeConsultaDeTarefas {
  tarefas: TarefaNaFila[] = [naFila()];

  filaDeTarefas(): Promise<TarefaNaFila[]> {
    return Promise.resolve(this.tarefas);
  }
}

describe('RetentionTasksQueryService', () => {
  let porta: PortaFake;
  let service: RetentionTasksQueryService;

  beforeEach(() => {
    porta = new PortaFake();
    service = new RetentionTasksQueryService(porta);
  });

  it('marca como vencida a tarefa que passou do prazo', async () => {
    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.vencida).toBe(true);
  });

  it('nao marca como vencida quem ainda esta no prazo', async () => {
    porta.tarefas = [naFila({ venceEm: new Date('2026-09-20T09:00:00.000Z') })];

    expect((await service.fila(contexto, { agora, limite: 50 }))[0]?.vencida).toBe(false);
  });

  it('trata o instante exato do vencimento como ainda no prazo', async () => {
    porta.tarefas = [naFila({ venceEm: agora })];

    expect((await service.fila(contexto, { agora, limite: 50 }))[0]?.vencida).toBe(false);
  });

  it('nao marca vencida uma tarefa ja terminal', async () => {
    porta.tarefas = [
      naFila({ estado: 'CONCLUIDA', resultado: 'CONTATADO' }),
      naFila({ taskId: 'tk2', estado: 'DISPENSADA', motivo: 'voltou a treinar' }),
    ];

    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila.map((t) => t.vencida)).toEqual([false, false]);
  });

  it('preserva os fatores com o valor observado, para a conversa ter motivo', async () => {
    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.fatores[0]).toEqual({
      posicao: 1,
      feature: 'days_past_due',
      valorObservado: 41,
      rotulo: 'Cobranca vencida',
    });
  });

  it('devolve as interacoes ja registradas', async () => {
    porta.tarefas = [
      naFila({
        interacoes: [
          {
            canal: 'WHATSAPP',
            resultado: 'SEM_RESPOSTA',
            actorId: 'u9',
            ocorreuEm: new Date('2026-09-11T10:00:00.000Z'),
            observacoes: 'sem retorno',
            proximoPasso: null,
          },
        ],
      }),
    ];

    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.interacoes).toHaveLength(1);
    expect(fila[0]?.interacoes[0]).toMatchObject({ canal: 'WHATSAPP', actorId: 'u9' });
  });

  it('devolve lista vazia sem quebrar', async () => {
    porta.tarefas = [];

    expect(await service.fila(contexto, { agora, limite: 50 })).toEqual([]);
  });
});
