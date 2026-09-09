import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

/*
 * `usePathname` entra junto: o layout renderiza `Navegacao`, que o usa para
 * marcar o item atual. Sem ele o mock derruba a árvore inteira.
 *
 * `useRouter` e `useSearchParams` entraram com o SELETOR de unidade (F57):
 * ele lê a escolha da URL e navega ao trocar. Mock incompleto aqui derruba
 * as oito asserções deste arquivo com um erro que não aponta para o seletor.
 */
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => '/students',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../actions/auth', () => ({
  sair: vi.fn(),
}));

/*
 * `encerrarSuporte` entra pela FAIXA DE SUPORTE (F61): o layout a importa para
 * o botão "Sair do suporte". Sem o mock, `app/actions/platform` arrasta
 * `lib/api/repassar-cookies`, que declara `server-only` e derruba o arquivo
 * inteiro antes do primeiro teste.
 */
vi.mock('../actions/platform', () => ({
  encerrarSuporte: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import LayoutProtegido, { reancorarGrupos } from './layout';

const PERFIL = { id: 'u1', email: 'dono@arena-positiva.test' };

function unidade(nome: string, status = 'ACTIVE', timezone = 'America/Sao_Paulo') {
  return { id: `id-${nome}`, name: nome, status, timezone };
}

function responder(unidades: unknown[], permissions?: string[]) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho === '/api/v1/units') {
      return Promise.resolve({ ok: true, dados: unidades, cookiesDaApi: [] });
    }
    return Promise.resolve({
      ok: true,
      dados: permissions === undefined ? PERFIL : { ...PERFIL, permissions },
      cookiesDaApi: [],
    });
  });
}

