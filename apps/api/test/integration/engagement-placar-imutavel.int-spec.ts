import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { EngagementRankingService } from '../../src/modules/engagement/engagement-ranking.service.js';

describe('F35 -- regerar placar com um PUBLICADO no mesmo mes', () => {
  it('recusa com erro EXPLICADO, nao 500 generico', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    const db = app.get(PrismaService);
    const service = app.get(EngagementRankingService);

    const unidade = await db.gymUnit.findFirstOrThrow();
    const ctx = {
      tenantId: unidade.tenantId,
      actorId: randomUUID(),
      sessionId: randomUUID(),
      permissions: new Set<string>(),
      allowedUnitIds: 'ALL' as const,
    };

    const mes = '2099-01';

    /*
     * PUBLISHED gravado direto: `gerarSnapshot` num mes sem aluno elegivel
     * devolve WITHHELD, e WITHHELD e apagado pela regeracao -- nunca chegaria
     * a colidir. A condicao que o bug exige e um PUBLISHED ocupando a chave
     * unica, e e isso que o teste precisa montar.
     */
    // Limpa ANTES: uma execucao anterior que falhou no meio deixou a linha
    // para tras, e o `create` colidiria na montagem em vez de no que se quer
    // testar -- falha pelo motivo errado.
    await db.rankingSnapshot.deleteMany({ where: { tenantId: unidade.tenantId, localMonth: mes } });

    await db.rankingSnapshot.create({
      data: {
        tenantId: unidade.tenantId,
        gymUnitId: unidade.id,
        localMonth: mes,
        category: 'XP_DO_MES',
        status: 'PUBLISHED',
        minimumCohort: 5,
        eligibleCount: 0,
        generatedAt: new Date(),
        publishedAt: new Date(),
      },
    });

    // Regerar tem de dizer POR QUE recusou. Um 500 generico faz o operador
    // achar que o sistema quebrou, quando na verdade a regra funcionou.
    await expect(
      service.gerarSnapshot(ctx, unidade.id, mes, new Date(), 'XP_DO_MES'),
    ).rejects.toMatchObject({ response: { code: 'RANKING_SNAPSHOT_IMUTAVEL' } });

    await db.rankingSnapshot.deleteMany({ where: { tenantId: unidade.tenantId, localMonth: mes } });
    await app.close();
  });
});
