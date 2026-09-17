/**
 * Aniversariantes do mes -- dashboard operacional, bloco novo.
 *
 * Funcao PURA: sem banco, sem relogio (`CLAUDE.md`). O "hoje" e o `birthDate`
 * de cada aluno entram por parametro, no mesmo padrao de `domain/feriados.ts`.
 */

export interface AlunoAniversariante {
  readonly nome: string;
  /** `MM-DD` do nascimento -- o ano nao importa para "faz aniversario hoje". */
  readonly diaEMes: string;
}

export interface Aniversariante {
  readonly nome: string;
  readonly diaEMes: string;
  readonly hoje: boolean;
}

/**
 * Ordena por DIA do mes, e marca quem faz aniversario hoje.
 *
 * Ordem por dia (nao por nome): quem abre o cartao quer saber "quem vem
 * primeiro no mes", igual ao cartao de feriados ao lado.
 */
export function ordenarAniversariantes(
  alunos: readonly AlunoAniversariante[],
  hojeMesDia: string,
): readonly Aniversariante[] {
  return alunos
    .map((a) => ({ nome: a.nome, diaEMes: a.diaEMes, hoje: a.diaEMes === hojeMesDia }))
    .sort((a, b) => a.diaEMes.localeCompare(b.diaEMes) || a.nome.localeCompare(b.nome));
}
