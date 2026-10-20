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
 * `OPEN`); sem ela, o vencido mais recente; sem nenhum, o primeiro mes da
 * faixa -- o "A vencer" de quem esta em dia. A escolha dos meses e LIVRE
 * ("pagou usou", decisao do PI, 01/10/2026): nenhum mes anterior vem marcado
 * so porque esta em atraso.
 */
export function selecaoInicial(faixa: readonly MesPagavelUI[]): ReadonlySet<string> {
  const aberto = faixa.find((m) => m.status === 'OPEN');
  if (aberto) return new Set([aberto.competencia]);

  const vencidos = faixa.filter((m) => m.status === 'OVERDUE');
  const ultimo = vencidos[vencidos.length - 1] ?? faixa[0];

  return ultimo ? new Set([ultimo.competencia]) : new Set();
}

export type SituacaoDoMes = 'vencido' | 'aVencer' | 'antecipar';

/**
 * A situacao de cada chip da faixa, na ordem da faixa -- decisao do PI,
 * 05/10/2026. O rotulo diz a SITUACAO do mes, nunca a acao: o antigo
 * "Adiantado" para todo mes sem fatura era lido como "ja pago", e marcava o
 * mes corrente de quem so tinha pago o anterior.
 *
 * - VENCIDO: `OVERDUE`, ou `OPEN` cujo `dueAt` ja passou (o job pode nao ter
 *   gravado `OVERDUE` ainda). Mes SEM fatura nunca e vencido: sem fatura nao
 *   ha divida ("pagou, usou").
 * - A VENCER: o primeiro mes nao vencido -- o proximo a receber.
 * - ANTECIPAR: os meses depois dele.
 *
 * `hoje` vazio (antes de montar no cliente) so reconhece o `OVERDUE` gravado.
 */
export function situacoesDosMeses(faixa: readonly MesPagavelUI[], hoje: string): SituacaoDoMes[] {
  let jaTemAVencer = false;

  return faixa.map((mes) => {
    const venceuAberto = hoje !== '' && mes.status === 'OPEN' && mes.dueAt.slice(0, 10) < hoje;
    if (mes.status === 'OVERDUE' || venceuAberto) return 'vencido';

    if (jaTemAVencer) return 'antecipar';
    jaTemAVencer = true;
    return 'aVencer';
  });
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
