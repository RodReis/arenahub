import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { dataLocalDe } from './bloqueio-por-inadimplencia.js';

export interface ConfiguracaoDePagamento {
  /** Dia do mes em que o job gera a parcela do mes. */
  readonly invoiceGenerationDay: number;
  /** Dia do mes do vencimento. */
  readonly dueDay: number;
  /** Dias DEPOIS do vencimento em que a catraca bloqueia. */
  readonly graceDays: number;
}

/** O que o job de producao fazia antes da F89 (F88): gerar 01, vencer 10, bloquear +5. */
export const CONFIGURACAO_DE_PAGAMENTO_PADRAO: ConfiguracaoDePagamento = {
  invoiceGenerationDay: 1,
  dueDay: 10,
  graceDays: 5,
};

/** Dia 29-31 nao existe em todo mes; ate 28 o vencimento cai em qualquer um. */
const DIA_MAXIMO_DO_MES = 28;
const BLOQUEIO_MINIMO = 1;
const BLOQUEIO_MAXIMO = 30;

export class ConfiguracaoDePagamentoInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_SETTINGS_INVALID', 422, `configuracao de pagamento invalida: ${motivo}`);
  }
}

function inteiroEntre(valor: number, minimo: number, maximo: number): boolean {
  return Number.isInteger(valor) && valor >= minimo && valor <= maximo;
}

export function validarConfiguracaoDePagamento(c: ConfiguracaoDePagamento): ConfiguracaoDePagamento {
  if (!inteiroEntre(c.invoiceGenerationDay, 1, DIA_MAXIMO_DO_MES)) {
    throw new ConfiguracaoDePagamentoInvalidaError('dia de gerar deve ser inteiro de 1 a 28');
  }
  if (!inteiroEntre(c.dueDay, 1, DIA_MAXIMO_DO_MES)) {
    throw new ConfiguracaoDePagamentoInvalidaError('dia de vencimento deve ser inteiro de 1 a 28');
  }
  if (!inteiroEntre(c.graceDays, BLOQUEIO_MINIMO, BLOQUEIO_MAXIMO)) {
    throw new ConfiguracaoDePagamentoInvalidaError('dias de bloqueio devem ser inteiro de 1 a 30');
  }
  if (c.invoiceGenerationDay > c.dueDay) {
    throw new ConfiguracaoDePagamentoInvalidaError('o dia de gerar nao pode ser depois do vencimento');
  }

  return c;
}

/**
 * Fuso dos agendadores: o mesmo `timeZone` dos `@Cron` do modulo. O "dia de
 * hoje" do tenant e o de Brasilia, nao o do servidor nem o UTC.
 */
export const FUSO_DOS_AGENDADORES = 'America/Sao_Paulo';

/** Hoje (em Brasilia) e o dia em que este tenant gera a parcela do mes? */
export function ehDiaDeGerar(agora: Date, diaDeGerar: number): boolean {
  return dataLocalDe(agora, FUSO_DOS_AGENDADORES).dia === diaDeGerar;
}
