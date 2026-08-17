import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('mostra titulo e dica', () => {
    render(
      <EmptyState
        title="Nenhum aluno encontrado com esse termo."
        hint="Confira a grafia ou cadastre um novo aluno."
      />,
    );

    expect(screen.getByText('Nenhum aluno encontrado com esse termo.')).toBeInTheDocument();
    expect(screen.getByText('Confira a grafia ou cadastre um novo aluno.')).toBeInTheDocument();
  });

  it('a dica e opcional', () => {
    render(<EmptyState title="Nenhum aluno cadastrado ainda." />);

    expect(screen.getByText('Nenhum aluno cadastrado ainda.')).toBeInTheDocument();
  });

  /**
   * REGRESSAO: o E2E de alunos faz
   * `getByTestId('sem-alunos')).toContainText(/grafia|cadastre/i)` -- a dica
   * esta DENTRO do elemento marcado, nao ao lado dele. Pendurar o testid so no
   * titulo passaria no teste de unidade e quebraria o E2E.
   */
  it('o testid envolve titulo E dica', () => {
    render(
      <EmptyState
        testId="sem-alunos"
        title="Nenhum aluno encontrado com esse termo."
        hint="Confira a grafia ou cadastre um novo aluno."
      />,
    );

    expect(screen.getByTestId('sem-alunos')).toHaveTextContent(/grafia|cadastre/i);
  });

  /** Vazio SEM saida e beco -- §9 exige acao de saida. */
  it('carrega a acao de saida quando quem chama oferece uma', () => {
    render(<EmptyState title="Nenhum aluno." action={<a href="/students/novo">Cadastrar</a>} />);

    expect(screen.getByRole('link', { name: 'Cadastrar' })).toHaveAttribute(
      'href',
      '/students/novo',
    );
  });
});
