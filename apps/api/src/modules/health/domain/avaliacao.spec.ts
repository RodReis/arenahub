import { describe, expect, it } from '@jest/globals';

import {
  AvaliacaoImutavelError,
  AvaliacaoSemMedidaError,
  CorrecaoDeRascunhoError,
  correcaoPermitida,
  podeEditar,
  publicar,
} from './avaliacao.js';

const AGORA = new Date('2026-08-20T13:00:00.000Z');

/**
 * INV-102: avaliacao publicada e IMUTAVEL. O teste que importa nao e
 * "publica com sucesso" -- e que toda porta de escrita fecha depois disso.
 */
describe('podeEditar', () => {
  it('permite editar rascunho', () => {
    expect(podeEditar({ status: 'DRAFT', publishedAt: null })).toBe(true);
  });

  it('recusa editar publicada (INV-102)', () => {
    expect(podeEditar({ status: 'PUBLISHED', publishedAt: AGORA })).toBe(false);
  });
});

describe('publicar', () => {
  it('publica rascunho com medida, carimbando o instante recebido', () => {
    const publicada = publicar({ status: 'DRAFT', publishedAt: null }, 1, AGORA);

    expect(publicada.status).toBe('PUBLISHED');
    expect(publicada.publishedAt).toBe(AGORA);
  });

  it('recusa publicar avaliacao vazia', () => {
    // Avaliacao sem nenhuma medida publicada viraria linha no historico sem
    // nada para comparar -- e o grafico teria um ponto que nao mede nada.
    expect(() => publicar({ status: 'DRAFT', publishedAt: null }, 0, AGORA)).toThrow(
      AvaliacaoSemMedidaError,
    );
  });

  it('recusa publicar duas vezes -- publicar de novo moveria published_at (INV-102)', () => {
    expect(() => publicar({ status: 'PUBLISHED', publishedAt: AGORA }, 3, AGORA)).toThrow(
      AvaliacaoImutavelError,
    );
  });
});

/**
 * INV-102, segunda metade: corrigir NAO sobrescreve. A correcao so existe
 * contra o que ja e oficial.
 */
describe('correcaoPermitida', () => {
  it('permite corrigir avaliacao publicada', () => {
    expect(() =>
      correcaoPermitida({ status: 'PUBLISHED', publishedAt: AGORA }, null),
    ).not.toThrow();
  });

  it('recusa corrigir rascunho -- rascunho se edita, nao se corrige', () => {
    expect(() => correcaoPermitida({ status: 'DRAFT', publishedAt: null }, null)).toThrow(
      CorrecaoDeRascunhoError,
    );
  });

  it('recusa corrigir avaliacao que ja foi corrigida', () => {
    // Duas correcoes da mesma avaliacao produziriam dois "valores certos"
    // para a mesma medicao, sem criterio de desempate. A segunda corrige a
    // correcao, nao o original.
    expect(() =>
      correcaoPermitida({ status: 'PUBLISHED', publishedAt: AGORA }, 'id-da-correcao'),
    ).toThrow(AvaliacaoImutavelError);
  });
});
