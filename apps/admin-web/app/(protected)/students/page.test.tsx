import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

/*
 * `FiltroDeAlunos` é o único pedaço client desta tela e escreve na URL pelo
 * router do App Router, que não existe no jsdom ("invariant expected app
 * router to be mounted"). O filtro não é o que estes testes exercitam -- eles
 * olham a TABELA.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/students',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDeAlunos from './page';

const BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  membershipNumber: 'AP-2026-00000001',
  fullName: 'Rodrigo Ramires',
  birthDate: '1990-05-20',
  cpf: '111.444.777-35',
  planName: 'Mensal Fit',
  accessSource: 'SUBSCRIPTION',
  subscriptionStatus: 'ACTIVE',
  phone: null,
  status: 'ACTIVE',
  statusReason: null,
  statusReasonNote: null,
  archivedAt: null,
  version: 0,
  deviceIds: [],
  invoiceParaAviso: null,
  timezoneDaUnidade: 'America/Sao_Paulo',
};

const BLOQUEADO = {
  ...BASE,
  id: '22222222-2222-4222-8222-222222222222',
  fullName: 'Joao Pedro Ramalho',
  status: 'BLOCKED',
  statusReason: 'DELINQUENCY',
  statusReasonNote: null,
};

const SUSPENSO = {
  ...BASE,
  id: '33333333-3333-4333-8333-333333333333',
  fullName: 'Lucas Teixeira Franco',
  status: 'SUSPENDED',
  statusReason: 'MEDICAL',
  statusReasonNote: 'atestado ate 30/09',
};

function responder(alunos: unknown[]) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) =>
    Promise.resolve(
      caminho.startsWith('/api/v1/students')
        ? { ok: true, dados: alunos, cookiesDaApi: [] }
        : { ok: true, dados: [], cookiesDaApi: [] },
    ),
  );
}

async function renderizar(alunos: unknown[]) {
  responder(alunos);

  const elemento = await PaginaDeAlunos({ searchParams: Promise.resolve({}) });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('grid de alunos', () => {
  /**
   * #503 -- a foto que veio do leitor facial (ou da ficha) aparece no avatar,
   * servida pela rota do painel, nunca pela API direto.
   */
  it('mostra a foto de quem tem, pela rota do painel', async () => {
    const { container } = await renderizar([{ ...BASE, temFoto: true }]);

    const foto = container.querySelector('img');
    expect(foto?.getAttribute('src')).toBe(`/fotos-de-aluno/${BASE.id}`);
  });

  it('mostra as iniciais de quem nao tem foto', async () => {
    const { container } = await renderizar([{ ...BASE, temFoto: false }]);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('RR')).toBeInTheDocument();
  });

  /**
   * A GRID DIZIA "BLOQUEADO" E NAO DIZIA POR QUE (issue #241).
   *
   * `PATCH /students/:id/status` gravava so `{ status, version }` -- nem a
   * timeline guardava a razao. Quem abria a lista uma semana depois nao tinha
   * como saber se o aluno parou de pagar, pediu pausa ou quebrou regra.
   */
  it('mostra o motivo de quem esta bloqueado', async () => {
    await renderizar([BLOQUEADO]);

    expect(screen.getByTestId(`motivo-${BLOQUEADO.id}`)).toHaveTextContent('Inadimplência');
  });

  it('mostra o motivo de quem esta suspenso', async () => {
    await renderizar([SUSPENSO]);

    expect(screen.getByTestId(`motivo-${SUSPENSO.id}`)).toHaveTextContent('Atestado médico');
  });

  /**
   * ALUNO ATIVO NAO TEM MOTIVO, e a linha nao ganha marca nenhuma.
   *
   * O `CHECK` do banco (`students_motivo_so_com_situacao_que_o_pede`) garante
   * que a coluna seja nula fora de `SUSPENDED`/`BLOCKED` -- este teste prova
   * que a TELA nao inventa um travessao onde nao ha pergunta.
   */
  it('nao mostra motivo para aluno ativo', async () => {
    await renderizar([BASE]);

    expect(screen.queryByTestId(`motivo-${BASE.id}`)).not.toBeInTheDocument();
  });

  /**
   * O CPF SAIU DA GRID (decisao do PI, 01/09/2026).
   *
   * Saiu a coluna E o aviso "A busca nao encontra por CPF", que existia so
   * para explica-la. O documento continua na ficha do aluno.
   */
  it('nao tem coluna de CPF nem o aviso que a explicava', async () => {
    await renderizar([BASE]);

    expect(screen.queryByRole('columnheader', { name: 'CPF' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('aviso-de-busca')).not.toBeInTheDocument();
    expect(screen.queryByText(BASE.cpf)).not.toBeInTheDocument();
  });

  /**
   * O ATALHO DE OVERRIDE MANUAL SAIU DA GRID (decisao do PI, 01/09/2026).
   *
   * A rota `/access/override` continua existindo e e alcancada pelo menu; o
   * que saiu foi o icone de chave da linha. O cadeado ao lado e OUTRA acao --
   * liberacao FINANCEIRA -- e permanece para quem esta bloqueado.
   */
  it('nao oferece liberacao manual de catraca na linha', async () => {
    await renderizar([BLOQUEADO]);

    expect(
      screen.queryByTestId(`acao-liberacao-manual-${BLOQUEADO.id}`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(`acao-editar-${BLOQUEADO.id}`)).toBeInTheDocument();
  });

  /**
   * A LIBERACAO FINANCEIRA (BotaoDeLiberacao) cobre BLOCKED e SUSPENDED
   * (ampliado em 29/09/2026): sao os dois status que uma acao manual no
   * painel aplica quando a catraca esta de fato fechada -- ver o comentario
   * em page.tsx acima de <AcoesDoAluno>.
   */
  it('oferece liberacao financeira para aluno bloqueado', async () => {
    await renderizar([BLOQUEADO]);

    expect(screen.getByTestId(`liberar-${BLOQUEADO.id}`)).toBeInTheDocument();
  });

  it('oferece liberacao financeira para aluno suspenso', async () => {
    await renderizar([SUSPENSO]);

    expect(screen.getByTestId(`liberar-${SUSPENSO.id}`)).toBeInTheDocument();
  });

  it('nao oferece liberacao financeira para aluno ativo', async () => {
    await renderizar([BASE]);

    expect(screen.queryByTestId(`liberar-${BASE.id}`)).not.toBeInTheDocument();
  });

  /*
   * A data é RELATIVA a hoje, nunca literal: `page.tsx` usa `new Date()` como
   * "agora", que o teste não controla. Data fixa faria o CI ficar vermelho
   * sozinho semanas depois, sem ninguém ter mexido em nada.
   */
  function emDias(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);

    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }

  // `emDias` monta o dia em UTC e a pagina compara no fuso da unidade: das 21h
  // a meia-noite de Brasilia os dois dias divergem (#451). Meio-dia UTC cai no
  // mesmo dia nos dois fusos. So `Date` e falso -- timers reais seguem, senao
  // as esperas do Testing Library travam.
  beforeEach(() => {
    const hoje = new Date();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ATIVO_VENCIDO = {
    ...BASE,
    id: '44444444-4444-4444-8444-444444444444',
    fullName: 'Marcos Vinicius Alves',
    status: 'ACTIVE',
    invoiceParaAviso: { status: 'OVERDUE', dueAt: emDias(-7), blockAt: null },
  };

  const ATIVO_VENCE_HOJE = {
    ...BASE,
    id: '55555555-5555-4555-8555-555555555555',
    fullName: 'Carla Souza Lima',
    status: 'ACTIVE',
    invoiceParaAviso: { status: 'OPEN', dueAt: emDias(0), blockAt: null },
  };

  const ATIVO_BLOQUEIO_CHEGOU = {
    ...BASE,
    id: '66666666-6666-4666-8666-666666666666',
    fullName: 'Paulo Henrique Dias',
    status: 'ACTIVE',
    invoiceParaAviso: { status: 'OVERDUE', dueAt: emDias(-15), blockAt: emDias(-2) },
  };

  const ATIVO_EM_DIA = {
    ...BASE,
    id: '77777777-7777-4777-8777-777777777777',
    fullName: 'Renata Campos Melo',
    status: 'ACTIVE',
    invoiceParaAviso: { status: 'OPEN', dueAt: emDias(+10), blockAt: null },
  };

  /**
   * A COLUNA SITUACAO RESPONDE "ELE ESTA PAGANDO?" PARA QUEM ESTA ATIVO.
   *
   * Antes desta fatia ela dizia sempre "Ativo" -- verdade inutil para a
   * recepcao, que ja sabe que o aluno esta ativo porque ele esta na frente
   * dela. O que ela precisa saber e se pode liberar sem cobrar.
   */
  it('mostra a situacao financeira no lugar do status, para aluno ativo', async () => {
    await renderizar([ATIVO_VENCIDO]);

    // Escopado a tabela: o filtro acima tem <option>Ativo</option> sempre
    // presente na tela, e colidiria com o texto do badge se a busca fosse
    // global.
    const tabela = within(screen.getByTestId('tabela-de-alunos'));

    expect(tabela.getByText('Vencida')).toBeInTheDocument();
    expect(tabela.queryByText('Ativo')).not.toBeInTheDocument();
  });

  it('mostra "Vence hoje" para quem vence no dia', async () => {
    await renderizar([ATIVO_VENCE_HOJE]);

    expect(screen.getByText('Vence hoje')).toBeInTheDocument();
  });

  /*
   * BLOQUEIO_PROXIMO E O ESTADO MAIS GRAVE -- `blockAt` JA passou. Ver "A
   * semantica REAL dos 4 estados" no plano: nao e aviso de bloqueio futuro.
   */
  it('mostra "Bloqueada" para quem ja passou do prazo de bloqueio', async () => {
    await renderizar([ATIVO_BLOQUEIO_CHEGOU]);

    expect(screen.getByText('Bloqueada')).toBeInTheDocument();
  });

  /**
   * O BOTAO DE LIBERAR TEM QUE ACOMPANHAR A BADGE "Bloqueada" (29/09/2026).
   *
   * `ATIVO_BLOQUEIO_CHEGOU` tem `status: 'ACTIVE'` -- nenhum job muda o
   * status do aluno sozinho (ver comentario em `situacaoFinanceira`,
   * page.tsx). Sem essa cobertura, quem so tem o bloqueio financeiro nunca
   * ganhava o botao, mesmo com a catraca de fato fechada.
   */
  it('oferece liberacao financeira para aluno ativo com bloqueio ja chegado', async () => {
    await renderizar([ATIVO_BLOQUEIO_CHEGOU]);

    expect(screen.getByTestId(`liberar-${ATIVO_BLOQUEIO_CHEGOU.id}`)).toBeInTheDocument();
  });

  it('nao oferece liberacao financeira para aluno ativo so vencido (bloqueio ainda nao chegou)', async () => {
    await renderizar([ATIVO_VENCIDO]);

    expect(screen.queryByTestId(`liberar-${ATIVO_VENCIDO.id}`)).not.toBeInTheDocument();
  });

  it('mostra "Em dia" para quem tem fatura em aberto ainda por vencer', async () => {
    await renderizar([ATIVO_EM_DIA]);

    expect(screen.getByText('Em dia')).toBeInTheDocument();
  });

  /**
   * ALUNO NAO-ATIVO MANTEM O STATUS na coluna Situacao.
   *
   * "Em dia" para um aluno bloqueado seria a informacao errada na hora errada:
   * quem esta na catraca precisa saber que ele nao entra, nao que a ultima
   * fatura esta paga.
   */
  it('mantem o status na coluna Situacao para aluno bloqueado', async () => {
    await renderizar([{ ...BLOQUEADO, invoiceParaAviso: { status: 'OVERDUE', dueAt: emDias(-30), blockAt: emDias(-20) } }]);

    // Escopado a tabela: o filtro acima tem <option>Bloqueado</option>
    // sempre presente na tela.
    const tabela = within(screen.getByTestId('tabela-de-alunos'));

    expect(tabela.getByText('Bloqueado')).toBeInTheDocument();
    expect(tabela.queryByText('Bloqueada')).not.toBeInTheDocument();
  });

  /**
   * SEM FUSO DA UNIDADE NAO HA COMO DECIDIR O DIA -- a celula volta ao status.
   *
   * `timezoneDaUnidade` nulo acontece de verdade: unidade cadastrada sem fuso
   * (ADR-019 exige, mas dado antigo pode nao ter). Mostrar badge financeira
   * calculada em UTC erraria por um dia perto da meia-noite.
   */
  it('cai no status quando falta o fuso da unidade', async () => {
    await renderizar([
      { ...ATIVO_VENCIDO, timezoneDaUnidade: null },
    ]);

    // Escopado a tabela: o filtro acima tem <option>Ativo</option> sempre
    // presente na tela.
    const tabela = within(screen.getByTestId('tabela-de-alunos'));

    expect(tabela.getByText('Ativo')).toBeInTheDocument();
    expect(tabela.queryByText('Vencida')).not.toBeInTheDocument();
  });

  /**
   * A COLUNA MOTIVO EXPLICA A SITUACAO QUE A COLUNA AO LADO MOSTRA.
   *
   * As duas precisam contar a MESMA historia: badge financeira com motivo de
   * status ao lado ("Vencida" + "Atestado medico") seria incoerente.
   */
  it('explica a situacao financeira na coluna Motivo', async () => {
    await renderizar([ATIVO_VENCIDO]);

    expect(screen.getByTestId(`motivo-financeiro-${ATIVO_VENCIDO.id}`)).toHaveTextContent(
      'Mensalidade vencida há 7 dias',
    );
  });

  it('nao mostra motivo financeiro para quem esta em dia', async () => {
    await renderizar([ATIVO_EM_DIA]);

    expect(screen.queryByTestId(`motivo-financeiro-${ATIVO_EM_DIA.id}`)).not.toBeInTheDocument();
  });

  it('mantem o motivo de status para aluno suspenso', async () => {
    await renderizar([SUSPENSO]);

    expect(screen.getByTestId(`motivo-${SUSPENSO.id}`)).toHaveTextContent('Atestado médico');
  });

  /**
   * A COLUNA SITUACAO e ordenavel -- o cabecalho vira link.
   */
  it('permite ordenar pela coluna Situacao', async () => {
    await renderizar([ATIVO_VENCIDO]);

    const cabecalho = screen.getByRole('columnheader', { name: /Situação/ });

    expect(cabecalho.querySelector('a')).not.toBeNull();
  });
});
