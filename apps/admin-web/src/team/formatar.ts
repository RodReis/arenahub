/**
 * Rótulos pt-BR do time -- F81 (issue #415), mesmo padrão de `students/formatar.ts`.
 */

/** `profile` da tabela `students`, sem `STUDENT` -- só quem aparece em `/team`. */
export const ROTULO_DE_PERFIL: Record<string, string> = {
  TRAINER: 'Professor',
  STAFF: 'Funcionário',
  ADMIN: 'Administrador',
};

/**
 * TODO `StudentProfile`, incluindo `STUDENT` -- F82.
 *
 * `ROTULO_DE_PERFIL` fica como está (time nunca oferece "virar aluno" como
 * primeira opção de leitura da ficha de time, mas o combo de TROCA precisa do
 * destino "Aluno" nos dois sentidos: professor rebaixado, aluno promovido).
 */
export const ROTULO_DE_PERFIL_COM_ALUNO: Record<string, string> = {
  STUDENT: 'Aluno',
  ...ROTULO_DE_PERFIL,
};

/** `employmentType` -- vínculo trabalhista (Task 6). `null` é "sem vínculo definido". */
export const ROTULO_DE_VINCULO: Record<string, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
  AUTONOMOUS: 'Autônomo',
};
