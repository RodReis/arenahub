import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  ErroDoProvedor,
  type CreatePixInput,
  type ListMovementsInput,
  type PaymentProvider,
  type PixCharge,
  type ProviderEvent,
  type ProviderMovement,
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
  /** Conta que recebeu. O extrato filtra por ela. */
  externalAccountId: string;
  status: StatusNoProvedor;
  amountMinor: number;
  currency: string;
  occurredAt: Date;
}

/** Estorno registrado no duble. Vira linha de extrato como `REFUND`. */
interface EstornoEmMemoria {
  externalRefundId: string;
  externalPaymentId: string;
  externalAccountId: string;
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
/**
 * Prefixos de token que o duble recusa, para exercitar os dois lados da
 * politica de retry sem provedor real. Nao existem no mundo real -- e por
 * isso comecam com `tok_fake_`, que nenhum cofre de verdade emite.
 */
export const TOKEN_RECUSADO_DEFINITIVO = 'tok_fake_recusa_definitiva';
export const TOKEN_RECUSADO_TEMPORARIO = 'tok_fake_recusa_temporaria';

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

  /** Assinaturas por chave de idempotencia -- o que torna o retry seguro. */
  private readonly assinaturas = new Map<string, string>();

  /** Assinaturas ainda nao canceladas. Cancelar duas vezes tem de reprovar. */
  private readonly assinaturasVivas = new Set<string>();

  /** Estornos por chave de idempotencia -- o que torna o retry seguro. */
  private readonly estornosPorChave = new Map<string, EstornoEmMemoria>();

  /** Estornos na ordem em que ocorreram, para o extrato. */
  private readonly estornos: EstornoEmMemoria[] = [];

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
      externalAccountId: input.externalAccountId,
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
  /**
   * Assinatura tokenizada -- F14.
   *
   * O DUBLE NAO RECEBE, NAO GUARDA E NAO SABE INVENTAR numero de cartao: a
   * entrada e `cardToken`, que no mundo real vem do checkout hospedado do
   * provedor (INV-098). Um fake que aceitasse PAN daria a impressao de que o
   * caminho existe, e alguem o implementaria contra o adapter real.
   */
  createTokenizedSubscription(input: SubscriptionInput): Promise<ProviderSubscription> {
    if (input.amountMinor <= 0) {
      throw new ErroDoProvedor(
        'PROVIDER_INVALID_REQUEST',
        false,
        'cobranca no cartao exige valor positivo',
      );
    }

    /**
     * TOKEN RECUSADO POR CONVENCAO, para que o caminho de falha seja
     * exercitavel sem provedor real. `recuperavel: false` traduz a recusa
     * DEFINITIVA (cartao cancelado, conta encerrada) -- e o que faz a
     * politica de retry parar em vez de repetir.
     */
    if (input.cardToken.startsWith(TOKEN_RECUSADO_DEFINITIVO)) {
      throw new ErroDoProvedor('PROVIDER_REJECTED', false, 'cartao recusado em definitivo');
    }

    if (input.cardToken.startsWith(TOKEN_RECUSADO_TEMPORARIO)) {
      throw new ErroDoProvedor('PROVIDER_REJECTED', true, 'saldo insuficiente');
    }

    /**
     * Idempotencia DO LADO DO PROVEDOR, igual a do PIX: mesma chave devolve a
     * MESMA assinatura. Sem isto, um retry de rede criaria duas recorrencias
     * cobrando o aluno em dobro todo mes -- e o teste nunca veria.
     */
    const existente = this.assinaturas.get(input.idempotencyKey);
    if (existente) {
      return Promise.resolve({ externalSubscriptionId: existente, status: 'ACTIVE' });
    }

    const externalSubscriptionId = `fake_sub_${randomUUID()}`;
    this.assinaturas.set(input.idempotencyKey, externalSubscriptionId);
    this.assinaturasVivas.add(externalSubscriptionId);

    return Promise.resolve({ externalSubscriptionId, status: 'ACTIVE' });
  }

  cancelSubscription(externalSubscriptionId: string): Promise<void> {
    /**
     * Cancelar o que nao existe e `PROVIDER_NOT_FOUND`, e nao sucesso
     * silencioso: quem chama precisa poder distinguir "cancelei" de "nao
     * havia nada". O caso de uso trata o `NOT_FOUND` como estado ja
     * alcancado -- mas essa e decisao DELE, nao do provedor.
     */
    if (!this.assinaturasVivas.delete(externalSubscriptionId)) {
      throw new ErroDoProvedor(
        'PROVIDER_NOT_FOUND',
        false,
        'assinatura inexistente ou ja cancelada no provedor',
      );
    }

    return Promise.resolve();
  }

