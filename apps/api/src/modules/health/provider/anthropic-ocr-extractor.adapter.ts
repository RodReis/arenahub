import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';

import { TIPOS_DE_MEDIDA, UNIDADES_DE_MEDIDA } from '../domain/medida.js';
import type { TipoDeMedida, UnidadeDeMedida } from '../domain/medida.js';
import {
  ErroDeExtracao,
  type CampoProposto,
  type DocumentExtractor,
  type PedidoDeExtracao,
  type ResultadoDaExtracao,
} from './document-extractor.port.js';

/**
 * OCR de verdade para laudo de bioimpedancia em imagem (PNG/JPEG), via
 * Anthropic (ADR-036 decisao 1).
 *
 * ---------------------------------------------------------------------------
 * MODELO: `claude-haiku-4-5`, SEM `effort` E SEM `thinking`.
 * ---------------------------------------------------------------------------
 *
 * Nota de implementacao do ADR-036 que "erra silenciosamente se ignorada":
 * haiku 4.5 NAO aceita `output_config.effort` e nao tem *adaptive thinking* --
 * a chamada retorna erro se qualquer um dos dois for enviado. Por isso este
 * adapter NUNCA envia `thinking` nem `output_config`.
 *
 * ---------------------------------------------------------------------------
 * SAIDA E `unknown` ATE VALIDAR (`CLAUDE.md`).
 * ---------------------------------------------------------------------------
 *
 * A resposta do modelo e texto de terceiro: passa por `JSON.parse` dentro de
 * um `try`, e todo campo e conferido contra `TIPOS_DE_MEDIDA` antes de virar
 * `CampoProposto`. Nome de campo que nao esta na lista fechada e DESCARTADO,
 * nunca adivinhado -- e o mesmo criterio que `LaudoBioimpedanciaExtractor` ja
 * aplica ao CSV.
 *
 * ---------------------------------------------------------------------------
 * CONFIANCA BAIXA E O CAMINHO NORMAL, NUNCA VALOR INVENTADO (INV-104).
 * ---------------------------------------------------------------------------
 *
 * O prompt instrui: campo ilegivel ou duvidoso -> confidence baixa, nunca
 * chute. Campo que o modelo nao conseguiu ler de jeito nenhum -> AUSENTE da
 * lista, nunca `0` nem valor inventado. `null` e a resposta honesta.
 */
@Injectable()
export class AnthropicOcrExtractorAdapter implements DocumentExtractor {
  private readonly log = new Logger(AnthropicOcrExtractorAdapter.name);

  static readonly MODELO = 'claude-haiku-4-5';

  constructor(private readonly client: Anthropic) {}

  async extrair(pedido: PedidoDeExtracao): Promise<ResultadoDaExtracao> {
    if (pedido.tipo !== 'PNG' && pedido.tipo !== 'JPEG') {
      throw new ErroDeExtracao(
        'EXTRACTOR_UNSUPPORTED_TYPE',
        false,
        `OCR da Anthropic nao le ${pedido.tipo} -- so imagem de laudo (PNG/JPEG)`,
      );
    }

    const mediaType = pedido.tipo === 'PNG' ? 'image/png' : 'image/jpeg';
    const base64 = Buffer.from(pedido.conteudo).toString('base64');

    let resposta: Anthropic.Message;

    try {
      resposta = await this.client.messages.create({
        model: AnthropicOcrExtractorAdapter.MODELO,
        max_tokens: 4096,
        system: PROMPT_DE_EXTRACAO,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: 'Extraia os campos deste laudo de bioimpedancia, respondendo SOMENTE com o JSON pedido.',
              },
            ],
          },
        ],
      });
    } catch (erro) {
      throw traduzirErro(erro);
    }

    const texto = resposta.content
      .filter((bloco): bloco is Anthropic.TextBlock => bloco.type === 'text')
      .map((bloco) => bloco.text)
      .join('');

    return interpretarResposta(texto);
  }
}

const PROMPT_DE_EXTRACAO = `Voce le laudos de bioimpedancia (relatorio de balanca de composicao corporal) e devolve os campos em JSON estruturado.

TIPOS DE CAMPO ACEITOS (use EXATAMENTE um destes nomes; qualquer outro rotulo do laudo -- indice do fabricante, idade corporal, pontuacao de saude, sugestao de treino -- NAO ENTRA no JSON):
${TIPOS_DE_MEDIDA.join(', ')}

REGRAS ABSOLUTAS
1. Campo ilegivel, borrado ou duvidoso: inclua com "confidence" BAIXO (perto de 0). NUNCA adivinhe o valor -- um numero errado com confianca alta e pior que nao ler o campo.
2. Campo que voce NAO CONSEGUE LER de jeito nenhum: OMITA da lista. Nunca escreva 0 nem invente um valor para preencher a ausencia.
3. So use tipo desta lista fechada. Indice proprietario do fabricante (idade corporal, pontuacao, peso ideal, "controles" sugeridos) NAO E MEDIDA -- ignore essas linhas.
4. Se o laudo mostrar a data/hora da MEDICAO (nao a data de hoje), inclua em "measuredAt" no formato ISO 8601. Se nao houver essa informacao no laudo, "measuredAt": null.
5. "unit" e a unidade IMPRESSA no laudo para aquele campo -- nunca converta. Use uma destas: ${UNIDADES_DE_MEDIDA.join(', ')}. Campo adimensional (indice visceral, razao cintura-quadril, batimentos por minuto): "unit": null.
6. Se o laudo trouxer faixa de referencia do fabricante para o campo, inclua "referenceMin" e "referenceMax". Se trouxer percentual do padrao (comum em segmentares), inclua "standardPercent". Ausente: null.
7. Se identificar a marca/modelo do aparelho (ex.: "CF610_G"), inclua em "sourceLabel". Sem certeza: null.

FORMATO DE RESPOSTA
Responda SOMENTE com um JSON deste formato, sem texto antes ou depois:

{
  "measuredAt": "2026-08-01T10:00:00.000Z" | null,
  "sourceLabel": "string" | null,
  "fields": [
    {
      "type": "WEIGHT",
      "value": 88.4,
      "unit": "kg",
      "confidence": 0.97,
      "sourceLocation": "linha 2" | null,
      "referenceMin": 60.6 | null,
      "referenceMax": 82.0 | null,
      "standardPercent": null
    }
  ]
}`;

