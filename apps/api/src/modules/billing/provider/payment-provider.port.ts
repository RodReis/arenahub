/**
 * Fronteira do provedor de pagamento. Contrato do `MVP-02` 12.
 *
 * EXISTE COMO PORTA POR DECISAO DO PI (ADR-013): o provedor NAO foi
 * escolhido -- sai do card `[GATE]` de homologacao, com matriz comparativa.
 * Todo o MVP 2 e escrito contra esta interface para que a escolha, quando
 * vier, seja um adapter novo e nao uma reescrita.
 *
 * O CONTRATO TINHA TRES VERSOES divergentes (Especificacao 38 com 7 metodos,
 * `MVP-02` 12 com 6, indice do plano com 10). O ADR-013 resolveu: **vence o
 * PRD**. Sao estes 6, com estes nomes.
 *
 * F13 exercita `createPix`, `getPaymentStatus` e `verifyAndParseWebhook`.
 * Os outros tres ficam declarados -- sao contrato do PRD, nao invencao
 * desta fatia -- e sao implementados quando F14 (cartao) e F15 (estorno)
 * chegarem. O fake responde a todos para que o adapter real nao tenha que
 * adivinhar a forma depois.
 */

/** Codigos estaveis de erro do provedor. `MVP-02` 12: traduzidos, nunca crus. */
export type CodigoDeErroDoProvedor =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_INVALID_REQUEST'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_SIGNATURE_INVALID';

/**
 * Erro do provedor ja classificado.
 *
 * `recuperavel` nao e detalhe de log: e o que decide se a tentativa pode ser
 * repetida. Rede caida se repete; cartao recusado nao -- repetir o segundo
 * so gera antifraude e taxa.
 */
export class ErroDoProvedor extends Error {
  constructor(
    readonly codigo: CodigoDeErroDoProvedor,
    readonly recuperavel: boolean,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDoProvedor';
  }
}

export interface CreatePixInput {
  /** Conta do tenant no provedor. Resolve o destino do dinheiro. */
  externalAccountId: string;
  /** Centavos. INV-065 -- nunca float. */
  amountMinor: number;
  currency: string;
  /** Chave enviada ao provedor. Constraint do `MVP-02` 11. */
  idempotencyKey: string;
  /** Quando a cobranca deixa de ser pagavel. */
  expiresAt: Date;
  /** Texto curto que o pagador ve no app do banco. Sem PII. */
  descricao: string;
}

export interface PixCharge {
  externalPaymentId: string;
  /** Payload EMV do copia-e-cola. E o que o aluno cola no app do banco. */
  copiaECola: string;
  /**
   * QR Code em data URI (`data:image/png;base64,...`).
   *
   * Vem do provedor e nao e gerado aqui: renderizar o EMV por conta propria
   * significaria carregar biblioteca de QR e responder por divergencia entre
   * o que desenhamos e o que o provedor registrou.
   */
  qrCodeDataUri: string;
  expiresAt: Date;
}

/** Estado do pagamento NO PROVEDOR. Traduzido para `PaymentStatus` no caso de uso. */
export type StatusNoProvedor = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'REFUNDED';

export interface ProviderPayment {
  externalPaymentId: string;
  status: StatusNoProvedor;
  amountMinor: number;
  currency: string;
  /** Instante NO PROVEDOR. Base da ordenacao logica (INV-079). */
  occurredAt: Date;
}

export interface SubscriptionInput {
  externalAccountId: string;
  /**
   * Token da tokenizacao HOSPEDADA (INV-098). PAN e CVV nunca chegam aqui --
   * se um dia chegarem, e bug de PCI, nao campo faltando.
   */
  cardToken: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}

export interface ProviderSubscription {
  externalSubscriptionId: string;
  status: 'ACTIVE' | 'PENDING' | 'CANCELLED';
}

export interface RefundInput {
  externalPaymentId: string;
  /** Centavos. Parcial e permitido pelo provedor; a politica e do PI. */
  amountMinor: number;
  idempotencyKey: string;
}

export interface ProviderRefund {
  externalRefundId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  amountMinor: number;
}

/**
 * Janela do extrato. FECHADA de proposito -- `ate` e exclusivo.
 *
 * Conciliar "ate agora" produziria divergencia falsa em toda execucao: o
 * pagamento de trinta segundos atras ainda nao apareceu no extrato do banco, e
 * viraria `MISSING_EXTERNAL` sem nada de errado ter acontecido.
 */
export interface ListMovementsInput {
  externalAccountId: string;
  de: Date;
  ate: Date;
}

