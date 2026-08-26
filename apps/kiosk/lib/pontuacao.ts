/**
 * Leitura da pontuacao do aparelho para o anel do §3.12.
 *
 * PROBLEMA QUE ESTA FUNCAO EXISTE PARA NAO ESCONDER: o §3.12 pede um arco
 * "proporcional", e o DS-TOTEM.md desenha "80 PONTOS" sem dizer 80 de quanto.
 * O valor chega do aparelho como TEXTO livre (`saude.tsx` le `score` /
 * `bodyScore`), e nada no contrato garante que seja numero nem qual a escala.
 *
 * Chutar um maximo seria inventar interpretacao sobre dado de saude -- a regra
 * de arquitetura 8 proibe exatamente isso. Entao: escala explicita, e quando o
 * texto do aparelho nao for um numero dentro dela, NAO HA ANEL. A tela cai no
 * numero em texto, que e o que ja existia. Degradar e correto; adivinhar nao.
 *
 * 100 e a escala assumida por ser a unica que o proprio DS insinua ("80" lido
 * como nota). Fica num const nomeado, e nao espalhado no calculo, para que
 * trocar de escala seja uma linha quando o PI definir a de verdade.
 */
export const ESCALA_DA_PONTUACAO = 100;

/** Perimetro do circulo de raio 58 -- o "364" citado no §3.12. */
export const PERIMETRO = 364;

/**
 * `null` = sem anel. Numero fora da escala satura nas pontas em vez de
 * devolver arco negativo ou volta completa: um aparelho que reporte 120 numa
 * escala de 100 desenha o anel cheio, e nao um arco de 20.
 */
/**
 * So aceita DECIMAL SIMPLES. `Number()` sozinho nao serve: ele entende
 * notacao de literal de JavaScript, e o campo aqui e texto que um APARELHO
 * reportou -- nao codigo. Sem esta regex, `"0x10"` virava 16 (anel de 16%) e
 * `"0b11"` virava 3, em vez de recusarem o anel. Notacao cientifica (`"1e3"`)
 * cai fora pelo mesmo motivo: 1000 saturava o anel no cheio silenciosamente.
 */
const DECIMAL_SIMPLES = /^\d+(?:\.\d+)?$/;

export function fracaoDaPontuacao(bruto: string): number | null {
  const limpo = bruto.trim().replace(',', '.');

  if (!DECIMAL_SIMPLES.test(limpo)) return null;

  const valor = Number(limpo);

  if (!Number.isFinite(valor)) return null;

  return Math.min(valor / ESCALA_DA_PONTUACAO, 1);
}

/** `stroke-dasharray` do arco: quanto pintar, quanto deixar vazio. */
export function tracadoDoArco(fracao: number): string {
  const pintado = PERIMETRO * fracao;

  return `${pintado.toFixed(2)} ${(PERIMETRO - pintado).toFixed(2)}`;
}
