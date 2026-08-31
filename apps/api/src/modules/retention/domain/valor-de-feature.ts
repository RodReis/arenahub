/**
 * O valor de uma feature num snapshot (F36, Slice 6.1).
 *
 * PURO: sem banco, sem relogio. A data de observacao entra por parametro --
 * `CLAUDE.md`, "funcoes de calculo puras".
 *
 * ---------------------------------------------------------------------------
 * AUSENTE NAO E ZERO. E O TIPO QUE IMPEDE A CONFUSAO.
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-002` e o PRD §9 sao explicitos: "feature ausente e marcada como
 * ausente, nao zero". A diferenca nao e cosmetica -- ela decide risco:
 *
 *   - aluno com `attendance_days_30d = 0` FALTOU o mes inteiro: risco alto;
 *   - aluno com `attendance_days_30d` AUSENTE entrou ontem: risco nenhum,
 *     ainda nao houve tempo de faltar.
 *
 * Colapsar os dois em `0` faz o segundo herdar o risco do primeiro, e a fila
 * de retencao passa a ligar para quem acabou de se matricular. Por isso
 * `valor` e `null` quando ausente e `razao` e obrigatoria -- nao existe estado
 * "ausente sem motivo", e nenhum `?? 0` no caminho consegue apagar a distincao
 * sem o compilador reclamar.
 */

/**
 * Por que a feature nao tem valor.
 *
 * `SEM_HISTORICO` e o caso comum e benigno (aluno novo). Os outros tres sao
 * excepcionais e o dashboard de qualidade os conta separado: fonte que cai
 * (`FONTE_INDISPONIVEL`) degrada a completude do snapshot e precisa aparecer,
 * enquanto aluno novo e apenas a vida seguindo.
 */
export type RazaoDeAusencia =
  /** Nao ha fato suficiente na janela -- aluno novo, ou janela ainda nao coberta. */
  | 'SEM_HISTORICO'
  /** A fonte nao respondeu na materializacao. Degrada a completude. */
  | 'FONTE_INDISPONIVEL'
  /** A feature nao se aplica a este aluno (ex.: plano sem termino). */
  | 'NAO_APLICAVEL'
  /** Opt-out ou supressao vigente proibe usar o dado -- `M6-FR-006`. */
  | 'SUPRIMIDA';

/**
 * De onde veio o valor -- a marca que a decisao do PI de 31/08/2026 exige.
 *
 * O PI decidiu executar a F36 com "aceite relaxado": reconstruir o passado
 * mesmo onde a fonte nao guarda trilha completa. Esta marca e o que impede
 * essa decisao de contaminar silenciosamente o MODELO da F40.
 *
 * `M6-FR-003` proibe informacao futura nas features. Uma feature
 * `ESTADO_CORRENTE` pode viola-la sem que nenhum teste perceba -- ela acerta
 * no backtest justamente porque enxergou o futuro, e so erra em producao.
 * Marcada, a F40 a exclui do treino com um filtro; nao marcada, seria preciso
 * refazer esta fatia inteira para descobrir quais features confiar.
 *
 * Custo de carregar isto: uma coluna. Custo de nao carregar: um modelo que
 * parece bom e nao e.
 */
export type ProcedenciaDeFeature =
  /**
   * Calculada so com fatos datados e imutaveis (`occurredAt`, `dueAt`,
   * `paidAt`, `publishedAt`, timeline append-only). Reproduzivel: recalcular
   * a mesma data de observacao amanha da o mesmo numero.
   */
  | 'AS_OF'
  /**
   * Depende de campo MUTAVEL sem trilha -- o valor de hoje pode nao ser o que
   * era na data de observacao. Reproduzivel apenas por acaso.
   *
   * Hoje so `payment_failure_count_90d`: `PaymentAttempt.status` transita
   * (`PROCESSING` -> `FAILED`) depois do fato, entao uma falha ocorrida dentro
   * da janela pode ser CONHECIDA so depois dela.
   */
  | 'ESTADO_CORRENTE';

export interface ValorDeFeature {
  readonly nome: string;
  /** `null` sempre que `razao` estiver preenchida. Nunca zero por omissao. */
  readonly valor: number | null;
  readonly razao: RazaoDeAusencia | null;
  readonly procedencia: ProcedenciaDeFeature;
}

/**
 * Constroi um valor presente.
 *
 * Aceita `0` de boa vontade -- zero OBSERVADO e um fato legitimo e o tipo
 * precisa deixa-lo passar; o que nao pode e zero INVENTADO no lugar de
 * ausente, e esse caminho simplesmente nao existe nesta API.
 */
export function observado(
  nome: string,
  valor: number,
  procedencia: ProcedenciaDeFeature = 'AS_OF',
): ValorDeFeature {
  return { nome, valor, razao: null, procedencia };
}

/** Constroi um valor ausente. A razao e obrigatoria, por construcao. */
export function ausente(
  nome: string,
  razao: RazaoDeAusencia,
  procedencia: ProcedenciaDeFeature = 'AS_OF',
): ValorDeFeature {
  return { nome, valor: null, razao, procedencia };
}

/**
 * Completude do snapshot: fracao de features observadas, em `[0, 1]`.
 *
 * `M6-BR-002`: "ausencia de dado reduz confianca/completude; NAO aumenta risco
 * arbitrariamente". Este numero e a confianca; ele nunca entra na soma do
 * score. Snapshot sem feature nenhuma vale 0 -- e nao divisao por zero, que
 * viraria `NaN` e contaminaria todo agregado do dashboard em silencio.
 */
export function completude(valores: readonly ValorDeFeature[]): number {
  if (valores.length === 0) return 0;

  return valores.filter((item) => item.valor !== null).length / valores.length;
}
