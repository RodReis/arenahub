import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../actions/perfil', () => ({
  alterarSenha: vi.fn(),
}));

import { alterarSenha } from '../../actions/perfil';
import { FormularioDeSenha } from './formulario-de-senha';

async function enviar(): Promise<void> {
  await act(async () => {
    fireEvent.submit(screen.getByTestId('salvar-senha').closest('form') as HTMLFormElement);
    // Deixa a action (promessa) resolver antes de o `act` fechar.
    await Promise.resolve();
  });
}

describe('FormularioDeSenha', () => {
  beforeEach(() => {
    vi.mocked(alterarSenha).mockReset();
  });

  it('o MESMO erro duas vezes avisa duas vezes', async () => {
    // Objeto NOVO a cada envio, como a Server Action real (o retorno cruza a
    // fronteira do servidor serializado). `mockResolvedValue` devolveria a
    // MESMA referencia e esconderia o defeito.
    vi.mocked(alterarSenha).mockImplementation(() =>
      Promise.resolve({ erro: 'Senha atual incorreta.' }),
    );

    render(
      <ToastProvider>
        <FormularioDeSenha />
      </ToastProvider>,
    );

    await enviar();
    expect(screen.getAllByTestId('erro-da-senha')).toHaveLength(1);

    await enviar();
    // Toast nao some sozinho e nao e "evento": se o segundo erro, igual ao
    // primeiro, nao empilhar, quem dispensou o primeiro fica diante de um
    // botao que parece morto.
    expect(screen.getAllByTestId('erro-da-senha')).toHaveLength(2);
  });

  it('o sucesso avisa e limpa os campos', async () => {
    vi.mocked(alterarSenha).mockResolvedValue({ sucesso: 1 });

    render(
      <ToastProvider>
        <FormularioDeSenha />
      </ToastProvider>,
    );

    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'abc' } });
    await enviar();

    expect(screen.getByTestId('senha-trocada')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha atual')).toHaveValue('');
  });
});
