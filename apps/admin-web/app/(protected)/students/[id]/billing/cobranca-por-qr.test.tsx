import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CobrancaPorQr } from './cobranca-por-qr';

/** Espelha `INTERVALO_DE_POLLING_MS` da tela -- o laco roda a cada 3s. */
const INTERVALO_DE_POLLING_MS = 3_000;

/**
 * O laco de polling do balcao -- F53, Task 11.
 *
 * A CENA REAL: a recepcao deixa esta tela aberta o expediente inteiro
 * enquanto o aluno paga pelo celular. O laco tem de PARAR sozinho -- senao a
 * aba fica consultando a API pelo resto do dia, por caixa.
 */
const props = {
  paymentAttemptId: 'tentativa-1',
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
    const consultar = vi
      .fn()
      .mockResolvedValue({ invoiceStatus: 'PAID', receiptId: 'rec-1', paymentId: 'pag-1' });
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
    const consultar = vi
      .fn()
      .mockResolvedValue({ invoiceStatus: 'OPEN', receiptId: null, paymentId: null });
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

  /*
   * PARA NO EXPIRADO EM VOO -- caso DIFERENTE do anterior: o QR nasce
   * VALIDO (o laco comeca e consulta normalmente), e expira enquanto a
   * recepcao esta olhando a tela, com o laco ja rodando. O teste acima so
   * cobre o QR que ja chega morto (barrado por `jaExpirado`, antes do laco
   * comecar); este cobre o bloco de checagem DENTRO do `setInterval`, que
   * aquele nunca exercita.
   *
   * Prova por mutacao: removendo o bloco `if (expiresAt <= now) { ... }` de
   * dentro do `setInterval`, este teste FALHA (a suite antiga ficava 171/171
   * verde com o bloco removido -- guarda decorativa). Ver task-11-report.md.
   */
  it('para de consultar quando o QR expira com o laco ja rodando', async () => {
    vi.useFakeTimers();

    const consultar = vi
      .fn()
      .mockResolvedValue({ invoiceStatus: 'OPEN', receiptId: null, paymentId: null });
    const expiresAt = new Date(Date.now() + 4_000).toISOString();

    act(() => {
      render(<CobrancaPorQr {...props} expiresAt={expiresAt} consultar={consultar} />);
    });

    // Consulta inicial, disparada no mount -- o laco comecou de verdade.
    expect(consultar).toHaveBeenCalledTimes(1);

    // Avanca ate pouco antes de expirar: mais um tick do polling (3s),
    // ainda dentro da validade -- prova que o laco consulta normalmente
    // enquanto o QR e valido.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(consultar).toHaveBeenCalledTimes(2);

    // Avanca para depois de `expiresAt` (4s) -- o proximo tick do
    // `setInterval` (6s desde o mount) tem de ver a expiracao ANTES de
    // consultar, e parar sem chamar `consultar` de novo. Sem a guarda no
    // topo do callback do `setInterval`, este tick chamaria `consultar` e SO
    // DEPOIS, na resposta, perceberia a expiracao -- por isso a contagem e
    // conferida IMEDIATAMENTE apos este avanco, antes de qualquer tick
    // seguinte poder mascarar a chamada extra.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(screen.getByText(/QR expirado\. Gere um novo código\./i)).toBeInTheDocument();
    // A guarda correta pula o tick de 6s inteiro -- continua em 2. Com a
    // guarda removida do `setInterval`, este tick chama `consultar` antes de
    // notar a expiracao na resposta, e o contador vai a 3.
    expect(consultar).toHaveBeenCalledTimes(2);

    const chamadasAoExpirar = consultar.mock.calls.length;

    // Mais um ciclo inteiro de polling (3s): se a guarda foi removida, o
    // laco chamaria `consultar` de novo aqui.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(consultar.mock.calls.length).toBe(chamadasAoExpirar);
  });
  /*
   * FIX #165: O RECIBO QUE JA VEIO NAO SE REDESCOBRE.
   *
   * `GET /payment-attempts/:id` -- a leitura barata do laco -- ja devolve
   * `receiptId`. Ate este fix a tela ignorava o campo e refazia o caminho com
   * tres viagens. Consultar e emitir sao rotas DIFERENTES, e o teste separa as
   * duas: emitir um recibo que ja existe gastaria um POST a toa.
   */
  it('consulta o recibo que o polling ja trouxe, sem emitir de novo', async () => {
    const consultar = vi
      .fn()
      .mockResolvedValue({ invoiceStatus: 'PAID', receiptId: 'rec-7', paymentId: 'pag-7' });
    const consultarRecibo = vi
      .fn()
      .mockResolvedValue({ sucesso: { receiptId: 'rec-7', numero: 42, verificationHash: 'abc' } });
    const emitirRecibo = vi.fn();

    render(
      <CobrancaPorQr
        {...props}
        consultar={consultar}
        consultarRecibo={consultarRecibo}
        emitirRecibo={emitirRecibo}
      />,
    );

    await waitFor(() => expect(consultarRecibo).toHaveBeenCalledWith('rec-7'));
    expect(emitirRecibo).not.toHaveBeenCalled();
  });

  /*
   * O OUTRO RAMO: pago, mas o recibo ainda nao existe. Emite pelo `paymentId`
   * que a MESMA leitura entrega -- nao pelo `invoiceId`, que exigia descobrir
   * o pagamento com uma viagem extra e um palpite ("o ultimo CONFIRMED").
   */
  it('emite pelo paymentId do polling quando o recibo ainda nao existe', async () => {
    const consultar = vi
      .fn()
      .mockResolvedValue({ invoiceStatus: 'PAID', receiptId: null, paymentId: 'pag-9' });
    const emitirRecibo = vi
      .fn()
      .mockResolvedValue({ sucesso: { receiptId: 'rec-9', numero: 9, verificationHash: 'def' } });
    const consultarRecibo = vi.fn();

    render(
      <CobrancaPorQr
        {...props}
        consultar={consultar}
        consultarRecibo={consultarRecibo}
        emitirRecibo={emitirRecibo}
      />,
    );

    await waitFor(() => expect(emitirRecibo).toHaveBeenCalledWith('pag-9'));
    expect(consultarRecibo).not.toHaveBeenCalled();
  });

  /*
   * A JANELA TRANSITORIA: o webhook confirmou a invoice e o pagamento ainda
   * nao apareceu nesta leitura. Emitir com `null` viraria `POST
   * /payments/null/receipt`; travar de vez deixaria a recepcao sem recibo.
   * O certo e nao pedir nada AINDA -- e pedir quando o dado chegar.
   */
  it('espera o paymentId aparecer em vez de emitir com nulo', async () => {
    vi.useFakeTimers();

    const consultar = vi
      .fn()
      .mockResolvedValueOnce({ invoiceStatus: 'PAID', receiptId: null, paymentId: null })
      .mockResolvedValue({ invoiceStatus: 'PAID', receiptId: null, paymentId: 'pag-tardio' });
    const emitirRecibo = vi
      .fn()
      .mockResolvedValue({ sucesso: { receiptId: 'r', numero: 1, verificationHash: 'h' } });

    render(
      <CobrancaPorQr
        {...props}
        expiresAt={new Date(Date.now() + 5 * 60 * 1000).toISOString()}
        consultar={consultar}
        emitirRecibo={emitirRecibo}
      />,
    );

    // Primeira leitura: invoice paga, mas sem NADA com que emitir.
    await act(async () => {
      await Promise.resolve();
    });
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(emitirRecibo).not.toHaveBeenCalled();

    /*
     * O LACO NAO PODE TER MORRIDO AQUI. Antes do fix ele parava no PAID e a
     * tela ficava sem recibo para sempre. O tick seguinte e o que prova que
     * ainda ha quem pergunte -- e e nele que o `paymentId` aparece.
     */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DE_POLLING_MS);
    });

    expect(consultar.mock.calls.length).toBeGreaterThan(1);
    expect(emitirRecibo).toHaveBeenCalledWith('pag-tardio');
  });
});
