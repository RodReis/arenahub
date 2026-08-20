import { describe, expect, it } from 'vitest';

import {
  nascimentoEhPlausivel,
  origemDoDireito,
  parsearDataDoPacto,
  traduzirPerfil,
} from './dominio.js';

describe('parsearDataDoPacto', () => {
  it('converte AAAAMMDD em data', () => {
    expect(parsearDataDoPacto('20260803')?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('converte DD/MM/AAAA em data -- o formato do nascimento', () => {
    expect(parsearDataDoPacto('11/03/1996')?.toISOString()).toBe('1996-03-11T00:00:00.000Z');
  });

  it('devolve nulo para vazio', () => {
    expect(parsearDataDoPacto('')).toBeNull();
    expect(parsearDataDoPacto('   ')).toBeNull();
  });

  it('devolve nulo para data que nao existe no calendario', () => {
    // 31 de fevereiro: `Date` normalizaria para 2 ou 3 de marco em silencio.
    expect(parsearDataDoPacto('20260231')).toBeNull();
    expect(parsearDataDoPacto('31/02/2026')).toBeNull();
  });

  it('devolve nulo para lixo', () => {
    expect(parsearDataDoPacto('1E+11')).toBeNull();
    expect(parsearDataDoPacto('abc')).toBeNull();
  });
});

describe('nascimentoEhPlausivel', () => {
  const agora = new Date('2026-08-20T12:00:00.000Z');

  it('aceita nascimento de adulto', () => {
    expect(nascimentoEhPlausivel(new Date('1996-03-11T00:00:00.000Z'), agora)).toBe(true);
  });

  it('recusa nascimento no futuro -- o arquivo traz cinco', () => {
    expect(nascimentoEhPlausivel(new Date('2026-08-01T00:00:00.000Z'), agora)).toBe(false);
  });

  it('recusa bebe: ninguem de dois anos treina musculacao', () => {
    expect(nascimentoEhPlausivel(new Date('2025-09-25T00:00:00.000Z'), agora)).toBe(false);
  });

  it('recusa idade impossivel', () => {
    expect(nascimentoEhPlausivel(new Date('1890-01-01T00:00:00.000Z'), agora)).toBe(false);
  });
});

describe('traduzirPerfil', () => {
  it('mapeia os quatro codigos que a academia usa', () => {
    expect(traduzirPerfil('0')).toBe('ADMIN');
    expect(traduzirPerfil('1')).toBe('STUDENT');
    expect(traduzirPerfil('2')).toBe('STAFF');
    expect(traduzirPerfil('3')).toBe('TRAINER');
  });

  it('devolve nulo para codigo de teste -- 4, 5 e 6 so aparecem em lixo', () => {
    expect(traduzirPerfil('6')).toBeNull();
    expect(traduzirPerfil('')).toBeNull();
    expect(traduzirPerfil('9')).toBeNull();
  });
});

describe('origemDoDireito', () => {
  it('aluno entra por assinatura', () => {
    expect(origemDoDireito('STUDENT')).toBe('SUBSCRIPTION');
  });

  it('professor entra como personal, nao como funcionario', () => {
    expect(origemDoDireito('TRAINER')).toBe('PERSONAL_TRAINER');
  });

  it('funcionario e administrador entram por vinculo', () => {
    expect(origemDoDireito('STAFF')).toBe('EMPLOYEE');
    expect(origemDoDireito('ADMIN')).toBe('EMPLOYEE');
  });
});
