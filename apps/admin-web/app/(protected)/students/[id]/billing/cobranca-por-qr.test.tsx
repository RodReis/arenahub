import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CobrancaPorQr } from './cobranca-por-qr';

/**
 * O laco de polling do balcao -- F53, Task 11.
 *
 * A CENA REAL: a recepcao deixa esta tela aberta o expediente inteiro
 * enquanto o aluno paga pelo celular. O laco tem de PARAR sozinho -- senao a
 * aba fica consultando a API pelo resto do dia, por caixa.
 */
const props = {
  paymentAttemptId: 'tentativa-1',
  invoiceId: 'invoice-1',
  qrCodeDataUri: 'data:image/png;base64,fake',
  copiaECola: '00020126...copia-e-cola',
  checkoutUrl: null,
  expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
};

describe('CobrancaPorQr', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /*
   * PARA NO TERMINAL. Laco que nao para nunca deixa a aba consultando a API
   * pelo resto do expediente -- e a recepcao mantem a tela aberta o dia todo.
   */
  it('para de consultar quando a invoice fica paga', async () => {
    const consultar = vi.fn().mockResolvedValue({ invoiceStatus: 'PAID', receiptId: 'rec-1' });
    render(<CobrancaPorQr {...props} consultar={consultar} />);

    await waitFor(() => expect(screen.getByTestId('pagamento-confirmado')).toBeInTheDocument());

    const chamadasAteAgora = consultar.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(consultar.mock.calls.length).toBe(chamadasAteAgora);
  });

  /*
   * PARA NO EXPIRADO, com a frase da spec SS9.1 -- e nao girando para sempre
   * contra um QR que nenhum banco aceita mais.
   */
  it('para e oferece novo codigo quando o QR expira', async () => {
    const consultar = vi.fn().mockResolvedValue({ invoiceStatus: 'OPEN', receiptId: null });
    render(
      <CobrancaPorQr
        {...props}
        expiresAt={new Date(Date.now() - 1000).toISOString()}
        consultar={consultar}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/QR expirado\. Gere um novo código\./i)).toBeInTheDocument(),
    );
    expect(consultar).not.toHaveBeenCalled();
  });
});
