import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

/**
 * A ficha renderiza tres formularios que falam com Server Actions -- mesmo
 * mock de todo teste que passa por elas.
 */
vi.mock('../../../actions/students', () => ({
  editarAluno: vi.fn(),
  alterarSituacao: vi.fn(),
  alterarPerfilDeAluno: vi.fn(),
}));

vi.mock('../../../actions/membership', () => ({
  atribuirPlano: vi.fn(),
  definirCredencial: vi.fn(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import PaginaDaFicha from './page';

const ALUNO_ID = '11111111-1111-4111-8111-111111111111';
const UNIDADE = { id: 'unidade-1', name: 'Unidade Matriz' };

function aluno(sobrescritas: Record<string, unknown> = {}) {
  return {
    id: ALUNO_ID,
    membershipNumber: 'AP-2026-00003046',
    fullName: 'Paulo Victor Ribeiro de Barros',
    // A API devolve data PURA (`@db.Date`, cortada no controller).
    birthDate: '1999-07-16',
    cpf: '05047398161',
    status: 'ACTIVE',
    profile: 'STUDENT',
    archivedAt: null,
    version: 3,
    rg: null,
    registeredSex: null,
    contacts: [],
    address: null,
    ...sobrescritas,
  };
}

function entitlement(sobrescritas: Record<string, unknown> = {}) {
  return {
    id: 'ent-1',
    source: 'SUBSCRIPTION',
    status: 'ACTIVE',
    // Vigencia larga o bastante para `vigenteAgora` valer em qualquer dia.
    startsAt: '2020-01-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    reason: null,
    subscriptionId: '33333333-3333-4333-8333-333333333333',
    subscriptionVersion: 4,
    janelas: [],
    ...sobrescritas,
  };
}

function responder(direitos: unknown[], planosExtras: unknown[] = []) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho.endsWith('/entitlements')) {
      return Promise.resolve({ ok: true, dados: direitos, cookiesDaApi: [] });
    }
    if (caminho === '/api/v1/plans') {
      return Promise.resolve({
        ok: true,
        dados: [
          {
            id: 'plano-1',
            name: 'Programa Adultos',
            isActive: true,
            currentPrice: { amountMinor: 15000, currency: 'BRL' },
          },
          ...planosExtras,
        ],
        cookiesDaApi: [],
      });
    }
    if (caminho === '/api/v1/units') {
      return Promise.resolve({ ok: true, dados: [UNIDADE], cookiesDaApi: [] });
    }
    if (caminho.endsWith('/invoices')) {
      return Promise.resolve({
        ok: true,
        dados: { timezone: 'America/Sao_Paulo', invoices: [] },
        cookiesDaApi: [],
      });
    }
    if (caminho.endsWith('/credentials')) {
      return Promise.resolve({ ok: true, dados: [], cookiesDaApi: [] });
    }
    return Promise.resolve({ ok: true, dados: aluno(), cookiesDaApi: [] });
  });
}

