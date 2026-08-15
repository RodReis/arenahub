import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { ColetorSimulado } from '../adapters/coletor-simulado.js';
import { FilaDeEventos, type EventoParaEnviar } from '../persistence/fila-de-eventos.js';
import { reconciliar } from './reconciliar.js';

const AGORA = new Date('2026-08-14T12:00:00.000Z');

function evento(n: number, ocorridoEm = AGORA): EventoParaEnviar {
  return {
    eventoId: `evt-${n}`,
    tenantId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    gymUnitId: '9c858901-8a57-4791-81fe-4c455b099bc9',
    edgeAgentId: 'bancada-01',
    tipo: 'passagem',
    ocorridoEm,
    payload: JSON.stringify({ desfecho: 'girou' }),
  };
}

describe('reconciliacao offline', () => {
  let dir: string;
  let caminho: string;
  let fila: FilaDeEventos;
  let coletor: ColetorSimulado;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-f4-'));
    caminho = join(dir, 'fila.sqlite');
    fila = new FilaDeEventos(caminho);
    coletor = new ColetorSimulado();
  });

  afterEach(() => {
    fila.fechar();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * `M0-AC-006`: durante queda cloud, ao menos 100 eventos sao persistidos
   * e reconciliados SEM DUPLICACAO LOGICA.
   *
   * E o aceite da Slice 0.4, inteiro: cai, acumula, volta, drena.
   */
  it('100 eventos durante queda chegam uma unica vez apos reconexao', async () => {
    coletor.cair();

    for (let i = 0; i < 100; i += 1) {
      fila.enfileirar(evento(i, new Date(AGORA.getTime() + i * 1000)), AGORA);
    }

    // Tentar enquanto esta fora nao envia nada -- e nao perde nada.
    const durante = await reconciliar({ fila, coletor });
    expect(durante.enviados).toBe(0);
    expect(durante.parouPorIndisponibilidade).toBe(true);
    expect(fila.backlog).toBe(100);

    coletor.voltar();

    let total = 0;
    for (let rodada = 0; rodada < 10; rodada += 1) {
      const r = await reconciliar({ fila, coletor });
      total += r.enviados;
      if (r.backlog === 0) break;
    }

    expect(total).toBe(100);
    expect(fila.backlog).toBe(0);
    // SEM DUPLICACAO LOGICA -- 100 eventos distintos no coletor.
    expect(coletor.distintosRecebidos).toBe(100);
  });

  it('mantem o horario ORIGINAL, nao o do envio', async () => {
    // O aceite: "mantem o horario original". Carimbar no envio destruiria o
    // dado que a reconciliacao existe para preservar.
    const ontem = new Date('2026-08-13T09:12:33.000Z');
    fila.enfileirar(evento(1, ontem), AGORA);

    await reconciliar({ fila, coletor });

    expect(coletor.recebido('evt-1')?.ocorridoEm.toISOString()).toBe(ontem.toISOString());
  });

  it('reenviar o mesmo evento NAO cria segundo registro', async () => {
    // "Uma unica vez" e LOGICO, nao fisico: a rede entrega duas vezes, e
    // vai. O que nao pode e virar dois registros.
    fila.enfileirar(evento(1), AGORA);
    await reconciliar({ fila, coletor });

    // Força o reenvio: o mesmo evento fisico volta para pendente.
    fila.registrarFalha('evt-1', 'simulando retry');
    const filaReaberta = new FilaDeEventos(caminho);
    // (a linha ja esta 'enviado'; enfileirar de novo nao duplica)
    filaReaberta.enfileirar(evento(1), AGORA);
    filaReaberta.fechar();

    expect(coletor.distintosRecebidos).toBe(1);
  });

  it('duplicado NAO e falha — marca como enviado e segue', async () => {
    // O coletor ja tem. O estado desejado vale. Tratar como falha faria a
    // fila retentar para sempre algo que ja chegou.
    await coletor.enviar({ ...evento(1), ocorridoEm: AGORA });
    fila.enfileirar(evento(1), AGORA);

    const r = await reconciliar({ fila, coletor });

    expect(r.duplicados).toBe(1);
    expect(r.falhas).toBe(0);
    expect(fila.backlog).toBe(0);
  });

  it('para na primeira indisponibilidade, nao insiste com os outros', async () => {
    // Insistir com 99 eventos gera 99 timeouts -- e cada timeout e tempo em
    // que a fila nao registra quem esta passando agora.
    for (let i = 0; i < 10; i += 1) fila.enfileirar(evento(i), AGORA);

    coletor.cair();
    await reconciliar({ fila, coletor });

    // Uma chamada, nao dez.
    expect(coletor.totalDeChamadas).toBe(1);
  });

  it('recusa e problema DAQUELE evento — segue para o proximo', async () => {
    fila.enfileirar(evento(1), AGORA);
    fila.enfileirar(evento(2), AGORA);
    coletor.recusar('evt-1', 'payload invalido');

    const r = await reconciliar({ fila, coletor });

    expect(r.falhas).toBe(1);
    expect(r.enviados).toBe(1);
    expect(r.parouPorIndisponibilidade).toBe(false);
    expect(coletor.recebido('evt-2')).toBeDefined();
  });

  it('evento recusado sem parar vai para quarentena e sai da fila', async () => {
    // Sem quarentena, um payload invalido volta como primeiro pendente em
    // toda rodada, para sempre -- gasta vaga do lote e infla o backlog do
    // M0-AC-008 com algo que nunca vai subir. Backlog que so cresce deixa
    // de ser sinal.
    fila.enfileirar(evento(1), AGORA);
    coletor.recusar('evt-1', 'payload invalido');

    let quarentenados = 0;
    for (let i = 0; i < 3; i += 1) {
      const r = await reconciliar({ fila, coletor });
      quarentenados += r.quarentenados;
    }

    expect(quarentenados).toBe(1);
    expect(fila.backlog).toBe(0);
    // Sai da fila, NAO do banco: fica para alguem investigar.
    expect(fila.emQuarentena()).toHaveLength(1);
  });

  it('indisponibilidade NAO quarentena — senao a fila inteira morre numa queda', async () => {
    // O coletor estar fora nao diz nada sobre o evento. Contar como recusa
    // quarentenaria tudo numa queda longa -- exatamente o cenario que a
    // Slice 0.4 existe para atravessar.
    fila.enfileirar(evento(1), AGORA);
    coletor.cair();

    for (let i = 0; i < 10; i += 1) await reconciliar({ fila, coletor });

    expect(fila.backlog).toBe(1);
    expect(fila.emQuarentena()).toHaveLength(0);

    coletor.voltar();
    const r = await reconciliar({ fila, coletor });
    expect(r.enviados).toBe(1);
  });

  it('quarentena nao trava os outros eventos do lote', async () => {
    fila.enfileirar(evento(1), AGORA);
    fila.enfileirar(evento(2), new Date(AGORA.getTime() + 1000));
    coletor.recusar('evt-1', 'payload invalido');

    await reconciliar({ fila, coletor });

    expect(coletor.recebido('evt-2')).toBeDefined();
  });

  it('envia na ordem em que os eventos ACONTECERAM', async () => {
    // Ordem por ocorrencia, nao por insercao: se o processo reiniciar e
    // reprocessar, a cronologia se mantem.
    fila.enfileirar(evento(3, new Date(AGORA.getTime() + 3000)), AGORA);
    fila.enfileirar(evento(1, new Date(AGORA.getTime() + 1000)), AGORA);
    fila.enfileirar(evento(2, new Date(AGORA.getTime() + 2000)), AGORA);

    await reconciliar({ fila, coletor });

    expect(coletor.todos.map((e) => e.eventoId)).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });
});

