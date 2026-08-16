import { describe, expect, it } from '@jest/globals';

import {
  alunoRecebeAcessoNormal,
  TRANSICOES_DE_ALUNO,
  transicionarAluno,
  TransicaoDeAlunoInvalidaError,
  type StatusDeAluno,
} from './student.js';

const TODOS: StatusDeAluno[] = [
  'LEAD',
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
];

describe('transicionarAluno', () => {
  it('aceita toda transicao declarada na tabela', () => {
    for (const atual of TODOS) {
      for (const alvo of TRANSICOES_DE_ALUNO[atual]) {
        expect(transicionarAluno(atual, alvo)).toBe(alvo);
      }
    }
  });

  /**
   * O complemento do teste acima: tudo que NAO esta na tabela precisa
   * falhar. Sem este, um `default: allow` acidental passaria despercebido --
   * o teste de cima continuaria verde.
   */
  it('recusa toda transicao ausente da tabela, com codigo estavel', () => {
    for (const atual of TODOS) {
      const permitidos = TRANSICOES_DE_ALUNO[atual];

      for (const alvo of TODOS.filter((s) => !permitidos.has(s))) {
        expect(() => transicionarAluno(atual, alvo)).toThrow(TransicaoDeAlunoInvalidaError);

        try {
          transicionarAluno(atual, alvo);
          throw new Error('deveria ter lancado');
        } catch (erro) {
          expect(erro).toBeInstanceOf(TransicaoDeAlunoInvalidaError);
          expect((erro as TransicaoDeAlunoInvalidaError).code).toBe(
            'STUDENT_INVALID_TRANSITION',
          );
          expect((erro as TransicaoDeAlunoInvalidaError).status).toBe(409);
        }
      }
    }
  });

  it('recusa auto-transicao: mudar para o proprio estado nao e mudanca', () => {
    for (const status of TODOS) {
      expect(() => transicionarAluno(status, status)).toThrow(TransicaoDeAlunoInvalidaError);
    }
  });

  /** INV-013: arquivar preserva historico e nao tem volta. */
  it('trata ARCHIVED como terminal', () => {
    expect(TRANSICOES_DE_ALUNO.ARCHIVED.size).toBe(0);

    for (const alvo of TODOS) {
      expect(() => transicionarAluno('ARCHIVED', alvo)).toThrow(TransicaoDeAlunoInvalidaError);
    }
  });

  it('permite chegar em ARCHIVED de qualquer estado nao terminal', () => {
    for (const atual of TODOS.filter((s) => s !== 'ARCHIVED')) {
      expect(transicionarAluno(atual, 'ARCHIVED')).toBe('ARCHIVED');
    }
  });
});

describe('alunoRecebeAcessoNormal', () => {
  /**
   * INV-033 e `M1-BR-002` listam exatamente tres estados sem acesso normal.
   * O teste fixa a lista para que ninguem a amplie sem passar por aqui --
   * incluir `SUSPENDED`, por exemplo, negaria acesso a quem os documentos
   * nao mandam negar.
   */
  it('nega acesso normal a BLOCKED, CANCELLED e ARCHIVED, e a mais ninguem', () => {
    expect(alunoRecebeAcessoNormal('BLOCKED')).toBe(false);
    expect(alunoRecebeAcessoNormal('CANCELLED')).toBe(false);
    expect(alunoRecebeAcessoNormal('ARCHIVED')).toBe(false);

    expect(alunoRecebeAcessoNormal('LEAD')).toBe(true);
    expect(alunoRecebeAcessoNormal('TRIAL')).toBe(true);
    expect(alunoRecebeAcessoNormal('ACTIVE')).toBe(true);
    expect(alunoRecebeAcessoNormal('SUSPENDED')).toBe(true);
  });
});
