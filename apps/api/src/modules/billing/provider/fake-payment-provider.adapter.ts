import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  ErroDoProvedor,
  type CreatePixInput,
  type PaymentProvider,
  type PixCharge,
  type ProviderEvent,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderSubscription,
  type RawWebhook,
  type RefundInput,
  type StatusNoProvedor,
  type SubscriptionInput,
} from './payment-provider.port.js';

/**
 * Duble do provedor de pagamento. `docs/TESTING.md` 3 -- previsto na tabela
 * de dubles, nao improvisado aqui.
 *
 * EXISTE PORQUE O PROVEDOR NAO FOI ESCOLHIDO (ADR-013, card `[GATE]`) e
 * porque nao se testa cobranca real em CI. Substitui o PROCESSO EXTERNO --
 * nunca a regra de dominio, que mora em `domain/evento-do-provedor.ts` e e
 * exercitada igual com fake ou com adapter real.
 *
 * O HMAC AQUI E DE VERDADE, com `createHmac` e comparacao em tempo
 * constante. Um fake que aceitasse qualquer assinatura tornaria o teste de
 * INV-077 uma cerimonia: passaria com o codigo de verificacao deletado.
 *
 * O que ele NAO simula: latencia, entrega fora de ordem pela rede e
 * reentrega automatica. Isso e responsabilidade do TESTE, que chama o
 * webhook duas vezes ou com `occurredAt` recuado -- o duble nao decide o
 * cenario.
 */

/** Header da assinatura. Nome proprio do fake; cada provedor tem o seu. */
export const HEADER_DE_ASSINATURA = 'x-arenahub-fake-signature';

export const PROVEDOR_FAKE = 'fake';

interface CobrancaEmMemoria {
  externalPaymentId: string;
  status: StatusNoProvedor;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
}

/**
 * Assina um corpo com o segredo da conta.
 *
 * Exportada porque o TESTE precisa produzir assinatura valida -- e o teste
 * assinando com a mesma funcao do adapter e o unico jeito de a verificacao
 * ser exercitada de ponta a ponta sem provedor real.
 */
export function assinarCorpo(rawBody: Buffer, segredo: string): string {
  return createHmac('sha256', segredo).update(rawBody).digest('hex');
}

export class FakePaymentProvider implements PaymentProvider {
  /** Cobrancas criadas nesta instancia. Some quando o processo morre -- e o ponto. */
  private readonly cobrancas = new Map<string, CobrancaEmMemoria>();

  /**
   * Segredo por `externalAccountId`. Em producao vive cifrado em
   * `provider_accounts`; aqui o teste registra o que precisa.
   */
  private readonly segredos = new Map<string, string>();

  registrarConta(externalAccountId: string, segredo: string): void {
    this.segredos.set(externalAccountId, segredo);
  }

  createPix(input: CreatePixInput): Promise<PixCharge> {
    if (input.amountMinor <= 0) {
      throw new ErroDoProvedor(
        'PROVIDER_INVALID_REQUEST',
        false,
        'cobranca PIX exige valor positivo',
      );
    }

    /**
     * Idempotencia DO LADO DO PROVEDOR: mesma chave devolve a mesma
     * cobranca. Provedor real faz isso, e sem reproduzir aqui o retry da
     * API criaria duas cobrancas para a mesma invoice em teste.
     */
    const existente = this.cobrancas.get(input.idempotencyKey);
    if (existente) {
      return Promise.resolve(this.montarCobranca(existente, input.expiresAt));
    }

    const cobranca: CobrancaEmMemoria = {
      externalPaymentId: `fake_pay_${randomUUID()}`,
      status: 'PENDING',
      amountMinor: input.amountMinor,
      currency: input.currency,
      occurredAt: input.expiresAt,
    };

    this.cobrancas.set(input.idempotencyKey, cobranca);
    this.cobrancas.set(cobranca.externalPaymentId, cobranca);

    return Promise.resolve(this.montarCobranca(cobranca, input.expiresAt));
  }

  private montarCobranca(cobranca: CobrancaEmMemoria, expiresAt: Date): PixCharge {
    return {
      externalPaymentId: cobranca.externalPaymentId,
      copiaECola: `00020126FAKE${cobranca.externalPaymentId}5204000053039865802BR`,
      qrCodeDataUri: `data:image/png;base64,${Buffer.from(cobranca.externalPaymentId).toString('base64')}`,
      expiresAt,
    };
  }

  getPaymentStatus(externalPaymentId: string): Promise<ProviderPayment> {
    const cobranca = this.cobrancas.get(externalPaymentId);

    if (!cobranca) {
      throw new ErroDoProvedor('PROVIDER_NOT_FOUND', false, 'cobranca inexistente no provedor');
    }

    return Promise.resolve({
      externalPaymentId: cobranca.externalPaymentId,
      status: cobranca.status,
      amountMinor: cobranca.amountMinor,
      currency: cobranca.currency,
      occurredAt: cobranca.occurredAt,
    });
  }

