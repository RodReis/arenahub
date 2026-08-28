import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';

/**
 * Escopo de unidade nas contestacoes, pela ROTA -- F35.
 *
 * O teste do service prova a regra; este prova que o CONTROLLER a usa. Sem
 * ele, remover `contexto.allowedUnitIds` da chamada deixaria a guarda existir
 * e ninguem a exercer -- que e exatamente a forma de defeito que revisao de
 * diff nao enxerga.
 */
describe('F35 -- escopo de unidade nas contestacoes (rota)', () => {
  const sufixo = randomUUID().slice(0, 8);

  let app: Awaited<ReturnType<typeof criarApp>>['app'];
  let db: PrismaService;
  let cookieRestrito: string;
  let idDaUnidadeB: string;

  async function criarApp() {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const criada = mod.createNestApplication();
    await criada.init();
    return { app: criada, db: criada.get(PrismaService) };
  }

  beforeAll(async () => {
    const criado = await criarApp();
    app = criado.app;
    db = criado.db;

    const tenant = await db.tenant.create({
      data: {
        slug: `escopo-${sufixo}`,
        legalName: `Escopo ${sufixo} LTDA`,
        displayName: `Escopo ${sufixo}`,
      },
    });

    const [unidadeA, unidadeB] = await Promise.all([
      db.gymUnit.create({
        data: {
          tenantId: tenant.id,
          code: 'A',
          name: `A ${sufixo}`,
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      }),
      db.gymUnit.create({
        data: {
          tenantId: tenant.id,
          code: 'B',
          name: `B ${sufixo}`,
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      }),
    ]);
    idDaUnidadeB = unidadeB.id;

    const alunoB = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidadeB.id,
        fullName: 'Bruno da Unidade B',
        membershipNumber: `B-${sufixo}-0001`,
        status: 'ACTIVE',
        birthDate: new Date('1995-01-01T00:00:00.000Z'),
      },
    });

    await db.engagementDispute.create({
      data: {
        tenantId: tenant.id,
        studentId: alunoB.id,
        subject: 'XP',
        descricao: 'Contestacao do aluno da unidade B.',
        status: 'ABERTA',
      },
    });

    // Moderador RESTRITO a unidade A -- `gymUnitId` preenchido no vinculo.
    const senha = 'senha-de-teste-f35';
    const usuario = await db.user.create({
      data: {
        email: `restrito-${sufixo}@teste.local`,
        passwordHash: await app.get(PasswordService).gerarHash(senha),
      },
    });

    // Sem `tenantMembership` o login nao resolve o tenant e devolve 401.
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: tenant.id, name: `RESTRITO_${sufixo}`, isSystem: false },
    });

    for (const code of ['engagement.read', 'engagement.correct']) {
      const permissao = await db.permission.upsert({
        where: { code },
        update: {},
        create: { code },
      });
      await db.rolePermission.create({
        data: { roleId: papel.id, permissionId: permissao.id },
      });
    }

    await db.userRole.create({
      data: {
        tenantId: tenant.id,
        userId: usuario.id,
        roleId: papel.id,
        gymUnitId: unidadeA.id,
      },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: senha })
      .expect(200);

    cookieRestrito = (login.headers['set-cookie'] as unknown as string[]).join('; ');
  });

  afterAll(async () => {
    await app?.close();
  });

  /** `getHttpServer()` devolve `any`; o cast estreita para o que o supertest pede. */
  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('a fila NAO mostra contestacao de aluno de outra unidade', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/engagement/contestacoes?status=ABERTA')
      .set('Cookie', cookieRestrito)
      .expect(200);

    const itens = (resposta.body as { itens: { descricao: string }[] }).itens;

    expect(itens.some((i) => i.descricao.includes('unidade B'))).toBe(false);
  });

  it('resolver contestacao de outra unidade e 404, nao 200', async () => {
    const daOutra = await db.engagementDispute.findFirstOrThrow({
      where: { student: { gymUnitId: idDaUnidadeB } },
    });

    await request(servidor())
      .post(`/api/v1/engagement/contestacoes/${daOutra.id}/resolver`)
      .set('Cookie', cookieRestrito)
      .send({ desfecho: 'CORRIGIDA', resolucao: 'nao deveria conseguir' })
      .expect(404);

    // E continua ABERTA -- a recusa nao pode ter efeito colateral.
    const depois = await db.engagementDispute.findUniqueOrThrow({ where: { id: daOutra.id } });
    expect(depois.status).toBe('ABERTA');
  });
});
