import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Dinheiro e catalogo de precos.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). A data concreta entra
 * por parametro.
 *
 * INV-065 / `M2-BR-001`: valor e INTEIRO na menor unidade monetaria
 * (centavos para BRL). Nunca `float`. O tipo `number` do TypeScript nao
 * distingue inteiro de fracionario, entao a garantia precisa ser de runtime
 * -- e por isso `validarValorMonetario` existe em vez de um alias de tipo.
 */

export class ValorMonetarioInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_MONETARY_AMOUNT', 422, motivo);
  }
}

/** Valor em centavos: inteiro finito e nao negativo. */
export function validarValorMonetario(valorMinor: number): void {
  if (!Number.isInteger(valorMinor)) {
    throw new ValorMonetarioInvalidoError(
      'valor deve ser inteiro na menor unidade monetaria; float e proibido (INV-065)',
    );
  }

  if (valorMinor < 0) {
    throw new ValorMonetarioInvalidoError('valor nao pode ser negativo');
  }
}

export interface ItemParaSomar {
  quantity: number;
  unitAmountMinor: number;
}

/**
 * Soma `quantidade x valor unitario` dos itens.
 *
 * Multiplicacao e soma de inteiros -- nenhuma divisao, nenhum arredondamento.
 * E o que mantem a soma exata: o centavo so se perde quando alguem divide.
 */
export function somarItens(itens: readonly ItemParaSomar[]): number {
  let total = 0;

  for (const item of itens) {
    if (!Number.isInteger(item.quantity) || item.quantity < 0) {
      throw new ValorMonetarioInvalidoError('quantidade deve ser inteiro nao negativo');
    }

    validarValorMonetario(item.unitAmountMinor);
    total += item.quantity * item.unitAmountMinor;
  }

  return total;
}

export interface PrecoDePlano {
  amountMinor: number;
  currency: string;
  validFrom: Date;
}

/**
 * Preco vigente do plano numa data.
 *
 * O preco e CONFIGURAVEL COM VIGENCIA (decisao do PI em 18/08/2026, ver
 * `docs/DEVELOPMENT.md`): reajuste NAO reescreve o catalogo, entra como linha
 * nova com `validFrom` proprio. Isso preserva o historico e deixa o reajuste
 * ser agendado -- e a invoice ja aberta nunca muda de valor (INV-068),
 * porque ela copia o valor no momento da abertura.
 *
 * Vigencia e inclusiva no inicio: um preco que vale a partir de 01/06 ja
 * vale as 00:00 de 01/06.
 */
export function precoVigenteEm(
  precos: readonly PrecoDePlano[],
  emQue: Date,
): PrecoDePlano | undefined {
  return [...precos]
    .filter((preco) => preco.validFrom.getTime() <= emQue.getTime())
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
}
