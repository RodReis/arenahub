import { describe, expect, it } from '@jest/globals';

import {
  agruparPorNome,
  decidirVeredito,
  paraCentavos,
  parsearDataBr,
  type CandidatoDeAlunoComInvoice,
  type LinhaDeRelatorio,
} from './dominio.js';

describe('parsearDataBr', () => {
  it('converte dd/mm/yyyy em data UTC', () => {
    expect(parsearDataBr('01/09/2026').toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rejeita formato fora do padrao', () => {
    expect(() => parsearDataBr('2026-09-01')).toThrow();
  });
});

describe('paraCentavos', () => {
  it('converte reais em centavos sem erro de ponto flutuante', () => {
    expect(paraCentavos(150)).toBe(15_000);
    expect(paraCentavos(1.1)).toBe(110);
    expect(paraCentavos(120.5)).toBe(12_050);
  });
});

describe('agruparPorNome', () => {
  it('agrupa nomes identicos apos normalizacao', () => {
    const linhas: LinhaDeRelatorio[] = [
      { nome: 'Valdivino Chaves Guimaraes', data: '10/09/2026', valor: 150 },
      { nome: '  valdivino  chaves guimarães ', data: '10/09/2026', valor: 150 },
      { nome: 'Ana Paula', data: '01/09/2026', valor: 200 },
    ];

    const grupos = agruparPorNome(linhas);

    expect(grupos.size).toBe(2);
    expect(grupos.get('valdivino chaves guimaraes')).toHaveLength(2);
    expect(grupos.get('ana paula')).toHaveLength(1);
  });
});

describe('decidirVeredito', () => {
  const linha: LinhaDeRelatorio = { nome: 'Ana Paula da Silva Gomes', data: '01/09/2026', valor: 200 };

  it('NAO_ENCONTRADO quando nenhum aluno do tenant bate o nome', () => {
    const veredito = decidirVeredito(linha, []);
    expect(veredito).toEqual({ tipo: 'NAO_ENCONTRADO', nome: linha.nome });
  });

  it('AMBIGUO quando dois alunos do tenant tem o mesmo nome normalizado', () => {
    const candidatos: CandidatoDeAlunoComInvoice[] = [
      { studentId: 'a', nomeNormalizado: 'ana paula da silva gomes', invoiceAberta: null },
      { studentId: 'b', nomeNormalizado: 'ana paula da silva gomes', invoiceAberta: null },
    ];

    expect(decidirVeredito(linha, candidatos)).toEqual({ tipo: 'AMBIGUO', nome: linha.nome });
  });

  it('SEM_INVOICE_ABERTA quando o aluno existe mas nao tem cobranca pendente', () => {
    const candidatos: CandidatoDeAlunoComInvoice[] = [
      { studentId: 'a', nomeNormalizado: 'ana paula da silva gomes', invoiceAberta: null },
    ];

    expect(decidirVeredito(linha, candidatos)).toEqual({
      tipo: 'SEM_INVOICE_ABERTA',
      nome: linha.nome,
      studentId: 'a',
    });
  });

  it('PRONTO quando o aluno bate e tem invoice em aberto -- carrega valores em centavos', () => {
    const candidatos: CandidatoDeAlunoComInvoice[] = [
      {
        studentId: 'a',
        nomeNormalizado: 'ana paula da silva gomes',
        invoiceAberta: { id: 'inv-1', totalMinor: 20_000 },
      },
    ];

    const veredito = decidirVeredito(linha, candidatos);

    expect(veredito).toEqual({
      tipo: 'PRONTO',
      nome: linha.nome,
      studentId: 'a',
      invoiceId: 'inv-1',
      amountMinor: 20_000,
      valorDaInvoiceMinor: 20_000,
      paidAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  it('PRONTO mesmo quando o valor pago diverge do valor da invoice -- quem decide e a regra de negocio, nao o parser', () => {
    const candidatos: CandidatoDeAlunoComInvoice[] = [
      {
        studentId: 'a',
        nomeNormalizado: 'ana paula da silva gomes',
        invoiceAberta: { id: 'inv-1', totalMinor: 15_000 },
      },
    ];

    const veredito = decidirVeredito(linha, candidatos);

    expect(veredito.tipo).toBe('PRONTO');
    if (veredito.tipo === 'PRONTO') {
      expect(veredito.amountMinor).toBe(20_000);
      expect(veredito.valorDaInvoiceMinor).toBe(15_000);
    }
  });
});
