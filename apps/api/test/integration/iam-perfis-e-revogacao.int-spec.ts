import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PAPEIS_DE_SISTEMA } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import {
  MotivoObrigatorioError,
  NaoRevogaASiMesmoError,
  RevogarAcessoUseCase,
  UltimoDonoError,
  UsuarioNaoEncontradoError,
} from '../../src/modules/iam/revogar-acesso.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Perfis prontos e revogacao de acesso -- F80.
 *
 * INTEGRACAO porque o que precisa de prova esta no BANCO: que o tenant novo
 * nasce com os cinco papeis com as permissoes certas, e que revogar mata os
 * DOIS registros que o `AuthGuard` le -- nao um deles.
 */
describe('perfis de sistema e revogacao de acesso', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let criarTenant: CriarTenantUseCase;
  let revogar: RevogarAcessoUseCase;

  const SENHA = 'senha-de-teste-correta';
  const MOTIVO = 'saiu da equipe da academia';
  const tenantsCriados: string[] = [];

  const criarSuperAdmin = async (): Promise<PlatformContext> => {
    const usuario = await db.user.create({
      data: {
        email: `super-f80-${randomUUID().slice(0, 8)}@exemplo.test`,
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    return { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id };
  };

  const criarTenantDeTeste = async (contexto: PlatformContext): Promise<string> => {
    const resultado = await criarTenant.executar(
      contexto,
      {
        slug: `academia-f80-${randomUUID().slice(0, 8)}`,
        legalName: 'Academia F80 LTDA',
        displayName: 'Academia F80',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: `dono-${randomUUID().slice(0, 8)}@academia.local`,
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      `corr-${randomUUID()}`,
    );

    tenantsCriados.push(resultado.tenantId);

    return resultado.tenantId;
  };

  /** Usuario com vinculo ativo e um papel, como o aceite de convite produz. */
  const criarMembro = async (tenantId: string, papel: string): Promise<string> => {
    const usuario = await db.user.create({
      data: {
        email: `membro-${randomUUID().slice(0, 8)}@academia.local`,
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const role = await db.role.findFirstOrThrow({ where: { tenantId, name: papel } });

    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: role.id } });

    return usuario.id;
  };

  const contextoDe = (tenantId: string, actorId: string): TenantContext => ({
    tenantId,
    actorId,
    sessionId: randomUUID(),
    permissions: new Set<string>(['user.manage']),
    allowedUnitIds: 'ALL',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    criarTenant = app.get(CriarTenantUseCase);
    revogar = app.get(RevogarAcessoUseCase);
  });

  afterAll(async () => {
    // Apaga o que criou: `afterAll` que so fecha o app deixa contrato
    // acumulado entre execucoes, que ja virou timeout parecendo defeito.
    if (db) {
      for (const tenantId of tenantsCriados) {
        await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
      }
    }

    await app?.close();
  });

  /* AC-1 */
  describe('tenant novo nasce com os cinco perfis', () => {
    it('cria os cinco papeis, todos de sistema', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);

      const papeis = await db.role.findMany({
        where: { tenantId },
        select: { name: true, isSystem: true },
      });

      expect(papeis.map((p) => p.name).sort()).toEqual(
        PAPEIS_DE_SISTEMA.map((p) => p.name).sort(),
      );
      expect(papeis.every((p) => p.isSystem)).toBe(true);
    });

    it('cada papel tem EXATAMENTE as permissoes da constante', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);

      for (const doSistema of PAPEIS_DE_SISTEMA) {
        const papel = await db.role.findFirstOrThrow({
          where: { tenantId, name: doSistema.name },
          select: { permissions: { select: { permission: { select: { code: true } } } } },
        });

        const gravadas = papel.permissions.map((p) => p.permission.code).sort();

        /*
         * O NOME DO PAPEL ENTRA NO VALOR COMPARADO, e nao como segundo
         * argumento do `expect` -- o Jest nao aceita mensagem ali (so o
         * Vitest). Sem isto, a falha de um papel nao diria QUAL papel.
         */
        expect({ papel: doSistema.name, permissoes: gravadas }).toEqual({
          papel: doSistema.name,
          permissoes: [...doSistema.permissoes].sort(),
        });
      }
    });

    /* AC-3, no banco: a prova das ausencias que sao decisao de produto. */
    it('a recepcao nao recebe painel financeiro nem leitura de saude', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);

      const recepcao = await db.role.findFirstOrThrow({
        where: { tenantId, name: 'RECEPTION' },
        select: { permissions: { select: { permission: { select: { code: true } } } } },
      });

      const codigos = recepcao.permissions.map((p) => p.permission.code);

      expect(codigos).toContain('billing.read');
      expect(codigos).not.toContain('billing.dashboard');
      expect(codigos).not.toContain('health.read');
      expect(codigos).toContain('health.upload');
    });
  });

  describe('revogar acesso', () => {
    /* AC-4 */
    it('apaga o papel E marca o vinculo como revogado', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const dono = await criarMembro(tenantId, 'OWNER');
      const recepcao = await criarMembro(tenantId, 'RECEPTION');

      await revogar.executar(contextoDe(tenantId, dono), recepcao, MOTIVO, `corr-${randomUUID()}`);

      /*
       * OS DOIS REGISTROS, e nao um: o `AuthGuard` le `TenantMembership`
       * para saber se a pessoa pertence ao tenant e `UserRole` para saber o
       * que ela pode. Deixar qualquer um vivo e acesso que nao morre.
       */
      const vinculo = await db.tenantMembership.findFirst({
        where: { tenantId, userId: recepcao },
        select: { status: true },
      });

      const papeis = await db.userRole.count({ where: { tenantId, userId: recepcao } });

      expect(vinculo?.status).toBe('REVOKED');
      expect(papeis).toBe(0);
    });

    it('nao apaga o usuario -- identidade e global, o vinculo e por tenant', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const dono = await criarMembro(tenantId, 'OWNER');
      const alvo = await criarMembro(tenantId, 'TRAINER');

      await revogar.executar(contextoDe(tenantId, dono), alvo, MOTIVO, `corr-${randomUUID()}`);

      expect(await db.user.findUnique({ where: { id: alvo } })).not.toBeNull();
    });

    /* AC-5 */
    it('recusa revogar a si mesmo', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const dono = await criarMembro(tenantId, 'OWNER');
      await criarMembro(tenantId, 'OWNER');

      await expect(
        revogar.executar(contextoDe(tenantId, dono), dono, MOTIVO, `corr-${randomUUID()}`),
      ).rejects.toBeInstanceOf(NaoRevogaASiMesmoError);

      const vinculo = await db.tenantMembership.findFirst({
        where: { tenantId, userId: dono },
        select: { status: true },
      });

      expect(vinculo?.status).toBe('ACTIVE');
    });

    /* AC-6 */
    it('recusa revogar o ultimo dono', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const unicoDono = await criarMembro(tenantId, 'OWNER');
      const gerente = await criarMembro(tenantId, 'MANAGER');

      await expect(
        revogar.executar(contextoDe(tenantId, gerente), unicoDono, MOTIVO, `corr-${randomUUID()}`),
      ).rejects.toBeInstanceOf(UltimoDonoError);

      expect(await db.userRole.count({ where: { tenantId, userId: unicoDono } })).toBe(1);
    });

    /* AC-7 -- a guarda e sobre o ULTIMO, nao sobre o papel */
    it('revoga o penultimo dono sem reclamar', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const primeiro = await criarMembro(tenantId, 'OWNER');
      const segundo = await criarMembro(tenantId, 'OWNER');

      await revogar.executar(
        contextoDe(tenantId, primeiro),
        segundo,
        MOTIVO,
        `corr-${randomUUID()}`,
      );

      expect(await db.userRole.count({ where: { tenantId, userId: segundo } })).toBe(0);
    });

    it('dono com vinculo REVOGADO nao segura a academia', async () => {
      /*
       * A ARMADILHA QUE ESTA GUARDA EVITA: contar linhas de `UserRole` sem
       * olhar o vinculo deixaria um dono que NAO ENTRA MAIS "segurar" a
       * academia -- e o ultimo dono de verdade poderia ser revogado, deixando
       * ninguem capaz de convidar.
       *
       * O CENARIO PRECISA SER MONTADO A MAO, e nao pela revogacao normal: o
       * caminho normal apaga o `UserRole` junto, e ai o dono sumiria da
       * contagem com ou sem o filtro -- o teste passaria pelo motivo errado.
       * Vinculo revogado com papel vivo e o estado que sobra de um import, de
       * um seed antigo ou de uma revogacao anterior a esta fatia.
       */
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const vivo = await criarMembro(tenantId, 'OWNER');
      const fantasma = await criarMembro(tenantId, 'OWNER');
      const gerente = await criarMembro(tenantId, 'MANAGER');

      // So o VINCULO cai; o `UserRole` de OWNER continua na tabela.
      await db.tenantMembership.updateMany({
        where: { tenantId, userId: fantasma },
        data: { status: 'REVOKED' },
      });

      expect(await db.userRole.count({ where: { tenantId, userId: fantasma } })).toBe(1);

      // `vivo` e o unico dono que ENTRA -- revoga-lo tem de ser recusado,
      // embora existam DUAS linhas de OWNER na tabela.
      await expect(
        revogar.executar(contextoDe(tenantId, gerente), vivo, MOTIVO, `corr-${randomUUID()}`),
      ).rejects.toBeInstanceOf(UltimoDonoError);
    });

    /* AC-8 */
    it('recusa sem motivo, sem tocar em nada', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const dono = await criarMembro(tenantId, 'OWNER');
      const alvo = await criarMembro(tenantId, 'RECEPTION');

      await expect(
        revogar.executar(contextoDe(tenantId, dono), alvo, 'ok', `corr-${randomUUID()}`),
      ).rejects.toBeInstanceOf(MotivoObrigatorioError);

      expect(await db.userRole.count({ where: { tenantId, userId: alvo } })).toBe(1);
    });

    it('recusa quem nao e membro do tenant', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const outroTenant = await criarTenantDeTeste(contexto);
      const dono = await criarMembro(tenantId, 'OWNER');
      const deOutraCasa = await criarMembro(outroTenant, 'RECEPTION');

      // Isolamento de tenant: o id existe, mas nao nesta academia.
      await expect(
        revogar.executar(contextoDe(tenantId, dono), deOutraCasa, MOTIVO, `corr-${randomUUID()}`),
      ).rejects.toBeInstanceOf(UsuarioNaoEncontradoError);

      expect(await db.userRole.count({ where: { tenantId: outroTenant, userId: deOutraCasa } })).toBe(
        1,
      );
    });

    it('revogar duas vezes recusa a segunda', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const dono = await criarMembro(tenantId, 'OWNER');
      const alvo = await criarMembro(tenantId, 'FINANCE');
      const ator = contextoDe(tenantId, dono);

      await revogar.executar(ator, alvo, MOTIVO, `corr-${randomUUID()}`);

      await expect(
        revogar.executar(ator, alvo, MOTIVO, `corr-${randomUUID()}`),
      ).rejects.toBeInstanceOf(UsuarioNaoEncontradoError);
    });

    /* AC-9 */
    it('audita o ato com o motivo e sem PII', async () => {
      const contexto = await criarSuperAdmin();
      const tenantId = await criarTenantDeTeste(contexto);
      const dono = await criarMembro(tenantId, 'OWNER');
      const alvo = await criarMembro(tenantId, 'RECEPTION');

      const email = await db.user.findUniqueOrThrow({
        where: { id: alvo },
        select: { email: true },
      });

      await revogar.executar(contextoDe(tenantId, dono), alvo, MOTIVO, `corr-${randomUUID()}`);

      const linha = await db.auditLog.findFirst({
        where: { tenantId, action: 'user.access_revoked', targetId: alvo },
      });

      expect(linha).not.toBeNull();
      expect(JSON.stringify(linha?.metadata)).toContain(MOTIVO);
      // O e-mail do revogado NAO entra: audita-se o ato e o papel perdido.
      expect(JSON.stringify(linha)).not.toContain(email.email);
    });
  });
});
