import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Medida corporal: tipo, unidade canonica, conversao e IMC.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O instante concreto
 * entra por parametro.
 *
 * As tres regras que este arquivo existe para garantir:
 *
 * - **INV-101** toda medida oficial tem tipo, valor decimal, unidade
 *   canonica, origem, responsavel e instante;
 * - **INV-104** ausencia de dado NAO E ZERO. `undefined` e `null` nunca
 *   viram `0` aqui, e nenhuma funcao devolve zero para entrada faltante;
 * - **INV-105** a unidade ORIGINAL e preservada. Converter e gravar so o
 *   resultado perde a informacao de como a medicao foi feita, e com ela a
 *   chance de descobrir depois que a balanca reportava em libras.
 */

/** Unidade em que o valor foi MEDIDO, antes de qualquer conversao. */
export type UnidadeDeMedida = 'kg' | 'g' | 'lb' | 'cm' | 'm' | 'in' | 'percent' | 'kcal' | 'L';

/**
 * Tipo de medida. Lista fechada de proposito: tipo livre viraria taxonomia
 * paralela por academia, e comparar historico entre unidades deixaria de
 * funcionar.
 *
 * `BODY_FAT_MASS` e `BODY_FAT_PERCENT` sao SEPARADOS porque o aparelho
 * reporta os dois e eles nao sao redundantes: derivar um do outro exige o
 * peso do mesmo instante, que nem sempre existe (INV-104).
 */
export type TipoDeMedida =
  | 'WEIGHT'
  | 'HEIGHT'
  | 'BODY_FAT_PERCENT'
  | 'BODY_FAT_MASS'
  | 'LEAN_BODY_MASS'
  | 'SKELETAL_MUSCLE_MASS'
  | 'TOTAL_BODY_WATER'
  | 'INTRACELLULAR_WATER'
  | 'EXTRACELLULAR_WATER'
  | 'PROTEIN_MASS'
  | 'MINERAL_MASS'
  | 'VISCERAL_FAT_LEVEL'
  | 'BASAL_METABOLIC_RATE'
  | 'WAIST_CIRCUMFERENCE'
  | 'HIP_CIRCUMFERENCE';

/**
 * Unidade canonica de cada tipo -- a unidade em que o valor e ARMAZENADO
 * para comparacao, alem do par original preservado.
 *
 * Massa em `kg`, comprimento em `cm`: sao as unidades que o aparelho da
 * academia ja usa, entao o caso comum nao converte nada.
 *
 * `VISCERAL_FAT_LEVEL` e adimensional (indice do aparelho, 1 a 59) e por
 * isso nao aparece aqui -- ver `TIPOS_ADIMENSIONAIS`.
 */
const UNIDADE_CANONICA: Readonly<Record<TipoDeMedida, UnidadeDeMedida | null>> = {
  WEIGHT: 'kg',
  HEIGHT: 'cm',
  BODY_FAT_PERCENT: 'percent',
  BODY_FAT_MASS: 'kg',
  LEAN_BODY_MASS: 'kg',
  SKELETAL_MUSCLE_MASS: 'kg',
  TOTAL_BODY_WATER: 'L',
  INTRACELLULAR_WATER: 'L',
  EXTRACELLULAR_WATER: 'L',
  PROTEIN_MASS: 'kg',
  MINERAL_MASS: 'kg',
  VISCERAL_FAT_LEVEL: null,
  BASAL_METABOLIC_RATE: 'kcal',
  WAIST_CIRCUMFERENCE: 'cm',
  HIP_CIRCUMFERENCE: 'cm',
};

/**
 * Fator para a unidade canonica da MESMA grandeza.
 *
 * Nao ha conversao entre grandezas: `kg` nunca vira `cm`. Tentar converter
 * uma medida para a unidade de outra grandeza e erro de programacao, e
 * `converterParaCanonica` recusa em vez de multiplicar por um fator que nao
 * existe.
 *
 * `L` de agua corporal converte de `kg` por 1:1 -- o aparelho reporta agua
 * em litros ou em quilos conforme o modelo, e para agua a 1 kg/L a
 * equivalencia e a que o proprio fabricante usa.
 */
