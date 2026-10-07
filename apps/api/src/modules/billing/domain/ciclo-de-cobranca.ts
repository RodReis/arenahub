import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { meiaNoiteLocalEmUtc } from './bloqueio-por-inadimplencia.js';

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
 * Primeiro instante do PROXIMO ciclo: dia 1 do mes seguinte, 00:00 UTC.
 *
 * E quando uma troca de plano agendada passa a valer (decisao do PI em
 * 04/10/2026, #337: sem proracao, "a mudanca vale no proximo ciclo"). Mesmo
 * calendario da competencia -- nenhum "ciclo" novo.
 */
export function inicioDoProximoCiclo(momento: Date): Date {
  return new Date(Date.UTC(momento.getUTCFullYear(), momento.getUTCMonth() + 1, 1));
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

/**
 * Primeiro instante em que a inadimplencia bloqueia (ADR-019, INV-144): a
 * meia-noite LOCAL do dia `vencimento + carencia`, no fuso da unidade.
 *
 * `vencimento` e DATA guardada como meia-noite UTC (convencao do `dueAt`), entao
 * o dia civil vem dos campos UTC -- ler o dia local de `2026-10-10T00:00Z` em
 * Sao Paulo daria 09/10 e bloquearia um dia antes. Ate a F88 esta conta era
 * `vencimento + N x 24h` em UTC, que bloqueava as 21h da vespera.
 */
export function instanteDeBloqueio(vencimento: Date, graceDays: number, fusoDaUnidade: string): Date {
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new CicloInvalidoError('carencia deve ser inteiro de dias nao negativo');
  }

  return meiaNoiteLocalEmUtc(
    {
      ano: vencimento.getUTCFullYear(),
      mes: vencimento.getUTCMonth() + 1,
      dia: vencimento.getUTCDate() + graceDays,
    },
    fusoDaUnidade,
  );
}
