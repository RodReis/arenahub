/**
 * Regras puras da importacao de pagamentos de setembro/2026 (Arena
 * Positiva) -- issue #386.
 *
 * Sem banco, sem rede, sem relogio (`CLAUDE.md`). O arquivo de origem nao
 * tem CPF nem `studentId` -- so nome e data.
 *
 * Este modulo so PLANEJA (dry-run): decide, para cada linha do relatorio,
 * qual invoice ela pagaria -- sem tocar banco. Quem grava mora em
 * `importar.ts`.
 */

/**
 * Nome comparavel: sem acento, sem caixa, sem espaco sobrando.
 *
 * COPIA DELIBERADA de `normalizarNome` em
 * `packages/database/src/import-ativos/dominio.ts` -- mesmo motivo daquele
 * arquivo (comentario em `identificacao.ts`): `apps/api` so enxerga o que
 * `@arenahub/database` exporta em `src/index.ts` (so `"."` no `package.json`,
 * sem subpaths), e este script precisa do Nest DI para reusar
 * `BillingRepository.registrarPagamentoManual`, entao nao pode morar no
 * pacote `database`. Comportamento tem que ficar identico ao original.
 *
 * NAO tenta corrigir grafia -- aproximar por semelhanca casaria irmaos e
 * homonimos, e o preco do erro aqui e uma pessoa recebendo o acesso de
 * outra.
 */
export function normalizarNome(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export interface LinhaDeRelatorio {
  nome: string;
  data: string;
  valor: number;
}

/** `dd/mm/yyyy` para `Date` em meia-noite UTC -- mesmo formato do import-pacto. */
export function parsearDataBr(valor: string): Date {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);

  if (!partes) throw new Error(`Data fora do formato dd/mm/yyyy: "${valor}"`);

  const [, dia, mes, ano] = partes;

  return new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
}

/** Reais para centavos -- `Math.round` evita erro de ponto flutuante (1.1*100). */
export function paraCentavos(valorEmReais: number): number {
  return Math.round(valorEmReais * 100);
}

export interface CandidatoDeAlunoComInvoice {
  readonly studentId: string;
  readonly nomeNormalizado: string;
  /** Invoice OPEN ou OVERDUE mais antiga do aluno, se houver. */
  readonly invoiceAberta: { readonly id: string; readonly totalMinor: number } | null;
}

export type VereditoDaLinha =
  | { tipo: 'AMBIGUO'; nome: string }
  | { tipo: 'NAO_ENCONTRADO'; nome: string }
  | { tipo: 'SEM_INVOICE_ABERTA'; nome: string; studentId: string }
  | {
      tipo: 'PRONTO';
      nome: string;
      studentId: string;
      invoiceId: string;
      amountMinor: number;
      valorDaInvoiceMinor: number;
      paidAt: Date;
    };

/**
 * Agrupa linhas pelo nome normalizado -- expõe repetição EXATA no arquivo
 * (ex.: "Valdivino Chaves Guimaraes" 2x, mesma data e valor) antes de
 * decidir qualquer coisa contra o banco. Repetição vira pendência: pode ser
 * erro de digitação do relatório de origem ou pagamento real em duplicata,
 * e só humano decide qual.
 */
export function agruparPorNome(
  linhas: readonly LinhaDeRelatorio[],
): Map<string, LinhaDeRelatorio[]> {
  const grupos = new Map<string, LinhaDeRelatorio[]>();

  for (const linha of linhas) {
    const chave = normalizarNome(linha.nome);
    const grupo = grupos.get(chave);

    if (grupo) grupo.push(linha);
    else grupos.set(chave, [linha]);
  }

  return grupos;
}

/**
 * Decide o veredito de UM nome (já sem duplicata dentro do arquivo) contra
 * os alunos candidatos do tenant.
 *
 * NAO decide entre duas invoices em aberto -- pega a mais antiga
 * (`invoiceAberta` já vem resolvida pelo chamador) e reporta
 * `SEM_INVOICE_ABERTA` quando o aluno existe mas não tem cobrança pendente
 * pra reconciliar (mensalidade paga adiantado, ou já reconciliada por
 * outro caminho).
 */
export function decidirVeredito(
  linha: LinhaDeRelatorio,
  candidatos: readonly CandidatoDeAlunoComInvoice[],
): VereditoDaLinha {
  const nome = normalizarNome(linha.nome);
  const porNome = candidatos.filter((c) => c.nomeNormalizado === nome);

  if (porNome.length === 0) return { tipo: 'NAO_ENCONTRADO', nome: linha.nome };
  if (porNome.length > 1) return { tipo: 'AMBIGUO', nome: linha.nome };

  const [aluno] = porNome;

  if (!aluno!.invoiceAberta) {
    return { tipo: 'SEM_INVOICE_ABERTA', nome: linha.nome, studentId: aluno!.studentId };
  }

  return {
    tipo: 'PRONTO',
    nome: linha.nome,
    studentId: aluno!.studentId,
    invoiceId: aluno!.invoiceAberta.id,
    amountMinor: paraCentavos(linha.valor),
    valorDaInvoiceMinor: aluno!.invoiceAberta.totalMinor,
    paidAt: parsearDataBr(linha.data),
  };
}
