/**
 * Regras de aceitacao do logotipo de patrocinador (28/08/2026).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * IRMA de `midia-do-totem.ts`, e NAO uma extensao dela -- pelo motivo que
 * aquele arquivo ja escreveu sobre o laudo de bioimpedancia: juntar os dois
 * produziria uma lista onde logotipo aceitaria MP4 de 40 MB e video
 * aceitaria PNG. Sao tetos, tipos e assinaturas diferentes porque sao usos
 * diferentes.
 *
 * ---------------------------------------------------------------------------
 * O TIPO E DECIDIDO PELO CONTEUDO, NAO PELA EXTENSAO NEM PELO CLIENTE.
 * ---------------------------------------------------------------------------
 *
 * `content-type` do formulario e nome de arquivo sao AMBOS controlados por
 * quem envia. A assinatura nos primeiros bytes e o unico sinal que vem do
 * arquivo em si. Isso nao substitui o antivirus: assinatura correta prova o
 * FORMATO, nao que o conteudo e inofensivo.
 *
 * ---------------------------------------------------------------------------
 * SVG FICOU DE FORA, E E DECISAO -- NAO ESQUECIMENTO.
 * ---------------------------------------------------------------------------
 *
 * SVG e o formato natural de logotipo (vetor, escala sem perda), e foi
 * considerado. Ficou fora porque SVG e XML: carrega `<script>`, `<foreignObject>`
 * e handlers `on*`, e entraria numa tela publica que fica ligada o dia
 * inteiro na recepcao. Aceita-lo exigiria sanitizacao de XML alem do
 * antivirus -- que nao detecta script em SVG. Os tres formatos raster abaixo
 * nao tem superficie de script, e PNG com fundo transparente cobre o caso da
 * faixa.
 */

export type MotivoDeRecusaDeLogotipo =
  | 'FILE_TOO_LARGE'
  | 'FILE_EMPTY'
  | 'FILE_TYPE_NOT_ALLOWED'
  /** Os bytes nao sao de PNG, JPEG nem WebP. */
  | 'FILE_SIGNATURE_MISMATCH';

export type ResultadoDaAceitacaoDeLogotipo =
  | { readonly aceito: true }
  | { readonly aceito: false; readonly motivo: MotivoDeRecusaDeLogotipo };

/**
 * Teto de 2 MB.
 *
 * MUITO menor que os 40 MB do video, e de proposito: sao ate seis logotipos
 * numa faixa de rodape com poucos centimetros de altura -- 2 MB ja e
 * generoso para um PNG desse tamanho, e o teto e o que impede a faixa de
 * virar o download mais pesado do boot do totem.
 */
export const TAMANHO_MAXIMO_DE_LOGOTIPO_BYTES = 2 * 1024 * 1024;

/** Lista fechada. Nada de `image/*` -- ele deixaria SVG entrar. */
export const CONTENT_TYPES_DE_LOGOTIPO = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type ContentTypeDeLogotipo = (typeof CONTENT_TYPES_DE_LOGOTIPO)[number];

/**
 * Quantos bytes do inicio bastam para reconhecer os tres formatos.
 *
 * WebP e o que manda: `RIFF` nos bytes 0-3 e `WEBP` nos bytes 8-11, entao
 * doze e o minimo. PNG precisa de oito e JPEG de tres.
 */
export const BYTES_DO_CABECALHO_DE_LOGOTIPO = 12;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // 'RIFF'
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // 'WEBP'
const OFFSET_DO_WEBP = 8;

function comecaCom(
  cabecalho: Uint8Array,
  assinatura: readonly number[],
  offset = 0,
): boolean {
  if (cabecalho.length < offset + assinatura.length) return false;

  return assinatura.every((byte, indice) => cabecalho[offset + indice] === byte);
}

/**
 * Os bytes sao de PNG, JPEG ou WebP?
 *
 * WebP NAO e so `RIFF`: `RIFF` sozinho tambem abre WAV e AVI. Sem conferir
 * `WEBP` no offset 8, um audio renomeado passaria a assinatura -- e o
 * antivirus nao recusaria, porque WAV nao e malware.
 */
export function pareceImagemDeLogotipo(cabecalho: Uint8Array): boolean {
  return formatoDoCabecalho(cabecalho) !== null;
}

/**
 * QUAL dos tres formatos os bytes sao -- `null` se nenhum.
 *
 * Devolver o formato, e nao um booleano, e o que permite conferir se ele
 * BATE com o `content-type` declarado. A primeira versao so perguntava "e
 * alguma imagem?", e por isso aceitava um JPEG declarado como `image/png`:
 * a lista fechada de tipos virava decorativa, porque qualquer um dos tres
 * bytes satisfazia qualquer um dos tres rotulos.
 */
export function formatoDoCabecalho(cabecalho: Uint8Array): ContentTypeDeLogotipo | null {
  if (comecaCom(cabecalho, PNG)) return 'image/png';
  if (comecaCom(cabecalho, JPEG)) return 'image/jpeg';

  if (comecaCom(cabecalho, RIFF) && comecaCom(cabecalho, WEBP, OFFSET_DO_WEBP)) {
    return 'image/webp';
  }

  return null;
}

/**
 * O logotipo pode ser aceito?
 *
 * Ordem barata-antes-de-cara, a mesma de `aceitarMidia`: tamanho primeiro,
 * porque e o teste que protege a memoria; assinatura por ultimo, porque le
 * bytes.
 */
export function aceitarLogotipo(entrada: {
  readonly tamanhoBytes: number;
  readonly contentType: string;
  readonly cabecalho: Uint8Array;
}): ResultadoDaAceitacaoDeLogotipo {
  if (entrada.tamanhoBytes > TAMANHO_MAXIMO_DE_LOGOTIPO_BYTES) {
    return { aceito: false, motivo: 'FILE_TOO_LARGE' };
  }

  if (entrada.tamanhoBytes === 0) {
    return { aceito: false, motivo: 'FILE_EMPTY' };
  }

  const tipo = entrada.contentType.toLowerCase();

  if (!CONTENT_TYPES_DE_LOGOTIPO.includes(tipo as ContentTypeDeLogotipo)) {
    return { aceito: false, motivo: 'FILE_TYPE_NOT_ALLOWED' };
  }

  /*
   * A assinatura tem de bater com o TIPO DECLARADO, nao apenas ser de
   * alguma imagem: senao a lista fechada acima nao trava nada -- bastaria
   * declarar `image/png` e enviar outro formato para escapar dela.
   */
  if (formatoDoCabecalho(entrada.cabecalho) !== tipo) {
    return { aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' };
  }

  return { aceito: true };
}
