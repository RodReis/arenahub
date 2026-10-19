import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/billing/delinquency',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import InadimplenciaPage from './page';

/**
 * Cobranca em tres abas -- decisao do PI, 19/10/2026 (issue #647):
 * "Pagantes Mes Atual", "Inadimplentes Mes Atual" e "Inadimplentes Mes
 * Anterior", NESTA ORDEM. O que estes testes guardam e a ordem, o contador de
 * cada aba (aluno distinto, nao fatura) e que a aba de meses anteriores lista
 * um aluno por linha, sem valor em R$.
 */

const RESUMO = {
  emAtrasoMinor: 0,
  faturasVencidas: 5,
  alunosInadimplentes: 4,
  alunosInadimplentesMesAtual: 2,
  alunosInadimplentesMesesAnteriores: 3,
  bloqueados: 1,
  taxaDeInadimplencia: 50,
};

const FAIXAS = [
  { rotulo: 'Em carência', minorTotal: 0, quantidade: 0 },
  { rotulo: 'Até 15 dias', minorTotal: 0, quantidade: 5 },
  { rotulo: '16 a 30 dias', minorTotal: 0, quantidade: 0 },
  { rotulo: 'Mais de 30 dias', minorTotal: 0, quantidade: 0 },
];

const LINHA_ATUAL = {
  invoiceId: 'inv-1',
  invoiceNumber: 8222,
  studentId: 'st-atual',
  studentName: 'Ana do Mês Atual',
  amountMinor: 15000,
  currency: 'BRL',
  dueAt: '2026-10-05T15:00:00.000Z',
  diasEmAtraso: 14,
  situacao: 'EM_CARENCIA',
  telefone: null,
  liberadoAte: null,
  fusoDaUnidade: 'America/Sao_Paulo',
};

const LINHA_PAGA = {
  invoiceId: 'inv-9',
  invoiceNumber: 9001,
  studentId: 'st-pago',
  studentName: 'Paulo Pagante',
  amountMinor: 15000,
  currency: 'BRL',
  paidAt: '2026-10-03T15:00:00.000Z',
  telefone: null,
  fusoDaUnidade: 'America/Sao_Paulo',
};

const LINHA_ANTERIOR = {
  studentId: 'st-anterior',
  studentName: 'Bruno dos Meses Anteriores',
  telefone: '41998765432',
  mesesEmAberto: ['2026-08', '2026-09'],
  faturas: 2,
  vencimentoMaisAntigo: '2026-08-10T15:00:00.000Z',
  diasEmAtraso: 70,
  situacao: 'BLOQUEADO',
  liberadoAte: null,
  fusoDaUnidade: 'America/Sao_Paulo',
};

async function renderizar() {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho.startsWith('/api/v1/billing/paid-invoices')) {
      return Promise.resolve({
        ok: true,
        dados: { total: 1, linhas: [LINHA_PAGA], proximoCursor: null },
        cookiesDaApi: [],
      });
    }
    if (caminho.startsWith('/api/v1/billing/delinquency/previous-months')) {
      return Promise.resolve({
        ok: true,
        dados: { total: 1, linhas: [LINHA_ANTERIOR], proximoCursor: null },
        cookiesDaApi: [],
      });
    }

    return Promise.resolve({
      ok: true,
      dados: { resumo: RESUMO, faixas: FAIXAS, linhas: [LINHA_ATUAL], proximoCursor: null },
      cookiesDaApi: [],
    });
  });

  const elemento = await InadimplenciaPage({ searchParams: Promise.resolve({}) });

  return render(elemento);
}

describe('Cobranca em tres abas', () => {
  it('as abas aparecem na ordem do PI, com o contador de ALUNOS de cada uma', async () => {
    await renderizar();

    const abas = screen.getAllByRole('tab');

    expect(abas.map((aba) => aba.textContent)).toEqual([
      expect.stringMatching(/^Pagantes Mês Atual\s*1$/),
      expect.stringMatching(/^Inadimplentes Mês Atual\s*2$/),
      expect.stringMatching(/^Inadimplentes Mês Anterior\s*3$/),
    ]);
  });

  it('a fila do mes atual pede so o que venceu no mes (periodo=atual)', async () => {
    await renderizar();

    const chamadas = vi.mocked(chamarApi).mock.calls.map(([caminho]) => caminho);

    expect(chamadas).toContain('/api/v1/billing/delinquency?periodo=atual');
    expect(chamadas).toContain('/api/v1/billing/delinquency/previous-months?');
  });

  it('Mes Anterior: um aluno por linha, com meses em aberto, quantidade de faturas e sem valor em R$', async () => {
    await renderizar();

    const tabela = screen.getByTestId('tabela-de-meses-anteriores');
    const linha = within(tabela).getByTestId('anterior-st-anterior');

    expect(within(linha).getByText('Bruno dos Meses Anteriores')).toBeInTheDocument();
    expect(within(linha).getByText('08/2026')).toBeInTheDocument();
    expect(within(linha).getByText('09/2026')).toBeInTheDocument();
    expect(within(linha).getByText('2')).toBeInTheDocument();
    expect(linha.textContent).not.toMatch(/R\$/);
  });

  it('Mes Anterior: o link de cobranca nao cita numero de fatura', async () => {
    await renderizar();

    const linha = within(screen.getByTestId('tabela-de-meses-anteriores')).getByTestId(
      'anterior-st-anterior',
    );
    // A aba inativa fica `hidden` (as tres ficam montadas): query por texto, nao por papel.
    const cobrar = within(linha).getByText('Cobrar no WhatsApp');
    const mensagem = decodeURIComponent(cobrar.getAttribute('href')?.split('text=')[1] ?? '');

    expect(mensagem).toContain('faturas que estao em aberto');
    expect(mensagem).not.toMatch(/fatura \d/);
  });

  it('Mes Atual mantem as colunas de hoje: fatura com data de vencimento', async () => {
    await renderizar();

    const linha = within(screen.getByTestId('tabela-de-inadimplencia')).getByTestId('fatura-inv-1');

    expect(within(linha).getByText('8222')).toBeInTheDocument();
    expect(within(linha).getByText(/venceu em/)).toBeInTheDocument();
  });
});
