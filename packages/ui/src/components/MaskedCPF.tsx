import { Ausente } from './Ausente.js';

/** CPF mascarado sempre traz `•`; o completo, so digitos e pontuacao. */
const TEM_MASCARA = /•/;

/**
 * CPF mascarado -- DS-PAINEL.md §9.
 *
 * O painel NUNCA recebe documento inteiro: a API devolve `cpfMasked`, e o CPF
 * completo so existe como hash. Este componente nao mascara nada -- ele
 * RECUSA o que ja deveria ter chegado mascarado.
 */
export function MaskedCPF({ masked }: { readonly masked: string | null }) {
  if (!masked) return <Ausente />;

  /**
   * Guarda contra regressao de API, nao contra o proprio componente.
   *
   * Se um dia a rota devolver o CPF cru, o erro aparece no primeiro render em
   * vez de o documento chegar calado na tela -- e nos logs de erro do
   * navegador, que e onde PII nunca pode estar.
   */
  if (!TEM_MASCARA.test(masked)) {
    throw new Error('MaskedCPF exige CPF mascarado pela API, nunca o documento completo.');
  }

  return <span data-numeric>{masked}</span>;
}
