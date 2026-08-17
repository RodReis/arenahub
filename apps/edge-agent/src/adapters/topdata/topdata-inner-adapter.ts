import { type Logger } from 'pino';

import {
  type ResultadoLiberacao,
  type SentidoGiro,
  type TurnstileAdapter,
} from '../../domain/turnstile.js';
import { ORIGEM, type PonteEasyInner } from './easyinner-ponte.js';

/**
 * Adapter da catraca Topdata, sobre a ponte com a EasyInner.dll.
 *
 * Fonte: `docs/vendor/topdata/PROTOCOLO-CATRACA.md`. Nenhuma chamada
 * inventada.
 *
 * O FLUXO QUE O MANUAL PRESCREVE, e que este adapter implementa:
 *
 *   1. `LiberarCatraca...` devolve 0 -- o comando FOI ACEITO;
 *   2. o giro NAO vem por callback. Vem por polling de
 *      `ReceberDadosOnLine`, esperando `Origem 6` (girou) ou `Origem 5`
 *      (tempo acabou, ninguem passou).
 *
 * "Comando aceito" e "pessoa passou" sao coisas diferentes, e o manual
 * separa as duas. O `M0-AC-005` mede a segunda.
 */

/** Prazo padrao entre liberar e desistir de esperar o giro. */
const TIMEOUT_GIRO_MS = 10_000;

/** Quanto cada leitura de evento espera antes de devolver "sem evento". */
const JANELA_POLLING_MS = 500;

export class TopdataInnerAdapter implements TurnstileAdapter {
  readonly nome = 'topdata-inner';

  /**
   * Comandos ja executados, por `comandoId`.
   *
   * ⚠️ O EQUIPAMENTO NAO TEM IDEMPOTENCIA. A assinatura da DLL e
   * `LiberarCatracaEntrada(int Inner)` -- sem id, sem nada. Chamar duas
   * vezes gira duas vezes.
   *
   * Entao a garantia do `M0-AC-003` mora AQUI. Este Map e a unica coisa
   * entre um retry e uma segunda passagem indevida.
   */
  private readonly executados = new Map<string, ResultadoLiberacao>();

  constructor(
    private readonly ponte: PonteEasyInner,
    private readonly logger: Logger,
    /** Numero do Inner, 1 a 99. A bancada usa 1. */
    private readonly inner: number,
    /**
     * Se a instalacao fisica exige as funcoes invertidas.
     *
     * O manual: "algumas instalacoes podem exigir que o sentido de liberacao
     * seja invertido... consulte os exemplos SDK para determinar a
     * necessidade de uso baseado na orientacao fisica da catraca".
     *
     * Na bancada a catraca fica a esquerda ao entrar (F1). Qual das duas
     * variantes serve se descobre TESTANDO, e por isso e configuracao, nao
     * constante.
     */
    private readonly invertido = false,
  ) {}

  /**
   * Abre a porta e roda a inicializacao ONLINE completa da catraca.
   *
   * ⚠️ CHAME ANTES do primeiro `liberar`. Sem isto o giro e recusado com
   * `retorno 1` -- a init parcial de `testarConexao` nao roda o
   * `ConfigurarAcionamento1`, que e o que habilita o rele como catraca.
   * Achado de campo 17/08/2026; ver o comando `conectar` da ponte.
   *
   * A catraca e cliente: apos este comando ela ainda leva alguns segundos
   * para discar de volta. Confirme com `testarConexao()` antes de liberar.
   */
  async conectar(porta: number, tempo = 10): Promise<boolean> {
    const r = await this.ponte.executar({ cmd: 'conectar', porta, tempo });
    return r.tipo === 'retorno' && r.retorno === 0;
  }

  /** A catraca responde? `TestarConexaoInner`. */
  async testarConexao(): Promise<boolean> {
    const r = await this.ponte.executar({ cmd: 'testar-conexao', inner: this.inner });
    return r.tipo === 'retorno' && r.retorno === 0;
  }

  /** Keep-alive. Sem ele a catraca cai para offline e decide sozinha. */
  async ping(): Promise<boolean> {
    const r = await this.ponte.executar({ cmd: 'ping', inner: this.inner });
    return r.tipo === 'retorno' && r.retorno === 0;
  }

  async liberar(
    comandoId: string,
    timeoutMs: number = TIMEOUT_GIRO_MS,
    sentido: SentidoGiro = 'entrada',
  ): Promise<ResultadoLiberacao> {
    // IDEMPOTENCIA -- e ela e so nossa. Ver o comentario do Map.
    const jaFeito = this.executados.get(comandoId);
    if (jaFeito) {
      this.logger.info({ comandoId }, 'comando ja executado, nao aciona de novo');
      return jaFeito;
    }

    const inicio = Date.now();

    const comando = await this.ponte.executar({
      cmd: 'liberar',
      inner: this.inner,
      sentido,
      invertido: this.invertido,
    });

    if (comando.tipo !== 'retorno' || comando.retorno !== 0) {
      // Nao registra em `executados`: o comando NAO chegou na catraca, entao
      // retentar e legitimo. Marcar aqui bloquearia a nova tentativa e
      // deixaria a pessoa presa do lado de fora.
      const razao = descreverFalha(comando);
      this.logger.error({ comandoId, razao }, 'liberacao recusada pelo equipamento');
      return { desfecho: 'desconhecido', duracaoMs: Date.now() - inicio };
    }

    // O comando foi aceito. Registra ANTES de esperar o giro: daqui em
    // diante a catraca ja esta destravada, e um retry acionaria de novo.
    // O desfecho ainda nao se sabe.
    const provisorio: ResultadoLiberacao = { desfecho: 'desconhecido', duracaoMs: 0 };
    this.executados.set(comandoId, provisorio);

    const resultado = await this.esperarDesfecho(inicio, timeoutMs);
    this.executados.set(comandoId, resultado);

    return resultado;
  }

