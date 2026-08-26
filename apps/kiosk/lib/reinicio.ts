export type DecisaoDeReinicio = 'nada' | 'reiniciar' | 'aguardar';

export interface EntradaDeReinicio {
  /** Versao carregada no boot. `null` enquanto o primeiro heartbeat nao voltou. */
  readonly versaoDoBoot: number | null;
  readonly versaoAtual: number;
  readonly emSessao: boolean;
}

/**
 * ADR-042, Decisao 3: publicar cria versao nova e REINICIA a superficie --
 * nunca aplica em runtime. E o que mantem verdadeira a regra do `DS-TOTEM`
 * de accent resolvido no boot.
 *
 * PURA: sem `window`, sem relogio, sem rede.
 *
 * Compara por DESIGUALDADE, nao por "maior que": despublicar uma camada faz
 * o numero recuar, e isso tambem e mudanca real na configuracao efetiva.
 */
export function decidirReinicio(entrada: EntradaDeReinicio): DecisaoDeReinicio {
  // Sem versao de boot ainda, nao ha o que comparar. Reiniciar aqui daria
  // laco de reinicio no primeiro heartbeat de toda inicializacao.
  if (entrada.versaoDoBoot === null) return 'nada';

  if (entrada.versaoDoBoot === entrada.versaoAtual) return 'nada';

  return entrada.emSessao ? 'aguardar' : 'reiniciar';
}
