import { describe, expect, it, jest } from '@jest/globals';

import { DecideOnlineAccessUseCase, type ReconhecimentoRecebido } from './decide-online-access.use-case.js';

/**
 * O vinculo no primeiro reconhecimento (incidente de 05/10/2026, numero 861) e
 * um EXTRA: se ele falhar, a decisao continua sendo gravada. Achado da revisao
 * adversarial -- sem o try, uma excecao no vinculo virava 500 e nenhum
 * `AccessEvent` era gravado, contra o `M1` §3 (100% das decisoes fisicas com
 * evento).
 */

const EDGE = { tenantId: 't-1', gymUnitId: 'u-1', edgeNodeId: 'e-1' } as never;

const ENTRADA: ReconhecimentoRecebido = {
  dispositivo: { serial: 'SN-1' },
  externalUserId: '861',
  recognitionId: 'rec-1',
  recognizedAt: new Date(),
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
};

function montar(vinculo: () => Promise<boolean>) {
  const gravados: { outcome: string; detail: Record<string, unknown> }[] = [];

  const db = {
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ outboxEvent: { create: () => Promise.resolve({}) } }),
  };
  const identidades = {
    resolver: () =>
      Promise.resolve({ resolvida: false, motivo: 'UNKNOWN_EXTERNAL_USER', deviceId: 'd-1' }),
  };
  const eventos = {
    append: (dados: { outcome: string; reason: string; detail: Record<string, unknown> }) => {
      gravados.push(dados);

      return Promise.resolve({
        jaExistia: false,
        evento: {
          id: 'ev-1',
          correlationId: 'corr-1',
          outcome: dados.outcome,
          reason: dados.reason,
          policyVersion: 'v',
          validUntil: null,
        },
      });
    },
  };
  const vincularNoReconhecimento = jest.fn(vinculo);

  const useCase = new DecideOnlineAccessUseCase(
    db as never,
    identidades as never,
    {} as never,
    eventos as never,
    {} as never,
    { vincularNoReconhecimento } as never,
  );

  return { useCase, gravados, vincularNoReconhecimento };
}

describe('DecideOnlineAccessUseCase -- vinculo no primeiro reconhecimento', () => {
  it('vinculo que LANCA nao derruba a decisao: o DENY continua gravado', async () => {
    const { useCase, gravados, vincularNoReconhecimento } = montar(() =>
      Promise.reject(new Error('P2028 transaction timeout')),
    );

    const resposta = await useCase.executar(EDGE, ENTRADA);

    expect(vincularNoReconhecimento).toHaveBeenCalledTimes(1);
    expect(resposta.outcome).toBe('DENY');
    expect(gravados).toHaveLength(1);
    expect(gravados[0]?.detail).toMatchObject({ identityResolution: 'UNKNOWN_EXTERNAL_USER' });
  });

  /*
   * Achado Minor da revisao: `alreadyLinked` conta derrota em corrida, e a
   * marca dizia "vinculou" num DENY. A marca so vale quando a identidade
   * resolveu de fato depois do vinculo.
   */
  it('vinculo que nao resolve a identidade nao marca identityLinkedOnRecognition', async () => {
    const { useCase, gravados } = montar(() => Promise.resolve(true));

    await useCase.executar(EDGE, ENTRADA);

    expect(gravados[0]?.detail).not.toHaveProperty('identityLinkedOnRecognition');
  });
});
