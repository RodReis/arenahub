/**
 * Rótulos pt-BR da moderação de apelido público -- F30, Task 9.
 *
 * O moderador nunca vê o código cru (`PARECE_EMAIL`, `OFENSIVO`). Os sinais
 * de triagem vêm de `triarAlias` (`apps/api/.../domain/triagem-de-alias.ts`)
 * e servem só para PRIORIZAR o que olhar -- por isso o rótulo é curto, sem
 * veredito ("parece e-mail", não "e-mail proibido").
 */

export const ROTULO_DE_SINAL: Readonly<Record<string, string>> = {
  CURTO_DEMAIS: 'curto demais',
  LONGO_DEMAIS: 'longo demais',
  CARACTERE_INVISIVEL: 'caractere invisível',
  PARECE_EMAIL: 'parece e-mail',
  PARECE_TELEFONE: 'parece telefone',
  PARECE_CPF: 'parece CPF',
  PALAVRA_BLOQUEADA: 'palavra bloqueada',
  SO_SIMBOLOS: 'só símbolos',
};

/** Razão categorizada de rejeição -- opções do `<select>` de motivo. */
export const RAZAO_DE_REJEICAO: readonly { value: string; label: string }[] = [
  { value: 'OFENSIVO', label: 'Ofensivo' },
  { value: 'CONTEM_PII', label: 'Contém dado pessoal' },
  { value: 'IMPERSONACAO', label: 'Impersonação' },
  { value: 'SPAM_OU_PROPAGANDA', label: 'Spam ou propaganda' },
  { value: 'ILEGIVEL', label: 'Ilegível' },
];

export const ROTULO_DA_RAZAO: Readonly<Record<string, string>> = Object.fromEntries(
  RAZAO_DE_REJEICAO.map((r) => [r.value, r.label]),
);

/** Devolve o rótulo do sinal, ou o próprio código se algum dia divergir do enum. */
export function rotuloDoSinal(sinal: string): string {
  return ROTULO_DE_SINAL[sinal] ?? sinal;
}
