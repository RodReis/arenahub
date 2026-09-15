import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { FormularioDeLogin } from './formulario-de-login.js';

const renderizar = (onEntrar: (dados: { cpf: string; senha: string }) => Promise<void>) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <FormularioDeLogin
        onEntrar={onEntrar}
        onEsqueciSenha={jest.fn()}
        onPrimeiroAcesso={jest.fn()}
      />
    </ProvedorDeTema>,
  );

describe('FormularioDeLogin', () => {
  it('envia o CPF SEM MASCARA -- ADR-057', async () => {
    const onEntrar = jest.fn(() => Promise.resolve());
    renderizar(onEntrar);

    fireEvent.changeText(screen.getByTestId('campo-identificador'), '11144477735');
    fireEvent.changeText(screen.getByTestId('campo-senha'), 'senha-longa-aqui');
    fireEvent.press(screen.getByTestId('botao-entrar'));

    await waitFor(() =>
      expect(onEntrar).toHaveBeenCalledWith({
        cpf: '11144477735',
        senha: 'senha-longa-aqui',
      }),
    );
  });

  it('mascara o CPF enquanto o aluno digita', () => {
    const onEntrar = jest.fn(() => Promise.resolve());
    renderizar(onEntrar);

    fireEvent.changeText(screen.getByTestId('campo-identificador'), '11144477735');

    const campo = screen.getByTestId('campo-identificador').props as { value?: string };
    expect(campo.value).toBe('111.444.777-35');
  });

  it('abre o primeiro acesso ao tocar no link', () => {
    const onPrimeiroAcesso = jest.fn();
    render(
      <ProvedorDeTema forcarTema="dark">
        <FormularioDeLogin
          onEntrar={() => Promise.resolve()}
          onEsqueciSenha={jest.fn()}
          onPrimeiroAcesso={onPrimeiroAcesso}
        />
      </ProvedorDeTema>,
    );

    fireEvent.press(screen.getByTestId('botao-primeiro-acesso'));

    expect(onPrimeiroAcesso).toHaveBeenCalledTimes(1);
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