/** Uma linha do extrato, ja normalizada pelo adapter. */
export interface ProviderMovement {
  /** Id do movimento no provedor. E o que da idempotencia a importacao. */
  externalMovementId: string;
  /** Pagamento a que o movimento se refere, quando ha. */
  externalPaymentId: string | null;
  tipo: 'PAYMENT' | 'REFUND';
  /**
   * Centavos, sempre POSITIVO. A direcao mora em `tipo`, nao no sinal: valor
   * negativo em campo monetario e a forma mais facil de uma soma dar
   * silenciosamente o numero errado.
   */
  amountMinor: number;
  currency: string;
  /** Instante NO PROVEDOR. */
  occurredAt: Date;
}

/**
 * Requisicao crua de webhook.
 *
 * CORPO BRUTO, nao objeto ja parseado (`MVP-02` 13): a assinatura HMAC e
 * calculada sobre os bytes exatos. `JSON.parse` seguido de `stringify`
 * reordena chave e muda espacamento -- e o HMAC deixa de bater por um
 * motivo que nao tem nada a ver com autenticidade.
 */
export interface RawWebhook {
  rawBody: Buffer;
  headers: Readonly<Record<string, string | undefined>>;
  /** Slug do provedor na rota `/webhooks/payments/:provider`. */
  provider: string;
}

/**
 * Evento ja verificado e traduzido.
 *
 * `externalAccountId` e o que resolve o tenant (INV-078) -- vem da
 * verificacao, nunca de campo livre do corpo.
 */
export interface ProviderEvent {
  externalEventId: string;
  externalAccountId: string;
  tipo: string;
  externalPaymentId: string | null;
  occurredAt: Date;
  /** Payload ja verificado, para auditoria. Sem PAN/CVV (INV-098). */
  payload: unknown;
}

export interface PaymentProvider {
  createPix(input: CreatePixInput): Promise<PixCharge>;
  getPaymentStatus(externalPaymentId: string): Promise<ProviderPayment>;
  createTokenizedSubscription(input: SubscriptionInput): Promise<ProviderSubscription>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  refundPayment(input: RefundInput): Promise<ProviderRefund>;
  /**
   * Estado do estorno NO PROVEDOR. Consulta ativa, par de `getPaymentStatus`.
   *
   * OITAVO METODO, emendado ao `MVP-02` 12 junto de `listMovements`. Existe
   * pela mesma razao que a consulta de pagamento (INV-083): o estorno dos dois
   * provedores homologados e ASSINCRONO, e um estorno cuja confirmacao so pode
   * chegar por webhook fica preso para sempre quando o webhook nao chega -- e
   * preso nao e so um registro feio: o indice parcial de exclusao mutua
   * bloqueia todo estorno seguinte daquele pagamento, inclusive o parcial
   * legitimo.
   */
  getRefundStatus(externalRefundId: string): Promise<ProviderRefund>;
  /**
   * Extrato da conta numa janela fechada. `MVP-02` 7: "importacao ou consulta
   * de extrato".
   *
   * SETIMO METODO -- o PRD 12 declarava seis. A ampliacao foi decidida pelo PI
   * em 19/08/2026 e o `MVP-02` 12 foi EMENDADO no mesmo PR, com nota apontando
   * esta fatia. Mesmo precedente do ADR-027, que emendou a 11 ao criar
   * `account_credits`.
   *
   * POR QUE NAO DAVA PARA EVITAR: sem extrato, a conciliacao so enxerga o que
   * o webhook entregou -- e o caso que ela existe para achar e exatamente o
   * dinheiro que o provedor tem e cujo webhook nunca chegou
   * (`MISSING_EXTERNAL`). Conciliar `provider_events` contra `payments`
   * compararia o nosso registro com a nossa copia do registro dele.
   */
  listMovements(input: ListMovementsInput): Promise<readonly ProviderMovement[]>;
  /**
   * Verifica assinatura e origem ANTES de qualquer processamento (INV-077).
   *
   * Lanca `ErroDoProvedor('PROVIDER_SIGNATURE_INVALID')` quando nao bate.
   * Nao devolve "invalido" como valor: assinatura ruim nao e um resultado a
   * ser tratado no fluxo normal, e a unica saida correta e parar.
   */
  verifyAndParseWebhook(input: RawWebhook): Promise<ProviderEvent>;
}

/** Token de injecao -- a porta e interface, e interface some no runtime. */
export const PAYMENT_PROVIDER = Symbol('PaymentProvider');
