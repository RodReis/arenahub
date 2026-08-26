import { describe, expect, it } from '@jest/globals';

import type { ComparativoDeTipo } from '../../health/health-progress.service.js';
import {
  METRICAS_DO_TOTEM,
  agruparSegmentos,
  resumirMetricas,
} from './avaliacao-do-totem.js';

function tipo(over: {
  type: string;
  unidade?: string | null;
  atual?: { id: string; valor: number } | null;
  pontos?: readonly { id: string; valor: number }[];
  delta?: { absoluta: number | null; razao: string | null };
}): ComparativoDeTipo {
  const ponto = (p: { id: string; valor: number }) => ({
    id: p.id,
    assessedAt: new Date('2026-08-01T00:00:00.000Z'),
    valor: p.valor,
  });

  return {
    type: over.type,
    unidade: over.unidade ?? 'KG',
    comparativo: {
      pontos: (over.pontos ?? []).map(ponto),
      primeira: null,
      anterior: null,
      atual: over.atual ? ponto(over.atual) : null,
      desdeAPrimeira: { absoluta: null, percentual: null, deId: null, paraId: null, razao: null },
      desdeAAnterior: {
        absoluta: over.delta?.absoluta ?? null,
        percentual: null,
        deId: null,
        paraId: null,
        razao: over.delta?.razao ?? null,
      },
      ateAMeta: { absoluta: null, percentual: null, deId: null, paraId: null, razao: null },
    },
    meta: null,
  } as ComparativoDeTipo;
}

describe('METRICAS_DO_TOTEM', () => {
  it('são as seis do DS-TOTEM §5.3, nesta ordem', () => {
    expect(METRICAS_DO_TOTEM).toEqual([
      'WEIGHT',
      'BODY_FAT_PERCENT',
      'SKELETAL_MUSCLE_MASS',
      'TOTAL_BODY_WATER',
      'VISCERAL_FAT_LEVEL',
      'BASAL_METABOLIC_RATE',
    ]);
  });

  it('NÃO inclui frequência cardíaca — dado cardíaco nunca é interpretado', () => {
    // ADR-035. O `BodyEvolutionService` ja filtra `HEART_RATE` das metricas;
    // este teste impede que ele volte por esta porta.
    expect(METRICAS_DO_TOTEM).not.toContain('HEART_RATE');
  });
});

describe('resumirMetricas', () => {
  it('devolve as seis mesmo quando o aparelho não mediu nenhuma', () => {
    const metricas = resumirMetricas([], METRICAS_DO_TOTEM);

    expect(metricas).toHaveLength(6);
    expect(metricas.every((m) => m.valor === null)).toBe(true);
  });

  it('não some com tipo não medido — devolve valor nulo na posição dele', () => {
    // Some-lo faria a grade mudar de tamanho conforme o aparelho, e "nao
    // medimos isso" viraria indistinguivel de "esta metrica nao existe".
    const metricas = resumirMetricas(
      [tipo({ type: 'WEIGHT', atual: { id: 'a1', valor: 82.4 } })],
      METRICAS_DO_TOTEM,
    );

    expect(metricas.map((m) => m.tipo)).toEqual(METRICAS_DO_TOTEM);
    expect(metricas[0]?.valor).toBe(82.4);
    expect(metricas[1]?.valor).toBeNull();
  });

  it('traz o delta contra a medição anterior', () => {
    const metricas = resumirMetricas(
      [tipo({ type: 'WEIGHT', atual: { id: 'a2', valor: 80 }, delta: { absoluta: -2.4, razao: null } })],
      ['WEIGHT'],
    );

    expect(metricas[0]?.deltaAbsoluto).toBe(-2.4);
  });

  it('distingue "primeira medição" de "não mudou"', () => {
    // `SEM_BASELINE` com delta nulo, nunca zero: zero leria como se o aluno
    // tivesse medido duas vezes o mesmo numero.
    const metricas = resumirMetricas(
      [
        tipo({
          type: 'WEIGHT',
          atual: { id: 'a1', valor: 82 },
          delta: { absoluta: null, razao: 'SEM_BASELINE' },
        }),
      ],
      ['WEIGHT'],
    );

    expect(metricas[0]?.deltaAbsoluto).toBeNull();
    expect(metricas[0]?.razaoDaAusencia).toBe('SEM_BASELINE');
  });

  it('com assessmentId, devolve o valor daquela avaliação e NUNCA o delta', () => {
    // O delta compara os dois ULTIMOS pontos. Devolve-lo ao lado do valor de
    // uma avaliacao antiga casaria o numero de marco com a variacao de agosto.
    const metricas = resumirMetricas(
      [
        tipo({
          type: 'WEIGHT',
          atual: { id: 'agosto', valor: 80 },
          pontos: [
            { id: 'marco', valor: 88 },
            { id: 'agosto', valor: 80 },
          ],
          delta: { absoluta: -2.4, razao: null },
        }),
      ],
      ['WEIGHT'],
      'marco',
    );

    expect(metricas[0]?.valor).toBe(88);
    expect(metricas[0]?.deltaAbsoluto).toBeNull();
  });

  it('devolve valor nulo quando o assessmentId não está na série do tipo', () => {
    const metricas = resumirMetricas(
      [tipo({ type: 'WEIGHT', pontos: [{ id: 'marco', valor: 88 }] })],
      ['WEIGHT'],
      'julho',
    );

    expect(metricas[0]?.valor).toBeNull();
  });
});

