import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';

import {
  ErroDaIa,
  type AiProvider,
  type PedidoDeAnalise,
  type RespostaDaIa,
} from './ai-provider.port.js';

/**
 * Analise assistiva de verdade, via Anthropic (ADR-036 decisao 1 e 3).
 *
 * ---------------------------------------------------------------------------
 * MODELO: `claude-sonnet-4-6`, COM `thinking: {type: 'adaptive'}`.
 * ---------------------------------------------------------------------------
 *
 * Nota de implementacao do ADR-036: sonnet 4.6 usa thinking ADAPTATIVO;
 * `budget_tokens` esta DEPRECIADO nele e nao deve entrar em codigo novo. Este
 * adapter nunca envia `budget_tokens`.
 *
 * Token de *thinking* e cobrado como SAIDA (mesma nota do ADR): `costMicros`
 * soma `output_tokens`, que ja INCLUI o thinking -- a API da Anthropic conta
 * os dois juntos em `usage.output_tokens`, entao nao ha soma separada a fazer
 * aqui; o risco que a nota descreve e o de UM CALCULO PARALELO ignorar essa
 * inclusao, e este adapter nao faz calculo paralelo nenhum.
 *
 * ---------------------------------------------------------------------------
 * ESTRUTURA GARANTIDA POR `output_config.format` (structured outputs).
 * ---------------------------------------------------------------------------
 *
 * O schema vem no pedido e a API devolve JSON que o cumpre -- nada de pedir
 * "SOMENTE JSON" na prosa nem garimpar `{...}` no texto. Resposta cortada
 * (`max_tokens`) ou recusada (`refusal`) nao cumpre o schema: vira erro com a
 * causa nomeada, antes do parse.
 *
 * ---------------------------------------------------------------------------
 * A SAIDA E `unknown` ATE `validarSaida` (fronteira do dominio).
 * ---------------------------------------------------------------------------
 *
 * Este adapter SO faz o parse de JSON e devolve em `bruta`. Toda a regra de
 * negocio -- rejeitar diagnostico, numero inventado, achado suprimido
 * reintroduzido -- mora em `domain/saida-da-analise.ts` e roda depois, no
 * `AiAnalysisService`. Duplicar checagem aqui seria a mesma regra em dois
 * lugares divergindo na primeira mudanca.
 */
@Injectable()
export class AnthropicAiProviderAdapter implements AiProvider {
  static readonly MODELO = 'claude-sonnet-4-6';

  constructor(private readonly client: Anthropic) {}

  async analisar(pedido: PedidoDeAnalise): Promise<RespostaDaIa> {
    const inicio = Date.now();

    let resposta: Anthropic.Message;

    try {
      resposta = await this.client.messages.create({
        model: AnthropicAiProviderAdapter.MODELO,
        // Thinking adaptativo consome deste teto; 8192 cortava o JSON no meio.
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: pedido.schema } },
        system: pedido.prompt,
        messages: [
          {
            role: 'user',
            content: JSON.stringify(pedido.snapshot),
          },
        ],
      });
    } catch (erro) {
      throw traduzirErro(erro);
    }

    if (resposta.stop_reason === 'max_tokens' || resposta.stop_reason === 'refusal') {
      throw new ErroDaIa(
        'AI_PROVIDER_INVALID_REQUEST',
        false,
        `resposta da IA interrompida (${resposta.stop_reason})`,
      );
    }

    const texto = resposta.content
      .filter((bloco): bloco is Anthropic.TextBlock => bloco.type === 'text')
      .map((bloco) => bloco.text)
      .join('');

    let bruta: unknown;

    try {
      bruta = JSON.parse(texto) as unknown;
    } catch {
      throw new ErroDaIa(
        'AI_PROVIDER_INVALID_REQUEST',
        false,
        'resposta da IA nao e JSON valido',
      );
    }

    return {
      bruta,
      model: resposta.model,
      // `usage.output_tokens` ja INCLUI o thinking (nota do ADR-036): nao ha
      // soma separada de thinking a fazer, e somar de novo dobraria o custo.
      costMicros: calcularCustoMicros(resposta.usage),
      latencyMs: Date.now() - inicio,
      inputTokens: resposta.usage.input_tokens,
      outputTokens: resposta.usage.output_tokens,
    };
  }
}

/**
 * Preco por milhao de tokens do `claude-sonnet-4-6` (US$, tabela vigente).
 *
 * Fica junto do adapter, nao em config: e o mesmo tipo de constante de
 * negocio que `TAMANHO_MAXIMO_BYTES` -- muda com anuncio de preco da
 * Anthropic, nao com ambiente.
 */
const PRECO_ENTRADA_USD_POR_MILHAO = 3;
const PRECO_SAIDA_USD_POR_MILHAO = 15;
const MICROCENTAVOS_POR_DOLAR = 100_000;

/**
 * Custo em milesimos de centavo de dolar, inteiro (regra de arquitetura no 6:
 * dinheiro nunca e float). O arredondamento para inteiro acontece uma vez,
 * no final -- nunca em passo intermediario.
 */
function calcularCustoMicros(usage: Anthropic.Usage): number {
  const custoEntradaUsd = (usage.input_tokens / 1_000_000) * PRECO_ENTRADA_USD_POR_MILHAO;
  const custoSaidaUsd = (usage.output_tokens / 1_000_000) * PRECO_SAIDA_USD_POR_MILHAO;

  return Math.round((custoEntradaUsd + custoSaidaUsd) * MICROCENTAVOS_POR_DOLAR);
}

/** Classifica o erro do SDK no vocabulario do `AiProvider`. */
function traduzirErro(erro: unknown): ErroDaIa {
  if (erro instanceof Anthropic.RateLimitError) {
    return new ErroDaIa('AI_PROVIDER_TIMEOUT', true, erro.message);
  }

  if (erro instanceof Anthropic.APIConnectionError || erro instanceof Anthropic.InternalServerError) {
    return new ErroDaIa('AI_PROVIDER_UNAVAILABLE', true, erro.message);
  }

  if (erro instanceof Anthropic.APIError) {
    return new ErroDaIa('AI_PROVIDER_INVALID_REQUEST', false, erro.message);
  }

  return new ErroDaIa(
    'AI_PROVIDER_UNAVAILABLE',
    true,
    erro instanceof Error ? erro.message : 'falha nao classificada do provedor',
  );
}
