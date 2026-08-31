import { describe, expect, it } from '@jest/globals';

import {
  ESTADOS_ATIVOS,
  RESULTADOS_DE_TAREFA,
  type EstadoDeTarefa,
  type TarefaDeRetencao,
  estaAtiva,
  transitar,
} from './tarefa-de-retencao.js';

const tarefa = (parcial: Partial<TarefaDeRetencao> = {}): TarefaDeRetencao => ({
  id: 't1',
  estado: 'ABERTA',
  responsavelId: null,
  resultado: null,
  motivo: null,
  ...parcial,
});

describe('transitar', () => {
  it('atribui uma tarefa aberta', () => {
    const nova = transitar(tarefa(), { tipo: 'ATRIBUIR', responsavelId: 'u1' });

    expect(nova).toMatchObject({ estado: 'ATRIBUIDA', responsavelId: 'u1' });
  });

  it('reatribui uma tarefa ja atribuida', () => {
    const atribuida = tarefa({ estado: 'ATRIBUIDA', responsavelId: 'u1' });

    expect(transitar(atribuida, { tipo: 'ATRIBUIR', responsavelId: 'u2' })).toMatchObject({
      estado: 'ATRIBUIDA',
      responsavelId: 'u2',
    });
  });

  it('inicia o atendimento de uma tarefa atribuida', () => {
    const atribuida = tarefa({ estado: 'ATRIBUIDA', responsavelId: 'u1' });

    expect(transitar(atribuida, { tipo: 'INICIAR' }).estado).toBe('EM_ATENDIMENTO');
  });

  it('recusa iniciar sem responsavel', () => {
    expect(() => transitar(tarefa(), { tipo: 'INICIAR' })).toThrow('TRANSICAO_INVALIDA');
  });

  it('conclui com resultado', () => {
    const emAtendimento = tarefa({ estado: 'EM_ATENDIMENTO', responsavelId: 'u1' });

    expect(
      transitar(emAtendimento, { tipo: 'CONCLUIR', resultado: 'CONTATADO' }),
    ).toMatchObject({ estado: 'CONCLUIDA', resultado: 'CONTATADO' });
  });

  it('recusa concluir sem resultado -- M6-AC-006', () => {
    const emAtendimento = tarefa({ estado: 'EM_ATENDIMENTO', responsavelId: 'u1' });

    expect(() =>
      transitar(emAtendimento, { tipo: 'CONCLUIR', resultado: null as never }),
    ).toThrow('RESULTADO_OBRIGATORIO');
  });

  it('dispensa com motivo', () => {
    expect(
      transitar(tarefa(), { tipo: 'DISPENSAR', motivo: 'Aluno voltou a treinar ontem' }),
    ).toMatchObject({ estado: 'DISPENSADA', motivo: 'Aluno voltou a treinar ontem' });
  });

  it('recusa dispensar sem motivo -- M6-FR-009', () => {
    expect(() => transitar(tarefa(), { tipo: 'DISPENSAR', motivo: '   ' })).toThrow(
      'MOTIVO_OBRIGATORIO',
    );
  });

  it('expira tarefa aberta que estourou o SLA', () => {
    expect(transitar(tarefa(), { tipo: 'EXPIRAR' }).estado).toBe('EXPIRADA');
  });

  it('expira tarefa atribuida mas nao iniciada', () => {
    const atribuida = tarefa({ estado: 'ATRIBUIDA', responsavelId: 'u1' });

    expect(transitar(atribuida, { tipo: 'EXPIRAR' }).estado).toBe('EXPIRADA');
  });

  it('nao expira tarefa em atendimento -- alguem esta com ela na mao', () => {
    const emAtendimento = tarefa({ estado: 'EM_ATENDIMENTO', responsavelId: 'u1' });

    expect(() => transitar(emAtendimento, { tipo: 'EXPIRAR' })).toThrow('TRANSICAO_INVALIDA');
  });

  it.each<EstadoDeTarefa>(['CONCLUIDA', 'DISPENSADA', 'EXPIRADA'])(
    'recusa qualquer transicao a partir de %s -- estado terminal',
    (estado) => {
      const terminal = tarefa({ estado, resultado: 'CONTATADO' });

      expect(() => transitar(terminal, { tipo: 'ATRIBUIR', responsavelId: 'u9' })).toThrow(
        'TRANSICAO_INVALIDA',
      );
    },
  );

  it('nao muta a tarefa recebida', () => {
    const original = tarefa();
    transitar(original, { tipo: 'ATRIBUIR', responsavelId: 'u1' });

    expect(original).toEqual(tarefa());
  });
});

describe('estaAtiva', () => {
  it.each<[EstadoDeTarefa, boolean]>([
    ['ABERTA', true],
    ['ATRIBUIDA', true],
    ['EM_ATENDIMENTO', true],
    ['CONCLUIDA', false],
    ['DISPENSADA', false],
    ['EXPIRADA', false],
  ])('%s esta ativa? %s', (estado, esperado) => {
    expect(estaAtiva(estado)).toBe(esperado);
  });

  it('a lista de ativos bate com o predicado -- e o que o indice parcial usa', () => {
    expect([...ESTADOS_ATIVOS]).toEqual(['ABERTA', 'ATRIBUIDA', 'EM_ATENDIMENTO']);
  });
});

describe('RESULTADOS_DE_TAREFA', () => {
  it('tem lista fechada', () => {
    expect([...RESULTADOS_DE_TAREFA]).toEqual([
      'CONTATADO',
      'SEM_RESPOSTA',
      'CANAL_INDISPONIVEL',
      'RECUSOU',
      'RETORNAR_DEPOIS',
      'RESOLVIDO_DE_OUTRO_MODO',
    ]);
  });
});
