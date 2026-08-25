/**
 * Mascara do campo de CPF -- DS-TOTEM.md §3.19.
 *
 * PURA: entra a string de digitos, sai o texto da tela. Sem estado, sem DOM
 * -- e o que a torna testavel sem montar o teclado inteiro.
 *
 * As posicoes vazias aparecem como `_` de proposito: a 80 cm, um campo que
 * cresce da esquerda nao diz quantos digitos faltam. `000.000.000-00` com
 * sublinhado diz.
 */
export const DIGITOS_DO_CPF = 11;

const MOLDE = '___.___.___-__';

export function mascararCpf(digitos: string): string {
  let indice = 0;

  return [...MOLDE]
    .map((caractere) => {
      if (caractere !== '_') return caractere;

      const digito = digitos[indice];
      indice += 1;

      return digito ?? '_';
    })
    .join('');
}

/** So digitos, no maximo 11 -- o que a API aceita (`/^\d{11}$/`). */
export function apenasDigitos(entrada: string): string {
  return entrada.replace(/\D/g, '').slice(0, DIGITOS_DO_CPF);
}

export function cpfEstaCompleto(digitos: string): boolean {
  return digitos.length === DIGITOS_DO_CPF;
}
