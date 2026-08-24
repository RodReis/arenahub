import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { EditarCadastro } from './editar-cadastro';

/**
 * A Server Action fala com `chamarApi`, que e `server-only`. Nenhum teste
 * aqui completa um envio de verdade -- o mock existe so para o modulo
 * carregar em `jsdom` (mesmo padrao de `formulario-de-cadastro.test.tsx`).
 */
vi.mock('../../../actions/students', () => ({
  editarAluno: vi.fn(),
}));

const CONTATO_BASE = { isPrimary: false, label: null, relationship: null };

const PADRAO = {
  studentId: '11111111-1111-1111-1111-111111111111',
  version: 3,
  fullName: 'Paulo Victor Ribeiro de Barros',
  birthDate: '1999-07-15T00:00:00.000Z',
  cpf: '05047398161',
  rg: null,
  registeredSex: null,
  contacts: [],
  address: null,
};

function renderizar(props: Partial<Parameters<typeof EditarCadastro>[0]> = {}) {
  return render(
    <ToastProvider>
      <EditarCadastro {...PADRAO} {...props} />
    </ToastProvider>,
  );
}

describe('EditarCadastro', () => {
  it('comeca fechado, mostrando so o botao de abrir', () => {
    renderizar();

    expect(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`)).toBeInTheDocument();
    expect(screen.queryByTestId('campo-edicao-nome')).not.toBeInTheDocument();
  });

  it('abre o formulario preenchido com o que veio da API', async () => {
    const usuario = userEvent.setup();

    renderizar({
      contacts: [{ ...CONTATO_BASE, type: 'PHONE', value: '62988887777', isPrimary: true }],
    });

    await usuario.click(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`));

    expect(screen.getByTestId('campo-edicao-nome')).toHaveValue(PADRAO.fullName);
    expect(screen.getByTestId('campo-edicao-telefone')).toHaveValue('62988887777');
  });

  /**
   * A DATA CHEGA ISO COMPLETA e o `<input type="date">` so aceita
   * `YYYY-MM-DD`. Sem o corte, o campo renderiza VAZIO -- e ai salvar apaga a
   * data de nascimento de quem so queria corrigir o telefone.
   */
  it('corta o instante ISO para o formato que o campo de data aceita', async () => {
    const usuario = userEvent.setup();

    renderizar();

    await usuario.click(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`));

    expect(screen.getByTestId('campo-edicao-nascimento')).toHaveValue('1999-07-15');
  });

  /**
   * A GUARDA QUE IMPEDE PERDA DE DADO.
   *
   * `contacts` SUBSTITUI a lista inteira no PATCH, e esta ficha edita um
   * campo por tipo. Aluno com dois telefones tem o segundo invisivel aqui;
   * oferecer o formulario assim faria "corrigir o e-mail" apagar um telefone
   * que ninguem viu sumir. Sem esta guarda o teste passa e o dado some.
   */
  it('nao oferece edicao de contato quando o aluno tem dois do mesmo tipo', async () => {
    const usuario = userEvent.setup();

    renderizar({
      contacts: [
        { ...CONTATO_BASE, type: 'PHONE', value: '62988887777', isPrimary: true },
        { ...CONTATO_BASE, type: 'PHONE', value: '62977776666' },
      ],
    });

    await usuario.click(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`));

    expect(screen.getByTestId('contatos-nao-editaveis')).toBeInTheDocument();
    expect(screen.queryByTestId('campo-edicao-telefone')).not.toBeInTheDocument();
    // O resto do cadastro continua editavel: a restricao e dos contatos.
    expect(screen.getByTestId('campo-edicao-nome')).toBeInTheDocument();
  });

  it('edita contatos quando ha no maximo um de cada tipo', async () => {
    const usuario = userEvent.setup();

    renderizar({
      contacts: [
        { ...CONTATO_BASE, type: 'PHONE', value: '62988887777', isPrimary: true },
        { ...CONTATO_BASE, type: 'EMAIL', value: 'paulo@exemplo.com' },
        {
          ...CONTATO_BASE,
          type: 'EMERGENCY',
          value: '62966665555',
          label: 'Maria',
          relationship: 'mãe',
        },
      ],
    });

    await usuario.click(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`));

    expect(screen.queryByTestId('contatos-nao-editaveis')).not.toBeInTheDocument();
    expect(screen.getByTestId('campo-edicao-email')).toHaveValue('paulo@exemplo.com');
    expect(screen.getByTestId('campo-edicao-emergencia-nome')).toHaveValue('Maria');
    expect(screen.getByTestId('campo-edicao-emergencia-parentesco')).toHaveValue('mãe');
  });

  /**
   * `version` viaja no corpo e e o controle otimista. Se ela nao for para o
   * formulario, o PATCH vai sem versao e a API recusa tudo.
   */
  it('leva a versao do aluno no formulario', async () => {
    const usuario = userEvent.setup();

    const { container } = renderizar({ version: 7 });

    await usuario.click(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`));

    const campo = container.querySelector('input[name="version"]');
    expect(campo).toHaveValue('7');
  });
});
