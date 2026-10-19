import { dataLocalDe } from './bloqueio-por-inadimplencia.js';

/**
 * Inadimplência por mês: o que separa "Inadimplentes Mês Atual" de
 * "Inadimplentes Mês Anterior" na tela de Cobrança (decisão do PI, 19/10/2026).
 *
 * O corte é o MÊS DO VENCIMENTO no fuso da unidade do aluno (ADR-019, sem
 * fallback): uma fatura que vence às 22h do último dia do mês em Manaus já é o
 * mês seguinte em UTC, e contá-la no mês errado a mandaria para a aba errada.
 * Funções puras -- o "agora" entra por parâmetro.
 */

/** O que a agregação precisa de cada fatura vencida em aberto. */
export interface FaturaVencidaDoAluno {
  readonly studentId: string;
  readonly studentName: string;
  readonly dueAt: Date;
  readonly diasEmAtraso: number;
  readonly situacao: 'BLOQUEADO' | 'EM_CARENCIA';
  readonly telefone: string | null;
  readonly liberadoAte: Date | null;
  readonly fusoDaUnidade: string;
}

/** Um aluno com faturas vencidas em meses anteriores -- uma linha por aluno. */
export interface LinhaDeMesesAnteriores {
  readonly studentId: string;
  readonly studentName: string;
  readonly telefone: string | null;
  /** Meses de vencimento (`AAAA-MM`) com fatura em aberto, do mais antigo ao mais recente. */
  readonly mesesEmAberto: readonly string[];
  readonly faturas: number;
  readonly vencimentoMaisAntigo: Date;
  /** Dias de atraso da fatura mais antiga. */
  readonly diasEmAtraso: number;
  /** `BLOQUEADO` se QUALQUER fatura dele estiver bloqueando o acesso. */
  readonly situacao: 'BLOQUEADO' | 'EM_CARENCIA';
  readonly liberadoAte: Date | null;
  readonly fusoDaUnidade: string;
}

/** `AAAA-MM` de um instante, no fuso dado. */
export function mesLocal(instante: Date, fuso: string): string {
  const { ano, mes } = dataLocalDe(instante, fuso);

  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
}

/** A fatura venceu dentro do mês corrente da unidade? */
export function venceuNoMesAtual(
  fatura: { readonly dueAt: Date; readonly fusoDaUnidade: string },
  agora: Date,
): boolean {
  return mesLocal(fatura.dueAt, fatura.fusoDaUnidade) === mesLocal(agora, fatura.fusoDaUnidade);
}

/**
 * Agrupa as faturas de meses anteriores por aluno.
 *
 * Quem tem fatura só no mês atual não entra. A ordem é a da fila de cobrança:
 * quem está sem acesso primeiro, depois o atraso mais antigo, e o id do aluno
 * desempata -- sem chave estável a lista dançaria entre recargas.
 */
export function agruparMesesAnteriores(
  faturas: readonly FaturaVencidaDoAluno[],
  agora: Date,
): readonly LinhaDeMesesAnteriores[] {
  const porAluno = new Map<string, FaturaVencidaDoAluno[]>();

  for (const fatura of faturas) {
    if (venceuNoMesAtual(fatura, agora)) continue;

    porAluno.set(fatura.studentId, [...(porAluno.get(fatura.studentId) ?? []), fatura]);
  }

  const linhas = [...porAluno.values()].map<LinhaDeMesesAnteriores>((doAluno) => {
    const maisAntiga = doAluno.reduce((a, b) => (b.dueAt < a.dueAt ? b : a));
    const liberacoes = doAluno.flatMap((f) => (f.liberadoAte ? [f.liberadoAte] : []));

    return {
      studentId: maisAntiga.studentId,
      studentName: maisAntiga.studentName,
      telefone: maisAntiga.telefone,
      mesesEmAberto: [
        ...new Set(doAluno.map((f) => mesLocal(f.dueAt, f.fusoDaUnidade))),
      ].sort(),
      faturas: doAluno.length,
      vencimentoMaisAntigo: maisAntiga.dueAt,
      diasEmAtraso: maisAntiga.diasEmAtraso,
      situacao: doAluno.some((f) => f.situacao === 'BLOQUEADO') ? 'BLOQUEADO' : 'EM_CARENCIA',
      liberadoAte:
        liberacoes.length === 0 ? null : liberacoes.reduce((a, b) => (b > a ? b : a)),
      fusoDaUnidade: maisAntiga.fusoDaUnidade,
    };
  });

  return linhas.sort((a, b) => {
    if (a.situacao !== b.situacao) return a.situacao === 'BLOQUEADO' ? -1 : 1;
    if (a.diasEmAtraso !== b.diasEmAtraso) return b.diasEmAtraso - a.diasEmAtraso;

    return a.studentId.localeCompare(b.studentId);
  });
}
