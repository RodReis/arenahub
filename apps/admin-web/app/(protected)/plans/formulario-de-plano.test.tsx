import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { FormularioDePlano } from './formulario-de-plano';

/**
 * A Server Action fala com `chamarApi`, que e `server-only`. Nenhum teste
 * aqui completa um envio de verdade -- o mock existe so para o modulo
 * carregar em `jsdom` (mesmo padrao de `formulario-de-cadastro.test.tsx`).
 */
vi.mock('../../actions/membership', () => ({
  cadastrarPlano: vi.fn(),
}));

const UNIDADES = [{ id: 'unidade-1', name: 'Unidade Centro' }];

function renderizar() {
  return render(
    <ToastProvider>
      <FormularioDePlano unidades={UNIDADES} />
    </ToastProvider>,
  );
}

/**
 * F53: plano sem preco nao pode existir -- a API recusa com 400 desde o
 * commit f1a8b9b. Sem esta guarda em JS, o operador so descobriria o erro
 * depois do round-trip com o servidor, e o formulario nem tem essa
 * preocupacao antes.
 */
describe('formulario de plano -- preco obrigatorio', () => {
  it('barra o envio sem preco, com aviso visivel', async () => {
    const user = userEvent.setup();
    renderizar();

    await user.type(screen.getByTestId('campo-nome-do-plano'), 'Plano de Teste');
    await user.click(screen.getByTestId('confirmar-plano'));

    expect(await screen.findByText(/informe o preço/i)).toBeInTheDocument();
  });

  it('barra o envio com preco invalido, com aviso visivel', async () => {
    const user = userEvent.setup();
    renderizar();

    await user.type(screen.getByTestId('campo-nome-do-plano'), 'Plano de Teste');
    await user.type(screen.getByTestId('campo-preco-do-plano'), '15,005');
    await user.click(screen.getByTestId('confirmar-plano'));

    expect(await screen.findByText(/preço inválido/i)).toBeInTheDocument();
  });
});
