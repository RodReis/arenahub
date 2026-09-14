/**
 * Nome de pessoa como a tela o mostra: "ANA FLAVIA DA SILVA" -> "Ana Flavia da Silva".
 *
 * O cadastro chega em CAIXA ALTA (importacao do sistema anterior), e o
 * prototipo do App Mobile v2 escreve "Rodrigo", nao "RODRIGO" -- a revisao
 * final apontou o grito em tres telas. E so formatacao: nenhuma letra muda,
 * so a caixa, e as particulas do portugues ficam minusculas.
 */
const PARTICULAS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

export function nomeParaExibir(nome: string): string {
  return nome
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((parte, indice) => {
      const minuscula = parte.toLocaleLowerCase('pt-BR');
      if (indice > 0 && PARTICULAS.has(minuscula)) return minuscula;
      return minuscula.charAt(0).toLocaleUpperCase('pt-BR') + minuscula.slice(1);
    })
    .join(' ');
}
