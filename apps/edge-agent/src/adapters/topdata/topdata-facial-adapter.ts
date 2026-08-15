import { type Logger } from 'pino';
import { WebSocketServer, type WebSocket } from 'ws';

import {
  type EventoReconhecimento,
  type ExternalEnrollId,
  type FacialDeviceAdapter,
  type IdentidadeNoDispositivo,
  type ResultadoOperacao,
} from '../../domain/facial-device.js';
import {
  ENROLL_ID_DESCONHECIDO,
  comandos,
  esquemaMensagemDoEquipamento,
  esquemaReg,
  esquemaSendLog,
  respostaReg,
} from './protocolo.js';

/**
 * Adapter real do leitor facial Topdata.
 *
 * Fonte: `docs/vendor/topdata/PROTOCOLO-FACIAL.md`. Nenhuma chamada aqui foi
 * inventada -- cada comando corresponde a um trecho do manual.
 *
 * NOS SOMOS O SERVIDOR. O manual: "O aplicativo atua como um servidor
 * WebSocket, enquanto o leitor facial atua como um cliente WebSocket". O
 * agente escuta na porta configurada e o leitor conecta em `/pub/chat`.
 *
 * Isso responde a parte principal do ADR-010: nao ha DLL no caminho de
 * dados, entao o transporte nao e refem do Windows.
 */

/** Porta padrao do servidor, conforme o manual. Configuravel no leitor. */
export const PORTA_PADRAO = 7792;

/** Caminho que o leitor usa para conectar. Fixo no firmware. */
const CAMINHO = '/pub/chat';

/** Prazo para o equipamento responder um comando. */
const TIMEOUT_COMANDO_MS = 10_000;

type Pendente = {
  resolver: (retorno: Record<string, unknown>) => void;
  rejeitar: (erro: Error) => void;
  temporizador: NodeJS.Timeout;
};

export class TopdataFacialAdapter implements FacialDeviceAdapter {
  readonly nome = 'topdata-facial';

  private servidor: WebSocketServer | null = null;
  private conexao: WebSocket | null = null;

  /** Numero de serie do equipamento conectado. Vem do `reg`. */
  private serieDoEquipamento: string | null = null;

  private readonly ouvintes: ((evento: EventoReconhecimento) => void)[] = [];

  /**
   * Comandos aguardando retorno, por nome (`ret`).
   *
   * O protocolo NAO tem id de correlacao: a resposta so traz `ret` com o
   * nome do comando. Logo, um comando de cada tipo por vez -- que e como o
   * proprio SDK de exemplo opera, e por isso `disabledevice` existe.
   */
  private readonly pendentes = new Map<string, Pendente>();

  constructor(
    private readonly logger: Logger,
    private readonly porta: number = PORTA_PADRAO,
  ) {}

  /** Sobe o servidor e espera o leitor conectar. */
  iniciar(): Promise<void> {
    return new Promise((resolve, reject) => {
      const servidor = new WebSocketServer({ port: this.porta, path: CAMINHO });

      servidor.once('error', reject);

      servidor.on('connection', (socket) => {
        // Um leitor por agente. Conexao nova substitui a anterior -- o
        // equipamento reconecta sozinho depois de queda de rede, e manter a
        // antiga deixaria comando indo para um socket morto.
        if (this.conexao) {
          this.logger.warn('conexao anterior substituida por nova');
          this.conexao.terminate();
        }

        this.conexao = socket;
        this.logger.info({ porta: this.porta }, 'leitor facial conectou');

        // `RawData` do ws e Buffer, ArrayBuffer ou Buffer[]. Normaliza para
        // texto sem passar por String() cru, que viraria "[object Object]"
        // num array de Buffer.
        socket.on('message', (dados) => this.aoReceber(paraTexto(dados)));

        socket.on('close', () => {
          this.logger.warn('leitor facial desconectou');
          if (this.conexao === socket) this.conexao = null;
        });

        socket.on('error', (erro) => this.logger.error({ erro: erro.message }, 'erro no socket'));
      });

      servidor.once('listening', () => {
        this.servidor = servidor;
        this.logger.info(
          { porta: this.porta, caminho: CAMINHO },
          'servidor do leitor facial no ar, aguardando conexao',
        );
        resolve();
      });
    });
  }