  /**
   * Estorno -- F16.
   *
   * CONFIRMA NA HORA, e isso e uma simplificacao deliberada do DUBLE, nao do
   * dominio: nos dois provedores homologados o estorno e assincrono, e a
   * confirmacao chega por webhook. O caso de uso trata `PENDING` e a
   * confirmacao tardia porque e assim que o mundo real funciona -- quem quiser
   * exercitar esse caminho usa `simularEstornoPendente`, abaixo.
   *
   * Um duble que so soubesse confirmar na hora ensinaria o caso de uso a
   * assumir sincronismo, e o adapter real quebraria isso na primeira chamada.
   */
  refundPayment(input: RefundInput): Promise<ProviderRefund> {
    const cobranca = this.cobrancas.get(input.externalPaymentId);

    if (!cobranca) {
      throw new ErroDoProvedor('PROVIDER_NOT_FOUND', false, 'pagamento inexistente no provedor');
    }

    if (cobranca.status !== 'CONFIRMED' && cobranca.status !== 'REFUNDED') {
      throw new ErroDoProvedor(
        'PROVIDER_INVALID_REQUEST',
        false,
        'so pagamento confirmado pode ser estornado',
      );
    }

    if (input.amountMinor <= 0) {
      throw new ErroDoProvedor('PROVIDER_INVALID_REQUEST', false, 'estorno exige valor positivo');
    }

    /**
     * Idempotencia DO LADO DO PROVEDOR, igual a do PIX e da assinatura: mesma
     * chave devolve o MESMO estorno. Sem isto, um retry de rede devolveria o
     * dinheiro duas vezes -- e o teste nunca veria, porque as duas chamadas
     * respondem sucesso.
     */
    const existente = this.estornosPorChave.get(input.idempotencyKey);
    if (existente) {
      return Promise.resolve({
        externalRefundId: existente.externalRefundId,
        status: 'CONFIRMED',
        amountMinor: existente.amountMinor,
      });
    }

    const jaEstornado = this.estornos
      .filter((e) => e.externalPaymentId === input.externalPaymentId)
      .reduce((soma, e) => soma + e.amountMinor, 0);

    if (jaEstornado + input.amountMinor > cobranca.amountMinor) {
      throw new ErroDoProvedor(
        'PROVIDER_INVALID_REQUEST',
        false,
        'estorno acumulado excede o valor do pagamento',
      );
    }

    const estorno: EstornoEmMemoria = {
      externalRefundId: `fake_ref_${randomUUID()}`,
      externalPaymentId: input.externalPaymentId,
      externalAccountId: cobranca.externalAccountId,
      amountMinor: input.amountMinor,
      currency: cobranca.currency,
      occurredAt: cobranca.occurredAt,
    };

    this.estornosPorChave.set(input.idempotencyKey, estorno);
    this.estornos.push(estorno);

    if (jaEstornado + input.amountMinor === cobranca.amountMinor) {
      cobranca.status = 'REFUNDED';
    }

    return Promise.resolve({
      externalRefundId: estorno.externalRefundId,
      status: 'CONFIRMED',
      amountMinor: estorno.amountMinor,
    });
  }

  /**
   * Extrato da conta numa janela fechada -- F16.
   *
   * DERIVADO DO PROPRIO ESTADO do duble, e nao de uma lista que o teste
   * planta: um extrato inventado a parte poderia discordar das cobrancas que
   * o mesmo objeto criou, e a conciliacao passaria a testar a coerencia da
   * fixture em vez da regra de casamento.
   *
   * So entra o que o provedor considera dinheiro movimentado: cobranca
   * PENDENTE nao aparece em extrato nenhum, porque ninguem pagou.
   */
  listMovements(input: ListMovementsInput): Promise<readonly ProviderMovement[]> {
    const naJanela = (quando: Date): boolean =>
      quando.getTime() >= input.de.getTime() && quando.getTime() < input.ate.getTime();

    // As cobrancas ficam indexadas sob DUAS chaves (idempotencia e id do
    // pagamento); o `Set` desduplica o que sairia repetido no extrato.
    const pagamentos = [...new Set(this.cobrancas.values())]
      .filter(
        (c) =>
          c.externalAccountId === input.externalAccountId &&
          (c.status === 'CONFIRMED' || c.status === 'REFUNDED') &&
          naJanela(c.occurredAt),
      )
      .map(
        (c): ProviderMovement => ({
          externalMovementId: `mov_${c.externalPaymentId}`,
          externalPaymentId: c.externalPaymentId,
          tipo: 'PAYMENT',
          amountMinor: c.amountMinor,
          currency: c.currency,
          occurredAt: c.occurredAt,
        }),
      );

    const estornos = this.estornos
      .filter((e) => e.externalAccountId === input.externalAccountId && naJanela(e.occurredAt))
      .map(
        (e): ProviderMovement => ({
          externalMovementId: `mov_${e.externalRefundId}`,
          externalPaymentId: e.externalPaymentId,
          tipo: 'REFUND',
          amountMinor: e.amountMinor,
          currency: e.currency,
          occurredAt: e.occurredAt,
        }),
      );

    return Promise.resolve(
      [...pagamentos, ...estornos].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
    );
  }

  /**
   * Remove um movimento do extrato sem tocar no nosso lado.
   *
   * EXISTE PARA UM CENARIO SO, e ele e o unico que justifica conciliacao:
   * o dinheiro que o provedor NAO reporta e que nos registramos
   * (`MISSING_EXTERNAL`). Sem um jeito de produzi-lo, esse ramo da matriz de
   * casamento ficaria sem teste -- e e o ramo que pega perda de receita.
   */
  esquecerMovimentoDoExtrato(externalPaymentId: string): void {
    const cobranca = this.cobrancas.get(externalPaymentId);
    if (cobranca) {
      cobranca.status = 'PENDING';
    }
  }
}
