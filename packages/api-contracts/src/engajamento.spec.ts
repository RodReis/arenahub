import { describe, expect, it } from '@jest/globals';

import { aliasPublicoSchema, preferenciasSchema } from './engajamento.js';

describe('preferenciasSchema', () => {
  it('aceita RANKING', () => {
    const resultado = preferenciasSchema.safeParse({
      finalidade: 'RANKING',
      participa: true,
      idempotencyKey: 'chave-de-teste-1',
    });

    expect(resultado.success).toBe(true);
  });

  it('recusa sem idempotencyKey', () => {
    const resultado = preferenciasSchema.safeParse({ finalidade: 'RANKING', participa: true });

    expect(resultado.success).toBe(false);
  });

  it('recusa idempotencyKey com menos de 8 caracteres', () => {
    const resultado = preferenciasSchema.safeParse({
      finalidade: 'RANKING',
      participa: true,
      idempotencyKey: 'curta',
    });

    expect(resultado.success).toBe(false);
  });

  const finalidadesDormentes: readonly string[] = [
    'CHALLENGE',
    'ENGAGEMENT_PUSH',
    'PHYSICAL_EVOLUTION_RANKING',
  ];

  it.each(finalidadesDormentes)(
    'recusa %s -- dormente no banco, ausente do contrato desta fatia',
    (finalidade) => {
      const resultado = preferenciasSchema.safeParse({
        finalidade,
        participa: true,
        idempotencyKey: 'chave-de-teste-1',
      });

      expect(resultado.success).toBe(false);
    },
  );
});

describe('aliasPublicoSchema', () => {
  it('aceita PRIMEIRO_NOME sem alias', () => {
    const resultado = aliasPublicoSchema.safeParse({
      identityChoice: 'PRIMEIRO_NOME',
      alias: null,
      version: null,
    });

    expect(resultado.success).toBe(true);
  });

  it('aceita ANONIMO sem alias', () => {
    const resultado = aliasPublicoSchema.safeParse({
      identityChoice: 'ANONIMO',
      alias: null,
      version: null,
    });

    expect(resultado.success).toBe(true);
  });

  it('recusa APELIDO sem alias', () => {
    const resultado = aliasPublicoSchema.safeParse({
      identityChoice: 'APELIDO',
      alias: null,
      version: null,
    });

    expect(resultado.success).toBe(false);
  });

  it('aceita APELIDO com alias', () => {
    const resultado = aliasPublicoSchema.safeParse({
      identityChoice: 'APELIDO',
      alias: 'Furacao',
      version: null,
    });

    expect(resultado.success).toBe(true);
  });

  it('aceita alias ate 64 caracteres -- maior que ALIAS_MAX (24) de proposito: o boundary aceita, a triagem sinaliza LONGO_DEMAIS e o moderador decide', () => {
    const resultado = aliasPublicoSchema.safeParse({
      identityChoice: 'APELIDO',
      alias: 'a'.repeat(64),
      version: null,
    });

    expect(resultado.success).toBe(true);
  });

  it('recusa alias com mais de 64 caracteres', () => {
    const resultado = aliasPublicoSchema.safeParse({
      identityChoice: 'APELIDO',
      alias: 'a'.repeat(65),
      version: null,
    });

    expect(resultado.success).toBe(false);
  });

  it('aceita version numerica para compare-and-swap', () => {
    const resultado = aliasPublicoSchema.safeParse({
      identityChoice: 'APELIDO',
      alias: 'Furacao',
      version: 3,
    });

    expect(resultado.success).toBe(true);
  });
});
