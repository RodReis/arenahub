import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import pino from 'pino';
import { WebSocket } from 'ws';

import { ENROLL_ID_DESCONHECIDO } from './protocolo.js';
import { TopdataFacialAdapter, interpretarDataHora } from './topdata-facial-adapter.js';

/**
 * Leitor falso: conecta como CLIENTE, que e o papel dele no protocolo, e
 * responde como o manual manda.
 *
 * Nao imita a Topdata inteira -- imita o que os manuais documentam. Onde o
 * manual e ambiguo (o fim da paginacao), imita o comportamento dos EXEMPLOS,
 * que e o que o equipamento de verdade faz.
 */
class LeitorFalso {
  private socket: WebSocket | null = null;
  readonly recebidos: Record<string, unknown>[] = [];

  /** Respostas programadas por comando. */
  private readonly respostas = new Map<string, Record<string, unknown>>();

  constructor(readonly sn = 'AYTI11108174') {}

  responderCom(cmd: string, resposta: Record<string, unknown>): void {
    this.respostas.set(cmd, resposta);
  }

  conectar(porta: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${porta}/pub/chat`);
      this.socket = socket;

      socket.once('error', reject);
      socket.once('open', () => resolve());

      socket.on('message', (dados) => {
        const texto = Buffer.isBuffer(dados) ? dados.toString('utf8') : '';
        const msg = JSON.parse(texto) as Record<string, unknown>;
        this.recebidos.push(msg);

        const bruto = msg['cmd'];
        const cmd = typeof bruto === 'string' ? bruto : '';
        const programada = this.respostas.get(cmd);

        if (programada) {
          socket.send(JSON.stringify({ ret: cmd, sn: this.sn, ...programada }));
          return;
        }

        // Padrao: sucesso. Cobre disabledevice/enabledevice sem programar.
        if (cmd) socket.send(JSON.stringify({ ret: cmd, sn: this.sn, result: true }));
      });
    });
  }

  enviar(mensagem: unknown): void {
    this.socket?.send(JSON.stringify(mensagem));
  }

  /** O handshake que o equipamento manda ao conectar. */
  enviarReg(): void {
    this.enviar({
      cmd: 'reg',
      sn: this.sn,
      devinfo: { modelname: 'AiFace', firmware: 'AiF43V_v4.30', useduser: 48 },
    });
  }

  fechar(): void {
    this.socket?.close();
  }

  /** Espera até `condicao` valer, ou estoura. */
  async esperar(condicao: () => boolean, ms = 2000): Promise<void> {
    const limite = Date.now() + ms;
    while (!condicao()) {
      if (Date.now() > limite) throw new Error('condicao nao ocorreu a tempo');
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}

const logger = pino({ level: 'silent' });

// Porta alta, para nao colidir com a 7792 de uma bancada real na mesma
// maquina.
let proximaPorta = 39500;

describe('TopdataFacialAdapter', () => {
  let adapter: TopdataFacialAdapter;
  let leitor: LeitorFalso;
  let porta: number;

  beforeEach(async () => {
    porta = proximaPorta += 1;
    adapter = new TopdataFacialAdapter(logger, porta);
    await adapter.iniciar();
    leitor = new LeitorFalso();
    await leitor.conectar(porta);
  });

  afterEach(async () => {
    leitor.fechar();
    await adapter.encerrar();
  });

  it('responde ao reg — sem isso a comunicacao se perde', async () => {
    // O manual: "Caso a resposta nao seja enviada, a comunicacao com o
    // leitor facial sera perdida". Nao e recomendacao.
    leitor.enviarReg();

    await leitor.esperar(() => leitor.recebidos.some((m) => m['ret'] === 'reg'));

    const resposta = leitor.recebidos.find((m) => m['ret'] === 'reg');
    expect(resposta?.['result']).toBe(true);
    // cloudtime no formato do equipamento, nao ISO.
    expect(String(resposta?.['cloudtime'])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('desliga o envio de foto assim que o leitor registra', async () => {
    // Foto de acesso e, principalmente, foto de DESCONHECIDO sao dado
    // biometrico sem base legal para nos (regra no 7, ADR-008). Desligar e
    // a postura padrao, nao uma opcao de configuracao.
    leitor.enviarReg();

    await leitor.esperar(() => leitor.recebidos.some((m) => m['cmd'] === 'setdevinfo'));

    const cfg = leitor.recebidos.find((m) => m['cmd'] === 'setdevinfo');
    expect(cfg?.['use_logphoto']).toBe(0);
    expect(cfg?.['stranger_photo']).toBe(0);
  });

  it('guarda o numero de serie do equipamento', async () => {
    leitor.enviarReg();
    await leitor.esperar(() => adapter.serie !== null);

    expect(adapter.serie).toBe('AYTI11108174');
  });

  it('cadastra enviando setuserinfo entre disable e enable', async () => {
    // O manual manda desabilitar antes de outros comandos: enquanto trata
    // acesso, o leitor nao processa cadastro.
    const r = await adapter.cadastrar({ externalEnrollId: '123456789012', rotulo: 'teste' });

    expect(r.confirmado).toBe(true);

    const cmds = leitor.recebidos.map((m) => m['cmd']);
    expect(cmds).toEqual(['disabledevice', 'setuserinfo', 'enabledevice']);

    const set = leitor.recebidos.find((m) => m['cmd'] === 'setuserinfo');
    expect(set?.['enrollid']).toBe(123456789012);
    expect(set?.['backupnum']).toBe(0);
    // record "0" literal: o manual e explicito sobre isso.
    expect(set?.['record']).toBe('0');
  });

  it('reabilita o leitor mesmo quando o cadastro falha', async () => {
    // Falhar no cadastro nao pode deixar a catraca sem tratar acesso -- isso
    // travaria a recepcao por causa de um erro de sincronizacao.
    leitor.responderCom('setuserinfo', { result: false, reason: 3, msg: 'no space' });

    const r = await adapter.cadastrar({ externalEnrollId: '123456789012', rotulo: 't' });

    expect(r).toEqual({ confirmado: false, razao: 'no space (reason 3)' });
    expect(leitor.recebidos.map((m) => m['cmd'])).toContain('enabledevice');
  });

  it('remover quem nao existe e sucesso, nao erro', async () => {
    // Regra de arquitetura no 4: reprocessar tem de ser seguro. O
    // equipamento responde result:false com "have no data" nesse caso.
    leitor.responderCom('deleteuser', { result: false, reason: 1, msg: 'have no data' });

    const r = await adapter.remover('123456789012');

    expect(r).toEqual({ confirmado: true });
  });

  it('lista deduplicando o mesmo enrollid em backupnums diferentes', async () => {
    // O equipamento repete o enrollid uma vez por tipo de dado (senha,
    // cartao, foto). Para nos e uma identidade so.
    const paginas = [
      {
        result: true,
        count: 2,
        from: 0,
        to: 2,
        record: [
          { enrollid: 5, backupnum: 10 },
          { enrollid: 5, backupnum: 50 },
          { enrollid: 7, backupnum: 11 },
        ],
      },
      { result: true, count: 0, from: 0, to: 0, record: [] },
    ];

    leitor.responderCom('getuserlist', paginas[0]!);

    // A segunda pagina vem vazia -- e assim que os exemplos do manual
    // sinalizam o fim, apesar de o texto dizer "to == count".
    setTimeout(() => leitor.responderCom('getuserlist', paginas[1]!), 50);

    const lista = await adapter.listar();

    expect(lista.map((i) => i.externalEnrollId).sort()).toEqual(['5', '7']);
  });

  it('emite evento de reconhecimento com o horario do EQUIPAMENTO', async () => {
    // M0-FR-004: o timestamp e o do evento, nao o do recebimento. Usar o
    // nosso embaralharia a ordem quando ha fila ou reconexao.
    const eventos: { externalEnrollId: string; ocorridoEm: Date }[] = [];
    adapter.aoReconhecer((e) => eventos.push(e));

    leitor.enviar({
      cmd: 'sendlog',
      sn: leitor.sn,
      count: 1,
      logindex: 77,
      record: [{ enrollid: 12345, time: '2026-08-14 09:12:33', mode: 1, inout: 0, event: 0 }],
    });

    await leitor.esperar(() => eventos.length > 0);

    expect(eventos[0]?.externalEnrollId).toBe('12345');
    expect(eventos[0]?.ocorridoEm.getFullYear()).toBe(2026);
    expect(eventos[0]?.ocorridoEm.getHours()).toBe(9);
  });

  it('NAO emite evento para rosto desconhecido', async () => {
    // enrollid 99999999 e o ID especial de desconhecido. Nao ha pessoa a
    // identificar, entao o motor de acesso nao tem o que decidir.
    const eventos: unknown[] = [];
    adapter.aoReconhecer((e) => eventos.push(e));

    leitor.enviar({
      cmd: 'sendlog',
      sn: leitor.sn,
      count: 1,
      record: [{ enrollid: ENROLL_ID_DESCONHECIDO, time: '2026-08-14 09:12:33', event: 2 }],
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(eventos).toHaveLength(0);
  });

  it('descarta foto que chegue apesar do setdevinfo', async () => {
    // Dado biometrico nao entra no fluxo, nem no log.
    const eventos: Record<string, unknown>[] = [];
    adapter.aoReconhecer((e) => eventos.push({ ...e }));

    leitor.enviar({
      cmd: 'sendlog',
      sn: leitor.sn,
      count: 1,
      record: [
        {
          enrollid: 12345,
          time: '2026-08-14 09:12:33',
          image: 'data:image/jpeg;base64,/9j/NAO-PODE-VAZAR',
        },
      ],
    });

    await leitor.esperar(() => eventos.length > 0);

    expect(JSON.stringify(eventos)).not.toContain('NAO-PODE-VAZAR');
    expect(eventos[0]).not.toHaveProperty('image');
  });

  it('recusa externalEnrollId que nao cabe no equipamento', async () => {
    // O UUID hexadecimal da primeira versao da F2 cai aqui. Falhar alto e
    // melhor que recusa silenciosa no leitor.
    await expect(adapter.cadastrar({ externalEnrollId: 'a'.repeat(32), rotulo: 't' })).rejects.toThrow(
      /nao cabe no enrollid/,
    );
  });
});

describe('interpretarDataHora', () => {
  it('interpreta como hora local, nao UTC', () => {
    // O equipamento manda hora local sem fuso. Ler como UTC deslocaria todo
    // evento em tres horas.
    const d = interpretarDataHora('2026-08-14 09:12:33');

    expect(d.getHours()).toBe(9);
    expect(d.getMonth()).toBe(7);
  });

  it('devolve data invalida em vez de inventar o agora', () => {
    // Usar o relogio local mascararia o problema e produziria timestamp que
    // parece bom.
    expect(Number.isNaN(interpretarDataHora('formato estranho').getTime())).toBe(true);
  });
});
