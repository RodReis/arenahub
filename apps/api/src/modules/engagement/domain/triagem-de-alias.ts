/**
 * Triagem de apelido publico.
 *
 * ELA CLASSIFICA, NAO PUNE. Todo alias vira `PENDING` de qualquer jeito; o
 * que a triagem faz e anexar codigos de sinal para o moderador ver primeiro
 * o que merece olhar. Rejeitar automaticamente transformaria o filtro NA
 * moderacao -- e filtro se contorna, moderador nao.
 *
 * Pura e sem servico externo: sem IA, sem chamada de rede. Ha um humano na
 * fila por decisao do PI (26/08/2026).
 */

export const ALIAS_MIN = 2;
export const ALIAS_MAX = 24;

export type SinalDeAlias =
  | 'CURTO_DEMAIS'
  | 'LONGO_DEMAIS'
  | 'CARACTERE_INVISIVEL'
  | 'PARECE_EMAIL'
  | 'PARECE_TELEFONE'
  | 'PARECE_CPF'
  | 'PALAVRA_BLOQUEADA'
  | 'SO_SIMBOLOS';

export interface ResultadoDaTriagem {
  /** Forma canonica: NFKC, minuscula, sem invisivel, espaco colapsado. */
  normalizado: string;
  sinais: readonly SinalDeAlias[];
}

/** Zero-width space, ZWNJ, ZWJ, BOM e afins -- invisiveis que duplicam alias. */
const INVISIVEIS = /[­​-‏‪-‮⁠-⁤﻿]/gu;

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
/** 10 ou 11 digitos seguidos, com ou sem separador -- telefone brasileiro. */
const TELEFONE = /(?:\d[\s()-]*){10,11}/u;
/** 11 digitos com a pontuacao classica de CPF -- deve ter separadores. */
const CPF = /\d{3}[.]\d{3}[.]\d{3}[-]\d{2}|\d{3}\s\d{3}\s\d{3}[-\s]\d{2}/u;
/** Pelo menos uma letra ou digito -- senao e so simbolo. */
const TEM_ALFANUMERICO = /[\p{L}\p{N}]/u;

/**
 * Remove acento para comparar palavra bloqueada.
 *
 * Sem isto, bloquear "arrombado" nao pega "arrombádo" -- e trocar uma letra
 * por sua versao acentuada e a primeira coisa que se tenta.
 */
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function triarAlias(
  bruto: string,
  palavrasBloqueadas: readonly string[],
): ResultadoDaTriagem {
  const sinais = new Set<SinalDeAlias>();

  if (INVISIVEIS.test(bruto)) sinais.add('CARACTERE_INVISIVEL');
  // `lastIndex` sobrevive entre chamadas em regex global -- zerar aqui
  // evita que a proxima chamada comece do meio da string anterior.
  INVISIVEIS.lastIndex = 0;

  const normalizado = bruto
    .normalize('NFKC')
    .replace(INVISIVEIS, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

  if (normalizado.length < ALIAS_MIN) sinais.add('CURTO_DEMAIS');
  if (normalizado.length > ALIAS_MAX) sinais.add('LONGO_DEMAIS');
  if (!TEM_ALFANUMERICO.test(normalizado)) sinais.add('SO_SIMBOLOS');

  if (EMAIL.test(normalizado)) sinais.add('PARECE_EMAIL');
  if (TELEFONE.test(normalizado)) sinais.add('PARECE_TELEFONE');
  else if (CPF.test(normalizado)) sinais.add('PARECE_CPF');

  const comparavel = semAcento(normalizado);
  const bloqueada = palavrasBloqueadas.some((palavra) =>
    comparavel.includes(semAcento(palavra.toLowerCase())),
  );
  if (bloqueada) sinais.add('PALAVRA_BLOQUEADA');

  return { normalizado, sinais: [...sinais] };
}
