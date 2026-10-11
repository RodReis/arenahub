import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/students',
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('status=ACTIVE&cursor=abc'),
}));

import { FiltroDoRelatorio } from './filtro-do-relatorio';

const UNIDADES = [
  { id: 'u1', name: 'Matriz' },
  { id: 'u2', name: 'Filial' },
];
const PLANOS = [{ id: 'p1', name: 'Mensal Fit' }];

const props = {
  unidades: UNIDADES,
  planos: PLANOS,
  valores: { gymUnitId: '', status: 'ACTIVE', profile: '', planId: '', financeiro: '' },
};

describe('FiltroDoRelatorio', () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it('mostra os cinco filtros com rótulo acessível', () => {
    render(<FiltroDoRelatorio {...props} />);

    for (const rotulo of ['Unidade', 'Situação', 'Perfil', 'Plano', 'Financeiro']) {
      expect(screen.getByLabelText(rotulo)).toBeTruthy();
    }
  });

  it('trocar um filtro escreve na URL, mantém os outros e LIMPA o cursor', () => {
    render(<FiltroDoRelatorio {...props} />);

    fireEvent.change(screen.getByLabelText('Financeiro'), { target: { value: 'INADIMPLENTES' } });

    expect(replace).toHaveBeenCalledWith('/reports/students?status=ACTIVE&financeiro=INADIMPLENTES', {
      scroll: false,
    });
  });

  it('voltar a "Todos" remove a chave da URL', () => {
    render(<FiltroDoRelatorio {...props} />);

    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: '' } });

    expect(replace).toHaveBeenCalledWith('/reports/students', { scroll: false });
  });

  it('com uma unidade só, o filtro de unidade não aparece (nada para separar)', () => {
    render(<FiltroDoRelatorio {...props} unidades={[UNIDADES[0]!]} />);

    expect(screen.queryByLabelText('Unidade')).toBeNull();
  });

  it('sem planos (sem plan.read), o filtro de plano não aparece', () => {
    render(<FiltroDoRelatorio {...props} planos={[]} />);

    expect(screen.queryByLabelText('Plano')).toBeNull();
  });

  it('financeiro oferece Todos, Inadimplentes e Pagantes', () => {
    render(<FiltroDoRelatorio {...props} />);

    const opcoes = [...screen.getByLabelText('Financeiro').querySelectorAll('option')].map(
      (o) => o.textContent,
    );

    expect(opcoes).toEqual(['Todos', 'Inadimplentes', 'Pagantes']);
  });
});
