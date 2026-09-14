import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { mascararTelefone, Perfil, type DadosDoPerfil } from './perfil.js';

const perfil: DadosDoPerfil = {
  asOf: '2026-09-12T12:00:00.000Z',
  nome: 'Rodrigo Reis',
  matricula: 'GYM-2026-00001284',
  nascimento: '1979-03-12',
  email: 'aluno@exemplo.test',
  telefone: null,
  alunoDesde: '2026-01-10T12:00:00.000Z',
  unidade: 'Unidade Centro',
};

const renderizar = (dados: DadosDoPerfil | null = perfil) => {
  const acoes = { onIr: jest.fn(), onSair: jest.fn() };
  render(
    <ProvedorDeTema forcarTema="dark">
      <Perfil perfil={dados} plano="Mensal Fit" versao="0.1.0" {...acoes} />
    </ProvedorDeTema>,
  );
  return acoes;
};

describe('mascararTelefone', () => {
  it('celular e fixo brasileiros, com ou sem DDI', () => {
    expect(mascararTelefone('11987654321')).toBe('(11) 98765-4321');
    expect(mascararTelefone('+55 11 3456-7890')).toBe('(11) 3456-7890');
  });

  it('formato desconhecido aparece como veio', () => {
    expect(mascararTelefone('123')).toBe('123');
  });
});

describe('Perfil', () => {
  it('mostra identidade, matricula e dados do cadastro', () => {
    renderizar();
    expect(screen.getAllByText('Rodrigo Reis').length).toBeGreaterThan(0);
    expect(screen.getByTestId('perfil-matricula')).toHaveTextContent('GYM-2026-00001284');
    expect(screen.getByText('12/03/1979')).toBeTruthy();
    expect(screen.getByText('jan/2026')).toBeTruthy();
  });

  it('contato nao cadastrado aparece como ausencia', () => {
    renderizar();
    expect(screen.getByLabelText('Telefone não cadastrado')).toBeTruthy();
  });

  it('nao oferece WhatsApp nem edicao de cadastro -- nao ha para onde levar', () => {
    renderizar();
    expect(screen.queryByText(/whatsapp|editar dados/i)).toBeNull();
  });

  it('as funcoes que ja existiam continuam alcancaveis', () => {
    const acoes = renderizar();
    fireEvent.press(screen.getByTestId('perfil-ir-consentimentos'));
    fireEvent.press(screen.getByTestId('perfil-ir-exportar-dados'));
    expect(acoes.onIr).toHaveBeenCalledWith('consentimentos');
    expect(acoes.onIr).toHaveBeenCalledWith('exportar-dados');
  });

  it('cadastro indisponivel nao some com a saida da conta', () => {
    const acoes = renderizar(null);
    expect(screen.getByTestId('perfil-indisponivel')).toBeTruthy();
    fireEvent.press(screen.getByTestId('botao-sair'));
    expect(acoes.onSair).toHaveBeenCalled();
  });
});
