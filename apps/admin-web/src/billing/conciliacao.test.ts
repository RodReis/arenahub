import { describe, expect, it } from 'vitest';

import { COMANDOS_DA_TELA, diferencaMinor, janelaFechada } from './conciliacao';

/**
 * Regras de apresentacao da conciliacao -- F16.
 *
 * O que estes testes protegem: uma janela mal montada produz divergencia que
 * nao existe, num painel cuja unica razao de ser e achar divergencia real. Se
 * a fila enche de falso positivo, a operacao aprende a ignora-la.
 */

describe('janelaFechada', () => {
  it('o FIM E EXCLUSIVO: 01/08 a 31/08 vai ate 01/09', () => {
    // Sem o `+1 dia`, as cobrancas do dia 31 ficariam de fora e apareceriam
    // como MISSING_EXTERNAL na execucao seguinte.
    const { de, ate } = janelaFechada('2026-08-01', '2026-08-31');

    expect(de.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(ate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('vira o mes corretamente', () => {
    const { ate } = janelaFechada('2026-01-01', '2026-01-31');

    expect(ate.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('vira o ano corretamente', () => {
    const { ate } = janelaFechada('2026-12-01', '2026-12-31');

    expect(ate.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('fevereiro de ano bissexto tem 29 dias', () => {
    // 2028 e bissexto. Somar dia com aritmetica de milissegundos daria o
    // mesmo resultado aqui, mas `setUTCDate` e quem garante que o calendario
    // decide o proximo dia, e nao uma constante de 86400000.
    const { ate } = janelaFechada('2028-02-01', '2028-02-29');

    expect(ate.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });

  it('um unico dia vira uma janela de 24h', () => {
    const { de, ate } = janelaFechada('2026-08-15', '2026-08-15');

    expect(ate.getTime() - de.getTime()).toBe(86_400_000);
  });

  it('tudo em UTC -- o fuso do navegador nao muda a janela', () => {
    const { de } = janelaFechada('2026-08-01', '2026-08-31');

    expect(de.getUTCHours()).toBe(0);
    expect(de.getUTCDate()).toBe(1);
  });
});

describe('diferencaMinor', () => {
  it('provedor cobrou tarifa: diferenca negativa', () => {
    expect(diferencaMinor(12_000, 11_640)).toBe(-360);
  });

  it('valores iguais: zero', () => {
    expect(diferencaMinor(12_000, 12_000)).toBe(0);
  });

  it('AUSENCIA nao e diferenca de valor', () => {
    // Mostrar 12000 como "diferenca" sugeriria erro de valor onde o problema
    // e o movimento nao existir de um dos lados.
    expect(diferencaMinor(12_000, null)).toBeNull();
    expect(diferencaMinor(null, 12_000)).toBeNull();
  });
});

describe('COMANDOS_DA_TELA', () => {
  it('MISSING_EXTERNAL nao oferece reprocessamento -- nao ha evento a reprocessar', () => {
    expect(COMANDOS_DA_TELA['MISSING_EXTERNAL']).not.toContain('REPROCESS_PROVIDER_EVENT');
  });

  it('MISSING_INTERNAL oferece reprocessar: o evento pode estar guardado', () => {
    expect(COMANDOS_DA_TELA['MISSING_INTERNAL']).toContain('REPROCESS_PROVIDER_EVENT');
  });

  it('nao oferece comando para o que ja esta conferido', () => {
    expect(COMANDOS_DA_TELA['MATCHED']).toBeUndefined();
    expect(COMANDOS_DA_TELA['RESOLVED']).toBeUndefined();
  });
});
