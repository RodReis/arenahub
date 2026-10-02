export interface MesPagavelUI {
  readonly competencia: string; // 'YYYY-MM'
  readonly status: 'OVERDUE' | 'OPEN' | 'NOT_OPENED';
  readonly invoiceId: string | null;
  readonly totalMinor: number;
  readonly dueAt: string;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_POR_MES_PAGO = 30;

/**
 * Selecao inicial da tela: a cobranca em aberto do mes corrente (primeira
 * `OPEN`); sem ela, o vencido mais recente; sem nenhum, nada. A escolha dos
 * meses e LIVRE ("pagou usou", decisao do PI, 01/10/2026): nenhum mes
 * anterior vem marcado so porque esta em atraso.
 */
export function selecaoInicial(faixa: readonly MesPagavelUI[]): ReadonlySet<string> {
  const aberto = faixa.find((m) => m.status === 'OPEN');
  if (aberto) return new Set([aberto.competencia]);

  const vencidos = faixa.filter((m) => m.status === 'OVERDUE');
  const ultimo = vencidos[vencidos.length - 1];

  return ultimo ? new Set([ultimo.competencia]) : new Set();
}

/**
 * Meses anteriores ao ultimo selecionado, com cobranca emitida e fora da
 * selecao: sao os que a recepcao pode DISPENSAR (aluno nao usou). Mesma regra
 * do servidor (`resolverDispensa`), replicada so para mostrar a opcao -- o
 * servidor valida de novo.
 */
export function mesesDispensaveis(
  faixa: readonly MesPagavelUI[],
  selecionados: ReadonlySet<string>,
): MesPagavelUI[] {
  const ultimo = [...selecionados].sort().at(-1);
  if (!ultimo) return [];

  return faixa.filter((m) => m.invoiceId !== null && !selecionados.has(m.competencia) && m.competencia < ultimo);
}

/** Fim da vigencia paga: data do pagamento + 30 dias por mes (a carencia vem depois). */
export function vigenteAte(dataPagamento: string, mesesPagos: number): string {
  const base = new Date(`${dataPagamento}T00:00:00Z`).getTime();

  return new Date(base + mesesPagos * DIAS_POR_MES_PAGO * MS_POR_DIA).toISOString().slice(0, 10);
}

const NOMES_DOS_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** 'YYYY-MM' -> 'jul/26'. Mesmo rotulo nos chips do balcao e na grid. */
export function formatarMesAno(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  return `${NOMES_DOS_MESES[Number(mes) - 1]}/${ano!.slice(2)}`;
}
