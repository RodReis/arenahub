import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { validarValorMonetario } from './dinheiro.js';

/**
 * Regras do estorno. F16, `MVP-02` §7 (Slice 2.5), `M2-FR-017`.
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`). O "agora"
 * entra por parametro quando faz falta.
 *
 * O `CONVENTION.md` §2.3 marca `Refund` como `[indefinido]` -- nenhum campo,
 * nenhuma maquina de estado em documento normativo. O que ESTE arquivo decide,
 * por ser reversivel, esta anotado onde a decisao acontece; o que NAO era meu
 * para decidir foi ao PI e voltou decidido em 19/08/2026 (`M2-COMPLIANCE-01`):
 * politica `KEEP_UNTIL_PERIOD_END` e teto configuravel por tenant.
 */

/** Espelha `RefundStatus` do schema. */
export type StatusDoEstorno = 'REQUESTED' | 'PROCESSING' | 'CONFIRMED' | 'FAILED';

/** Espelha `RefundAccessPolicy` do schema. `M2-COMPLIANCE-01`. */
export type PoliticaDeAcessoNoEstorno = 'KEEP_UNTIL_PERIOD_END' | 'SUSPEND_ON_CONFIRMATION';

/** Espelha `PaymentMethodKind` do schema, no que interessa ao estorno. */
export type MetodoDoPagamento = 'PIX' | 'CARD' | 'MANUAL';

export class EstornoInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_REFUND', 422, motivo);
  }
}

/**
 * Teto excedido tem codigo PROPRIO, e nao 422 generico.
 *
 * A recepcao precisa distinguir "esse valor nao pode" de "esse pedido esta
 * malformado": a primeira e resolvida pedindo a alguem com alcada maior, a
 * segunda corrigindo o formulario. Mesma mensagem para as duas faria a
 * operadora tentar de novo o que nunca vai passar.
 */
export class LimiteDeEstornoExcedidoError extends ErroDeDominio {
  constructor(pedidoMinor: number, limiteMinor: number) {
    super(
      'BILLING_REFUND_LIMIT_EXCEEDED',
      409,
      `estorno de ${pedidoMinor} excede o limite de ${limiteMinor} configurado para o tenant`,
    );
  }
}

/**
 * Pagamento manual nao e estornavel PELO SISTEMA -- decisao do PI no ADR-027.
 *
 * Dinheiro reconhecido na recepcao nao tem provedor que o devolva: nao existe
 * API para chamar, e a devolucao fisica acontece fora do sistema. Um estorno
 * gravado aqui ficaria `REQUESTED` para sempre, esperando uma confirmacao que
 * nenhum webhook traz -- e a fila de conciliacao passaria a acusar divergencia
 * de uma operacao que nunca existiu do lado de fora.
 *
 * O caminho correto e contra-lancamento auditado, e ele nao e desta fatia.
 */
export class PagamentoManualNaoEstornavelError extends ErroDeDominio {
  constructor() {
    super(
      'BILLING_MANUAL_PAYMENT_NOT_REFUNDABLE',
      409,
      'pagamento manual nao e estornado pelo sistema; a devolucao acontece fora e entra como contra-lancamento (ADR-027)',
    );
  }
}

/**
 * Estados a partir dos quais o pagamento aceita estorno.
 *
 * SO `CONFIRMED`. Um pagamento `PENDING` nao tem dinheiro para devolver --
 * o que ele precisa e de CANCELAMENTO da cobranca, que e outro verbo e outro
 * efeito. Tratar os dois como "desfazer" faria a recepcao cancelar um PIX ja
 * pago achando que estornou.
 *
 * `REFUND_PENDING` fica de fora porque ja ha um estorno em voo, e o indice
 * parcial no banco (`refunds_payment_id_em_voo_key`) e quem garante isso sob
 * concorrencia -- esta lista e a mensagem de erro legivel, nao a garantia.
 */
const ESTORNAVEIS: readonly string[] = ['CONFIRMED'];

export interface PagamentoParaEstorno {
  readonly status: string;
  readonly method: MetodoDoPagamento;
  /** Centavos do pagamento original. INV-065. */
  readonly amountMinor: number;
  readonly currency: string;
}

export interface PedidoDeEstorno {
  /** Centavos a estornar. Parcial e permitido; ver `validarPedidoDeEstorno`. */
  readonly amountMinor: number;
  readonly reason: string;
  /** Teto do tenant, em centavos. `null` = sem teto (`M2-COMPLIANCE-01`). */
  readonly limiteMinor: number | null;
  /** Soma dos estornos ja CONFIRMADOS deste pagamento. */
  readonly jaEstornadoMinor: number;
}

