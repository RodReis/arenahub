import { beforeEach, describe, expect, it } from '@jest/globals';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';

import { ProblemDetailsFilter } from '../../common/http/problem-details.filter.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { EngagementXpController } from './engagement-xp.controller.js';
import { EngagementXpService } from './engagement-xp.service.js';
import { EngagementRankingService } from './engagement-ranking.service.js';
import { FakePortaDeXp } from './engagement-xp.repository.fake.js';
import { FakePortaDeRanking } from './engagement-ranking.repository.fake.js';

/**
 * Fatia F31, Task 11 -- painel: publicar placar e ajustar XP.
 *
 * Mesmo padrao de `engagement.controller.spec.ts`: sobe so o controller +
 * os services reais, com os dublês de repositorio no lugar do Prisma. O
 * `PermissionsGuard` real decide 403 -- so a FONTE do `TenantContext` e
 * substituida.
 */
describe('EngagementXpController -- painel de placar e XP', () => {
  let app: INestApplication;
  let fakeXp: FakePortaDeXp;
  let fakeRanking: FakePortaDeRanking;

  const CTX_MODERADOR: TenantContext = {
    tenantId: 't1',
    actorId: 'moderador-1',
    sessionId: 's1',
    permissions: new Set(['engagement.moderate']),
    allowedUnitIds: 'ALL',
  };

  const CTX_SEM_PERMISSAO: TenantContext = {
    tenantId: 't1',
    actorId: 'sem-permissao-1',
    sessionId: 's2',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  };

  const CONTEXTOS: Record<string, TenantContext> = {
    'token-moderador': CTX_MODERADOR,
    'token-sem-permissao': CTX_SEM_PERMISSAO,
  };

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

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    fakeXp = new FakePortaDeXp();
    fakeRanking = new FakePortaDeRanking();

    // Catalogo minimo: uma regra qualquer, so para a FK de ADJUSTMENT
    // (ver comentario de `PortaDeXp.qualquerVersaoDeRegra`).
    fakeXp.comRegra({ points: 10 });
    fakeXp.comAluno(STUDENT_ID, 'America/Sao_Paulo');

    const moduleRef = await Test.createTestingModule({
      controllers: [EngagementXpController],
      providers: [
        { provide: EngagementXpService, useFactory: () => new EngagementXpService(fakeXp) },
        { provide: EngagementRankingService, useFactory: () => new EngagementRankingService(fakeRanking) },
        TenantContextService,
        { provide: APP_GUARD, useClass: AuthGuardFalso },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  describe('POST /rankings/:gymUnitId/:mes/publicar', () => {
    it('sem permissao, 403', async () => {
      fakeRanking.comCoorteMinima(1);
      fakeRanking.comSaldos('33333333-3333-4333-8333-333333333333', '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      const gerado = await request(servidor())
        .post('/api/v1/engagement/rankings/33333333-3333-4333-8333-333333333333/2026-08/gerar')
        .set('Authorization', 'Bearer token-moderador')
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Authorization', 'Bearer token-sem-permissao')
        .expect(403);
    });

    it('gera e publica um snapshot', async () => {
      fakeRanking.comCoorteMinima(1);
      fakeRanking.comSaldos('33333333-3333-4333-8333-333333333333', '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      const gerado = await request(servidor())
        .post('/api/v1/engagement/rankings/33333333-3333-4333-8333-333333333333/2026-08/gerar')
        .set('Authorization', 'Bearer token-moderador')
        .expect(201);

      expect(gerado.body).toMatchObject({ status: 'DRAFT' });

      const snapshotId = (gerado.body as { id: string }).id;

      const publicado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Authorization', 'Bearer token-moderador')
        .expect(201);

      expect(publicado.body).toMatchObject({ status: 'PUBLISHED' });
    });

    it('coorte abaixo do minimo gera WITHHELD', async () => {
      fakeRanking.comCoorteMinima(5);
      fakeRanking.comSaldos('33333333-3333-4333-8333-333333333333', '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      const gerado = await request(servidor())
        .post('/api/v1/engagement/rankings/33333333-3333-4333-8333-333333333333/2026-08/gerar')
        .set('Authorization', 'Bearer token-moderador')
        .expect(201);

      expect(gerado.body).toMatchObject({ status: 'WITHHELD', entries: [] });
    });

    /* `M5-AC-007`: republicar e recusado, com 409 -- nao 500. */
    it('republicar um snapshot ja publicado e 409', async () => {
      fakeRanking.comCoorteMinima(1);
      fakeRanking.comSaldos('33333333-3333-4333-8333-333333333333', '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      const gerado = await request(servidor())
        .post('/api/v1/engagement/rankings/33333333-3333-4333-8333-333333333333/2026-08/gerar')
        .set('Authorization', 'Bearer token-moderador')
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Authorization', 'Bearer token-moderador')
        .expect(201);

      const resposta = await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Authorization', 'Bearer token-moderador')
        .expect(409);

      expect((resposta.body as { code: string }).code).toBe('RANKING_SNAPSHOT_IMUTAVEL');
    });
  });

  describe('POST /xp/:studentId/ajustar', () => {
    it('sem permissao, 403', async () => {
      await request(servidor())
        .post(`/api/v1/engagement/xp/${STUDENT_ID}/ajustar`)
        .set('Authorization', 'Bearer token-sem-permissao')
        .send({ pontos: -10, motivo: 'correcao', idempotencyKey: 'k1' })
        .expect(403);
    });

    it('ajuste exige motivo', async () => {
      const resposta = await request(servidor())
        .post(`/api/v1/engagement/xp/${STUDENT_ID}/ajustar`)
        .set('Authorization', 'Bearer token-moderador')
        .send({ pontos: -10, motivo: '', idempotencyKey: 'k1' })
        .expect(400);

      expect((resposta.body as { code: string }).code).toBe('VALIDATION_FAILED');
    });

    it('ajuste com motivo so espaco tambem e 400', async () => {
      await request(servidor())
        .post(`/api/v1/engagement/xp/${STUDENT_ID}/ajustar`)
        .set('Authorization', 'Bearer token-moderador')
        .send({ pontos: -10, motivo: '   ', idempotencyKey: 'k1' })
        .expect(400);
    });

    /*
     * `M5-FR-007`/`M5-AC-010`: correcao e movimento compensatorio. Nao ha
     * rota de edicao, e o movimento original continua no ledger.
     */
    it('ajuste grava movimento novo sem apagar o original', async () => {
      await request(servidor())
        .post(`/api/v1/engagement/xp/${STUDENT_ID}/ajustar`)
        .set('Authorization', 'Bearer token-moderador')
        .send({ pontos: 20, motivo: 'bonus de evento', idempotencyKey: 'original' })
        .expect(201);

      await request(servidor())
        .post(`/api/v1/engagement/xp/${STUDENT_ID}/ajustar`)
        .set('Authorization', 'Bearer token-moderador')
        .send({ pontos: -10, motivo: 'passagem corrigida', idempotencyKey: 'correcao' })
        .expect(201);

      const movimentos = await fakeXp.movimentosDoAluno(CTX_MODERADOR, STUDENT_ID);

      expect(movimentos).toHaveLength(2);
      expect(movimentos[0]).toMatchObject({ points: 20, type: 'ADJUSTMENT' });
      expect(movimentos[1]).toMatchObject({ points: -10, type: 'ADJUSTMENT' });
    });

    it('mesmo idempotencyKey nao ajusta duas vezes', async () => {
      const ajustar = () =>
        request(servidor())
          .post(`/api/v1/engagement/xp/${STUDENT_ID}/ajustar`)
          .set('Authorization', 'Bearer token-moderador')
          .send({ pontos: -10, motivo: 'passagem corrigida', idempotencyKey: 'k1' });

      await ajustar().expect(201);
      await ajustar().expect(201);

      const movimentos = await fakeXp.movimentosDoAluno(CTX_MODERADOR, STUDENT_ID);
      expect(movimentos.filter((m) => m.type === 'ADJUSTMENT')).toHaveLength(1);
    });

    it('aluno inexistente e 404', async () => {
      await request(servidor())
        .post('/api/v1/engagement/xp/22222222-2222-4222-8222-222222222222/ajustar')
        .set('Authorization', 'Bearer token-moderador')
        .send({ pontos: -10, motivo: 'correcao', idempotencyKey: 'k1' })
        .expect(404);
    });
  });
});
