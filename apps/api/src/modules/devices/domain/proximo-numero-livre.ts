/**
 * Proximo numero livre para cadastro no leitor -- #475.
 *
 * O numero do equipamento (CATRACA/`enrollid`) NAO E SEQUENCIAL (decisao do
 * PI, issue #475): `MAX + 1` colide com numero baixo ja usado por outro
 * cadastro. A funcao certa e achar o primeiro buraco a partir do piso.
 *
 * PISO DE 10.000 (decisao do PI, 08/10/2026 -- antes era 100.000.000.000, e o
 * numero de 12 digitos na tela da recepcao era grande demais). Abaixo dele
 * ficam os numeros que o software de fabrica costuma usar (1, 2, 3...), que
 * esta funcao nunca gera. Acima, o que ja existe de curto (importado, cartao,
 * cadastro no leitor) CONTA como ocupado: por isso o chamador passa a uniao
 * das tres fontes (`TurnstileNumberService.proximoLivre`).
 *
 * Teto igual ao do equipamento: ate 12 digitos, e cartao/facial dividem o
 * mesmo espaco de numero no leitor (a coluna CATRACA mostra os dois juntos).
 */
export const NUMERO_MINIMO = 10_000;
export const NUMERO_MAXIMO = 999_999_999_999;

/**
 * Pura: recebe o conjunto de numeros ja ocupados (de qualquer origem --
 * leitor, credencial, DeviceUser) e devolve o primeiro livre a partir do
 * piso.
 *
 * So considera string numerica dentro da faixa -- um numero fora dela (uma
 * credencial antiga, de outro formato) nao participa da comparacao: nao
 * colide com nada que este calculo possa gerar.
 */
export function proximoNumeroLivre(ocupados: ReadonlySet<string>): string {
  const numeros = new Set<number>();

  for (const valor of ocupados) {
    if (!/^\d+$/.test(valor)) continue;
    const numero = Number(valor);
    if (Number.isSafeInteger(numero) && numero >= NUMERO_MINIMO && numero <= NUMERO_MAXIMO) {
      numeros.add(numero);
    }
  }

  for (let candidato = NUMERO_MINIMO; candidato <= NUMERO_MAXIMO; candidato += 1) {
    if (!numeros.has(candidato)) return String(candidato);
  }

  // Faixa inteira ocupada (quase 10^12 numeros) -- nunca deve acontecer na
  // pratica, mas falhar alto aqui e melhor que devolver numero fora da
  // faixa que o equipamento recusaria.
  throw new Error('nenhum numero livre na faixa do equipamento');
}
