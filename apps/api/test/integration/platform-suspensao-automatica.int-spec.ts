import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import { SaasPlanUseCase } from '../../src/modules/platform/saas-plan.use-case.js';
import { SuspenderTenantUseCase } from '../../src/modules/platform/suspender-tenant.use-case.js';
import { TenantContractUseCase } from '../../src/modules/platform/tenant-contract.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F65 -- suspensao automatica do tenant apos a carencia (ADR-053).
 *
 * INTEGRACAO: a idempotencia e o `where: { status: 'ACTIVE' }` do update, e
 * um dublê responderia o que quisessemos. `avaliarCarencia` ja esta coberta
 * em `domain/carencia.spec.ts`, e nao se repete aqui.
 */
describe('F65 -- suspensao automatica', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let planos: SaasPlanUseCase;
  let contratos: TenantContractUseCase;
  let criarTenant: CriarTenantUseCase;
  let suspender: SuspenderTenantUseCase;
  let contexto: PlatformContext;

  const gravados = new Map<string, { body: Buffer; contentType: string }>();

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'application/pdf' }),
    deletePrivateObject: (key: string) => {
      gravados.delete(key);

      return Promise.resolve();
    },
    putPrivateObject: (entrada: { key: string; body: Buffer; contentType: string }) => {
      gravados.set(entrada.key, { body: entrada.body, contentType: entrada.contentType });

      return Promise.resolve();
    },
    getPrivateObject: (key: string) => {
      const objeto = gravados.get(key);

      if (!objeto) return Promise.reject(new Error('NoSuchKey'));

      return Promise.resolve(objeto);
    },
    createPrivateDownload: () =>
      Promise.resolve({ downloadUrl: 'https://storage.test/x', expiresAt: '' }),
  };

  const criarTenantDeTeste = async (): Promise<string> => {
    const { tenantId } = await criarTenant.executar(
      contexto,
      {
        slug: `suspensao-${randomUUID().slice(0, 8)}`,
        legalName: 'Academia da Suspensao LTDA',
        displayName: 'Academia da Suspensao',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: `dono-${randomUUID().slice(0, 8)}@academia.local`,
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      `corr-${randomUUID()}`,
    );

    return tenantId;
  };

  /** Contrato POR ALUNO vigente, com o `graceDays` pedido (padrao 15). */
  const contratoAtivo = async (tenantId: string, graceDays = 15): Promise<string> => {
    const plano = await planos.criar(
      contexto,
      {
        name: `Plano suspensao ${randomUUID().slice(0, 6)}`,
        model: 'PER_STUDENT',
        activeStudentPriceMinor: 500,
        inactiveStudentPriceMinor: 250,
      },
      `corr-${randomUUID()}`,
    );

    const contrato = await contratos.criar(
      contexto,
      {
        tenantId,
        planId: plano.id,
        baseDate: new Date('2026-01-01T00:00:00.000Z'),
        anniversaryDay: 1,
        anniversaryMonth: 1,
        issueDay: 1,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        graceDays,
      },
      `corr-${randomUUID()}`,
    );

    await contratos.ativar(contexto, contrato.id, `corr-${randomUUID()}`);

    return contrato.id;
  };

  /** Fatura OVERDUE gravada direto, sem passar pelo ciclo de emissao. */
  const criarFaturaVencida = async (
    tenantId: string,
    entrada: { dueAt: string; totalMinor: number },
  ): Promise<void> => {
    const contrato = await db.tenantContract.findFirstOrThrow({
      where: { tenantId, status: 'ACTIVE' },
    });

    const dueAt = new Date(entrada.dueAt);
    const competence = new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), 1));

    await db.platformInvoice.create({
      data: {
        tenantId,
        contractId: contrato.id,
        competence,
        model: contrato.model,
        activeStudentPriceMinor: contrato.activeStudentPriceMinor,
        inactiveStudentPriceMinor: contrato.inactiveStudentPriceMinor,
        activeCount: 1,
        totalMinor: entrada.totalMinor,
        dueAt,
        status: 'OVERDUE',
      },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    planos = app.get(SaasPlanUseCase);
    contratos = app.get(TenantContractUseCase);
    criarTenant = app.get(CriarTenantUseCase);
    suspender = app.get(SuspenderTenantUseCase);

    const usuario = await db.user.create({
      data: {
        email: `super-suspensao-${randomUUID().slice(0, 8)}@exemplo.test`,
        passwordHash: await senhas.gerarHash('senha-de-teste-correta'),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    contexto = { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('suspende quem passou da carencia e esta em autoSuspend', async () => {
    const tenantId = await criarTenantDeTeste();
    await contratoAtivo(tenantId);

    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    expect(tenant.status).toBe('SUSPENDED');
  });

  it('NAO suspende quem esta fora do autoSuspend', async () => {
    const tenantId = await criarTenantDeTeste();
    await contratoAtivo(tenantId);

    // A carencia esgotada e identica; so a chave muda.
    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    expect(tenant.status).toBe('ACTIVE');
  });

  it('NAO suspende dentro da carencia', async () => {
    const tenantId = await criarTenantDeTeste();
    await contratoAtivo(tenantId);

    await criarFaturaVencida(tenantId, { dueAt: '2026-09-05', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('NAO suspende antes das 6h locais', async () => {
    const tenantId = await criarTenantDeTeste();
    await contratoAtivo(tenantId);

    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T08:00:00Z'));

    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe(
      'ACTIVE',
    );
  });

  it('e IDEMPOTENTE -- rodar duas vezes nao gera duas auditorias', async () => {
    /*
     * O job roda todo dia. Sem a guarda de `status = ACTIVE` no `where`, um
     * tenant suspenso ontem viraria linha de auditoria nova toda madrugada, e
     * "quando esta academia foi suspensa?" deixaria de ter resposta.
     */
    const tenantId = await criarTenantDeTeste();
    await contratoAtivo(tenantId);

    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));
    await suspender.executarCiclo(new Date('2026-09-10T09:00:00Z'));

    const atos = await db.platformAuditLog.count({
      where: { tenantId, action: 'tenant.suspended_automatically' },
    });

    expect(atos).toBe(1);
  });

  it('NAO suspende tenant INACTIVE', async () => {
    // Desligado pelo dono do SaaS ja esta fora; suspende-lo trocaria o motivo
    // registrado de "desligado" para "inadimplente".
    const tenantId = await criarTenantDeTeste();
    await contratoAtivo(tenantId);

    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({
      where: { id: tenantId },
      data: { autoSuspend: true, status: 'INACTIVE' },
    });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe(
      'INACTIVE',
    );
  });

  it('falha de um tenant nao derruba os outros', async () => {
    // Mesmo precedente da emissao: log e o laco segue.
    const resultado = await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    expect(resultado).toHaveProperty('falhas');
  });
});
