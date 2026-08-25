import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  ErroDoProvedor,
  type CreatePixInput,
  type HostedCheckout,
  type HostedCheckoutInput,
  type ListMovementsInput,
  type PaymentProvider,
  type PixCharge,
  type ProviderCharge,
  type ProviderEvent,
  type ProviderMovement,
  type ProviderPayment,
  type ProviderRefund,
  type ProviderSubscription,
  type RawWebhook,
  type RefundInput,
  type StatusNoProvedor,
  type SubscriptionInput,
  type TokenizedChargeInput,
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

/**
 * QR fixo do checkout hospedado. `createPix` gera o dele a partir do id da
 * cobranca e nao foi tocado aqui -- alteracao cirurgica, escopo desta task.
 */
const QR_FALSO = 'data:image/png;base64,ZmFrZS1xcg==';

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
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
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

  /** Checkouts hospedados por chave de idempotencia -- o que torna o retry seguro. */
  private readonly checkoutsPorChave = new Map<string, HostedCheckout>();

  /**
   * Quantas vezes `createHostedCheckout` foi chamado, nesta instancia.
   *
   * Existe para o teste de recusa por cadastro incompleto (F53/Task 4):
   * provar que o caso de uso recusou ANTES de gastar requisicao com o
   * provedor, e nao so que a resposta veio com o codigo certo.
   */
  chamadasDeCheckout = 0;

  /**
   * Quantas vezes `getPaymentStatus` foi chamado, nesta instancia.
   *
   * Existe para o teste da leitura barata (F53/Task 5): provar que o laco de
   * polling NAO bate no provedor -- o fake nao tem rate limit para avisar
   * sozinho quando o desenho erra.
   */
  chamadasDeStatus = 0;

  /**
   * Quantas RECORRENCIAS foram instaladas nesta instancia
   * (`createTokenizedSubscription`).
   *
   * Existe para o teste que fecha o ADR-043, Decisao 5: cobrar tres invoices
   * tem de deixar este contador em ZERO. Sem ele a prova seria indireta --
   * olhar o prefixo do id devolvido diz o que voltou, mas nao diz o que
   * ficou instalado no provedor, e e o que fica instalado que cobra o aluno
   * no mes seguinte.
   */
  recorrenciasInstaladas = 0;

  /**
   * A recorrencia continua VIVA no provedor?
   *
   * Existe pela F56: `recorrenciasInstaladas` conta quantas nasceram e nunca
   * decresce -- ele nao distingue "instalei e cancelei" de "instalei e
   * continua cobrando". Recorrencia viva depois de um cancelamento e cobranca
   * que ninguem autorizou, e o contador sozinho nao pega isso.
   *
   * METODO e nao o `Set` exposto: quem observa precisa PERGUNTAR, nao poder
   * adicionar. Um teste que consegue plantar estado no duble deixa de medir o
   * codigo de producao.
   */
  temRecorrenciaViva(externalSubscriptionId: string): boolean {
    return this.assinaturasVivas.has(externalSubscriptionId);
  }

  /**
   * O estorno confirma na hora, ou fica pendente?
   *
   * PADRAO SINCRONO por conveniencia dos testes que nao estao testando isso --
   * mas os DOIS provedores homologados sao assincronos, e um duble que so
   * soubesse confirmar na hora ensinaria o caso de uso a assumir sincronismo.
   * `simularEstornoAssincrono()` liga o modo que o mundo real usa.
   */
  private estornoAssincrono = false;

  /** Passa a devolver `PENDING` em `refundPayment`, como os provedores reais. */
  simularEstornoAssincrono(): void {
    this.estornoAssincrono = true;
  }

  /**
   * Volta ao modo sincrono.
   *
   * Existe porque a instancia do duble e COMPARTILHADA entre os testes da
   * suite: sem desligar, o bloco seguinte herdaria o modo assincrono sem ter
   * pedido, e falharia por um motivo que nao tem nada a ver com o que ele
   * testa. Estado de duble que vaza entre casos e a forma mais chata de teste
   * flaky.
   */
  simularEstornoSincrono(): void {
    this.estornoAssincrono = false;
  }

  /** Confirma (ou reprova) um estorno pendente, como o provedor faria depois. */
  simularDesfechoDoEstorno(externalRefundId: string, status: 'CONFIRMED' | 'FAILED'): void {
    const estorno = this.estornos.find((e) => e.externalRefundId === externalRefundId);

    if (!estorno) {
      throw new ErroDoProvedor('PROVIDER_NOT_FOUND', false, 'estorno inexistente no provedor');
    }

    estorno.status = status;

    if (status === 'CONFIRMED') {
      const cobranca = this.cobrancas.get(estorno.externalPaymentId);
      const jaEstornado = this.estornos
        .filter((e) => e.externalPaymentId === estorno.externalPaymentId && e.status === 'CONFIRMED')
        .reduce((soma, e) => soma + e.amountMinor, 0);

      if (cobranca && jaEstornado >= cobranca.amountMinor) {
        cobranca.status = 'REFUNDED';
      }
    }
  }

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
    this.chamadasDeStatus += 1;

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
   * Cobranca PONTUAL no cartao salvo -- o que a F14 chama por invoice.
   *
   * Recusa pelos MESMOS prefixos de token da assinatura: a politica de retry
   * e a mesma, e duplicar convencao faria um dos dois caminhos envelhecer
   * sozinho.
   *
   * REGISTRA EM `cobrancas`, junto com o PIX, e nao num deposito proprio de
   * cartao. E o que faz `getPaymentStatus`, `listMovements` e o estorno
   * enxergarem a cobranca de cartao: para todos eles, um pagamento
   * confirmado e um pagamento confirmado, e a forma como o dinheiro entrou
   * nao muda a conciliacao.
   */
  chargeTokenizedPayment(input: TokenizedChargeInput): Promise<ProviderCharge> {
    if (input.amountMinor <= 0) {
      throw new ErroDoProvedor(
        'PROVIDER_INVALID_REQUEST',
        false,
        'cobranca no cartao exige valor positivo',
      );
    }

    if (input.cardToken.startsWith(TOKEN_RECUSADO_DEFINITIVO)) {
      throw new ErroDoProvedor('PROVIDER_REJECTED', false, 'cartao recusado em definitivo');
    }

    if (input.cardToken.startsWith(TOKEN_RECUSADO_TEMPORARIO)) {
      throw new ErroDoProvedor('PROVIDER_REJECTED', true, 'saldo insuficiente');
    }

    /**
     * Mesma chave devolve a MESMA cobranca -- sem isto, um retry de rede
     * cobraria o aluno duas vezes pela mesma invoice.
     */
    const existente = this.cobrancas.get(input.idempotencyKey);
    if (existente) {
      return Promise.resolve({
        externalPaymentId: existente.externalPaymentId,
        status: existente.status,
      });
    }

    /**
     * Nasce `PENDING`, nao `CONFIRMED`: no cartao real a autorizacao e uma
     * coisa e a confirmacao e outra, e quem confirma a invoice e o webhook
     * (INV-076). Um duble que ja nascesse confirmado esconderia a fatia
     * inteira do fluxo assincrono.
     *
     * `occurredAt` nasce na EPOCH e quem o move e `simularMudancaDeStatus`,
     * igual ao PIX: o duble nao le relogio -- se lesse, o extrato ordenaria
     * por um instante que o teste nao controla, e a conciliacao ficaria
     * flaky sem ninguem entender por que.
     */
    const cobranca: CobrancaEmMemoria = {
      externalPaymentId: `fake_card_${randomUUID()}`,
      externalAccountId: input.externalAccountId,
      status: 'PENDING',
      amountMinor: input.amountMinor,
      currency: input.currency,
      occurredAt: new Date(0),
    };

    this.cobrancas.set(input.idempotencyKey, cobranca);
    this.cobrancas.set(cobranca.externalPaymentId, cobranca);

    return Promise.resolve({
      externalPaymentId: cobranca.externalPaymentId,
      status: cobranca.status,
    });
  }

  /**
   * Assinatura tokenizada -- F56, e SO ela (ADR-043, Decisao 5).
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

    /**
     * DEPOIS da idempotencia: retry de rede reusa a chave e NAO instala nada
     * novo, entao contar antes inflaria o numero e o teste acusaria uma
     * recorrencia que nao existe.
     */
    this.recorrenciasInstaladas += 1;

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
        status: existente.status,
        amountMinor: existente.amountMinor,
      });
    }

    // So o que NAO FALHOU consome saldo: um estorno recusado nao devolveu
    // dinheiro nenhum, e conta-lo impediria a retentativa legitima. Mesmo
    // criterio do dominio, que soma apenas `CONFIRMED`.
    const jaEstornado = this.estornos
      .filter((e) => e.externalPaymentId === input.externalPaymentId && e.status !== 'FAILED')
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
      status: this.estornoAssincrono ? 'PENDING' : 'CONFIRMED',
    };

    this.estornosPorChave.set(input.idempotencyKey, estorno);
    this.estornos.push(estorno);

    // So o estorno JA CONFIRMADO move o pagamento. No modo assincrono quem
    // move e `simularDesfechoDoEstorno`, como o provedor real faz depois.
    if (estorno.status === 'CONFIRMED' && jaEstornado + input.amountMinor === cobranca.amountMinor) {
      cobranca.status = 'REFUNDED';
    }

    return Promise.resolve({
      externalRefundId: estorno.externalRefundId,
      status: estorno.status,
      amountMinor: estorno.amountMinor,
    });
  }

  getRefundStatus(externalRefundId: string): Promise<ProviderRefund> {
    const estorno = this.estornos.find((e) => e.externalRefundId === externalRefundId);

    if (!estorno) {
      throw new ErroDoProvedor('PROVIDER_NOT_FOUND', false, 'estorno inexistente no provedor');
    }

    return Promise.resolve({
      externalRefundId: estorno.externalRefundId,
      status: estorno.status,
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
      .filter(
        (e) =>
          e.externalAccountId === input.externalAccountId &&
          // Estorno PENDENTE nao aparece em extrato: o dinheiro ainda nao
          // voltou. Inclui-lo faria a conciliacao acusar `MISSING_INTERNAL`
          // de um movimento que nenhum lado considera concluido.
          e.status === 'CONFIRMED' &&
          naJanela(e.occurredAt),
      )
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

  /**
   * Checkout hospedado -- F53/Task 2 (SPEC-053). O aluno digita o cartao NO
   * PROPRIO CELULAR, na pagina do provedor; o duble nao recebe, nao guarda e
   * nao sabe inventar numero de cartao.
   */
  createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckout> {
    this.chamadasDeCheckout += 1;

    /*
     * Memoriza por chave de idempotencia, como o provedor real faz. Sortear
     * um id novo a cada chamada faria o teste de idempotencia da Task 4
     * medir o fake em vez da guarda.
     */
    const existente = this.checkoutsPorChave.get(input.idempotencyKey);
    if (existente) return Promise.resolve(existente);

    const checkout: HostedCheckout = {
      externalPaymentId: `fake-checkout-${input.idempotencyKey}`,
      checkoutUrl: `https://checkout.fake.test/${input.idempotencyKey}`,
      qrCodeDataUri: QR_FALSO,
      expiresAt: input.expiresAt,
    };

    this.checkoutsPorChave.set(input.idempotencyKey, checkout);
    return Promise.resolve(checkout);
  }
}
