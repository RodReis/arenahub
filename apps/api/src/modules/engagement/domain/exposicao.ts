import type { StudentStatus } from '@arenahub/database';

import { type DecisaoDeEngajamento, participaDoRanking } from './participacao.js';

/** Como o aluno aparece quando escolheu nao se identificar. */
export const NOME_ANONIMO = 'Participante';

/**
 * Particulas de sobrenome que NAO contam como sobrenome sozinhas --
 * `DS-TOTEM.md` §3.4c/§5.8: nome abreviado em toda tela publica e na area
 * interna. "Ana de Souza" tem que abreviar para "Ana S.", nunca "Ana d.".
 *
 * Minusculas de proposito: a comparacao em `abreviarNome` normaliza o termo
 * antes de comparar, entao a lista nao precisa cobrir variacao de caixa.
 */
const PARTICULAS_DE_SOBRENOME = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'di',
  'du',
  'del',
  'van',
  'von',
  'la',
  'le',
]);

/**
 * Abrevia um nome completo para "Primeiro S." -- a forma que toda tela
 * publica do totem exige (`DS-TOTEM.md` §3.4c, §5.8): "nomes sempre
 * abreviados em tela publica".
 *
 * Regra: primeiro termo inteiro + inicial do primeiro termo que NAO e
 * particula de ligacao, seguida de ponto. Sem sobrenome utilizavel (nome de
 * um termo so, ou só particulas depois do primeiro), devolve so o primeiro
 * termo -- sem ponto solto.
 *
 * PURA: sem banco, sem rede. Nao mexe em caixa nem acento -- o nome chega e
 * sai como o cadastro registrou; a decisao de nao normalizar caixa esta
 * registrada no relatorio da task que introduziu esta funcao.
 */
export function abreviarNome(nomeCompleto: string): string {
  const termos = nomeCompleto.trim().split(/\s+/u).filter(Boolean);

  if (termos.length === 0) return '';

  const primeiro = termos[0] as string;
  const sobrenome = termos
    .slice(1)
    .find((termo) => !PARTICULAS_DE_SOBRENOME.has(termo.toLowerCase()));

  if (!sobrenome) return primeiro;

  return `${primeiro} ${sobrenome.charAt(0).toUpperCase()}.`;
}

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
