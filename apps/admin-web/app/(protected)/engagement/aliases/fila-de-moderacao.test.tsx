import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../actions/engagement', () => ({
  moderarAlias: vi.fn(),
}));

import { FilaDeModeracao, type ItemDaFila } from './fila-de-moderacao';

const PENDENTE: ItemDaFila = {
  id: 'perfil-1',
  alunoNome: 'Ana Beatriz',
  alias: 'Tigre',
  status: 'PENDING',
  screeningSignals: [],
  rejectionReason: null,
  version: 1,
};

const PENDENTE_COM_SINAL: ItemDaFila = {
  ...PENDENTE,
  id: 'perfil-2',
  screeningSignals: ['PARECE_EMAIL'],
};

function renderizar(itens: readonly ItemDaFila[]) {
  return render(
    <ToastProvider>
      <FilaDeModeracao itens={itens} />
    </ToastProvider>,
  );
}

describe('fila de moderação de apelido', () => {
  it('mostra o alias pedido, o aluno e os sinais da triagem', () => {
    renderizar([PENDENTE_COM_SINAL]);

    expect(screen.getByText('Tigre')).toBeInTheDocument();
    expect(screen.getByText(/parece e-mail/i)).toBeInTheDocument();
  });

  it('rejeitar exige razao categorizada antes de habilitar o botao', async () => {
    renderizar([PENDENTE]);

    await userEvent.click(screen.getByRole('button', { name: /rejeitar/i }));

    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(/motivo/i), 'OFENSIVO');

    expect(screen.getByRole('button', { name: /confirmar/i })).toBeEnabled();
  });

  it('fila vazia mostra estado vazio, nao tabela em branco', () => {
    renderizar([]);

    expect(screen.getByText(/nenhum apelido aguardando/i)).toBeInTheDocument();
  });

  it('o moderador nao pode editar o alias -- so julgar', () => {
    renderizar([PENDENTE]);

    expect(screen.queryByRole('textbox', { name: /apelido/i })).not.toBeInTheDocument();
  });
});
