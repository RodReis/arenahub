import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@arenahub/ui';

import { receberPagamentoEmLote } from '../../../../actions/billing';
import { FaixaDeMeses } from './faixa-de-meses';
import { PainelDeCobranca } from './painel-de-cobranca';

/**
 * Faixa de meses -- F83, Task 7, com a escolha LIVRE dos meses (decisao do PI,
 * 01/10/2026: "pagou usou", sem contrato de 12 meses).
 *
 * `receberPagamentoEmLote` e mockado: e Server Action (`'use server'`), e o
 * componente so precisa provar que CHAMA com os dados certos, nao que a rota
 * de rede funciona -- isso e teste de integracao.
 *
 * `abrirCobranca` entra aqui so porque `PainelDeCobranca` (usado nos testes
 * de regressao abaixo) importa do mesmo modulo -- sem mocka-la o modulo real
 * tentaria chamar a API.
 */
vi.mock('../../../../actions/billing', () => ({
  receberPagamentoEmLote: vi.fn().mockResolvedValue({ ok: true, batchId: 'batch-1' }),
  abrirCobranca: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

const chaveDe = (faixa: readonly { competencia: string; status: string }[]) =>
  faixa.map((m) => `${m.competencia}:${m.status}`).join('|');

describe('FaixaDeMeses', () => {
  beforeEach(() => {
    vi.mocked(receberPagamentoEmLote).mockClear();
  });

  it('comeca so com a cobranca em aberto do mes corrente, sem arrastar os meses vencidos', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    expect(screen.getByText(/^1 mês/i)).toBeInTheDocument();
    expect(screen.getByText(/Total/).textContent).toMatch(/R\$\s*150,00/);
    expect(screen.getByRole('button', { name: /jul\/26/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('escolha livre: marca um mes adiantado sem criar nem exigir os anteriores', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));

    expect(screen.getByText(/^2 meses/i)).toBeInTheDocument();
    expect(screen.getByText(/Total/).textContent).toMatch(/R\$\s*300,00/);
  });

  it('pode pagar um vencido SEM pagar o mes corrente (buraco permitido)', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /set\/26/i })); // desmarca o corrente
    fireEvent.click(screen.getByRole('button', { name: /jul\/26/i }));

    expect(screen.getByText(/^1 mês/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set\/26/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /jul\/26/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicar num mes marcado desmarca; sem nenhum mes, o botao Receber fica desabilitado', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /set\/26/i }));

    expect(screen.getByRole('button', { name: /receber/i })).toBeDisabled();
  });

  /*
   * Caso do Cleibio (05/10/2026): pagou set/26 fora do lote, out/26 nunca foi
   * gerada. O mes corrente dizia "Adiantado" -- lido como "ja pago". Agora e
   * "A vencer", ja marcado; os seguintes "Antecipar".
   */
  it('aluno em dia (nenhum mes OVERDUE/OPEN): primeiro mes "A vencer" e marcado, os seguintes "Antecipar"', () => {
    const semAtraso = [
      { competencia: '2026-10', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-10-10' },
      { competencia: '2026-11', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-11-10' },
    ];

    renderComToast(<FaixaDeMeses faixa={semAtraso} subscriptionId="sub-1" onPago={vi.fn()} />);

    const outubro = screen.getByRole('button', { name: /out\/26/i });
    expect(outubro).toHaveTextContent('A vencer');
    expect(outubro).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /nov\/26/i })).toHaveTextContent('Antecipar');
    expect(screen.queryByText('Adiantado')).not.toBeInTheDocument();
  });

  it('oferece DISPENSAR os meses anteriores em aberto que ficaram de fora', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    expect(screen.getByLabelText(/Dispensar jul\/26/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dispensar ago\/26/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Dispensar out\/26/i)).not.toBeInTheDocument();
  });

  it('envia os meses escolhidos, os dispensados e a data do pagamento', async () => {
    const onPago = vi.fn();
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={onPago} />);

    fireEvent.click(screen.getByLabelText(/Dispensar jul\/26/i));
    fireEvent.change(screen.getByLabelText(/data do pagamento/i), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: /receber/i }));

    await waitFor(() => expect(receberPagamentoEmLote).toHaveBeenCalledTimes(1));
    expect(receberPagamentoEmLote).toHaveBeenCalledWith({
      subscriptionId: 'sub-1',
      competencias: ['2026-09'],
      dispensar: ['2026-07'],
      paidAt: '2026-09-20',
      channel: 'DINHEIRO',
      expectedTotalMinor: 15000,
    });
    await waitFor(() => expect(onPago).toHaveBeenCalled());
  });

  it('action que LANCA (500) mostra toast de erro, destrava o botao e recarrega a faixa', async () => {
    vi.mocked(receberPagamentoEmLote).mockRejectedValueOnce(new Error('500'));
    const onPago = vi.fn();
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={onPago} />);

    fireEvent.click(screen.getByRole('button', { name: /^receber$/i }));

    expect(await screen.findByTestId('erro-lote')).toHaveTextContent(/não foi possível confirmar/i);
    expect(screen.getByRole('button', { name: /^receber$/i })).toBeEnabled();
    expect(onPago).toHaveBeenCalledTimes(1);
  });

  it('OPEN com vencimento no passado aparece Vencido no chip, mesmo sem o job ter gravado OVERDUE', () => {
    // set/26 vence em 09/09; o relogio do navegador do teste esta depois disso.
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    const setembro = screen.getByRole('button', { name: /set\/26/i });
    expect(setembro).toHaveAttribute('data-tom', 'vencido');
    expect(setembro).toHaveTextContent('Vencido');
  });

  it('mostra ate quando vale o pagamento: data + 30 dias por mes, mais a carencia', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/data do pagamento/i), { target: { value: '2026-09-15' } });
    expect(screen.getByText(/Vigente até 15\/10\/2026, mais a carência/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));
    expect(screen.getByText(/Vigente até 14\/11\/2026, mais a carência/i)).toBeInTheDocument();
  });

  it('data de pagamento futura e recusada: erro na tela e botao desabilitado', () => {
    renderComToast(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/data do pagamento/i), { target: { value: '2999-01-01' } });

    expect(screen.getByText(/não pode ser futura/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /receber/i })).toBeDisabled();
  });

  /**
   * Guarda de regressao do bug CRITICO achado na revisao (fix round 2):
   * `useState(() => selecaoInicial(faixa))` so roda no mount -- sem `key`
   * mudando em `painel-de-cobranca.tsx`, `router.refresh()` troca a prop
   * `faixa` mas a selecao do ciclo ANTERIOR sobrevive, podendo marcar como
   * selecionados meses que o aluno nao pediu para pagar.
   */
  it('troca de faixa com key nova (pagamento anterior) recalcula a selecao, nao herda a antiga', () => {
    const depoisDoPagamento = [
      { competencia: '2026-10', status: 'OPEN' as const, invoiceId: 'out', totalMinor: 15000, dueAt: '2026-10-09' },
      { competencia: '2026-11', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-11-09' },
      { competencia: '2026-12', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-12-09' },
    ];
    const onPago = vi.fn();

    const { rerender } = renderComToast(
      <FaixaDeMeses key={chaveDe(FAIXA)} faixa={FAIXA} subscriptionId="sub-1" onPago={onPago} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));
    expect(screen.getByText(/^2 meses/i)).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <FaixaDeMeses key={chaveDe(depoisDoPagamento)} faixa={depoisDoPagamento} subscriptionId="sub-1" onPago={onPago} />
      </ToastProvider>,
    );

    expect(screen.getByText(/^1 mês/i)).toBeInTheDocument();
    expect(screen.getByText(/Total/).textContent).toMatch(/R\$\s*150,00/);
    expect(screen.getByRole('button', { name: /nov\/26/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /dez\/26/i })).toHaveAttribute('aria-pressed', 'false');
  });

  /** Contraprova: re-render por motivo nao relacionado NAO reseta a escolha da recepcao. */
  it('re-render com a MESMA faixa (mesma key) preserva a selecao que o usuario escolheu', () => {
    const { rerender } = renderComToast(
      <FaixaDeMeses key={chaveDe(FAIXA)} faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));
    expect(screen.getByText(/^2 meses/i)).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <FaixaDeMeses key={chaveDe(FAIXA)} faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />
      </ToastProvider>,
    );

    expect(screen.getByText(/^2 meses/i)).toBeInTheDocument();
  });
});

