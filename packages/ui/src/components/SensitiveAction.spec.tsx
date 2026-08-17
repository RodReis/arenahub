import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SensitiveAction } from './SensitiveAction.js';

describe('SensitiveAction', () => {
  it('nao confirma sem motivo -- motivo e OBRIGATORIO', async () => {
    const confirmar = vi.fn();
    render(
      <SensitiveAction
        verb="Revogar biometria"
        summary="A digital facial de Maria será excluída dos leitores."
        onConfirm={confirmar}
        onCancel={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Revogar biometria' }));

    expect(confirmar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/motivo/i);
  });

  it('confirma com o motivo digitado, sem espaco em volta', async () => {
    const confirmar = vi.fn();
    render(
      <SensitiveAction
        verb="Revogar biometria"
        summary="A digital facial de Maria será excluída."
        onConfirm={confirmar}
        onCancel={() => {}}
      />,
    );

    await userEvent.type(screen.getByLabelText(/motivo/i), '  Pedido da titular por telefone  ');
    await userEvent.click(screen.getByRole('button', { name: 'Revogar biometria' }));

    expect(confirmar).toHaveBeenCalledWith('Pedido da titular por telefone');
  });

  it('so espaco nao conta como motivo', async () => {
    const confirmar = vi.fn();
    render(
      <SensitiveAction verb="Revogar" summary="x" onConfirm={confirmar} onCancel={() => {}} />,
    );

    await userEvent.type(screen.getByLabelText(/motivo/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    expect(confirmar).not.toHaveBeenCalled();
  });

  /** DS-PAINEL.md §6: botao destrutivo usa o verbo real, nunca "OK". */
  it('o botao usa o VERBO REAL, nunca "OK" nem "Confirmar"', () => {
    render(
      <SensitiveAction
        verb="Estornar pagamento"
        summary="x"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Estornar pagamento' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
  });

  it('mostra o resumo do efeito antes de agir', () => {
    render(
      <SensitiveAction
        verb="Revogar biometria"
        summary="A digital facial de Maria será excluída dos leitores."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.getByText('A digital facial de Maria será excluída dos leitores.'),
    ).toBeInTheDocument();
  });

  /**
   * §10 item 3: formulario nunca limpa dado em erro recuperavel.
   *
   * Perder o texto digitado por ter esquecido outro campo e a forma mais
   * rapida de fazer alguem desistir de escrever motivo de verdade -- e o
   * motivo e o que transforma a acao em registro auditavel.
   */
  it('nao limpa o motivo em erro recuperavel', async () => {
    render(<SensitiveAction verb="Revogar" summary="x" onConfirm={() => {}} onCancel={() => {}} />);

    const campo = screen.getByLabelText(/motivo/i);

    await userEvent.type(campo, 'Motivo escrito');
    await userEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    expect(campo).toHaveValue('Motivo escrito');
  });

  it('cancelar nao exige motivo -- sair nunca e a acao perigosa', async () => {
    const cancelar = vi.fn();
    render(
      <SensitiveAction verb="Revogar" summary="x" onConfirm={() => {}} onCancel={cancelar} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(cancelar).toHaveBeenCalled();
  });
});
