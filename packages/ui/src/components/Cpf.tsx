import { Ausente } from './Ausente.js';

/**
 * CPF completo -- ADR-034.
 *
 * O painel recebe o documento inteiro, ja formatado pela API. A recepcao
 * confere no balcao e usa o numero para casar registro com o CSV da catraca.
 */
export function Cpf({ value }: { readonly value: string | null }) {
  if (!value) return <Ausente />;

  return <span data-numeric>{value}</span>;
}
