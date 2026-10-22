/**
 * Nome de pessoa em caixa de nome próprio — issue #671.
 *
 * O nome chegava como foi digitado ou importado ("ANDRE LUIZ VICENTE
 * MENEZES", "BRUNA Aires de sousa") e cada tela mostrava a caixa crua. É
 * DADO, não rótulo: corrigir na tela exigiria lembrar em cada lugar que exibe
 * nome. Corrigido na gravação, todo lugar mostra certo de graça.
 *
 * Regra (decisão do PI, 22/10/2026): inicial maiúscula em cada palavra;
 * partícula (de, da, do, das, dos, e) em minúscula, exceto no início. Hífen e
 * apóstrofo também abrem inicial ("Ana-Clara", "D'Ávila"). Algarismo romano
 * de sufixo fica em maiúscula ("Pedro Souza II"). Palavra com dígito fica como veio.
 *
 * Mora em `@arenahub/database` porque a API e os importadores gravam nome, e
 * os dois já dependem deste pacote.
 */

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

const ROMANO = /^(ii|iii|iv|vi|vii|viii|ix)$/;

function palavraPropria(palavra: string, indice: number): string {
  // Palavra com dígito não é nome de gente ("A11y", "E2E", código de turma): fica como veio.
  if (/\d/.test(palavra)) return palavra;

  const minuscula = palavra.toLocaleLowerCase('pt-BR');

  if (indice > 0 && PARTICULAS.has(minuscula)) return minuscula;
  if (indice > 0 && ROMANO.test(minuscula)) return minuscula.toLocaleUpperCase('pt-BR');

  // Inicial no começo da palavra e depois de hífen ou apóstrofo.
  return minuscula.replace(/(^|[-'’])(\p{L})/gu, (_, separador: string, letra: string) =>
    separador + letra.toLocaleUpperCase('pt-BR'),
  );
}

export function nomeProprio(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .filter((palavra) => palavra !== '')
    .map(palavraPropria)
    .join(' ');
}
