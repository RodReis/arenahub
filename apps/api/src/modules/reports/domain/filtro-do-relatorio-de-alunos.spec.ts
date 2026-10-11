import { describe, expect, it } from '@jest/globals';

import { descreverFiltro, lerFiltro } from './filtro-do-relatorio-de-alunos.js';

const UUID = '3f6c1c2e-8a4b-4d57-9a2e-6a1f0d7b9c11';

const SEM_FILTRO = {
  gymUnitId: undefined,
  status: undefined,
  profile: undefined,
  planId: undefined,
  financeiro: undefined,
};

describe('lerFiltro', () => {
  it('lê os cinco filtros válidos', () => {
    expect(
      lerFiltro({
        gymUnitId: UUID,
        status: 'ACTIVE',
        profile: 'TRAINER',
        planId: UUID,
        financeiro: 'INADIMPLENTES',
      }),
    ).toEqual({
      gymUnitId: UUID,
      status: 'ACTIVE',
      profile: 'TRAINER',
      planId: UUID,
      financeiro: 'INADIMPLENTES',
    });
  });

  it('valor inválido vira "sem filtro", nunca erro (a URL é editada à mão)', () => {
    expect(
      lerFiltro({
        gymUnitId: 'abc',
        status: 'ATIVO',
        profile: 'CHEFE',
        planId: '',
        financeiro: 'TODOS',
      }),
    ).toEqual(SEM_FILTRO);
  });

  it('chaves ausentes e tipos estranhos (array, número) também viram "sem filtro"', () => {
    expect(lerFiltro({ status: ['ACTIVE', 'BLOCKED'], planId: 7 })).toEqual(SEM_FILTRO);
  });
});

describe('descreverFiltro', () => {
  const vazio = lerFiltro({});

  it('sem filtro, lista vazia', () => {
    expect(descreverFiltro(vazio, { unidade: undefined, plano: undefined })).toEqual([]);
  });

  it('descreve cada filtro em pt-BR, com o NOME da unidade e do plano', () => {
    const filtro = lerFiltro({
      gymUnitId: UUID,
      status: 'BLOCKED',
      profile: 'STUDENT',
      planId: UUID,
      financeiro: 'PAGANTES',
    });

    expect(descreverFiltro(filtro, { unidade: 'Matriz', plano: 'Mensal Fit' })).toEqual([
      'Unidade: Matriz',
      'Situação: Bloqueado',
      'Perfil: Aluno',
      'Plano: Mensal Fit',
      'Financeiro: Pagantes',
    ]);
  });

  it('id que não resolveu para nome aparece como "não encontrado", não some', () => {
    const filtro = lerFiltro({ gymUnitId: UUID, planId: UUID });

    expect(descreverFiltro(filtro, { unidade: undefined, plano: undefined })).toEqual([
      'Unidade: não encontrada',
      'Plano: não encontrado',
    ]);
  });
});
