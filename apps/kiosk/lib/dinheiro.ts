/**
 * Centavos INTEIROS para texto em moeda -- `M2-BR-001`, INV-065.
 *
 * Copia deliberada do `formatarDinheiro` de `@arenahub/ui`, com o MESMO
 * comportamento (inclusive a recusa de float). Importar do pacote arrastava,
 * pelo barril `index.ts`, o CSS de TODOS os componentes do painel para o
 * bundle do totem -- 21 KB de tema CLARO, com bordas de 1 px e alvos de
 * 24 px, tudo o que o DS-TOTEM.md proibe -- por causa de dez linhas de
 * `Intl.NumberFormat`.
 *
 * `Intl.NumberFormat` e permitido: a regra 5 do lint restringe
 * `Intl.DateTimeFormat` (fuso pertence ao `TenantDateTime`), nao numero.
 *
 * Se um terceiro consumidor precisar disto, a saida certa e um subcaminho de
 * export em `@arenahub/ui` (`./dinheiro`), nao uma terceira copia.
 */
export function formatarDinheiro(cents: number, currency = 'BRL'): string {
  if (!Number.isInteger(cents)) {
    throw new Error(
      `formatarDinheiro recebeu ${String(cents)}, que nao e inteiro. ` +
        'Valor monetario e centavo inteiro (M2-BR-001).',
    );
  }

  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}
