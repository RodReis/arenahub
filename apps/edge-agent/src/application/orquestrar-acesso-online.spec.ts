import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { type ResultadoLiberacao, type TurnstileAdapter } from '../domain/turnstile.js';
import { ESTADO, MaquinaDeAcesso } from '../persistence/maquina-de-acesso.js';
import {
  criarProcessadorDeAcessoOnline,
  processarAcessoOnline,
  retomarPendentes,
  type DepsAcessoOnline,
  type ReconhecimentoComOrigem,
  type RespostaDeDecisao,
} from './orquestrar-acesso-online.js';

/**
 * F9, Task 4 -- correlacao entre reconhecimento, decisao, comando e passagem.
 *
 * O que estes testes defendem e uma frase so: **a catraca gira uma vez, e so
 * quando a nuvem autorizou**. Tudo aqui e variacao de como isso poderia
 * falhar -- rajada do leitor, nuvem muda, crash entre gravar e agir,
 * reinicio com tentativa pela metade.
 */

const DEVICE = 'device-catraca-1';

function eventoDe(sobrescreve: Partial<ReconhecimentoComOrigem> = {}): ReconhecimentoComOrigem {
  return {
    externalEnrollId: '42',
    deviceId: DEVICE,
    recognitionId: `rec-${Math.random().toString(36).slice(2)}`,
    ocorridoEm: new Date('2026-08-16T12:00:00.000Z'),
    ...sobrescreve,
  };
}

