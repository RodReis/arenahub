import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Ciclo de cobranca: competencia, vencimento e instante de bloqueio.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" entra por
 * parametro.
 */

export class CicloInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_CYCLE', 422, motivo);
  }
}

/**
 * Periodo de competencia da invoice: primeiro dia do mes.
 *
 * E o que da a unicidade de INV-066 -- uma invoice por assinatura e
 * periodo. Sem normalizar, duas cobrancas do mesmo mes teriam chaves
 * diferentes e a constraint nao pegaria a duplicata.
 */
export function competenciaDe(momento: Date): Date {
  return new Date(Date.UTC(momento.getUTCFullYear(), momento.getUTCMonth(), 1));
}

/**
 * Vencimento a partir da competencia e do dia configurado no tenant.
 *
 * DIA LIMITADO A 28: 29, 30 e 31 nao existem em todo mes, e a alternativa
 * (empurrar para o ultimo dia) faria o vencimento variar de mes para mes
 * sem ninguem ter pedido. Fevereiro e a razao -- nao a excecao.
 */
export function proximoVencimento(competencia: Date, dueDay: number): Date {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    throw new CicloInvalidoError('dia de vencimento deve estar entre 1 e 28');
  }

  return new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth(), dueDay));
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Primeiro instante em que a inadimplencia bloqueia (ADR-019, INV-144).
 *
 * `vencimento + carencia`, exato. Sem arredondar para o fim do dia e sem
 * adiar por feriado: a ancora e configuravel no `BillingSettings`, e o
 * padrao e este.
 */
export function instanteDeBloqueio(vencimento: Date, graceDays: number): Date {
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new CicloInvalidoError('carencia deve ser inteiro de dias nao negativo');
  }

  return new Date(vencimento.getTime() + graceDays * MS_POR_DIA);
}
