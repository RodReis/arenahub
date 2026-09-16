/**
 * Resolucao de regra de XP -- DECLARATIVA, nunca executavel.
 *
 * Uma regra e DADO: gatilho de um enum fechado e um numero de pontos. Nao
 * ha expressao, nao ha `eval`, nao ha string interpretada. E o item 4 do
 * `M5-RULES-01`, fechado por construcao: nao existe caminho por onde uma
 * regra nova chegue como codigo, porque `trigger` nao aceita valor fora do
 * enum e `points` e inteiro.
 *
 * PURA: sem banco, sem relogio. O instante do fato entra por parametro.
 */

/**
 * Os gatilhos que o catalogo aceita. Allowlist, nao validacao.
 *
 * `AVALIACAO_PUBLICADA`/`META_ATINGIDA` -- F73, MVP-05 §12 (+20/+100) --
 * fecham o buraco achado na auditoria de 15/09/2026 (issue #343): os dois
 * eram DECLARADOS consumidos pelo MVP-05 e nunca produzidos.
 */
export type GatilhoDeXp = 'SESSAO_CONFIRMADA' | 'AVALIACAO_PUBLICADA' | 'META_ATINGIDA';

export interface VersaoDeRegra {
  id: string;
  code: string;
  version: number;
  trigger: GatilhoDeXp;
  points: number;
  effectiveFrom: Date;
  /** `null` = vigente ate hoje. */
  effectiveTo: Date | null;
}

/**
 * A versao que valia QUANDO O FATO ACONTECEU.
 *
 * `quando` e o `occurredAt` do fato, nunca `new Date()`: um evento que
 * chega atrasado -- reprocessamento, fila represada, correcao de passagem
 * -- tem de ser pontuado pela regra da epoca. Resolver pelo relogio do
 * processo faria a mesma sessao valer valores diferentes conforme o dia em
 * que alguem apertasse o botao.
 *
 * `effectiveTo` e EXCLUSIVO: no instante exato da virada, vale a versao
 * nova. Sem isso duas versoes se sobrepoem por um instante e a escolha
 * passa a depender da ordem do array.
 */
export function resolverRegraVigente(
  regras: readonly VersaoDeRegra[],
  gatilho: GatilhoDeXp,
  quando: Date,
): VersaoDeRegra | null {
  const candidatas = regras.filter(
    (regra) =>
      regra.trigger === gatilho &&
      regra.effectiveFrom.getTime() <= quando.getTime() &&
      (regra.effectiveTo === null || quando.getTime() < regra.effectiveTo.getTime()),
  );

  if (candidatas.length === 0) return null;

  /*
   * Ordenar e pegar a maior versao -- e nao `candidatas[0]`. Vigencias bem
   * formadas nao se sobrepoem, mas dado mal semeado sobrepoe, e nesse caso
   * a resposta tem de ser DETERMINISTICA em vez de refletir a ordem que o
   * banco devolveu.
   */
  return candidatas.reduce((maior, atual) => (atual.version > maior.version ? atual : maior));
}
