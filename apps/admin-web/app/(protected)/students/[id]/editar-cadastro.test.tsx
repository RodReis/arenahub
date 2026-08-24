import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

/**
 * `jsdom` NAO implementa `showModal`/`close` do `<dialog>`.
 *
 * Sem estes dublês o teste estoura com "showModal is not a function" -- e o
 * que se perderia nao e cobertura de comportamento, e sim a capacidade de
 * testar qualquer coisa dentro do modal. O `open` e alternado a mao porque e
 * dele que o `hidden` do conteudo depende.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function abrir(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function fechar(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

const CONTATO_BASE = { isPrimary: false, label: null, relationship: null };

const PADRAO = {
  studentId: '11111111-1111-4111-8111-111111111111',
  nomeDoAluno: 'Paulo Victor Ribeiro de Barros',
  version: 3,
  fullName: 'Paulo Victor Ribeiro de Barros',
  // A API devolve data PURA -- `birthDate` e `@db.Date` e o controller corta
  // o instante antes de responder.
  birthDate: '1999-07-16',
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

async function abrir(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`));
}

describe('EditarCadastro', () => {
  it('comeca fechado, mostrando so o botao de abrir', () => {
    renderizar();

    expect(screen.getByTestId(`abrir-edicao-${PADRAO.studentId}`)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
  });

  it('abre o modal preenchido com o que veio da API', async () => {
    const usuario = userEvent.setup();

    renderizar({
      contacts: [{ ...CONTATO_BASE, type: 'PHONE', value: '62988887777', isPrimary: true }],
    });

    await abrir(usuario);

    expect(screen.getByTestId('campo-edicao-nome')).toHaveValue(PADRAO.fullName);
    expect(screen.getByTestId('campo-edicao-telefone')).toHaveValue('62988887777');
  });

  /**
   * A DATA NAO PODE ANDAR UM DIA.
   *
   * O PI viu 15/07 na ficha e 16/07 aqui (24/08/2026): a ficha reinterpretava
   * a data pura como instante e convertia fuso. Agora a API manda
   * `YYYY-MM-DD` e as duas telas leem o MESMO dia -- salvar daqui grava o que
   * a ficha mostra.
   */
  it('mostra a data de nascimento exatamente como a API a devolve', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    expect(screen.getByTestId('campo-edicao-nascimento')).toHaveValue('1999-07-16');
  });

  /**
   * ABA ESCONDE, NAO DESMONTA.
   *
   * Um `<input>` desmontado nao entra no `FormData`: salvar da aba "Contato"
   * apagaria endereco e identificacao inteiros. Por isso os campos das outras
   * abas seguem no DOM, apenas escondidos -- e este teste e o que impede
   * alguem de "otimizar" trocando por renderizacao condicional.
   */
  it('mantem os campos das outras abas montados, apenas escondidos', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    // Aba de identificacao aberta; os campos de endereco existem no DOM.
    const cep = screen.getByTestId('campo-edicao-cep');
    expect(cep).toBeInTheDocument();

    // E continuam la depois de trocar de aba.
    await usuario.click(screen.getByTestId('aba-endereco'));
    expect(screen.getByTestId('campo-edicao-nome')).toBeInTheDocument();
  });

  it('troca de aba pelo tablist', async () => {
    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);

    const abaContato = screen.getByTestId('aba-contato');
    expect(abaContato).toHaveAttribute('aria-selected', 'false');

    await usuario.click(abaContato);

    expect(abaContato).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * A GUARDA QUE IMPEDE PERDA DE DADO.
   *
   * `contacts` SUBSTITUI a lista inteira no PATCH, e esta tela edita um campo
   * por tipo. Aluno com dois telefones tem o segundo invisivel aqui;
   * oferecer o formulario assim faria "corrigir o e-mail" apagar um telefone
   * que ninguem viu sumir.
   */
  it('nao oferece edicao de contato quando o aluno tem dois do mesmo tipo', async () => {
    const usuario = userEvent.setup();

    renderizar({
      contacts: [
        { ...CONTATO_BASE, type: 'PHONE', value: '62988887777', isPrimary: true },
        { ...CONTATO_BASE, type: 'PHONE', value: '62977776666' },
      ],
    });

    await abrir(usuario);
    await usuario.click(screen.getByTestId('aba-contato'));

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

    await abrir(usuario);
    await usuario.click(screen.getByTestId('aba-contato'));

    expect(screen.queryByTestId('contatos-nao-editaveis')).not.toBeInTheDocument();
    expect(screen.getByTestId('campo-edicao-email')).toHaveValue('paulo@exemplo.com');
    expect(screen.getByTestId('campo-edicao-emergencia-nome')).toHaveValue('Maria');
  });

  /**
   * SALVOU TEM DE AVISAR.
   *
   * O modal fecha sozinho no sucesso, e sem toast a recepcao ficava sem
   * confirmacao nenhuma -- a tela voltava ao normal, indistinguivel de um
   * "Cancelar". Reportado pelo PI em 24/08/2026: "fiz alteracao no aluno e
   * nao teve toast de sucesso".
   *
   * O estado de sucesso chega pelo `useActionState`, entao o teste renderiza
   * o componente com a action ja mockada devolvendo sucesso.
   */
  it('avisa por toast quando o cadastro e salvo', async () => {
    const { editarAluno } = await import('../../../actions/students');
    vi.mocked(editarAluno).mockResolvedValue({ sucesso: { version: 4 } });

    const usuario = userEvent.setup();

    renderizar();
    await abrir(usuario);
    await usuario.click(screen.getByTestId('confirmar-edicao'));

    expect(await screen.findByTestId(`sucesso-da-edicao-${PADRAO.studentId}`)).toHaveTextContent(
      'Cadastro atualizado.',
    );
  });

  /**
   * `version` viaja no corpo e e o controle otimista. Se ela nao for para o
   * formulario, o PATCH vai sem versao e a API recusa tudo.
   */
  it('leva a versao do aluno no formulario', async () => {
    const usuario = userEvent.setup();

    const { container } = renderizar({ version: 7 });
    await abrir(usuario);

    expect(container.querySelector('input[name="version"]')).toHaveValue('7');
  });
});
