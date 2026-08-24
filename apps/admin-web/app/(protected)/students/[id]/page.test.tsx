import { render, screen } from '@testing-library/react';
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
}));

vi.mock('../../../actions/membership', () => ({
  atribuirPlano: vi.fn(),
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

function responder(direitos: unknown[]) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho.endsWith('/entitlements')) {
      return Promise.resolve({ ok: true, dados: direitos, cookiesDaApi: [] });
    }
    if (caminho === '/api/v1/plans') {
      return Promise.resolve({
        ok: true,
        dados: [{ id: 'plano-1', name: 'Programa Adultos', isActive: true }],
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
