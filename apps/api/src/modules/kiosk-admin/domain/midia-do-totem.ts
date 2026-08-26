/**
 * Regras de aceitacao da midia da tela publica (F51, `M3.5-FR-005`).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * Irma de `health/domain/arquivo-de-importacao.ts`, e NAO uma extensao dela:
 * aquele aceita PDF, PNG, JPEG e CSV com teto de 10 MB para laudo de
 * bioimpedancia; este aceita MP4 com teto de 40 MB para video de recepcao.
 * Nada alem da disciplina e comum -- juntar os dois produziria uma lista de
 * tipos onde laudo aceitaria video e video aceitaria CSV.
 *
 * ---------------------------------------------------------------------------
 * O TIPO E DECIDIDO PELO CONTEUDO, NAO PELA EXTENSAO NEM PELO CLIENTE.
 * ---------------------------------------------------------------------------
 *
 * `content-type` do formulario e nome de arquivo sao AMBOS controlados por
 * quem envia. A assinatura nos primeiros bytes e o unico sinal que vem do
 * arquivo em si. Isso nao substitui o antivirus: assinatura correta prova o
 * FORMATO, nao que o conteudo e inofensivo.
 */

export type MotivoDeRecusaDeMidia =
  | 'FILE_TOO_LARGE'
  | 'FILE_EMPTY'
  | 'FILE_TYPE_NOT_ALLOWED'
  /** Os bytes nao sao de um container MP4. */
  | 'FILE_SIGNATURE_MISMATCH';

export type ResultadoDaAceitacaoDeMidia =
  | { readonly aceito: true }
  | { readonly aceito: false; readonly motivo: MotivoDeRecusaDeMidia };

/** Teto de 40 MB -- o numero e do ADR-042, Decisao 7, nao escolha nossa. */
export const TAMANHO_MAXIMO_DE_MIDIA_BYTES = 40 * 1024 * 1024;

/** Lista fechada. Nada de `video/*`. */
export const CONTENT_TYPE_DE_MIDIA = 'video/mp4';

/**
 * MP4 e um container ISO-BMFF, e a assinatura dele NAO comeca no byte 0.
 *
 * O layout e `[4 bytes de tamanho da box][4 bytes do tipo da box]`, e a
 * primeira box de um MP4 valido e `ftyp`. Procurar `ftyp` no offset 0 --
 * que e o reflexo de quem copiou a tabela do PNG -- recusaria TODO MP4
 * legitimo, e o teste passaria pelo motivo errado se a fixture tambem
 * estivesse montada errada.
 */
const OFFSET_DO_FTYP = 4;
const FTYP = [0x66, 0x74, 0x79, 0x70] as const; // 'ftyp'

/** Os bytes sao de um container MP4? */
export function pareceMp4(cabecalho: Uint8Array): boolean {
  if (cabecalho.length < OFFSET_DO_FTYP + FTYP.length) return false;

  return FTYP.every((byte, indice) => cabecalho[OFFSET_DO_FTYP + indice] === byte);
}

/**
 * A midia pode ser aceita?
 *
 * Ordem barata-antes-de-cara: tamanho primeiro, porque e o teste que
 * protege a memoria; assinatura por ultimo, porque le bytes.
 */
export function aceitarMidia(entrada: {
  readonly tamanhoBytes: number;
  readonly contentType: string;
  readonly cabecalho: Uint8Array;
}): ResultadoDaAceitacaoDeMidia {
  if (entrada.tamanhoBytes > TAMANHO_MAXIMO_DE_MIDIA_BYTES) {
    return { aceito: false, motivo: 'FILE_TOO_LARGE' };
  }

  if (entrada.tamanhoBytes === 0) {
    return { aceito: false, motivo: 'FILE_EMPTY' };
  }

  if (entrada.contentType.toLowerCase() !== CONTENT_TYPE_DE_MIDIA) {
    return { aceito: false, motivo: 'FILE_TYPE_NOT_ALLOWED' };
  }

  if (!pareceMp4(entrada.cabecalho)) {
    return { aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' };
  }

  return { aceito: true };
}
