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
    // As DUAS permissoes: gerar/publicar placar exige `engagement.moderate`,
    // corrigir XP exige `engagement.correct` (F35, ADR-049 Decisao 2).
    permissions: new Set(['engagement.moderate', 'engagement.correct']),
    allowedUnitIds: 'ALL',
  };

  const CTX_SEM_PERMISSAO: TenantContext = {
    tenantId: 't1',
    actorId: 'sem-permissao-1',
    sessionId: 's2',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  };

  /** Unidades usadas so pelos testes de escopo (Task 11, correcao critica):
   * um gerente restrito a `UNIDADE_A` nunca pode agir sobre `UNIDADE_B`. */
  const UNIDADE_A = '33333333-3333-4333-8333-333333333333';
  const UNIDADE_B = '44444444-4444-4444-8444-444444444444';

  /** Moderador RESTRITO a `UNIDADE_A` -- `allowedUnitIds` e um conjunto, nao
   * `'ALL'`. E o ator que a correcao critica da F31/Task 11 precisa barrar
   * fora da propria unidade. */
  const CTX_MODERADOR_UNIDADE_A: TenantContext = {
    tenantId: 't1',
    actorId: 'moderador-restrito-1',
    sessionId: 's3',
    permissions: new Set(['engagement.moderate', 'engagement.correct']),
    allowedUnitIds: new Set([UNIDADE_A]),
  };

  /**
   * So modera, NAO corrige (F35).
   *
   * Existe para provar que `engagement.correct` e uma permissao de verdade e
   * nao decoracao: com as duas sempre juntas, separa-las nao mudaria nada e
   * ninguem notaria se o decorator voltasse para `engagement.moderate`.
   */
  const CTX_SO_MODERADOR: TenantContext = {
    tenantId: 't1',
    actorId: 'so-moderador-1',
    sessionId: 's4',
    permissions: new Set(['engagement.moderate']),
    allowedUnitIds: 'ALL',
  };

  const CONTEXTOS: Record<string, TenantContext> = {
    'token-moderador': CTX_MODERADOR,
    'token-sem-permissao': CTX_SEM_PERMISSAO,
    'token-moderador-unidade-a': CTX_MODERADOR_UNIDADE_A,
    'token-so-moderador': CTX_SO_MODERADOR,
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

    /*
     * Correcao critica (F31, Task 11): um gerente restrito a `UNIDADE_A`
     * gerava e publicava DEFINITIVAMENTE o placar de `UNIDADE_B` so por
     * saber o UUID dela na URL -- `M5-AC-007` torna a publicacao
     * irreversivel, entao vazar isto e o pior caso possivel.
     *
     * PROVA DO CANARIO: com `exigirEscopoDaUnidade` removido do controller,
     * este teste fica VERMELHO (a chamada devolve 201 em vez de 404) --
     * confirmado manualmente, guarda restaurada em seguida.
     */
    it('moderador restrito a UNIDADE_A nao gera placar de UNIDADE_B', async () => {
      fakeRanking.comCoorteMinima(1);
      fakeRanking.comSaldos(UNIDADE_B, '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      await request(servidor())
        .post(`/api/v1/engagement/rankings/${UNIDADE_B}/2026-08/gerar`)
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .expect(404);
    });

    /* Caso positivo: sem ele, uma guarda que recusa tudo passaria igual. */
    it('moderador restrito a UNIDADE_A gera placar da propria unidade', async () => {
      fakeRanking.comCoorteMinima(1);
      fakeRanking.comSaldos(UNIDADE_A, '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      const gerado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${UNIDADE_A}/2026-08/gerar`)
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .expect(201);

      expect(gerado.body).toMatchObject({ status: 'DRAFT' });
    });

    /*
     * O snapshot de `UNIDADE_B` foi gerado por um moderador `ALL` -- o
     * restrito a `UNIDADE_A` so tenta publicar. `publicar` nao recebe
     * `gymUnitId` na URL, so o `snapshotId`: a correcao tem de carregar o
     * snapshot e checar a unidade DELE, nao a da requisicao.
     *
     * PROVA DO CANARIO: com a checagem de escopo removida de `publicar`,
     * este teste fica VERMELHO (201 em vez de 404) -- confirmado
     * manualmente, guarda restaurada em seguida.
     */
    it('moderador restrito a UNIDADE_A nao publica snapshot de UNIDADE_B', async () => {
      fakeRanking.comCoorteMinima(1);
      fakeRanking.comSaldos(UNIDADE_B, '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      const gerado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${UNIDADE_B}/2026-08/gerar`)
        .set('Authorization', 'Bearer token-moderador')
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      const resposta = await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .expect(404);

      expect((resposta.body as { code: string }).code).toBe('RANKING_SNAPSHOT_NAO_ENCONTRADO');
    });

    /* Caso positivo: moderador restrito publicando o proprio snapshot. */
    it('moderador restrito a UNIDADE_A publica snapshot da propria unidade', async () => {
      fakeRanking.comCoorteMinima(1);
      fakeRanking.comSaldos(UNIDADE_A, '2026-08', [
        { studentId: 'aluno-1', points: 10, lastEntryAt: new Date() },
      ]);

      const gerado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${UNIDADE_A}/2026-08/gerar`)
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      const publicado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .expect(201);

      expect(publicado.body).toMatchObject({ status: 'PUBLISHED' });
    });

    /*
     * O mesmo snapshot inexistente devolve o MESMO codigo para os dois
     * motivos ("nao existe" e "existe, mas e de outra unidade") -- provando
     * que a resposta nao denuncia qual dos dois aconteceu.
     */
    it('snapshot inexistente e o mesmo 404 de snapshot fora de escopo', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/engagement/rankings/snapshot-que-nao-existe/publicar')
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .expect(404);

      expect((resposta.body as { code: string }).code).toBe('RANKING_SNAPSHOT_NAO_ENCONTRADO');
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

    it('quem so MODERA nao corrige XP -- `engagement.correct` e propria (F35)', async () => {
      // Quem julga apelido nao mexe no saldo de ninguem por tabela.
      // Se o decorator voltasse para `engagement.moderate`, este teste cai.
      await request(servidor())
        .post(`/api/v1/engagement/xp/${STUDENT_ID}/ajustar`)
        .set('Authorization', 'Bearer token-so-moderador')
        .send({ pontos: -10, motivo: 'correcao', idempotencyKey: 'k-perm' })
        .expect(403);
    });

    it('quem so MODERA ainda gera placar -- a separacao nao tirou nada', async () => {
      // O outro lado: separar a permissao nao pode ter quebrado o que a F31
      // ja fazia com `engagement.moderate`.
      await request(servidor())
        .post(`/api/v1/engagement/rankings/${UNIDADE_A}/2026-08/gerar`)
        .set('Authorization', 'Bearer token-so-moderador')
        .send({})
        .expect(201);
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

    /*
     * Correcao critica (F31, Task 11): `ajustar` recebe `studentId`, e um
     * aluno pertence a uma unidade (`Student.gymUnitId`). Um gerente
     * restrito a `UNIDADE_A` nao pode ajustar XP de aluno matriculado em
     * `UNIDADE_B` -- mesmo 404 de "aluno inexistente", para nao denunciar
     * que o aluno existe em outra unidade.
     *
     * PROVA DO CANARIO: com a checagem de escopo removida de `ajustarXp`,
     * este teste fica VERMELHO (201 em vez de 404) -- confirmado
     * manualmente, guarda restaurada em seguida.
     */
    it('moderador restrito a UNIDADE_A nao ajusta XP de aluno de UNIDADE_B', async () => {
      const alunoDeUnidadeB = '55555555-5555-4555-8555-555555555555';
      fakeXp.comAluno(alunoDeUnidadeB, 'America/Sao_Paulo', UNIDADE_B);

      const resposta = await request(servidor())
        .post(`/api/v1/engagement/xp/${alunoDeUnidadeB}/ajustar`)
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .send({ pontos: -10, motivo: 'correcao', idempotencyKey: 'k1' })
        .expect(404);

      expect((resposta.body as { code: string }).code).toBe('ALUNO_NAO_ENCONTRADO');
    });

    /* Caso positivo: moderador restrito ajustando aluno da propria unidade. */
    it('moderador restrito a UNIDADE_A ajusta XP de aluno da propria unidade', async () => {
      const alunoDeUnidadeA = '66666666-6666-4666-8666-666666666666';
      fakeXp.comAluno(alunoDeUnidadeA, 'America/Sao_Paulo', UNIDADE_A);

      await request(servidor())
        .post(`/api/v1/engagement/xp/${alunoDeUnidadeA}/ajustar`)
        .set('Authorization', 'Bearer token-moderador-unidade-a')
        .send({ pontos: -10, motivo: 'correcao', idempotencyKey: 'k1' })
        .expect(201);
    });
  });
});
