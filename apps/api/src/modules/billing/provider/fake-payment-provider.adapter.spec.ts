import { describe, expect, it } from '@jest/globals';

import {
  FakePaymentProvider,
  HEADER_DE_ASSINATURA,
  PROVEDOR_FAKE,
  assinarCorpo,
} from './fake-payment-provider.adapter.js';
import { ErroDoProvedor, type CreatePixInput } from './payment-provider.port.js';

/**
 * Contrato do duble do provedor. `docs/TESTING.md` 3.
 *
 * O que estes testes protegem NAO e o fake: e a suposicao que os testes de
 * integracao fazem sobre ele. Se o fake aceitasse assinatura errada, o teste
 * de INV-077 passaria com a verificacao deletada -- e ninguem saberia.
 */

const CONTA = 'acct_fake_001';
const SEGREDO = 'segredo-de-teste-nao-usado-em-lugar-nenhum';

function provedorComConta(): FakePaymentProvider {
  const provedor = new FakePaymentProvider();
  provedor.registrarConta(CONTA, SEGREDO);
  return provedor;
}

function entradaPix(sobrescreve: Partial<CreatePixInput> = {}): CreatePixInput {
  return {
    externalAccountId: CONTA,
    amountMinor: 12_000,
    currency: 'BRL',
    idempotencyKey: 'inv_001:pix:1',
    expiresAt: new Date('2026-08-19T12:00:00Z'),
    descricao: 'Mensalidade',
    ...sobrescreve,
  };
}

function corpoDeWebhook(sobrescreve: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      externalEventId: 'evt_001',
      externalAccountId: CONTA,
      tipo: 'PAYMENT_CONFIRMED',
      externalPaymentId: 'fake_pay_x',
      occurredAt: '2026-08-18T12:00:00.000Z',
      ...sobrescreve,
    }),
  );
}

