import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@arenahub/ui';

import { FaixaDeMeses } from './faixa-de-meses';

/**
 * Faixa de meses -- F83, Task 7.
 *
 * `receberPagamentoEmLote` e mockado: e Server Action (`'use server'`), e o
 * componente so precisa provar que CHAMA com os dados certos, nao que a rota
 * de rede funciona -- isso e teste de integracao (F83, Task 5).
 */
vi.mock('../../../../actions/billing', () => ({
  receberPagamentoEmLote: vi.fn().mockResolvedValue({ ok: true, batchId: 'batch-1' }),
}));

/** `useToast` exige `<ToastProvider>` acima na arvore -- mesmo padrao de `fila-de-moderacao.test.tsx`. */
function renderComToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const FAIXA = [
  { competencia: '2026-07', status: 'OVERDUE' as const, invoiceId: 'jul', totalMinor: 15000, dueAt: '2026-07-09' },
  { competencia: '2026-08', status: 'OVERDUE' as const, invoiceId: 'ago', totalMinor: 15000, dueAt: '2026-08-09' },
  { competencia: '2026-09', status: 'OPEN' as const, invoiceId: 'set', totalMinor: 15000, dueAt: '2026-09-09' },
  { competencia: '2026-10', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-10-09' },
];

describe('FaixaDeMeses', () => {
  it('seleciona do vencido mais antigo ate o mes corrente por padrao', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    // set (OPEN, mes corrente) e o ultimo selecionado por padrao -- os dois
    // OVERDUE (jul, ago) tambem estao selecionados.
    expect(screen.getByText(/3 meses/i)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 450,00/)).toBeInTheDocument();
  });

  it('clicar num mes adiantado estende a selecao sem criar buraco', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));

    expect(screen.getByText(/4 meses/i)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 600,00/)).toBeInTheDocument();
  });

  it('clicar no ultimo mes selecionado recua a selecao em um', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    // set esta selecionado por padrao (ultimo da selecao inicial)
    fireEvent.click(screen.getByRole('button', { name: /set\/26/i }));

    expect(screen.getByText(/2 meses/i)).toBeInTheDocument();
  });

  it('aluno em dia (nenhum mes OVERDUE/OPEN antes do corrente) comeca sem selecao e botao desabilitado', () => {
    const semAtraso = [{ competencia: '2026-09', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-09-09' }];

    renderComToast(<FaixaDeMeses faixa={semAtraso} subscriptionId="sub-1" onPago={vi.fn()} />);

    expect(screen.getByRole('button', { name: /receber/i })).toBeDisabled();
  });
});