async function renderizar() {
  const elemento = await LayoutProtegido({ children: <p>conteúdo</p> });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

/**
 * O TOPBAR dizia "Unidade não selecionada" mesmo com a Matriz cadastrada --
 * mandava a recepção escolher algo que não havia onde escolher. O texto vinha
 * de quando o painel não consultava unidade nenhuma.
 *
 * Desde 01/09/2026 (F57) ele SELECIONA quando há mais de uma: o dashboard
 * forçou a decisão que estava adiada -- sem unidade escolhida não existe
 * "hoje". Com uma só, continua sendo rótulo.
 */
describe('seletor de unidade no topbar', () => {
  it('com UMA unidade ativa, mostra o nome dela', async () => {
    responder([unidade('Unidade Matriz')]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('Unidade Matriz');
  });

  /**
   * Com VÁRIAS agora se ESCOLHE -- era "2 unidades", um rótulo que dizia à
   * recepção quantas portas existiam sem deixar abrir nenhuma.
   *
   * O teste afirma as OPÇÕES, não o texto: `toHaveTextContent` num `<select>`
   * concatena todas elas, e passaria mesmo que o controle não fosse operável.
   */
  it('com mais de uma, vira um seletor com uma opção por unidade', async () => {
    responder([unidade('Matriz'), unidade('Zona Sul')]);

    await renderizar();

    const seletor = screen.getByTestId('unidade-ativa');

    expect(seletor.tagName).toBe('SELECT');
    // A primeira é a opção vazia -- ver "sem padrão silencioso", abaixo.
    expect(
      screen.getAllByRole('option').map((opcao) => opcao.textContent),
    ).toEqual(['Selecione a unidade', 'Matriz', 'Zona Sul']);
  });

  /*
   * SEM PADRÃO SILENCIOSO — o defeito que a revisão do próprio código achou.
   *
   * Cair na primeira unidade faria o seletor exibi-la como escolhida enquanto
   * o dashboard diz "escolha uma unidade": dois estados contraditórios na
   * mesma tela. E escolher justamente aquela NÃO dispararia `onChange` (o
   * valor não muda), deixando a pessoa presa, clicando na opção certa sem
   * efeito nenhum.
   */
  it('sem unidade na URL, o seletor NÃO finge que uma já foi escolhida', async () => {
    responder([unidade('Matriz'), unidade('Zona Sul')]);

    await renderizar();

    // `getByLabelText` devolve o elemento JÁ tipado como `<select>`; o cast
    // que estava aqui era redundante e o lint o recusa.
    const seletor = screen.getByLabelText('Unidade');

    expect(seletor).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Selecione a unidade' })).toBeDisabled();
  });

  /** Rótulo acessível: sem ele o leitor de tela anuncia "combo box" e nada mais. */
  it('o seletor tem rótulo acessível', async () => {
    responder([unidade('Matriz'), unidade('Zona Sul')]);

    await renderizar();

    expect(screen.getByLabelText('Unidade')).toBe(screen.getByTestId('unidade-ativa'));
  });

  /** Com UMA não há o que selecionar: `<select>` de uma opção é botão morto. */
  it('com uma só, continua rótulo e NÃO vira seletor', async () => {
    responder([unidade('Unidade Matriz')]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa').tagName).not.toBe('SELECT');
  });

  it('sem nenhuma, o texto convida a cadastrar', async () => {
    responder([]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('Nenhuma unidade cadastrada');
  });

  /**
   * UNIDADE INATIVA NÃO CONTA: a academia fechou aquela porta, e contá-la
   * faria o topbar dizer "2 unidades" para quem opera uma só.
   */
  it('ignora unidade inativa na contagem', async () => {
    responder([unidade('Matriz'), unidade('Antiga', 'INACTIVE')]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('Matriz');
  });

  /**
   * FALHA AO BUSCAR UNIDADE NÃO DERRUBA O PAINEL -- o indicador é apoio, e o
   * resto da tela responde sem ele.
   */
  it('sobrevive à falha na consulta de unidades', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/units') {
        return Promise.resolve({
          ok: false,
          erro: {
            type: 'about:blank',
            title: 'erro',
            status: 500,
            code: 'ERRO',
            correlationId: 't',
          },
          cookiesDaApi: [],
        });
      }
      return Promise.resolve({ ok: true, dados: PERFIL, cookiesDaApi: [] });
    });

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toBeInTheDocument();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });

  describe('grupos do menu', () => {
    /** Os rótulos de grupo, na ordem em que aparecem no DOM. */
    function rotulos(): string[] {
      return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    }

    it('agrupa as três telas de dinheiro sob Financeiro', async () => {
      responder([unidade('Matriz')], ['billing.dashboard']);
      await renderizar();

      expect(rotulos()).toEqual(['Financeiro', 'Administração']);

      for (const nome of ['Cobrança', 'Conciliação', 'Painel financeiro']) {
        expect(screen.getByRole('link', { name: nome })).toBeInTheDocument();
      }
    });

    /*
     * O DEFEITO QUE `reancorarGrupos` EVITA, e a razão de ele existir.
     *
     * O rótulo mora no item que abre o grupo. Hoje "Financeiro" abre em
     * Cobrança, que aparece para todo mundo -- mas o grupo JÁ contém um item
     * com `exigePermissao`, e basta alguém reordenar para o rótulo passar a
     * morar num item que some. Aí "Conciliação" e "Painel financeiro"
     * ficariam órfãos no meio da lista, sem cabeçalho, **só para quem não tem
     * a permissão**: quem revisa o PR vê a sidebar completa e não vê nada
     * errado.
     *
     * O teste força exatamente esse arranjo tirando o primeiro item do grupo.
     */
    it('mantém o rótulo quando o primeiro item do grupo é filtrado', async () => {
      /*
       * Sem `billing.dashboard` o "Painel financeiro" some -- é o filtro real
       * do layout. O que se verifica é que o grupo continua rotulado.
       */
      responder([unidade('Matriz')], []);
      await renderizar();

      expect(rotulos()).toEqual(['Financeiro', 'Administração']);
      expect(screen.queryByRole('link', { name: 'Painel financeiro' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Cobrança' })).toBeInTheDocument();
    });

    /* O rótulo aparece UMA vez por grupo, não a cada item dele. */
    it('não repete o rótulo nos demais itens do grupo', async () => {
      responder([unidade('Matriz')], ['billing.dashboard']);
      await renderizar();

      expect(screen.getAllByRole('heading', { level: 2, name: 'Financeiro' })).toHaveLength(1);
    });
  });

  /*
   * A REANCORAGEM, TESTADA NO ARRANJO QUE A EXIGE.
   *
   * Pela ordem de HOJE o menu não exercita esta função: "Financeiro" abre em
   * Cobrança, que aparece para todo mundo. O defeito nasce no dia em que
   * alguém reordenar o grupo e o rótulo passar a morar num item com
   * permissão -- e nasce **silencioso**, só para quem não tem a permissão.
   *
   * Por isso o teste monta esse arranjo em vez de esperar por ele. Testar
   * pelo menu real passaria verde com a função removida, que é a definição
   * de teste que não mede nada.
   */
  describe('reancorarGrupos', () => {
    const COMPLETA = [
      { href: '/a', label: 'A' },
      // O rótulo mora no item COM permissão -- o arranjo perigoso.
      { href: '/painel', label: 'Painel', grupo: 'Financeiro', exigePermissao: 'x' },
      { href: '/cobranca', label: 'Cobrança' },
      { href: '/conciliacao', label: 'Conciliação' },
      { href: '/config', label: 'Config', grupo: 'Administração' },
    ] as const;

    function rotulosDe(itens: readonly { grupo?: string }[]): (string | undefined)[] {
      return itens.map((item) => item.grupo).filter((g) => g !== undefined);
    }

    it('move o rótulo para o primeiro item que sobreviveu', () => {
      const visiveis = COMPLETA.filter((item) => item.href !== '/painel');

      const resultado = reancorarGrupos(COMPLETA, visiveis);

      expect(rotulosDe(resultado)).toEqual(['Financeiro', 'Administração']);
      // E o rótulo pousa em Cobrança, o primeiro que restou do grupo.
      expect(resultado.find((item) => item.grupo === 'Financeiro')?.href).toBe('/cobranca');
    });

    it('deixa o rótulo onde está quando ninguém é filtrado', () => {
      const resultado = reancorarGrupos(COMPLETA, COMPLETA);

      expect(resultado.find((item) => item.grupo === 'Financeiro')?.href).toBe('/painel');
    });

    it('omite o rótulo quando o grupo inteiro some', () => {
      const visiveis = COMPLETA.filter((item) => item.href === '/a' || item.href === '/config');

      const resultado = reancorarGrupos(COMPLETA, visiveis);

      expect(rotulosDe(resultado)).toEqual(['Administração']);
    });

    it('não repete o rótulo nos irmãos do grupo', () => {
      const resultado = reancorarGrupos(COMPLETA, COMPLETA);

      expect(rotulosDe(resultado).filter((g) => g === 'Financeiro')).toHaveLength(1);
    });
  });
});

/**
 * A FAIXA DE SUPORTE — F61.
 *
 * Quem opera elevado vê a tela do cliente idêntica à própria; sem a faixa, age
 * achando que está na própria casa. É aviso de segurança, não enfeite: aparece
 * só quando a API declara a elevação, e nunca depende de a tela adivinhar.
 */
describe('faixa de suporte', () => {
  function responderComElevacao(
    elevacao: { tenant: string; reason: string; expiraEm: string } | undefined,
  ) {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/units') {
        return Promise.resolve({
          ok: true,
          dados: [unidade('Matriz', 'ACTIVE', 'America/Manaus')],
          cookiesDaApi: [],
        });
      }

      return Promise.resolve({
        ok: true,
        dados: elevacao === undefined ? PERFIL : { ...PERFIL, supportElevation: elevacao },
        cookiesDaApi: [],
      });
    });
  }

  it('nao aparece na sessao comum', async () => {
    responderComElevacao(undefined);

    await renderizar();

    expect(screen.queryByTestId('faixa-de-suporte')).not.toBeInTheDocument();
  });

  it('nomeia o tenant e oferece a saida quando ha elevacao viva', async () => {
    responderComElevacao({
      tenant: 'Arena Positiva',
      reason: 'Chamado 4821',
      expiraEm: '2026-09-09T17:30:00.000Z',
    });

    await renderizar();

    const faixa = screen.getByTestId('faixa-de-suporte');

    expect(faixa).toHaveTextContent('Arena Positiva');
    expect(screen.getByTestId('sair-do-suporte')).toBeInTheDocument();
  });

  /**
   * O fuso é o da ACADEMIA VISITADA, não o de quem olha: o suporte de Curitiba
   * vendo a academia de Manaus precisa da hora de encerramento no fuso de lá,
   * que é onde o prazo termina. 17:30Z em America/Manaus é 13:30 — em
   * America/Sao_Paulo seria 14:30, e a diferença é o defeito.
   */
  it('mostra a hora de encerramento no fuso da academia visitada', async () => {
    responderComElevacao({
      tenant: 'Arena Positiva',
      reason: 'Chamado 4821',
      expiraEm: '2026-09-09T17:30:00.000Z',
    });

    await renderizar();

    expect(screen.getByTestId('faixa-de-suporte')).toHaveTextContent('13:30');
  });
});

/**
 * A FAIXA DE COBRANCA -- F65, Task 9.
 *
 * So aparece quando a API declara `cobranca` (fatura vencida). Quando as duas
 * faixas existem ao mesmo tempo, a de suporte vem primeiro no DOM: quem opera
 * elevado precisa notar isso antes de qualquer outro aviso da tela.
 */
describe('faixa de cobranca', () => {
  function responderComCobranca(
    cobranca: { diasRestantes: number; emAbertoMinor: number; suspensa: boolean } | undefined,
  ) {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/units') {
        return Promise.resolve({ ok: true, dados: [unidade('Matriz')], cookiesDaApi: [] });
      }

      return Promise.resolve({
        ok: true,
        dados: cobranca === undefined ? PERFIL : { ...PERFIL, cobranca },
        cookiesDaApi: [],
      });
    });
  }

  it('nao aparece sem fatura vencida', async () => {
    responderComCobranca(undefined);

    await renderizar();

    expect(screen.queryByTestId('faixa-de-cobranca')).not.toBeInTheDocument();
  });

  it('aparece com fatura vencida', async () => {
    responderComCobranca({ diasRestantes: 7, emAbertoMinor: 596250, suspensa: false });

    await renderizar();

    expect(screen.getByTestId('faixa-de-cobranca')).toHaveTextContent('7 dias');
  });

  /*
   * AS DUAS FAIXAS JUNTAS -- Super Admin elevado numa academia inadimplente.
   * A de suporte vem primeiro: e o aviso que mais importa notar primeiro.
   */
  it('mostra as duas faixas quando elevacao e cobranca coexistem, suporte primeiro', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/units') {
        return Promise.resolve({ ok: true, dados: [unidade('Matriz')], cookiesDaApi: [] });
      }

      return Promise.resolve({
        ok: true,
        dados: {
          ...PERFIL,
          supportElevation: {
            tenant: 'Arena Positiva',
            reason: 'Chamado 4821',
            expiraEm: '2026-09-09T17:30:00.000Z',
          },
          cobranca: { diasRestantes: 7, emAbertoMinor: 596250, suspensa: false },
        },
        cookiesDaApi: [],
      });
    });

    await renderizar();

    const faixaDeSuporte = screen.getByTestId('faixa-de-suporte');
    const faixaDeCobranca = screen.getByTestId('faixa-de-cobranca');

    expect(faixaDeSuporte).toBeInTheDocument();
    expect(faixaDeCobranca).toBeInTheDocument();
    // `DOCUMENT_POSITION_FOLLOWING`: suporte vem ANTES de cobranca no DOM.
    expect(
      faixaDeSuporte.compareDocumentPosition(faixaDeCobranca) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
