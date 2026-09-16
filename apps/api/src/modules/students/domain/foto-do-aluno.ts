/**
 * Regras de aceitacao da foto do aluno (F72, issue #348).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * IRMA de `platform/domain/identidade-visual.ts`, e nao uma extensao dela:
 * aqui SVG e RECUSADO de proposito -- e foto de pessoa, nunca vetor -- e o
 * teto de tamanho e maior, porque o arquivo nao entra na tela de login (a
 * ficha do aluno so carrega logado, com conexao ja estabelecida).
 */

export type MotivoDeRecusaDeFoto =
  | 'FILE_TOO_LARGE'
  | 'FILE_EMPTY'
  | 'FILE_TYPE_NOT_ALLOWED'
  /** Os bytes nao sao do formato declarado. */
  | 'FILE_SIGNATURE_MISMATCH';

export type ResultadoDaAceitacaoDeFoto =
  | { readonly aceito: true }
  | { readonly aceito: false; readonly motivo: MotivoDeRecusaDeFoto };

/** Teto de 5 MB -- folgado para foto de celular sem abrir a porta para vídeo. */
export const TAMANHO_MAXIMO_DE_FOTO_BYTES = 5 * 1024 * 1024;

/** Lista fechada. Nada de SVG: foto de pessoa nao e vetor. */
export const CONTENT_TYPES_DE_FOTO = ['image/png', 'image/jpeg'] as const;

export type ContentTypeDeFoto = (typeof CONTENT_TYPES_DE_FOTO)[number];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;

function comecaCom(cabecalho: Uint8Array, assinatura: readonly number[]): boolean {
  if (cabecalho.length < assinatura.length) return false;

  return assinatura.every((byte, indice) => cabecalho[indice] === byte);
}

/** Os bytes sao de PNG? */
export function pareceBytesDePng(cabecalho: Uint8Array): boolean {
  return comecaCom(cabecalho, PNG);
}

/** Os bytes sao de JPEG? */
export function pareceBytesDeJpeg(cabecalho: Uint8Array): boolean {
  return comecaCom(cabecalho, JPEG);
}

/**
 * A foto pode ser aceita?
 *
 * Ordem barata-antes-de-cara, a mesma de `aceitarArquivoDeIdentidade`:
 * tamanho primeiro, conteudo por ultimo.
 */
export function aceitarFotoDoAluno(entrada: {
  readonly conteudo: Uint8Array;
  readonly contentType: string;
}): ResultadoDaAceitacaoDeFoto {
  if (entrada.conteudo.byteLength > TAMANHO_MAXIMO_DE_FOTO_BYTES) {
    return { aceito: false, motivo: 'FILE_TOO_LARGE' };
  }

  if (entrada.conteudo.byteLength === 0) {
    return { aceito: false, motivo: 'FILE_EMPTY' };
  }

  const tipo = entrada.contentType.toLowerCase();

  if (!CONTENT_TYPES_DE_FOTO.includes(tipo as ContentTypeDeFoto)) {
    return { aceito: false, motivo: 'FILE_TYPE_NOT_ALLOWED' };
  }

  /*
   * A assinatura tem de bater com o TIPO DECLARADO, e nao apenas ser de
   * alguma imagem -- senao a lista fechada acima nao trava nada: bastaria
   * declarar `image/png` e enviar um JPEG (ou o contrario) para pular a
   * checagem.
   */
  const cabecalhoBate =
    tipo === 'image/png' ? pareceBytesDePng(entrada.conteudo) : pareceBytesDeJpeg(entrada.conteudo);

  if (!cabecalhoBate) {
    return { aceito: false, motivo: 'FILE_SIGNATURE_MISMATCH' };
  }

  return { aceito: true };
}

/**
 * A chave do objeto da foto do aluno.
 *
 * Formato: `tenants/{tenantId}/students/{studentId}/photo.{ext}`.
 *
 * SERVIDOR GERA, cliente nunca escolhe prefixo -- mesma disciplina de
 * `montarChaveDeIdentidade`. Nome FIXO por aluno, e nao UUID aleatorio: so
 * existe uma foto por aluno e o upload novo substitui a anterior.
 */
export function montarChaveDeFoto(
  tenantId: string,
  studentId: string,
  contentType: ContentTypeDeFoto,
): string {
  const extensao = contentType === 'image/png' ? 'png' : 'jpg';

  return `tenants/${tenantId}/students/${studentId}/photo.${extensao}`;
}

/**
 * O prefixo sob o qual as fotos de alunos deste tenant podem morar.
 *
 * Existe separado porque a LEITURA precisa conferir o que a ESCRITA montou:
 * a chave vem da coluna do aluno, que e dado de banco, e servir uma chave sem
 * conferir o prefixo entregaria a foto de um aluno de outro tenant a quem
 * conseguisse escrever nessa coluna.
 *
 * Termina em `/` de proposito -- mesma razao de `prefixoDeIdentidade`.
 */
export function prefixoDeFotoDoAluno(tenantId: string): string {
  return `tenants/${tenantId}/students/`;
}

/** A chave pertence a foto de um aluno deste tenant? */
export function chaveDeFotoPertenceA(chave: string, tenantId: string): boolean {
  return chave.startsWith(prefixoDeFotoDoAluno(tenantId));
}
