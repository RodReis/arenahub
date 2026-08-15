import { describe, expect, it } from '@jest/globals';

import {
  LIMITACOES_CONHECIDAS,
  OBJETIVO_P95_MS,
  montarRelatorio,
  type EntradaRelatorio,
} from './relatorio-operacional.js';

const vazio: EntradaRelatorio = {
  latenciasMs: [],
  passagensConfirmadas: 0,
  passagensNaoRealizadas: 0,
  desfechosDesconhecidos: 0,
  backlog: 0,
  falhasDeEnvio: 0,
  limitacoes: [],
};

describe('montarRelatorio — M0-AC-008', () => {
  it('calcula p50, p95 e maximo', () => {
    const r = montarRelatorio({
      ...vazio,
      latenciasMs: Array.from({ length: 100 }, (_, i) => i + 1),
    });

    expect(r.latencia).toEqual({ p50: 50, p95: 95, max: 100, n: 100 });
  });

  it('sinaliza o objetivo do M0-NFR-002 sem julgar', () => {
    // "divergencia nao reprova automaticamente, mas exige analise" -- entao
    // o relatorio marca, e quem decide e o PI.
    const dentro = montarRelatorio({ ...vazio, latenciasMs: [100, 150, 200] });
    const fora = montarRelatorio({ ...vazio, latenciasMs: [400, 500, 600] });

    expect(dentro.p95DentroDoObjetivo).toBe(true);
    expect(fora.p95DentroDoObjetivo).toBe(false);
    expect(OBJETIVO_P95_MS).toBe(300);
  });

  it('taxa de erro e null sem tentativa, nao zero', () => {
    // Zero por cento de erro em zero tentativas e um numero excelente e
    // vazio -- e apareceria no relatorio como se significasse algo.
    expect(montarRelatorio(vazio).taxaDeErro).toBeNull();
    expect(montarRelatorio(vazio).latencia).toBeNull();
    expect(montarRelatorio(vazio).p95DentroDoObjetivo).toBeNull();
  });

  it('conta desconhecido como erro, mas separado de nao-realizada', () => {
    // "Nao sei o que aconteceu" nao e "deu errado" -- e juntar as duas
    // esconde o problema mais grave dos dois.
    const r = montarRelatorio({
      ...vazio,
      passagensConfirmadas: 7,
      passagensNaoRealizadas: 2,
      desfechosDesconhecidos: 1,
    });

    expect(r.passagens.total).toBe(10);
    expect(r.passagens.desconhecidas).toBe(1);
    // 3 de 10 nao terminaram em giro confirmado.
    expect(r.taxaDeErro).toBeCloseTo(0.3);
  });

  it('leva backlog e falhas de envio para o relatorio', () => {
    const r = montarRelatorio({ ...vazio, backlog: 42, falhasDeEnvio: 3 });

    expect(r.fila).toEqual({ backlog: 42, falhasDeEnvio: 3 });
  });
});

describe('LIMITACOES_CONHECIDAS', () => {
  it('toda limitacao cita a fonte', () => {
    // Limitacao sem fonte e opiniao. O relatorio precisa sustentar o que
    // afirma, porque e ele que decide se o MVP 0 vira MVP 1.
    for (const l of LIMITACOES_CONHECIDAS) {
      expect(l.fonte.length).toBeGreaterThan(10);
      expect(l.equipamento.length).toBeGreaterThan(0);
    }
  });

  it('registra que a catraca nao tem idempotencia', () => {
    // A limitacao mais cara do MVP 0: se alguem esquecer, a dupla liberacao
    // volta.
    const idempotencia = LIMITACOES_CONHECIDAS.find((l) =>
      l.limitacao.includes('duas vezes'),
    );

    expect(idempotencia?.equipamento).toBe('catraca-01');
  });

  it('registra que a DLL exige Windows', () => {
    const windows = LIMITACOES_CONHECIDAS.find((l) => l.limitacao.includes('Windows'));

    expect(windows).toBeDefined();
  });
});
