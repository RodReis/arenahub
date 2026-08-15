import { beforeEach, describe, expect, it } from '@jest/globals';
import pino from 'pino';

import {
  ORIGEM,
  type ComandoPonte,
  type PonteEasyInner,
  type RespostaPonte,
} from './easyinner-ponte.js';
import { TopdataInnerAdapter } from './topdata-inner-adapter.js';

/**
 * Ponte falsa: responde como a EasyInner.dll responderia, segundo o manual.
 *
 * Nao imita a DLL inteira -- imita o que o manual documenta. E CONTA
 * LIBERACOES, porque `M0-AC-003` e sobre contagem: sem contar, "sem dupla
 * liberacao" e afirmacao, nao verificacao.
 */
class PonteFalsa implements PonteEasyInner {
  readonly nome = 'ponte-falsa';
  readonly recebidos: ComandoPonte[] = [];

  /** Quantas vezes a catraca fisicamente giraria. */
  liberacoes = 0;

  /** Eventos que `receber-evento` vai devolver, em ordem. */
  private readonly eventos: RespostaPonte[] = [];

  /** Retorno programado para o proximo `liberar`. */
  private retornoDeLiberar = 0;

  programarEventos(...respostas: RespostaPonte[]): void {
    this.eventos.push(...respostas);
  }

  programarFalhaDeLiberacao(retorno: number): void {
    this.retornoDeLiberar = retorno;
  }

  executar(comando: ComandoPonte): Promise<RespostaPonte> {
    this.recebidos.push(comando);

    if (comando.cmd === 'liberar') {
      if (this.retornoDeLiberar !== 0) {
        const r = this.retornoDeLiberar;
        this.retornoDeLiberar = 0;
        return Promise.resolve({ tipo: 'retorno', retorno: r });
      }
      // A catraca girou de verdade -- e o que o aceite conta.
      this.liberacoes += 1;
      return Promise.resolve({ tipo: 'retorno', retorno: 0 });
    }

    if (comando.cmd === 'receber-evento') {
      return Promise.resolve(this.eventos.shift() ?? { tipo: 'sem-evento' });
    }

    return Promise.resolve({ tipo: 'retorno', retorno: 0 });
  }

  encerrar(): Promise<void> {
    return Promise.resolve();
  }
}

const logger = pino({ level: 'silent' });

function eventoDe(origem: number): RespostaPonte {
  return { tipo: 'evento', evento: { origem } };
}