const FATOR_PARA_CANONICA: Readonly<Record<UnidadeDeMedida, { canonica: UnidadeDeMedida; fator: number }>> = {
  kg: { canonica: 'kg', fator: 1 },
  g: { canonica: 'kg', fator: 0.001 },
  lb: { canonica: 'kg', fator: 0.453_592_37 },
  cm: { canonica: 'cm', fator: 1 },
  m: { canonica: 'cm', fator: 100 },
  in: { canonica: 'cm', fator: 2.54 },
  percent: { canonica: 'percent', fator: 1 },
  kcal: { canonica: 'kcal', fator: 1 },
  L: { canonica: 'L', fator: 1 },
};

/** Grandezas equivalentes: massa em kg e agua em litros usam 1 kg = 1 L. */
const EQUIVALENTES: Readonly<Record<string, readonly UnidadeDeMedida[]>> = {
  L: ['kg'],
  kg: ['L'],
};

/** Tipos sem unidade: indice adimensional do proprio aparelho. */
const TIPOS_ADIMENSIONAIS: ReadonlySet<TipoDeMedida> = new Set(['VISCERAL_FAT_LEVEL']);

/**
 * Faixa plausivel por tipo, na unidade CANONICA.
 *
 * Isto NAO E faixa de referencia clinica -- e limite de digitacao. A
 * distincao importa: faixa de referencia diz se a pessoa esta bem, e ler
 * isso e ato clinico que o produto nao pratica (ADR-035). O que estas faixas
 * pegam e `750` digitado no lugar de `75,0`.
 */
const FAIXA_PLAUSIVEL: Readonly<Record<TipoDeMedida, { min: number; max: number }>> = {
  WEIGHT: { min: 2, max: 500 },
  HEIGHT: { min: 30, max: 260 },
  BODY_FAT_PERCENT: { min: 1, max: 80 },
  BODY_FAT_MASS: { min: 0.1, max: 300 },
  LEAN_BODY_MASS: { min: 1, max: 200 },
  SKELETAL_MUSCLE_MASS: { min: 1, max: 120 },
  TOTAL_BODY_WATER: { min: 1, max: 150 },
  INTRACELLULAR_WATER: { min: 0.5, max: 100 },
  EXTRACELLULAR_WATER: { min: 0.5, max: 80 },
  PROTEIN_MASS: { min: 0.5, max: 60 },
  MINERAL_MASS: { min: 0.1, max: 20 },
  VISCERAL_FAT_LEVEL: { min: 1, max: 59 },
  BASAL_METABOLIC_RATE: { min: 300, max: 5_000 },
  WAIST_CIRCUMFERENCE: { min: 20, max: 250 },
  HIP_CIRCUMFERENCE: { min: 20, max: 250 },
};

export class MedidaInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('HEALTH_INVALID_MEASUREMENT', 422, motivo);
  }
}

export class UnidadeIncompativelError extends ErroDeDominio {
  constructor(tipo: TipoDeMedida, unidade: UnidadeDeMedida) {
    super(
      'HEALTH_INCOMPATIBLE_UNIT',
      422,
      `unidade ${unidade} nao se aplica a ${tipo}`,
    );
  }
}

/** Medida como o avaliador digitou: valor mais a unidade em que mediu. */
export interface MedidaBruta {
  readonly type: TipoDeMedida;
  readonly value: number;
  /** `null` apenas para tipo adimensional (`VISCERAL_FAT_LEVEL`). */
  readonly unit: UnidadeDeMedida | null;
}

/**
 * Medida pronta para gravar: o par original INTACTO mais o valor canonico.
 *
 * Os dois convivem de proposito (INV-105). O canonico serve a comparacao e
 * ao grafico; o original e o que prova o que foi medido, e sobrevive a
 * qualquer mudanca futura na tabela de fatores.
 */
export interface MedidaCanonica {
  readonly type: TipoDeMedida;
  readonly originalValue: number;
  readonly originalUnit: UnidadeDeMedida | null;
  readonly canonicalValue: number;
  readonly canonicalUnit: UnidadeDeMedida | null;
}

