import { describe, expect, it } from '@jest/globals';

import {
  CONTENT_TYPE_DE_MIDIA,
  TAMANHO_MAXIMO_DE_MIDIA_BYTES,
  aceitarMidia,
  pareceMp4,
} from './midia-do-totem.js';

/** Cabecalho de MP4 real: box de tamanho + `ftyp` + marca. */
function cabecalhoMp4(): Uint8Array {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x20, // tamanho da box
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
  ]);
}

describe('pareceMp4 -- a assinatura mora no offset 4, nao no 0', () => {
  it('aceita um cabecalho ISO-BMFF legitimo', () => {
    expect(pareceMp4(cabecalhoMp4())).toBe(true);
  });

  it('recusa `ftyp` colado no byte 0 -- que nao e MP4 nenhum', () => {
    const errado = new Uint8Array([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

    expect(pareceMp4(errado)).toBe(false);
  });

  it('recusa PNG mesmo com nome e content-type de video', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(pareceMp4(png)).toBe(false);
  });

  it('recusa cabecalho curto demais para conter a assinatura', () => {
    expect(pareceMp4(new Uint8Array([0x00, 0x00, 0x00]))).toBe(false);
  });
});

describe('aceitarMidia', () => {
  const valido = {
    tamanhoBytes: 1024,
    contentType: CONTENT_TYPE_DE_MIDIA,
    cabecalho: cabecalhoMp4(),
  };

  it('aceita MP4 dentro do teto', () => {
    expect(aceitarMidia(valido)).toEqual({ aceito: true });
  });

  it('recusa acima de 40 MB', () => {
    expect(
      aceitarMidia({ ...valido, tamanhoBytes: TAMANHO_MAXIMO_DE_MIDIA_BYTES + 1 }),
    ).toEqual({ aceito: false, motivo: 'FILE_TOO_LARGE' });
  });

  it('aceita EXATAMENTE 40 MB -- o teto e inclusivo', () => {
    expect(
      aceitarMidia({ ...valido, tamanhoBytes: TAMANHO_MAXIMO_DE_MIDIA_BYTES }),
    ).toEqual({ aceito: true });
  });

  it('recusa arquivo vazio', () => {
    expect(aceitarMidia({ ...valido, tamanhoBytes: 0 })).toEqual({
      aceito: false,
      motivo: 'FILE_EMPTY',
    });
  });

  it('recusa content-type fora da lista fechada', () => {
    expect(aceitarMidia({ ...valido, contentType: 'video/quicktime' })).toEqual({
      aceito: false,
      motivo: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  it('recusa `video/*` -- coringa nao e lista fechada', () => {
    expect(aceitarMidia({ ...valido, contentType: 'video/*' })).toEqual({
      aceito: false,
      motivo: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  it('recusa quando o content-type mente sobre o conteudo', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    expect(aceitarMidia({ ...valido, cabecalho: png })).toEqual({
      aceito: false,
      motivo: 'FILE_SIGNATURE_MISMATCH',
    });
  });
});
