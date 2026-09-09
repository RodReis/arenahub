import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import { AlterarTenantUseCase } from '../../src/modules/platform/alterar-tenant.use-case.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import { TenantRepository } from '../../src/modules/platform/tenant.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Edicao cadastral e alternancia de situacao do tenant pelo dono do SaaS.
 *
 * Motivo obrigatorio ao tirar de operacao; reativacao NAO grava motivo em
 * branco -- string vazia na auditoria e pior que campo ausente.
 */
describe('alterar tenant', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let useCase: AlterarTenantUseCase;
  let criar: CriarTenantUseCase;
  let tenants: TenantRepository;

  const SENHA = 'senha-de-teste-correta';

  const criarSuperAdmin = async (): Promise<{ contexto: PlatformContext }> => {
    const usuario = await db.user.create({
      data: {
        email: `super-altera-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira.
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    return {
      contexto: { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id },
    };
  };

  const criarTenantDeTeste = async (contexto: PlatformContext): Promise<string> => {
    const { tenantId } = await criar.executar(
      contexto,
      {
        slug: `academia-alt-${randomUUID().slice(0, 8)}`,
        legalName: 'Academia Nova LTDA',
        displayName: 'Academia Nova',
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    useCase = app.get(AlterarTenantUseCase);
    criar = app.get(CriarTenantUseCase);
    tenants = app.get(TenantRepository);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('inativa exigindo motivo, e grava o motivo na auditoria', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const correlationId = `corr-inativa-${randomUUID()}`;

    await useCase.executar(
      contexto,
      tenantId,
      { status: 'INACTIVE' },
      correlationId,
      'Contrato encerrado a pedido do cliente',
    );

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.status).toBe('INACTIVE');

    const registro = await db.platformAuditLog.findFirstOrThrow({ where: { correlationId } });

    expect(registro.action).toBe('tenant.status_changed');
    expect(registro.tenantId).toBe(tenantId);
    expect(registro.metadata).toMatchObject({ motivo: 'Contrato encerrado a pedido do cliente' });
  });

  it('recusa inativacao sem motivo', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);

    // O `code` e o contrato estavel, nao a `message` (que e para humano).
    await expect(
      useCase.executar(contexto, tenantId, { status: 'INACTIVE' }, `corr-${randomUUID()}`),
    ).rejects.toMatchObject({ code: 'MOTIVO_OBRIGATORIO' });

    // Recusa nao pode ter alterado nada.
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.status).toBe('ACTIVE');
  });

  it('reativa sem motivo e NAO grava motivo em branco', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const correlationId = `corr-reativa-${randomUUID()}`;

    await useCase.executar(
      contexto,
      tenantId,
      { status: 'INACTIVE' },
      `corr-${randomUUID()}`,
      'Motivo qualquer aqui',
    );

    await useCase.executar(contexto, tenantId, { status: 'ACTIVE' }, correlationId);

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.status).toBe('ACTIVE');

    const registro = await db.platformAuditLog.findFirstOrThrow({ where: { correlationId } });

    // Motivo em branco na auditoria e pior que campo ausente: parece que
    // alguem respondeu e nao respondeu nada.
    expect(registro.metadata).not.toHaveProperty('motivo');
  });

  it('edita dado cadastral sem status, e registra como tenant.updated', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const correlationId = `corr-edita-${randomUUID()}`;

    await useCase.executar(contexto, tenantId, { displayName: 'Academia Renomeada' }, correlationId);

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.displayName).toBe('Academia Renomeada');

    const registro = await db.platformAuditLog.findFirstOrThrow({ where: { correlationId } });
    expect(registro.action).toBe('tenant.updated');
    // Sem PII no metadado: so o NOME dos campos alterados.
    expect(registro.metadata).toMatchObject({ campos: ['displayName'] });
  });

  it('recusa tenant inexistente sem gravar auditoria', async () => {
    const { contexto } = await criarSuperAdmin();
    const correlationId = `corr-inexistente-${randomUUID()}`;

    await expect(
      useCase.executar(contexto, randomUUID(), { displayName: 'Nao existe' }, correlationId),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });

    const registro = await db.platformAuditLog.findFirst({ where: { correlationId } });
    expect(registro).toBeNull();
  });

  /**
   * A TELA DE EDICAO PRECISA DOS CAMPOS QUE A LISTA OMITE.
   *
   * `listar()` devolve visao de painel -- sem `cnpj` nem `responsavelEmail`, de
   * proposito. Um formulario de edicao alimentado por ela nasceria com esses
   * campos em branco, e salvar apagaria dado que ninguem pediu para apagar.
   */
  it('le um tenant com os campos cadastrais que a lista nao carrega', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);

    const encontrado = await tenants.porId(tenantId);

    expect(encontrado).toMatchObject({
      id: tenantId,
      cnpj: '12345678000199',
      responsavelNome: 'Fulano',
      status: 'ACTIVE',
    });
    expect(encontrado?.responsavelEmail).toContain('@academia.local');
  });

  it('devolve nulo para tenant inexistente, em vez de lancar', async () => {
    expect(await tenants.porId(randomUUID())).toBeNull();
  });
});
