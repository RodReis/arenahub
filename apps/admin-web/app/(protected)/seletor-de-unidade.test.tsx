import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navegacao = vi.hoisted(() => ({ push: vi.fn(), busca: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navegacao.push }),
  usePathname: () => '/operations',
  useSearchParams: () => navegacao.busca,
}));

import { SeletorDeUnidade } from './seletor-de-unidade';

const ARENA = { id: 'u1', name: 'Arena Positiva' };
const CENTRO = { id: 'u2', name: 'Filial Centro' };

describe('seletor de unidade', () => {
  beforeEach(() => {
    navegacao.push.mockClear();
    navegacao.busca = new URLSearchParams();
  });

  it('com uma unidade, vira rótulo -- não há o que escolher', () => {
    render(<SeletorDeUnidade unidades={[ARENA]} vazio="—" />);

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('Arena Positiva');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('sem "todas", nada escolhido mostra o placeholder desabilitado (topbar)', () => {
    render(<SeletorDeUnidade unidades={[ARENA, CENTRO]} vazio="—" />);

    expect(screen.getByRole('option', { name: 'Selecione a unidade' })).toBeDisabled();
  });

  /** Issue #549: no painel de operação, "nenhuma escolhida" é estado real -- todas. */
  it('com "todas", a opção é real e escolhê-la tira a unidade da URL', () => {
    navegacao.busca = new URLSearchParams('unidade=u2&outro=1');
    render(<SeletorDeUnidade unidades={[ARENA, CENTRO]} vazio="—" todas="Todas as unidades" />);

    const select = screen.getByRole('combobox');

    expect(select).toHaveDisplayValue('Filial Centro');

    fireEvent.change(select, { target: { value: '' } });

    expect(navegacao.push).toHaveBeenCalledWith('/operations?outro=1');
  });

  it('escolher uma unidade a põe na URL, preservando o resto', () => {
    navegacao.busca = new URLSearchParams('outro=1');
    render(<SeletorDeUnidade unidades={[ARENA, CENTRO]} vazio="—" todas="Todas as unidades" />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u2' } });

    expect(navegacao.push).toHaveBeenCalledWith('/operations?outro=1&unidade=u2');
  });
});