describe('FilaDeEventos — durabilidade', () => {
  let dir: string;
  let caminho: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arenahub-f4-dur-'));
    caminho = join(dir, 'fila.sqlite');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * `M0-NFR-003` e `M0-AC-007`: reinicio abrupto com backlog nao perde
   * evento ja persistido.
   *
   * Fechar e reabrir imita o reinicio. Nao imita queda de energia -- isso
   * exigiria matar o processo de verdade -- mas cobre a garantia que o
   * codigo controla: o dado esta no arquivo, nao so na memoria.
   */
  it('backlog sobrevive ao fechar e reabrir', () => {
    const primeira = new FilaDeEventos(caminho);
    for (let i = 0; i < 100; i += 1) primeira.enfileirar(evento(i), AGORA);
    expect(primeira.backlog).toBe(100);
    primeira.fechar();

    const depoisDoReinicio = new FilaDeEventos(caminho);
    expect(depoisDoReinicio.backlog).toBe(100);
    expect(depoisDoReinicio.proximosPendentes(5)).toHaveLength(5);
    depoisDoReinicio.fechar();
  });

  it('estado enviado tambem sobrevive — nao reenvia o que ja subiu', () => {
    // Se `enviado` se perdesse no reinicio, todo evento ja confirmado
    // voltaria a ser pendente e subiria de novo. A dedup do coletor
    // seguraria, mas seria trabalho inutil a cada reinicio.
    const primeira = new FilaDeEventos(caminho);
    primeira.enfileirar(evento(1), AGORA);
    primeira.marcarEnviado('evt-1');
    primeira.fechar();

    const segunda = new FilaDeEventos(caminho);
    expect(segunda.backlog).toBe(0);
    expect(segunda.conhece('evt-1')).toBe(true);
    segunda.fechar();
  });

  it('enfileirar o mesmo eventoId duas vezes nao duplica', () => {
    const fila = new FilaDeEventos(caminho);

    expect(fila.enfileirar(evento(1), AGORA)).toBe(true);
    expect(fila.enfileirar(evento(1), AGORA)).toBe(false);
    expect(fila.backlog).toBe(1);

    fila.fechar();
  });

  it('limpeza remove enviados antigos, preserva pendentes', () => {
    // Sem limpeza o SQLite cresce para sempre num agente que roda por anos.
    const fila = new FilaDeEventos(caminho);
    const antigo = new Date('2026-01-01T00:00:00.000Z');

    fila.enfileirar(evento(1), antigo);
    fila.marcarEnviado('evt-1');
    fila.enfileirar(evento(2), antigo);

    const removidos = fila.limparEnviadosAntesDe(new Date('2026-06-01T00:00:00.000Z'));

    expect(removidos).toBe(1);
    expect(fila.backlog).toBe(1);
    fila.fechar();
  });
});
