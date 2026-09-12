import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { FormularioDeLogin } from './formulario-de-login.js';

const renderizar = (onEntrar: (dados: { identificador: string; senha: string }) => Promise<void>) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <FormularioDeLogin onEntrar={onEntrar} onEsqueciSenha={jest.fn()} />
    </ProvedorDeTema>,
  );

describe('FormularioDeLogin', () => {
  it('envia o que foi digitado', async () => {
    const onEntrar = jest.fn(() => Promise.resolve());
    renderizar(onEntrar);

    fireEvent.changeText(screen.getByTestId('campo-identificador'), 'ana@exemplo.test');
    fireEvent.changeText(screen.getByTestId('campo-senha'), 'senha-longa-aqui');
    fireEvent.press(screen.getByTestId('botao-entrar'));

    await waitFor(() =>
      expect(onEntrar).toHaveBeenCalledWith({
        identificador: 'ana@exemplo.test',
        senha: 'senha-longa-aqui',
      }),
    );
  });

  it('NAO envia duas vezes com toque duplo', () => {
    /*
     * Toque duplo em conexao lenta e o caso real; sem trava sao duas
     * tentativas de login e duas sessoes abertas no aparelho.
     *
     * A PROTECAO REAL ESTA NO `Botao`, que se desabilita com `carregando` --
     * um canario mostrou que remover o `if (enviando) return;` do formulario
     * NAO derruba este teste, porque o `fireEvent.press` respeita o
     * `disabled`. A trava do formulario e cinto e suspensorio; o teste
     * abaixo afirma o estado que de fato impede o segundo toque.
     */
    const onEntrar = jest.fn(() => new Promise<void>(() => undefined));
    renderizar(onEntrar);

    fireEvent.press(screen.getByTestId('botao-entrar'));
    fireEvent.press(screen.getByTestId('botao-entrar'));

    expect(onEntrar).toHaveBeenCalledTimes(1);

    const botao = screen.getByTestId('botao-entrar');
    const estado = botao.props as { accessibilityState?: { disabled?: boolean; busy?: boolean } };
    expect(estado.accessibilityState?.disabled).toBe(true);
    expect(estado.accessibilityState?.busy).toBe(true);
  });

  it('mostra a mensagem antienumeracao, nunca "usuario nao encontrado"', async () => {
    /*
     * `M4-FR-002` continua valendo NA TELA. A API responde igual para
     * identificador inexistente e senha errada; traduzir o erro em "usuario
     * nao encontrado" aqui desfaria no cliente a garantia do servidor.
     */
    const onEntrar = jest.fn(() => Promise.reject(new Error('AUTH_INVALID_CREDENTIALS')));
    renderizar(onEntrar);

    fireEvent.press(screen.getByTestId('botao-entrar'));

    expect(await screen.findByText(/não foi possível entrar/i)).toBeTruthy();
    expect(screen.queryByText(/não encontrado|não cadastrado|não existe/i)).toBeNull();
  });

  it('libera o botao depois da falha, para o aluno tentar de novo', async () => {
    const onEntrar = jest.fn(() => Promise.reject(new Error('falhou')));
    renderizar(onEntrar);

    fireEvent.press(screen.getByTestId('botao-entrar'));
    await screen.findByText(/não foi possível entrar/i);

    fireEvent.press(screen.getByTestId('botao-entrar'));
    await waitFor(() => expect(onEntrar).toHaveBeenCalledTimes(2));
  });

  it('o campo de senha esconde o que e digitado', () => {
    const onEntrar = jest.fn(() => Promise.resolve());
    renderizar(onEntrar);

    const campo = screen.getByTestId('campo-senha').props as { secureTextEntry?: boolean };
    expect(campo.secureTextEntry).toBe(true);
  });
});
