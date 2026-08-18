/**
 * Conversão de valor digitado para centavos inteiros.
 *
 * Função pura, sem React e sem rede — por isso mora aqui e não na Server
 * Action: regra de dinheiro precisa de teste, e teste de Server Action
 * carregaria o Next inteiro para exercitar uma conta.
 *
 * INV-065: dinheiro é INTEIRO na menor unidade monetária. A conversão
 * acontece UMA vez, no boundary; daí em diante o valor segue inteiro. Fazer a
 * conta no componente espalharia float pela árvore de renderização — que é
 * exatamente o que o `Money` recusa em runtime.
 */

/**
 * "150,00" ou "150.00" → `15000`. Entrada inválida → `null`.
 *
 * Aceita as duas formas que aparecem num balcão brasileiro. Rejeita mais de
 * duas casas: "150,005" não é dinheiro, é erro de digitação, e arredondar
 * esconderia a diferença na conciliação.
 *
 * A soma é feita em inteiros (`inteira * 100 + centavos`) em vez de
 * `Number(limpo) * 100`: o segundo passa por float e `1.15 * 100` dá
 * `114.99999999999999`.
 */
export function paraCentavos(digitado: string): number | null {
  const limpo = digitado.trim().replace(/\s/g, '').replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) {
    return null;
  }

  const [inteira = '0', decimal = ''] = limpo.split('.');

  return Number(inteira) * 100 + Number(decimal.padEnd(2, '0'));
}
