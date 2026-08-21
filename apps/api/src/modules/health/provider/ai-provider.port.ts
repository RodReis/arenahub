import type { SnapshotDeAnalise } from '../domain/snapshot-de-analise.js';

export type CodigoDeErroDaIa =
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_INVALID_REQUEST'
  /** Teto de gasto do tenant estourado (`M3-NFR-005`). */
  | 'AI_BUDGET_EXCEEDED';

/**
 * Erro do provedor ja classificado.
 *
 * `recuperavel` decide se a analise pode ser repetida: indisponibilidade se
 * repete, teto de gasto estourado nao -- repetir so gastaria de novo o que a
 * academia decidiu nao gastar.
 */
export class ErroDaIa extends Error {
  constructor(
    readonly codigo: CodigoDeErroDaIa,
    readonly recuperavel: boolean,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDaIa';
  }
}

/** O que o provedor devolve, junto do custo que o `M3-FR-016` exige. */
export interface RespostaDaIa {
  /**
   * A saida BRUTA, sem validar. `unknown` de proposito (`CLAUDE.md`): ela vem
   * de um terceiro, e confiar no formato dela e o mesmo erro de confiar em
   * corpo de requisicao. Quem valida e `validarSaida`, na fronteira.
   */
  readonly bruta: unknown;
  readonly model: string;
  /** Milesimos de centavo de dolar, inteiro -- regra de arquitetura no 6. */
  readonly costMicros: number;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface PedidoDeAnalise {
  /** Ja pseudonimizado e conferido -- ver `conferirPseudonimizacao`. */
  readonly snapshot: SnapshotDeAnalise;
  /** Texto exato do prompt, para reprodutibilidade (`M3-FR-016`). */
  readonly prompt: string;
  readonly promptName: string;
}

export interface AiProvider {
  analisar(pedido: PedidoDeAnalise): Promise<RespostaDaIa>;
}

/** Token de injecao -- o modulo decide qual adapter responde. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');
