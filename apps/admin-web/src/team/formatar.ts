/**
 * Rótulos pt-BR do time -- F81 (issue #415), mesmo padrão de `students/formatar.ts`.
 */

/** `profile` da tabela `students`, sem `STUDENT` -- só quem aparece em `/team`. */
export const ROTULO_DE_PERFIL: Record<string, string> = {
  TRAINER: 'Professor',
  STAFF: 'Funcionário',
  ADMIN: 'Administrador',
};

/** `employmentType` -- vínculo trabalhista (Task 6). `null` é "sem vínculo definido". */
export const ROTULO_DE_VINCULO: Record<string, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
  AUTONOMOUS: 'Autônomo',
};
