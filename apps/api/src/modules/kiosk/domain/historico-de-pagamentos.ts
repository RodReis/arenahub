/** `DS-TOTEM.md` §5.7: "seis linhas (ultimos 6 meses)". */
export const MESES_DO_HISTORICO = 6;

/** Uma linha do historico -- so o que a tela do totem desenha. */
export interface LinhaDoHistorico {
  readonly invoiceId: string;
  readonly status: string;
  readonly vencimentoEm: string;
  readonly pagoEm: string | null;
  readonly valorEmCentavos: number;
  readonly moeda: string;
  readonly emAberto: boolean;
}

/** O minimo que `recortarHistorico` precisa ler de uma invoice. */
export interface InvoiceDoHistorico {
  readonly id: string;
  readonly status: string;
  readonly dueAt: Date;
  readonly paidAt: Date | null;
  readonly totalMinor: number;
  readonly currency: string;
}

const ABERTAS = new Set(['OPEN', 'OVERDUE']);

/**
 * O recorte do §5.7: fatura em aberto no topo, depois os ultimos meses.
 *
 * PURA -- sem banco, sem relogio: `agora` entra por parametro (`CLAUDE.md`).
 *
 * O CORTE E POR JANELA DE TEMPO, e as abertas escapam dele. Uma fatura
 * vencida ha oito meses e exatamente a que o aluno foi ao totem resolver;
 * corta-la por idade sumiria com a divida da tela e deixaria o totem
 * afirmando, por omissao, que nao ha o que pagar. Ela entra no topo, sempre.
 *
 * As abertas vem da mais ANTIGA para a mais nova (e a antiga que se resolve
 * primeiro); as fechadas, da mais recente para a mais velha (historico se le
 * de tras para frente).
 */
export function recortarHistorico(
  invoices: readonly InvoiceDoHistorico[],
  agora: Date,
  meses: number,
): readonly LinhaDoHistorico[] {
  const limite = new Date(agora);
  limite.setMonth(limite.getMonth() - meses);

  const abertas = invoices
    .filter((i) => ABERTAS.has(i.status))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id));

  const fechadas = invoices
    .filter((i) => !ABERTAS.has(i.status) && i.dueAt >= limite)
    .sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime() || a.id.localeCompare(b.id));

  /*
   * Desempate por `id` nos dois: `dueAt` empata com facilidade (duas faturas
   * do mesmo vencimento), e sem desempate a ordem cai na fisica do Postgres
   * -- que muda depois de qualquer UPDATE na tabela.
   */
  return [...abertas, ...fechadas].slice(0, meses).map((i) => ({
    invoiceId: i.id,
    status: i.status,
    vencimentoEm: i.dueAt.toISOString(),
    pagoEm: i.paidAt?.toISOString() ?? null,
    valorEmCentavos: i.totalMinor,
    moeda: i.currency,
    emAberto: ABERTAS.has(i.status),
  }));
}
