import { Injectable } from '@nestjs/common';

import type { DocumentExtractor, PedidoDeExtracao, ResultadoDaExtracao } from './document-extractor.port.js';
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
 * (Slice 3.3) mais o texto de ECG (ADR-035 decisao 8). Imagem (PNG/JPEG) nao
 * tem OCR de verdade ainda: so o dublê (`FakeOcrExtractorAdapter`) responde
 * por ela. O roteador manda cada tipo para quem tem implementacao real,
 * igual ao `FakeOcrExtractorAdapter` ja faz para CSV dentro dele mesmo --
 * sem isto, o dublê seria o que roda em producao para todo tipo de arquivo,
 * exatamente o problema que este arquivo resolve.
 */
@Injectable()
export class DocumentExtractorRouterAdapter implements DocumentExtractor {
  constructor(
    private readonly laudo: LaudoBioimpedanciaExtractor,
    private readonly fakeOcr: FakeOcrExtractorAdapter,
  ) {}

  extrair(pedido: PedidoDeExtracao): Promise<ResultadoDaExtracao> {
    if (pedido.tipo === 'CSV' || pedido.tipo === 'PDF') {
      return this.laudo.extrair(pedido);
    }

    // PNG/JPEG: OCR de imagem ainda nao existe -- so o dublê responde.
    return this.fakeOcr.extrair(pedido);
  }
}
