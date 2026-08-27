import { beforeEach, describe, expect, it } from '@jest/globals';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';

import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { EngagementController } from './engagement.controller.js';
import { EngagementService } from './engagement.service.js';
import { RepositorioEmMemoria } from './engagement.repository.fake.js';

/**
 * Fatia F30, Task 7 -- rotas de moderacao do painel.
 *
 * Unit spec: sobe so o `EngagementController` + o `EngagementService` real,
 * com o dublê de repositorio (`RepositorioEmMemoria`) no lugar do Prisma. O
 * `AuthGuard`/`PermissionsGuard` reais decidem 401/403 -- so a fonte do
 * `TenantContext` e substituida por um middleware de teste, para nao exigir
 * Postgres nem JWT de verdade so para checar a porta HTTP.
 */
describe('EngagementController -- fila de moderacao', () => {
  let app: INestApplication;
  let repo: RepositorioEmMemoria;

  const CTX_MODERADOR: TenantContext = {
    tenantId: 't1',
    actorId: 'moderador-1',
    sessionId: 's1',
    permissions: new Set(['engagement.read', 'engagement.moderate']),
    allowedUnitIds: 'ALL',
  };

  const CTX_SEM_PERMISSAO: TenantContext = {
    tenantId: 't1',
    actorId: 'sem-permissao-1',
    sessionId: 's2',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  };

  const CTX_OUTRO_TENANT: TenantContext = {
    tenantId: 't2',
    actorId: 'moderador-2',
    sessionId: 's3',
    permissions: new Set(['engagement.read', 'engagement.moderate']),
    allowedUnitIds: 'ALL',
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /** Token de teste: o proprio nome do contexto. O `AuthGuard` fake so
   * consulta o mapa abaixo -- nao ha JWT real nesta suite. */
  const CONTEXTOS: Record<string, TenantContext> = {
    'token-moderador': CTX_MODERADOR,
    'token-sem-permissao': CTX_SEM_PERMISSAO,
    'token-outro-tenant': CTX_OUTRO_TENANT,
  };

  /** Substitui so a FONTE do `TenantContext` (leitura de cookie + JWT +
   * banco). O `PermissionsGuard` real, na ordem real, continua decidindo
   * 401/403 -- e o que este arquivo prova. */
  class AuthGuardFalso implements CanActivate {
    canActivate(contexto: ExecutionContext): boolean {
      const requisicao = contexto.switchToHttp().getRequest<Request>();
      const cabecalho = requisicao.headers.authorization ?? '';
      const token = cabecalho.replace('Bearer ', '');
      const tenantContext = CONTEXTOS[token];
      if (tenantContext) requisicao.tenantContext = tenantContext;
      return true;
    }
  }

  beforeEach(async () => {
    repo = new RepositorioEmMemoria();
    repo.cadastrarAluno({ id: 'a1', tenantId: 't1', name: 'Ana Souza', status: 'ACTIVE' });
    repo.cadastrarAluno({ id: 'a2', tenantId: 't2', name: 'Bruno Lima', status: 'ACTIVE' });

    const moduleRef = await Test.createTestingModule({
      controllers: [EngagementController],
      providers: [
        { provide: EngagementService, useFactory: () => new EngagementService(repo) },
        TenantContextService,
        // Mesma ordem de `app.module.ts`: quem poe o TenantContext roda
        // primeiro, o `PermissionsGuard` REAL le dali depois. So a FONTE do
        // TenantContext e trocada -- nao ha `AuthGuard` de verdade aqui
        // porque ele exige TokenService/PrismaService (JWT, banco), fora do
        // escopo desta suite unitaria.
        { provide: APP_GUARD, useClass: AuthGuardFalso },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  it('sem permissao, 403', async () => {
    await request(servidor())
      .get('/api/v1/engagement/aliases?status=PENDING')
      .set('Authorization', 'Bearer token-sem-permissao')
      .expect(403);
  });

  it('lista os pendentes com os sinais da triagem', async () => {
    await repo.salvarPerfil(
      {
        tenantId: 't1',
        studentId: 'a1',
        identityChoice: 'APELIDO',
        alias: 'Tigre',
        aliasNormalized: 'tigre',
        screeningSignals: [],
        version: null,
      },
      new Date(),
    );

    const resposta = await request(servidor())
      .get('/api/v1/engagement/aliases?status=PENDING')
      .set('Authorization', 'Bearer token-moderador')
      .expect(200);

    const corpo = resposta.body as { itens: { status: string }[] };
    expect(corpo.itens[0]).toMatchObject({ status: 'PENDING' });
  });

  it('rejeitar sem razao categorizada e 400', async () => {
    const perfil = await repo.salvarPerfil(
      {
        tenantId: 't1',
        studentId: 'a1',
        identityChoice: 'APELIDO',
        alias: 'Tigre',
        aliasNormalized: 'tigre',
        screeningSignals: [],
        version: null,
      },
      new Date(),
    );

    await request(servidor())
      .patch(`/api/v1/engagement/aliases/${perfil.id}`)
      .set('Authorization', 'Bearer token-moderador')
      .send({ decisao: 'REJECTED' })
      .expect(400);
  });

  it('moderar perfil de outro tenant e 404', async () => {
    const perfilDeOutroTenant = await repo.salvarPerfil(
      {
        tenantId: 't2',
        studentId: 'a2',
        identityChoice: 'APELIDO',
        alias: 'Leao',
        aliasNormalized: 'leao',
        screeningSignals: [],
        version: null,
      },
      new Date(),
    );

    await request(servidor())
      .patch(`/api/v1/engagement/aliases/${perfilDeOutroTenant.id}`)
      .set('Authorization', 'Bearer token-moderador')
      .send({ decisao: 'APPROVED' })
      .expect(404);
  });
});
