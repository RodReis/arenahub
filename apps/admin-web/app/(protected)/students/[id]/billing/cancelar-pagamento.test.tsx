import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@arenahub/ui';

import { cancelarPagamento } from '../../../../actions/billing';
import { CancelarPagamento } from './cancelar-pagamento';

/**
 * F85 -- botao "Cancelar pagamento" da coluna Recebimento.
 *
 * `cancelarPagamento` e Server Action: o componente so precisa provar que a
 * CHAMA com o id e o motivo digitado, e que o resultado vira toast. A rota de
 * rede e teste de integracao/E2E. `HTMLDialogElement.showModal` nao existe no
 * jsdom, entao o `ConfirmDialog` e exercitado pelo conteudo que ele monta.
 */
vi.mock('../../../../actions/billing', () => ({
  cancelarPagamento: vi.fn(),
}));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

function renderizar() {
  return render(
    <ToastProvider>
      <CancelarPagamento paymentId="pag-1" resumo="nov/26, Dinheiro" />
    </ToastProvider>,
  );
}

describe('CancelarPagamento', () => {
  beforeEach(() => {
    vi.mocked(cancelarPagamento).mockReset();
    refresh.mockClear();
    // jsdom nao implementa <dialog>.showModal/close.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('abre o dialogo com o resumo e exige motivo antes de chamar a acao', () => {
    renderizar();

    fireEvent.click(screen.getByTestId('cancelar-pagamento'));

    expect(screen.getByText(/nov\/26, Dinheiro/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirmar-acao-sensivel'));

    expect(cancelarPagamento).not.toHaveBeenCalled();
    expect(screen.getByText(/Escreva o motivo/)).toBeInTheDocument();
  });

  it('chama a acao com o id e o motivo, avisa por toast e recarrega a pagina', async () => {
    vi.mocked(cancelarPagamento).mockResolvedValue({ sucesso: true });
    renderizar();

    fireEvent.click(screen.getByTestId('cancelar-pagamento'));
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'lancei no aluno errado' } });
    fireEvent.click(screen.getByTestId('confirmar-acao-sensivel'));

    await waitFor(() => expect(cancelarPagamento).toHaveBeenCalledWith('pag-1', 'lancei no aluno errado'));
    await waitFor(() => expect(screen.getByTestId('pagamento-cancelado')).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it('mostra o erro da API em toast e NAO recarrega', async () => {
    vi.mocked(cancelarPagamento).mockResolvedValue({ erro: 'Este pagamento não pode ser cancelado.' });
    renderizar();

    fireEvent.click(screen.getByTestId('cancelar-pagamento'));
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'motivo valido' } });
    fireEvent.click(screen.getByTestId('confirmar-acao-sensivel'));

    await waitFor(() => expect(screen.getByTestId('erro-ao-cancelar-pagamento')).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
    // O dialogo continua aberto com o motivo digitado: recusa nao apaga texto.
    expect(screen.getByLabelText(/Motivo/)).toHaveValue('motivo valido');
  });

  it('o icone diz a acao E qual pagamento, para quem usa leitor de tela', () => {
    renderizar();

    expect(screen.getByTestId('cancelar-pagamento')).toHaveAccessibleName('Cancelar pagamento de nov/26, Dinheiro');
  });
});
