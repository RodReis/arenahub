import { describe, expect, it, jest } from '@jest/globals';
import type Anthropic from '@anthropic-ai/sdk';

import { ErroDeExtracao } from './document-extractor.port.js';
import { AnthropicOcrExtractorAdapter } from './anthropic-ocr-extractor.adapter.js';

/**
 * Testa o adapter SEM chamar a Anthropic de verdade: o cliente injetado e um
 * stub cujo `messages.create` devolve o texto que o teste controla. Isso e o
 * "dublê da camada HTTP" que a tarefa pede -- nunca um `fetch` real.
 */
function clienteComTexto(texto: string): Anthropic {
  const create = jest.fn(() =>
    Promise.resolve({ content: [{ type: 'text', text: texto }] }),
  );

  return { messages: { create } } as unknown as Anthropic;
}

function pedidoDeImagem(): { conteudo: Uint8Array; tipo: 'PNG' } {
  return { conteudo: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), tipo: 'PNG' };
}

describe('AnthropicOcrExtractorAdapter', () => {
  it('usa o modelo haiku 4.5, sem thinking nem effort (ADR-036)', async () => {
    const client = clienteComTexto(
      JSON.stringify({ measuredAt: null, sourceLabel: null, fields: [] }),
    );
    const adapter = new AnthropicOcrExtractorAdapter(client);

    await expect(adapter.extrair(pedidoDeImagem())).rejects.toBeInstanceOf(ErroDeExtracao);

    const chamada = (client.messages.create as jest.Mock).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(chamada['model']).toBe('claude-haiku-4-5');
    expect(chamada).not.toHaveProperty('thinking');
    expect(chamada).not.toHaveProperty('output_config');
  });

  it('converte campos reconhecidos em CampoProposto', async () => {
    const client = clienteComTexto(
      JSON.stringify({
        measuredAt: null,
        sourceLabel: 'CF610_G',
        fields: [
          { type: 'WEIGHT', value: 88.4, unit: 'kg', confidence: 0.97, sourceLocation: 'linha 2' },
          { type: 'BODY_FAT_PERCENT', value: 24.1, unit: 'percent', confidence: 0.88 },
        ],
      }),
    );
    const adapter = new AnthropicOcrExtractorAdapter(client);

    const resultado = await adapter.extrair(pedidoDeImagem());

    expect(resultado.campos).toHaveLength(2);
    expect(resultado.campos[0]).toMatchObject({ type: 'WEIGHT', value: 88.4, unit: 'kg' });
    expect(resultado.sourceLabel).toBe('CF610_G');
    expect(resultado.tipoDeLaudo).toBe('BIOIMPEDANCE');
    expect(resultado.extractor).toBe('anthropic-ocr@1');
  });

  it('DESCARTA campo cujo type nao esta em TIPOS_DE_MEDIDA -- nunca adivinha', async () => {
    const client = clienteComTexto(
      JSON.stringify({
        measuredAt: null,
        sourceLabel: null,
        fields: [
          { type: 'WEIGHT', value: 88.4, unit: 'kg', confidence: 0.9 },
          // Indice proprietario do fabricante -- nao e TipoDeMedida.
          { type: 'BODY_AGE', value: 32, unit: null, confidence: 0.5 },
          // Nome inventado, nunca deveria acontecer, mas se acontecer e descartado.
          { type: 'ALGO_QUE_NAO_EXISTE', value: 10, unit: null, confidence: 0.5 },
        ],
      }),
    );
    const adapter = new AnthropicOcrExtractorAdapter(client);

    const resultado = await adapter.extrair(pedidoDeImagem());

    expect(resultado.campos).toHaveLength(1);
    expect(resultado.campos[0]?.type).toBe('WEIGHT');
  });

  it('preserva confidence baixa em vez de inventar valor (INV-104)', async () => {
    const client = clienteComTexto(
      JSON.stringify({
        measuredAt: null,
        sourceLabel: null,
        fields: [
          {
            type: 'INTRACELLULAR_WATER',
            value: 3.15,
            unit: 'L',
            confidence: 0.12,
            sourceLocation: 'pagina 2',
          },
        ],
      }),
    );
    const adapter = new AnthropicOcrExtractorAdapter(client);

    const resultado = await adapter.extrair(pedidoDeImagem());

    expect(resultado.campos[0]?.confidence).toBeCloseTo(0.12, 2);
  });

  it('OMITE campo sem "value" -- nunca vira zero (INV-104)', async () => {
    const client = clienteComTexto(
      JSON.stringify({
        measuredAt: null,
        sourceLabel: null,
        fields: [
          { type: 'WEIGHT', value: 88.4, unit: 'kg', confidence: 0.9 },
          { type: 'HEIGHT', unit: 'cm', confidence: 0.3 }, // sem "value": ilegivel
        ],
      }),
    );
    const adapter = new AnthropicOcrExtractorAdapter(client);

    const resultado = await adapter.extrair(pedidoDeImagem());

    expect(resultado.campos).toHaveLength(1);
    expect(resultado.campos.some((c) => c.type === 'HEIGHT')).toBe(false);
  });

  it('extrai o JSON mesmo quando o modelo envolve em crase de markdown', async () => {
    const client = clienteComTexto(
      '```json\n' +
        JSON.stringify({
          measuredAt: null,
          sourceLabel: null,
          fields: [{ type: 'WEIGHT', value: 70, unit: 'kg', confidence: 0.9 }],
        }) +
        '\n```',
    );
    const adapter = new AnthropicOcrExtractorAdapter(client);

    const resultado = await adapter.extrair(pedidoDeImagem());

    expect(resultado.campos).toHaveLength(1);
  });

  it('rejeita tipo de arquivo que nao seja PNG/JPEG', async () => {
    const client = clienteComTexto('{}');
    const adapter = new AnthropicOcrExtractorAdapter(client);

    await expect(
      adapter.extrair({ conteudo: new Uint8Array(), tipo: 'CSV' }),
    ).rejects.toMatchObject({ codigo: 'EXTRACTOR_UNSUPPORTED_TYPE' });
  });

  it('lanca ErroDeExtracao quando nenhum campo e reconhecivel', async () => {
    const client = clienteComTexto(
      JSON.stringify({ measuredAt: null, sourceLabel: null, fields: [] }),
    );
    const adapter = new AnthropicOcrExtractorAdapter(client);

    await expect(adapter.extrair(pedidoDeImagem())).rejects.toMatchObject({
      codigo: 'EXTRACTOR_NO_CONTENT',
    });
  });

  it('lanca ErroDeExtracao quando a resposta nao e JSON valido', async () => {
    const client = clienteComTexto('isto nao e json');
    const adapter = new AnthropicOcrExtractorAdapter(client);

    await expect(adapter.extrair(pedidoDeImagem())).rejects.toMatchObject({
      codigo: 'EXTRACTOR_NO_CONTENT',
    });
  });
});