describe('FakePaymentProvider.createPix', () => {
  it('devolve copia-e-cola e QR Code', async () => {
    const cobranca = await provedorComConta().createPix(entradaPix());

    expect(cobranca.externalPaymentId).toMatch(/^fake_pay_/);
    expect(cobranca.copiaECola).toContain(cobranca.externalPaymentId);
    expect(cobranca.qrCodeDataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('mesma chave de idempotencia devolve a MESMA cobranca -- retry nao duplica', async () => {
    const provedor = provedorComConta();

    const primeira = await provedor.createPix(entradaPix());
    const segunda = await provedor.createPix(entradaPix());

    expect(segunda.externalPaymentId).toBe(primeira.externalPaymentId);
  });

  it('chave diferente cria cobranca diferente', async () => {
    const provedor = provedorComConta();

    const primeira = await provedor.createPix(entradaPix());
    const segunda = await provedor.createPix(entradaPix({ idempotencyKey: 'inv_001:pix:2' }));

    expect(segunda.externalPaymentId).not.toBe(primeira.externalPaymentId);
  });

  it('recusa valor nao positivo', () => {
    expect(() => provedorComConta().createPix(entradaPix({ amountMinor: 0 }))).toThrow(
      ErroDoProvedor,
    );
  });
});

describe('FakePaymentProvider.getPaymentStatus', () => {
  it('nasce PENDING e acompanha a mudanca simulada', async () => {
    const provedor = provedorComConta();
    const cobranca = await provedor.createPix(entradaPix());

    expect((await provedor.getPaymentStatus(cobranca.externalPaymentId)).status).toBe('PENDING');

    provedor.simularMudancaDeStatus(
      cobranca.externalPaymentId,
      'CONFIRMED',
      new Date('2026-08-18T12:30:00Z'),
    );

    const depois = await provedor.getPaymentStatus(cobranca.externalPaymentId);
    expect(depois.status).toBe('CONFIRMED');
    expect(depois.occurredAt).toEqual(new Date('2026-08-18T12:30:00Z'));
  });

  it('cobranca inexistente e erro nao recuperavel', () => {
    expect(() => provedorComConta().getPaymentStatus('fake_pay_inexistente')).toThrow(
      ErroDoProvedor,
    );
  });
});

describe('FakePaymentProvider.verifyAndParseWebhook -- INV-077', () => {
  function requisicao(rawBody: Buffer, assinatura: string | undefined) {
    return {
      rawBody,
      headers: { [HEADER_DE_ASSINATURA]: assinatura },
      provider: PROVEDOR_FAKE,
    };
  }

  it('assinatura valida devolve evento traduzido', async () => {
    const corpo = corpoDeWebhook();
    const evento = await provedorComConta().verifyAndParseWebhook(
      requisicao(corpo, assinarCorpo(corpo, SEGREDO)),
    );

    expect(evento).toEqual({
      externalEventId: 'evt_001',
      externalAccountId: CONTA,
      tipo: 'PAYMENT_CONFIRMED',
      externalPaymentId: 'fake_pay_x',
      occurredAt: new Date('2026-08-18T12:00:00.000Z'),
      payload: expect.objectContaining({ externalEventId: 'evt_001' }),
    });
  });

  it('assinatura errada e recusada', () => {
    const corpo = corpoDeWebhook();

    expect(() =>
      provedorComConta().verifyAndParseWebhook(
        requisicao(corpo, assinarCorpo(corpo, 'outro-segredo')),
      ),
    ).toThrow(ErroDoProvedor);
  });

  it('corpo alterado depois de assinado e recusado -- e o ponto do HMAC', () => {
    const original = corpoDeWebhook();
    const assinatura = assinarCorpo(original, SEGREDO);
    const adulterado = corpoDeWebhook({ externalPaymentId: 'fake_pay_de_outra_pessoa' });

    expect(() => provedorComConta().verifyAndParseWebhook(requisicao(adulterado, assinatura))).toThrow(
      ErroDoProvedor,
    );
  });

  it('sem header de assinatura e recusado', () => {
    expect(() =>
      provedorComConta().verifyAndParseWebhook(requisicao(corpoDeWebhook(), undefined)),
    ).toThrow(ErroDoProvedor);
  });

  it('conta desconhecida e recusada -- INV-078 nao aceita tenant do payload', () => {
    const corpo = corpoDeWebhook({ externalAccountId: 'acct_de_ninguem' });

    expect(() =>
      provedorComConta().verifyAndParseWebhook(requisicao(corpo, assinarCorpo(corpo, SEGREDO))),
    ).toThrow(ErroDoProvedor);
  });

  it('corpo que nao e JSON e recusado', () => {
    const corpo = Buffer.from('nao sou json');

    expect(() =>
      provedorComConta().verifyAndParseWebhook(requisicao(corpo, assinarCorpo(corpo, SEGREDO))),
    ).toThrow(ErroDoProvedor);
  });

  it('campo obrigatorio ausente e recusado', () => {
    const corpo = Buffer.from(JSON.stringify({ externalAccountId: CONTA }));

    expect(() =>
      provedorComConta().verifyAndParseWebhook(requisicao(corpo, assinarCorpo(corpo, SEGREDO))),
    ).toThrow(ErroDoProvedor);
  });
});

/**
 * Cria uma cobranca ja confirmada no provedor, que e a unica situacao em que
 * o estorno faz sentido.
 */
async function pagamentoConfirmado(
  provedor: FakePaymentProvider,
  quando: Date,
  valorMinor = 12_000,
): Promise<string> {
  const cobranca = await provedor.createPix(
    entradaPix({ amountMinor: valorMinor, expiresAt: quando }),
  );
  provedor.simularMudancaDeStatus(cobranca.externalPaymentId, 'CONFIRMED', quando);
  return cobranca.externalPaymentId;
}

describe('FakePaymentProvider.refundPayment -- F16', () => {
  /**
   * A lista de "metodos de fatia futura" ACABOU nesta fatia: `refundPayment`
   * era o ultimo que estourava, e `listMovements` nasceu implementado. O que
   * substitui a lista sao estes testes -- um metodo que devolvesse dado
   * inventado passaria por resposta de provedor, e nenhum teste de integracao
   * notaria.
   */
  const QUANDO = new Date('2026-08-10T12:00:00Z');

  it('estorna pagamento confirmado', async () => {
    const provedor = provedorComConta();
    const pagamento = await pagamentoConfirmado(provedor, QUANDO);

    const estorno = await provedor.refundPayment({
      externalPaymentId: pagamento,
      amountMinor: 12_000,
      idempotencyKey: 'inv_001:refund:1',
    });

    expect(estorno.externalRefundId).toMatch(/^fake_ref_/);
    expect(estorno.status).toBe('CONFIRMED');
    expect(estorno.amountMinor).toBe(12_000);
  });

  it('MESMA CHAVE DEVOLVE O MESMO ESTORNO -- retry nao devolve em dobro', async () => {
    const provedor = provedorComConta();
    const pagamento = await pagamentoConfirmado(provedor, QUANDO);
    const pedido = {
      externalPaymentId: pagamento,
      amountMinor: 6_000,
      idempotencyKey: 'inv_001:refund:1',
    };

    const primeiro = await provedor.refundPayment(pedido);
    const segundo = await provedor.refundPayment(pedido);

    expect(segundo.externalRefundId).toBe(primeiro.externalRefundId);
  });

  it('recusa estorno de pagamento ainda pendente', async () => {
    const provedor = provedorComConta();
    const cobranca = await provedor.createPix(entradaPix());

    // `toThrow` e nao `rejects`: o duble estoura SINCRONO, porque o metodo nao
    // e `async` -- a validacao acontece antes de existir Promise. Mesmo padrao
    // dos outros metodos deste arquivo.
    expect(() =>
      provedor.refundPayment({
        externalPaymentId: cobranca.externalPaymentId,
        amountMinor: 100,
        idempotencyKey: 'k',
      }),
    ).toThrow(ErroDoProvedor);
  });

  it('recusa estorno de pagamento inexistente', () => {
    expect(() =>
      new FakePaymentProvider().refundPayment({
        externalPaymentId: 'fake_pay_inexistente',
        amountMinor: 100,
        idempotencyKey: 'k',
      }),
    ).toThrow(ErroDoProvedor);
  });

  it('recusa quando os parciais somados passam do pagamento', async () => {
    const provedor = provedorComConta();
    const pagamento = await pagamentoConfirmado(provedor, QUANDO);

    await provedor.refundPayment({
      externalPaymentId: pagamento,
      amountMinor: 7_200,
      idempotencyKey: 'k1',
    });

    expect(() =>
      provedor.refundPayment({
        externalPaymentId: pagamento,
        amountMinor: 7_200,
        idempotencyKey: 'k2',
      }),
    ).toThrow(ErroDoProvedor);
  });

  it('dois parciais que fecham o total sao aceitos', async () => {
    const provedor = provedorComConta();
    const pagamento = await pagamentoConfirmado(provedor, QUANDO);

    await provedor.refundPayment({
      externalPaymentId: pagamento,
      amountMinor: 7_200,
      idempotencyKey: 'k1',
    });
    const segundo = await provedor.refundPayment({
      externalPaymentId: pagamento,
      amountMinor: 4_800,
      idempotencyKey: 'k2',
    });

    expect(segundo.status).toBe('CONFIRMED');
  });
});

describe('FakePaymentProvider.listMovements -- F16', () => {
  const JANELA = { de: new Date('2026-08-01T00:00:00Z'), ate: new Date('2026-09-01T00:00:00Z') };
  const QUANDO = new Date('2026-08-10T12:00:00Z');

  it('extrato traz o pagamento confirmado e o estorno', async () => {
    const provedor = provedorComConta();
    const pagamento = await pagamentoConfirmado(provedor, QUANDO);
    await provedor.refundPayment({
      externalPaymentId: pagamento,
      amountMinor: 4_000,
      idempotencyKey: 'k1',
    });

    const extrato = await provedor.listMovements({ externalAccountId: CONTA, ...JANELA });

    expect(extrato.map((m) => m.tipo)).toEqual(['PAYMENT', 'REFUND']);
    // Valor do estorno POSITIVO: a direcao mora em `tipo`, nao no sinal.
    expect(extrato[1]?.amountMinor).toBe(4_000);
  });

  it('cobranca pendente NAO aparece -- ninguem pagou', async () => {
    const provedor = provedorComConta();
    await provedor.createPix(entradaPix({ expiresAt: QUANDO }));

    const extrato = await provedor.listMovements({ externalAccountId: CONTA, ...JANELA });

    expect(extrato).toHaveLength(0);
  });

  it('janela e FECHADA -- `ate` e exclusivo', async () => {
    const provedor = provedorComConta();
    await pagamentoConfirmado(provedor, JANELA.ate);

    const extrato = await provedor.listMovements({ externalAccountId: CONTA, ...JANELA });

    expect(extrato).toHaveLength(0);
  });

  it('extrato de outra conta nao vaza', async () => {
    const provedor = provedorComConta();
    await pagamentoConfirmado(provedor, QUANDO);

    const extrato = await provedor.listMovements({
      externalAccountId: 'acct_de_outro_tenant',
      ...JANELA,
    });

    expect(extrato).toHaveLength(0);
  });

  it('cada pagamento aparece UMA vez, apesar do indice duplo interno', async () => {
    // O duble indexa a cobranca sob a chave de idempotencia E sob o id do
    // pagamento. Sem desduplicar, o extrato traria a mesma linha duas vezes e
    // a conciliacao acusaria divergencia inventada pelo proprio duble.
    const provedor = provedorComConta();
    await pagamentoConfirmado(provedor, QUANDO);

    const extrato = await provedor.listMovements({ externalAccountId: CONTA, ...JANELA });

    expect(extrato).toHaveLength(1);
  });

  it('movimento esquecido some do extrato -- e o que produz MISSING_EXTERNAL', async () => {
    const provedor = provedorComConta();
    const pagamento = await pagamentoConfirmado(provedor, QUANDO);

    provedor.esquecerMovimentoDoExtrato(pagamento);

    const extrato = await provedor.listMovements({ externalAccountId: CONTA, ...JANELA });
    expect(extrato).toHaveLength(0);
  });
});

describe('FakePaymentProvider.cancelSubscription', () => {
  it('cancelSubscription de assinatura inexistente e NOT_FOUND, nao sucesso', () => {
    /**
     * Nao e "metodo nao implementado": e a resposta certa. Quem chama precisa
     * distinguir "cancelei" de "nao havia nada" -- o caso de uso trata o
     * NOT_FOUND como estado ja alcancado, mas essa e decisao DELE.
     */
    expect(() => new FakePaymentProvider().cancelSubscription('sub_inexistente')).toThrow(
      ErroDoProvedor,
    );
  });
});
