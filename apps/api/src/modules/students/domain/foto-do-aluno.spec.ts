import { describe, expect, it } from '@jest/globals';

import {
  aceitarFotoDoAluno,
  chaveDeFotoPertenceA,
  montarChaveDeFoto,
  prefixoDeFotoDoAluno,
  TAMANHO_MAXIMO_DE_FOTO_BYTES,
} from './foto-do-aluno.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('aceitarFotoDoAluno', () => {
  it('aceita PNG com assinatura correta', () => {
    expect(aceitarFotoDoAluno({ conteudo: PNG, contentType: 'image/png' })).toEqual({
      aceito: true,
    });
  });

  it('aceita JPEG com assinatura correta', () => {
    expect(aceitarFotoDoAluno({ conteudo: JPEG, contentType: 'image/jpeg' })).toEqual({
      aceito: true,
    });
  });

  it('recusa arquivo maior que o teto', () => {
    const grande = new Uint8Array(TAMANHO_MAXIMO_DE_FOTO_BYTES + 1);
    grande.set(PNG);

    expect(aceitarFotoDoAluno({ conteudo: grande, contentType: 'image/png' })).toEqual({
      aceito: false,
      motivo: 'FILE_TOO_LARGE',
    });
  });

  it('recusa arquivo vazio', () => {
    expect(
      aceitarFotoDoAluno({ conteudo: new Uint8Array(0), contentType: 'image/png' }),
    ).toEqual({
      aceito: false,
      motivo: 'FILE_EMPTY',
    });
  });

  it('recusa content-type fora da lista, incluindo SVG', () => {
    expect(
      aceitarFotoDoAluno({ conteudo: PNG, contentType: 'image/svg+xml' }),
    ).toEqual({
      aceito: false,
      motivo: 'FILE_TYPE_NOT_ALLOWED',
    });
  });

  it('recusa PNG declarado cujos bytes nao sao PNG', () => {
    expect(aceitarFotoDoAluno({ conteudo: JPEG, contentType: 'image/png' })).toEqual({
      aceito: false,
      motivo: 'FILE_SIGNATURE_MISMATCH',
    });
  });

  it('recusa JPEG declarado cujos bytes nao sao JPEG', () => {
    expect(aceitarFotoDoAluno({ conteudo: PNG, contentType: 'image/jpeg' })).toEqual({
      aceito: false,
      motivo: 'FILE_SIGNATURE_MISMATCH',
    });
  });
});

describe('montarChaveDeFoto / chaveDeFotoPertenceA', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const studentId = '22222222-2222-2222-2222-222222222222';
  const outroTenantId = '33333333-3333-3333-3333-333333333333';

  it('monta chave sob o prefixo do tenant e do aluno', () => {
    const chave = montarChaveDeFoto(tenantId, studentId, 'image/png');

    expect(chave).toBe(`tenants/${tenantId}/students/${studentId}/photo.png`);
  });

  it('usa extensao jpg para image/jpeg', () => {
    expect(montarChaveDeFoto(tenantId, studentId, 'image/jpeg')).toBe(
      `tenants/${tenantId}/students/${studentId}/photo.jpg`,
    );
  });

  it('reconhece chave pertencente ao tenant', () => {
    const chave = montarChaveDeFoto(tenantId, studentId, 'image/png');

    expect(chaveDeFotoPertenceA(chave, tenantId)).toBe(true);
  });

  it('recusa chave de outro tenant', () => {
    const chave = montarChaveDeFoto(outroTenantId, studentId, 'image/png');

    expect(chaveDeFotoPertenceA(chave, tenantId)).toBe(false);
  });

  it('prefixo termina em barra para nao casar com prefixo vizinho', () => {
    expect(prefixoDeFotoDoAluno(tenantId)).toBe(`tenants/${tenantId}/students/`);
  });
});
