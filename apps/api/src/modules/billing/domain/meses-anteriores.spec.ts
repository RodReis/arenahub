import { describe, expect, it } from '@jest/globals';

import {
  agruparMesesAnteriores,
  mesLocal,
  venceuNoMesAtual,
  type FaturaVencidaDoAluno,
} from './meses-anteriores.js';

// 19/10/2026 12:00 em São Paulo.
const AGORA = new Date('2026-10-19T15:00:00.000Z');
const SP = 'America/Sao_Paulo';

function fatura(sobrescrever: Partial<FaturaVencidaDoAluno>): FaturaVencidaDoAluno {
  return {
    studentId: 'a',
    studentName: 'Aluno A',
    dueAt: new Date('2026-09-10T15:00:00.000Z'),
    diasEmAtraso: 39,
    situacao: 'EM_CARENCIA',
    telefone: null,
    liberadoAte: null,
    fusoDaUnidade: SP,
    ...sobrescrever,
  };
}

describe('mês do vencimento no fuso da unidade', () => {
  it('mesLocal usa o fuso: 01/10 02:00Z ainda é setembro em São Paulo', () => {
    expect(mesLocal(new Date('2026-10-01T02:00:00.000Z'), SP)).toBe('2026-09');
    expect(mesLocal(new Date('2026-10-01T03:00:00.000Z'), SP)).toBe('2026-10');
  });

  it('venceuNoMesAtual compara o mês local do vencimento com o de agora', () => {
    expect(venceuNoMesAtual({ dueAt: new Date('2026-10-05T15:00:00.000Z'), fusoDaUnidade: SP }, AGORA)).toBe(true);
    expect(venceuNoMesAtual({ dueAt: new Date('2026-09-30T15:00:00.000Z'), fusoDaUnidade: SP }, AGORA)).toBe(false);
    // 01/10 02:00Z = 30/09 23:00 em São Paulo: ainda é setembro, mês anterior.
    expect(venceuNoMesAtual({ dueAt: new Date('2026-10-01T02:00:00.000Z'), fusoDaUnidade: SP }, AGORA)).toBe(false);
  });
});

describe('agruparMesesAnteriores', () => {
  it('uma linha por aluno, com os meses em aberto, o total de faturas e o vencimento mais antigo', () => {
    const linhas = agruparMesesAnteriores(
      [
        fatura({ dueAt: new Date('2026-09-10T15:00:00.000Z'), diasEmAtraso: 39 }),
        fatura({ dueAt: new Date('2026-08-10T15:00:00.000Z'), diasEmAtraso: 70 }),
        fatura({ dueAt: new Date('2026-08-25T15:00:00.000Z'), diasEmAtraso: 55 }),
      ],
      AGORA,
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      studentId: 'a',
      mesesEmAberto: ['2026-08', '2026-09'],
      faturas: 3,
      vencimentoMaisAntigo: new Date('2026-08-10T15:00:00.000Z'),
      diasEmAtraso: 70,
    });
  });

  it('fatura do mês atual não conta, e quem só deve o mês atual não aparece', () => {
    const linhas = agruparMesesAnteriores(
      [
        fatura({ studentId: 'so-atual', dueAt: new Date('2026-10-05T15:00:00.000Z'), diasEmAtraso: 14 }),
        fatura({ studentId: 'misto', dueAt: new Date('2026-10-05T15:00:00.000Z'), diasEmAtraso: 14 }),
        fatura({ studentId: 'misto', dueAt: new Date('2026-09-05T15:00:00.000Z'), diasEmAtraso: 44 }),
      ],
      AGORA,
    );

    expect(linhas.map((l) => l.studentId)).toEqual(['misto']);
    expect(linhas[0]).toMatchObject({ faturas: 1, mesesEmAberto: ['2026-09'] });
  });

  it('bloqueado se qualquer fatura bloqueia; liberação vale a mais distante', () => {
    const [linha] = agruparMesesAnteriores(
      [
        fatura({ situacao: 'EM_CARENCIA', liberadoAte: new Date('2026-10-25T03:00:00.000Z') }),
        fatura({
          dueAt: new Date('2026-08-10T15:00:00.000Z'),
          situacao: 'BLOQUEADO',
          liberadoAte: new Date('2026-10-30T03:00:00.000Z'),
        }),
      ],
      AGORA,
    );

    expect(linha?.situacao).toBe('BLOQUEADO');
    expect(linha?.liberadoAte).toEqual(new Date('2026-10-30T03:00:00.000Z'));
  });

  it('ordena: bloqueado primeiro, depois atraso mais antigo, depois id', () => {
    const linhas = agruparMesesAnteriores(
      [
        fatura({ studentId: 'c', diasEmAtraso: 39 }),
        fatura({ studentId: 'b', diasEmAtraso: 70, dueAt: new Date('2026-08-10T15:00:00.000Z') }),
        fatura({ studentId: 'a', diasEmAtraso: 39 }),
        fatura({ studentId: 'z', diasEmAtraso: 10, situacao: 'BLOQUEADO' }),
      ],
      AGORA,
    );

    expect(linhas.map((l) => l.studentId)).toEqual(['z', 'b', 'a', 'c']);
  });
});
