import { describe, expect, it } from '@jest/globals';
import type Anthropic from '@anthropic-ai/sdk';

import { escolherOcrReal, escolherProvedorDeIa, permiteProvedorReal } from './anthropic-gate.js';
import { AnthropicAiProviderAdapter } from './anthropic-ai-provider.adapter.js';
import { AnthropicOcrExtractorAdapter } from './anthropic-ocr-extractor.adapter.js';
import { FakeAiProviderAdapter } from './fake-ai-provider.adapter.js';

/**
 * A regra "sem chave (ou em teste) cai para o dublê" (ADR-036) e o unico
 * jeito de um desenvolvedor sem `ANTHROPIC_API_KEY` continuar rodando a API
 * sem gerar numero inventado achando que e real. Testada aqui isolada de
 * Postgres/Redis -- e pura, `HealthModule` so injeta o resultado.
 */
describe('anthropic-gate (fallback para o dublê)', () => {
  const clienteFalso = {} as Anthropic;
  const fake = new FakeAiProviderAdapter();

  describe('permiteProvedorReal', () => {
    it('recusa o ambiente de teste', () => {
      expect(permiteProvedorReal('test')).toBe(false);
    });

    it('permite development e production', () => {
      expect(permiteProvedorReal('development')).toBe(true);
      expect(permiteProvedorReal('production')).toBe(true);
    });
  });

  describe('escolherOcrReal', () => {
    it('cai para o dublê (null) quando nao ha cliente', () => {
      expect(escolherOcrReal(null, 'production')).toBeNull();
    });

    it('cai para o dublê (null) em NODE_ENV=test mesmo com cliente presente', () => {
      // Espelha o `.env` da raiz, que traz ANTHROPIC_API_KEY real e e
      // carregado pelos testes de integracao -- sem esta guarda, rodar teste
      // chamaria a API de verdade.
      expect(escolherOcrReal(clienteFalso, 'test')).toBeNull();
    });

    it('usa o adapter real quando ha cliente e o ambiente permite', () => {
      const resultado = escolherOcrReal(clienteFalso, 'development');

      expect(resultado).toBeInstanceOf(AnthropicOcrExtractorAdapter);
    });
  });

  describe('escolherProvedorDeIa', () => {
    it('devolve o dublê quando nao ha cliente', () => {
      expect(escolherProvedorDeIa(null, 'production', fake)).toBe(fake);
    });

    it('devolve o dublê em NODE_ENV=test mesmo com cliente presente', () => {
      expect(escolherProvedorDeIa(clienteFalso, 'test', fake)).toBe(fake);
    });

    it('devolve o adapter real quando ha cliente e o ambiente permite', () => {
      const resultado = escolherProvedorDeIa(clienteFalso, 'development', fake);

      expect(resultado).toBeInstanceOf(AnthropicAiProviderAdapter);
    });
  });
});
