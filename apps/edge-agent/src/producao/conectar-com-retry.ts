/**
 * Retry limitado no arranque -- insumo F59 SS5.1/5.2.
 *
 * "Falha alto" é a decisão certa para invocação manual; no arranque
 * automático do serviço Windows (ADR-011), ela transformava uma condição
 * transitória (catraca lenta no boot) em parada permanente. A mesma
 * política vale para queda pós-arranque (SS5.2) -- quem chama de novo
 * após o processo já estar de pé usa esta mesma função.
 */

export class FalhaDeConexaoError extends Error {
  readonly code = 'EDGE_CONEXAO_ESGOTADA';

  constructor(
    readonly dispositivo: string,
    readonly tentativas: number,
    causa: unknown,
  ) {
    super(
      `${dispositivo}: esgotadas ${tentativas} tentativas de conexao. Ultima causa: ${
        causa instanceof Error ? causa.message : String(causa)
      }`,
    );
    this.name = 'FalhaDeConexaoError';
  }
}

export interface DepsRetry<T> {
  tentar: () => Promise<T>;
  esperar: (ms: number) => Promise<void>;
  maxTentativas: number;
  intervaloMs: number;
  /** Nome do dispositivo, só para a mensagem de erro. */
  dispositivo?: string;
}

export async function conectarComRetry<T>(deps: DepsRetry<T>): Promise<T> {
  let ultimaCausa: unknown;

  for (let tentativa = 1; tentativa <= deps.maxTentativas; tentativa += 1) {
    try {
      return await deps.tentar();
    } catch (erro: unknown) {
      ultimaCausa = erro;

      if (tentativa < deps.maxTentativas) {
        await deps.esperar(deps.intervaloMs);
      }
    }
  }

  throw new FalhaDeConexaoError(deps.dispositivo ?? 'dispositivo', deps.maxTentativas, ultimaCausa);
}
