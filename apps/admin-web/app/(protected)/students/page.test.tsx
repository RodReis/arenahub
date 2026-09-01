import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
});
