import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Grupo familiar: UMA assinatura, UMA invoice, N direitos de acesso.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`).
 *
 * POR QUE ISSO NAO QUEBRA O MVP 1. `Entitlement` ja tem `studentId` PROPRIO
 * e `subscriptionId` NULAVEL (`schema.prisma`): o motor de decisao de acesso
 * (F9) sempre leu o direito PELO ALUNO, nunca pela assinatura. Entao o plano
 * familiar nao precisa mexer em `Subscription.studentId` nem no motor --
 * muda so a cardinalidade da derivacao, de 1:1 para 1:N.
 *
 * O titular e quem responde pela cobranca; dependente tem direito de acesso
 * e nao tem invoice. E por isso que `role` existe: sem ele, "quem paga" so
 * se descobriria por convencao.
 */

export type PapelNoGrupo = 'HOLDER' | 'DEPENDENT';

export interface MembroDoGrupo {
  studentId: string;
  role: PapelNoGrupo;
}

/** Plano familiar da Arena Positiva: 3 membros (PI, 18/08/2026). */
export const LIMITE_PADRAO_DE_MEMBROS = 3;

export class GrupoFamiliarInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_FAMILY_GROUP', 422, motivo);
  }
}

/**
 * Admite um membro no grupo, devolvendo grupo novo.
 *
 * Imutavel: devolve copia, nunca altera a lista recebida (`CLAUDE.md`).
 */
export function admitirMembro(
  grupo: readonly MembroDoGrupo[],
  novo: MembroDoGrupo,
  limite: number = LIMITE_PADRAO_DE_MEMBROS,
): readonly MembroDoGrupo[] {
  if (grupo.length >= limite) {
    throw new GrupoFamiliarInvalidoError(
      `grupo ja tem ${String(limite)} membros, que e o limite do plano`,
    );
  }

  if (grupo.some((membro) => membro.studentId === novo.studentId)) {
    throw new GrupoFamiliarInvalidoError('aluno ja pertence a este grupo');
  }

  // Um titular por grupo: e ele que a invoice cobra. Dois titulares tornariam
  // ambigua a responsabilidade pelo pagamento -- e ambiguidade em cobranca
  // vira inadimplencia de ninguem.
  if (novo.role === 'HOLDER' && grupo.some((membro) => membro.role === 'HOLDER')) {
    throw new GrupoFamiliarInvalidoError('grupo ja tem titular; so um responde pela cobranca');
  }

  return [...grupo, novo];
}

/**
 * Alunos que recebem `Entitlement` a partir da assinatura do grupo.
 *
 * Titular e dependentes, sem distincao: o plano familiar vende acesso para
 * todos. A diferenca de papel e financeira, nao de direito.
 */
export function membrosParaDerivarEntitlement(grupo: readonly MembroDoGrupo[]): readonly string[] {
  return grupo.map((membro) => membro.studentId);
}
