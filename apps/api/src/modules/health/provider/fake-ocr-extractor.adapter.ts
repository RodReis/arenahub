import { Injectable } from '@nestjs/common';

import { CsvDocumentExtractorAdapter } from './csv-document-extractor.adapter.js';
import {
  ErroDeExtracao,
  type DocumentExtractor,
  type PedidoDeExtracao,
  type ResultadoDaExtracao,
} from './document-extractor.port.js';

/**
 * Extrator que ROTEIA por tipo de arquivo, com dublê de OCR para imagem e
 * PDF (ADR-017).
 *
 * ---------------------------------------------------------------------------
 * O CSV NAO E DUBLE. O OCR E.
 * ---------------------------------------------------------------------------
 *
 * CSV vai para o parser de producao (`CsvDocumentExtractorAdapter`) mesmo em
 * teste: ele e deterministico e nao depende de terceiro, entao dubla-lo
 * testaria o dublê. Imagem e PDF passam pelo fake ate existir OCR de verdade.
 *
 * ---------------------------------------------------------------------------
 * O FAKE ERRA DE PROPOSITO, E ISSO E O PONTO.
 * ---------------------------------------------------------------------------
 *
 * Ele devolve um campo com confianca BAIXA e valor plausivelmente errado --
 * porque a fatia inteira existe para o caso em que o OCR erra. Um fake que
 * devolvesse dado perfeito faria o fluxo de CORRECAO nunca ser exercitado, e
 * a primeira leitura errada de verdade seria o primeiro teste daquele
 * caminho, em producao.
 *
 * O valor imita o erro real que motivou a fatia: OCR lendo `3,15` onde o
 * laudo diz `31,5` -- virgula deslocada, dez vezes menor, e plausivel o
 * bastante para passar despercebido por quem so olha a tela de relance.
 */
@Injectable()
export class FakeOcrExtractorAdapter implements DocumentExtractor {
  private falhaProgramada: ErroDeExtracao | null = null;

  constructor(private readonly csv: CsvDocumentExtractorAdapter) {}

  programarFalha(erro: ErroDeExtracao): void {
    this.falhaProgramada = erro;
  }

  resetar(): void {
    this.falhaProgramada = null;
  }

  extrair(pedido: PedidoDeExtracao): Promise<ResultadoDaExtracao> {
    if (this.falhaProgramada) {
      return Promise.reject(this.falhaProgramada);
    }

    if (pedido.tipo === 'CSV') {
      return this.csv.extrair(pedido);
    }

    return Promise.resolve({
      campos: [
        {
          type: 'WEIGHT',
          value: 90.5,
          unit: 'kg',
          confidence: 0.97,
          sourceLocation: 'pagina 1, linha 2',
        },
        {
          type: 'BODY_FAT_PERCENT',
          value: 24.1,
          unit: 'percent',
          confidence: 0.88,
          sourceLocation: 'pagina 1, linha 5',
        },
        {
          // O erro plantado: virgula deslocada. Confianca baixa para ir ao
          // topo da fila de revisao.
          type: 'INTRACELLULAR_WATER',
          value: 3.15,
          unit: 'L',
          confidence: 0.42,
          sourceLocation: 'pagina 2, linha 1',
        },
      ],
      // `null` obriga o avaliador a digitar a data da medicao: assumir "hoje"
      // colocaria um laudo de tres meses atras na posicao errada do grafico.
      measuredAt: null,
      extractor: 'fake-ocr@1',
    });
  }
}
