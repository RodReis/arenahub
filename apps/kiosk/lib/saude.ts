/**
 * Formatacao de medida para o totem -- `DS-TOTEM.md` §5.3.
 *
 * COPIA MINIMA do `apps/admin-web/src/health/formatar.ts`, pela mesma razao
 * documentada em `lib/dinheiro.ts`: o painel e outro app, e importar de
 * `@arenahub/ui` arrastaria o CSS claro do design system inteiro para o
 * bundle do totem. Aqui ficam SO os seis tipos que a tela mostra -- o mapa
 * completo tem trinta e cinco, e o totem nao exibe trinta e cinco.
 *
 * `Intl.NumberFormat` e permitido (a regra 5 do lint restringe
 * `Intl.DateTimeFormat`, que e fuso, nao numero).
 *
 * Se um terceiro consumidor precisar disto, a saida certa e um subcaminho de
 * export em `@arenahub/ui`, nao uma terceira copia.
 */

const ROTULO: Record<string, string> = {
  WEIGHT: 'Peso',
  BODY_FAT_PERCENT: 'Gordura corporal',
  SKELETAL_MUSCLE_MASS: 'Músculo esquelético',
  TOTAL_BODY_WATER: 'Água corporal',
  VISCERAL_FAT_LEVEL: 'Gordura visceral',
  BASAL_METABOLIC_RATE: 'Metabolismo basal',
};

const SIMBOLO: Record<string, string> = {
  KG: 'kg',
  G: 'g',
  L: 'L',
  CM: 'cm',
  M: 'm',
  PERCENT: '%',
  KCAL: 'kcal',
};

const UMA_CASA = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const rotuloDeTipo = (tipo: string): string => ROTULO[tipo] ?? tipo;

/**
 * Valor com unidade, como o aluno le.
 *
 * UMA CASA decimal: e o que a balanca reporta, e a segunda casa de um
 * bioimpedanciometro e ruido, nao precisao.
 *
 * `null` devolve traco, NUNCA zero (INV-104): zero e uma medicao, ausencia e
 * a falta dela, e as duas nao podem ler igual num totem.
 */
export function valorLegivel(valor: number | null, unidade: string | null): string {
  if (valor === null) return '—';

  const numero = UMA_CASA.format(valor);
  const simbolo = unidade === null ? '' : (SIMBOLO[unidade.toUpperCase()] ?? unidade);

  if (simbolo === '%') return `${numero}%`;

  return simbolo === '' ? numero : `${numero} ${simbolo}`;
}

/**
 * O delta contra a medicao anterior, com o sinal explicito.
 *
 * `+` no aumento nao e enfeite: sem ele, "2,4 kg" nao diz se o aluno ganhou
 * ou perdeu, e essa e a informacao inteira da linha.
 *
 * SEM JUIZO DE VALOR. Ganhar musculo e bom, ganhar gordura nao, e o totem
 * nao sabe qual e qual -- decidir isso aqui seria interpretar dado de saude
 * (ADR-035). A tela mostra a direcao; quem le sabe o que quer para si.
 *
 * `null` com `SEM_BASELINE` e "primeira medicao", que le diferente de "nao
 * mudou" -- e por isso a frase e outra, nao um zero.
 */
export function deltaLegivel(
  delta: number | null,
  unidade: string | null,
  razao: string | null,
): string | null {
  if (delta === null) {
    return razao === 'SEM_BASELINE' ? 'primeira medição' : null;
  }

  if (delta === 0) return 'sem mudança';

  const sinal = delta > 0 ? '+' : '−';

  return `${sinal}${valorLegivel(Math.abs(delta), unidade)}`;
}

const ROTULO_DE_SEGMENTO: Record<string, string> = {
  ARMS: 'Braços',
  TRUNK: 'Tronco',
  LEGS: 'Pernas',
};

export const rotuloDeSegmento = (segmento: string): string =>
  ROTULO_DE_SEGMENTO[segmento] ?? segmento;

/** O mes da medicao, em maiusculas, para o selo do bloco de composicao. */
export function mesDaMedicao(iso: string | null): string | null {
  if (iso === null) return null;

  const data = new Date(iso);

  if (Number.isNaN(data.getTime())) return null;

  const MESES = [
    'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
  ];

  return MESES[data.getUTCMonth()] ?? null;
}
