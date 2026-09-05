import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDeUsuarios from './page';

const USUARIO = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'douglas@arenapositiva.com',
  status: 'ACTIVE',
  mfaStatus: 'PENDING',
};

const PAPEL = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'OWNER',
  isSystem: true,
};

function ok<T>(dados: T) {
  return { ok: true, dados, cookiesDaApi: [] };
}

function recusado() {
  return {
    ok: false,
    erro: {
      type: 'about:blank',
      title: 'Sem permissao',
      status: 403,
      code: 'FORBIDDEN',
      correlationId: 'teste',
    },
    cookiesDaApi: [],
  };
}

/**
 * A pagina dispara DUAS consultas em `Promise.all`: usuarios e papeis, nesta
 * ordem. O dublê responde por caminho e não por ordem de chamada -- amarrar
 * na ordem faria o teste quebrar no dia em que alguém trocar as duas linhas,
 * sem que nada tenha regredido.
 */
function responder(porCaminho: Record<string, unknown>) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    const resposta = porCaminho[caminho];

    if (resposta === undefined) throw new Error(`sem dublê para ${caminho}`);

    return Promise.resolve(resposta as never);
  });
}

async function renderizar() {
  const elemento = await PaginaDeUsuarios();

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

/**
 * `jsdom` NÃO implementa `showModal`/`close` do `<dialog>`. Sem estes dublês o
 * teste estoura com "showModal is not a function" -- o `open` é alternado à
 * mão porque é dele que a visibilidade do conteúdo depende.
 *
 * Mesmo dublê que `plans/acao-de-reajuste.test.tsx` e `plans/editar-plano.test.tsx`
 * já carregam; repetido pela terceira vez em vez de extraído porque promovê-lo
 * a `vitest.setup.ts` mudaria o ambiente de 57 arquivos de teste por causa de
 * um -- e essa é decisão de outro card, não desta fatia.
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

describe('pagina de usuarios', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('lista quem tem acesso ao painel', async () => {
    responder({
      '/api/v1/users': ok([USUARIO]),
      '/api/v1/roles': ok([PAPEL]),
    });

    await renderizar();

    expect(screen.getByText('douglas@arenapositiva.com')).toBeInTheDocument();
  });

  /**
   * O BOTÃO FICA NA TELA QUE CARREGOU, e não no cabeçalho de erro.
   *
   * Mesmo defeito que o PI viu três vezes na tela de unidades (24/08/2026):
   * a ação foi parar no `PageHeader` do bloco de recusa, e a tela normal --
   * a única que a recepção vê -- ficou sem porta de entrada. Lint, typecheck
   * e CI passam todos: nenhum verifica em qual dos dois cabeçalhos o botão
   * está.
   */
  it('oferece o convite na tela que carregou com sucesso', async () => {
    responder({
      '/api/v1/users': ok([USUARIO]),
      '/api/v1/roles': ok([PAPEL]),
    });

    await renderizar();

    expect(screen.getByTestId('convidar-usuario')).toBeInTheDocument();
  });

  /**
   * Quem não pode LISTAR também não pode convidar -- as duas rotas exigem a
   * mesma `user.manage`. Oferecer a ação numa tela que acabou de dizer "sem
   * permissão" mandaria a pessoa bater numa segunda negativa.
   */
  it('nao oferece convite quando a consulta foi recusada', async () => {
    responder({
      '/api/v1/users': recusado(),
      '/api/v1/roles': recusado(),
    });

    await renderizar();

    expect(screen.getByTestId('erro-de-permissao')).toBeInTheDocument();
    expect(screen.queryByTestId('convidar-usuario')).not.toBeInTheDocument();
  });

  /**
   * SEM PAPEL NÃO HÁ CONVITE POSSÍVEL: `roleId` é obrigatório na API, e um
   * combo vazio produziria um formulário que só sabe recusar. É estado
   * impossível hoje (o `bootstrap-tenant` cria `OWNER`), e o botão some por
   * garantia -- não por hipótese.
   */
  it('esconde o convite quando nao ha papel para escolher', async () => {
    responder({
      '/api/v1/users': ok([USUARIO]),
      '/api/v1/roles': ok([]),
    });

    await renderizar();

    expect(screen.queryByTestId('convidar-usuario')).not.toBeInTheDocument();
  });

  /**
   * A LISTA VAZIA NÃO É ERRO. Sem esta distinção, a tela diria "nenhum
   * usuário" para quem na verdade não tem permissão de ver -- e vice-versa.
   */
  it('mostra o estado vazio quando ninguem tem acesso', async () => {
    responder({
      '/api/v1/users': ok([]),
      '/api/v1/roles': ok([PAPEL]),
    });

    await renderizar();

    expect(screen.getByTestId('lista-vazia')).toBeInTheDocument();
    expect(screen.queryByTestId('erro-de-permissao')).not.toBeInTheDocument();
  });

  /**
   * MFA PENDENTE É O ESTADO NORMAL de quem acabou de aceitar o convite e
   * ainda não abriu o painel. A coluna precisa dizer isso em TEXTO --
   * `M1-NFR-008` exige WCAG 2.2 AA, e cor sozinha não informa.
   */
  it('diz em texto que o MFA esta pendente', async () => {
    responder({
      '/api/v1/users': ok([USUARIO]),
      '/api/v1/roles': ok([PAPEL]),
    });

    await renderizar();

    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  /**
   * FALHA NOS PAPÉIS NÃO DERRUBA A LISTA -- a lista é o conteúdo, e o combo
   * do modal é acessório. Trocar a tela inteira por uma recusa por causa de
   * uma consulta secundária esconderia o que funcionou.
   */
  it('mostra a lista mesmo quando a consulta de papeis falha', async () => {
    responder({
      '/api/v1/users': ok([USUARIO]),
      '/api/v1/roles': recusado(),
    });

    await renderizar();

    expect(screen.getByText('douglas@arenapositiva.com')).toBeInTheDocument();
    expect(screen.queryByTestId('erro-de-permissao')).not.toBeInTheDocument();
  });
});
