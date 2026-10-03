import { type Logger } from 'pino';

import {
  type ResultadoLiberacao,
  type SentidoGiro,
  type TurnstileAdapter,
} from '../../domain/turnstile.js';
import { ORIGEM, type ConfiguracaoAcesso, type PonteEasyInner } from './easyinner-ponte.js';

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

/**
 * Ritmo do `PingOnline` -- metade dos 10 s que o `conectar` configura na
 * mudanca automatica online/offline. Folga para um ping perdido (#470).
 */
export const INTERVALO_KEEP_ALIVE_MS = 5_000;

/** Tentativas de gravar a configuracao e espera entre elas: a catraca leva segundos para discar (#507). */
const TENTATIVAS_GRAVAR = 10;
const ESPERA_GRAVAR_MS = 2_000;

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

  /** Laco de `PingOnline` que mantem a catraca online (#470). */
  private keepAlive: NodeJS.Timeout | null = null;

  /** Resultado do ultimo ping do keep-alive -- vai no heartbeat (#522). */
  private ultimoPingOk = false;

  private gravando = false;

  get respondendo(): boolean {
    return this.ultimoPingOk;
  }

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
    /**
     * Modo de acesso a gravar NA catraca (#507). Sem ele o agente nao grava
     * nada -- a catraca fica com o que ja tem.
     */
    private readonly configuracao?: ConfiguracaoAcesso,
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
  async conectar(porta: number, tempo = 10, tempoLiberadaS = 5): Promise<boolean> {
    const r = await this.ponte.executar({
      cmd: 'conectar',
      porta,
      tempo,
      tempoLiberadaS,
      configuracao: this.configuracao,
    });
    return r.tipo === 'retorno' && r.retorno === 0;
  }

  /**
   * Grava o modo de acesso na catraca (`EnviarConfiguracoes`) -- #507.
   * Espera a catraca discar (primeiro ping com retorno 0) e tenta de novo
   * se ela ainda nao aceitou. Sem `configuracao`, nao faz nada.
   *
   * ⚠️ Grava o bloco inteiro de configuracao do equipamento, nao so os tres
   * campos. Confira o plano B (modo offline) depois de ligar isto numa
   * instalacao nova.
   */
  async gravarConfiguracao(
    tentativas = TENTATIVAS_GRAVAR,
    esperaMs = ESPERA_GRAVAR_MS,
  ): Promise<boolean> {
    if (!this.configuracao || this.gravando) return false;
    this.gravando = true;
    try {
      for (let i = 1; i <= tentativas; i += 1) {
        if (await this.ping()) {
          const r = await this.ponte.executar({ cmd: 'gravar-configuracao', inner: this.inner });
          if (r.tipo === 'retorno' && r.retorno === 0) {
            this.logger.info({ ...this.configuracao }, 'configuracao de acesso gravada na catraca');
            return true;
          }
        }
        if (i < tentativas) await new Promise((resolve) => setTimeout(resolve, esperaMs));
      }
      this.logger.warn({ tentativas }, 'catraca nao aceitou a configuracao de acesso');
      return false;
    } finally {
      this.gravando = false;
    }
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

  /**
   * Mantem a catraca ONLINE, obedecendo o ArenaHub -- #470.
   *
   * O manual: `PingOnline` "regularmente, em um intervalo MENOR que o Tempo
   * configurado na mudanca automatica". O `conectar` configura 10 s, entao o
   * ping sai a cada 5 s por padrao. Sem isto, a catraca caia para offline e
   * liberava pela lista propria enquanto o ArenaHub negava (visto em campo,
   * 30/09/2026).
   *
   * O AVESSO E O PLANO B: `encerrar` para o ping, e a catraca volta sozinha
   * ao modo offline no `tempo` -- agente fora do ar nao tranca a recepcao.
   *
   * A ponte responde em ordem (FIFO), entao o ping no meio do polling de um
   * giro nao troca a resposta de ninguem.
   */
  manterOnline(intervaloMs = INTERVALO_KEEP_ALIVE_MS): void {
    if (this.keepAlive) return;

    let respondendo = true;

    this.keepAlive = setInterval(() => {
      void this.ping()
        .then((ok) => {
          this.ultimoPingOk = ok;

          // So a TRANSICAO vira log: um aviso a cada 5 s encheria o log da
          // recepcao sem dizer nada novo.
          if (ok !== respondendo) {
            respondendo = ok;
            if (ok) {
              this.logger.info('catraca voltou a responder ao ping');
              // Voltou depois de cair: se foi queda de energia, perdeu a configuracao (#507).
              void this.gravarConfiguracao().catch((erro: unknown) => {
                this.logger.warn(
                  { erro: erro instanceof Error ? erro.message : erro },
                  'falha ao regravar a configuracao da catraca',
                );
              });
            }
            else this.logger.warn('catraca nao respondeu ao ping -- pode cair para offline');
          }
        })
        .catch((erro: unknown) => {
          this.ultimoPingOk = false;
          this.logger.warn(
            { erro: erro instanceof Error ? erro.message : erro },
            'ping da catraca falhou',
          );
        });
    }, intervaloMs);
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
    // Primeiro o ping: sem ele a catraca volta ao modo offline e decide
    // sozinha -- o plano B (#470).
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;

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
