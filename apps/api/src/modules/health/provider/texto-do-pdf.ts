import { ErroDeExtracao } from './document-extractor.port.js';

/**
 * A CAMADA DE TEXTO do PDF (ADR-035 decisao 8).
 *
 * `unpdf` roda em Node puro, sem binario nativo -- ao contrario do
 * `pdftotext`, que exigiria poppler instalado no host e no container de CI.
 *
 * NORMALIZA ACENTO porque o laudo real e pt-BR ("Frequência cardíaca") e os
 * padroes de regex deste modulo sao escritos sem acento. `NFD` separa a
 * letra do acento; a faixa combina os acentos soltos e some com eles.
 *
 * Extraido de `laudo-bioimpedancia.extractor.ts` (F19) para reuso pelo
 * parser de sinais vitais (card #345) -- mesma dependencia, mesmo motivo.
 */
export async function textoDoPdf(conteudo: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');

  let texto: string;

  try {
    const pdf = await getDocumentProxy(conteudo);
    const extraido = await extractText(pdf, { mergePages: true });

    texto = Array.isArray(extraido.text) ? extraido.text.join('\n') : extraido.text;
  } catch (erro) {
    throw new ErroDeExtracao(
      'EXTRACTOR_NO_CONTENT',
      false,
      `PDF ilegivel: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
    );
  }

  return texto.normalize('NFD').replace(new RegExp('[̀-ͯ]', 'gu'), '');
}
