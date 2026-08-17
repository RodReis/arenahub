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

  /** Vazio SEM saida e beco -- §9 exige acao de saida. */
  it('carrega a acao de saida quando quem chama oferece uma', () => {
    render(<EmptyState title="Nenhum aluno." action={<a href="/students/novo">Cadastrar</a>} />);

    expect(screen.getByRole('link', { name: 'Cadastrar' })).toHaveAttribute(
      'href',
      '/students/novo',
    );
  });
});
