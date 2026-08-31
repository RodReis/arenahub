import { describe, expect, it } from '@jest/globals';

import {
  CAPACIDADE_PADRAO,
  COOLDOWN_PADRAO_EM_DIAS,
  SLA_PADRAO_EM_DIAS_UTEIS,
  selecionarFila,
  venceEm,
  type CandidatoAFila,
} from './selecao-de-fila.js';

const candidato = (parcial: Partial<CandidatoAFila> = {}): CandidatoAFila => ({
  studentId: 'e1',
  scoreId: 'sc1',
  valor: 60,
  faixa: 'ALTO',
  temTarefaAtiva: false,
  ultimaTarefaEm: null,
  ...parcial,
});

const agora = new Date('2026-09-10T09:00:00.000Z');

describe('selecionarFila', () => {
  it('ordena por risco e corta na capacidade -- M6-BR-005', () => {
    const candidatos = [
      candidato({ studentId: 'a', valor: 30 }),
      candidato({ studentId: 'b', valor: 90 }),
      candidato({ studentId: 'c', valor: 60 }),
    ];

    const fila = selecionarFila(candidatos, { capacidade: 2, cooldownEmDias: 14, agora });

    expect(fila.map((c) => c.studentId)).toEqual(['b', 'c']);
  });

  it('desempata por studentId para ser deterministico', () => {
    const candidatos = [
      candidato({ studentId: 'z', valor: 50 }),
      candidato({ studentId: 'a', valor: 50 }),
    ];

    const fila = selecionarFila(candidatos, { capacidade: 5, cooldownEmDias: 14, agora });

    expect(fila.map((c) => c.studentId)).toEqual(['a', 'z']);
  });

  it('nao cria segunda tarefa para quem ja tem uma ativa -- M6-FR-007', () => {
    const candidatos = [
      candidato({ studentId: 'a', valor: 90, temTarefaAtiva: true }),
      candidato({ studentId: 'b', valor: 50 }),
    ];

    const fila = selecionarFila(candidatos, { capacidade: 5, cooldownEmDias: 14, agora });

    expect(fila.map((c) => c.studentId)).toEqual(['b']);
  });

  it('suprime quem esta dentro do cooldown -- M6-BR-004', () => {
    const dentro = candidato({
      studentId: 'a',
      valor: 90,
      ultimaTarefaEm: new Date('2026-09-01T09:00:00.000Z'),
    });

    const fila = selecionarFila([dentro], { capacidade: 5, cooldownEmDias: 14, agora });

    expect(fila).toEqual([]);
  });

  it('libera quem saiu do cooldown', () => {
    const fora = candidato({
      studentId: 'a',
      valor: 90,
      ultimaTarefaEm: new Date('2026-08-20T09:00:00.000Z'),
    });

    const fila = selecionarFila([fora], { capacidade: 5, cooldownEmDias: 14, agora });

    expect(fila.map((c) => c.studentId)).toEqual(['a']);
  });

  it('trata a borda do cooldown como liberada -- 14 dias completos', () => {
    const naBorda = candidato({
      studentId: 'a',
      ultimaTarefaEm: new Date('2026-08-27T09:00:00.000Z'),
    });

    expect(selecionarFila([naBorda], { capacidade: 5, cooldownEmDias: 14, agora })).toHaveLength(
      1,
    );
  });

  it('mantem suprimido um dia antes da borda', () => {
    const quase = candidato({
      studentId: 'a',
      ultimaTarefaEm: new Date('2026-08-28T09:00:00.000Z'),
    });

    expect(selecionarFila([quase], { capacidade: 5, cooldownEmDias: 14, agora })).toEqual([]);
  });

  it('nao carrega capacidade nao usada para um backlog infinito', () => {
    const candidatos = Array.from({ length: 100 }, (_, i) =>
      candidato({ studentId: `e${i}`, valor: 90 - i }),
    );

    expect(selecionarFila(candidatos, { capacidade: 20, cooldownEmDias: 14, agora })).toHaveLength(
      20,
    );
  });

  it('devolve vazio quando a capacidade e zero', () => {
    expect(selecionarFila([candidato()], { capacidade: 0, cooldownEmDias: 14, agora })).toEqual(
      [],
    );
  });

  it('e deterministico para a mesma entrada', () => {
    const candidatos = [candidato({ studentId: 'a' }), candidato({ studentId: 'b', valor: 70 })];
    const opcoes = { capacidade: 5, cooldownEmDias: 14, agora };

    expect(selecionarFila(candidatos, opcoes)).toEqual(selecionarFila(candidatos, opcoes));
  });

  it('tem padroes que batem com a decisao do PI de 31/08/2026', () => {
    expect(CAPACIDADE_PADRAO).toBe(20);
    expect(COOLDOWN_PADRAO_EM_DIAS).toBe(14);
    expect(SLA_PADRAO_EM_DIAS_UTEIS).toBe(3);
  });
});

describe('venceEm', () => {
  it('pula o fim de semana ao contar dias uteis', () => {
    // Quinta 10/09/2026 + 3 uteis = terca 15/09 (sex, seg, ter).
    expect(venceEm(new Date('2026-09-10T09:00:00.000Z'), 3)).toEqual(
      new Date('2026-09-15T09:00:00.000Z'),
    );
  });

  it('conta dentro da semana quando nao ha fim de semana no caminho', () => {
    // Segunda 07/09 + 3 uteis = quinta 10/09.
    expect(venceEm(new Date('2026-09-07T09:00:00.000Z'), 3)).toEqual(
      new Date('2026-09-10T09:00:00.000Z'),
    );
  });

  it('parte de sabado para a proxima semana util', () => {
    // Sabado 12/09 + 1 util = segunda 14/09.
    expect(venceEm(new Date('2026-09-12T09:00:00.000Z'), 1)).toEqual(
      new Date('2026-09-14T09:00:00.000Z'),
    );
  });

  it('devolve o proprio instante quando o prazo e zero', () => {
    const inicio = new Date('2026-09-10T09:00:00.000Z');

    expect(venceEm(inicio, 0)).toEqual(inicio);
  });
});
