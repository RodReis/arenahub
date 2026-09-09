import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import { ElevarUseCase } from '../../src/modules/platform/elevar.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Elevacao de suporte: o dono do SaaS entra num tenant com justificativa e
 * prazo, auditado dos DOIS lados (INV-005 e INV-008).
 *
 * A sessao de plataforma e montada a mao (usuario + `PlatformAdmin` + Session
 * sem tenant + token do `TokenService`) porque o login de plataforma so nasce
 * na Task 6.
 */
describe('elevacao de suporte', () => {
  let app: INestApplication;
  let db: PrismaService;
  let tokens: TokenService;
  let senhas: PasswordService;
  let useCase: ElevarUseCase;
  let criarTenant: CriarTenantUseCase;

  const SENHA = 'senha-de-teste-correta';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /** Usuario + `PlatformAdmin` + Session sem tenant + cookie de acesso. */
  const logarComoSuperAdmin = async (): Promise<{ cookie: string; contexto: PlatformContext }> => {
    const usuario = await db.user.create({
      data: {
        email: `super-elev-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira.
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    const sessao = await db.session.create({
      data: {
        userId: usuario.id,
        tenantId: null,
        tokenHash: randomUUID(),
        familyId: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const token = tokens.emitirAcesso({
      sub: usuario.id,
      tenantId: null,
      sessionId: sessao.id,
      permissions: [],
      mfa: true,
    });

    return {
      cookie: `arenahub_access=${token}`,
      contexto: { actorId: usuario.id, sessionId: sessao.id, platformAdminId: admin.id },
    };
  };

  const criarTenantDeTeste = async (contexto: PlatformContext): Promise<string> => {
    const resultado = await criarTenant.executar(
      contexto,
      {
        slug: `elev-${randomUUID().slice(0, 8)}`,
        legalName: 'Academia Elevacao LTDA',
        displayName: 'Academia Elevacao',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: `dono-${randomUUID().slice(0, 8)}@academia.local`,
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      `corr-${randomUUID()}`,
    );

    return resultado.tenantId;
  };

  /** Eleva pela ROTA, para provar o caminho HTTP inteiro. */
  const elevar = async (
    cookie: string,
    tenantId: string,
    motivo: string,
  ): Promise<{ cookieElevado: string; elevacaoId: string }> => {
    const resposta = await request(servidor())
      .post(`/api/v1/platform/tenants/${tenantId}/elevar`)
      .set('Cookie', cookie)
      .send({ reason: motivo });

    expect(resposta.status).toBe(201);

    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];
    const cru = lista.find((c) => c.startsWith('arenahub_access=')) ?? '';

    return {
      cookieElevado: cru.split(';')[0] ?? '',
      elevacaoId: (resposta.body as { id: string }).id,
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    tokens = app.get(TokenService);
    senhas = app.get(PasswordService);
    useCase = app.get(ElevarUseCase);
    criarTenant = app.get(CriarTenantUseCase);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('recusa elevacao sem justificativa', async () => {
    const { contexto } = await logarComoSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);

    // O `code` e o contrato estavel; a `message` do `ErroDeDominio` e o
    // `title`, texto para humano que pode mudar sem quebrar ninguem.
    await expect(useCase.executar(contexto, tenantId, '   ', 'x')).rejects.toMatchObject({
      code: 'JUSTIFICATIVA_OBRIGATORIA',
    });
  });

  it('grava DUAS linhas de auditoria: uma de plataforma e uma no tenant alvo', async () => {
    const { contexto } = await logarComoSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const correlationId = `corr-elev-${randomUUID()}`;

    await useCase.executar(contexto, tenantId, 'Cliente pediu ajuda com a catraca', correlationId);

    const daPlataforma = await db.platformAuditLog.findFirstOrThrow({
      where: { correlationId, action: 'support.elevated' },
    });
    expect(daPlataforma.tenantId).toBe(tenantId);

    // O tenant precisa ENXERGAR que houve suporte -- por isso a segunda linha.
    const doTenant = await db.auditLog.findFirstOrThrow({ where: { tenantId, correlationId } });
    expect(doTenant.actorType).toBe('SUPPORT');
  });

  /*
   * CANARIO. Este par prova que a requisicao ALCANCA a checagem de prazo.
   *
   * Sozinho, o teste de "expirada" passaria mesmo que uma guarda anterior
   * recusasse antes -- verde pelo motivo errado. O primeiro caso mostra que a
   * mesma requisicao passa quando a elevacao esta viva; so entao o segundo
   * caso prova que foi o PRAZO que a barrou.
   */
  it('elevacao viva alcanca rota de tenant', async () => {
    const { cookie, contexto } = await logarComoSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const { cookieElevado } = await elevar(cookie, tenantId, 'Suporte combinado com o cliente');

    const resposta = await request(servidor())
      .get('/api/v1/units')
      .set('Cookie', cookieElevado);

    expect(resposta.status).toBe(200);
  });

  it('a MESMA requisicao falha quando a elevacao expirou', async () => {
    const { cookie, contexto } = await logarComoSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const { cookieElevado, elevacaoId } = await elevar(cookie, tenantId, 'Suporte combinado agora');

    await db.supportElevation.update({
      where: { id: elevacaoId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const resposta = await request(servidor())
      .get('/api/v1/units')
      .set('Cookie', cookieElevado);

    expect(resposta.status).toBe(403);
  });

  it('INV-006: Super Admin NAO elevado nao le dado de tenant nenhum', async () => {
    const { cookie, contexto } = await logarComoSuperAdmin();
    await criarTenantDeTeste(contexto);

    const resposta = await request(servidor()).get('/api/v1/units').set('Cookie', cookie);

    // Sem tenant no token nao existe `TenantContext`, e a rota de tenant nao
    // tem de onde tirar um.
    expect(resposta.status).toBe(401);
  });
});