  private aoReceber(bruto: string): void {
    let json: unknown;
    try {
      json = JSON.parse(bruto);
    } catch {
      // Nao logar o conteudo: mensagem malformada pode conter foto em
      // Base64, e isso e dado biometrico.
      this.logger.warn({ bytes: bruto.length }, 'mensagem ilegivel do equipamento');
      return;
    }

    const validacao = esquemaMensagemDoEquipamento.safeParse(json);
    if (!validacao.success) {
      this.logger.warn('mensagem do equipamento fora do formato documentado');
      return;
    }

    const mensagem = validacao.data;

    if ('cmd' in mensagem && mensagem.cmd === 'reg') {
      this.tratarReg(json);
      return;
    }

    if ('cmd' in mensagem && mensagem.cmd === 'sendlog') {
      this.tratarSendLog(json);
      return;
    }

    if ('ret' in mensagem) {
      this.resolverPendente(mensagem.ret, mensagem);
    }
  }

  /**
   * `reg` -- e a resposta e OBRIGATORIA.
   *
   * O manual: "Caso a resposta nao seja enviada, a comunicacao com o leitor
   * facial sera perdida". Nao ha retry nem degradacao: sem responder, o
   * leitor repete `reg` ate desistir.
   */
  private tratarReg(json: unknown): void {
    const reg = esquemaReg.safeParse(json);
    if (!reg.success) return;

    this.serieDoEquipamento = reg.data.sn;

    this.logger.info(
      {
        sn: reg.data.sn,
        modelo: reg.data.devinfo.modelname,
        firmware: reg.data.devinfo.firmware,
        usuariosCadastrados: reg.data.devinfo.useduser,
      },
      'leitor registrado',
    );

    this.enviar(respostaReg(new Date()));

    // Desliga o envio de foto ANTES de qualquer outra coisa. Foto de acesso
    // e, principalmente, foto de desconhecido sao dado biometrico sem base
    // legal para nos (regra de arquitetura no 7, ADR-008). Ligar e decisao
    // do PI, nao padrao.
    this.enviar(comandos.desligarEnvioDeFoto());
  }

  private tratarSendLog(json: unknown): void {
    const log = esquemaSendLog.safeParse(json);
    if (!log.success) return;

    for (const registro of log.data.record) {
      if (registro.image !== undefined) {
        // Chegou foto apesar do setdevinfo. DESCARTA sem persistir e sem
        // logar o conteudo -- so o fato, para alguem investigar a config do
        // equipamento.
        this.logger.warn(
          { enrollid: registro.enrollid },
          'equipamento enviou foto no log apesar de setdevinfo desligado; descartada',
        );
      }

      if (registro.enrollid === ENROLL_ID_DESCONHECIDO) {
        // Rosto que o leitor nao reconhece. Nao e evento de acesso: nao ha
        // pessoa a identificar, e o motor nao tem o que decidir.
        this.logger.info('rosto desconhecido detectado no leitor');
        continue;
      }

      const evento: EventoReconhecimento = {
        externalEnrollId: String(registro.enrollid),
        // Horario DO EQUIPAMENTO (M0-FR-004), nao o de recebimento. Usar o
        // nosso embaralharia a ordem quando ha fila ou reconexao.
        ocorridoEm: interpretarDataHora(registro.time),
        metodo: 'facial',
        ...(log.data.logindex !== undefined
          ? { idExternoDoEvento: String(log.data.logindex) }
          : {}),
      };

      for (const ouvinte of this.ouvintes) ouvinte(evento);
    }
  }

  private enviar(mensagem: string): void {
    if (!this.conexao) {
      throw new Error('leitor facial nao esta conectado');
    }
    this.conexao.send(mensagem);
  }