/**
 * Valida o pedido antes de qualquer efeito externo.
 *
 * ORDEM DAS GUARDAS IMPORTA e nao e estetica: o metodo e checado antes do
 * valor porque um estorno de pagamento manual esta errado por natureza, e
 * dizer "valor acima do limite" a quem tentou estornar dinheiro da recepcao
 * mandaria a pessoa procurar alcada maior para uma operacao que nao existe.
 */
export function validarPedidoDeEstorno(
  pagamento: PagamentoParaEstorno,
  pedido: PedidoDeEstorno,
): void {
  if (pagamento.method === 'MANUAL') {
    throw new PagamentoManualNaoEstornavelError();
  }

  if (!ESTORNAVEIS.includes(pagamento.status)) {
    throw new EstornoInvalidoError(
      `pagamento em ${pagamento.status} nao aceita estorno; so ${ESTORNAVEIS.join(', ')}`,
    );
  }

  validarValorMonetario(pedido.amountMinor);

  if (pedido.amountMinor <= 0) {
    throw new EstornoInvalidoError('valor do estorno tem de ser positivo');
  }

  // O disponivel desconta o que JA foi estornado, e nao so o valor original.
  // Sem isso, dois estornos parciais de 60% cada devolveriam 120% do que o
  // aluno pagou -- cada um valido isoladamente, e a soma errada.
  const disponivelMinor = pagamento.amountMinor - pedido.jaEstornadoMinor;

  if (pedido.amountMinor > disponivelMinor) {
    throw new EstornoInvalidoError(
      `estorno de ${pedido.amountMinor} excede o disponivel de ${disponivelMinor}`,
    );
  }

  if (pedido.limiteMinor !== null && pedido.amountMinor > pedido.limiteMinor) {
    throw new LimiteDeEstornoExcedidoError(pedido.amountMinor, pedido.limiteMinor);
  }

  if (pedido.reason.trim().length < 3) {
    throw new EstornoInvalidoError('razao do estorno e obrigatoria (INV-072, INV-126)');
  }
}

/**
 * O estorno zerou o pagamento?
 *
 * Decide se a invoice vira `REFUNDED` ou continua `PAID`: estorno parcial NAO
 * muda o estado da invoice, porque parte do dinheiro continua tendo entrado --
 * e dizer `REFUNDED` sobre uma invoice que ainda reteve 40% seria mentir para
 * a conciliacao, que soma pelos estados.
 */
export function estornoEhTotal(
  pagamentoMinor: number,
  jaEstornadoMinor: number,
  agoraMinor: number,
): boolean {
  return jaEstornadoMinor + agoraMinor >= pagamentoMinor;
}

/**
 * Transicoes validas do estorno.
 *
 * `CONFIRMED` e `FAILED` sao TERMINAIS: uma confirmacao atrasada do provedor
 * chegando depois de outra ja aplicada nao pode reescrever o resultado
 * (INV-079). O provedor reentrega evento, e reentrega e o caso normal, nao a
 * excecao.
 */
const TRANSICOES: Readonly<Record<StatusDoEstorno, readonly StatusDoEstorno[]>> = {
  REQUESTED: ['PROCESSING', 'CONFIRMED', 'FAILED'],
  PROCESSING: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
};

export function podeTransicionarEstorno(de: StatusDoEstorno, para: StatusDoEstorno): boolean {
  return TRANSICOES[de].includes(para);
}

/**
 * O que a politica faz com o acesso, no instante da confirmacao.
 *
 * NENHUMA DAS DUAS E RETROATIVA (INV-094, `M2-BR-009`): a decisao vale dali
 * para a frente. Acesso que ja aconteceu aconteceu, e reescrever historico de
 * catraca seria inventar que alguem nao entrou.
 *
 * `KEEP_UNTIL_PERIOD_END` e o padrao decidido pelo PI em 19/08/2026: o aluno
 * estornado continua entrando ate o fim do periodo que ja estava pago. A
 * alternativa (`SUSPEND_ON_CONFIRMATION`) existe no enum porque e a outra
 * metade da decisao documentada, e trocar e uma linha na tabela do tenant.
 */
export function suspendeAcessoAgora(politica: PoliticaDeAcessoNoEstorno): boolean {
  return politica === 'SUSPEND_ON_CONFIRMATION';
}
