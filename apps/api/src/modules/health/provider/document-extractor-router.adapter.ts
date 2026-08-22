import { Inject, Injectable, Optional } from '@nestjs/common';

import type { DocumentExtractor, PedidoDeExtracao, ResultadoDaExtracao } from './document-extractor.port.js';
import { ANTHROPIC_OCR_EXTRACTOR } from './anthropic-ocr-extractor.token.js';
import { FakeOcrExtractorAdapter } from './fake-ocr-extractor.adapter.js';
import { LaudoBioimpedanciaExtractor } from './laudo-bioimpedancia.extractor.js';

/**
 * Roteador de producao do `DOCUMENT_EXTRACTOR` (ADR-017).
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM ROTEADOR, E NAO UM ADAPTER SO.
 * ---------------------------------------------------------------------------
 *
 * CSV e PDF (laudo de bioimpedancia e ECG do OmronConnect) tem implementacao
 * REAL em `LaudoBioimpedanciaExtractor` -- superset do parser generico de CSV
 * (Slice 3.3) mais o texto de ECG (ADR-035 decisao 8). Imagem (PNG/JPEG) vai
 * para o OCR real da Anthropic (`AnthropicOcrExtractorAdapter`, ADR-036)
 * quando `ANTHROPIC_API_KEY` esta configurada; sem a chave, `ocrReal` chega
 * `null` (ver `health.module.ts`) e o dublê responde -- nunca os dois runtimes
 * ao mesmo tempo, e nunca o dublê em producao com a chave presente.
 */
@Injectable()
export class DocumentExtractorRouterAdapter implements DocumentExtractor {
  constructor(
    private readonly laudo: LaudoBioimpedanciaExtractor,
    private readonly fakeOcr: FakeOcrExtractorAdapter,
    @Optional()
    @Inject(ANTHROPIC_OCR_EXTRACTOR)
    private readonly ocrReal: DocumentExtractor | null,
  ) {}

  extrair(pedido: PedidoDeExtracao): Promise<ResultadoDaExtracao> {
    if (pedido.tipo === 'CSV' || pedido.tipo === 'PDF') {
      return this.laudo.extrair(pedido);
    }

    // PNG/JPEG: OCR real quando ha chave configurada; dublê caso contrario.
    return (this.ocrReal ?? this.fakeOcr).extrair(pedido);
  }
}