/**
 * Guarda de regressao de verdade do bug CRITICO (fix round 2/3): renderiza o
 * `PainelDeCobranca` DE VERDADE e prova que o `key` de `FaixaDeMeses` la
 * dentro recalcula a selecao quando o conteudo da faixa muda.
 */
describe('PainelDeCobranca -- key de FaixaDeMeses (regressao de verdade)', () => {
  const FAIXA_B = [
    { competencia: '2026-10', status: 'OPEN' as const, invoiceId: 'out', totalMinor: 15000, dueAt: '2026-10-09' },
    { competencia: '2026-11', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-11-09' },
    { competencia: '2026-12', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-12-09' },
  ];

  it('conteudo da faixa muda (pagamento anterior) -> selecao recalcula a partir da faixa NOVA', () => {
    const { rerender } = renderComToast(
      <PainelDeCobranca subscriptionId="sub-1" subscriptionIdParaPagamento="sub-1" mesesPagaveis={FAIXA} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));
    expect(screen.getByText(/^2 meses/i)).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <PainelDeCobranca subscriptionId="sub-1" subscriptionIdParaPagamento="sub-1" mesesPagaveis={FAIXA_B} />
      </ToastProvider>,
    );

    expect(screen.getByText(/^1 mês/i)).toBeInTheDocument();
    expect(screen.getByText(/Total/).textContent).toMatch(/R\$\s*150,00/);
    expect(screen.getByRole('button', { name: /nov\/26/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('re-render com faixa de MESMO conteudo (nova referencia de array) -> preserva a selecao do usuario', () => {
    const faixaMesmoConteudo = FAIXA.map((m) => ({ ...m }));

    const { rerender } = renderComToast(
      <PainelDeCobranca subscriptionId="sub-1" subscriptionIdParaPagamento="sub-1" mesesPagaveis={FAIXA} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));
    expect(screen.getByText(/^2 meses/i)).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <PainelDeCobranca subscriptionId="sub-1" subscriptionIdParaPagamento="sub-1" mesesPagaveis={faixaMesmoConteudo} />
      </ToastProvider>,
    );

    expect(screen.getByText(/^2 meses/i)).toBeInTheDocument();
  });
});
