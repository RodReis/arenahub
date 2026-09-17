import { describe, expect, it } from '@jest/globals';

import { ordenarAniversariantes } from './aniversariantes.js';

describe('ordenarAniversariantes', () => {
  it('ordena por dia do mes, nao por nome', () => {
    const resultado = ordenarAniversariantes(
      [
        { nome: 'Zeca', diaEMes: '09-02' },
        { nome: 'Ana', diaEMes: '09-20' },
      ],
      '09-15',
    );

    expect(resultado.map((a) => a.nome)).toEqual(['Zeca', 'Ana']);
  });

  it('desempata por nome quando o dia e o mesmo', () => {
    const resultado = ordenarAniversariantes(
      [
        { nome: 'Beto', diaEMes: '09-10' },
        { nome: 'Ana', diaEMes: '09-10' },
      ],
      '09-15',
    );

    expect(resultado.map((a) => a.nome)).toEqual(['Ana', 'Beto']);
  });

  it('marca hoje = true so para quem faz aniversario na data informada', () => {
    const resultado = ordenarAniversariantes(
      [
        { nome: 'Ana', diaEMes: '09-15' },
        { nome: 'Beto', diaEMes: '09-16' },
      ],
      '09-15',
    );

    expect(resultado.find((a) => a.nome === 'Ana')?.hoje).toBe(true);
    expect(resultado.find((a) => a.nome === 'Beto')?.hoje).toBe(false);
  });

  it('devolve lista vazia sem quebrar', () => {
    expect(ordenarAniversariantes([], '09-15')).toEqual([]);
  });
});