  /**
   * Move a cobranca no lado do provedor -- e o que o teste usa para simular
   * "o aluno pagou" antes de disparar o webhook, ou para a consulta ativa
   * (`getPaymentStatus`) encontrar estado diferente do nosso.
   */
  simularMudancaDeStatus(
    externalPaymentId: string,
    status: StatusNoProvedor,
    occurredAt: Date,
  ): void {
    const cobranca = this.cobrancas.get(externalPaymentId);

    if (!cobranca) {
      throw new ErroDoProvedor('PROVIDER_NOT_FOUND', false, 'cobranca inexistente no provedor');
    }

    cobranca.status = status;
    cobranca.occurredAt = occurredAt;
  }

  verifyAndParseWebhook(input: RawWebhook): Promise<ProviderEvent> {
    const assinaturaRecebida = input.headers[HEADER_DE_ASSINATURA];

    if (typeof assinaturaRecebida !== 'string' || assinaturaRecebida === '') {
      throw new ErroDoProvedor('PROVIDER_SIGNATURE_INVALID', false, 'webhook sem assinatura');
    }

    const corpo = this.lerCorpo(input.rawBody);
    const segredo = this.segredos.get(corpo.externalAccountId);

    if (segredo === undefined) {
      throw new ErroDoProvedor('PROVIDER_SIGNATURE_INVALID', false, 'conta desconhecida');
    }

    const esperada = assinarCorpo(input.rawBody, segredo);

    /**
     * Comparacao em tempo constante. `===` em string vaza, por tempo de
     * resposta, quantos bytes iniciais bateram -- e assinatura HMAC e
     * exatamente o alvo desse ataque.
     */
    const recebidaBytes = Buffer.from(assinaturaRecebida, 'utf8');
    const esperadaBytes = Buffer.from(esperada, 'utf8');

    if (
      recebidaBytes.length !== esperadaBytes.length ||
      !timingSafeEqual(recebidaBytes, esperadaBytes)
    ) {
      throw new ErroDoProvedor('PROVIDER_SIGNATURE_INVALID', false, 'assinatura nao confere');
    }

    return Promise.resolve({
      externalEventId: corpo.externalEventId,
      externalAccountId: corpo.externalAccountId,
      tipo: corpo.tipo,
      externalPaymentId: corpo.externalPaymentId,
      occurredAt: new Date(corpo.occurredAt),
      payload: corpo,
    });
  }

  /** `unknown` antes de validar (`CLAUDE.md`): corpo de webhook e dado externo. */
  private lerCorpo(rawBody: Buffer): {
    externalEventId: string;
    externalAccountId: string;
    tipo: string;
    externalPaymentId: string | null;
    occurredAt: string;
  } {
    let cru: unknown;

    try {
      cru = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new ErroDoProvedor('PROVIDER_INVALID_REQUEST', false, 'corpo do webhook nao e JSON');
    }

    if (typeof cru !== 'object' || cru === null) {
      throw new ErroDoProvedor('PROVIDER_INVALID_REQUEST', false, 'corpo do webhook nao e objeto');
    }

    const corpo = cru as Record<string, unknown>;
    const texto = (campo: string): string => {
      const valor = corpo[campo];

      if (typeof valor !== 'string' || valor === '') {
        throw new ErroDoProvedor(
          'PROVIDER_INVALID_REQUEST',
          false,
          `campo obrigatorio ausente no webhook: ${campo}`,
        );
      }

      return valor;
    };

    const pagamento = corpo['externalPaymentId'];

    return {
      externalEventId: texto('externalEventId'),
      externalAccountId: texto('externalAccountId'),
      tipo: texto('tipo'),
      externalPaymentId: typeof pagamento === 'string' && pagamento !== '' ? pagamento : null,
      occurredAt: texto('occurredAt'),
    };
  }

  /**
   * F14 (cartao) e F15 (estorno). Declarados porque o contrato e do PRD
   * (`MVP-02` 12); estourar aqui e melhor que devolver dado inventado que
   * faria um teste futuro passar por engano.
   */
  createTokenizedSubscription(_input: SubscriptionInput): Promise<ProviderSubscription> {
    throw new ErroDoProvedor(
      'PROVIDER_INVALID_REQUEST',
      false,
      'assinatura tokenizada e da fatia F14, ainda nao implementada no duble',
    );
  }

  cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    throw new ErroDoProvedor(
      'PROVIDER_INVALID_REQUEST',
      false,
      'cancelamento de assinatura e da fatia F14, ainda nao implementado no duble',
    );
  }

  refundPayment(_input: RefundInput): Promise<ProviderRefund> {
    throw new ErroDoProvedor(
      'PROVIDER_INVALID_REQUEST',
      false,
      'estorno e da fatia F15, ainda nao implementado no duble',
    );
  }
}