describe('acesso online no Edge', () => {
  let dir: string;
  let maquina: MaquinaDeAcesso;
  let liberacoes: string[];
  let catraca: TurnstileAdapter;

  const criarCatraca = (desfecho: ResultadoLiberacao['desfecho'] = 'girou'): TurnstileAdapter => ({
    nome: 'simulador',
    liberar: (comandoId: string): Promise<ResultadoLiberacao> => {
      liberacoes.push(comandoId);

      return Promise.resolve({ desfecho, duracaoMs: 120 });
    },
    encerrar: () => Promise.resolve(),
  });

  const deps = (sobrescreve: Partial<DepsAcessoOnline> = {}): DepsAcessoOnline => ({
    maquina,
    catraca,
    pedirDecisao: () =>
      Promise.resolve<RespostaDeDecisao>({
        accessEventId: 'evt-1',
        outcome: 'ALLOW',
        reason: 'ACTIVE_ENTITLEMENT',
        validUntil: '2026-12-31T00:00:00.000Z',
      }),
    reportarPassagem: () => Promise.resolve(true),
    agoraMonotonicoMs: () => 0,
    ...sobrescreve,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-f9-'));
    maquina = new MaquinaDeAcesso(join(dir, 'acesso.sqlite'));
    liberacoes = [];
    catraca = criarCatraca();
  });

  afterEach(() => {
    maquina.fechar();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('ALLOW libera exatamente uma vez', () => {
    it('comanda a catraca com o accessEventId como chave', async () => {
      const resultado = await processarAcessoOnline(deps(), eventoDe(), 'corr-1', new Date());

      expect(resultado.outcome).toBe('ALLOW');
      expect(resultado.estado).toBe(ESTADO.PASSAGE_CONFIRMED);
      expect(liberacoes).toEqual(['evt-1']);
    });

    it('grava a decisao e o desfecho na maquina', async () => {
      await processarAcessoOnline(deps(), eventoDe(), 'corr-2', new Date());

      const tentativa = maquina.porCorrelacao('corr-2');

      expect(tentativa).toMatchObject({
        estado: ESTADO.REPORTED,
        outcome: 'ALLOW',
        accessEventId: 'evt-1',
        commandId: 'evt-1',
      });
    });

    it('marca TIMED_OUT quando o equipamento nao confirma giro', async () => {
      catraca = criarCatraca('timeout');

      const resultado = await processarAcessoOnline(deps(), eventoDe(), 'corr-3', new Date());

      expect(resultado.estado).toBe(ESTADO.PASSAGE_TIMED_OUT);
      // Comandou assim mesmo: timeout e desfecho, nao impedimento.
      expect(liberacoes).toHaveLength(1);
    });
  });

  describe('DENY nunca encosta na catraca (M1-AC-006)', () => {
    it.each([
      'NO_ENTITLEMENT',
      'OUTSIDE_SCHEDULE',
      'ADMIN_BLOCK',
      'STUDENT_BLOCKED',
      'STUDENT_INACTIVE',
      'WRONG_UNIT',
    ])('nao libera quando a nuvem nega por %s', async (reason) => {
      const resultado = await processarAcessoOnline(
        deps({
          pedirDecisao: () =>
            Promise.resolve<RespostaDeDecisao>({
              accessEventId: 'evt-deny',
              outcome: 'DENY',
              reason,
              validUntil: null,
            }),
        }),
        eventoDe(),
        `corr-deny-${reason}`,
        new Date(),
      );

      expect(resultado.outcome).toBe('DENY');
      expect(resultado.reason).toBe(reason);
      expect(liberacoes).toEqual([]);
    });
  });

  describe('falha de comunicacao nunca vira ALLOW', () => {
    it('nega quando a nuvem devolve null', async () => {
      const resultado = await processarAcessoOnline(
        deps({ pedirDecisao: () => Promise.resolve(null) }),
        eventoDe(),
        'corr-nulo',
        new Date(),
      );

      expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'CLOUD_UNAVAILABLE' });
      expect(liberacoes).toEqual([]);
    });

    it('nega quando a chamada a nuvem lanca', async () => {
      const resultado = await processarAcessoOnline(
        deps({ pedirDecisao: () => Promise.reject(new Error('ECONNREFUSED')) }),
        eventoDe(),
        'corr-erro',
        new Date(),
      );

      expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'CLOUD_UNAVAILABLE' });
      expect(liberacoes).toEqual([]);
    });

    it('nega quando a nuvem demora mais que o teto', async () => {
      jest.useFakeTimers();

      try {
        const promessa = processarAcessoOnline(
          deps({
            pedirDecisao: () =>
              new Promise<RespostaDeDecisao>((resolve) => {
                setTimeout(
                  () =>
                    resolve({
                      accessEventId: 'evt-tarde',
                      outcome: 'ALLOW',
                      reason: 'ACTIVE_ENTITLEMENT',
                      validUntil: null,
                    }),
                  60_000,
                );
              }),
          }),
          eventoDe(),
          'corr-lento',
          new Date(),
        );

        await jest.advanceTimersByTimeAsync(10_000);

        const resultado = await promessa;

        expect(resultado).toMatchObject({ outcome: 'DENY', reason: 'CLOUD_UNAVAILABLE' });
        expect(liberacoes).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('rajada do leitor nao vira varias liberacoes (M0-AC-003)', () => {
    it('o mesmo reconhecimento reprocessado nao comanda de novo', async () => {
      const evento = eventoDe({ recognitionId: 'rec-fixo' });

      await processarAcessoOnline(deps(), evento, 'corr-a', new Date());
      const segunda = await processarAcessoOnline(deps(), evento, 'corr-b', new Date());

      expect(liberacoes).toHaveLength(1);
      // A segunda devolve o que ja havia, sem repetir efeito.
      expect(segunda.accessEventId).toBe('evt-1');
    });

    it('serializa por pessoa: rajada simultanea produz uma liberacao', async () => {
      const processar = criarProcessadorDeAcessoOnline(deps());
      const evento = eventoDe({ recognitionId: 'rec-rajada' });

      await Promise.all([
        processar(evento, 'corr-r1', new Date()),
        processar(evento, 'corr-r2', new Date()),
        processar(evento, 'corr-r3', new Date()),
      ]);

      expect(liberacoes).toHaveLength(1);
    });

    it('pessoas diferentes liberam cada uma a sua vez', async () => {
      let contador = 0;

      const processar = criarProcessadorDeAcessoOnline(
        deps({
          pedirDecisao: () => {
            contador += 1;

            return Promise.resolve<RespostaDeDecisao>({
              accessEventId: `evt-${contador}`,
              outcome: 'ALLOW',
              reason: 'ACTIVE_ENTITLEMENT',
              validUntil: null,
            });
          },
        }),
      );

      await Promise.all([
        processar(eventoDe({ externalEnrollId: '1', recognitionId: 'r1' }), 'c1', new Date()),
        processar(eventoDe({ externalEnrollId: '2', recognitionId: 'r2' }), 'c2', new Date()),
      ]);

      expect(liberacoes).toHaveLength(2);
      expect(new Set(liberacoes).size).toBe(2);
    });
  });

  describe('falha ao reportar nao desfaz o giro', () => {
    it('mantem a tentativa pendente quando o report falha', async () => {
      await processarAcessoOnline(
        deps({ reportarPassagem: () => Promise.reject(new Error('rede')) }),
        eventoDe(),
        'corr-report',
        new Date(),
      );

      const tentativa = maquina.porCorrelacao('corr-report');

      // Girou -- e o estado registra isso, mesmo sem a nuvem saber ainda.
      expect(liberacoes).toHaveLength(1);
      expect(tentativa?.estado).toBe(ESTADO.PASSAGE_CONFIRMED);
      expect(tentativa?.tentativasDeEnvio).toBe(1);
    });
  });

  describe('retomada apos reinicio (M1-NFR-004)', () => {
    it('NUNCA recomanda a catraca para tentativa em COMMAND_PENDING', async () => {
      maquina.registrarReconhecimento({
        correlationId: 'corr-crash',
        externalUserId: '42',
        deviceId: DEVICE,
        recognitionId: 'rec-crash',
        recognizedAt: new Date(),
      });

      // Simula o crash exatamente no ponto pior: gravamos que ia comandar, e
      // nao sabemos se o comando saiu.
      maquina.transicionar('corr-crash', ESTADO.DECISION_PENDING);
      maquina.transicionar('corr-crash', ESTADO.ALLOWED, {
        accessEventId: 'evt-crash',
        outcome: 'ALLOW',
        reason: 'ACTIVE_ENTITLEMENT',
      });
      maquina.transicionar('corr-crash', ESTADO.COMMAND_PENDING, { commandId: 'evt-crash' });

      const resumo = await retomarPendentes(deps());

      expect(liberacoes).toEqual([]);
      expect(resumo.reportadas).toBe(1);

      // Fecha como TIMED_OUT: o desfecho honesto e "nao confirmamos giro".
      const tentativa = maquina.porCorrelacao('corr-crash');

      expect(tentativa?.estado).toBe(ESTADO.REPORTED);
    });

    it('reporta tentativa que ja tinha girado mas nao chegou a nuvem', async () => {
      maquina.registrarReconhecimento({
        correlationId: 'corr-girou',
        externalUserId: '42',
        deviceId: DEVICE,
        recognitionId: 'rec-girou',
        recognizedAt: new Date(),
      });

      maquina.transicionar('corr-girou', ESTADO.DECISION_PENDING);
      maquina.transicionar('corr-girou', ESTADO.ALLOWED, {
        accessEventId: 'evt-girou',
        outcome: 'ALLOW',
        reason: 'ACTIVE_ENTITLEMENT',
      });
      maquina.transicionar('corr-girou', ESTADO.COMMAND_PENDING, { commandId: 'evt-girou' });
      maquina.transicionar('corr-girou', ESTADO.COMMAND_SENT);
      maquina.transicionar('corr-girou', ESTADO.PASSAGE_CONFIRMED);

      const reportados: string[] = [];

      const resumo = await retomarPendentes(
        deps({
          reportarPassagem: (accessEventId, estado) => {
            reportados.push(`${accessEventId}:${estado}`);

            return Promise.resolve(true);
          },
        }),
      );

      expect(reportados).toEqual(['evt-girou:CONFIRMED']);
      expect(resumo.reportadas).toBe(1);
      expect(liberacoes).toEqual([]);
    });

    it('abandona tentativa que nem chegou a perguntar a nuvem', async () => {
      maquina.registrarReconhecimento({
        correlationId: 'corr-cru',
        externalUserId: '42',
        deviceId: DEVICE,
        recognitionId: 'rec-cru',
        recognizedAt: new Date(),
      });

      const resumo = await retomarPendentes(deps());

      expect(resumo.abandonadas).toBe(1);
      expect(liberacoes).toEqual([]);
    });
  });
});

describe('maquina de estado', () => {
  let dir: string;
  let maquina: MaquinaDeAcesso;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-f9-m-'));
    maquina = new MaquinaDeAcesso(join(dir, 'm.sqlite'));
  });

  afterEach(() => {
    maquina.fechar();
    rmSync(dir, { recursive: true, force: true });
  });

  const novaTentativa = (correlationId: string): void => {
    maquina.registrarReconhecimento({
      correlationId,
      externalUserId: '7',
      deviceId: DEVICE,
      recognitionId: `rec-${correlationId}`,
      recognizedAt: new Date(),
    });
  };

  it('recusa transicao que pularia etapa', () => {
    novaTentativa('t1');

    expect(() => maquina.transicionar('t1', ESTADO.COMMAND_SENT)).toThrow(/transicao invalida/);
  });

  it('recusa ir de DENIED para ALLOWED', () => {
    novaTentativa('t2');
    maquina.transicionar('t2', ESTADO.DECISION_PENDING);
    maquina.transicionar('t2', ESTADO.DENIED, { outcome: 'DENY', reason: 'NO_ENTITLEMENT' });

    expect(() => maquina.transicionar('t2', ESTADO.ALLOWED)).toThrow(/transicao invalida/);
  });

  it('recusa sair de estado terminal', () => {
    novaTentativa('t3');
    maquina.transicionar('t3', ESTADO.DECISION_PENDING);
    maquina.transicionar('t3', ESTADO.DENIED, { outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
    maquina.transicionar('t3', ESTADO.REPORTED);

    expect(() => maquina.transicionar('t3', ESTADO.ALLOWED)).toThrow(/terminal/);
  });

  it('reentrada no mesmo estado e inofensiva', () => {
    novaTentativa('t4');
    maquina.transicionar('t4', ESTADO.DECISION_PENDING);

    expect(() => maquina.transicionar('t4', ESTADO.DECISION_PENDING)).not.toThrow();
  });

  it('o mesmo reconhecimento nao vira duas tentativas', () => {
    const primeira = maquina.registrarReconhecimento({
      correlationId: 'p1',
      externalUserId: '7',
      deviceId: DEVICE,
      recognitionId: 'mesmo-rec',
      recognizedAt: new Date(),
    });

    const segunda = maquina.registrarReconhecimento({
      correlationId: 'p2-diferente',
      externalUserId: '7',
      deviceId: DEVICE,
      recognitionId: 'mesmo-rec',
      recognizedAt: new Date(),
    });

    expect(segunda.correlationId).toBe(primeira.correlationId);
  });

  it('o mesmo enrollid em leitores diferentes sao tentativas distintas', () => {
    const a = maquina.registrarReconhecimento({
      correlationId: 'd1',
      externalUserId: '7',
      deviceId: 'leitor-a',
      recognitionId: 'rec-igual',
      recognizedAt: new Date(),
    });

    const b = maquina.registrarReconhecimento({
      correlationId: 'd2',
      externalUserId: '7',
      deviceId: 'leitor-b',
      recognitionId: 'rec-igual',
      recognizedAt: new Date(),
    });

    expect(b.correlationId).not.toBe(a.correlationId);
  });

  it('sobrevive ao fechamento e reabertura do banco', () => {
    const caminho = join(dir, 'persistente.sqlite');
    const primeira = new MaquinaDeAcesso(caminho);

    primeira.registrarReconhecimento({
      correlationId: 'sobrevive',
      externalUserId: '9',
      deviceId: DEVICE,
      recognitionId: 'rec-sobrevive',
      recognizedAt: new Date(),
    });

    primeira.transicionar('sobrevive', ESTADO.DECISION_PENDING);
    primeira.fechar();

    const segunda = new MaquinaDeAcesso(caminho);

    expect(segunda.porCorrelacao('sobrevive')?.estado).toBe(ESTADO.DECISION_PENDING);

    segunda.fechar();
  });

  it('pendentes ignora as ja reportadas', () => {
    novaTentativa('pend-1');
    novaTentativa('pend-2');
    maquina.transicionar('pend-2', ESTADO.DECISION_PENDING);
    maquina.transicionar('pend-2', ESTADO.DENIED, { outcome: 'DENY', reason: 'NO_ENTITLEMENT' });
    maquina.transicionar('pend-2', ESTADO.REPORTED);

    const pendentes = maquina.pendentes();

    expect(pendentes.map((p) => p.correlationId)).toEqual(['pend-1']);
  });
});
