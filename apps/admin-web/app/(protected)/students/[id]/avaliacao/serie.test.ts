import { describe, expect, it } from 'vitest';

import { medidasPorTipo, serieDoHistorico, type AvaliacaoDaApi } from './serie';

function avaliacao(extras: Partial<AvaliacaoDaApi> & { id: string }): AvaliacaoDaApi {
  return {
    status: 'PUBLISHED',
    assessedAt: '2026-09-22T12:00:00.000Z',
    notes: null,
    supersedesAssessmentId: null,
    measurements: [],
    ...extras,
  };
}

describe('série do histórico', () => {
  it('correção publicada substitui a original na série (INV-102)', () => {
    const serie = serieDoHistorico([
      avaliacao({ id: 'original' }),
      avaliacao({ id: 'correcao', supersedesAssessmentId: 'original' }),
    ]);

    expect(serie.map((a) => a.id)).toEqual(['correcao']);
  });

  it('correção em rascunho ainda não substitui nada', () => {
    const serie = serieDoHistorico([
      avaliacao({ id: 'original' }),
      avaliacao({ id: 'correcao', status: 'DRAFT', supersedesAssessmentId: 'original' }),
    ]);

    expect(serie.map((a) => a.id)).toEqual(['original']);
  });

  it('ordena da mais antiga para a mais recente e deixa rascunho de fora', () => {
    const serie = serieDoHistorico([
      avaliacao({ id: 'out', assessedAt: '2026-10-22T12:00:00.000Z' }),
      avaliacao({ id: 'set', assessedAt: '2026-09-22T12:00:00.000Z' }),
      avaliacao({ id: 'rascunho', status: 'DRAFT' }),
    ]);

    expect(serie.map((a) => a.id)).toEqual(['set', 'out']);
  });

  it('lê o valor canônico, não o digitado em outra unidade', () => {
    // Altura gravada como 1,75 m: o canônico é 175 cm.
    const medidas = medidasPorTipo(
      avaliacao({ id: 'a', measurements: [{ type: 'HEIGHT', canonicalValue: 175 }] }),
    );

    expect(medidas).toEqual({ HEIGHT: 175 });
  });
});
