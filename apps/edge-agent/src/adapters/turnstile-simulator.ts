import {
  type DesfechoPassagem,
  type ResultadoLiberacao,
  type TurnstileAdapter,
} from '../domain/turnstile.js';

/**
 * Simulador da catraca -- `M0-NFR-006` (CI sem hardware).
 *
 * A diferenca em relacao ao simulador facial: este CONTA acionamentos
 * fisicos. Os dois criterios mais duros da Slice 0.3 sao sobre contagem --
 * `M0-AC-003` (dez acessos, nenhuma dupla liberacao) e `M0-AC-004` (negado
 * nao aciona) -- e contagem so e verificavel se alguem contar.
 *
 * `acionamentosFisicos` e o numero de vezes que a catraca REALMENTE giraria.
 * Comando repetido com o mesmo `comandoId` nao incrementa: e o mesmo
 * comando, nao um novo.
 */
export class TurnstileSimulator implements TurnstileAdapter {
  readonly nome = 'simulador-catraca';

  /** Quantas vezes a catraca fisicamente teria sido acionada. */
  private acionamentos = 0;

  /** Comandos ja executados, por id -- a idempotencia (`M0-FR-006`). */
  private readonly executados = new Map<string, ResultadoLiberacao>();

  private proximoDesfecho: DesfechoPassagem = 'girou';
  private duracaoSimuladaMs = 120;

  /** Quantas vezes a catraca girou de fato. O que o aceite conta. */
  get acionamentosFisicos(): number {
    return this.acionamentos;
  }

  /** Programa o desfecho da proxima liberacao -- para testar timeout. */
  programarDesfecho(desfecho: DesfechoPassagem, duracaoMs = 120): void {
    this.proximoDesfecho = desfecho;
    this.duracaoSimuladaMs = duracaoMs;
  }

  liberar(comandoId: string, timeoutMs: number): Promise<ResultadoLiberacao> {
    // IDEMPOTENCIA: mesmo comandoId devolve o mesmo resultado e NAO aciona
    // de novo. E o que impede a dupla liberacao quando a rede repete ou o
    // processo reinicia no meio.
    const jaExecutado = this.executados.get(comandoId);
    if (jaExecutado) {
      return Promise.resolve(jaExecutado);
    }

    this.acionamentos += 1;

    const estourou = this.duracaoSimuladaMs > timeoutMs;
    const resultado: ResultadoLiberacao = {
      desfecho: estourou ? 'timeout' : this.proximoDesfecho,
      duracaoMs: estourou ? timeoutMs : this.duracaoSimuladaMs,
    };

    this.executados.set(comandoId, resultado);
    return Promise.resolve(resultado);
  }

  encerrar(): Promise<void> {
    return Promise.resolve();
  }
}
