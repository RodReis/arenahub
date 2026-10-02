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
  BACKUPNUM,
  ENROLL_ID_DESCONHECIDO,
  comandos,
  esquemaMensagemDoEquipamento,
  esquemaReg,
  esquemaSendLog,
  respostaReg,
  respostaSendLog,
  respostaSendUser,
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

/**
 * Vigia do leitor -- #504. Arena Positiva, 01/10/2026: depois de reiniciar o
 * Windows, o `TopFaceService` (software da Topdata, servico que sobe no boot,
 * ANTES do agente) escutava a mesma porta 7792 e ficou com o leitor. O rosto
 * era reconhecido, a catraca nao abria, e o log do agente nao dizia nada.
 */
export interface VigiaDoLeitor {
  /** Sem `reg` por este tempo (desde a partida ou a queda), avisa. */
  readonly avisoSemLeitorMs: number;
  /** Enquanto o leitor nao chega, repete o aviso neste intervalo. */
  readonly repetirAvisoMs: number;
}

export const VIGIA_PADRAO: VigiaDoLeitor = {
  avisoSemLeitorMs: 2 * 60_000,
  repetirAvisoMs: 5 * 60_000,
};

const ACAO_SEM_LEITOR =
  'confira se outro programa esta com o leitor (TopFace: netstat -ano | findstr 7792); ' +
  'reinicie o leitor na tomada; confira no leitor o IP deste PC e a porta';

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

  /** Modelo informado no `reg` -- vai no heartbeat (#522). */
  private modeloDoEquipamento: string | null = null;

  private readonly ouvintes: ((evento: EventoReconhecimento) => void)[] = [];
  private readonly ouvintesDeRegistro: ((serial: string) => void)[] = [];
  private readonly ouvintesDeCadastro: ((cadastro: {
    serial: string;
    externalUserId: string;
  }) => void)[] = [];

  /**
   * Comandos aguardando retorno, por nome (`ret`).
   *
   * O protocolo NAO tem id de correlacao: a resposta so traz `ret` com o
   * nome do comando. Logo, um comando de cada tipo por vez -- que e como o
   * proprio SDK de exemplo opera, e por isso `disabledevice` existe.
   */
  private readonly pendentes = new Map<string, Pendente>();

  /** Aviso de leitor ausente agendado -- #504. `null` com o leitor registrado. */
  private vigia: NodeJS.Timeout | null = null;
  private ausenteDesde = Date.now();

  /**
   * Fila das OPERACOES no leitor (cadastrar, remover, listar, ler foto) --
   * #503. Cada uma abre com `disabledevice` e fecha com `enabledevice`, e o
   * protocolo so aceita um comando de cada tipo aguardando: duas operacoes
   * ao mesmo tempo (a importacao de fotos rodando enquanto o sincronismo
   * cadastra alguem) colidiriam no `disabledevice`. Em fila, nunca colidem.
   */
  private filaDeOperacoes: Promise<unknown> = Promise.resolve();

  /** `getuserinfo` respondeu sucesso sem foto no `record` -- avisado (#503). */
  private avisouFotoForaDoRecord = false;

  private exclusivo<T>(operacao: () => Promise<T>): Promise<T> {
    const vez = this.filaDeOperacoes.then(operacao, operacao);
    this.filaDeOperacoes = vez.catch(() => undefined);

    return vez;
  }

  constructor(
    private readonly logger: Logger,
    private readonly porta: number = PORTA_PADRAO,
    private readonly prazos: VigiaDoLeitor = VIGIA_PADRAO,
  ) {}

  /**
   * Agenda o aviso de leitor ausente. Chamado na partida e a cada queda;
   * cancelado pelo `reg`. Repete enquanto o leitor nao volta: um aviso so,
   * soterrado no log de horas, nao serviria a quem abre o log depois.
   */
  private vigiarLeitor(esperaMs: number): void {
    if (this.vigia) clearTimeout(this.vigia);

    this.vigia = setTimeout(() => {
      this.logger.warn(
        {
          porta: this.porta,
          semLeitorHaMin: Math.round((Date.now() - this.ausenteDesde) / 60_000),
          acao: ACAO_SEM_LEITOR,
        },
        'leitor facial nao esta conectado ao agente',
      );
      this.vigiarLeitor(this.prazos.repetirAvisoMs);
    }, esperaMs);
    // Nao segura o processo vivo so por causa do aviso.
    this.vigia.unref();
  }

  private pararVigia(): void {
    if (this.vigia) clearTimeout(this.vigia);
    this.vigia = null;
  }

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

        /*
         * Codigo e motivo do fechamento (#406): o leitor real caia a cada
         * 20 s exatos e o log so dizia "desconectou". 1000 = fechou por
         * vontade propria, 1006 = conexao cortada sem fechamento, 4xxx =
         * codigo do firmware -- cada um aponta para uma causa diferente.
         */
        socket.on('close', (codigo: number, motivo: Buffer) => {
          this.logger.warn(
            { codigo, motivo: motivo.toString('utf8') },
            'leitor facial desconectou',
          );
          if (this.conexao === socket) {
            this.conexao = null;
            // Sem leitor, sem serial: o heartbeat para de informa-lo e a
            // nuvem levanta DEVICE_OFFLINE (#504). Antes o serial do ultimo
            // `reg` ficava, e o painel via um leitor ativo que nao estava.
            this.serieDoEquipamento = null;
            this.ausenteDesde = Date.now();
            this.vigiarLeitor(this.prazos.avisoSemLeitorMs);
          }
        });

        socket.on('error', (erro) => this.logger.error({ erro: erro.message }, 'erro no socket'));
      });

      servidor.once('listening', () => {
        this.servidor = servidor;
        this.ausenteDesde = Date.now();
        this.vigiarLeitor(this.prazos.avisoSemLeitorMs);
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

    /*
     * So o TIPO (`cmd` ou `ret`) e o tamanho, nunca o conteudo: `sendlog` e
     * `senduser` podem trazer foto em Base64, que e dado biometrico. Em
     * `debug` porque em operacao normal seria ruido; para diagnosticar a
     * queda de conexao (#406) sobe-se o LOG_LEVEL.
     */
    this.logger.debug({ tipo: tipoDaMensagem(json), bytes: bruto.length }, 'mensagem do leitor');

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

    if ('cmd' in mensagem && mensagem.cmd === 'senduser') {
      // O leitor informa um cadastro dele. So o NUMERO sai daqui (#468): e
      // como o cadastro feito direto no equipamento chega a nuvem para ser
      // vinculado. Foto e nome ficam -- a nuvem e a fonte da verdade do
      // aluno. O ack e obrigatorio: sem ele o firmware v2.16 derruba a
      // conexao num loop. Ver protocolo.ts / esquemaSendUser.
      const serial = typeof mensagem.sn === 'string' ? mensagem.sn : this.serieDoEquipamento;
      if (typeof mensagem.enrollid === 'number' && serial !== null) {
        const cadastro = { serial, externalUserId: String(mensagem.enrollid) };
        for (const ouvinte of this.ouvintesDeCadastro) ouvinte(cadastro);
      }
      this.enviar(respostaSendUser());
      return;
    }

    if ('cmd' in mensagem && mensagem.cmd === 'sendlog') {
      this.tratarSendLog(json);
      return;
    }

    if ('ret' in mensagem && typeof mensagem.ret === 'string') {
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
    this.modeloDoEquipamento = reg.data.devinfo.modelname ?? null;
    this.pararVigia();

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

    // So DEPOIS do ack e do setdevinfo: quem ouve vai conversar com o leitor
    // (listar a base, #468), e o handshake precisa estar fechado antes.
    for (const ouvinte of this.ouvintesDeRegistro) ouvinte(reg.data.sn);
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
        // O nosso, carimbado sempre -- e so para ORDENAR quando o do
        // equipamento for implausivel. Ver `plausibilidade-de-relogio.ts`.
        recebidoEm: new Date(),
        metodo: 'facial',
        serialDoDispositivo: log.data.sn,
        /*
         * Leitor + pessoa + hora DO REGISTRO. Estavel quando o leitor reenvia
         * o mesmo registro (retry nao vira passagem nova) e unico entre
         * passagens diferentes.
         *
         * NAO usa `logindex`: ele recomeca a cada conexao do leitor, e o id
         * `logindex-posicao` fazia a passagem nova repetir o id de uma
         * antiga -- o Edge devolvia a decisao guardada sem perguntar a nuvem
         * (Arena Positiva, 01/10/2026). Antes disso, o `logindex` puro, igual
         * para o lote inteiro, ja tinha virado REENTRADA no segundo registro
         * (#476) -- `posicao` resolvia aquele caso, nao este.
         */
        idExternoDoEvento: `${log.data.sn}-${registro.enrollid}-${registro.time}`,
      };

      for (const ouvinte of this.ouvintes) ouvinte(evento);
    }

    /*
     * O ack vai DEPOIS de entregar os eventos aos ouvintes: confirmar antes e
     * cair no meio perderia o registro, porque o leitor nao reenvia o que ja
     * foi confirmado. Sem ack nenhum, porem, o leitor corta a conexao a cada
     * ~20 s e reenvia o mesmo lote para sempre (#406, achado de campo).
     */
    this.enviar(respostaSendLog({ count: log.data.count, logindex: log.data.logindex }));
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

  cadastrar(identidade: IdentidadeNoDispositivo): Promise<ResultadoOperacao> {
    // `paraEnrollId` DENTRO da fila: id invalido vira promessa rejeitada,
    // como sempre foi, e nao excecao sincrona para quem chama.
    return this.exclusivo(() =>
      this.cadastrarAgora(paraEnrollId(identidade.externalEnrollId), identidade.rotulo),
    );
  }

  private async cadastrarAgora(enrollid: number, rotulo: string): Promise<ResultadoOperacao> {
    // O manual manda desabilitar antes de outros comandos: enquanto o leitor
    // trata acesso, ele nao processa cadastro.
    await this.comandar(comandos.disableDevice(), 'disabledevice');

    try {
      const retorno = await this.comandar(
        comandos.setUserInfoSemFoto({ enrollid, name: rotulo }),
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

  remover(externalEnrollId: ExternalEnrollId): Promise<ResultadoOperacao> {
    return this.exclusivo(() => this.removerAgora(paraEnrollId(externalEnrollId)));
  }

  private async removerAgora(enrollid: number): Promise<ResultadoOperacao> {
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
  listar(): Promise<readonly IdentidadeNoDispositivo[]> {
    return this.exclusivo(() => this.listarAgora());
  }

  /**
   * A foto de cadastro de uma pessoa, em Base64 -- #503. `getuserinfo` com
   * `backupnum: 50` (PROTOCOLO-FACIAL.md, tabela do `backupnum`).
   *
   * Uma pessoa por chamada, com o leitor pausado so durante ela: a
   * importacao de centenas de fotos nao pode deixar o leitor parado minutos
   * seguidos. O conteudo NUNCA vai para o log -- e foto de pessoa.
   */
  lerFoto(externalEnrollId: ExternalEnrollId): Promise<string | null> {
    return this.exclusivo(async () => {
      const enrollid = paraEnrollId(externalEnrollId);

      await this.comandar(comandos.disableDevice(), 'disabledevice');

      try {
        const retorno = await this.comandar(
          comandos.getUserInfo(enrollid, BACKUPNUM.FOTO),
          'getuserinfo',
        );
        const record = retorno['record'];

        // Sem foto o leitor responde `result: false` ("have no data") ou um
        // `record` vazio/"0" -- nos dois casos nao ha o que importar.
        if (retorno['result'] !== true || typeof record !== 'string' || record.length < 16) {
          // Sucesso SEM foto no `record`: firmware que manda a imagem em outro
          // campo. So os NOMES dos campos vao ao log -- o suficiente para
          // ajustar o adapter, sem nenhum dado da pessoa.
          // UMA vez por execucao: com o firmware assim, seriam centenas de
          // linhas iguais.
          if (retorno['result'] === true && !this.avisouFotoForaDoRecord) {
            this.avisouFotoForaDoRecord = true;
            this.logger.warn({ campos: Object.keys(retorno) }, 'getuserinfo sem foto no record');
          }

          return null;
        }

        return record;
      } finally {
        await this.comandar(comandos.enableDevice(), 'enabledevice').catch(() => undefined);
      }
    });
  }

  private async listarAgora(): Promise<readonly IdentidadeNoDispositivo[]> {
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

  aoRegistrar(ouvinte: (serial: string) => void): void {
    this.ouvintesDeRegistro.push(ouvinte);
  }

  aoInformarCadastro(
    ouvinte: (cadastro: { serial: string; externalUserId: string }) => void,
  ): void {
    this.ouvintesDeCadastro.push(ouvinte);
  }

  encerrar(): Promise<void> {
    this.pararVigia();

    return new Promise((resolve) => {
      for (const pendente of this.pendentes.values()) {
        clearTimeout(pendente.temporizador);
        pendente.rejeitar(new Error('adapter encerrado'));
      }
      this.pendentes.clear();
      this.ouvintes.length = 0;
      this.ouvintesDeRegistro.length = 0;
      this.ouvintesDeCadastro.length = 0;

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

  /**
   * Numero de serie do equipamento CONECTADO, quando ja houve `reg`. Volta a
   * `null` quando a conexao cai (#504).
   */
  get serie(): string | null {
    return this.serieDoEquipamento;
  }

  get modelo(): string | null {
    return this.modeloDoEquipamento;
  }
}

/**
 * `cmd` (o leitor pedindo) ou `ret` (o leitor respondendo) -- nada alem
 * disso sai daqui, para o log de diagnostico nunca carregar dado da pessoa.
 */
function tipoDaMensagem(json: unknown): string {
  if (typeof json !== 'object' || json === null) return 'desconhecido';

  const { cmd, ret } = json as { cmd?: unknown; ret?: unknown };

  if (typeof cmd === 'string') return cmd;
  if (typeof ret === 'string') return `ret:${ret}`;

  return 'desconhecido';
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
