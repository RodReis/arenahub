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
    recebidoEm: new Date(ms),
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

  it('nao produz chave de ordenacao quando o relogio do equipamento esta certo', async () => {
    // Caso normal: `ordenarPor` ausente significa "o `ocorridoEm` serve". A
    // fila resolve pelo COALESCE, e a linha nao carrega copia redundante.
    const { adapter } = catracaFake();

    const bancada = criarBancadaLab({
      catraca: adapter,
      permitidos: ['100000000042'],
      agoraMonotonicoMs: () => 0,
    });

    const r = await bancada.processar(eventoDe('100000000042', 1000), 'corr-4', new Date(1000));

    expect(r.ordenarPor).toBeUndefined();
    expect(r.relogioImplausivel).toBe(false);
  });

  it('marca a chave de ordenacao quando o equipamento congela o horario', async () => {
    // O caso de 17/08/2026: dois reconhecimentos com o MESMO `ocorridoEm`. O
    // segundo nao pode empatar com o primeiro na fila.
    const { adapter } = catracaFake();

    const bancada = criarBancadaLab({
      catraca: adapter,
      permitidos: ['100000000042'],
      agoraMonotonicoMs: () => 0,
    });

    const congelado = new Date('2026-08-17T15:47:28.000Z');

    const primeiro: EventoReconhecimento = {
      externalEnrollId: '100000000042',
      ocorridoEm: congelado,
      recebidoEm: new Date('2026-08-17T18:00:00.000Z'),
      metodo: 'facial',
    };
    const segundo: EventoReconhecimento = {
      externalEnrollId: '100000000042',
      ocorridoEm: congelado,
      recebidoEm: new Date('2026-08-17T18:05:00.000Z'),
      metodo: 'facial',
    };

    const r1 = await bancada.processar(primeiro, 'corr-5', new Date('2026-08-17T18:00:00.000Z'));
    const r2 = await bancada.processar(segundo, 'corr-6', new Date('2026-08-17T18:05:00.000Z'));

    // O primeiro nao tem com o que comparar: plausivel por falta de regua.
    expect(r1.relogioImplausivel).toBe(false);

    // O segundo revela o congelamento e passa a ordenar pelo recebimento.
    expect(r2.relogioImplausivel).toBe(true);
    expect(r2.ordenarPor).toEqual(new Date('2026-08-17T18:05:00.000Z'));

    // `M0-BR-004`: o horario que o equipamento afirmou segue intacto.
    expect(segundo.ocorridoEm).toEqual(congelado);
  });

  it('avalia o relogio ANTES de decidir — DENY tambem carrega a chave', async () => {
    // A ordenacao existe para a fila de eventos, e evento de acesso NEGADO
    // tambem sobe para o coletor. Avaliar so no ALLOW deixaria metade dos
    // eventos sem chave.
    const { adapter } = catracaFake();

    const bancada = criarBancadaLab({
      catraca: adapter,
      permitidos: ['100000000042'],
      agoraMonotonicoMs: () => 0,
    });

    const invalido: EventoReconhecimento = {
      externalEnrollId: '999',
      ocorridoEm: new Date(Number.NaN),
      recebidoEm: new Date('2026-08-17T18:00:00.000Z'),
      metodo: 'facial',
    };

    const r = await bancada.processar(invalido, 'corr-7', new Date('2026-08-17T18:00:00.000Z'));

    expect(r.decisao.resultado).toBe('DENY');
    expect(r.relogioImplausivel).toBe(true);
    expect(r.ordenarPor).toEqual(new Date('2026-08-17T18:00:00.000Z'));
  });

  it('avisa quando o relogio e implausivel, e so entao', async () => {
    // Relogio errado em silencio foi o que fez o achado de 17/08 aparecer so
    // na analise do relatorio, e nao na bancada com o PI presente.
    const { adapter } = catracaFake();
    const avisos: string[] = [];

    const bancada = criarBancadaLab({
      catraca: adapter,
      permitidos: ['100000000042'],
      agoraMonotonicoMs: () => 0,
      nomeDoLeitor: 'AYTI11108174',
      aoDetectarRelogioImplausivel: (a) => avisos.push(`${a.dispositivo}: ${a.razao}`),
    });

    const congelado = new Date('2026-08-17T15:47:28.000Z');
    const evento = (recebidoEm: string): EventoReconhecimento => ({
      externalEnrollId: '100000000042',
      ocorridoEm: congelado,
      recebidoEm: new Date(recebidoEm),
      metodo: 'facial',
    });

    await bancada.processar(evento('2026-08-17T18:00:00.000Z'), 'c1', new Date());
    expect(avisos).toHaveLength(0);

    await bancada.processar(evento('2026-08-17T18:05:00.000Z'), 'c2', new Date());
    expect(avisos).toEqual(['AYTI11108174: horario nao avancou desde o ultimo evento']);
  });
});
