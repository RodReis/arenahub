import type Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';

import { AnthropicAiProviderAdapter } from './anthropic-ai-provider.adapter.js';
import { AnthropicOcrExtractorAdapter } from './anthropic-ocr-extractor.adapter.js';
import type { AiProvider } from './ai-provider.port.js';
import type { DocumentExtractor } from './document-extractor.port.js';
import type { FakeAiProviderAdapter } from './fake-ai-provider.adapter.js';

const log = new Logger('HealthModule');

/**
 * `NODE_ENV=test` NUNCA chama o provedor real, mesmo com chave presente no
 * ambiente (o `.env` da raiz -- carregado pelos testes de integracao -- traz
 * uma chave de verdade). Sem esta guarda, rodar `test:integration` gastaria
 * dinheiro de producao e violaria a exigencia explicita da tarefa de nunca
 * chamar a API real em teste.
 *
 * Funcao pura e exportada de proposito: e o unico lugar que decide "real ou
 * dublê" (ADR-036), e o teste desta regra nao deveria precisar subir o
 * `HealthModule` inteiro com Postgres e Redis por tras.
 */
export function permiteProvedorReal(ambiente: string): boolean {
  return ambiente !== 'test';
}

/**
 * Escolhe o OCR de imagem: real (ADR-036) quando ha cliente E o ambiente
 * permite; dublê nos demais casos. Loga UMA vez, no arranque, para o
 * desenvolvedor sem chave saber que esta rodando sobre dado fabricado --
 * nunca descobrir isso lendo um numero na tela achando que e real.
 */
export function escolherOcrReal(
  client: Anthropic | null,
  ambiente: string,
): DocumentExtractor | null {
  if (client === null || !permiteProvedorReal(ambiente)) {
    log.warn(
      'ANTHROPIC_API_KEY ausente (ou NODE_ENV=test): OCR de imagem cai para o dublê ' +
        '(FakeOcrExtractorAdapter). Numeros extraidos de PNG/JPEG NAO sao reais.',
    );

    return null;
  }

  return new AnthropicOcrExtractorAdapter(client);
}

/** Mesma regra do OCR, para o provedor de analise assistiva. */
export function escolherProvedorDeIa(
  client: Anthropic | null,
  ambiente: string,
  fake: FakeAiProviderAdapter,
): AiProvider {
  if (client === null || !permiteProvedorReal(ambiente)) {
    return fake;
  }

  return new AnthropicAiProviderAdapter(client);
}
