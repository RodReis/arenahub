/**
 * Janelas point-in-time (F36, Slice 6.1).
 *
 * PURO: sem banco, sem relogio. A data de observacao entra por parametro.
 *
 * ---------------------------------------------------------------------------
 * DOIS INSTANTES, NAO UM. E A DIFERENCA ENTRE ELES QUE PEGA LEAKAGE.
 * ---------------------------------------------------------------------------
 *
 * Todo fato tem DUAS datas, e confundi-las e o erro que o MVP inteiro existe
 * para evitar:
 *
 *   - `ocorreuEm`  -- quando aconteceu no mundo;
 *   - `conhecidoEm` -- quando o sistema soube.
 *
 * Elas divergem o tempo todo: a catraca offline registra a passagem as 07h e
 * sincroniza as 19h; o webhook do PIX chega minutos depois do pagamento; a
 * conciliacao reconhece um estorno dias depois.
 *
 * O aceite da Slice 6.1 e "um snapshot passado pode ser reproduzido apenas com
 * dados disponiveis naquela data". Filtrar so por `ocorreuEm <= observacao`
 * NAO cumpre isso: o fato de terca conhecido na quinta entraria num snapshot
 * de quarta reconstruido hoje, e nao entrava no de quarta gerado na quarta. O
 * snapshot mudaria conforme o dia em que voce o recalcula -- que e exatamente
 * a nao-reprodutibilidade que `M6-FR-003` proibe.
 *
 * Por isso `dentroDaJanela` exige as DUAS condicoes, e a de conhecimento nao
 * tem default permissivo: fato sem `conhecidoEm` e tratado como conhecido no
 * momento em que ocorreu apenas quando a fonte prova ser append-only.
 */

/** Um fato datado vindo de qualquer fonte, ja normalizado. */
export interface FatoDatado {
  /** Quando aconteceu no mundo. */
  readonly ocorreuEm: Date;
  /**
   * Quando o sistema soube. Para fonte append-only cujo registro e o proprio
   * fato (`AccessEvent.createdAt`, `StudentTimelineEvent.occurredAt`), o
   * repositorio passa o instante de gravacao.
   */
  readonly conhecidoEm: Date;
}

/**
 * O recorte temporal de um snapshot.
 *
 * `corteDeConhecimento` e separado de `observadoEm` de proposito: uma
 * RECONSTRUCAO auditada (Task 5 do plano) fixa o corte no passado para provar
 * que reproduz o snapshot original, enquanto a materializacao diaria usa o
 * agora. Fossem o mesmo campo, nao haveria como expressar "reconstrua a quarta
 * como ela era na quarta".
 */
export interface RecorteDeSnapshot {
  readonly observadoEm: Date;
  readonly corteDeConhecimento: Date;
}

const MILISSEGUNDOS_POR_DIA = 86_400_000;

/**
 * `true` se o fato pode entrar num snapshot deste recorte.
 *
 * As tres condicoes, e a ordem nao importa porque todas precisam valer:
 *
 *   1. ocorreu ATE a observacao      -- nada do futuro entra;
 *   2. era CONHECIDO ate o corte     -- nada aprendido depois entra;
 *   3. ocorreu DENTRO da janela      -- o passado remoto nao conta.
 *
 * A condicao 2 e a que quase todo mundo esquece, e a unica que nao tem sintoma
 * visivel: sem ela o codigo roda, os testes passam, os numeros parecem certos
 * -- e o modelo da F40 aprende a enxergar o futuro.
 */
export function dentroDaJanela(
  fato: FatoDatado,
  recorte: RecorteDeSnapshot,
  janelaEmDias: number,
): boolean {
  if (fato.ocorreuEm > recorte.observadoEm) return false;
  if (fato.conhecidoEm > recorte.corteDeConhecimento) return false;

  const inicio = new Date(recorte.observadoEm.getTime() - janelaEmDias * MILISSEGUNDOS_POR_DIA);

  return fato.ocorreuEm > inicio;
}

/** Filtra os fatos de uma janela, preservando a ordem recebida. */
export function fatosDaJanela<T extends FatoDatado>(
  fatos: readonly T[],
  recorte: RecorteDeSnapshot,
  janelaEmDias: number,
): T[] {
  return fatos.filter((fato) => dentroDaJanela(fato, recorte, janelaEmDias));
}

/**
 * Dias inteiros entre dois instantes, truncando para baixo.
 *
 * `Math.floor` e nao arredondamento: "23 horas atras" e zero dia completo, e
 * chamar isso de "1 dia" faria `days_since_last_confirmed_passage` acusar
 * ausencia que nao houve. Truncar mantem o numero conservador -- ele so cresce
 * quando o dia realmente virou.
 */
export function diasEntre(inicio: Date, fim: Date): number {
  return Math.floor((fim.getTime() - inicio.getTime()) / MILISSEGUNDOS_POR_DIA);
}

/**
 * Dias DISTINTOS em que houve fato, no fuso ja resolvido pelo chamador.
 *
 * Conta dias, nao fatos: duas passagens no mesmo dia sao um dia treinado, e o
 * aluno que passa na catraca de manha e a noite nao pode valer o dobro de quem
 * vai uma vez. O mesmo raciocinio de `avaliarSemanas` na F32 -- e pela mesma
 * razao a chave e texto `AAAA-MM-DD`, nao `Date`.
 */
export function diasDistintos(diasLocais: readonly string[]): number {
  return new Set(diasLocais).size;
}