  /** Envia e espera o `ret` correspondente. */
  private comandar(mensagem: string, retEsperado: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (this.pendentes.has(retEsperado)) {
        reject(new Error(`ja ha um comando ${retEsperado} aguardando retorno`));
        return;
      }

      const temporizador = setTimeout(() => {
        this.pendentes.delete(retEsperado);
        reject(new Error(`o equipamento nao respondeu ${retEsperado} em ${TIMEOUT_COMANDO_MS} ms`));
      }, TIMEOUT_COMANDO_MS);

      this.pendentes.set(retEsperado, { resolver: resolve, rejeitar: reject, temporizador });

      try {
        this.enviar(mensagem);
      } catch (erro: unknown) {
        clearTimeout(temporizador);
        this.pendentes.delete(retEsperado);
        reject(erro instanceof Error ? erro : new Error(String(erro)));
      }
    });
  }

  private resolverPendente(ret: string, retorno: Record<string, unknown>): void {
    const pendente = this.pendentes.get(ret);
    if (!pendente) return;

    clearTimeout(pendente.temporizador);
    this.pendentes.delete(ret);
    pendente.resolver(retorno);
  }

  async cadastrar(identidade: IdentidadeNoDispositivo): Promise<ResultadoOperacao> {
    const enrollid = paraEnrollId(identidade.externalEnrollId);

    // O manual manda desabilitar antes de outros comandos: enquanto o leitor
    // trata acesso, ele nao processa cadastro.
    await this.comandar(comandos.disableDevice(), 'disabledevice');

    try {
      const retorno = await this.comandar(
        comandos.setUserInfoSemFoto({ enrollid, name: identidade.rotulo }),
        'setuserinfo',
      );

      return retorno['result'] === true
        ? { confirmado: true }
        : { confirmado: false, razao: descreverFalha(retorno) };
    } finally {
      // `finally`: falhar no cadastro nao pode deixar a catraca sem tratar
      // acesso. Isso travaria a recepcao por um erro de sincronizacao.
      await this.comandar(comandos.enableDevice(), 'enabledevice').catch(() => undefined);
    }
  }

  async remover(externalEnrollId: ExternalEnrollId): Promise<ResultadoOperacao> {
    const enrollid = paraEnrollId(externalEnrollId);

    await this.comandar(comandos.disableDevice(), 'disabledevice');

    try {
      const retorno = await this.comandar(comandos.deleteUser(enrollid), 'deleteuser');

      // Remover quem nao existe e SUCESSO: o estado desejado -- ausencia --
      // ja vale (regra de arquitetura no 4). O equipamento devolve
      // result:false com msg "have no data" nesse caso.
      if (retorno['result'] === true) return { confirmado: true };
      // O equipamento sinaliza "nao existe" com result:false e msg
      // "have no data" -- e isso, para nos, e sucesso.
      const msg = retorno['msg'];
      if (typeof msg === 'string' && msg.includes('no data')) return { confirmado: true };

      return { confirmado: false, razao: descreverFalha(retorno) };
    } finally {
      await this.comandar(comandos.enableDevice(), 'enabledevice').catch(() => undefined);
    }
  }

  /**
   * Lista o que existe no equipamento, paginando.
   *
   * O manual diz para parar quando `to == count`, mas os exemplos mostram o
   * fim como lista VAZIA -- ver PROTOCOLO-FACIAL.md. Trata os dois, e o que
   * vier primeiro encerra.
   */
  async listar(): Promise<readonly IdentidadeNoDispositivo[]> {
    await this.comandar(comandos.disableDevice(), 'disabledevice');

    try {
      const encontrados = new Map<string, IdentidadeNoDispositivo>();
      let primeira = true;

      // Teto de paginas: protege contra equipamento que nunca sinaliza fim.
      // 5.000 usuarios e a capacidade maxima do leitor; 100 por pagina nos
      // exemplos do manual.
      for (let pagina = 0; pagina < 100; pagina += 1) {
        const retorno = await this.comandar(comandos.getUserList(primeira), 'getuserlist');
        primeira = false;

        const registros = Array.isArray(retorno['record'])
          ? (retorno['record'] as { enrollid?: number }[])
          : [];

        if (registros.length === 0) break;

        for (const r of registros) {
          if (typeof r.enrollid !== 'number') continue;
          // O mesmo enrollid aparece uma vez por backupnum (senha, cartao,
          // foto). Deduplica: para nos, e uma identidade so.
          encontrados.set(String(r.enrollid), {
            externalEnrollId: String(r.enrollid),
            rotulo: '',
          });
        }

        const ate = Number(retorno['to'] ?? 0);
        const total = Number(retorno['count'] ?? 0);
        if (total > 0 && ate >= total) break;
      }

      return [...encontrados.values()];
    } finally {
      await this.comandar(comandos.enableDevice(), 'enabledevice').catch(() => undefined);
    }
  }

  aoReconhecer(ouvinte: (evento: EventoReconhecimento) => void): void {
    this.ouvintes.push(ouvinte);
  }

  encerrar(): Promise<void> {
    return new Promise((resolve) => {
      for (const pendente of this.pendentes.values()) {
        clearTimeout(pendente.temporizador);
        pendente.rejeitar(new Error('adapter encerrado'));
      }
      this.pendentes.clear();
      this.ouvintes.length = 0;

      this.conexao?.close();
      this.conexao = null;

      if (!this.servidor) {
        resolve();
        return;
      }

      this.servidor.close(() => {
        this.servidor = null;
        resolve();
      });
    });
  }

  /** Numero de serie do equipamento conectado, quando ja houve `reg`. */
  get serie(): string | null {
    return this.serieDoEquipamento;
  }
}

