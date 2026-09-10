import { describe, expect, it } from 'vitest';

import { comContexto, contextoRls, gucsDoContexto, SemContextoDeTenantError } from './rls.js';

const TENANT_A = '9b46057c-8325-48f5-844a-9e18f836713b';

describe('gucsDoContexto', () => {
  it('contexto de tenant seta so app.tenant_id', () => {
    expect(gucsDoContexto({ kind: 'tenant', tenantId: TENANT_A })).toEqual([
      ['app.tenant_id', TENANT_A],
    ]);
  });

  it('contexto system em nome de um tenant seta o ator E o tenant', () => {
    // 'system' descreve QUEM roda (worker, seed), nao permissao de
    // atravessar tenant -- por isso o tenant continua obrigatorio.
    expect(gucsDoContexto({ kind: 'system', tenantId: TENANT_A })).toEqual([
      ['app.actor', 'system'],
      ['app.tenant_id', TENANT_A],
    ]);
  });

  it('contexto platform seta so o ator, porque le entre tenants por desenho', () => {
    expect(gucsDoContexto({ kind: 'platform' })).toEqual([['app.actor', 'platform']]);
  });

  it('recusa tenantId que nao e uuid', () => {
    expect(() =>
      gucsDoContexto({ kind: 'tenant', tenantId: "x'; DROP TABLE students; --" }),
    ).toThrow(/uuid/i);
  });

  it('recusa contexto system sem tenant, que passaria batido pela politica', () => {
    // Um worker sem tenant setaria so app.actor='system'. A politica NAO
    // aceita 'system', entao a query nao veria nada -- e zero linhas e
    // indistinguivel de "nao ha dados". Falhar aqui e mais barato.
    expect(() => gucsDoContexto({ kind: 'system' } as never)).toThrow(/tenant/i);
  });
});

describe('comContexto', () => {
  it('o contexto vale dentro do escopo', async () => {
    const visto = await comContexto({ kind: 'tenant', tenantId: TENANT_A }, () =>
      Promise.resolve(contextoRls.getStore()),
    );

    expect(visto).toEqual({ kind: 'tenant', tenantId: TENANT_A });
  });

  it('fora do escopo nao ha contexto', () => {
    expect(contextoRls.getStore()).toBeUndefined();
  });

  it('escopos concorrentes nao se misturam', async () => {
    // O pool de conexoes e compartilhado. Se o contexto vazasse entre
    // execucoes simultaneas, um tenant leria o dado do outro -- e este e o
    // teste que separa AsyncLocalStorage de uma variavel de modulo.
    const outro = '00000000-0000-0000-0000-0000000000ff';

    const [a, b] = await Promise.all([
      comContexto({ kind: 'tenant', tenantId: TENANT_A }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return contextoRls.getStore();
      }),
      comContexto({ kind: 'tenant', tenantId: outro }, () =>
        Promise.resolve(contextoRls.getStore()),
      ),
    ]);

    expect(a).toEqual({ kind: 'tenant', tenantId: TENANT_A });
    expect(b).toEqual({ kind: 'tenant', tenantId: outro });
  });

  it('o contexto some quando o escopo fecha, mesmo se o corpo lancar', async () => {
    await expect(
      comContexto({ kind: 'tenant', tenantId: TENANT_A }, () =>
        Promise.reject(new Error('falhou no meio')),
      ),
    ).rejects.toThrow('falhou no meio');

    expect(contextoRls.getStore()).toBeUndefined();
  });
});

describe('SemContextoDeTenantError', () => {
  it('carrega codigo estavel, para a borda HTTP traduzir', () => {
    expect(new SemContextoDeTenantError().code).toBe('SEM_CONTEXTO_DE_TENANT');
  });
});
