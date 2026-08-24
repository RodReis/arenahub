import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { AcaoDeAtivacao } from './acao-de-ativacao';

vi.mock('../../actions/membership', () => ({
  alterarAtivacaoDePlano: vi.fn(),
}));

const PLANO_ID = '11111111-1111-4111-8111-111111111111';

function renderizar(isActive: boolean) {
  return render(
    <ToastProvider>
      <AcaoDeAtivacao planId={PLANO_ID} nomeDoPlano="Plano Mensal" isActive={isActive} />
    </ToastProvider>,
  );
}

describe('AcaoDeAtivacao', () => {
  /**
   * O VALOR ENVIADO E O DESTINO, nao o estado atual.
   *
   * Mandar o estado atual inverteria a acao: o botao "Desativar" reativaria
   * o plano, e o toast diria o oposto do que aconteceu. E o tipo de erro que
   * passa despercebido porque a tela responde algo -- so o dado fica errado.
   */
  it('o botao Desativar manda isActive=false', () => {
    const { container } = renderizar(true);

    expect(screen.getByTestId('confirmar-desativacao')).toHaveTextContent('Desativar');
    expect(container.querySelector('input[name="isActive"]')).toHaveValue('false');
  });

  it('o botao Reativar manda isActive=true', () => {
    const { container } = renderizar(false);

    expect(screen.getByTestId('confirmar-reativacao')).toHaveTextContent('Reativar');
    expect(container.querySelector('input[name="isActive"]')).toHaveValue('true');
  });

  /**
   * DESTRUCTIVE SO PARA DESATIVAR: reativar devolve o plano a lista de
   * escolha e nao tira acesso de ninguem. Pintar as duas de vermelho
   * ensinaria que ambas sao perigosas, e a recepcao hesitaria na inofensiva.
   */
  it('so a desativacao usa a variante destrutiva', () => {
    const { unmount } = renderizar(true);

    expect(screen.getByTestId('confirmar-desativacao')).toHaveAttribute(
      'data-variant',
      'destructive',
    );

    unmount();
    renderizar(false);

    expect(screen.getByTestId('confirmar-reativacao')).not.toHaveAttribute(
      'data-variant',
      'destructive',
    );
  });

  it('leva o id do plano no formulario', () => {
    const { container } = renderizar(true);

    expect(container.querySelector('input[name="planId"]')).toHaveValue(PLANO_ID);
  });
});
