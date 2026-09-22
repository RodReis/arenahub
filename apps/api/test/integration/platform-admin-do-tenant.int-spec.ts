import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import {
  AdminDoTenantUseCase,
  AdminJaAceitouError,
  ConvitePendenteInexistenteError,
  MotivoObrigatorioError,
} from '../../src/modules/platform/admin-do-tenant.use-case.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import { InvitationService } from '../../src/modules/iam/invitation.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Acesso do Admin do tenant -- F79.
 *
 * O convite do Admin nasce em `CriarTenantUseCase` e vale 24 horas. Esta fatia
 * o torna consertavel: ver o estado, reenviar, corrigir o e-mail e revogar.
 *
 * INTEGRACAO E NAO UNITARIO porque o que precisa de prova esta no BANCO: que o
 * token antigo para de valer, que a exclusao mutua e do `where` e nao de um
 * `if`, e que a auditoria cai dos dois lados.
 */
describe('acesso do Admin do tenant', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let useCase: AdminDoTenantUseCase;
  let criarTenant: CriarTenantUseCase;
  let convites: InvitationService;

  const SENHA = 'senha-de-teste-correta';
  /** Acima do minimo de 10: a revogacao exige justificativa auditada. */
  const MOTIVO = 'endereco de e-mail trocado pelo cliente';
  const tenantsCriados: string[] = [];

  const criarSuperAdmin = async (): Promise<PlatformContext> => {
    const usuario = await db.user.create({
      data: {
        email: `super-admin-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira e
        // recusa segredo em claro, inclusive de fixture.
        passwordHash: await senhas.gerarHash(SENHA),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    return { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id };
  };

  /** Tenant novo, com o convite de Admin que `CriarTenantUseCase` ja emite. */
  const criarTenantDeTeste = async (
    contexto: PlatformContext,
  ): Promise<{ tenantId: string; email: string; token: string }> => {
    const email = `dono-${randomUUID().slice(0, 8)}@academia.local`;

    const resultado = await criarTenant.executar(
      contexto,
      {
        slug: `academia-${randomUUID().slice(0, 8)}`,
        legalName: 'Academia de Teste LTDA',
        displayName: 'Academia de Teste',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: email,
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      `corr-${randomUUID()}`,
    );

    tenantsCriados.push(resultado.tenantId);

    return { tenantId: resultado.tenantId, email, token: resultado.ownerInvitationToken };
  };

  const hashDe = (token: string): string => createHash('sha256').update(token).digest('hex');

  /** Empurra o convite pendente para o passado, sem esperar 24 horas. */
  const vencerConvite = async (tenantId: string): Promise<void> => {
    await db.invitation.updateMany({
      where: { tenantId, status: 'PENDING' },
      data: { expiresAt: new Date(Date.now() - 60 * 1000) },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    useCase = app.get(AdminDoTenantUseCase);
    criarTenant = app.get(CriarTenantUseCase);
    convites = app.get(InvitationService);
  });

  afterAll(async () => {
    /*
     * APAGA OS TENANTS QUE CRIOU.
     *
     * `afterAll` que so fecha o app deixa contrato acumulado entre execucoes
     * -- ja viraram timeout que parecia defeito do codigo. O cascade do
     * schema leva unidade, papel, convite e auditoria junto.
     */
    if (db) {
      for (const tenantId of tenantsCriados) {
        await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
      }
    }

    await app?.close();
  });

  it('mostra PENDENTE enquanto o convite do Admin nao foi aceito', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, email } = await criarTenantDeTeste(contexto);

    const estado = await useCase.consultar(tenantId);

    expect(estado.estado).toBe('PENDENTE');
    expect(estado.email).toBe(email);
  });

  it('mostra VENCIDO quando o prazo do convite passou', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId } = await criarTenantDeTeste(contexto);

    await vencerConvite(tenantId);

    expect((await useCase.consultar(tenantId)).estado).toBe('VENCIDO');
  });

  it('mostra ATIVO depois que o Admin aceita', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, email, token } = await criarTenantDeTeste(contexto);

    await convites.aceitar(token, SENHA, `corr-${randomUUID()}`);

    const estado = await useCase.consultar(tenantId);

    expect(estado.estado).toBe('ATIVO');
    expect(estado.email).toBe(email);
  });

  /* AC-1 */
  it('reenviar convite vencido invalida o token antigo e o novo vale', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, token: antigo } = await criarTenantDeTeste(contexto);

    await vencerConvite(tenantId);

    const { token: novo } = await useCase.convidar(
      contexto,
      tenantId,
      undefined,
      `corr-${randomUUID()}`,
    );

    /*
     * O TOKEN ANTIGO ESTA VENCIDO, e por isso este teste NAO prova a
     * revogacao: `aceitar` recusa pelo prazo antes de olhar o status, entao
     * um reenvio que esquecesse de revogar passaria aqui. Quem prova a
     * revogacao e o teste seguinte, com convite DENTRO do prazo.
     *
     * O que este caso prova e o caminho de destravar quem ficou de fora:
     * convite morto, reenvio, e alguem entra.
     */
    await expect(convites.aceitar(antigo, SENHA, `corr-${randomUUID()}`)).rejects.toThrow();

    await convites.aceitar(novo, SENHA, `corr-${randomUUID()}`);

    expect((await useCase.consultar(tenantId)).estado).toBe('ATIVO');
  });

  /* AC-1, a metade que o caso acima nao alcanca */
  it('reenviar convite AINDA VALIDO mata o token antigo na hora', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, token: antigo } = await criarTenantDeTeste(contexto);

    // SEM `vencerConvite`: o antigo continua dentro das 24 horas, entao a
    // unica coisa que pode recusa-lo e a revogacao do reenvio (BR-1).
    const { token: novo } = await useCase.convidar(
      contexto,
      tenantId,
      undefined,
      `corr-${randomUUID()}`,
    );

    await expect(convites.aceitar(antigo, SENHA, `corr-${randomUUID()}`)).rejects.toThrow();

    await convites.aceitar(novo, SENHA, `corr-${randomUUID()}`);

    expect((await useCase.consultar(tenantId)).estado).toBe('ATIVO');
  });

  it('reenviar sem e-mail no corpo mantem o endereco do convite atual', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, email } = await criarTenantDeTeste(contexto);

    const resultado = await useCase.convidar(
      contexto,
      tenantId,
      undefined,
      `corr-${randomUUID()}`,
    );

    expect(resultado.email).toBe(email);
  });

  /* AC-2 */
  it('corrigir o e-mail revoga o convite anterior e emite para o novo endereco', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, token: antigo } = await criarTenantDeTeste(contexto);
    const corrigido = `corrigido-${randomUUID().slice(0, 8)}@academia.local`;

    const resultado = await useCase.convidar(
      contexto,
      tenantId,
      corrigido,
      `corr-${randomUUID()}`,
    );

    expect(resultado.email).toBe(corrigido);

    const anterior = await db.invitation.findUnique({
      where: { tokenHash: hashDe(antigo) },
      select: { status: true, revokedAt: true },
    });

    expect(anterior?.status).toBe('REVOKED');
    expect(anterior?.revokedAt).not.toBeNull();

    const estado = await useCase.consultar(tenantId);

    expect(estado.estado).toBe('PENDENTE');
    expect(estado.email).toBe(corrigido);
  });

  /* AC-3 */
  it('recusa corrigir o e-mail depois do aceite, sem tocar no convite', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, token } = await criarTenantDeTeste(contexto);

    await convites.aceitar(token, SENHA, `corr-${randomUUID()}`);

    await expect(
      useCase.convidar(contexto, tenantId, 'outro@academia.local', `corr-${randomUUID()}`),
    ).rejects.toBeInstanceOf(AdminJaAceitouError);

    // O estado nao se mexeu: continua ATIVO no e-mail de quem entrou.
    expect((await useCase.consultar(tenantId)).estado).toBe('ATIVO');
  });

  /* AC-5 */
  it('revogar derruba o convite pendente e o token para de valer', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, token } = await criarTenantDeTeste(contexto);

    await useCase.revogar(contexto, tenantId, MOTIVO, `corr-${randomUUID()}`);

    await expect(convites.aceitar(token, SENHA, `corr-${randomUUID()}`)).rejects.toThrow();

    expect((await useCase.consultar(tenantId)).estado).toBe('SEM_CONVITE');
  });

  it('revogar duas vezes recusa a segunda -- nao ha convite pendente', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId } = await criarTenantDeTeste(contexto);

    await useCase.revogar(contexto, tenantId, MOTIVO, `corr-${randomUUID()}`);

    await expect(
      useCase.revogar(contexto, tenantId, MOTIVO, `corr-${randomUUID()}`),
    ).rejects.toBeInstanceOf(ConvitePendenteInexistenteError);
  });

  it('convida de novo depois de revogar, com e-mail explicito', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId } = await criarTenantDeTeste(contexto);

    await useCase.revogar(contexto, tenantId, MOTIVO, `corr-${randomUUID()}`);

    const destino = `novo-dono-${randomUUID().slice(0, 8)}@academia.local`;
    const { token } = await useCase.convidar(contexto, tenantId, destino, `corr-${randomUUID()}`);

    await convites.aceitar(token, SENHA, `corr-${randomUUID()}`);

    const estado = await useCase.consultar(tenantId);

    expect(estado.estado).toBe('ATIVO');
    expect(estado.email).toBe(destino);
  });

  it('recusa convidar sem e-mail quando nao ha convite de onde herda-lo', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId } = await criarTenantDeTeste(contexto);

    await useCase.revogar(contexto, tenantId, MOTIVO, `corr-${randomUUID()}`);

    await expect(
      useCase.convidar(contexto, tenantId, undefined, `corr-${randomUUID()}`),
    ).rejects.toBeInstanceOf(ConvitePendenteInexistenteError);
  });

  it('recusa revogar sem motivo -- a justificativa vai para a auditoria', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId, token } = await criarTenantDeTeste(contexto);

    await expect(
      useCase.revogar(contexto, tenantId, 'ok', `corr-${randomUUID()}`),
    ).rejects.toBeInstanceOf(MotivoObrigatorioError);

    // O convite NAO foi tocado: recusa que revoga pela metade seria pior que
    // recusa nenhuma.
    await convites.aceitar(token, SENHA, `corr-${randomUUID()}`);

    expect((await useCase.consultar(tenantId)).estado).toBe('ATIVO');
  });

  /* AC-6 */
  it('audita dos dois lados: plataforma e tenant', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId } = await criarTenantDeTeste(contexto);

    await useCase.convidar(contexto, tenantId, undefined, `corr-${randomUUID()}`);

    const naPlataforma = await db.platformAuditLog.findFirst({
      where: { tenantId, action: 'tenant.admin_invited' },
    });

    const noTenant = await db.auditLog.findFirst({
      where: { tenantId, action: 'tenant.admin_invited' },
    });

    expect(naPlataforma).not.toBeNull();
    // INV-008: quem opera a academia precisa ver o que a plataforma fez na
    // casa dele.
    expect(noTenant).not.toBeNull();
    expect(noTenant?.actorType).toBe('SUPPORT');
  });

  it('nao grava o e-mail do Admin na auditoria', async () => {
    const contexto = await criarSuperAdmin();
    const { tenantId } = await criarTenantDeTeste(contexto);
    const destino = `sigiloso-${randomUUID().slice(0, 8)}@academia.local`;

    await useCase.convidar(contexto, tenantId, destino, `corr-${randomUUID()}`);

    const linhas = await db.platformAuditLog.findMany({
      where: { tenantId, action: 'tenant.admin_invited' },
    });

    // Mesma regra de `tenant.created`: audita-se o ATO, nunca a PII.
    expect(JSON.stringify(linhas)).not.toContain(destino);
  });
});
