import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { avaliarConsentimento } from '../../src/modules/privacy/domain/consentimento.js';
import { EngagementService } from '../../src/modules/engagement/engagement.service.js';

/**
 * Fatia F30, Task 5 -- os dois regimes e o indice parcial, contra Postgres
 * real.
 *
 * O que este arquivo prova, e que o dublê (`engagement.repository.fake.ts`)
 * nao alcanca:
 *
 *   - `ConsentRecord` serve OPT-IN (biometria) e OPT-OUT (engajamento) na
 *     MESMA tabela sem que os dois predicados se confundam;
 *   - o indice parcial `public_profiles_alias_aprovado_unico` deixa dois
 *     PENDING conviverem e barra o segundo APPROVED;
 *   - o indice e por tenant, nao global;
 *   - empate de `occurredAt` nao deixa a ordem fisica do Postgres decidir
 *     qual decisao vale.
 */
describe('F30 -- engajamento e identidade publica (integracao)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let service: EngagementService;

  const sufixo = randomUUID().slice(0, 8);

  const tenantA = { id: '', slug: `f30-tenant-a-${sufixo}`, gymUnitId: '', actorId: '' };
  const tenantB = { id: '', slug: `f30-tenant-b-${sufixo}`, gymUnitId: '', actorId: '' };

  // `moderatedBy` tem FK para `users.id`: o ator precisa existir de verdade,
  // nao um UUID aleatorio.
  const ctxDe = (tenant: { id: string; actorId: string }): TenantContext => ({
    tenantId: tenant.id,
    actorId: tenant.actorId,
    sessionId: randomUUID(),
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

  /** Publica um documento vigente do tenant, para uma finalidade qualquer. */
  const publicarDocumento = async (
    tenantId: string,
    type:
      | 'BIOMETRIC'
      | 'RANKING'
      | 'CHALLENGE'
      | 'ENGAGEMENT_PUSH'
      | 'PHYSICAL_EVOLUTION_RANKING',
  ): Promise<string> => {
    const conteudo = `Termo de teste para ${type} -- ${sufixo}. `.repeat(3);
    const sha = createHash('sha256').update(conteudo, 'utf8').digest('hex');

    const documento = await db.consentDocument.create({
      data: {
        tenantId,
        type,
        version: 1,
        purpose: `Finalidade de teste ${type}`,
        content: conteudo,
        contentSha256: sha,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    return documento.id;
  };

  /** Cria um tenant com uma unidade, e publica os documentos que este
   * arquivo precisa (biometria + as quatro finalidades de engajamento). */
  const montarTenant = async (tenant: {
    id: string;
    slug: string;
    gymUnitId: string;
    actorId: string;
  }) => {
    const criado = await db.tenant.create({
      data: { slug: tenant.slug, legalName: `${tenant.slug} LTDA`, displayName: tenant.slug },
    });
    tenant.id = criado.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: criado.id,
        code: 'CENTRO',
        name: `Centro ${tenant.slug}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    tenant.gymUnitId = unidade.id;

    // Ator real: `moderarPerfil` grava `moderatedBy` com FK para `users.id`.
    // Hash de verdade, nao texto plano -- `vazamento.int-spec.ts` varre
    // TODO usuario do banco de integracao e reprova senha em claro.
    const senhas = app.get(PasswordService);
    const moderador = await db.user.create({
      data: {
        email: `${tenant.slug}-moderador@exemplo.test`,
        passwordHash: await senhas.gerarHash('senha-de-teste-correta'),
      },
    });
    tenant.actorId = moderador.id;

    await publicarDocumento(criado.id, 'BIOMETRIC');
    await publicarDocumento(criado.id, 'RANKING');
    await publicarDocumento(criado.id, 'CHALLENGE');
    await publicarDocumento(criado.id, 'ENGAGEMENT_PUSH');
    await publicarDocumento(criado.id, 'PHYSICAL_EVOLUTION_RANKING');
  };

  let contadorDeMatricula = 0;

  /** Cria um aluno ATIVO, direto pelo Prisma -- este arquivo testa a
   * camada de dominio/repositorio, nao a rota HTTP de cadastro. */
  const criarAluno = async (tenantId: string, gymUnitId: string): Promise<string> => {
    contadorDeMatricula += 1;

    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `F30-${sufixo}-${String(contadorDeMatricula).padStart(4, '0')}`,
        fullName: 'Aluno De Teste Do F30',
        birthDate: new Date('1995-06-15T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    return aluno.id;
  };

  /** Registra uma decisao de BIOMETRIA (regime OPT-IN, tabela `privacy`) --
   * NAO passa pelo `EngagementService`, que so conhece as quatro finalidades
   * de engajamento. */
  const registrarConsentimentoBiometrico = async (
    tenantId: string,
    studentId: string,
    decision: 'ACCEPTED' | 'REFUSED',
    agora: Date,
  ): Promise<void> => {
    const documento = await db.consentDocument.findFirstOrThrow({
      where: { tenantId, type: 'BIOMETRIC', retiredAt: null },
      orderBy: [{ version: 'desc' }],
    });

    await db.consentRecord.create({
      data: {
        tenantId,
        studentId,
        documentId: documento.id,
        decision,
        subjectKind: 'STUDENT',
        subjectAgeYears: 30,
        occurredAt: agora,
      },
    });
  };

  /** A biometria esta autorizada AGORA para este aluno? Mesma regra que a
   * rota `/biometric-consent` usa (`avaliarConsentimento`), so que lida
   * direto no banco -- e o predicado do REGIME OPT-IN. */
  const biometriaAutorizada = async (tenantId: string, studentId: string): Promise<boolean> => {
    const registro = await db.consentRecord.findFirst({
      where: { tenantId, studentId, document: { type: 'BIOMETRIC' } },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: { document: { select: { retiredAt: true } } },
    });

    if (!registro) {
      return avaliarConsentimento(null, 30).valido;
    }

    const avaliacao = avaliarConsentimento(
      {
        decision: registro.decision,
        subjectKind: registro.subjectKind,
        subjectAgeYears: registro.subjectAgeYears,
        supersededAt: registro.supersededAt,
        documentRetiredAt: registro.document.retiredAt,
      },
      30,
    );

    return avaliacao.valido;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    service = comContextoDeTenant(app.get(EngagementService));

    await montarTenant(tenantA);
    await montarTenant(tenantB);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('os dois regimes convivem na mesma tabela sem se contaminar', async () => {
    // O aluno RECUSOU biometria (regime OPT-IN) e nao manifestou nada sobre
    // ranking (regime OPT-OUT). Se alguem unificar os predicados, um dos
    // dois inverte e este teste cai.
    const alunoId = await criarAluno(tenantA.id, tenantA.gymUnitId);
    const agora = new Date();

    await registrarConsentimentoBiometrico(tenantA.id, alunoId, 'REFUSED', agora);

    expect(await biometriaAutorizada(tenantA.id, alunoId)).toBe(false);

    const preferencias = await service.obterPreferencias(ctxDe(tenantA), alunoId);
    expect(preferencias.finalidades.RANKING).toBe(true);
  });

  it('dois alunos podem ter o mesmo alias PENDENTE', async () => {
    const aluno1 = await criarAluno(tenantA.id, tenantA.gymUnitId);
    const aluno2 = await criarAluno(tenantA.id, tenantA.gymUnitId);
    const agora = new Date();

    const perfil1 = await service.definirAliasPublico(
      ctxDe(tenantA),
      { studentId: aluno1, identityChoice: 'APELIDO', alias: 'Tigre', version: null },
      agora,
    );
    expect(perfil1.status).toBe('PENDING');

    await expect(
      service.definirAliasPublico(
        ctxDe(tenantA),
        { studentId: aluno2, identityChoice: 'APELIDO', alias: 'Tigre', version: null },
        agora,
      ),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('o segundo APPROVED com o mesmo alias e recusado', async () => {
    const ctx = ctxDe(tenantA);
    const aluno1 = await criarAluno(tenantA.id, tenantA.gymUnitId);
    const aluno2 = await criarAluno(tenantA.id, tenantA.gymUnitId);
    const agora = new Date();

    const perfil1 = await service.definirAliasPublico(
      ctx,
      { studentId: aluno1, identityChoice: 'APELIDO', alias: 'Leao', version: null },
      agora,
    );
    const perfil2 = await service.definirAliasPublico(
      ctx,
      { studentId: aluno2, identityChoice: 'APELIDO', alias: 'Leao', version: null },
      agora,
    );

    await service.moderarAlias(
      ctx,
      { perfilId: perfil1.id, decisao: 'APPROVED', rejectionReason: null },
      agora,
    );

    await expect(
      service.moderarAlias(
        ctx,
        { perfilId: perfil2.id, decisao: 'APPROVED', rejectionReason: null },
        agora,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('o mesmo alias aprovado em OUTRO tenant e permitido', async () => {
    // O indice e por tenant. Se alguem esquecer `tenant_id` na chave, dois
    // clientes diferentes brigam pelo mesmo apelido.
    const alunoDoA = await criarAluno(tenantA.id, tenantA.gymUnitId);
    const alunoDoB = await criarAluno(tenantB.id, tenantB.gymUnitId);
    const agora = new Date();

    const perfilDoA = await service.definirAliasPublico(
      ctxDe(tenantA),
      { studentId: alunoDoA, identityChoice: 'APELIDO', alias: 'Falcao', version: null },
      agora,
    );
    await service.moderarAlias(
      ctxDe(tenantA),
      { perfilId: perfilDoA.id, decisao: 'APPROVED', rejectionReason: null },
      agora,
    );

    const perfilDoB = await service.definirAliasPublico(
      ctxDe(tenantB),
      { studentId: alunoDoB, identityChoice: 'APELIDO', alias: 'Falcao', version: null },
      agora,
    );

    await expect(
      service.moderarAlias(
        ctxDe(tenantB),
        { perfilId: perfilDoB.id, decisao: 'APPROVED', rejectionReason: null },
        agora,
      ),
    ).resolves.toMatchObject({ status: 'APPROVED' });
  });

  it('decisao vigente e a mais recente mesmo com occurredAt empatado', async () => {
    // Empate de timestamp nao pode deixar a ordem fisica do banco decidir.
    // O caso de uso nao produz esse empate sozinho (cada chamada carimba o
    // proprio `agora`, e `registrarDecisao` supera a linha anterior antes de
    // criar a nova, entao nunca ha duas linhas VIVAS no fluxo normal). O
    // arranjo escreve as duas linhas direto pelo Prisma: mesmo `occurredAt`,
    // as DUAS com `supersededAt: null` (nada supera nada -- e o estado que
    // o `where: { supersededAt: null }` de `decisaoVigente` permite passar
    // adiante, ainda que o caminho de escrita normal nao o produza), e
    // `createdAt` diferente. So o `orderBy` por `createdAt` desempata.
    const alunoId = await criarAluno(tenantA.id, tenantA.gymUnitId);
    const documento = await db.consentDocument.findFirstOrThrow({
      where: { tenantId: tenantA.id, type: 'RANKING', retiredAt: null },
    });
    const instanteEmpatado = new Date('2026-08-20T10:00:00.000Z');

    await db.consentRecord.create({
      data: {
        tenantId: tenantA.id,
        studentId: alunoId,
        documentId: documento.id,
        decision: 'ACCEPTED',
        subjectKind: 'STUDENT',
        subjectAgeYears: 30,
        occurredAt: instanteEmpatado,
        createdAt: new Date('2026-08-20T10:00:00.001Z'),
      },
    });

    await db.consentRecord.create({
      data: {
        tenantId: tenantA.id,
        studentId: alunoId,
        documentId: documento.id,
        decision: 'REFUSED',
        subjectKind: 'STUDENT',
        subjectAgeYears: 30,
        occurredAt: instanteEmpatado,
        createdAt: new Date('2026-08-20T10:00:00.002Z'),
      },
    });

    const preferencias = await service.obterPreferencias(ctxDe(tenantA), alunoId);
    // A REFUSED tem createdAt maior -- e a que deve vencer o desempate.
    expect(preferencias.finalidades.RANKING).toBe(false);
  });
});