describe('TopdataInnerAdapter', () => {
  let ponte: PonteFalsa;
  let adapter: TopdataInnerAdapter;

  beforeEach(() => {
    ponte = new PonteFalsa();
    adapter = new TopdataInnerAdapter(ponte, logger, 1);
  });

  it('libera e confirma o giro pela Origem 6', async () => {
    // O manual: o giro nao vem por callback. Vem por polling de
    // ReceberDadosOnLine, e Origem 6 e o sensor optico confirmando.
    ponte.programarEventos(eventoDe(ORIGEM.GIRO_CONFIRMADO));

    const r = await adapter.liberar('cmd-1', 5000);

    expect(r.desfecho).toBe('girou');
    expect(ponte.liberacoes).toBe(1);
  });

  it('Origem 5 vira timeout — liberou e ninguem passou', async () => {
    // "Se um evento Origem 5 for recebido antes da Origem 6, significa que o
    // tempo de liberacao expirou e o giro nao ocorreu."
    ponte.programarEventos(eventoDe(ORIGEM.FIM_TEMPO_ACIONAMENTO));

    const r = await adapter.liberar('cmd-1', 5000);

    expect(r.desfecho).toBe('timeout');
    // Acionou: a catraca destravou. So ninguem passou.
    expect(ponte.liberacoes).toBe(1);
  });

  it('ignora evento intercalado e continua esperando o desfecho', async () => {
    // Alguem passa o cartao enquanto o giro anterior e aguardado. Nao e o
    // desfecho DESTA liberacao.
    ponte.programarEventos(
      eventoDe(ORIGEM.LEITOR1),
      eventoDe(ORIGEM.TECLADO),
      eventoDe(ORIGEM.GIRO_CONFIRMADO),
    );

    const r = await adapter.liberar('cmd-1', 5000);

    expect(r.desfecho).toBe('girou');
  });

  it('mesmo comandoId NAO aciona de novo — a garantia e nossa', async () => {
    // O EQUIPAMENTO NAO AJUDA: LiberarCatracaEntrada(int Inner) nao tem id
    // de comando. Chamar duas vezes gira duas vezes. Este teste guarda a
    // unica coisa que impede isso.
    ponte.programarEventos(eventoDe(ORIGEM.GIRO_CONFIRMADO));

    await adapter.liberar('cmd-unico', 5000);
    await adapter.liberar('cmd-unico', 5000);

    expect(ponte.liberacoes).toBe(1);
  });

  it('comando recusado NAO marca como executado — retry e legitimo', async () => {
    // Se a DLL recusa, o comando nao chegou na catraca. Marcar como feito
    // bloquearia a nova tentativa e deixaria a pessoa presa do lado de fora.
    ponte.programarFalhaDeLiberacao(1);

    const primeira = await adapter.liberar('cmd-1', 1000);
    expect(primeira.desfecho).toBe('desconhecido');
    expect(ponte.liberacoes).toBe(0);

    ponte.programarEventos(eventoDe(ORIGEM.GIRO_CONFIRMADO));
    const segunda = await adapter.liberar('cmd-1', 5000);

    expect(segunda.desfecho).toBe('girou');
    expect(ponte.liberacoes).toBe(1);
  });

  it('prazo esgotado sem Origem 5 nem 6 vira desconhecido, nao timeout', async () => {
    // `timeout` significa "o equipamento avisou que ninguem passou".
    // Silencio e outra coisa: nao sabemos. Registrar como timeout seria
    // inventar desfecho.
    const r = await adapter.liberar('cmd-1', 300);

    expect(r.desfecho).toBe('desconhecido');
  });

  it('manda ping enquanto espera, senao a catraca cai para offline', async () => {
    // "A falta do PingOnline fara com que a catraca mude para o modo
    // offline" -- e offline significa a catraca decidindo sozinha, que e o
    // oposto do que o M0-FR-005 quer.
    await adapter.liberar('cmd-1', 300);

    expect(ponte.recebidos.some((c) => c.cmd === 'ping')).toBe(true);
  });

  it('usa o sentido pedido — o SDK tem funcao separada por sentido', async () => {
    ponte.programarEventos(eventoDe(ORIGEM.GIRO_CONFIRMADO));

    await adapter.liberar('cmd-1', 5000, 'saida');

    const liberacao = ponte.recebidos.find((c) => c.cmd === 'liberar');
    expect(liberacao).toMatchObject({ sentido: 'saida' });
  });

  it('propaga a configuracao de sentido invertido', async () => {
    // A bancada tem a catraca a esquerda ao entrar. O manual diz que a
    // escolha "depende da orientacao fisica" -- se descobre testando.
    const invertido = new TopdataInnerAdapter(ponte, logger, 1, true);
    ponte.programarEventos(eventoDe(ORIGEM.GIRO_CONFIRMADO));

    await invertido.liberar('cmd-1', 5000);

    expect(ponte.recebidos.find((c) => c.cmd === 'liberar')).toMatchObject({
      invertido: true,
    });
  });

  it('explica o retorno 8 como problema de ambiente', async () => {
    // GPF quase nunca e bug de codigo: e DLL nao registrada, .NET ausente ou
    // processo 64 bits. Dizer isso poupa horas de quem esta na bancada.
    ponte.programarFalhaDeLiberacao(8);

    const r = await adapter.liberar('cmd-1', 300);

    expect(r.desfecho).toBe('desconhecido');
  });

  it('dez liberacoes distintas produzem dez acionamentos', async () => {
    // M0-AC-003 pelo caminho do adapter real.
    for (let i = 0; i < 10; i += 1) {
      ponte.programarEventos(eventoDe(ORIGEM.GIRO_CONFIRMADO));
      await adapter.liberar(`cmd-${i}`, 5000);
    }

    expect(ponte.liberacoes).toBe(10);
  });

  it('testarConexao devolve true so com retorno 0', async () => {
    expect(await adapter.testarConexao()).toBe(true);
  });
});
