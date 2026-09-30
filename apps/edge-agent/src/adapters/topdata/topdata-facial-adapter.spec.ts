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

  /** Fecha com codigo e motivo, como o firmware faz ao derrubar a conexao. */
  fecharCom(codigo: number, motivo: string): void {
    this.socket?.close(codigo, motivo);
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

  it('carrega o serial do leitor que reconheceu -- e ele que a nuvem conhece (#467)', async () => {
    // O Edge mandava o proprio EDGE_AGENT_ID como deviceId; a nuvem so
    // conhece o leitor pelo UUID do Device ou pelo serial do fabricante.
    const eventos: { serialDoDispositivo?: string }[] = [];
    adapter.aoReconhecer((e) => eventos.push(e));

    leitor.enviar({
      cmd: 'sendlog',
      sn: leitor.sn,
      count: 1,
      logindex: 78,
      record: [{ enrollid: 12345, time: '2026-08-14 09:12:33', mode: 1, inout: 0, event: 0 }],
    });

    await leitor.esperar(() => eventos.length > 0);

    expect(eventos[0]?.serialDoDispositivo).toBe(leitor.sn);
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

  it('responde ao senduser — sem ack o leitor v2.16 derruba a conexao', async () => {
    // Achado de campo 17/08/2026: o firmware ai518_fp26v_v2.16 envia `senduser`
    // (sincronizacao da base de usuarios do leitor) apos o reg. Sem resposta,
    // ele reenvia e derruba a conexao num loop de ~5s. A resposta e um ack
    // simples com o proprio nome do comando -- mesmo contrato do reg.
    leitor.enviar({
      cmd: 'senduser',
      sn: leitor.sn,
      enrollid: 12345,
      name: 'Fulano',
      backupnum: 0,
      admin: 0,
      record: '0',
    });

    await leitor.esperar(() => leitor.recebidos.some((m) => m['ret'] === 'senduser'));

    const resposta = leitor.recebidos.find((m) => m['ret'] === 'senduser');
    expect(resposta?.['result']).toBe(true);
  });

  /**
   * #468 -- o cadastro feito direto no leitor precisa chegar ao ArenaHub para
   * ser vinculado ao aluno, sem sincronismo manual. So o NUMERO sai: nome e
   * foto do `senduser` ficam no adapter.
   */
  it('informa o numero de cada senduser, sem nome nem foto (#468)', async () => {
    const cadastros: unknown[] = [];
    adapter.aoInformarCadastro((c) => cadastros.push(c));

    leitor.enviar({
      cmd: 'senduser',
      sn: leitor.sn,
      enrollid: 1491,
      name: 'Fulano',
      backupnum: 50,
      record: 'data:image/jpeg;base64,/9j/FOTO-NAO-PODE-SAIR',
    });

    await leitor.esperar(() => cadastros.length > 0);

    expect(cadastros[0]).toEqual({ serial: leitor.sn, externalUserId: '1491' });
    expect(JSON.stringify(cadastros)).not.toContain('FOTO-NAO-PODE-SAIR');
    expect(JSON.stringify(cadastros)).not.toContain('Fulano');
  });

  it('avisa o registro do leitor com o serial, depois do handshake (#468)', async () => {
    const seriais: string[] = [];
    adapter.aoRegistrar((s) => seriais.push(s));

    leitor.enviarReg();

    await leitor.esperar(() => seriais.length > 0);

    expect(seriais).toEqual([leitor.sn]);
    // O handshake ja fechou quando o aviso sai: quem ouve vai conversar com
    // o leitor e nao pode atropelar o ack do reg.
    expect(leitor.recebidos.some((m) => m['ret'] === 'reg')).toBe(true);
  });

  it('confirma o sendlog com o mesmo logindex -- sem ack o leitor corta a conexao', async () => {
    // Achado de campo 30/09/2026 (#406), mesmo firmware v2.16: a cada conexao
    // o leitor manda reg -> sendlog, espera ~20 s e corta com 1006, sem
    // mensagem alguma no meio. Ao reconectar, reenvia o MESMO sendlog (894
    // bytes, identico) -- o registro nunca confirmado. Mesmo contrato do reg
    // e do senduser: `ret` + `result`, ecoando `count` e `logindex` para o
    // leitor saber QUAL lote foi confirmado.
    leitor.enviar({
      cmd: 'sendlog',
      sn: leitor.sn,
      count: 1,
      logindex: 321,
      record: [
        { enrollid: 12345, time: '2026-09-30 10:00:00', mode: 1, inout: 0, event: 0 },
      ],
    });

    await leitor.esperar(() => leitor.recebidos.some((m) => m['ret'] === 'sendlog'));

    const resposta = leitor.recebidos.find((m) => m['ret'] === 'sendlog');
    expect(resposta?.['result']).toBe(true);
    expect(resposta?.['logindex']).toBe(321);
    expect(resposta?.['count']).toBe(1);
  });

  it('recusa externalEnrollId que nao cabe no equipamento', async () => {
    // O UUID hexadecimal da primeira versao da F2 cai aqui. Falhar alto e
    // melhor que recusa silenciosa no leitor.
    await expect(adapter.cadastrar({ externalEnrollId: 'a'.repeat(32), rotulo: 't' })).rejects.toThrow(
      /nao cabe no enrollid/,
    );
  });
});

/**
 * #406 -- Arena Positiva, 30/09/2026. O leitor real (`AYTI11108174`, fw
 * v2.16) cai e reconecta a cada 20 s exatos, e o log so dizia "leitor facial
 * desconectou". Sem o codigo de fechamento do WebSocket e sem saber o que foi
 * trocado antes da queda, qualquer correcao seria chute.
 *
 * O diagnostico registra o TIPO de cada mensagem (`cmd`/`ret`) e o codigo e
 * motivo do fechamento -- nunca o conteudo: `sendlog` e `senduser` podem
 * carregar foto em Base64, que e dado biometrico.
 */
describe('TopdataFacialAdapter -- diagnostico de conexao', () => {
  let linhas: Record<string, unknown>[];
  let adapter: TopdataFacialAdapter;
  let leitor: LeitorFalso;
  let porta: number;

  beforeEach(async () => {
    linhas = [];
    const capturador = pino(
      { level: 'debug' },
      { write: (linha: string) => linhas.push(JSON.parse(linha) as Record<string, unknown>) },
    );

    porta = proximaPorta += 1;
    adapter = new TopdataFacialAdapter(capturador, porta);
    await adapter.iniciar();
    leitor = new LeitorFalso();
    await leitor.conectar(porta);
  });

  afterEach(async () => {
    leitor.fechar();
    await adapter.encerrar();
  });

  it('registra o codigo e o motivo quando o leitor desconecta', async () => {
    leitor.fecharCom(4001, 'motivo do equipamento');

    const achar = (): Record<string, unknown> | undefined =>
      linhas.find((l) => l['msg'] === 'leitor facial desconectou');

    await leitor.esperar(() => achar() !== undefined);

    expect(achar()?.['codigo']).toBe(4001);
    expect(achar()?.['motivo']).toBe('motivo do equipamento');
  });

  it('registra o tipo de cada mensagem recebida, nunca o conteudo', async () => {
    leitor.enviar({
      cmd: 'sendlog',
      sn: leitor.sn,
      count: 1,
      logindex: 7,
      record: [
        {
          enrollid: 12345,
          name: 'ALUNO FICTICIO',
          time: '2026-09-30 10:00:00',
          mode: 8,
          inout: 0,
          event: 0,
          image: 'BASE64-DE-FOTO-NAO-PODE-IR-AO-LOG',
        },
      ],
    });

    const achar = (): Record<string, unknown> | undefined =>
      linhas.find((l) => l['msg'] === 'mensagem do leitor' && l['tipo'] === 'sendlog');

    await leitor.esperar(() => achar() !== undefined);

    const tudo = JSON.stringify(linhas);
    expect(tudo).not.toContain('BASE64-DE-FOTO-NAO-PODE-IR-AO-LOG');
    expect(tudo).not.toContain('ALUNO FICTICIO');
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
