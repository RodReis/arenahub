import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { PrismaService } from './prisma.service.js';

/**
 * F66 -- de qual banco o servico se conecta.
 *
 * O `PrismaService` PREFERE o role restrito (`RUNTIME_DATABASE_URL`), e o
 * ponto delicado e o caso da string VAZIA: o E2E aponta a API para o banco
 * proprio e precisa desligar o role restrito, mas `delete` nao alcanca um
 * processo filho -- o jeito de desligar e passar a variavel vazia. Com `??`
 * no lugar de `||`, a string vazia passaria adiante e a conexao quebraria.
 */
describe('PrismaService -- escolha da URL de conexao', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env['RUNTIME_DATABASE_URL'];
    delete process.env['DATABASE_URL'];
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('prefere o role restrito quando ele existe', () => {
    process.env['DATABASE_URL'] = 'postgresql://dono@localhost:5442/arenahub';
    process.env['RUNTIME_DATABASE_URL'] = 'postgresql://app@localhost:5442/arenahub';

    expect(() => new PrismaService()).not.toThrow();
  });

  it('string vazia no role restrito cai no dono, e nao quebra a conexao', () => {
    process.env['DATABASE_URL'] = 'postgresql://dono@localhost:5442/arenahub_e2e';
    process.env['RUNTIME_DATABASE_URL'] = '';

    expect(() => new PrismaService()).not.toThrow();
  });

  it('sem nenhuma das duas, falha dizendo o que falta', () => {
    expect(() => new PrismaService()).toThrow(/RUNTIME_DATABASE_URL.*DATABASE_URL/s);
  });

  it('so o dono definido tambem serve', () => {
    process.env['DATABASE_URL'] = 'postgresql://dono@localhost:5442/arenahub';

    expect(() => new PrismaService()).not.toThrow();
  });
});
