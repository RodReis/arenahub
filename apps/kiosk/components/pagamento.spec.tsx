import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessaoDoAluno } from '../lib/kiosk-client.js';
import { Pagamento } from './pagamento.js';

vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  cobrarPorPix: vi.fn(),
  cobrarPorCartao: vi.fn(),
  observarCobranca: vi.fn(),
}));

const { cobrarPorPix, cobrarPorCartao, observarCobranca } = await import('../lib/kiosk-client');

const SESSAO: SessaoDoAluno = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  token: 't1',
  nome: 'Marina Duarte',
  plano: { ativo: false, pendenciaEmCentavos: 18_990 },
  expiraEm: '2026-08-26T12:01:00.000Z',
};

const COBRANCA_PIX = {
  paymentAttemptId: '22222222-2222-4222-8222-222222222222',
  forma: 'PIX' as const,
  qrCodeDataUri: 'data:image/png;base64,ZmFrZQ==',
  copiaECola: '000201...',
  checkoutUrl: null,
  expiraEm: '2026-08-26T12:30:00.000Z',
  valorEmCentavos: 18_990,
  moeda: 'BRL',
};

beforeEach(() => {
  vi.mocked(cobrarPorPix).mockReset();
  vi.mocked(cobrarPorCartao).mockReset();
  vi.mocked(observarCobranca).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Pagamento', () => {
  it('oferece as duas formas — PIX e cartão (ADR-043, Decisão 4)', () => {
    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(screen.getByTestId('forma-pix')).toBeInTheDocument();
    expect(screen.getByTestId('forma-cartao')).toBeInTheDocument();
  });

  it('diz que o cartão é digitado no celular, não no totem', () => {
    // Sem a frase, o aluno procura um leitor de cartao no totem -- que nao
    // existe, de proposito (INV-098, fora do escopo PCI).
    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(screen.getByText(/O totem não lê cartão/i)).toBeInTheDocument();
  });

  it('mostra o QR e o valor depois de escolher PIX', async () => {
    vi.mocked(cobrarPorPix).mockResolvedValue(COBRANCA_PIX);
    const usuario = userEvent.setup();

    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);
    await usuario.click(screen.getByTestId('forma-pix'));

    expect(await screen.findByTestId('bloco-do-qr')).toBeInTheDocument();
    // O VALOR aparece SO aqui -- etapa de acao deliberada (DS-TOTEM §9.1).
    expect(screen.getByTestId('valor-da-cobranca')).toHaveTextContent('189,90');
  });

  it('chama o endpoint de cartão quando o aluno escolhe cartão', async () => {
    vi.mocked(cobrarPorCartao).mockResolvedValue({ ...COBRANCA_PIX, forma: 'CARD' });
    const usuario = userEvent.setup();

    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);
    await usuario.click(screen.getByTestId('forma-cartao'));

    await waitFor(() => {
      expect(cobrarPorCartao).toHaveBeenCalledWith(SESSAO.sessionId, SESSAO.token);
    });
    expect(cobrarPorPix).not.toHaveBeenCalled();
  });

  it('NÃO oferece botão de "já paguei" — o backend é quem confirma', async () => {
    // `M4-BR-001`: retorno visual nunca confirma pagamento. Um botao aqui
    // convidaria o aluno a se autodeclarar pago.
    vi.mocked(cobrarPorPix).mockResolvedValue(COBRANCA_PIX);
    const usuario = userEvent.setup();

    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);
    await usuario.click(screen.getByTestId('forma-pix'));
    await screen.findByTestId('bloco-do-qr');

    expect(screen.queryByText(/já fiz o pagamento/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('aviso-de-confirmacao')).toBeInTheDocument();
  });

  it('confirma só quando o backend diz que a fatura está paga', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(cobrarPorPix).mockResolvedValue(COBRANCA_PIX);
    vi.mocked(observarCobranca).mockResolvedValue({
      status: 'CONFIRMED',
      statusDaFatura: 'PAID',
      pagoEm: '2026-08-26T12:05:00.000Z',
    });

    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);
    await usuario.click(screen.getByTestId('forma-pix'));
    await screen.findByTestId('bloco-do-qr');

    await vi.advanceTimersByTimeAsync(3_100);

    expect(await screen.findByTestId('pagamento-confirmado')).toBeInTheDocument();
    expect(screen.getByText(/liberado na catraca/i)).toBeInTheDocument();
  });

  it('NÃO confirma quando a fatura fecha por cancelamento', async () => {
    // `CANCELLED` e terminal e para o laco, mas nao e pagamento -- dizer
    // "confirmado" aqui mandaria o aluno para a catraca sem direito.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(cobrarPorPix).mockResolvedValue(COBRANCA_PIX);
    vi.mocked(observarCobranca).mockResolvedValue({
      status: 'FAILED',
      statusDaFatura: 'CANCELLED',
      pagoEm: null,
    });

    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);
    await usuario.click(screen.getByTestId('forma-pix'));
    await screen.findByTestId('bloco-do-qr');

    await vi.advanceTimersByTimeAsync(3_100);

    expect(screen.queryByTestId('pagamento-confirmado')).not.toBeInTheDocument();
  });

  it('avisa sem quebrar quando a cobrança não pôde ser gerada', async () => {
    vi.mocked(cobrarPorPix).mockResolvedValue(null);
    const usuario = userEvent.setup();

    render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);
    await usuario.click(screen.getByTestId('forma-pix'));

    expect(await screen.findByTestId('pagamento-falhou')).toBeInTheDocument();
  });

  it('para o laço ao desmontar — não confirma para o próximo aluno', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(cobrarPorPix).mockResolvedValue(COBRANCA_PIX);

    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<Pagamento sessao={SESSAO} aoVoltar={vi.fn()} />);

    await usuario.click(screen.getByTestId('forma-pix'));
    await screen.findByTestId('bloco-do-qr');

    unmount();
    vi.mocked(observarCobranca).mockClear();
    await vi.advanceTimersByTimeAsync(9_000);

    expect(observarCobranca).not.toHaveBeenCalled();
  });
});
