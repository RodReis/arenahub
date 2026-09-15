import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { FormularioDePrimeiroAcesso, type AtivacaoEncontrada } from './formulario-de-primeiro-acesso.js';

const ENCONTRADO: AtivacaoEncontrada = {
  nomeCompleto: 'Ana Souza',
  cpfFormatado: '111.444.777-35',
  dataNascimento: '2000-05-10',
  plano: 'Mensal Fit',
  local: 'Unidade Centro',
  dataInicio: '2026-01-05',
  activationRef: 'activation-ref-opaco',
};

const renderizar = (
  onConsultar: (dados: { cpf: string; dataNascimento: string }) => Promise<AtivacaoEncontrada>,
  onCriarSenha: (dados: {
    activationRef: string;
    senha: string;
    confirmacaoSenha: string;
  }) => Promise<void> = () => Promise.resolve(),
) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <FormularioDePrimeiroAcesso onConsultar={onConsultar} onCriarSenha={onCriarSenha} />
    </ProvedorDeTema>,
  );

const preencherConsulta = () => {
  fireEvent.changeText(screen.getByTestId('campo-cpf-primeiro-acesso'), '11144477735');
  fireEvent.changeText(screen.getByTestId('campo-nascimento-primeiro-acesso'), '10052000');
};

describe('FormularioDePrimeiroAcesso', () => {
  it('consulta com CPF sem mascara e data em ISO', async () => {
    const onConsultar = jest.fn(() => Promise.resolve(ENCONTRADO));
    renderizar(onConsultar);

    preencherConsulta();
    fireEvent.press(screen.getByTestId('botao-consultar-primeiro-acesso'));

    await waitFor(() =>
      expect(onConsultar).toHaveBeenCalledWith({ cpf: '11144477735', dataNascimento: '2000-05-10' }),
    );
  });

  it('mostra o selo, o nome e os 5 campos da tela de confirmacao quando encontra o aluno', async () => {
    const onConsultar = jest.fn(() => Promise.resolve(ENCONTRADO));
    renderizar(onConsultar);

    preencherConsulta();
    fireEvent.press(screen.getByTestId('botao-consultar-primeiro-acesso'));

    expect(await screen.findByText('Cadastro encontrado')).toBeTruthy();
    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getByText('111.444.777-35')).toBeTruthy();
    expect(screen.getByText('10/05/2000')).toBeTruthy();
    expect(screen.getByText('Mensal Fit')).toBeTruthy();
    expect(screen.getByText('Unidade Centro')).toBeTruthy();
    expect(screen.getByText('05/01/2026')).toBeTruthy();
    expect(screen.getByTestId('campo-nova-senha')).toBeTruthy();
  });

  it('nao encontrado mostra mensagem unica pedindo para procurar a administracao', async () => {
    const onConsultar = jest.fn(() => Promise.reject(new Error('AUTH_INVALID_CREDENTIALS')));
    renderizar(onConsultar);

    preencherConsulta();
    fireEvent.press(screen.getByTestId('botao-consultar-primeiro-acesso'));

    expect(await screen.findByText(/procure a administração/i)).toBeTruthy();
    expect(screen.queryByTestId('campo-nova-senha')).toBeNull();
  });

  it('recusa senha curta antes de chamar onCriarSenha', async () => {
    const onConsultar = jest.fn(() => Promise.resolve(ENCONTRADO));
    const onCriarSenha = jest.fn(() => Promise.resolve());
    renderizar(onConsultar, onCriarSenha);

    preencherConsulta();
    fireEvent.press(screen.getByTestId('botao-consultar-primeiro-acesso'));
    await screen.findByTestId('campo-nova-senha');

    fireEvent.changeText(screen.getByTestId('campo-nova-senha'), 'curta');
    fireEvent.changeText(screen.getByTestId('campo-confirmacao-senha'), 'curta');
    fireEvent.press(screen.getByTestId('botao-criar-senha'));

    expect(await screen.findByText(/pelo menos 10 caracteres/i)).toBeTruthy();
    expect(onCriarSenha).not.toHaveBeenCalled();
  });

  it('recusa senhas diferentes antes de chamar onCriarSenha', async () => {
    const onConsultar = jest.fn(() => Promise.resolve(ENCONTRADO));
    const onCriarSenha = jest.fn(() => Promise.resolve());
    renderizar(onConsultar, onCriarSenha);

    preencherConsulta();
    fireEvent.press(screen.getByTestId('botao-consultar-primeiro-acesso'));
    await screen.findByTestId('campo-nova-senha');

    fireEvent.changeText(screen.getByTestId('campo-nova-senha'), 'senha-forte-123');
    fireEvent.changeText(screen.getByTestId('campo-confirmacao-senha'), 'outra-senha-456');
    fireEvent.press(screen.getByTestId('botao-criar-senha'));

    expect(await screen.findByText(/não são iguais/i)).toBeTruthy();
    expect(onCriarSenha).not.toHaveBeenCalled();
  });

  it('cria a senha com o activationRef da consulta quando tudo confere', async () => {
    const onConsultar = jest.fn(() => Promise.resolve(ENCONTRADO));
    const onCriarSenha = jest.fn(() => Promise.resolve());
    renderizar(onConsultar, onCriarSenha);

    preencherConsulta();
    fireEvent.press(screen.getByTestId('botao-consultar-primeiro-acesso'));
    await screen.findByTestId('campo-nova-senha');

    fireEvent.changeText(screen.getByTestId('campo-nova-senha'), 'senha-forte-123');
    fireEvent.changeText(screen.getByTestId('campo-confirmacao-senha'), 'senha-forte-123');
    fireEvent.press(screen.getByTestId('botao-criar-senha'));

    await waitFor(() =>
      expect(onCriarSenha).toHaveBeenCalledWith({
        activationRef: 'activation-ref-opaco',
        senha: 'senha-forte-123',
        confirmacaoSenha: 'senha-forte-123',
      }),
    );
  });
});
