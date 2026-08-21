/**
 * Regras de aceitacao do arquivo importado (`M3-FR-009`, F19, Slice 3.3).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * ---------------------------------------------------------------------------
 * O TIPO E DECIDIDO PELO CONTEUDO, NAO PELA EXTENSAO NEM PELO CLIENTE.
 * ---------------------------------------------------------------------------
 *
 * `content-type` do formulario e extensao de arquivo sao AMBOS controlados
 * por quem envia. Aceitar um `.pdf` porque o nome termina em `.pdf` e
 * confiar em entrada externa -- o mesmo erro de confiar em corpo de
 * requisicao sem Zod. A assinatura nos primeiros bytes (magic number) e o
 * unico sinal que vem do arquivo em si.
 *
 * Isso nao substitui o antivirus: assinatura correta prova o FORMATO, nao
 * que o conteudo e inofensivo. Os dois existem, e por razoes diferentes.
 */

export type TipoDeArquivo = 'PDF' | 'PNG' | 'JPEG' | 'CSV';

export type MotivoDeRecusa =
  | 'FILE_TOO_LARGE'
  | 'FILE_EMPTY'
  | 'FILE_TYPE_NOT_ALLOWED'
  /** Assinatura nao bate com nenhum tipo aceito. */
  | 'FILE_SIGNATURE_UNKNOWN'
  /** Assinatura contradiz o `content-type` declarado. */
  | 'FILE_SIGNATURE_MISMATCH';

export type ResultadoDaAceitacao =
  | { readonly aceito: true; readonly tipo: TipoDeArquivo }
  | { readonly aceito: false; readonly motivo: MotivoDeRecusa };

/**
 * Teto de tamanho.
 *
 * 10 MB cobre com folga o laudo do `CF610_G` (dois PNGs de ~1,5 MB) e o PDF
 * do OmronConnect. E parametro e nao constante de negocio -- mas o limite
 * EXISTE por seguranca, nao por economia: sem teto, um upload de 2 GB derruba
 * a memoria do processo antes de qualquer validacao rodar.
 */
export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;

/**
 * Assinaturas dos tipos aceitos.
 *
 * CSV NAO tem assinatura -- e texto puro, e nao ha magic number para "texto
 * separado por virgula". Ele e tratado a parte, e essa e a razao de
 * `detectarTipo` devolver `null` em vez de fingir que reconheceu.
 */
const ASSINATURAS: readonly { tipo: TipoDeArquivo; bytes: readonly number[] }[] = [
  { tipo: 'PDF', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { tipo: 'PNG', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { tipo: 'JPEG', bytes: [0xff, 0xd8, 0xff] },
];

/**
 * O tipo real do arquivo, pelos primeiros bytes.
 *
 * `null` quando nenhuma assinatura casa -- inclusive para CSV, que nao tem
 * uma. Quem chama decide o que fazer com isso.
 */
export function detectarTipo(cabecalho: Uint8Array): TipoDeArquivo | null {
  for (const assinatura of ASSINATURAS) {
    if (cabecalho.length < assinatura.bytes.length) continue;

    const casa = assinatura.bytes.every((byte, indice) => cabecalho[indice] === byte);

    if (casa) return assinatura.tipo;
  }

  return null;
}

/** Tipos que o `content-type` pode declarar, mapeados ao nosso enum. */
const POR_CONTENT_TYPE: Readonly<Record<string, TipoDeArquivo>> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'text/csv': 'CSV',
  'application/csv': 'CSV',
};

/**
 * O arquivo pode ser aceito? (`M3-FR-009`)
 *
 * A ordem das checagens e barata-antes-de-cara: tamanho e o teste mais
 * rapido e o que protege a memoria, entao vem primeiro.
 */
export function aceitarArquivo(entrada: {
  readonly tamanhoBytes: number;
  readonly contentType: string;
  readonly cabecalho: Uint8Array;
}): ResultadoDaAceitacao {
  if (entrada.tamanhoBytes <= 0) {
    return { aceito: false, motivo: 'FILE_EMPTY' };
  }

  if (entrada.tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
    return { aceito: false, motivo: 'FILE_TOO_LARGE' };
  }

  const declarado = POR_CONTENT_TYPE[entrada.contentType.toLowerCase().split(';')[0]!.trim()];

  if (declarado === undefined) {
    return { aceito: false, motivo: 'FILE_TYPE_NOT_ALLOWED' };
  }

  const real = detectarTipo(entrada.cabecalho);

  // CSV e o unico sem assinatura: aceita-se o declarado, porque nao ha o que
  // conferir. O parser rejeita depois se o conteudo nao for tabular -- e ele
  // e determinista, ao contrario do OCR.
  if (declarado === 'CSV') {
    // Mas se a assinatura casar com OUTRO tipo, e mentira declarada: um PNG
    // enviado como `text/csv` nao e um CSV que por acaso comeca com bytes de
    // PNG.
    if (real !== null) {
      return { aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' };
    }

    return { aceito: true, tipo: 'CSV' };
  }

  if (real === null) {
    return { aceito: false, motivo: 'FILE_SIGNATURE_UNKNOWN' };
  }

  if (real !== declarado) {
    return { aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' };
  }

  return { aceito: true, tipo: real };
}
