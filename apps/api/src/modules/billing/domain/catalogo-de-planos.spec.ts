import { describe, expect, it } from '@jest/globals';

import {
  BeneficioInvalidoError,
  LIMITE_DE_MEMBROS_INDEFINIDO,
  beneficiosInclusos,
  validarBeneficio,
  vagasRestantes,
} from './catalogo-de-planos.js';

/**
 * Beneficio do plano e DADO ESTRUTURADO (decisao do PI em 18/08/2026), nao
 * texto de marketing: os encartes da Arena Positiva listam item, se esta
 * incluso e a periodicidade -- "bioimpedancia a cada 30 dias" no programa de
 * adultos, "a cada 60" no de protocolos especificos. Guardar como prosa
 * jogaria fora justamente o que o MVP 3 vai precisar ler.
 */
describe('validarBeneficio', () => {
  it('aceita beneficio incluso sem periodicidade', () => {
    expect(() =>
      validarBeneficio({ item: 'Toalha de higiene pessoal', status: 'INCLUDED' }),
    ).not.toThrow();
  });

  it('aceita periodicidade em dias', () => {
    expect(() =>
      validarBeneficio({ item: 'Bioimpedancia', status: 'INCLUDED', everyDays: 30 }),
    ).not.toThrow();
  });

  it('aceita status de avaliacao -- o ECG do encarte nao esta incluso', () => {
    expect(() => validarBeneficio({ item: 'Teste de ECG', status: 'UNDER_REVIEW' })).not.toThrow();
  });

  it('rejeita item vazio', () => {
    expect(() => validarBeneficio({ item: '   ', status: 'INCLUDED' })).toThrow(
      BeneficioInvalidoError,
    );
  });

  it('rejeita periodicidade nao inteira ou nao positiva', () => {
    expect(() =>
      validarBeneficio({ item: 'Bioimpedancia', status: 'INCLUDED', everyDays: 30.5 }),
    ).toThrow(BeneficioInvalidoError);
    expect(() =>
      validarBeneficio({ item: 'Bioimpedancia', status: 'INCLUDED', everyDays: 0 }),
    ).toThrow(BeneficioInvalidoError);
  });

  it('rejeita periodicidade em beneficio nao incluso -- nao se agenda o que nao existe', () => {
    expect(() =>
      validarBeneficio({ item: 'Teste de ECG', status: 'UNDER_REVIEW', everyDays: 30 }),
    ).toThrow(BeneficioInvalidoError);
  });
});

describe('beneficiosInclusos', () => {
  const beneficios = [
    { item: 'Cafe com e sem acucar', status: 'INCLUDED' as const },
    { item: 'Bioimpedancia', status: 'INCLUDED' as const, everyDays: 30 },
    { item: 'Teste de ECG', status: 'UNDER_REVIEW' as const },
  ];

  it('filtra so o que esta incluso', () => {
    expect(beneficiosInclusos(beneficios).map((b) => b.item)).toEqual([
      'Cafe com e sem acucar',
      'Bioimpedancia',
    ]);
  });
});

/**
 * Plano familiar tem LIMITE DE MEMBROS (3, decidido pelo PI em 18/08/2026).
 * Plano individual nao tem limite porque nao tem grupo -- e `undefined`, nao
 * `1`: numero magico esconderia a diferenca entre "um titular sozinho" e
 * "grupo de um".
 */
describe('vagasRestantes', () => {
  it('familia de 3 com 1 membro tem 2 vagas', () => {
    expect(vagasRestantes(3, 1)).toBe(2);
  });

  it('familia cheia nao tem vaga', () => {
    expect(vagasRestantes(3, 3)).toBe(0);
  });

  it('nunca devolve negativo, mesmo com grupo acima do limite', () => {
    expect(vagasRestantes(3, 5)).toBe(0);
  });

  it('plano sem limite devolve o sentinela de indefinido', () => {
    expect(vagasRestantes(undefined, 1)).toBe(LIMITE_DE_MEMBROS_INDEFINIDO);
  });
});
