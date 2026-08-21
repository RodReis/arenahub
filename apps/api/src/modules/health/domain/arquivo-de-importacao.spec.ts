import { describe, expect, it } from '@jest/globals';

import {
  aceitarArquivo,
  detectarTipo,
  TAMANHO_MAXIMO_BYTES,
} from './arquivo-de-importacao.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const TEXTO = new Uint8Array([0x74, 0x69, 0x70, 0x6f, 0x2c, 0x76]); // "tipo,v"

describe('detectarTipo', () => {
  it('reconhece PDF, PNG e JPEG pela assinatura', () => {
    expect(detectarTipo(PDF)).toBe('PDF');
    expect(detectarTipo(PNG)).toBe('PNG');
    expect(detectarTipo(JPEG)).toBe('JPEG');
  });

  /**
   * CSV nao tem magic number -- e texto puro. Devolver `null` e honesto;
   * fingir que reconheceu faria a checagem de coerencia mais adiante comparar
   * um palpite com outro palpite.
   */
  it('nao reconhece CSV, porque texto nao tem assinatura', () => {
    expect(detectarTipo(TEXTO)).toBeNull();
  });

  it('cabecalho curto demais nao casa por acidente', () => {
    // Os dois primeiros bytes do PNG, sem o resto: aceitar seria reconhecer
    // metade de uma assinatura.
    expect(detectarTipo(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('cabecalho vazio nao casa', () => {
    expect(detectarTipo(new Uint8Array([]))).toBeNull();
  });
});

describe('aceitarArquivo -- tamanho', () => {
  it('aceita arquivo dentro do limite', () => {
    expect(
      aceitarArquivo({
        tamanhoBytes: 1024,
        contentType: 'application/pdf',
        cabecalho: PDF,
      }),
    ).toEqual({ aceito: true, tipo: 'PDF' });
  });

  it('recusa arquivo vazio', () => {
    expect(
      aceitarArquivo({ tamanhoBytes: 0, contentType: 'application/pdf', cabecalho: PDF }),
    ).toMatchObject({ motivo: 'FILE_EMPTY' });
  });

  /**
   * O teto existe por SEGURANCA, nao por economia: sem ele, um upload de 2 GB
   * derruba a memoria do processo antes de qualquer validacao rodar.
   */
  it('recusa arquivo acima do teto', () => {
    expect(
      aceitarArquivo({
        tamanhoBytes: TAMANHO_MAXIMO_BYTES + 1,
        contentType: 'application/pdf',
        cabecalho: PDF,
      }),
    ).toMatchObject({ motivo: 'FILE_TOO_LARGE' });
  });

  it('o tamanho e conferido ANTES do tipo', () => {
    // Barato antes de caro: nao faz sentido inspecionar assinatura de um
    // arquivo que ja vai ser recusado pelo tamanho.
    expect(
      aceitarArquivo({
        tamanhoBytes: TAMANHO_MAXIMO_BYTES + 1,
        contentType: 'application/x-msdownload',
        cabecalho: PDF,
      }),
    ).toMatchObject({ motivo: 'FILE_TOO_LARGE' });
  });
});

describe('aceitarArquivo -- o tipo vem do CONTEUDO, nao do cliente', () => {
  it('recusa content-type fora da lista', () => {
    expect(
      aceitarArquivo({
        tamanhoBytes: 100,
        contentType: 'application/x-msdownload',
        cabecalho: PDF,
      }),
    ).toMatchObject({ motivo: 'FILE_TYPE_NOT_ALLOWED' });
  });

  /**
   * O caso que a checagem de assinatura existe para pegar: executavel
   * renomeado para `.pdf` e enviado como `application/pdf`. Extensao e
   * `content-type` sao AMBOS controlados por quem envia.
   */
  it('recusa executavel disfarçado de PDF', () => {
    const executavel = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // "MZ" -- PE

    expect(
      aceitarArquivo({
        tamanhoBytes: 100,
        contentType: 'application/pdf',
        cabecalho: executavel,
      }),
    ).toMatchObject({ motivo: 'FILE_SIGNATURE_UNKNOWN' });
  });

  it('recusa PNG declarado como PDF', () => {
    expect(
      aceitarArquivo({ tamanhoBytes: 100, contentType: 'application/pdf', cabecalho: PNG }),
    ).toMatchObject({ motivo: 'FILE_SIGNATURE_MISMATCH' });
  });

  it('aceita content-type com charset', () => {
    // `text/csv; charset=utf-8` e o que o navegador manda de verdade.
    expect(
      aceitarArquivo({
        tamanhoBytes: 100,
        contentType: 'text/csv; charset=utf-8',
        cabecalho: TEXTO,
      }),
    ).toEqual({ aceito: true, tipo: 'CSV' });
  });

  it('aceita as duas grafias de JPEG', () => {
    expect(
      aceitarArquivo({ tamanhoBytes: 100, contentType: 'image/jpeg', cabecalho: JPEG }).aceito,
    ).toBe(true);
    expect(
      aceitarArquivo({ tamanhoBytes: 100, contentType: 'image/jpg', cabecalho: JPEG }).aceito,
    ).toBe(true);
  });
});

describe('aceitarArquivo -- CSV, o caso sem assinatura', () => {
  it('aceita CSV pelo content-type, porque nao ha o que conferir', () => {
    expect(
      aceitarArquivo({ tamanhoBytes: 100, contentType: 'text/csv', cabecalho: TEXTO }),
    ).toEqual({ aceito: true, tipo: 'CSV' });
  });

  /**
   * Um PNG enviado como `text/csv` nao e um CSV que por acaso comeca com
   * bytes de PNG -- e mentira declarada, e o unico jeito de pegar e notar que
   * a assinatura casou com OUTRO tipo.
   */
  it('recusa binario declarado como CSV', () => {
    expect(
      aceitarArquivo({ tamanhoBytes: 100, contentType: 'text/csv', cabecalho: PNG }),
    ).toMatchObject({ motivo: 'FILE_SIGNATURE_MISMATCH' });
  });
});
