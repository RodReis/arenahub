/**
 * Calculo de sessao do totem.
 *
 * PURO: sem banco, sem rede, sem relogio -- o "agora" entra por parametro
 * (convencao do projeto). Isso e o que torna o teto de 99 s testavel sem
 * esperar 99 segundos.
 */

export function calcularExpiracao(inicio: Date, duracaoSegundos: number): Date {
  return new Date(inicio.getTime() + duracaoSegundos * 1000);
}

/**
 * Soma o incremento ao que RESTA, limitado pelo teto contado a partir de
 * agora (`DS-TOTEM.md` 6: "soma 30 s, teto de 99").
 *
 * Sessao ja vencida nao volta para o passado: o piso e `agora`.
 */
export function estender(
  expiraEm: Date,
  agora: Date,
  incrementoSegundos: number,
  tetoSegundos: number,
): Date {
  const restanteMs = Math.max(0, expiraEm.getTime() - agora.getTime());
  const desejadoMs = restanteMs + incrementoSegundos * 1000;
  const tetoMs = tetoSegundos * 1000;

  return new Date(agora.getTime() + Math.min(desejadoMs, tetoMs));
}
