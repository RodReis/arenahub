import { describe, expect, it } from '@jest/globals';

import {
  chaveDeMidiaPertenceA,
  montarChaveDeCadastro,
  montarChaveDeMidia,
} from './object-storage.port.js';

describe('montarChaveDeCadastro', () => {
  it('nao carrega CPF, nome nem matricula -- so dois UUIDs', () => {
    expect(montarChaveDeCadastro('t-1', 'i-1')).toBe('tenants/t-1/biometrics/i-1/enrollment');
  });
});

describe('chave de midia do totem (F51)', () => {
  it('escopa por tenant e por unidade', () => {
    expect(montarChaveDeMidia('t1', 'u1', 'abc')).toBe('tenants/t1/kiosk-media/u1/abc.mp4');
  });

  it('a chave que a escrita monta pertence a quem a montou', () => {
    const chave = montarChaveDeMidia('t1', 'u1', 'abc');

    expect(chaveDeMidiaPertenceA(chave, 't1', 'u1')).toBe(true);
  });

  it('chave de outro TENANT nao pertence', () => {
    expect(chaveDeMidiaPertenceA('tenants/t2/kiosk-media/u1/a.mp4', 't1', 'u1')).toBe(false);
  });

  it('unidade cujo id e PREFIXO de outra nao alcanca a midia dela', () => {
    // Sem a barra final no prefixo, `u1` casaria com `u10`.
    expect(chaveDeMidiaPertenceA('tenants/t1/kiosk-media/u10/a.mp4', 't1', 'u1')).toBe(false);
  });

  it('fuga de diretorio nao pertence', () => {
    expect(chaveDeMidiaPertenceA('../../tenants/t2/segredo.mp4', 't1', 'u1')).toBe(false);
  });
});

/**
 * A EXTENSAO SEGUE O CONTEUDO (28/08/2026).
 *
 * A chave nascia com `.mp4` fixo, de quando video era a unica midia do
 * totem. Com o upload de logotipo, isso gravava PNG sob nome `.mp4` --
 * funcionava (o `content-type` do storage e quem manda ao servir), mas
 * mentia para quem abrisse o bucket.
 *
 * Encontrado NA TELA, nao no teste: o primeiro upload real de PNG gravou
 * `4e3204b8-....mp4` no banco.
 */
describe('montarChaveDeMidia -- extensao por content-type', () => {
  const chave = (contentType?: string) =>
    montarChaveDeMidia('t1', 'u1', 'abc', contentType);

  it('mantem .mp4 quando ninguem passa tipo -- as chamadas antigas nao mudam', () => {
    expect(chave()).toBe('tenants/t1/kiosk-media/u1/abc.mp4');
  });

  it('usa a extensao de cada imagem aceita', () => {
    expect(chave('image/png')).toMatch(/\.png$/);
    expect(chave('image/jpeg')).toMatch(/\.jpg$/);
    expect(chave('image/webp')).toMatch(/\.webp$/);
  });

  it('tipo desconhecido cai em .mp4 em vez de lancar', () => {
    expect(chave('application/octet-stream')).toMatch(/\.mp4$/);
  });

  /*
   * O QUE NAO PODE MUDAR: a extensao nao participa do pertencimento. Chave
   * antiga com `.mp4` tem de continuar valendo sem migracao -- senao todo
   * video ja publicado sumiria da tela publica.
   */
  it('chave de imagem continua pertencendo ao prefixo do tenant', () => {
    expect(chaveDeMidiaPertenceA(chave('image/png'), 't1', 'u1')).toBe(true);
    expect(chaveDeMidiaPertenceA(chave('image/png'), 'OUTRO', 'u1')).toBe(false);
  });
});