function unidadeServeAoTipo(tipo: TipoDeMedida, unidade: UnidadeDeMedida): boolean {
  const canonica = UNIDADE_CANONICA[tipo];

  if (canonica === null) {
    return false;
  }

  if (FATOR_PARA_CANONICA[unidade].canonica === canonica) {
    return true;
  }

  return (EQUIVALENTES[canonica] ?? []).includes(FATOR_PARA_CANONICA[unidade].canonica);
}

/**
 * Converte para a unidade canonica do tipo, PRESERVANDO o par original.
 *
 * Recusa unidade de outra grandeza em vez de converter (INV-105): aceitar
 * `cm` para peso e multiplicar por um fator qualquer produziria um numero
 * que parece medida e nao e.
 */
export function converterParaCanonica(medida: MedidaBruta): MedidaCanonica {
  if (!Number.isFinite(medida.value)) {
    throw new MedidaInvalidaError('valor precisa ser numero finito');
  }

  if (medida.value <= 0) {
    // Zero e negativo nao existem em medida corporal. E o zero e o valor que
    // um formulario vazio produz quando alguem trata ausencia como numero --
    // exatamente o que o INV-104 proibe.
    throw new MedidaInvalidaError('valor precisa ser maior que zero; ausencia nao e zero (INV-104)');
  }

  const canonicaDoTipo = UNIDADE_CANONICA[medida.type];

  if (TIPOS_ADIMENSIONAIS.has(medida.type)) {
    if (medida.unit !== null) {
      throw new UnidadeIncompativelError(medida.type, medida.unit);
    }

    validarFaixa(medida.type, medida.value);

    return {
      type: medida.type,
      originalValue: medida.value,
      originalUnit: null,
      canonicalValue: medida.value,
      canonicalUnit: null,
    };
  }

  if (medida.unit === null) {
    throw new MedidaInvalidaError(`${medida.type} exige unidade`);
  }

  if (!unidadeServeAoTipo(medida.type, medida.unit)) {
    throw new UnidadeIncompativelError(medida.type, medida.unit);
  }

  const canonicalValue = medida.value * FATOR_PARA_CANONICA[medida.unit].fator;

  validarFaixa(medida.type, canonicalValue);

  return {
    type: medida.type,
    originalValue: medida.value,
    originalUnit: medida.unit,
    canonicalValue,
    canonicalUnit: canonicaDoTipo,
  };
}

function validarFaixa(tipo: TipoDeMedida, valorCanonico: number): void {
  const faixa = FAIXA_PLAUSIVEL[tipo];

  if (valorCanonico < faixa.min || valorCanonico > faixa.max) {
    throw new MedidaInvalidaError(
      `${tipo} fora da faixa plausivel de digitacao (${faixa.min} a ${faixa.max})`,
    );
  }
}

/**
 * IMC a partir de peso e altura JA canonicos (kg e cm).
 *
 * Devolve `null` quando falta qualquer um dos dois -- nunca zero (INV-104).
 * Uma avaliacao so de dobras cutaneas, sem balanca, tem IMC AUSENTE; exibir
 * `0` ali faria o grafico despencar e o comparativo mentir.
 *
 * O valor volta com a precisao inteira do calculo (INV-106): arredondar
 * aqui contaminaria a comparacao com o historico. Quem exibe arredonda.
 */
export function calcularImc(
  pesoKg: number | null | undefined,
  alturaCm: number | null | undefined,
): number | null {
  if (pesoKg === null || pesoKg === undefined) {
    return null;
  }

  if (alturaCm === null || alturaCm === undefined) {
    return null;
  }

  if (!Number.isFinite(pesoKg) || !Number.isFinite(alturaCm)) {
    return null;
  }

  if (pesoKg <= 0 || alturaCm <= 0) {
    return null;
  }

  const alturaM = alturaCm / 100;

  return pesoKg / (alturaM * alturaM);
}

/**
 * Arredonda para exibicao. SO PARA EXIBICAO (INV-106).
 *
 * Existe como funcao propria para que o arredondamento tenha um lugar unico
 * e obvio, e para que grep por ela mostre todos os pontos onde precisao foi
 * descartada de proposito.
 */
export function arredondarParaExibicao(valor: number, casas: number): number {
  const fator = 10 ** casas;

  return Math.round(valor * fator) / fator;
}
