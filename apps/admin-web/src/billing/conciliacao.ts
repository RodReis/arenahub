/**
 * Regras de apresentacao da conciliacao -- F16, Slice 2.5.
 *
 * FUNCOES PURAS, fora do componente e fora da Server Action: dentro delas so
 * seriam testaveis carregando o Next inteiro para exercitar uma conta de data.
 */

/**
 * Converte o intervalo que o operador digitou na janela FECHADA que a API
 * espera.
 *
 * O FIM E EXCLUSIVO, e o `+1 dia` e o ponto inteiro desta funcao: quem digita
 * "31/08" quer conciliar agosto INTEIRO. Passar `31/08 00:00` como fim
 * deixaria o ultimo dia de fora, e as cobrancas do dia 31 apareceriam como
 * `MISSING_EXTERNAL` na execucao seguinte -- divergencia inventada pela
 * interface, num painel que existe para achar divergencia de verdade.
 *
 * TUDO EM UTC, com `setUTCDate`: usar a data local faria o resultado depender
 * do fuso do navegador de quem clicou, e duas pessoas conciliando o mesmo mes
 * pediriam janelas diferentes.
 */
export function janelaFechada(de: string, ate: string): { de: Date; ate: Date } {
  const inicio = new Date(`${de}T00:00:00.000Z`);
  const fim = new Date(`${ate}T00:00:00.000Z`);
  fim.setUTCDate(fim.getUTCDate() + 1);

  return { de: inicio, ate: fim };
}

/**
 * Que comandos a tela oferece para cada divergencia.
 *
 * ESPELHA A API DE PROPOSITO, e a duplicacao e deliberada: oferecer na tela um
 * comando que o servidor recusa produz erro no clique, e o operador aprende a
 * tentar tudo ate algo funcionar. A garantia continua sendo do servidor -- esta
 * lista so evita oferecer o que ja se sabe que nao cabe.
 */
export const COMANDOS_DA_TELA: Readonly<Record<string, readonly string[]>> = {
  MISSING_INTERNAL: ['REPROCESS_PROVIDER_EVENT', 'ACCEPT_DOCUMENTED_DIFFERENCE'],
  MISSING_EXTERNAL: ['ACCEPT_DOCUMENTED_DIFFERENCE'],
  AMOUNT_MISMATCH: ['ACCEPT_DOCUMENTED_DIFFERENCE'],
};

export const ROTULO_DO_COMANDO: Readonly<Record<string, string>> = {
  REPROCESS_PROVIDER_EVENT: 'Reprocessar evento do provedor',
  ACCEPT_DOCUMENTED_DIFFERENCE: 'Aceitar diferença documentada',
};

/**
 * A diferenca entre os dois lados, em centavos.
 *
 * `null` quando um dos lados nao existe: em `MISSING_INTERNAL` e
 * `MISSING_EXTERNAL` nao ha o que subtrair, e mostrar o valor do unico lado
 * como "diferenca" sugeriria um erro de valor onde o problema e AUSENCIA.
 */
export function diferencaMinor(
  internoMinor: number | null,
  externoMinor: number | null,
): number | null {
  if (internoMinor === null || externoMinor === null) {
    return null;
  }

  return externoMinor - internoMinor;
}