  /**
   * Espera Origem 6 (girou) ou Origem 5 (tempo acabou), por polling.
   *
   * O manual: "Se um evento Origem 5 for recebido antes da Origem 6,
   * significa que o tempo de liberacao expirou e o giro nao ocorreu".
   *
   * ⚠️ QUEM MANDA NO PRAZO E O EQUIPAMENTO. O tempo que a catraca fica
   * destravada vem de `ConfigurarAcionamento1/2` (0 a 50 s) -- "o tempo de
   * giro nao e uma configuracao separada". O nosso `timeoutMs` e so o teto
   * do NOSSO polling, e precisa ser MAIOR que o do equipamento; senao a
   * gente desiste antes de ele mandar a Origem 5.
   */
  private async esperarDesfecho(
    inicioMs: number,
    timeoutMs: number,
  ): Promise<ResultadoLiberacao> {
    const limite = inicioMs + timeoutMs;

    while (Date.now() < limite) {
      const r = await this.ponte.executar({
        cmd: 'receber-evento',
        inner: this.inner,
        timeoutMs: JANELA_POLLING_MS,
      });

      if (r.tipo === 'evento') {
        if (r.evento.origem === ORIGEM.GIRO_CONFIRMADO) {
          return { desfecho: 'girou', duracaoMs: Date.now() - inicioMs };
        }

        if (r.evento.origem === ORIGEM.FIM_TEMPO_ACIONAMENTO) {
          return { desfecho: 'timeout', duracaoMs: Date.now() - inicioMs };
        }

        // Outro evento no meio -- alguem passou o cartao enquanto o giro
        // anterior era esperado. Nao e o desfecho desta liberacao; ignora e
        // continua esperando.
        this.logger.debug({ origem: r.evento.origem }, 'evento fora do desfecho esperado');
        continue;
      }

      if (r.tipo === 'falha-da-ponte') {
        this.logger.error({ mensagem: r.mensagem }, 'ponte falhou ao aguardar giro');
        return { desfecho: 'desconhecido', duracaoMs: Date.now() - inicioMs };
      }

      // `sem-evento` ou retorno da DLL: a janela de polling fechou vazia.
      // Manda ping para a catraca nao cair para offline enquanto esperamos.
      if (r.tipo === 'sem-evento') {
        await this.ponte.executar({ cmd: 'ping', inner: this.inner });
      }
    }

    // Nosso prazo acabou sem Origem 5 nem 6.
    //
    // `desconhecido`, nao `timeout`: `timeout` significa "o equipamento
    // avisou que ninguem passou". Aqui a gente simplesmente nao sabe -- e
    // registrar como se soubesse seria inventar desfecho.
    this.logger.warn('nem giro nem fim de tempo dentro do prazo do agente');
    return { desfecho: 'desconhecido', duracaoMs: Date.now() - inicioMs };
  }

  /**
   * Le um evento avulso -- leitura de cartao, teclado, QR Code.
   *
   * E o caminho de entrada do `M0-FR-005`: a catraca em modo online manda o
   * que leu, e QUEM DECIDE somos nos.
   */
  async lerEvento(timeoutMs = JANELA_POLLING_MS): Promise<
    | { tipo: 'evento'; origem: number; cartao: string | undefined; ocorridoEm: string | undefined }
    | { tipo: 'vazio' }
  > {
    const r = await this.ponte.executar({
      cmd: 'receber-evento',
      inner: this.inner,
      timeoutMs,
    });

    if (r.tipo !== 'evento') return { tipo: 'vazio' };

    return {
      tipo: 'evento',
      origem: r.evento.origem,
      cartao: r.evento.cartao,
      ocorridoEm: r.evento.ocorridoEm,
    };
  }

  async encerrar(): Promise<void> {
    this.executados.clear();
    await this.ponte.encerrar();
  }
}

function descreverFalha(r: { tipo: string; retorno?: number; mensagem?: string }): string {
  if (r.tipo === 'falha-da-ponte') return r.mensagem ?? 'ponte falhou';
  if (typeof r.retorno === 'number') {
    // 8 = GPF, e quase sempre ambiente e nao codigo. Dizer isso poupa horas
    // de quem esta na bancada procurando bug no lugar errado.
    if (r.retorno === 8) {
      return 'retorno 8 (GPF): DLL nao registrada, .NET 3.5 ausente, ou processo 64 bits';
    }
    return `retorno ${r.retorno} da DLL`;
  }
  return 'resposta inesperada da ponte';
}
