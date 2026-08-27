import type { StudentStatus } from '@arenahub/database';

import { type DecisaoDeEngajamento, participaDoRanking } from './participacao.js';

/** Como o aluno aparece quando escolheu nao se identificar. */
export const NOME_ANONIMO = 'Participante';

export type StatusDoPerfilPublico = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN';

export type IdentidadeEscolhida = 'PRIMEIRO_NOME' | 'APELIDO' | 'ANONIMO';

export interface PerfilPublico {
  alias: string | null;
  status: StatusDoPerfilPublico;
  identidade: IdentidadeEscolhida;
}

export interface EntradaDeExposicao {
  /** Ausencia significa PARTICIPA -- ver `participacao.ts`. */
  decisao: DecisaoDeEngajamento | null;
  perfil: PerfilPublico | null;
  primeiroNome: string;
  statusDoAluno: StudentStatus;
}

export type Exposicao =
  | { exibe: true; nome: string }
  | { exibe: false; motivo: 'OPT_OUT' | 'ALUNO_INATIVO' };

/**
 * O PONTO UNICO que decide se um aluno pode aparecer publicamente, e com
 * que nome.
 *
 * Pura: sem banco, sem relogio. Toda exibicao -- API, tela do totem,
 * exportacao, ranking futuro -- passa por aqui. Quem quiser expor um aluno
 * sem chamar esta funcao tem de escrever o nome na mao, e isso aparece em
 * revisao.
 */
export function resolverExposicao(entrada: EntradaDeExposicao): Exposicao {
  if (entrada.statusDoAluno !== 'ACTIVE') {
    return { exibe: false, motivo: 'ALUNO_INATIVO' };
  }

  if (!participaDoRanking(entrada.decisao)) {
    return { exibe: false, motivo: 'OPT_OUT' };
  }

  return { exibe: true, nome: nomeExibido(entrada) };
}

/**
 * Ordem: apelido APROVADO -> anonimo -> primeiro nome.
 *
 * Alias em qualquer estado que nao `APPROVED` cai no primeiro nome. E o
 * ponto onde um apelido em moderacao vazaria se a checagem de status
 * ficasse de fora.
 */
function nomeExibido(entrada: EntradaDeExposicao): string {
  const { perfil, primeiroNome } = entrada;

  if (!perfil) return primeiroNome;

  if (perfil.identidade === 'ANONIMO') return NOME_ANONIMO;

  if (perfil.identidade === 'APELIDO' && perfil.status === 'APPROVED' && perfil.alias) {
    return perfil.alias;
  }

  return primeiroNome;
}
