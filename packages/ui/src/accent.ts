/**
 * Resolvedor de accent do tenant.
 *
 * O tenant fornece UM hex seed. O sistema deriva a rampa e escolhe cada papel
 * por CONTRASTE CALCULADO -- nunca por numero fixo de tom (DS-PAINEL.md §2.3).
 *
 * Por que isso importa mais do que parece: um tenant com accent amarelo e um
 * com accent azul-marinho nao tem o mesmo tom "certo" para acao solida. Fixar
 * `accent-700` funcionaria para o Ciano Arena e produziria texto branco
 * ilegivel sobre amarelo. O resolvedor varre a rampa e para no primeiro tom
 * que atinge o alvo -- o mais claro que ainda passa, para a marca aparecer o
 * maximo que a acessibilidade permite.
 */

import { AA_TEXT, contrastRatio, meets, parseHex, ratio } from './contrast.js';

/** Degraus da rampa, do mais claro ao mais escuro. */
export const RAMP_TONES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export type RampTone = (typeof RAMP_TONES)[number];

export type AccentRamp = Readonly<Record<RampTone, string>>;

export interface ResolvedAccent {
  readonly ramp: AccentRamp;
  /** Fundo de acao solida -- menor tom com contraste >= 4.5 contra o texto. */
  readonly solid: string;
  /** Texto sobre a acao solida. */
  readonly onSolid: string;
  /** Cor de texto/link sobre a superficie clara. */
  readonly text: string;
  /** Hover da acao solida -- um degrau mais escuro. */
  readonly hover: string;
  /** Fundo sutil de selecao. */
  readonly subtleBg: string;
  /** Anel de foco. Mesma cor do texto de acao, 2 px + offset 2 px. */
  readonly focusRing: string;
  /** Diagnostico: contraste efetivo de cada papel resolvido. */
  readonly report: AccentReport;
}

/**
 * Contraste medido de cada papel.
 *
 * Tipo fechado, nao `Record<string, number>`: um campo com nome errado tem de
 * ser erro de compilacao, nao `undefined` silencioso num teste que passa.
 */
export interface AccentReport {
  readonly solidOnWhite: number;
  readonly textOnSurface: number;
  readonly hoverOnWhite: number;
  readonly subtleBgOnSurface: number;
}

/* -------------------------------------------------------------------------
 * OKLCH -- derivacao da rampa a partir do seed.
 *
 * sRGB -> OKLab -> OKLCH, muda o L, volta. OKLCH porque manter croma e matiz
 * enquanto so a luminosidade anda produz uma rampa que parece a mesma cor em
 * dez forcas; fazer o mesmo em HSL produz tons que derivam de matiz e "sujam"
 * nas pontas.
 * ---------------------------------------------------------------------- */

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

function hexToOklch(hex: string): Oklch {
  const { r, g, b } = parseHex(hex);
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  return {
    l: L,
    c: Math.sqrt(a * a + bb * bb),
    h: Math.atan2(bb, a),
  };
}

function oklchToHex({ l, c, h }: Oklch): string {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m_ = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s_ = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);

  const lr = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const lg = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const lb = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;

  // Clamp e o gamut mapping do pobre. Seed muito saturado num L extremo sai do
  // sRGB; grampear satura a ponta em vez de estourar para uma cor aleatoria.
  const toByte = (v: number): number =>
    Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));

  const hex = (v: number): string => toByte(v).toString(16).padStart(2, '0');

  return `#${hex(lr)}${hex(lg)}${hex(lb)}`.toUpperCase();
}

/**
 * Luminosidade OKLCH alvo de cada degrau.
 *
 * Fixa, nao derivada do seed: e o que garante que `accent-700` de dois tenants
 * diferentes tenha o mesmo PESO visual, mesmo com matizes distintos.
 */
const TONE_LIGHTNESS: Readonly<Record<RampTone, number>> = {
  50: 0.972,
  100: 0.925,
  200: 0.86,
  300: 0.786,
  400: 0.714,
  500: 0.645,
  600: 0.565,
  700: 0.481,
  800: 0.397,
  900: 0.316,
};

/** Deriva os 10 tons a partir do hex seed, preservando croma e matiz. */
export function deriveRamp(seedHex: string): AccentRamp {
  const seed = hexToOklch(seedHex);

  const entries = RAMP_TONES.map((tone): readonly [RampTone, string] => {
    // Croma cai nas pontas: no claro e no muito escuro, croma alto vira neon.
    const lightness = TONE_LIGHTNESS[tone];
    const distanceFromMid = Math.abs(lightness - 0.645);
    const chromaScale = 1 - Math.min(0.55, distanceFromMid * 0.85);
    return [tone, oklchToHex({ l: lightness, c: seed.c * chromaScale, h: seed.h })];
  });

  return Object.fromEntries(entries) as AccentRamp;
}

/**
 * Menor tom (mais claro) cuja cor atinge `target` contra `against`.
 *
 * Devolve o tom mais escuro da rampa se nenhum atingir -- e a melhor tentativa
 * disponivel, e `report` denuncia o valor real para o teste reprovar.
 */
function minToneWithContrast(ramp: AccentRamp, against: string, target: number): string {
  for (const tone of RAMP_TONES) {
    if (meets(ramp[tone], against, target)) return ramp[tone];
  }
  return ramp[900];
}

/** Um degrau mais escuro que `hex` na rampa. Se ja for o ultimo, devolve ele. */
function nextDarkerTone(ramp: AccentRamp, hex: string): string {
  const index = RAMP_TONES.findIndex((t) => ramp[t] === hex);
  if (index < 0) return hex;

  const next = RAMP_TONES[index + 1];
  // `hex` ja era o tom mais escuro da rampa -- nao ha para onde escurecer.
  return next === undefined ? hex : ramp[next];
}

const WHITE = '#FFFFFF';

/**
 * Resolve os papeis de accent para a superficie clara do painel.
 *
 * `surface` e o fundo sobre o qual o texto de acao aparece -- branco no card
 * do painel. Fica como parametro porque o app e o totem sao dark, e o mesmo
 * resolvedor vai servir F43 e F44 sem fork.
 */
export function resolveAccent(seedHex: string, surface: string = WHITE): ResolvedAccent {
  const ramp = deriveRamp(seedHex);

  const solid = minToneWithContrast(ramp, WHITE, AA_TEXT);
  const text = minToneWithContrast(ramp, surface, AA_TEXT);
  const hover = nextDarkerTone(ramp, solid);

  return {
    ramp,
    solid,
    onSolid: WHITE,
    text,
    hover,
    subtleBg: ramp[50],
    focusRing: text,
    report: {
      solidOnWhite: ratio(solid, WHITE),
      textOnSurface: ratio(text, surface),
      hoverOnWhite: ratio(hover, WHITE),
      subtleBgOnSurface: Math.round(contrastRatio(ramp[50], surface) * 100) / 100,
    },
  };
}

/** Variaveis CSS prontas para o atributo `style` do `<html>` -- DS-PAINEL.md §12. */
export function accentCssVars(resolved: ResolvedAccent): Readonly<Record<string, string>> {
  const vars: Record<string, string> = {
    '--ah-action-solid': resolved.solid,
    '--ah-action-on-solid': resolved.onSolid,
    '--ah-action-text': resolved.text,
    '--ah-action-hover': resolved.hover,
    '--ah-action-subtle-bg': resolved.subtleBg,
    '--ah-focus-ring': resolved.focusRing,
  };

  for (const tone of RAMP_TONES) {
    vars[`--ah-accent-${tone}`] = resolved.ramp[tone];
  }

  return vars;
}
