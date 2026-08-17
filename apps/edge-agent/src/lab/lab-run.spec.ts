import { describe, expect, it } from '@jest/globals';

import { type EventoReconhecimento } from '../domain/facial-device.js';
import { type ResultadoLiberacao, type TurnstileAdapter } from '../domain/turnstile.js';
import { criarBancadaLab } from './lab-run.js';

/**
 * O `lab:run` liga facial -> decisao local -> catraca e coleta latencia. O
 * fio de I/O (ponte, WebSocket) nao roda no CI; o que roda aqui e a
 * ORQUESTRACAO: dado um reconhecimento de alguem permitido, a catraca e
 * acionada uma vez e a latencia entra na coleta; dado um desconhecido, nada
 * e acionado.
 */

function eventoDe(externalEnrollId: string, ms: number): EventoReconhecimento {
  return {
    externalEnrollId,
    ocorridoEm: new Date(ms),
    metodo: 'facial',
  };
}

/** Catraca falsa que registra cada `liberar` (com o sentido) e confirma giro. */
function catracaFake(): {
  adapter: TurnstileAdapter;
  liberacoes: string[];
  sentidos: (string | undefined)[];
} {
  const liberacoes: string[] = [];
  const sentidos: (string | undefined)[] = [];
  const adapter: TurnstileAdapter = {
    nome: 'fake',
    liberar: (comandoId: string, _timeoutMs: number, sentido?: string): Promise<ResultadoLiberacao> => {
      liberacoes.push(comandoId);
      sentidos.push(sentido);
      return Promise.resolve({ desfecho: 'girou', duracaoMs: 42 });
    },
    encerrar: () => Promise.resolve(),
  };
  return { adapter, liberacoes, sentidos };
}

describe('criarBancadaLab', () => {
  it('aciona a catraca para pessoa permitida e coleta a latencia', async () => {
    const { adapter, liberacoes } = catracaFake();

    const bancada = criarBancadaLab({
      catraca: adapter,
      permitidos: ['100000000042'],
      agoraMonotonicoMs: () => 0,
    });

    const r = await bancada.processar(eventoDe('100000000042', 1000), 'corr-1', new Date(1000));

    expect(r.decisao.resultado).toBe('ALLOW');
    expect(liberacoes).toHaveLength(1);
    expect(bancada.latencias()).toHaveLength(1);
  });

  it('NAO aciona a catraca para desconhecido', async () => {
    const { adapter, liberacoes } = catracaFake();

    const bancada = criarBancadaLab({
      catraca: adapter,
      permitidos: ['100000000042'],
      agoraMonotonicoMs: () => 0,
    });

    const r = await bancada.processar(eventoDe('999', 1000), 'corr-2', new Date(1000));

    expect(r.decisao.resultado).toBe('DENY');
    expect(liberacoes).toHaveLength(0);
    expect(bancada.latencias()).toHaveLength(0);
  });

  it('repassa o sentido configurado para o liberar da catraca', async () => {
    // Qual sentido gira para dentro depende da instalacao fisica (achado de
    // campo). A bancada precisa poder escolher, senao so testa `entrada`.
    const { adapter, sentidos } = catracaFake();

    const bancada = criarBancadaLab({
      catraca: adapter,
      permitidos: ['100000000042'],
      agoraMonotonicoMs: () => 0,
      sentido: 'saida',
    });

    await bancada.processar(eventoDe('100000000042', 1000), 'corr-3', new Date(1000));

    expect(sentidos).toEqual(['saida']);
  });
});
