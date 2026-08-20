/**
 * Contexto de saude do aluno: fatores individuais que mudam como o laudo
 * deve ser lido (ADR-037).
 *
 * Funcoes puras, deterministicas: mesmo conjunto de fatores, mesmo resultado.
 *
 * **Por que isto existe.** No laudo real de 03/08/2026, com 69,7 kg de massa
 * livre de gordura contra a faixa do aparelho de 52,0-64,8, *seis campos
 * saem "acima" numa unica medicao* -- e nenhum significa o que o aparelho
 * sugere. Ferramenta que dispara seis avisos falsos por avaliacao e
 * abandonada na terceira semana, e junto param de ser lidos os verdadeiros.
 *
 * **O vocabulario importa.** Nao existe "alerta clinico" neste produto: o
 * que existe e *valor fora da faixa do equipamento*. Ler faixa como
 * diagnostico e ato clinico que a academia nao pratica (ADR-035).
 *
 * **Lista fechada, sem texto livre.** Fator individual e dado de saude
 * (art. 11); campo aberto preenchido no balcao vira deposito de informacao
 * medica com finalidade impossivel de enumerar.
 */

/** Fator de contexto. Espelha o enum `HealthContextFactor` do Prisma. */
export type FatorDeContexto =
  | 'SUPLEMENTACAO_CREATINA'
  | 'COMPOSICAO_ATIPICA'
  | 'GESTANTE_OU_POS_PARTO'
  | 'EDEMA_RELATADO'
  | 'USO_DE_DIURETICO'
  | 'ATLETA_COMPETITIVO';

/**
 * Aviso de *valor fora da faixa do equipamento*.
 *
 * Os de sufixo `_HIGH` sao de compartimento ABSOLUTO; `WATER_RATIO_ABNORMAL`
 * e de RAZAO -- a distincao e o que o `COMPOSICAO_ATIPICA` usa, porque
 * pessoa grande tem compartimento grande e razao normal.
 */
export type AvisoDeFaixa =
  | 'BODY_FAT_PERCENT_HIGH'
  | 'LEAN_BODY_MASS_HIGH'
  | 'SKELETAL_MUSCLE_MASS_HIGH'
  | 'TOTAL_BODY_WATER_HIGH'
  | 'INTRACELLULAR_WATER_HIGH'
  | 'EXTRACELLULAR_WATER_HIGH'
  | 'PROTEIN_MASS_HIGH'
  | 'MINERAL_MASS_HIGH'
  | 'WATER_RATIO_ABNORMAL'
  | 'POPULATION_RANGE_COMPARISON'
  | 'PERSONAL_HISTORY_COMPARISON';

/** A lista fechada, em runtime -- e o que a guarda de cobertura percorre. */
export const FATORES: readonly FatorDeContexto[] = [
  'SUPLEMENTACAO_CREATINA',
  'COMPOSICAO_ATIPICA',
  'GESTANTE_OU_POS_PARTO',
  'EDEMA_RELATADO',
  'USO_DE_DIURETICO',
  'ATLETA_COMPETITIVO',
];

/** Fator que impede interpretar -- a avaliacao e registrada, nao lida. */
const BLOQUEIAM_ANALISE: ReadonlySet<FatorDeContexto> = new Set(['GESTANTE_OU_POS_PARTO']);

/** Avisos de agua: os quatro que uma leitura hidrica alterada invalida. */
const AVISOS_DE_AGUA: readonly AvisoDeFaixa[] = [
  'TOTAL_BODY_WATER_HIGH',
  'INTRACELLULAR_WATER_HIGH',
  'EXTRACELLULAR_WATER_HIGH',
  'WATER_RATIO_ABNORMAL',
];

/**
 * O que cada fator suprime. Tabela do ADR-037, uma linha por fator.
 *
 * `GESTANTE_OU_POS_PARTO` suprime NADA de proposito: ele bloqueia a analise
 * inteira, e suprimir avisos ali seria dizer que o resto foi interpretado.
 */
const SUPRESSAO: Readonly<Record<FatorDeContexto, readonly AvisoDeFaixa[]>> = {
  SUPLEMENTACAO_CREATINA: ['INTRACELLULAR_WATER_HIGH'],

  // Compartimento ABSOLUTO sai; RAZAO fica. Pessoa grande tem agua, proteina
  // e mineral grandes -- e a proporcao entre eles que ainda diz algo.
  COMPOSICAO_ATIPICA: [
    'TOTAL_BODY_WATER_HIGH',
    'INTRACELLULAR_WATER_HIGH',
    'EXTRACELLULAR_WATER_HIGH',
    'PROTEIN_MASS_HIGH',
    'MINERAL_MASS_HIGH',
    'LEAN_BODY_MASS_HIGH',
    'SKELETAL_MUSCLE_MASS_HIGH',
  ],

  GESTANTE_OU_POS_PARTO: [],

  // Agua inteira invalidada, inclusive a razao: retencao muda os dois
  // compartimentos e a proporcao entre eles.
  EDEMA_RELATADO: AVISOS_DE_AGUA,
  USO_DE_DIURETICO: AVISOS_DE_AGUA,

  // Comparar atleta com a faixa populacional do aparelho e comparar com
  // quem ele nao e. Contra o proprio historico, segue valendo.
  ATLETA_COMPETITIVO: ['POPULATION_RANGE_COMPARISON'],
};

/** Todos os avisos suprimidos pelos fatores ativos, sem repeticao. */
export function avisosSuprimidos(fatores: readonly FatorDeContexto[]): AvisoDeFaixa[] {
  const suprimidos = new Set<AvisoDeFaixa>();

  for (const fator of fatores) {
    for (const aviso of SUPRESSAO[fator]) {
      suprimidos.add(aviso);
    }
  }

  return [...suprimidos];
}

/** Este aviso e suprimido pelos fatores ativos? */
export function suprime(
  fatores: readonly FatorDeContexto[],
  aviso: AvisoDeFaixa,
): boolean {
  return fatores.some((fator) => SUPRESSAO[fator].includes(aviso));
}

/**
 * A analise deve ser bloqueada?
 *
 * Bloqueada nao e "erro": a avaliacao e registrada, guardada e comparavel.
 * O que nao acontece e interpretar -- que e o que o produto se recusa a
 * fazer quando a fisiologia sai do que o aparelho sabe medir.
 */
export function analiseBloqueada(fatores: readonly FatorDeContexto[]): boolean {
  return fatores.some((fator) => BLOQUEIAM_ANALISE.has(fator));
}
