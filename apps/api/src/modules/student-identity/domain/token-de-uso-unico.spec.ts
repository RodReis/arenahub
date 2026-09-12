import { describe, expect, it } from '@jest/globals';
import { consumirTokenDeUsoUnico } from './token-de-uso-unico.js';

const AGORA = new Date('2026-09-12T12:00:00Z');
const FUTURO = new Date('2026-09-12T13:00:00Z');
const PASSADO = new Date('2026-09-12T11:00:00Z');

const base = { status: 'PENDING' as const, expiresAt: FUTURO, studentId: 'aluno-1' };

describe('consumirTokenDeUsoUnico', () => {
  it('aceita token pendente dentro da validade', () => {
    expect(consumirTokenDeUsoUnico(base, AGORA)).toEqual({ ok: true });
  });

  it('recusa token ja consumido', () => {
    expect(consumirTokenDeUsoUnico({ ...base, status: 'CONSUMED' }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_JA_USADO',
    });
  });

  it('recusa token revogado', () => {
    expect(consumirTokenDeUsoUnico({ ...base, status: 'REVOKED' }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_REVOGADO',
    });
  });

  it('recusa token expirado', () => {
    expect(consumirTokenDeUsoUnico({ ...base, expiresAt: PASSADO }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_EXPIRADO',
    });
  });

  it('trata o instante EXATO da expiracao como expirado', () => {
    // A borda importa: `<` em vez de `<=` deixa passar o token no
    // milissegundo da virada, e o teste que so usa "passado" e "futuro"
    // nunca pega isso.
    expect(consumirTokenDeUsoUnico({ ...base, expiresAt: AGORA }, AGORA)).toEqual({
      ok: false,
      motivo: 'TOKEN_EXPIRADO',
    });
  });

  it('confere o ESTADO antes da validade -- token usado e expirado acusa uso', () => {
    // A ordem de checagem e observavel pelo chamador. Se o expirado vencesse,
    // a resposta mudaria de "ja usado" para "expirado" conforme o relogio, e
    // o mesmo token daria duas respostas diferentes em momentos diferentes.
    expect(
      consumirTokenDeUsoUnico({ ...base, status: 'CONSUMED', expiresAt: PASSADO }, AGORA),
    ).toEqual({ ok: false, motivo: 'TOKEN_JA_USADO' });
  });
});
