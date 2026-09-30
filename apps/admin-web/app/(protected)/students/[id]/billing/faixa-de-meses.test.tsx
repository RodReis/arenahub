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

  /**
   * Guarda de regressao do bug CRITICO achado na revisao (fix round 2):
   * `useState(() => indiceInicial(faixa))` so roda no mount -- sem `key`
   * mudando em `painel-de-cobranca.tsx`, `router.refresh()` troca a prop
   * `faixa` mas a selecao (indices) do ciclo ANTERIOR sobrevive, podendo
   * marcar como selecionados meses que o aluno nao pediu para pagar.
   *
   * O fix e o `key` em `painel-de-cobranca.tsx` (nao algo dentro deste
   * componente) -- entao o teste precisa provar o comportamento que o
   * CONSUMIDOR (`painel-de-cobranca.tsx`) obtem: renderizar com uma key,
   * trocar para uma key diferente (o mesmo padrao de
   * `mesesPagaveis.map(...).join('|')`) e confirmar que a selecao foi
   * recalculada a partir da NOVA faixa, nao herdada da antiga.
   *
   * Sem o `key` no `rerender` (ou seja, testando so com `rerender` simples),
   * este teste passaria mesmo ANTES do fix -- porque RTL tambem preserva a
   * instancia sem uma key que mude. A key mudando e o que faz o React
   * desmontar/remontar, exatamente o que `painel-de-cobranca.tsx` faz.
   */
  it('troca de faixa com key nova (pagamento anterior) recalcula a selecao, nao herda indices antigos', () => {
    const antesDoPagamento = FAIXA; // jul/ago OVERDUE, set OPEN, out NOT_OPENED

    // Depois de pagar jul/ago/set em lote: esses 3 meses somem da faixa e
    // entram novos meses adiantados (nov, dez) -- exatamente como o server
    // re-fetch devolveria apos `router.refresh()`.
    const depoisDoPagamento = [
      { competencia: '2026-10', status: 'OPEN' as const, invoiceId: 'out', totalMinor: 15000, dueAt: '2026-10-09' },
      { competencia: '2026-11', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-11-09' },
      { competencia: '2026-12', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-12-09' },
    ];

    const chaveDe = (faixa: typeof antesDoPagamento) => faixa.map((m) => `${m.competencia}:${m.status}`).join('|');

    const onPago = vi.fn();

    const { rerender } = renderComToast(
      <FaixaDeMeses key={chaveDe(antesDoPagamento)} faixa={antesDoPagamento} subscriptionId="sub-1" onPago={onPago} />,
    );

    // Selecao inicial: 3 meses (jul, ago, set) -- confirma o estado ANTES do pagamento.
    expect(screen.getByText(/3 meses/i)).toBeInTheDocument();

    // `router.refresh()` troca a prop `faixa` E o `key` (padrao de
    // `painel-de-cobranca.tsx`) -- simula o ciclo completo de pagamento.
    rerender(
      <ToastProvider>
        <FaixaDeMeses key={chaveDe(depoisDoPagamento)} faixa={depoisDoPagamento} subscriptionId="sub-1" onPago={onPago} />
      </ToastProvider>,
    );

    // A NOVA faixa comeca com "out" OPEN -- indiceInicial deve selecionar
    // so ele (1 mes), nunca os 3 antigos (que nem existem mais na faixa) nem
    // um indice desalinhado que aponte para "nov" ou "dez" por engano. O
    // resumo (unico <p>, "1 mês · out/26 a out/26 · Total R$ 150,00") prova
    // a contagem E o total sem colidir com o valor repetido em cada chip.
    expect(screen.getByText(/^1 mês/i)).toBeInTheDocument();
    expect(screen.getByText(/Total/).textContent).toMatch(/R\$\s*150,00/);

    // Confirma que "nov" e "dez" (adiantados) NAO estao marcados como
    // selecionados -- seriam cobrados por engano se a selecao antiga vazasse.
    expect(screen.getByRole('button', { name: /nov\/26/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /dez\/26/i })).toHaveAttribute('aria-pressed', 'false');
  });

  /**
   * Contraprova do teste acima: quando o pai re-renderiza por um motivo NAO
   * relacionado (a mesma `faixa`, mesmo `key`), a selecao EM PROGRESSO do
   * usuario nao pode ser resetada. Prova que o fix (key) nao regride em
   * over-reset.
   */
  it('re-render com a MESMA faixa (mesma key) preserva a selecao que o usuario escolheu', () => {
    const chaveDe = (faixa: typeof FAIXA) => faixa.map((m) => `${m.competencia}:${m.status}`).join('|');
    const onPagoA = vi.fn();
    const onPagoB = vi.fn(); // prop diferente == re-render "por motivo nao relacionado"

    const { rerender } = renderComToast(
      <FaixaDeMeses key={chaveDe(FAIXA)} faixa={FAIXA} subscriptionId="sub-1" onPago={onPagoA} />,
    );

    // Usuario estende a selecao para incluir "out" (adiantado).
    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));
    expect(screen.getByText(/4 meses/i)).toBeInTheDocument();

    // Mesma key, mesma faixa, so uma prop nao-relacionada (onPago) mudou --
    // React NAO remonta, e a selecao do usuario deve sobreviver.
    rerender(
      <ToastProvider>
        <FaixaDeMeses key={chaveDe(FAIXA)} faixa={FAIXA} subscriptionId="sub-1" onPago={onPagoB} />
      </ToastProvider>,
    );

    expect(screen.getByText(/4 meses/i)).toBeInTheDocument();
  });
});