describe('agruparSegmentos', () => {
  it('devolve as três linhas mesmo sem medida segmentar nenhuma', () => {
    const segmentos = agruparSegmentos([]);

    expect(segmentos.map((s) => s.segmento)).toEqual(['ARMS', 'TRUNK', 'LEGS']);
    expect(segmentos.every((s) => s.gorduraKg === null && s.musculoKg === null)).toBe(true);
  });

  it('soma braço esquerdo e direito numa linha só', () => {
    const segmentos = agruparSegmentos([
      { type: 'SEGMENTAL_FAT_MASS_ARM_LEFT', canonicalValue: 0.6 },
      { type: 'SEGMENTAL_FAT_MASS_ARM_RIGHT', canonicalValue: 0.7 },
      { type: 'SEGMENTAL_MUSCLE_MASS_ARM_LEFT', canonicalValue: 1.9 },
      { type: 'SEGMENTAL_MUSCLE_MASS_ARM_RIGHT', canonicalValue: 1.9 },
    ]);

    const bracos = segmentos.find((s) => s.segmento === 'ARMS');

    expect(bracos?.gorduraKg).toBeCloseTo(1.3);
    expect(bracos?.musculoKg).toBeCloseTo(3.8);
  });

  it('soma as duas pernas e mantém o tronco sozinho', () => {
    const segmentos = agruparSegmentos([
      { type: 'SEGMENTAL_FAT_MASS_LEG_LEFT', canonicalValue: 1.5 },
      { type: 'SEGMENTAL_FAT_MASS_LEG_RIGHT', canonicalValue: 1.5 },
      { type: 'SEGMENTAL_FAT_MASS_TRUNK', canonicalValue: 11.6 },
    ]);

    expect(segmentos.find((s) => s.segmento === 'LEGS')?.gorduraKg).toBeCloseTo(3.0);
    expect(segmentos.find((s) => s.segmento === 'TRUNK')?.gorduraKg).toBeCloseTo(11.6);
  });

  it('ausência NÃO vira zero', () => {
    // Zero desenharia uma barra vazia que le como "nao ha gordura ali" --
    // afirmacao clinica que ninguem fez (INV-104).
    const segmentos = agruparSegmentos([
      { type: 'SEGMENTAL_FAT_MASS_TRUNK', canonicalValue: 11.6 },
    ]);

    expect(segmentos.find((s) => s.segmento === 'ARMS')?.gorduraKg).toBeNull();
    expect(segmentos.find((s) => s.segmento === 'TRUNK')?.musculoKg).toBeNull();
  });

  it('soma o lado medido quando só um dos dois veio', () => {
    const segmentos = agruparSegmentos([
      { type: 'SEGMENTAL_FAT_MASS_ARM_LEFT', canonicalValue: 0.6 },
    ]);

    expect(segmentos.find((s) => s.segmento === 'ARMS')?.gorduraKg).toBeCloseTo(0.6);
  });

  it('ignora medida não segmentar', () => {
    const segmentos = agruparSegmentos([
      { type: 'WEIGHT', canonicalValue: 82.4 },
      { type: 'HEART_RATE', canonicalValue: 71 },
    ]);

    expect(segmentos.every((s) => s.gorduraKg === null && s.musculoKg === null)).toBe(true);
  });

  it('ignora valor não numérico em vez de virar NaN na tela', () => {
    const segmentos = agruparSegmentos([
      { type: 'SEGMENTAL_FAT_MASS_TRUNK', canonicalValue: 'muito' },
    ]);

    expect(segmentos.find((s) => s.segmento === 'TRUNK')?.gorduraKg).toBeNull();
  });

  it('aceita Decimal do Prisma, que chega como objeto', () => {
    // `canonicalValue` e `Decimal(10,4)` -- `Number()` sobre o objeto do
    // Prisma funciona por `toString`, e e assim que o valor real chega.
    const segmentos = agruparSegmentos([
      { type: 'SEGMENTAL_FAT_MASS_TRUNK', canonicalValue: { toString: () => '11.6000' } },
    ]);

    expect(segmentos.find((s) => s.segmento === 'TRUNK')?.gorduraKg).toBeCloseTo(11.6);
  });
});
