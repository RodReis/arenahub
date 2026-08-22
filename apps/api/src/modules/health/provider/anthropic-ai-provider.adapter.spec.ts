import { describe, expect, it, jest } from '@jest/globals';
import type Anthropic from '@anthropic-ai/sdk';

import { AnthropicAiProviderAdapter } from './anthropic-ai-provider.adapter.js';
import { ErroDaIa } from './ai-provider.port.js';
import type { SnapshotDeAnalise } from '../domain/snapshot-de-analise.js';

function clienteComResposta(
  texto: string,
  usage: { input_tokens: number; output_tokens: number },
): Anthropic {
  const create = jest.fn(() =>
    Promise.resolve({
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: texto }],
      usage,
    }),
  );

  return { messages: { create } } as unknown as Anthropic;
}

const snapshotMinimo = { analysisRef: 'an_teste' } as unknown as SnapshotDeAnalise;

describe('AnthropicAiProviderAdapter', () => {
  it('usa thinking adaptativo, sem budget_tokens (ADR-036)', async () => {
    const client = clienteComResposta('{"summary":"ok"}', { input_tokens: 100, output_tokens: 50 });
    const adapter = new AnthropicAiProviderAdapter(client);

    await adapter.analisar({ snapshot: snapshotMinimo, prompt: 'prompt', promptName: 'p@1' });

    const chamada = (client.messages.create as jest.Mock).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(chamada['model']).toBe('claude-sonnet-4-6');
    expect(chamada['thinking']).toEqual({ type: 'adaptive' });
    expect(chamada['thinking']).not.toHaveProperty('budget_tokens');
  });

  it('devolve o JSON bruto sem validar -- validacao e do dominio', async () => {
    const client = clienteComResposta(
      '{"summary":"resumo","progress":[]}',
      { input_tokens: 100, output_tokens: 50 },
    );
    const adapter = new AnthropicAiProviderAdapter(client);

    const resposta = await adapter.analisar({
      snapshot: snapshotMinimo,
      prompt: 'prompt',
      promptName: 'p@1',
    });

    expect(resposta.bruta).toEqual({ summary: 'resumo', progress: [] });
  });

  it('inclui tokens de thinking no custo -- output_tokens ja vem somado da API', async () => {
    const client = clienteComResposta('{}', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    const adapter = new AnthropicAiProviderAdapter(client);

    const resposta = await adapter.analisar({
      snapshot: snapshotMinimo,
      prompt: 'prompt',
      promptName: 'p@1',
    });

    // 1M tokens de entrada a US$3/milhao + 1M de saida a US$15/milhao =
    // US$18 = 1_800_000 milesimos de centavo.
    expect(resposta.costMicros).toBe(1_800_000);
    expect(resposta.inputTokens).toBe(1_000_000);
    expect(resposta.outputTokens).toBe(1_000_000);
  });

  it('lanca ErroDaIa quando a resposta nao e JSON valido', async () => {
    const client = clienteComResposta('nao e json', { input_tokens: 10, output_tokens: 10 });
    const adapter = new AnthropicAiProviderAdapter(client);

    await expect(
      adapter.analisar({ snapshot: snapshotMinimo, prompt: 'prompt', promptName: 'p@1' }),
    ).rejects.toBeInstanceOf(ErroDaIa);
  });

  it('traduz erro de rate limit em AI_PROVIDER_TIMEOUT recuperavel', async () => {
    const AnthropicModule = await import('@anthropic-ai/sdk');
    const erroDeLimite = Object.create(AnthropicModule.default.RateLimitError.prototype) as Error;

    const create = jest.fn(() => Promise.reject(erroDeLimite));

    const client = { messages: { create } } as unknown as Anthropic;
    const adapter = new AnthropicAiProviderAdapter(client);

    await expect(
      adapter.analisar({ snapshot: snapshotMinimo, prompt: 'prompt', promptName: 'p@1' }),
    ).rejects.toMatchObject({ codigo: 'AI_PROVIDER_TIMEOUT', recuperavel: true });
  });
});
