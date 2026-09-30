import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { PainelDeCobranca } from './painel-de-cobranca';

/**
 * As Server Actions falam com `chamarApi`, `server-only`. O mock existe so
 * para o modulo carregar em `jsdom` -- mesmo padrao de `editar-cadastro.test.tsx`.
 * O comportamento de QUANTAS faturas sao geradas mora em
 * `abrirCobranca`/`competenciasParaAdiantar`, testado em separado.
 */
vi.mock('../../../../actions/billing', () => ({
  abrirCobranca: vi.fn(() => Promise.resolve({})),
  registrarPagamentoNoBalcao: vi.fn(() => Promise.resolve({})),
  emitirReciboDaInvoice: vi.fn(() => Promise.resolve({ sucesso: { numero: 1 } })),
}));

function renderizar(subscriptionId: string | null = 'sub-1') {
  return render(
    <ToastProvider>
      <PainelDeCobranca subscriptionId={subscriptionId} invoicesEmAberto={[]} />
    </ToastProvider>,
  );
}

describe('PainelDeCobranca -- adiantamento', () => {
  it('o campo de meses comeca em 1, e o botao mostra o rotulo do mes unico', () => {
    renderizar();

    expect(screen.getByLabelText('Meses')).toHaveValue('1');
    expect(screen.getByTestId('gerar-cobranca')).toHaveTextContent('Gerar cobrança do mês');
  });

  it('digitar 3 muda o rotulo do botao para o plural, com o numero', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.clear(screen.getByLabelText('Meses'));
    await usuario.type(screen.getByLabelText('Meses'), '3');

    expect(screen.getByTestId('gerar-cobranca')).toHaveTextContent('Gerar 3 cobranças');
  });

  it('valor nao numerico no campo nao quebra o botao -- volta para o rotulo de 1 mes', async () => {
    const usuario = userEvent.setup();
    renderizar();

    await usuario.clear(screen.getByLabelText('Meses'));

    expect(screen.getByTestId('gerar-cobranca')).toHaveTextContent('Gerar cobrança do mês');
  });

  it('sem assinatura ativa, nao mostra o campo de meses', () => {
    renderizar(null);

    expect(screen.queryByLabelText('Meses')).not.toBeInTheDocument();
  });
});