/** O shape que o prompt pede, ainda `unknown` ate a validacao de campo a campo. */
interface RespostaBrutaEsperada {
  measuredAt?: unknown;
  sourceLabel?: unknown;
  fields?: unknown;
}

function ehTipoDeMedida(valor: unknown): valor is TipoDeMedida {
  return typeof valor === 'string' && (TIPOS_DE_MEDIDA as readonly string[]).includes(valor);
}

function ehUnidade(valor: unknown): valor is UnidadeDeMedida {
  return typeof valor === 'string' && (UNIDADES_DE_MEDIDA as readonly string[]).includes(valor);
}

function numeroOuNull(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/**
 * Traduz o texto do modelo em `ResultadoDaExtracao`, descartando (nunca
 * adivinhando) qualquer campo fora do contrato.
 *
 * `unknown` de ponta a ponta ate a checagem de tipo (`CLAUDE.md`): a resposta
 * vem de terceiro, e confiar na forma dela e o mesmo erro de confiar em corpo
 * de requisicao sem Zod.
 */
function interpretarResposta(texto: string): ResultadoDaExtracao {
  let bruta: unknown;

  try {
    bruta = JSON.parse(extrairJson(texto)) as unknown;
  } catch {
    throw new ErroDeExtracao(
      'EXTRACTOR_NO_CONTENT',
      true,
      'resposta do OCR nao e JSON valido',
    );
  }

  if (typeof bruta !== 'object' || bruta === null) {
    throw new ErroDeExtracao('EXTRACTOR_NO_CONTENT', true, 'resposta do OCR sem objeto JSON');
  }

  const objeto = bruta as RespostaBrutaEsperada;
  const listaBruta = Array.isArray(objeto.fields) ? objeto.fields : [];

  const campos: CampoProposto[] = [];

  for (const item of listaBruta) {
    if (typeof item !== 'object' || item === null) continue;

    const registro = item as Record<string, unknown>;

    if (!ehTipoDeMedida(registro['type'])) continue;

    const valor = numeroOuNull(registro['value']);

    if (valor === null) continue;

    const unidade = ehUnidade(registro['unit']) ? registro['unit'] : null;

    campos.push({
      type: registro['type'],
      value: valor,
      unit: unidade,
      confidence: numeroOuNull(registro['confidence']),
      sourceLocation:
        typeof registro['sourceLocation'] === 'string' ? registro['sourceLocation'] : null,
      referenceMin: numeroOuNull(registro['referenceMin']),
      referenceMax: numeroOuNull(registro['referenceMax']),
      standardPercent: numeroOuNull(registro['standardPercent']),
    });
  }

  if (campos.length === 0) {
    throw new ErroDeExtracao(
      'EXTRACTOR_NO_CONTENT',
      false,
      'nenhum campo reconhecivel na imagem do laudo',
    );
  }

  const measuredAt = interpretarData(objeto.measuredAt);
  const sourceLabel = typeof objeto.sourceLabel === 'string' ? objeto.sourceLabel : undefined;

  return {
    campos,
    measuredAt,
    extractor: 'anthropic-ocr@1',
    tipoDeLaudo: 'BIOIMPEDANCE',
    ...(sourceLabel !== undefined ? { sourceLabel } : {}),
  };
}

/** `null` obriga o avaliador a digitar a data -- nunca assume "hoje" (mesma regra do fake). */
function interpretarData(valor: unknown): Date | null {
  if (typeof valor !== 'string') return null;

  const data = new Date(valor);

  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * O modelo pode envolver o JSON em crase de markdown apesar do pedido
 * explicito de "SOMENTE o JSON". Extrai o primeiro bloco `{...}` do texto em
 * vez de confiar que a resposta comeca exatamente no `{`.
 */
function extrairJson(texto: string): string {
  const inicio = texto.indexOf('{');
  const fim = texto.lastIndexOf('}');

  if (inicio === -1 || fim === -1 || fim < inicio) {
    return texto;
  }

  return texto.slice(inicio, fim + 1);
}

/** Classifica o erro do SDK da Anthropic no vocabulario do `DocumentExtractor`. */
function traduzirErro(erro: unknown): ErroDeExtracao {
  if (erro instanceof Anthropic.RateLimitError || erro instanceof Anthropic.InternalServerError) {
    return new ErroDeExtracao('EXTRACTOR_TIMEOUT', true, erro.message);
  }

  if (erro instanceof Anthropic.APIConnectionError) {
    return new ErroDeExtracao('EXTRACTOR_UNAVAILABLE', true, erro.message);
  }

  if (erro instanceof Anthropic.APIError) {
    // 400/401/403/404 do provedor: nao adianta repetir sem mudar a requisicao.
    return new ErroDeExtracao('EXTRACTOR_UNAVAILABLE', false, erro.message);
  }

  return new ErroDeExtracao(
    'EXTRACTOR_UNAVAILABLE',
    true,
    erro instanceof Error ? erro.message : 'falha nao classificada do OCR',
  );
}
