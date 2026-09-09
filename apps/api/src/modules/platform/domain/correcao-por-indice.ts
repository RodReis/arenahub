/**
 * Correcao anual do contrato fixo pelo indice acumulado -- F63, ADR-052 §7.
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`). O "agora"
 * entra por parametro, e os valores do indice entram como lista -- quem le do
 * banco e o caso de uso.
 *
 * ---------------------------------------------------------------------------
 * ACUMULA, NAO SOMA.
 * ---------------------------------------------------------------------------
 *
 * Indice mensal acumula de forma multiplicativa: 1% e depois 1% da 2,01%, e
 * nao 2%. Somar as variacoes e o erro classico da correcao monetaria, e ele
 * cresce com o numero de meses -- num IPCA de 12 meses a diferenca ja aparece
 * em reais.
 *
 * ---------------------------------------------------------------------------
 * SEM VALOR CADASTRADO, NAO CORRIGE. E o aceite da fatia.
 * ---------------------------------------------------------------------------
 *
 * Falta o IPCA de um mes da janela? A correcao NAO roda, e o painel avisa
 * quais competencias faltam. As duas alternativas foram descartadas:
 * aplicar zero inventa que o indice foi zero naquele mes, e pular o mes muda
 * a janela sem que ninguem tenha decidido isso. As duas produzem uma fatura
 * errada que parece certa.
 */

/** Uma competencia do indice, como ela vem do banco. */
export interface ValorDeIndice {
  readonly referenceMonth: Date;
  /** Variacao do mes em milesimos de ponto percentual: 0,44% = 440. */
  readonly variationBasisPoints: number;
}

export type ResultadoDaCorrecao =
  | { readonly corrigiu: true; readonly valorMinor: number }
  | {
      readonly corrigiu: false;
      readonly motivo: 'INDEX_VALUE_MISSING';
      /** Competencias `AAAA-MM` sem valor cadastrado, em ordem. */
      readonly competenciasFaltando: readonly string[];
    };

/** Milesimos de ponto percentual por 100% -- 0,44% grava 440. */
const BASIS_POINTS_POR_INTEIRO = 100_000;

/** `2026-03` a partir do primeiro dia do mes. */
function competencia(data: Date): string {
  return data.toISOString().slice(0, 7);
}

/** Primeiro dia do mes, em UTC. */
function primeiroDiaDoMes(ano: number, mes: number): Date {
  return new Date(Date.UTC(ano, mes, 1));
}

/**
 * Os meses cuja variacao entra numa correcao -- de `desde` (inclusive) ate o
 * mes anterior a `ate` (exclusivo).
 *
 * O mes do proprio aniversario fica FORA: o IPCA de marco so e publicado em
 * abril, e incluir marco na correcao de 1º de marco exigiria um dado que
 * ainda nao existe no dia em que a fatura sai.
 */
export function competenciasDaJanela(desde: Date, ate: Date): Date[] {
  const meses: Date[] = [];
  let ano = desde.getUTCFullYear();
  let mes = desde.getUTCMonth();

  const limite = Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), 1);

  while (Date.UTC(ano, mes, 1) < limite) {
    meses.push(primeiroDiaDoMes(ano, mes));
    mes += 1;

    if (mes > 11) {
      mes = 0;
      ano += 1;
    }
  }

  return meses;
}

/**
 * Aplica o indice acumulado das `competencias` sobre `valorMinor`.
 *
 * ARREDONDA UMA VEZ SO, no fim. Arredondar mes a mes acumula o erro de
 * arredondamento ao longo da janela -- doze arredondamentos de meio centavo
 * chegam a seis centavos de deriva.
 */
export function corrigirPorIndice(
  valorMinor: number,
  valores: readonly ValorDeIndice[],
  competencias: readonly Date[],
): ResultadoDaCorrecao {
  const porCompetencia = new Map(
    valores.map((valor) => [competencia(valor.referenceMonth), valor.variationBasisPoints]),
  );

  const faltando = competencias
    .map(competencia)
    .filter((mes) => !porCompetencia.has(mes));

  if (faltando.length > 0) {
    return { corrigiu: false, motivo: 'INDEX_VALUE_MISSING', competenciasFaltando: faltando };
  }

  const fator = competencias.reduce((acumulado, mes) => {
    const variacao = porCompetencia.get(competencia(mes)) ?? 0;

    return acumulado * (1 + variacao / BASIS_POINTS_POR_INTEIRO);
  }, 1);

  return { corrigiu: true, valorMinor: Math.round(valorMinor * fator) };
}

/**
 * Os aniversarios do contrato que ja venceram ate `agora` -- em ordem, e
 * TODOS eles.
 *
 * Devolver so o mais recente perderia um ano de indice no contrato que
 * ninguem corrigiu no ano passado; a correcao e cumulativa e cada aniversario
 * abre a propria janela de doze meses.
 *
 * Dia 31 num mes de 30 cai no ULTIMO DIA DO MES, e nao no dia 1 do mes
 * seguinte: deixar o `Date` transbordar mudaria o mes do aniversario, e com
 * ele a janela inteira de acumulo.
 */
export function aniversariosVencidos(
  inicio: Date,
  dia: number,
  mes: number,
  agora: Date,
): Date[] {
  const vencidos: Date[] = [];

  for (let ano = inicio.getUTCFullYear() + 1; ano <= agora.getUTCFullYear(); ano += 1) {
    const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const data = new Date(Date.UTC(ano, mes - 1, Math.min(dia, ultimoDiaDoMes)));

    if (data.getTime() >= inicio.getTime() && data.getTime() <= agora.getTime()) {
      vencidos.push(data);
    }
  }

  return vencidos;
}
