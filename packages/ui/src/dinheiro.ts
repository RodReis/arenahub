/**
 * Dinheiro em TEXTO, para onde componente React nao cabe.
 *
 * O `Money` resolve a exibicao em JSX e continua sendo o caminho padrao. Este
 * helper existe para o punhado de lugares que precisam de STRING: rotulo de
 * grafico (o Recharts desenha `<text>` no SVG, nao aceita elemento React) e
 * descricao de acessibilidade.
 *
 * POR QUE ELE NASCEU: a tela do painel financeiro formatava com
 * `(minor / 100).toFixed(2).replace('.', ',')`, que produzia `R$ 12000,00`
 * -- sem separador de milhar. Num grafico de dividas, ler doze mil como
 * "12000" e exatamente o tipo de numero que se confunde com 1.200 de relance.
 *
 * `Intl.NumberFormat` e permitido: a regra 5 do lint restringe
 * `Intl.DateTimeFormat` (fuso pertence ao `TenantDateTime`), nao a formatacao
 * de numero.
 */

/**
 * Centavos INTEIROS para texto em moeda -- `M2-BR-001`, INV-065.
 *
 * RECUSA float, mesma decisao do `Money`: se um fracionario chegou aqui,
 * alguem ja errou antes, e arredondar esconderia o bug de origem.
 */
export function formatarDinheiro(cents: number, currency = 'BRL'): string {
  if (!Number.isInteger(cents)) {
    throw new Error(
      `formatarDinheiro recebeu ${String(cents)}, que nao e inteiro. Valor monetario e centavo inteiro (M2-BR-001).`,
    );
  }

  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

/**
 * Percentual de uma parte sobre um total, com uma casa.
 *
 * `null` QUANDO O TOTAL E ZERO -- nao zero por cento. Uma fatia de nada nao e
 * 0% do total: e uma proporcao que nao existe, e mostrar "0%" afirmaria que a
 * parte e desprezivel quando nao ha do que ser parte. Mesma regra que o
 * `ticketMedio` e a `taxaDeInadimplencia` seguem no dominio.
 *
 * Uma casa decimal pelo mesmo motivo da taxa de inadimplencia: duas dariam
 * precisao que a base nao sustenta, zero esconderia movimento real.
 */
export function percentualDoTotal(parte: number, total: number): number | null {
  if (total === 0) return null;

  return Math.round((parte / total) * 1000) / 10;
}
