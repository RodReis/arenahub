import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PERMISSOES_DO_OWNER } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import {
  CriarTenantUseCase,
  type EntradaDeTenant,
} from '../../src/modules/platform/criar-tenant.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Criacao de tenant pelo dono do SaaS: tenant, primeira unidade, papel OWNER
 * com as permissoes e o convite do dono, TUDO numa transacao so.
 */
describe('criar tenant pelo painel', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let useCase: CriarTenantUseCase;

  const SENHA = 'senha-de-teste-correta';

  /** Usuario + `PlatformAdmin` ativo. Sem HTTP: o alvo aqui e o caso de uso. */
  const criarSuperAdmin = async (): Promise<{ contexto: PlatformContext }> => {
    const usuario = await db.user.create({
      data: {
        email: `super-cria-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira e
        // recusa segredo em claro, inclusive de fixture.
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    return {
      contexto: {
        actorId: usuario.id,
        sessionId: randomUUID(),
        platformAdminId: admin.id,
      },
    };
  };

  const entradaValida = (): EntradaDeTenant => ({
    slug: `academia-${randomUUID().slice(0, 8)}`,
    legalName: 'Academia Nova LTDA',
    displayName: 'Academia Nova',
    cnpj: '12345678000199',
    timezone: 'America/Sao_Paulo',
    responsavelNome: 'Fulano',
    responsavelEmail: `dono-${randomUUID().slice(0, 8)}@academia.local`,
    unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    useCase = app.get(CriarTenantUseCase);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('cria tenant, primeira unidade, papel OWNER e convite numa transacao', async () => {
    const { contexto } = await criarSuperAdmin();

    const resultado = await useCase.executar(contexto, entradaValida(), `corr-${randomUUID()}`);

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: resultado.tenantId } });
    expect(tenant.status).toBe('ACTIVE');

    const unidades = await db.gymUnit.findMany({ where: { tenantId: resultado.tenantId } });
    expect(unidades).toHaveLength(1);
    expect(unidades[0]?.id).toBe(resultado.gymUnitId);

    const convite = await db.invitation.findFirstOrThrow({
      where: { tenantId: resultado.tenantId },
    });
    expect(convite.status).toBe('PENDING');
  });

  /*
   * O convite do OWNER nao pode prender o dono a primeira unidade.
   *
   * O `gymUnitId` do convite vira o `gymUnitId` do `UserRole` ao aceitar, e o
   * `AuthGuard` le campo preenchido como "vale SO nesta unidade". Com a matriz
   * amarrada, o dono deixaria de enxergar a segunda unidade no dia em que ela
   * abrisse -- semanas depois, sem sintoma que apontasse para o cadastro.
   *
   * A asercao e sobre o ESCOPO que o convite concede, nao sobre o campo: por
   * isso ela olha o `allowedUnitIds` que o guard derivaria, e nao so o nulo.
   */
  it('convida o OWNER para o tenant inteiro, nao so para a primeira unidade', async () => {
    const { contexto } = await criarSuperAdmin();

    const resultado = await useCase.executar(contexto, entradaValida(), `corr-${randomUUID()}`);

    const convite = await db.invitation.findFirstOrThrow({
      where: { tenantId: resultado.tenantId },
    });

    expect(convite.gymUnitId).toBeNull();
  });

  it('da ao OWNER exatamente as permissoes de PERMISSOES_DO_OWNER, sem lista repetida no teste', async () => {
    const { contexto } = await criarSuperAdmin();

    const resultado = await useCase.executar(contexto, entradaValida(), `corr-${randomUUID()}`);

    const papel = await db.role.findFirstOrThrow({
      where: { tenantId: resultado.tenantId, name: 'OWNER' },
      include: { permissions: { include: { permission: true } } },
    });

    const concedidas = papel.permissions.map((p) => p.permission.code).sort();
    expect(concedidas).toEqual([...PERMISSOES_DO_OWNER].sort());
  });

  it('registra o ato no PlatformAuditLog, que e onde ato sem tenant dono cabe', async () => {
    const { contexto } = await criarSuperAdmin();
    const correlationId = `corr-unica-${randomUUID()}`;

    const resultado = await useCase.executar(contexto, entradaValida(), correlationId);

    const registro = await db.platformAuditLog.findFirstOrThrow({ where: { correlationId } });

    expect(registro.action).toBe('tenant.created');
    expect(registro.tenantId).toBe(resultado.tenantId);
    expect(registro.actorUserId).toBe(contexto.actorId);
    // Sem PII: e-mail do responsavel NAO entra no metadado.
    expect(JSON.stringify(registro.metadata)).not.toContain('@');
  });

  it('recusa slug repetido sem deixar tenant orfao no banco', async () => {
    const { contexto } = await criarSuperAdmin();
    const entrada = entradaValida();

    await useCase.executar(contexto, entrada, `corr-${randomUUID()}`);

    const antes = await db.tenant.count();

    await expect(useCase.executar(contexto, entrada, `corr-${randomUUID()}`)).rejects.toThrow();

    const depois = await db.tenant.count();

    // A transacao inteira volta atras: slug repetido nao deixa unidade,
    // papel nem convite pendurados.
    expect(depois).toBe(antes);
  });
});
