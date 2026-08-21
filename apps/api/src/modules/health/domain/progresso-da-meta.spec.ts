import { describe, expect, it } from '@jest/globals';

import { calcularProgresso, type MetaParaProgresso } from './progresso-da-meta.js';

const AGORA = new Date('2026-08-21T12:00:00Z');
const PRAZO_FUTURO = new Date('2026-12-31T00:00:00Z');
const PRAZO_PASSADO = new Date('2026-07-01T00:00:00Z');

function meta(sobrescreve: Partial<MetaParaProgresso> = {}): MetaParaProgresso {
  return {
    baseline: 100,
    alvo: 90,
    prazo: PRAZO_FUTURO,
    achievedAt: null,
    ...sobrescreve,
  };
}

describe('calcularProgresso -- meta de REDUZIR (alvo abaixo da baseline)', () => {
  it('metade do caminho andado e fracao 0,5', () => {
    const r = calcularProgresso(meta(), 95, AGORA);

    expect(r.fracao).toBe(0.5);
    expect(r.estado).toBe('EM_PROGRESSO');
  });

  it('chegar no alvo e ATINGIDA', () => {
    expect(calcularProgresso(meta(), 90, AGORA).estado).toBe('ATINGIDA');
  });

  /**
   * Passar do alvo NAO trunca em 1. Truncar esconderia que o aluno foi alem
   * do combinado -- informacao que o avaliador usa para renegociar a meta.
   */
  it('superar o alvo passa de 1 em vez de truncar', () => {
    const r = calcularProgresso(meta(), 85, AGORA);

    expect(r.fracao).toBe(1.5);
    expect(r.estado).toBe('ATINGIDA');
  });

  it('mover-se na direcao oposta produz fracao NEGATIVA', () => {
    const r = calcularProgresso(meta(), 105, AGORA);

    // Truncar em 0 diria "nao saiu do lugar", que e falso e mais confortavel
    // do que o fato -- exatamente o tipo de arredondamento que engana.
    expect(r.fracao).toBe(-0.5);
    expect(r.estado).toBe('AFASTOU');
  });
});

describe('calcularProgresso -- meta de AUMENTAR (alvo acima da baseline)', () => {
  const ganhar = meta({ baseline: 60, alvo: 70 });

  /**
   * O mesmo calculo serve as duas direcoes porque a divisao normaliza o sinal.
   * E por isso que o modelo NAO tem campo de direcao: ele seria redundante e
   * poderia contradizer os numeros.
   */
  it('usa o mesmo calculo, sem campo de direcao', () => {
    expect(calcularProgresso(ganhar, 65, AGORA).fracao).toBe(0.5);
    expect(calcularProgresso(ganhar, 70, AGORA).estado).toBe('ATINGIDA');
  });

  it('perder massa numa meta de ganhar e AFASTOU', () => {
    const r = calcularProgresso(ganhar, 55, AGORA);

    expect(r.fracao).toBe(-0.5);
    expect(r.estado).toBe('AFASTOU');
  });
});

describe('calcularProgresso -- ausencia nao e zero (INV-104)', () => {
  it('sem medicao devolve fracao null, e nao 0', () => {
    const r = calcularProgresso(meta(), null, AGORA);

    // Zero afirmaria "mediu e nao saiu do lugar". Null diz "ainda nao mediu",
    // que e o caso comum logo apos cadastrar a meta.
    expect(r.fracao).toBeNull();
    expect(r.estado).toBe('SEM_MEDICAO');
    expect(r.atual).toBeNull();
  });

  it('alvo igual a baseline nao vira 100% nem Infinity', () => {
    const manter = meta({ baseline: 80, alvo: 80 });
    const r = calcularProgresso(manter, 82, AGORA);

    // Dividir por zero daria Infinity; chamar de "100% atingida" afirmaria um
    // esforco que ninguem fez.
    expect(r.fracao).toBeNull();
    expect(r.estado).toBe('SEM_DISTANCIA');
  });

  it('meta de manter cumprida na mosca conta como atingida', () => {
    const manter = meta({ baseline: 80, alvo: 80 });

    expect(calcularProgresso(manter, 80, AGORA).estado).toBe('ATINGIDA');
  });
});

describe('calcularProgresso -- prazo', () => {
  it('conta os dias que faltam', () => {
    const r = calcularProgresso(meta({ prazo: new Date('2026-08-31T12:00:00Z') }), 95, AGORA);

    expect(r.diasAteOPrazo).toBe(10);
    expect(r.vencida).toBe(false);
  });

  it('prazo passado sem atingir marca vencida', () => {
    const r = calcularProgresso(meta({ prazo: PRAZO_PASSADO }), 95, AGORA);

    expect(r.diasAteOPrazo).toBeLessThan(0);
    expect(r.vencida).toBe(true);
  });

  /**
   * Bater a meta antes do prazo e depois deixar o prazo passar NAO e falhar.
   * Sem esta distincao, toda meta antiga bem-sucedida apareceria como vencida.
   */
  it('prazo passado COM meta atingida nao e vencida', () => {
    const r = calcularProgresso(meta({ prazo: PRAZO_PASSADO }), 90, AGORA);

    expect(r.vencida).toBe(false);
    expect(r.estado).toBe('ATINGIDA');
  });

  it('meta vencida continua mostrando o quanto foi andado', () => {
    const r = calcularProgresso(meta({ prazo: PRAZO_PASSADO }), 95, AGORA);

    // Campo em branco tiraria do avaliador a conversa "faltaram 5".
    expect(r.fracao).toBe(0.5);
  });

  /**
   * `trunc` e nao `floor`: `floor(-0,5)` daria -1 e transformaria "vence hoje
   * mais tarde" em "venceu ontem".
   */
  it('vencer hoje mais tarde e zero dia, nao menos um', () => {
    const hojeMaisTarde = new Date('2026-08-21T23:00:00Z');
    const r = calcularProgresso(meta({ prazo: hojeMaisTarde }), 95, AGORA);

    expect(r.diasAteOPrazo).toBe(0);
    expect(r.vencida).toBe(false);
  });
});

describe('calcularProgresso -- a baseline e congelada', () => {
  /**
   * A baseline vem da meta, NUNCA de uma releitura da avaliacao original. Se
   * uma correcao (INV-102) mudasse o ponto de partida, o percentual de hoje
   * mudaria sozinho e a meta passaria a significar outra coisa
   * retroativamente. Aqui isso e estrutural: a funcao nao tem como consultar
   * medicao nenhuma -- so recebe numeros.
   */
  it('devolve a baseline que a meta carrega, sem recalcular', () => {
    const r = calcularProgresso(meta({ baseline: 100 }), 95, AGORA);

    expect(r.baseline).toBe(100);
    expect(r.alvo).toBe(90);
  });

  it('duas metas com a mesma medicao atual e baselines diferentes divergem', () => {
    const partiuDe100 = calcularProgresso(meta({ baseline: 100, alvo: 90 }), 95, AGORA);
    const partiuDe96 = calcularProgresso(meta({ baseline: 96, alvo: 90 }), 95, AGORA);

    // O mesmo "95 kg" e metade do caminho para um e um sexto para o outro. E
    // exatamente o que o `ateAMeta` da F18 (que so faz `alvo - atual`) nao
    // consegue distinguir, e a razao desta fatia existir.
    expect(partiuDe100.fracao).toBe(0.5);
    expect(partiuDe96.fracao).toBe(0.1667);
  });
});
