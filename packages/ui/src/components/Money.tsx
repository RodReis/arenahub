import { Ausente } from './Ausente.js';

interface Props {
  readonly cents: number | null;
  readonly currency?: string;
}

/**
 * Dinheiro e INTEIRO na menor unidade monetaria -- `M2-BR-001`.
 *
 * A divisao por 100 acontece SO na formatacao, no ultimo instante antes do
 * olho humano. Aritmetica de moeda em `number` fora deste componente e erro de
 * lint (regra 6): `0.1 + 0.2` da `0.30000000000000004` em float, e conciliacao
 * com provedor de pagamento nao perdoa centavo.
 *
 * O MVP 1 nao tem dinheiro -- `Plan` nao carrega valor. Este componente entra
 * como contrato para a fatia do MVP 2 consumir.
 */
export function Money({ cents, currency = 'BRL' }: Props) {
  if (cents === null || cents === undefined) return <Ausente />;

  /**
   * Recusa em vez de arredondar.
   *
   * Se um float chegou ate aqui, alguem ja errou antes. Arredondar esconderia
   * o bug de origem e produziria diferenca de centavo na conciliacao -- falhar
   * alto na primeira renderizacao e mais barato que procurar depois.
   */
  if (!Number.isInteger(cents)) {
    throw new Error(
      `Money recebeu ${cents}, que nao e inteiro. Valor monetario e centavo inteiro (M2-BR-001).`,
    );
  }

  const texto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

  return <output data-numeric>{texto}</output>;
}
