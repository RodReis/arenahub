import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../actions/usuarios', () => ({
  aceitarConvite: vi.fn(),
}));

import { aceitarConvite } from '../../../actions/usuarios';
import { FormularioDeAceite } from './formulario-de-aceite';

function renderizar() {
  return render(
    <ToastProvider>
      <FormularioDeAceite token="token-de-teste" />
    </ToastProvider>,
  );
}

describe('formulario de aceite de convite', () => {
  beforeEach(() => {
    vi.mocked(aceitarConvite).mockReset();
  });

  /**
   * O BUG QUE ESTE TESTE EXISTE PARA PEGAR (04/09/2026).
   *
   * Os campos nasceram NÃO CONTROLADOS, copiando o formulário de login ao
   * lado. Toda volta da action remonta os campos, e input não controlado
   * perde o valor: errar a confirmação apagava AS DUAS senhas, e a pessoa
   * tinha de redigitar 12+ caracteres duas vezes.
   *
   * No login isso é a escolha certa -- o e-mail volta pelo `defaultValue` e a
   * senha some por segurança. Aqui os dois campos são senha, e não há e-mail
   * para voltar.
   *
   * OS 512 TESTES UNITÁRIOS PASSAVAM. Nenhum montava o componente e enviava
   * duas vezes; foi visto abrindo a tela, digitando e clicando.
   */
  it('preserva as duas senhas depois de um erro', async () => {
    vi.mocked(aceitarConvite).mockResolvedValue({ erro: 'As senhas não conferem' });

    const usuario = userEvent.setup();
    renderizar();

    const senha = screen.getByLabelText('Nova senha');
    const confirmacao = screen.getByLabelText('Repita a senha');

    await usuario.type(senha, 'senha-longa-de-teste');
    await usuario.type(confirmacao, 'senha-diferente-aqui');
    await usuario.click(screen.getByRole('button', { name: /criar senha/i }));

    await waitFor(() => {
      expect(aceitarConvite).toHaveBeenCalled();
    });

    // O QUE FOI DIGITADO CONTINUA NA TELA. Vazio aqui é o bug de volta.
    await waitFor(() => {
      expect(senha).toHaveValue('senha-longa-de-teste');
      expect(confirmacao).toHaveValue('senha-diferente-aqui');
    });
  });

  /**
   * NÃO REDIRECIONA SOZINHO: a conta nasce sem sessão (a API devolve `{}` sem
   * cookie) e com MFA pendente. Jogar a pessoa direto no login a faria
   * digitar a senha recém-criada sem entender que deu certo.
   */
  it('confirma o sucesso e oferece o caminho para entrar', async () => {
    vi.mocked(aceitarConvite).mockResolvedValue({ sucesso: true });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText('Nova senha'), 'senha-longa-de-teste');
    await usuario.type(screen.getByLabelText('Repita a senha'), 'senha-longa-de-teste');
    await usuario.click(screen.getByRole('button', { name: /criar senha/i }));

    await waitFor(() => {
      expect(screen.getByTestId('aceite-concluido')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
  });

  /**
   * O TOKEN VIAJA NO CORPO, e não pelo caminho da rota: a action lê o
   * `FormData`, e sem este campo o aceite chegaria à API sem token e seria
   * recusado como convite inválido -- erro que apontaria para o convite, não
   * para a tela.
   */
  it('manda o token do convite no formulario', async () => {
    vi.mocked(aceitarConvite).mockResolvedValue({ sucesso: true });

    const usuario = userEvent.setup();
    renderizar();

    await usuario.type(screen.getByLabelText('Nova senha'), 'senha-longa-de-teste');
    await usuario.type(screen.getByLabelText('Repita a senha'), 'senha-longa-de-teste');
    await usuario.click(screen.getByRole('button', { name: /criar senha/i }));

    await waitFor(() => {
      expect(aceitarConvite).toHaveBeenCalled();
    });

    const enviado = vi.mocked(aceitarConvite).mock.calls[0]?.[1];
    expect(enviado?.get('token')).toBe('token-de-teste');
  });
});
