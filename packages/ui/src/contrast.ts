/**
 * Contraste WCAG 2.x -- a matematica que sustenta a regra de lint 4.
 *
 * Nao usa biblioteca de proposito: sao vinte linhas de formula fechada, e o
 * teste de token que FALHA O BUILD (DS-PAINEL.md §10) nao pode depender de
 * atualizacao de dependencia para continuar dizendo a verdade.
 *
 * Fonte: WCAG 2.2, "relative luminance" e "contrast ratio".
 */

/** Alvo AA para texto normal. */
export const AA_TEXT = 4.5;

/** Alvo AA para texto grande (>=18.66px bold ou >=24px) e componentes. */
export const AA_LARGE = 3;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * `#RGB` ou `#RRGGBB` -> canais 0..255.
 *
 * Lanca em entrada invalida em vez de devolver preto: um hex digitado errado
 * que virasse `#000000` passaria no teste de contraste com folga e esconderia
 * o erro exatamente no arquivo que existe para pega-lo.
 */
export function parseHex(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, '');

  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Hex invalido: ${JSON.stringify(hex)}`);
  }

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Luminancia relativa WCAG. Canal linearizado, depois soma ponderada. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);

  const channel = (raw: number): number => {
    const s = raw / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Razao de contraste entre duas cores solidas, de 1 a 21.
 *
 * Simetrica: a ordem dos argumentos nao importa.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Arredonda para 2 casas -- o formato em que os documentos publicam. */
export function ratio(a: string, b: string): number {
  return Math.round(contrastRatio(a, b) * 100) / 100;
}

/** Passa no alvo? Compara com margem de 0.005 para nao reprovar por float. */
export function meets(a: string, b: string, target: number = AA_TEXT): boolean {
  return contrastRatio(a, b) >= target - 0.005;
}
