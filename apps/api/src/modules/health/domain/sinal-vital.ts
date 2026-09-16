import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Sinal vital avulso (pressao, saturacao, FC de repouso) -- card #345.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O instante concreto
 * entra por parametro.
 *
 * A validacao de faixa aqui e SANIDADE DE ENTRADA, nunca diagnostico
 * (regra de arquitetura no 8, ADR-035): 300 mmHg de sistolica e erro de
 * digitacao, nao uma leitura que o sistema decide classificar como grave.
 * As faixas cobrem o que e FISICAMENTE possivel medir num humano vivo, bem
 * mais largas que qualquer faixa clinica de referencia -- a faixa clinica
 * quem julga e o profissional, nunca o ArenaHub.
 */

export type TipoDeSinalVital = 'BLOOD_PRESSURE' | 'OXYGEN_SATURATION' | 'RESTING_HEART_RATE';

export const TIPOS_DE_SINAL_VITAL: readonly TipoDeSinalVital[] = [
  'BLOOD_PRESSURE',
  'OXYGEN_SATURATION',
  'RESTING_HEART_RATE',
];

/** Unidade fixa por tipo -- nao ha conversao aqui, diferente de `medida.ts`. */
export const UNIDADE_DO_SINAL: Readonly<Record<TipoDeSinalVital, string>> = {
  BLOOD_PRESSURE: 'mmHg',
  OXYGEN_SATURATION: '%',
  RESTING_HEART_RATE: 'bpm',
};

interface FaixaPlausivel {
  readonly min: number;
  readonly max: number;
}

/**
 * Faixa de PLAUSIBILIDADE FISICA, nao clinica. `BLOOD_PRESSURE.min`/`.max`
 * valem para a SISTOLICA; a diastolica usa `FAIXA_DIASTOLICA` a parte porque
 * o par tem limites proprios (diastolica > sistolica seria leitura invertida).
 */
const FAIXA_POR_TIPO: Readonly<Record<TipoDeSinalVital, FaixaPlausivel>> = {
  BLOOD_PRESSURE: { min: 40, max: 300 },
  OXYGEN_SATURATION: { min: 30, max: 100 },
  RESTING_HEART_RATE: { min: 20, max: 250 },
};

const FAIXA_DIASTOLICA: FaixaPlausivel = { min: 20, max: 200 };

export class SinalVitalInvalidoError extends ErroDeDominio {
  constructor(mensagem: string) {
    super('HEALTH_VITAL_INVALID', 422, mensagem);
  }
}

export class TipoDeSinalVitalInvalidoError extends ErroDeDominio {
  constructor(tipo: string) {
    super('HEALTH_VITAL_TYPE_INVALID', 400, `tipo de sinal vital desconhecido: ${tipo}`);
  }
}

export function ehTipoDeSinalVital(valor: string): valor is TipoDeSinalVital {
  return (TIPOS_DE_SINAL_VITAL as readonly string[]).includes(valor);
}

export interface SinalVitalProposto {
  readonly type: TipoDeSinalVital;
  readonly value: number;
  /** Diastolica. Exigido quando `type = BLOOD_PRESSURE`, proibido nos demais. */
  readonly secondaryValue?: number | null;
}

export interface SinalVitalValidado {
  readonly type: TipoDeSinalVital;
  readonly unit: string;
  readonly value: number;
  readonly secondaryValue: number | null;
}

/**
 * Valida um sinal vital proposto contra a faixa de plausibilidade fisica.
 *
 * `BLOOD_PRESSURE` exige as DUAS pontas (sistolica em `value`, diastolica em
 * `secondaryValue`) -- pressao sem diastolica e leitura incompleta, nunca
 * meio-registro. Os outros dois tipos recusam `secondaryValue`: sao unarios,
 * um segundo numero seria dado que ninguem pediu e ninguem le.
 */
export function validarSinalVital(proposto: SinalVitalProposto): SinalVitalValidado {
  const faixa = FAIXA_POR_TIPO[proposto.type];

  if (!Number.isFinite(proposto.value) || proposto.value < faixa.min || proposto.value > faixa.max) {
    throw new SinalVitalInvalidoError(
      `${proposto.type}: valor ${proposto.value} fora da faixa plausivel (${faixa.min}-${faixa.max})`,
    );
  }

  if (proposto.type === 'BLOOD_PRESSURE') {
    const diastolica = proposto.secondaryValue;

    if (diastolica === null || diastolica === undefined) {
      throw new SinalVitalInvalidoError('BLOOD_PRESSURE exige a diastolica em secondaryValue');
    }

    if (
      !Number.isFinite(diastolica) ||
      diastolica < FAIXA_DIASTOLICA.min ||
      diastolica > FAIXA_DIASTOLICA.max
    ) {
      throw new SinalVitalInvalidoError(
        `BLOOD_PRESSURE: diastolica ${diastolica} fora da faixa plausivel (${FAIXA_DIASTOLICA.min}-${FAIXA_DIASTOLICA.max})`,
      );
    }

    if (diastolica >= proposto.value) {
      throw new SinalVitalInvalidoError(
        'BLOOD_PRESSURE: diastolica nao pode ser maior ou igual a sistolica',
      );
    }

    return {
      type: proposto.type,
      unit: UNIDADE_DO_SINAL[proposto.type],
      value: proposto.value,
      secondaryValue: diastolica,
    };
  }

  if (proposto.secondaryValue !== null && proposto.secondaryValue !== undefined) {
    throw new SinalVitalInvalidoError(`${proposto.type} nao aceita secondaryValue`);
  }

  return {
    type: proposto.type,
    unit: UNIDADE_DO_SINAL[proposto.type],
    value: proposto.value,
    secondaryValue: null,
  };
}
