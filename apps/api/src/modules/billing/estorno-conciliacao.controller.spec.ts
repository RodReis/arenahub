import { describe, expect, it, jest } from '@jest/globals';

import {
  EstornoConciliacaoController,
  StepUpBloqueadoPorTentativasError,
  StepUpNaoConfirmadoError,
} from './estorno-conciliacao.controller.js';

const ATOR = 'a1111111-1111-4111-8111-111111111111';

/** Armazenamento de contagem na memoria: o mesmo contrato do `ThrottlerStorage`. */
function criarArmazenamento() {
  const contagem = new Map<string, number>();

  return {
    increment: (chave: string, _ttl: number, limite: number) => {
      const total = (contagem.get(chave) ?? 0) + 1;
      contagem.set(chave, total);

      return Promise.resolve({
        totalHits: total,
        timeToExpire: 60,
        isBlocked: total > limite,
        timeToBlockExpire: 300,
      });
    },
  };
}

function montar(mfaVerificar: () => Promise<void>) {
  const executar = jest.fn(() =>
    Promise.resolve({ refundId: 'r1', status: 'CONFIRMED', acessoSuspenso: false }),
  );
  const controller = new EstornoConciliacaoController(
    { executar } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { verificar: mfaVerificar } as never,
    {} as never,
    { require: () => ({ actorId: ATOR, tenantId: 't1' }) } as never,
    criarArmazenamento(),
  );

  return { controller, executar };
}

const CORPO = { amountMinor: 1000, reason: 'estorno de teste', codigoMfa: '123456' };
const REQUISICAO = { correlationId: 'c1' } as never;

describe('step-up do estorno -- teto de tentativas por usuario (#582)', () => {
  it('codigo errado vira erro opaco enquanto esta dentro do teto', async () => {
    const { controller, executar } = montar(() => Promise.reject(new Error('codigo errado')));

    await expect(controller.estornar('p1', CORPO, REQUISICAO)).rejects.toBeInstanceOf(
      StepUpNaoConfirmadoError,
    );
    expect(executar).not.toHaveBeenCalled();
  });

  it('depois de 5 tentativas trava, ate para o codigo certo, e nao estorna', async () => {
    let certo = false;
    const { controller, executar } = montar(() =>
      certo ? Promise.resolve() : Promise.reject(new Error('codigo errado')),
    );

    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      await expect(controller.estornar('p1', CORPO, REQUISICAO)).rejects.toBeInstanceOf(
        StepUpNaoConfirmadoError,
      );
    }

    certo = true;
    await expect(controller.estornar('p1', CORPO, REQUISICAO)).rejects.toBeInstanceOf(
      StepUpBloqueadoPorTentativasError,
    );
    expect(executar).not.toHaveBeenCalled();
  });

  it('codigo certo dentro do teto estorna', async () => {
    const { controller, executar } = montar(() => Promise.resolve());

    await controller.estornar('p1', CORPO, REQUISICAO);

    expect(executar).toHaveBeenCalledTimes(1);
  });
});
