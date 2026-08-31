/**
 * A randomizacao reproduzivel do experimento (F39, Slice 6.4).
 *
 * PURA e DETERMINISTICA: sem relogio, sem `Math.random()`, sem banco. O grupo
 * de um aluno e funcao de `(semente, studentId)` e de mais nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HASH, E NAO SORTEIO GUARDADO
 * ---------------------------------------------------------------------------
 *
 * A implementacao obvia sorteia com `Math.random()` e grava o resultado. Ela
 * funciona ate a primeira pergunta seria: *"como sabemos que ninguem mexeu na
 * alocacao depois de ver o resultado?"* -- e a resposta seria "confie na
 * tabela".
 *
 * Com hash deterministico a alocacao e VERIFICAVEL: qualquer pessoa recalcula
 * `(semente, aluno)` e confere contra o que esta gravado. Trocar um aluno de
 * grupo para melhorar o numero final deixa de ser invisivel, e e exatamente
 * isso que `M6-AC-007` ("preserva atribuicao") e o aceite da Slice 6.4 ("sem
 * cherry-picking") exigem.
 *
 * A gravacao continua existindo -- ela e a prova de QUANDO o aluno entrou --,
 * mas ela deixa de ser a unica fonte da verdade sobre QUAL grupo ele pegou.
 *
 * ---------------------------------------------------------------------------
 * A SEMENTE E POR EXPERIMENTO, E ISSO NAO E DETALHE
 * ---------------------------------------------------------------------------
 *
 * Se a semente fosse fixa, o aluno que caiu no controle no primeiro
 * experimento cairia no controle em todos os seguintes -- e o mesmo grupo de
 * pessoas ficaria permanentemente sem intervencao, acumulando o custo de ser
 * controle. Com semente por experimento, cada rodada re-embaralha.
 */

import { createHash } from 'node:crypto';

/**
 * Os dois grupos. `CONTROLE` **nunca vira tarefa** -- e o que torna a
 * comparacao possivel, e tambem o custo do experimento: sao alunos em risco
 * que ninguem liga, de proposito, para saber se ligar muda alguma coisa.
 */
export const GRUPOS_DO_EXPERIMENTO = ['CONTROLE', 'TRATAMENTO'] as const;

export type GrupoDoExperimento = (typeof GRUPOS_DO_EXPERIMENTO)[number];

/**
 * 20% no controle. Decisao do PI em 31/08/2026.
 *
 * Um em cada cinco alunos em risco fica sem ligacao. Custo de oportunidade
 * baixo, amostra suficiente para a base da Arena Positiva. E PADRAO, nao
 * constante: a fracao e congelada na versao do experimento.
 */
export const FRACAO_DE_CONTROLE_PADRAO = 0.2;

/** 2^53 - 1: o maior inteiro exato em `double`, para normalizar sem perda. */
const DIVISOR = 2 ** 53;

/**
 * Um numero estavel em `[0, 1)` para o par `(semente, aluno)`.
 *
 * SHA-256 dos dois com separador, dos quais se leem 53 bits. O separador
 * `` impede colisao entre `('a1', 'b2')` e `('a1b', '2')` -- concatenar
 * cru faria dois pares distintos caírem no mesmo grupo por acidente.
 */
export function posicaoDeterministica(semente: string, studentId: string): number {
  const digest = createHash('sha256').update(`${semente}${studentId}`).digest();
  // 53 bits: 6 bytes inteiros (48) + 5 bits do setimo.
  const bits =
    digest.readUIntBE(0, 6) * 32 + (digest.readUInt8(6) >> 3);

  return bits / DIVISOR;
}

/**
 * O grupo do aluno neste experimento.
 *
 * `fracaoDeControle` vem da versao CONGELADA do experimento: mudar a fracao no
 * meio moveria alunos de grupo, que e o que `M6-FR-012` proibe.
 */
export function sortearGrupo(
  semente: string,
  studentId: string,
  fracaoDeControle: number,
): GrupoDoExperimento {
  if (!Number.isFinite(fracaoDeControle) || fracaoDeControle < 0 || fracaoDeControle > 1) {
    throw new Error(`FRACAO_INVALIDA: ${fracaoDeControle} fora de [0, 1]`);
  }

  return posicaoDeterministica(semente, studentId) < fracaoDeControle
    ? 'CONTROLE'
    : 'TRATAMENTO';
}