async function renderizar() {
  const elemento = await PaginaDaFicha({ params: Promise.resolve({ id: ALUNO_ID }) });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

/*
 * `hidden: true` nas buscas de heading: desde 24/08/2026 a ficha divide o
 * conteudo em abas (Informacao e Plano), e o painel inativo fica no DOM com
 * `hidden` -- montado de proposito, porque input desmontado nao entra no
 * `FormData`. O que estes testes verificam e o ROTULO certo ("Atribuir" vs
 * "Alterar"), nao qual aba esta aberta.
 */
describe('ficha do aluno', () => {
  /**
   * As QUATRO PORTAS do sistema. Elas viraram cartao navegavel, e os
   * `data-testid` sao os mesmos que tres E2E percorrem -- trocar o markup sem
   * preserva-los quebraria a navegacao inteira do aluno.
   */
  it('leva as quatro portas do aluno, cada uma para o proprio destino', async () => {
    responder([]);

    await renderizar();

    expect(screen.getByTestId('link-timeline')).toHaveAttribute(
      'href',
      `/students/${ALUNO_ID}/timeline`,
    );
    expect(screen.getByTestId('link-biometria')).toHaveAttribute(
      'href',
      `/students/${ALUNO_ID}/biometrics`,
    );
    expect(screen.getByTestId('link-financeiro')).toHaveAttribute(
      'href',
      `/students/${ALUNO_ID}/billing`,
    );
    expect(screen.getByTestId('link-evolucao')).toHaveAttribute(
      'href',
      `/students/${ALUNO_ID}/health`,
    );
  });

  /**
   * Sem plano vigente a acao CRIA, e o titulo precisa dizer isso. Chamar de
   * "Alterar plano" quem nao tem plano nenhum e mentir sobre o que o botao
   * faz.
   */
  it('diz "Atribuir plano" quando o aluno nao tem assinatura vigente', async () => {
    responder([]);

    await renderizar();

    expect(screen.getByRole('heading', { name: 'Atribuir plano', hidden: true })).toBeInTheDocument();
  });

  /*
   * F86 -- diaria avulsa. O plano de diaria tem fluxo proprio (com pagamento): vende-se
   * so a quem esta sem plano, e NUNCA aparece na lista de atribuicao por datas, que
   * daria acesso sem cobrar.
   */
  const PLANO_DE_DIARIA = {
    id: 'plano-diaria',
    name: 'Diaria',
    isActive: true,
    billingMode: 'DIARIA',
    currentPrice: { amountMinor: 3000, currency: 'BRL' },
  };

  it('aluno sem plano ve a secao Diaria e pode abrir a venda', async () => {
    responder([], [PLANO_DE_DIARIA]);

    await renderizar();

    expect(screen.getByRole('heading', { name: 'Diária', hidden: true })).toBeInTheDocument();
    expect(screen.getByTestId('abrir-venda-de-diaria')).toBeInTheDocument();
  });

  it('o plano de diaria nao aparece na lista de atribuicao com datas', async () => {
    const usuario = userEvent.setup();
    responder([], [PLANO_DE_DIARIA]);

    await renderizar();
    await usuario.click(screen.getByTestId(`abrir-plano-${ALUNO_ID}`));

    const opcoes = within(screen.getByTestId('campo-plano'))
      .getAllByRole('option', { hidden: true })
      .map((o) => o.textContent ?? '');

    expect(opcoes.some((o) => o.startsWith('Programa Adultos'))).toBe(true);
    expect(opcoes.some((o) => o.startsWith('Diaria'))).toBe(false);
  });

  it('diaria ja paga nao mostra "Cobranca recorrente" (nao ha o que cobrar depois)', async () => {
    responder([entitlement({ planBillingMode: 'DIARIA' })], [PLANO_DE_DIARIA]);

    await renderizar();

    expect(screen.queryByRole('heading', { name: 'Cobrança recorrente', hidden: true })).toBeNull();
  });

  it('plano mensal continua mostrando "Cobranca recorrente"', async () => {
    responder([entitlement({ planBillingMode: 'AVULSO' })]);

    await renderizar();

    expect(
      screen.getByRole('heading', { name: 'Cobrança recorrente', hidden: true }),
    ).toBeInTheDocument();
  });

  it('plano suspenso por atraso: a Diaria explica em vez de oferecer o que a API vai negar', async () => {
    // Assinatura PAST_DUE + direito SUSPENDED ainda no prazo: a ficha nao o conta como "vigente",
    // mas a API conta (STUDENT_HAS_ACTIVE_SUBSCRIPTION).
    responder([entitlement({ status: 'SUSPENDED' })], [PLANO_DE_DIARIA]);

    await renderizar();

    expect(screen.getByTestId('diaria-em-atraso')).toBeInTheDocument();
    expect(screen.queryByTestId('abrir-venda-de-diaria')).toBeNull();
  });

  it('direito suspenso que JA venceu nao trava a Diaria', async () => {
    responder(
      [entitlement({ status: 'SUSPENDED', endsAt: '2020-06-01T00:00:00.000Z' })],
      [PLANO_DE_DIARIA],
    );

    await renderizar();

    expect(screen.queryByTestId('diaria-em-atraso')).toBeNull();
    expect(screen.getByTestId('abrir-venda-de-diaria')).toBeInTheDocument();
  });

  it('aluno com plano vigente nao ve a secao Diaria', async () => {
    responder([entitlement()], [PLANO_DE_DIARIA]);

    await renderizar();

    expect(screen.queryByRole('heading', { name: 'Diária', hidden: true })).toBeNull();
    expect(screen.queryByTestId('abrir-venda-de-diaria')).toBeNull();
  });

  /**
   * Com plano vigente a acao SUBSTITUI -- encerra a anterior e cria a nova.
   * O aviso de encerramento e o que impede a recepcao de achar que esta
   * somando um segundo plano ao primeiro.
   */
  it('diz "Alterar plano" e avisa do encerramento quando ha assinatura vigente', async () => {
    const usuario = userEvent.setup();

    responder([entitlement()]);

    await renderizar();

    expect(screen.getByRole('heading', { name: 'Alterar plano', hidden: true })).toBeInTheDocument();

    /*
     * O formulario fica FECHADO ate ser pedido (24/08/2026): a aba Plano
     * existe para responder "qual acesso este aluno tem", e cinco campos
     * empurravam os direitos de acesso para cima da dobra. O aviso de
     * encerramento vive dentro dele.
     */
    await usuario.click(screen.getByTestId(`abrir-plano-${ALUNO_ID}`));

    expect(screen.getByTestId('aviso-de-troca')).toBeInTheDocument();
  });

  /**
   * #337: com troca ja agendada, a recepcao ve para qual plano e quando --
   * e que agendar de novo substitui.
   */
  it('mostra a troca ja agendada dentro do formulario de troca', async () => {
    const usuario = userEvent.setup();

    responder([
      entitlement({
        scheduledPlanChange: { planId: 'plano-1', effectiveFrom: '2026-11-01T00:00:00.000Z' },
      }),
    ]);

    await renderizar();
    await usuario.click(screen.getByTestId(`abrir-plano-${ALUNO_ID}`));

    expect(screen.getByTestId('troca-ja-agendada')).toBeInTheDocument();
  });

  /**
   * A combo mostra o PRECO ao lado do nome, e escolher um plano abre o resumo
   * De/Para com a diferenca -- planos parecidos eram escolhidos no palpite.
   */
  it('mostra o preco na combo e o resumo De/Para ao escolher o plano', async () => {
    const usuario = userEvent.setup();

    responder([
      entitlement({
        planName: 'Plano Ajuda',
        planCurrentPrice: { amountMinor: 10000, currency: 'BRL' },
      }),
    ]);

    await renderizar();
    await usuario.click(screen.getByTestId(`abrir-plano-${ALUNO_ID}`));

    expect(screen.queryByTestId('resumo-da-troca')).not.toBeInTheDocument();

    const combo = screen.getByTestId('campo-plano');
    const opcao = within(combo).getByRole('option', { name: /Programa Adultos/, hidden: true });
    expect(opcao.textContent).toMatch(/150,00/);

    await usuario.selectOptions(combo, 'plano-1');

    const resumo = screen.getByTestId('resumo-da-troca');
    expect(resumo.textContent).toContain('Plano Ajuda');
    expect(resumo.textContent).toContain('Programa Adultos');
    expect(screen.getByTestId('diferenca-de-preco').textContent).toMatch(/sobe.*50,00/);
  });

  it('avisa que a recorrencia no cartao nao acompanha a troca', async () => {
    const usuario = userEvent.setup();

    responder([entitlement({ recorrenciaAtiva: true })]);

    await renderizar();
    await usuario.click(screen.getByTestId(`abrir-plano-${ALUNO_ID}`));

    expect(screen.getByTestId('aviso-de-recorrencia')).toBeInTheDocument();
  });

  it('sem troca agendada, nao mostra o aviso de agendamento', async () => {
    const usuario = userEvent.setup();

    responder([entitlement()]);

    await renderizar();
    await usuario.click(screen.getByTestId(`abrir-plano-${ALUNO_ID}`));

    expect(screen.queryByTestId('troca-ja-agendada')).not.toBeInTheDocument();
  });

  /**
   * CORTESIA nao e plano que se substitui: nasce sem assinatura
   * (`subscriptionId` nulo), e tratar como troca faria a tela tentar cancelar
   * uma assinatura que nao existe.
   */
  it('trata cortesia como ausencia de assinatura, nao como plano a substituir', async () => {
    responder([
      entitlement({ source: 'COURTESY', subscriptionId: null, subscriptionVersion: null }),
    ]);

    await renderizar();

    expect(screen.getByRole('heading', { name: 'Atribuir plano', hidden: true })).toBeInTheDocument();
    expect(screen.queryByTestId('aviso-de-troca')).not.toBeInTheDocument();
  });
  /**
   * DUAS ABAS -- Informacao e Plano (decisao do PI, 24/08/2026). A ficha
   * empilhava cinco secoes de peso identico, e a recepcao rolava a pagina
   * inteira para chegar no plano.
   */
  it('divide o conteudo em duas abas', async () => {
    responder([]);

    await renderizar();

    expect(screen.getByTestId('aba-informacao')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('aba-plano')).toHaveAttribute('aria-selected', 'false');
  });

  /**
   * "ACESSO AGORA" SAIU DA FICHA: a pergunta "essa pessoa entra agora?" e
   * feita olhando a LISTA, com o aluno parado na porta. As duas coisas que a
   * secao fazia foram para a grid -- a situacao ja era coluna la, e a
   * liberacao manual virou icone de linha.
   */
  it('nao mostra mais a secao "Acesso agora"', async () => {
    responder([]);

    await renderizar();

    expect(screen.queryByTestId('acesso-sem-direito')).not.toBeInTheDocument();
    expect(screen.queryByTestId('link-liberacao-manual')).not.toBeInTheDocument();
  });
});
