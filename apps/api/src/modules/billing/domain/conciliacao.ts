/**
 * Casamento de movimentos na conciliacao. F16, `M2-FR-019`, `M2-AC-010`.
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`). Recebem os
 * dois lados ja carregados e devolvem a matriz de divergencias.
 *
 * O CASAMENTO E DETERMINISTICO E SO POR CHAVE. Nunca por valor parecido, nome
 * de pagador ou proximidade de data: dois alunos pagando R$ 120 no mesmo dia
 * casariam com o movimento errado, e a "conciliacao" passaria a produzir a
 * divergencia que existe para achar. Chave igual ou divergencia explicita --
 * nao ha terceiro caminho.
 */

/** Espelha `ReconciliationItemStatus` do schema. Nomes vem do `MVP-02` §10. */
export type StatusDoItem =
  | 'MATCHED'
  | 'MISSING_INTERNAL'
  | 'MISSING_EXTERNAL'
  | 'AMOUNT_MISMATCH'
  | 'RESOLVED';

/** Um movimento do extrato do provedor, ja normalizado. */
export interface MovimentoExterno {
  readonly externalMovementId: string;
  readonly externalPaymentId: string | null;
  readonly tipo: 'PAYMENT' | 'REFUND';
  readonly amountMinor: number;
  readonly currency: string;
}

/** O nosso lado: pagamento confirmado ou estorno confirmado. */
export interface MovimentoInterno {
  /** Id do `Payment` ou do `Refund`, conforme `tipo`. */
  readonly id: string;
  readonly externalPaymentId: string | null;
  readonly tipo: 'PAYMENT' | 'REFUND';
  readonly amountMinor: number;
  readonly currency: string;
}

export interface ItemConciliado {
  readonly status: StatusDoItem;
  readonly paymentId: string | null;
  readonly refundId: string | null;
  readonly externalMovementId: string | null;
  readonly internalAmountMinor: number | null;
  readonly externalAmountMinor: number | null;
  /** Texto em pt-BR, pronto para a tela. */
  readonly recommendedAction: string;
}

/**
 * A chave do casamento.
 *
 * O PAR (pagamento externo, tipo) E NAO SO O PAGAMENTO: um pagamento de R$ 120
 * estornado em R$ 120 produz DOIS movimentos com o mesmo `externalPaymentId` e
 * valores identicos. Casar so pelo pagamento faria o estorno bater com a
 * cobranca e a conciliacao fechar em zero -- com o dinheiro tendo ido e
 * voltado, e nenhuma das duas pontas registrada.
 */
function chave(m: { externalPaymentId: string | null; tipo: 'PAYMENT' | 'REFUND' }): string {
  return `${m.tipo}:${m.externalPaymentId ?? ''}`;
}

const ACAO_MISSING_INTERNAL =
  'O provedor registrou este movimento e nós não. Reprocessar o evento do provedor; se ele não existir, consultar o status pela API.';

const ACAO_MISSING_EXTERNAL =
  'Registramos este movimento e o provedor não o reporta na janela. Verificar se a data de liquidação caiu fora do período antes de acionar o provedor.';

const ACAO_AMOUNT_MISMATCH =
  'Os valores divergem. Conferir tarifa ou retenção do provedor; se a diferença for esperada, aceitar como diferença documentada.';

const ACAO_MATCHED = 'Nada a fazer.';

/**
 * Casa os dois lados e devolve UMA linha por movimento -- inclusive as que
 * bateram.
 *
 * GUARDAR O QUE BATEU e o que permite responder "conciliei 100%?", que e a
 * metrica que o `MVP-02` §3 cobra. Guardar so a divergencia responderia
 * "quais deram errado?" e deixaria a pergunta cara sem resposta.
 */
export function conciliar(
  internos: readonly MovimentoInterno[],
  externos: readonly MovimentoExterno[],
): readonly ItemConciliado[] {
  const porChaveExterna = new Map<string, MovimentoExterno>();
  for (const externo of externos) {
    porChaveExterna.set(chave(externo), externo);
  }

  const itens: ItemConciliado[] = [];
  const externosCasados = new Set<string>();

  for (const interno of internos) {
    const externo = porChaveExterna.get(chave(interno));

    if (!externo) {
      itens.push({
        status: 'MISSING_EXTERNAL',
        paymentId: interno.tipo === 'PAYMENT' ? interno.id : null,
        refundId: interno.tipo === 'REFUND' ? interno.id : null,
        externalMovementId: null,
        internalAmountMinor: interno.amountMinor,
        externalAmountMinor: null,
        recommendedAction: ACAO_MISSING_EXTERNAL,
      });
      continue;
    }

    externosCasados.add(externo.externalMovementId);

    /**
     * MOEDA DIFERENTE E `AMOUNT_MISMATCH`, e nao um estado proprio: para o
     * operador as duas situacoes tem a mesma acao -- conferir com o provedor.
     * Um quinto estado no enum obrigaria a tela a explicar uma distincao que
     * nao muda o que fazer. O `MVP-02` §10 tambem so declara quatro.
     */
    const bate =
      externo.amountMinor === interno.amountMinor && externo.currency === interno.currency;

    itens.push({
      status: bate ? 'MATCHED' : 'AMOUNT_MISMATCH',
      paymentId: interno.tipo === 'PAYMENT' ? interno.id : null,
      refundId: interno.tipo === 'REFUND' ? interno.id : null,
      externalMovementId: externo.externalMovementId,
      internalAmountMinor: interno.amountMinor,
      externalAmountMinor: externo.amountMinor,
      recommendedAction: bate ? ACAO_MATCHED : ACAO_AMOUNT_MISMATCH,
    });
  }

  for (const externo of externos) {
    if (externosCasados.has(externo.externalMovementId)) {
      continue;
    }

    itens.push({
      status: 'MISSING_INTERNAL',
      paymentId: null,
      refundId: null,
      externalMovementId: externo.externalMovementId,
      internalAmountMinor: null,
      externalAmountMinor: externo.amountMinor,
      recommendedAction: ACAO_MISSING_INTERNAL,
    });
  }

  return itens;
}

/** Quantos itens exigem alguem olhar. `MATCHED` e `RESOLVED` nao exigem. */
export function contarEmAberto(itens: readonly ItemConciliado[]): number {
  return itens.filter((i) => i.status !== 'MATCHED' && i.status !== 'RESOLVED').length;
}
