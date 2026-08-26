import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinhaDePagamento, SessaoDoAluno } from '../lib/kiosk-client.js';
import { HistoricoDePagamentos } from './historico-de-pagamentos.js';

vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  carregarPagamentos: vi.fn(),
}));

const { carregarPagamentos } = await import('../lib/kiosk-client');

const SESSAO: SessaoDoAluno = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  token: 't1',
  nome: 'Marina Duarte',
  plano: { ativo: false, pendenciaEmCentavos: 18_990 },
  expiraEm: '2026-08-26T12:01:00.000Z',
};

const ABERTA: LinhaDePagamento = {
  invoiceId: 'i-aberta',
  status: 'OVERDUE',
  vencimentoEm: '2026-08-10T00:00:00.000Z',
  pagoEm: null,
  valorEmCentavos: 18_990,
  moeda: 'BRL',
  emAberto: true,
};

const PAGA: LinhaDePagamento = {
  invoiceId: 'i-paga',
  status: 'PAID',
  vencimentoEm: '2026-07-10T00:00:00.000Z',
  pagoEm: '2026-07-09T00:00:00.000Z',
  valorEmCentavos: 18_990,
  moeda: 'BRL',
  emAberto: false,
};

beforeEach(() => {
  vi.mocked(carregarPagamentos).mockReset().mockResolvedValue([ABERTA, PAGA]);
});

describe('HistoricoDePagamentos', () => {
  it('lista as faturas com valor e estado', async () => {
    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={vi.fn()} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('lista-de-pagamentos')).toBeInTheDocument();
    expect(screen.getByTestId('pagamento-i-paga')).toHaveTextContent('189,90');
  });

  it('nomeia o estado em texto, nunca só por cor', async () => {
    // Checklist §8, acessibilidade: estado comunicado so por cor nao chega a
    // quem nao distingue as cores.
    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={vi.fn()} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('status-i-aberta')).toHaveTextContent('Vencida');
    expect(screen.getByTestId('status-i-paga')).toHaveTextContent('Paga');
  });

  it('oferece pagar a fatura em aberto, com o valor', async () => {
    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={vi.fn()} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('pagar-em-aberto')).toHaveTextContent('189,90');
  });

  it('NÃO oferece pagar quando o módulo de pagamento está desligado', async () => {
    // `aoPagar` indefinido = modulo desligado. Oferecer um caminho que o
    // servidor recusaria com 404 seria pior que nao oferece-lo.
    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={undefined} aoVoltar={vi.fn()} />);

    await screen.findByTestId('lista-de-pagamentos');
    expect(screen.queryByTestId('pagar-em-aberto')).not.toBeInTheDocument();
  });

  it('não oferece pagar quando não há fatura em aberto', async () => {
    vi.mocked(carregarPagamentos).mockResolvedValue([PAGA]);

    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={vi.fn()} aoVoltar={vi.fn()} />);

    await screen.findByTestId('lista-de-pagamentos');
    expect(screen.queryByTestId('pagar-em-aberto')).not.toBeInTheDocument();
  });

  it('leva ao pagamento ao tocar no CTA', async () => {
    const aoPagar = vi.fn();
    const usuario = userEvent.setup();

    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={aoPagar} aoVoltar={vi.fn()} />);
    await usuario.click(await screen.findByTestId('pagar-em-aberto'));

    expect(aoPagar).toHaveBeenCalledOnce();
  });

  it('avisa sem quebrar quando a rede cai', async () => {
    vi.mocked(carregarPagamentos).mockResolvedValue(null);

    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={vi.fn()} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('pagamentos-falhou')).toBeInTheDocument();
  });

  it('explica quando o aluno não tem fatura nenhuma', async () => {
    vi.mocked(carregarPagamentos).mockResolvedValue([]);

    render(<HistoricoDePagamentos sessao={SESSAO} aoPagar={vi.fn()} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('sem-pagamentos')).toBeInTheDocument();
  });
});
