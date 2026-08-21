import type { TipoDeArquivo } from '../domain/arquivo-de-importacao.js';
import type { TipoDeMedida, UnidadeDeMedida } from '../domain/medida.js';

/**
 * Fronteira da extracao de documento (`DocumentExtractor`, ADR-017).
 *
 * EXISTE COMO PORTA porque a extracao tem tres implementacoes de naturezas
 * diferentes, e o dominio nao pode saber qual respondeu:
 *
 *   - **CSV** -- parser deterministico, sem IA. Ou le, ou falha.
 *   - **PDF do OmronConnect** -- `pdftotext` na camada de texto (ADR-035
 *     decisao 8): custo zero e reproduzivel. Mandar para OCR seria PAGAR
 *     PARA INTRODUZIR ERRO num arquivo que ja traz o texto.
 *   - **imagem do laudo da balanca** -- OCR de verdade, com confianca por
 *     campo e possibilidade de errar.
 *
 * O que TODAS tem em comum, e o que a regra de arquitetura no 8 exige: o que
 * sai daqui e PROPOSTA, nunca medida. Vira historico so depois de um humano
 * decidir campo a campo (INV-103).
 */

export type CodigoDeErroDeExtracao =
  | 'EXTRACTOR_UNAVAILABLE'
  | 'EXTRACTOR_TIMEOUT'
  /** O arquivo tem o formato certo, mas nao ha nada extraivel nele. */
  | 'EXTRACTOR_NO_CONTENT'
  /** O extrator nao sabe lidar com este tipo. */
  | 'EXTRACTOR_UNSUPPORTED_TYPE';

export class ErroDeExtracao extends Error {
  constructor(
    readonly codigo: CodigoDeErroDeExtracao,
    readonly recuperavel: boolean,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDeExtracao';
  }
}

/**
 * Um campo que o extrator acha ter encontrado.
 *
 * "Acha" e a palavra certa: `confidence` existe justamente porque ele pode
 * estar errado, e o produto trata isso como normal em vez de excecao.
 */
export interface CampoProposto {
  readonly type: TipoDeMedida;
  readonly value: number;
  readonly unit: UnidadeDeMedida | null;
  /**
   * 0..1, ou `null` quando o extrator nao sabe medir confianca (parser de
   * CSV). `null` NAO e zero -- ver `ordemDeRevisao`.
   */
  readonly confidence: number | null;
  /** Pagina e linha, quando o extrator informa (`M3-FR-010`). */
  readonly sourceLocation: string | null;
}

export interface ResultadoDaExtracao {
  readonly campos: readonly CampoProposto[];
  /**
   * Instante da MEDICAO, quando o documento informa.
   *
   * `null` obriga o avaliador a digitar -- e melhor que assumir "hoje": um
   * laudo de tres meses atras digitado hoje entraria no grafico na posicao
   * errada e o comparativo mentiria (mesma razao do `assessedAt` da F17).
   */
  readonly measuredAt: Date | null;
  /** Qual implementacao respondeu, para auditoria. */
  readonly extractor: string;
}

export interface PedidoDeExtracao {
  readonly conteudo: Uint8Array;
  readonly tipo: TipoDeArquivo;
}

export interface DocumentExtractor {
  extrair(pedido: PedidoDeExtracao): Promise<ResultadoDaExtracao>;
}

export const DOCUMENT_EXTRACTOR = Symbol('DOCUMENT_EXTRACTOR');
