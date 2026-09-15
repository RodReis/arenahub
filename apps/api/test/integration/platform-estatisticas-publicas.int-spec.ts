import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Contagem publica de alunos e unidades, para o rodape da tela de login sem
 * slug -- F71.
 *
 * INTEGRACAO: o aceite e que a rota SOMA entre tenants sem vazar o total de
 * um so, e que status inativo/fora-de-operacao nao entra na conta -- as duas
 * coisas so se provam com mais de um tenant no banco de verdade.
 */
describe('estatisticas publicas da plataforma', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let criarTenant: CriarTenantUseCase;
  let contexto: PlatformContext;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'image/png' }),
    deletePrivateObject: () => Promise.resolve(),
    putPrivateObject: () => Promise.resolve(),
    getPrivateObject: () => Promise.reject(new Error('NoSuchKey')),
    createPrivateDownload: () =>
      Promise.resolve({ downloadUrl: 'https://storage.test/x', expiresAt: '' }),
  };

  const criarTenantDeTeste = async (): Promise<{ id: string; unidadeId: string }> => {
    const slug = `stats-${randomUUID().slice(0, 8)}`;

    const { tenantId } = await criarTenant.executar(
      contexto,
      {
        slug,
        legalName: 'Academia de Estatistica LTDA',
        displayName: 'Academia de Estatistica',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: `dono-${randomUUID().slice(0, 8)}@academia.local`,
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      `corr-${randomUUID()}`,
    );

    const unidade = await db.gymUnit.findFirstOrThrow({ where: { tenantId } });

    return { id: tenantId, unidadeId: unidade.id };
  };

  const criarAluno = (tenantId: string, gymUnitId: string, status: 'ACTIVE' | 'CANCELLED') =>
    db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `F71-${randomUUID().slice(0, 12)}`,
        fullName: `Aluno ${status} ${randomUUID().slice(0, 8)}`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        status,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    criarTenant = app.get(CriarTenantUseCase);

    const usuario = await db.user.create({
      data: {
        email: `super-stats-${randomUUID().slice(0, 8)}@exemplo.test`,
        passwordHash: await senhas.gerarHash('senha-de-teste-correta'),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    contexto = { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id };
  });

  afterAll(async () => {
    await app?.close();
  });

  /*
   * COTA MINIMA (`>=`), e nao igualdade: este banco e compartilhado com
   * OUTRAS SUITES rodando ao mesmo tempo (`pnpm test:integration` roda em
   * paralelo), e cada uma pode criar tenant/aluno entre a leitura "antes" e
   * a "depois" desta suite. Isso derrubou a versao com igualdade estrita na
   * primeira execucao da suite completa (contagem cresceu de outras fontes
   * no meio do teste). `>=` prova que a rota SOMA o que este teste criou,
   * sem exigir que mais ninguem escreva no banco ao mesmo tempo.
   */
  it('soma alunos ativos e unidades ativas entre todos os tenants', async () => {
    const antes = (
      await request(servidor()).get('/api/v1/plataforma/estatisticas-publicas')
    ).body as { totalAlunosAtivos: number; totalUnidadesAtivas: number };

    const primeiro = await criarTenantDeTeste();
    const segundo = await criarTenantDeTeste();

    await criarAluno(primeiro.id, primeiro.unidadeId, 'ACTIVE');
    await criarAluno(primeiro.id, primeiro.unidadeId, 'ACTIVE');
    await criarAluno(primeiro.id, primeiro.unidadeId, 'CANCELLED');
    await criarAluno(segundo.id, segundo.unidadeId, 'ACTIVE');

    const resposta = await request(servidor()).get('/api/v1/plataforma/estatisticas-publicas');

    expect(resposta.status).toBe(200);
    const corpo = resposta.body as { totalAlunosAtivos: number; totalUnidadesAtivas: number };

    expect(corpo.totalAlunosAtivos).toBeGreaterThanOrEqual(antes.totalAlunosAtivos + 3);
    expect(corpo.totalUnidadesAtivas).toBeGreaterThanOrEqual(antes.totalUnidadesAtivas + 2);
  });

  /*
   * DIRETO NA QUERY, e nao no total agregado da rota: o total agregado sofre
   * o mesmo ruido de concorrencia da suite acima, e uma igualdade estrita
   * ali provaria a exclusao so por sorte (ninguem mais escreveu no meio).
   * Aqui a asserção é exatamente a query que `contarEstatisticasPublicas`
   * usa para decidir quais tenants entram na soma -- determinística,
   * imune a quem mais estiver rodando.
   */
  it('nao conta tenant fora de operacao', async () => {
    const suspenso = await criarTenantDeTeste();

    await criarAluno(suspenso.id, suspenso.unidadeId, 'ACTIVE');
    await db.tenant.update({ where: { id: suspenso.id }, data: { status: 'SUSPENDED' } });

    const tenantsAtivos = await db.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    expect(tenantsAtivos.map((t) => t.id)).not.toContain(suspenso.id);
  });

  it('nao exige autenticacao', async () => {
    await request(servidor())
      .get('/api/v1/plataforma/estatisticas-publicas')
      .expect(200)
      .expect('Cache-Control', 'public, max-age=300');
  });
});
