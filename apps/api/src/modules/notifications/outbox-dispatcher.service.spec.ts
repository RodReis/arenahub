import { describe, expect, it } from '@jest/globals';

import { FakePortaDeDispatch } from './outbox-dispatcher.repository.fake.js';
import { OutboxDispatcherService, type ConsumidorDeEvento } from './outbox-dispatcher.service.js';

const AGORA = new Date('2026-09-16T12:00:00Z');

function evento(id: string, eventType = 'InvoicePaid') {
  return {
    id,
    tenantId: 't1',
    eventType,
    aggregateType: 'Invoice',
    aggregateId: `agg-${id}`,
    payload: {},
    occurredAt: AGORA,
  };
}

describe('OutboxDispatcherService', () => {
  it('entrega um evento pendente ao consumidor registrado e registra o recibo', async () => {
    const porta = new FakePortaDeDispatch();
    porta.comEvento(evento('e1'));

    const recebidos: string[] = [];
    const consumidor: ConsumidorDeEvento = {
      nome: 'inbox',
      trata: (eventType) => eventType === 'InvoicePaid',
      processar: (ev) => {
        recebidos.push(ev.id);
        return Promise.resolve();
      },
    };

    const dispatcher = new OutboxDispatcherService(porta, [consumidor]);
    const resultado = await dispatcher.executarCiclo(AGORA);

    expect(recebidos).toEqual(['e1']);
    expect(resultado).toEqual({ eventos: 1, entregas: 1, falhas: 0 });
    expect(await porta.jaProcessado('inbox', 'e1')).toBe(true);
  });

  it('nao entrega duas vezes ao mesmo consumidor (idempotencia por recibo)', async () => {
    const porta = new FakePortaDeDispatch();
    porta.comEvento(evento('e1'));

    let chamadas = 0;
    const consumidor: ConsumidorDeEvento = {
      nome: 'inbox',
      trata: () => true,
      processar: () => {
        chamadas += 1;
        return Promise.resolve();
      },
    };

    const dispatcher = new OutboxDispatcherService(porta, [consumidor]);
    await dispatcher.executarCiclo(AGORA);
    await dispatcher.executarCiclo(AGORA);

    expect(chamadas).toBe(1);
  });

  it('falha de um consumidor nao impede os demais', async () => {
    const porta = new FakePortaDeDispatch();
    porta.comEvento(evento('e1'));

    const recebidos: string[] = [];
    const consumidorQuebrado: ConsumidorDeEvento = {
      nome: 'quebrado',
      trata: () => true,
      processar: () => {
        throw new Error('falha simulada');
      },
    };
    const consumidorOk: ConsumidorDeEvento = {
      nome: 'ok',
      trata: () => true,
      processar: (ev) => {
        recebidos.push(ev.id);
        return Promise.resolve();
      },
    };

    const dispatcher = new OutboxDispatcherService(porta, [consumidorQuebrado, consumidorOk]);
    const resultado = await dispatcher.executarCiclo(AGORA);

    expect(recebidos).toEqual(['e1']);
    expect(resultado).toEqual({ eventos: 1, entregas: 1, falhas: 1 });
  });

  it('evento sem consumidor interessado nao trava o ciclo e marca publicado', async () => {
    const porta = new FakePortaDeDispatch();
    porta.comEvento(evento('e1', 'ReconciliationMismatchDetected'));

    const consumidor: ConsumidorDeEvento = {
      nome: 'inbox',
      trata: (eventType) => eventType === 'InvoicePaid',
      processar: () => {
        throw new Error('nao deveria ser chamado');
      },
    };

    const dispatcher = new OutboxDispatcherService(porta, [consumidor]);
    const resultado = await dispatcher.executarCiclo(AGORA);

    expect(resultado).toEqual({ eventos: 1, entregas: 0, falhas: 0 });
  });
});
