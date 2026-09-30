/**
 * A pessoa esta na frente do leitor AGORA? -- #476.
 *
 * Ao reconectar, o leitor manda num `sendlog` as passagens que guardou
 * enquanto o ArenaHub estava fora (visto na Arena Positiva, 30/09/2026).
 * Ninguem esta na frente da catraca por causa delas: acionar a catraca para
 * um registro de horas atras e girar para o vazio. So o registro ao vivo pode
 * comandar a catraca.
 *
 * Funcao pura: o "agora" entra por parametro (CLAUDE.md -> Convencoes).
 */

/**
 * Tolerancia entre o horario do equipamento e o recebimento. O `sendlog` ao
 * vivo chega em menos de um segundo; a folga cobre relogio levemente
 * atrasado sem deixar um backlog de minutos passar por ao vivo.
 */
export const JANELA_AO_VIVO_MS = 30_000;

export function ehPassagemAoVivo(ocorridoEm: Date, recebidoEm: Date): boolean {
  const ocorrido = ocorridoEm.getTime();

  // Horario ilegivel: nao da para saber se e ao vivo, e duvida nao gira
  // catraca -- a mesma regra de "falha nunca vira ALLOW".
  if (Number.isNaN(ocorrido)) return false;

  // So o PASSADO alem da janela e backlog. Relogio do leitor adiantado com
  // evento chegando agora continua ao vivo: quem esta na frente passa.
  return recebidoEm.getTime() - ocorrido <= JANELA_AO_VIVO_MS;
}
