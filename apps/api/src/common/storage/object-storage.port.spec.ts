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
