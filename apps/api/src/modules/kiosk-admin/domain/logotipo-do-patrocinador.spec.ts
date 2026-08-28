import { describe, expect, it } from '@jest/globals';

import {
  TAMANHO_MAXIMO_DE_LOGOTIPO_BYTES,
  aceitarLogotipo,
  pareceImagemDeLogotipo,
} from './logotipo-do-patrocinador.js';

/** Cabecalho valido de cada formato, com o resto zerado. */
function cabecalho(bytes: readonly number[]): Uint8Array {
  const buffer = new Uint8Array(12);

  bytes.forEach((byte, indice) => {
    buffer[indice] = byte;
  });

  return buffer;
}

const PNG = cabecalho([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = cabecalho([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = cabecalho([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe('pareceImagemDeLogotipo', () => {
  it('reconhece PNG', () => {
    expect(pareceImagemDeLogotipo(PNG)).toBe(true);
  });

  it('reconhece JPEG', () => {
    expect(pareceImagemDeLogotipo(JPEG)).toBe(true);
  });

  it('reconhece WebP', () => {
    expect(pareceImagemDeLogotipo(WEBP)).toBe(true);
  });

  /**
   * `RIFF` SOZINHO NAO BASTA -- e a armadilha que este teste existe para
   * travar.
   *
   * `RIFF` abre WAV e AVI tambem. Uma checagem que so olhasse os quatro
   * primeiros bytes aceitaria um audio renomeado para `.webp`, e o antivirus
   * NAO o recusaria (WAV nao e malware). O arquivo entraria no storage e a
   * faixa mostraria uma imagem quebrada na parede.
   */
  it('recusa RIFF que nao e WEBP -- um WAV renomeado', () => {
    const wav = cabecalho([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]); // 'RIFF' + 'WAVE'

    expect(pareceImagemDeLogotipo(wav)).toBe(false);
  });

  /** SVG e XML: comeca com `<`, nunca com assinatura binaria. */
  it('recusa SVG, que e XML e poderia carregar script', () => {
    const svg = cabecalho([0x3c, 0x3f, 0x78, 0x6d, 0x6c]); // '<?xml'

    expect(pareceImagemDeLogotipo(svg)).toBe(false);
  });

  it('recusa cabecalho curto demais para decidir', () => {
    expect(pareceImagemDeLogotipo(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});

describe('aceitarLogotipo', () => {
  const valido = {
    tamanhoBytes: 1024,
    contentType: 'image/png',
    cabecalho: PNG,
  };

  it('aceita PNG dentro do teto', () => {
    expect(aceitarLogotipo(valido)).toEqual({ aceito: true });
  });

  it('aceita content-type em maiuscula', () => {
    expect(aceitarLogotipo({ ...valido, contentType: 'IMAGE/PNG' })).toEqual({ aceito: true });
  });

  it('recusa acima do teto', () => {
    expect(
      aceitarLogotipo({ ...valido, tamanhoBytes: TAMANHO_MAXIMO_DE_LOGOTIPO_BYTES + 1 }),
    ).toEqual({ aceito: false, motivo: 'FILE_TOO_LARGE' });
  });

  it('recusa arquivo vazio', () => {
    expect(aceitarLogotipo({ ...valido, tamanhoBytes: 0 })).toEqual({
      aceito: false,
      motivo: 'FILE_EMPTY',
    });
  });

  /** `image/svg+xml` nao esta na lista fechada -- ver o cabecalho do modulo. */
  it('recusa SVG pelo content-type', () => {
    expect(aceitarLogotipo({ ...valido, contentType: 'image/svg+xml' })).toEqual({
      aceito: false,
      motivo: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  it('recusa video, mesmo que o de midia aceite', () => {
    expect(aceitarLogotipo({ ...valido, contentType: 'video/mp4' })).toEqual({
      aceito: false,
      motivo: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  /**
   * O CONTENT-TYPE MENTE: quem envia o escolhe. Declarar `image/png` e
   * mandar outra coisa e o caminho obvio de quem quer burlar a lista.
   */
  it('recusa quando o tipo declarado nao bate com os bytes', () => {
    expect(aceitarLogotipo({ ...valido, cabecalho: JPEG })).toEqual({
      aceito: false,
      motivo: 'FILE_SIGNATURE_MISMATCH',
    });
  });

  it('aceita JPEG declarado como JPEG', () => {
    expect(
      aceitarLogotipo({ ...valido, contentType: 'image/jpeg', cabecalho: JPEG }),
    ).toEqual({ aceito: true });
  });

  it('aceita WebP declarado como WebP', () => {
    expect(
      aceitarLogotipo({ ...valido, contentType: 'image/webp', cabecalho: WEBP }),
    ).toEqual({ aceito: true });
  });

  /** Tamanho antes de tipo: o teste que protege a memoria roda primeiro. */
  it('reclama do tamanho antes do tipo quando os dois estao errados', () => {
    expect(
      aceitarLogotipo({
        tamanhoBytes: TAMANHO_MAXIMO_DE_LOGOTIPO_BYTES + 1,
        contentType: 'image/svg+xml',
        cabecalho: PNG,
      }),
    ).toEqual({ aceito: false, motivo: 'FILE_TOO_LARGE' });
  });
});
