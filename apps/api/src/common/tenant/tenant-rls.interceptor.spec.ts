import { describe, expect, it } from '@jest/globals';
import { contextoRls } from '@arenahub/database';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import { paraContextoDeBanco } from './tenant-rls.interceptor.js';
import { TenantRlsInterceptor } from './tenant-rls.interceptor.js';
import type { TenantContext } from './tenant-context.js';

const TENANT_A = '9b46057c-8325-48f5-844a-9e18f836713b';

function contextoBase(): TenantContext {
  return {
    tenantId: TENANT_A,
    actorId: '22222222-2222-2222-2222-222222222222',
    sessionId: '33333333-3333-3333-3333-333333333333',
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };
}

describe('paraContextoDeBanco', () => {
  it('sessao normal vira contexto do proprio tenant', () => {
    expect(paraContextoDeBanco(contextoBase())).toEqual({
      kind: 'tenant',
      tenantId: TENANT_A,
    });
  });

  it('elevacao de suporte vira platform, que a politica aceita atravessar', () => {
    const elevado: TenantContext = {
      ...contextoBase(),
      supportElevation: { reason: 'ticket-123', expiresAt: new Date(Date.now() + 60_000) },
    };

    expect(paraContextoDeBanco(elevado)).toEqual({ kind: 'platform' });
  });

  it('elevacao expirada NAO vira platform', () => {
    // A elevacao expira (ADR-052 SS3). Se o contexto de banco continuasse
    // 'platform' depois do vencimento, a sessao seguiria lendo todos os
    // tenants -- o bypass silencioso que INV-005 proibe.
    const expirado: TenantContext = {
      ...contextoBase(),
      supportElevation: { reason: 'ticket-123', expiresAt: new Date(Date.now() - 1_000) },
    };

    expect(paraContextoDeBanco(expirado)).toEqual({ kind: 'tenant', tenantId: TENANT_A });
  });
});

/** Requisicao e handler minimos, no formato que o Nest entrega. */
function contextoDeExecucao(requisicao: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => requisicao }),
  } as never;
}

function handlerQueObserva(observado: { visto?: unknown }) {
  return {
    handle: () => {
      observado.visto = contextoRls.getStore();
      return of('ok');
    },
  } as never;
}

describe('TenantRlsInterceptor', () => {
  it('abre o escopo com o tenant da sessao autenticada', async () => {
    const observado: { visto?: unknown } = {};
    const interceptor = new TenantRlsInterceptor();

    await firstValueFrom(
      interceptor.intercept(
        contextoDeExecucao({ tenantContext: contextoBase() }),
        handlerQueObserva(observado),
      ),
    );

    expect(observado.visto).toEqual({ kind: 'tenant', tenantId: TENANT_A });
  });

  it('rota publica segue sem escopo, e nao inventa tenant', async () => {
    // Sem sessao nao ha tenant que se possa adivinhar. Qualquer query a
    // tabela protegida daqui falha -- e e o comportamento certo: inventar um
    // tenant seria o vazamento que a fatia inteira existe para impedir.
    const observado: { visto?: unknown } = {};
    const interceptor = new TenantRlsInterceptor();

    await firstValueFrom(
      interceptor.intercept(contextoDeExecucao({}), handlerQueObserva(observado)),
    );

    expect(observado.visto).toBeUndefined();
  });

  it('o escopo nao sobrevive ao fim da requisicao', async () => {
    const interceptor = new TenantRlsInterceptor();

    await firstValueFrom(
      interceptor.intercept(
        contextoDeExecucao({ tenantContext: contextoBase() }),
        handlerQueObserva({}),
      ),
    );

    expect(contextoRls.getStore()).toBeUndefined();
  });
});
