import { describe, expect, it } from '@jest/globals';
import { proximaVersao, totemOcupado } from './kiosk-admin-config.service.js';

describe('proximaVersao', () => {
  it('comeca em 1 quando a camada nunca publicou', () => {
    expect(proximaVersao([])).toBe(1);
  });

  it('avanca a partir do maior version da camada', () => {
    expect(proximaVersao([1, 2, 5])).toBe(6);
  });

  it('ignora buraco na sequencia -- o que importa e nunca reusar numero', () => {
    expect(proximaVersao([1, 7])).toBe(8);
  });
});

describe('totemOcupado', () => {
  const agora = new Date('2026-08-26T12:00:00.000Z');

  it('sessao aberta e no prazo ocupa o totem', () => {
    const sessoes = [{ endedAt: null, expiresAt: new Date('2026-08-26T12:00:30.000Z') }];

    expect(totemOcupado(sessoes, agora)).toBe(true);
  });

  it('sessao encerrada NAO ocupa', () => {
    const sessoes = [
      { endedAt: new Date('2026-08-26T11:59:00.000Z'), expiresAt: new Date('2026-08-26T12:00:30.000Z') },
    ];

    expect(totemOcupado(sessoes, agora)).toBe(false);
  });

  it('sessao EXPIRADA mas nao encerrada NAO ocupa -- aluno abandonou o totem', () => {
    const sessoes = [{ endedAt: null, expiresAt: new Date('2026-08-26T11:59:00.000Z') }];

    expect(totemOcupado(sessoes, agora)).toBe(false);
  });

  it('sem sessao nenhuma NAO ocupa', () => {
    expect(totemOcupado([], agora)).toBe(false);
  });
});
