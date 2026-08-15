import { describe, expect, it } from '@jest/globals';

import { RAZAO_DENY, decidirAcesso, type PermissaoLocal } from './access-decision.js';

const ENROLL = 'a'.repeat(32);
const AGORA = new Date('2026-08-14T12:00:00.000Z');

const permitido: PermissaoLocal = { externalEnrollId: ENROLL };

describe('decidirAcesso — M0-FR-005', () => {
  it('permite quem tem permissao sem prazo', () => {
    expect(decidirAcesso(permitido, AGORA)).toEqual({ resultado: 'ALLOW' });
  });

  it('nega quem a bancada nao conhece', () => {
    // Caso real: o software de fabrica cadastrou alguem que o ArenaHub nao
    // importou. O dispositivo reconhece; nos nao autorizamos.
    expect(decidirAcesso(null, AGORA)).toEqual({
      resultado: 'DENY',
      razao: RAZAO_DENY.DESCONHECIDO,
    });
  });

  it('permite ate o ultimo instante da validade, inclusive', () => {
    const permissao = { ...permitido, validaAte: AGORA };

    expect(decidirAcesso(permissao, AGORA).resultado).toBe('ALLOW');
  });

  it('nega um milissegundo depois', () => {
    // A fronteira e onde erro de sinal se esconde. Testar so "ontem" e
    // "amanha" deixaria `>` e `>=` indistinguiveis.
    const permissao = { ...permitido, validaAte: AGORA };

    expect(decidirAcesso(permissao, new Date(AGORA.getTime() + 1))).toEqual({
      resultado: 'DENY',
      razao: RAZAO_DENY.PERMISSAO_EXPIRADA,
    });
  });

  it('nega repeticao dentro da janela', () => {
    const permissao = {
      ...permitido,
      ultimoAllowEm: new Date(AGORA.getTime() - 1000),
    };

    expect(decidirAcesso(permissao, AGORA)).toEqual({
      resultado: 'DENY',
      razao: RAZAO_DENY.REPETICAO,
    });
  });

  it('permite exatamente no fim da janela', () => {
    const permissao = {
      ...permitido,
      ultimoAllowEm: new Date(AGORA.getTime() - 5000),
    };

    expect(decidirAcesso(permissao, AGORA).resultado).toBe('ALLOW');
  });

  it('expiracao vence repeticao — a razao mais grave prevalece', () => {
    // Quem esta expirado E repetindo deve ouvir que expirou: e a razao que
    // explica o problema real, e a que a recepcao precisa saber.
    const permissao = {
      ...permitido,
      validaAte: new Date(AGORA.getTime() - 1),
      ultimoAllowEm: new Date(AGORA.getTime() - 100),
    };

    expect(decidirAcesso(permissao, AGORA)).toEqual({
      resultado: 'DENY',
      razao: RAZAO_DENY.PERMISSAO_EXPIRADA,
    });
  });

  it('e deterministica: mesma entrada, mesma saida', () => {
    // M0-FR-005 exige decisao deterministica. Sem isso, reproduzir um
    // incidente vira sorte.
    const permissao = { ...permitido, validaAte: new Date(AGORA.getTime() + 1000) };
    const primeira = decidirAcesso(permissao, AGORA);

    for (let i = 0; i < 100; i += 1) {
      expect(decidirAcesso(permissao, AGORA)).toEqual(primeira);
    }
  });

  it('a razao e codigo estavel, nao texto', () => {
    // Correlacionar log de bancada com log de nuvem exige codigo que nao
    // muda quando alguem melhora a mensagem.
    const razao = decidirAcesso(null, AGORA);

    expect(razao).toHaveProperty('razao', 'DESCONHECIDO');
  });
});
