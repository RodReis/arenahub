import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Catalogo de planos: beneficios e limite de membros.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`).
 *
 * POR QUE BENEFICIO E TABELA, NAO TEXTO. Decisao do PI em 18/08/2026, a
 * partir dos encartes da Arena Positiva: o mesmo item ("Bioimpedancia")
 * aparece nos dois programas com PERIODICIDADE DIFERENTE -- 30 dias no de
 * adultos e idosos, 60 no de protocolos especificos. Isso e regra, nao
 * marketing: o MVP 3 (Health Intelligence) precisa saber quando a proxima
 * avaliacao vence. Em `description` viraria prosa que ninguem consegue
 * consultar.
 *
 * O encarte tambem tem item NAO incluso ("Teste de ECG -- em avaliacao"),
 * entao `status` nao e booleano: existe o meio-termo que o cliente ja
 * imprimiu.
 */

export type StatusDeBeneficio = 'INCLUDED' | 'UNDER_REVIEW';

export interface BeneficioDePlano {
  item: string;
  status: StatusDeBeneficio;
  /** Periodicidade em dias. Ausente = beneficio sem recorrencia. */
  everyDays?: number;
  detail?: string;
}

export class BeneficioInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('PLAN_INVALID_BENEFIT', 422, motivo);
  }
}

export function validarBeneficio(beneficio: BeneficioDePlano): void {
  if (beneficio.item.trim().length === 0) {
    throw new BeneficioInvalidoError('item do beneficio nao pode ser vazio');
  }

  if (beneficio.everyDays === undefined) {
    return;
  }

  if (!Number.isInteger(beneficio.everyDays) || beneficio.everyDays <= 0) {
    throw new BeneficioInvalidoError('periodicidade deve ser inteiro de dias maior que zero');
  }

  // Periodicidade so faz sentido no que o aluno tem direito. Agendar a
  // recorrencia de um beneficio "em avaliacao" prometeria o que nao foi
  // vendido.
  if (beneficio.status !== 'INCLUDED') {
    throw new BeneficioInvalidoError('periodicidade so se aplica a beneficio incluso');
  }
}

export function beneficiosInclusos(
  beneficios: readonly BeneficioDePlano[],
): readonly BeneficioDePlano[] {
  return beneficios.filter((beneficio) => beneficio.status === 'INCLUDED');
}

/**
 * Sentinela para plano sem limite de membros.
 *
 * `Infinity` em vez de `null` porque o retorno e comparado com aritmetica
 * (`vagas > 0`), e `null` obrigaria todo chamador a testar o caso especial
 * antes de comparar.
 */
export const LIMITE_DE_MEMBROS_INDEFINIDO = Number.POSITIVE_INFINITY;

/**
 * Vagas restantes num plano com limite de membros.
 *
 * Plano familiar da Arena Positiva: 3 membros (PI, 18/08/2026). Plano
 * individual passa `undefined` -- nao tem grupo, entao nao tem limite.
 *
 * Nunca devolve negativo: grupo acima do limite (que so acontece se o limite
 * baixar depois do grupo formado) tem zero vaga, nao vaga negativa.
 */
export function vagasRestantes(limite: number | undefined, membrosAtuais: number): number {
  if (limite === undefined) {
    return LIMITE_DE_MEMBROS_INDEFINIDO;
  }

  return Math.max(0, limite - membrosAtuais);
}