/** Normaliza o payload do ws (Buffer | ArrayBuffer | Buffer[]) para texto. */
function paraTexto(dados: unknown): string {
  if (typeof dados === 'string') return dados;
  if (Buffer.isBuffer(dados)) return dados.toString('utf8');
  if (Array.isArray(dados)) return Buffer.concat(dados as Buffer[]).toString('utf8');
  if (dados instanceof ArrayBuffer) return Buffer.from(dados).toString('utf8');
  return '';
}

/**
 * Converte o identificador para o numero que o equipamento espera.
 *
 * Falha alto se nao couber: mandar id invalido produz recusa silenciosa no
 * leitor, que e mais dificil de diagnosticar que uma excecao aqui.
 */
function paraEnrollId(externalEnrollId: ExternalEnrollId): number {
  const numero = Number(externalEnrollId);

  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 999_999_999_999) {
    throw new Error(
      `externalEnrollId ${JSON.stringify(externalEnrollId)} nao cabe no enrollid do ` +
        'equipamento (1 a 999.999.999.999)',
    );
  }

  return numero;
}

/** Mensagem de falha do equipamento, sem inventar texto. */
function descreverFalha(retorno: Record<string, unknown>): string {
  const msg = retorno['msg'];
  const reason = retorno['reason'];

  if (typeof msg === 'string' && msg.length > 0) {
    return typeof reason === 'number' ? `${msg} (reason ${reason})` : msg;
  }

  return typeof reason === 'number' ? `falha do equipamento, reason ${reason}` : 'falha do equipamento';
}

/**
 * "2023-12-27 10:00:00" -> Date.
 *
 * O equipamento manda hora LOCAL sem fuso. Interpretar como UTC deslocaria
 * todo evento em tres horas, e o `M0-NFR-004` depende de correlacionar log
 * de bancada com log de nuvem.
 */
export function interpretarDataHora(texto: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(texto);

  if (!m) {
    // Formato inesperado: usar o agora seria inventar timestamp. Melhor uma
    // data invalida, que aparece no log e nao se disfarca de dado bom.
    return new Date(Number.NaN);
  }

  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}
