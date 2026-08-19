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

describe('FakePaymentProvider -- metodos de fatia futura', () => {
  /**
   * `createTokenizedSubscription` e `cancelSubscription` SAIRAM desta lista
   * na F14, que os implementou. Sobrou `refundPayment`, da F16.
   *
   * A lista encolhe a cada fatia, e e assim que ela avisa: um metodo que
   * continua aqui e um metodo que ninguem escreveu ainda -- melhor estourar
   * do que devolver dado inventado que passa por resposta de provedor.
   */
  it('refundPayment estoura em vez de devolver dado inventado', () => {
    expect(() =>
      new FakePaymentProvider().refundPayment({
        externalPaymentId: 'fake_pay_x',
        amountMinor: 1,
        idempotencyKey: 'k',
      }),
    ).toThrow(ErroDoProvedor);
  });

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
