# F61 — Super Admin e ciclo de vida do tenant — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o dono do ArenaHub cria, edita, lista, ativa e inativa tenants e unidades pelo painel, e entra num tenant só por sessão elevada com justificativa e prazo, auditada.

**Architecture:** módulo `platform` novo na API, com ator próprio (`PlatformAdmin`) fora do mecanismo de papéis por tenant. `Session.tenantId` passa a aceitar nulo para a sessão de plataforma; a elevação é registro próprio (`SupportElevation`) que emite novo par de tokens com o tenant alvo e preenche o `supportElevation` que já existe — declarado e morto — no `TenantContext`. No painel, grupo de rotas `(platform)` fora do `(protected)`.

**Tech Stack:** NestJS · Prisma 7 · PostgreSQL · Next.js 16.3.1 (App Router) · Zod · Jest (integração) · Vitest (unit) · Playwright (E2E)

**Spec:** [`docs/superpowers/specs/2026-09-09-f61-super-admin-design.md`](../specs/2026-09-09-f61-super-admin-design.md)

## Corrigido durante a execução

Descoberto ao executar as tasks 1 e 2, e que o plano original errava. **Vale para todas as tasks seguintes.**

| # | o que o plano dizia | o que é verdade |
|---|---|---|
| 1 | teste em `apps/api/test/platform/` | **o `roots` do Jest é `<rootDir>/test/integration`** — teste fora dali **não é coletado**, e a suíte fica verde sem rodar nada. Caminho correto: `apps/api/test/integration/platform-<assunto>.int-spec.ts` (já corrigido no texto abaixo) |
| 2 | `pnpm --filter @arenahub/database generate` basta | o `exports` do pacote aponta para **`dist`**, e o `generate` só reescreve `src/generated`. Depois de mexer no schema é preciso **`pnpm --filter @arenahub/database build`**, senão o consumidor vê o client velho e o teste falha por um motivo que não é o real |
| 3 | nada sobre OpenAPI | **toda rota nova exige** `@ApiOkResponse` com schema, entrada na lista de rotas declaradas, e regeneração de `packages/api-contracts/openapi/arenahub-v1.json` com `ATUALIZAR_OPENAPI=1`. Há guarda de CI para isso |
| 4 | `SessionRepository.abrir/rotacionar` inalterado | `Session.tenantId` nullable **mudou a assinatura**: os dois agora aceitam `tenantId: string \| null`. A Task 5 depende disso |
| 5 | `logarComoSuperAdmin()` nos testes | **não existe até a Task 6** (o login de plataforma nasce lá). Antes disso, monte o cenário à mão: usuário + `PlatformAdmin` + `Session` com `tenantId: null` + token via `TokenService` |
| 6 | fixture com `passwordHash` literal | **`vazamento.int-spec` varre a tabela inteira** e falha se achar hash literal. Use `PasswordService.gerarHash` em toda fixture de usuário |

**Ambiente:** o worktree não tem `.env` (é gitignored). Ele foi copiado de `C:\Desenv\Projetos\arenahub\.env`; se sumir, copie de novo — sem ele nenhum teste de integração conecta.

**Crash conhecido no Windows:** a integração completa numa rodada só aborta com `3221226505` **depois** dos testes passarem. É pré-existente, não regressão (memória do projeto registra). Rodar em shards contorna.

---

## Global Constraints

- **Idioma:** documentação, commits e texto de interface em **pt-BR**; código e identificadores em **inglês**. Comentário de código: pt-BR sem acento (o repo é consistente nisso).
- **`TenantContext` é o PRIMEIRO argumento de todo método de repositório de tenant** — INV-003 e regra de arquitetura nº 2. Nenhum método aceita `tenantId` solto.
- **`tenantId` sai sempre da identidade autenticada**, nunca do corpo, query ou header da requisição.
- **Evento de domínio e auditoria vão na MESMA transação da mudança de estado** — regra de arquitetura nº 5 (transactional outbox).
- **`metadata` de auditoria não carrega PII** — sem e-mail, sem CPF, sem nome de pessoa.
- **Recurso de outro tenant devolve 404, nunca 403.** Exceção consciente desta fatia: `/platform` devolve **403** para usuário de tenant, porque não é recurso de tenant e não há existência a esconder.
- **Fonte única das permissões do OWNER:** `packages/database/src/permissoes.ts` (`PERMISSOES_DO_OWNER`). Nunca repetir a lista.
- **Sem `any` implícito; `unknown` antes de validar dado externo; nada de float para dinheiro.**
- **Erro de domínio tem código estável** e a resposta HTTP segue `application/problem+json`.
- **Toast para Info/Warn/Error** — nunca `alert`.
- **Portas fixas:** API `3344`, `admin-web` `3000`. Colisão falha, não troca.
- **Antes de cada commit:** `pnpm lint && pnpm typecheck && pnpm test`. Antes do PR: `pnpm test:report` (o `pnpm test` **não** roda integração nem E2E).

---

## File Structure

**`packages/database`**
- Modificar: `prisma/schema.prisma` — 3 models novos, 3 alterações
- Criar: `prisma/migrations/<timestamp>_f61_platform/migration.sql`
- Criar: `src/platform/permissoes-de-plataforma.ts` — códigos de ação de auditoria de plataforma
- Criar: `test/platform-schema.int-spec.ts`

**`apps/api/src/common`**
- Criar: `platform/platform-context.ts` — o tipo
- Criar: `platform/platform-context.service.ts` — request-scoped, `require()` lança
- Criar: `security/platform-route.decorator.ts` — `@PlatformRoute()`
- Criar: `security/platform.guard.ts`
- Modificar: `security/auth.guard.ts` — ramo de plataforma + elevação

**`apps/api/src/modules/platform`** (módulo novo)
- `platform.module.ts`
- `tenant.repository.ts` — CRUD de tenant, com transação e auditoria
- `platform-audit.service.ts` — escrita de `PlatformAuditLog`
- `criar-tenant.use-case.ts`
- `alterar-tenant.use-case.ts` — editar dados e alternar status
- `elevar.use-case.ts` / `encerrar-elevacao.use-case.ts`
- `elevacao.repository.ts`
- `platform.controller.ts` — rotas `/api/v1/platform/*`
- `dto/` — schemas Zod de entrada

**`apps/api/src/modules/auth`**
- Modificar: `auth.service.ts` — ramo de MFA obrigatório para `PlatformAdmin`
- Modificar: `auth.controller.ts` — endpoint de verificação de MFA
- Modificar: `token.service.ts` — `ClaimsDeAcesso.tenantId` aceita nulo

**`apps/admin-web`**
- Criar: `app/(platform)/layout.tsx`, `app/(platform)/platform/page.tsx`, `.../novo/`, `.../[tenantId]/`
- Criar: `app/actions/platform.ts`
- Modificar: `app/(protected)/layout.tsx` — faixa de suporte
- Modificar: `proxy.ts` — `/platform` exige sessão
- Criar: `packages/ui/src/faixa-de-suporte.tsx`

**Testes**
- `apps/api/test/integration/platform-*.int-spec.ts` (Jest + Postgres)
- `apps/admin-web/app/actions/platform.test.ts` (Vitest)
- `e2e/platform.spec.ts` (Playwright)

---

## Task 1: Schema e migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_f61_platform/migration.sql`
- Test: `packages/database/test/platform-schema.int-spec.ts`

**Interfaces:**
- Consumes: nada (primeira task)
- Produces: models Prisma `PlatformAdmin`, `SupportElevation`, `PlatformAuditLog`; enum `TenantStatus` com `INACTIVE`; `Session.tenantId` nullable; `Tenant.cnpj`/`timezone`/`responsavelNome`/`responsavelEmail`

- [ ] **Step 1: Escrever o teste de integração que falha**

Criar `packages/database/test/platform-schema.int-spec.ts`:

```ts
import { PrismaClient } from '@arenahub/database';

const db = new PrismaClient();

afterAll(async () => {
  await db.$disconnect();
});

describe('schema da plataforma (F61)', () => {
  it('grava PlatformAuditLog sem tenant, porque ato de plataforma nao tem tenant dono', async () => {
    const registro = await db.platformAuditLog.create({
      data: {
        action: 'tenant.created',
        target: 'tenant',
        correlationId: 'teste-f61',
      },
    });

    expect(registro.tenantId).toBeNull();
    expect(registro.occurredAt).toBeInstanceOf(Date);
  });

  it('aceita Session sem tenant, porque a sessao de plataforma nao esta em tenant nenhum', async () => {
    const usuario = await db.user.create({
      data: { email: `f61-sessao-${Date.now()}@teste.local`, passwordHash: 'x' },
    });

    const sessao = await db.session.create({
      data: {
        userId: usuario.id,
        tenantId: null,
        tokenHash: `hash-${Date.now()}`,
        familyId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(sessao.tenantId).toBeNull();
  });

  it('aceita TenantStatus INACTIVE, que e o desligamento pelo dono do SaaS', async () => {
    const tenant = await db.tenant.create({
      data: {
        slug: `f61-inativo-${Date.now()}`,
        legalName: 'Academia Teste LTDA',
        displayName: 'Academia Teste',
        status: 'INACTIVE',
      },
    });

    expect(tenant.status).toBe('INACTIVE');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
pnpm --filter @arenahub/database test:integration -- platform-schema
```

Esperado: FALHA — `db.platformAuditLog` não existe (`TypeError: Cannot read properties of undefined`).

- [ ] **Step 3: Escrever o schema**

Em `packages/database/prisma/schema.prisma`:

Alterar o enum existente:

```prisma
enum TenantStatus {
  ACTIVE
  /// Desligado pelo dono do SaaS -- ato administrativo (ADR-052 §4).
  INACTIVE
  /// Inadimplencia. Quem escreve e a F65 (ADR-053), nunca o CRUD.
  SUSPENDED

  @@map("tenant_status")
}
```

Em `model Tenant`, acrescentar depois de `displayName`:

```prisma
  cnpj             String?
  timezone         String?
  responsavelNome  String? @map("responsavel_nome")
  responsavelEmail String? @map("responsavel_email")
```

Em `model Session`, trocar `tenantId String @db.Uuid` por:

```prisma
  /// Nulo na sessao de PLATAFORMA: o Super Admin nao esta em tenant nenhum.
  /// Toda rota de tenant rejeita contexto sem tenant -- ver AuthGuard.
  tenantId String? @map("tenant_id") @db.Uuid
```

E a relação correspondente passa a `tenant Tenant? @relation(...)`.

Models novos:

```prisma
/// Dono do SaaS. Fora do mecanismo de papeis por tenant de proposito:
/// `Role` e por tenant (`@@unique([tenantId, name])`) e afrouxa-lo poria
/// papel global e papel de tenant na mesma query -- um bug de filtro ali
/// vira vazamento entre tenants.
model PlatformAdmin {
  id              String    @id @default(uuid()) @db.Uuid
  userId          String    @unique @map("user_id") @db.Uuid
  grantedByUserId String?   @map("granted_by_user_id") @db.Uuid
  grantedAt       DateTime  @default(now()) @map("granted_at")
  /// Revogar e ESCREVER aqui, nunca deletar: o rastro de quem foi dono do
  /// SaaS nao some. Ativo = `revokedAt IS NULL`.
  revokedAt       DateTime? @map("revoked_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  user      User  @relation("PlatformAdminUser", fields: [userId], references: [id], onDelete: Cascade)
  grantedBy User? @relation("PlatformAdminGrantedBy", fields: [grantedByUserId], references: [id], onDelete: SetNull)

  @@map("platform_admins")
}

/// Uma entrada de suporte num tenant. Viva = `endedAt IS NULL AND expiresAt > agora`.
model SupportElevation {
  id                  String    @id @default(uuid()) @db.Uuid
  sessionId           String    @map("session_id") @db.Uuid
  platformAdminUserId String    @map("platform_admin_user_id") @db.Uuid
  tenantId            String    @map("tenant_id") @db.Uuid
  /// Justificativa do ato. Texto livre validado no caso de uso (>= 10).
  reason              String
  expiresAt           DateTime  @map("expires_at")
  endedAt             DateTime? @map("ended_at")
  endedReason         String?   @map("ended_reason")
  createdAt           DateTime  @default(now()) @map("created_at")

  session       Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  platformAdmin User    @relation("SupportElevationAdmin", fields: [platformAdminUserId], references: [id], onDelete: Cascade)
  tenant        Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([sessionId, expiresAt])
  @@map("support_elevations")
}

/// Auditoria de ato de PLATAFORMA. Separada do `AuditLog` porque aquele
/// exige `tenantId` com FK -- e "criou o tenant X" nao tem tenant dono no
/// momento do ato.
///
/// Sem `updatedAt` de proposito: registro de auditoria nao se edita.
model PlatformAuditLog {
  id            String   @id @default(uuid()) @db.Uuid
  actorUserId   String?  @map("actor_user_id") @db.Uuid
  action        String
  target        String
  targetId      String?  @map("target_id")
  /// SEM foreign key de proposito: e referencia historica e precisa
  /// sobreviver ao tenant que descreve.
  tenantId      String?  @map("tenant_id") @db.Uuid
  correlationId String   @map("correlation_id")
  ipAddress     String?  @map("ip_address")
  userAgent     String?  @map("user_agent")
  metadata      Json?
  occurredAt    DateTime @default(now()) @map("occurred_at")

  actor User? @relation("PlatformAuditActor", fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([occurredAt])
  @@index([correlationId])
  @@map("platform_audit_logs")
}
```

Em `model User`, acrescentar as relações inversas:

```prisma
  platformAdmin        PlatformAdmin?     @relation("PlatformAdminUser")
  platformAdminsGranted PlatformAdmin[]   @relation("PlatformAdminGrantedBy")
  supportElevations    SupportElevation[] @relation("SupportElevationAdmin")
  platformAuditLogs    PlatformAuditLog[] @relation("PlatformAuditActor")
```

Em `model Tenant`, acrescentar:

```prisma
  supportElevations SupportElevation[]
```

- [ ] **Step 4: Gerar a migration**

`migrate diff` exige `--output` — redirecionar `stdout` grava o banner do dotenv dentro do SQL e o `psql` morre com erro que não aponta a causa.

```bash
cd packages/database
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_f61_platform
pnpm prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  --output prisma/migrations/<a pasta criada acima>/migration.sql
```

Conferir o SQL gerado à mão: o `ALTER TABLE sessions ALTER COLUMN tenant_id DROP NOT NULL` tem de estar lá, e nenhum `DROP TABLE` pode aparecer.

- [ ] **Step 5: Aplicar e rodar o teste**

```bash
pnpm prisma migrate dev
pnpm --filter @arenahub/database test:integration -- platform-schema
```

Esperado: PASS nos três.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations packages/database/test/platform-schema.int-spec.ts
git commit -m "feat(platform): schema do ator de plataforma, elevacao e auditoria

PlatformAdmin fora do mecanismo de papeis por tenant, SupportElevation com
prazo, PlatformAuditLog sem FK de tenant. Session.tenantId passa a aceitar
nulo para a sessao de plataforma.

refs #284"
```

---

## Task 2: `PlatformContext` e o ramo de plataforma no `AuthGuard`

**Files:**
- Create: `apps/api/src/common/platform/platform-context.ts`
- Create: `apps/api/src/common/platform/platform-context.service.ts`
- Create: `apps/api/src/common/security/platform-route.decorator.ts`
- Create: `apps/api/src/common/security/platform.guard.ts`
- Modify: `apps/api/src/common/security/auth.guard.ts`
- Modify: `apps/api/src/modules/auth/token.service.ts:19-26`
- Test: `apps/api/test/integration/platform-auth-de-plataforma.int-spec.ts`

**Interfaces:**
- Consumes: models da Task 1
- Produces:
  - `interface PlatformContext { actorId: string; sessionId: string; platformAdminId: string }`
  - `PlatformContextService.require(): PlatformContext` / `.opcional(): PlatformContext | undefined`
  - `@PlatformRoute()` — decorator de marcação
  - `express.Request.platformContext?: PlatformContext`
  - `ClaimsDeAcesso.tenantId: string | null`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/integration/platform-auth-de-plataforma.int-spec.ts`:

```ts
describe('autenticacao de plataforma', () => {
  it('usuario de tenant recebe 403 problem+json em rota de plataforma', async () => {
    const { cookie } = await logarComoOwnerDeTenant();

    const resposta = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants')
      .set('Cookie', cookie);

    expect(resposta.status).toBe(403);
    expect(resposta.headers['content-type']).toContain('application/problem+json');
    expect(resposta.body.code).toBe('FORBIDDEN');
  });

  it('Super Admin com sessao sem tenant alcanca rota de plataforma', async () => {
    const { cookie } = await logarComoSuperAdmin();

    const resposta = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants')
      .set('Cookie', cookie);

    expect(resposta.status).toBe(200);
  });

  it('Super Admin revogado nao alcanca rota de plataforma', async () => {
    const { cookie, userId } = await logarComoSuperAdmin();
    await db.platformAdmin.update({
      where: { userId },
      data: { revokedAt: new Date() },
    });

    const resposta = await request(app.getHttpServer())
      .get('/api/v1/platform/tenants')
      .set('Cookie', cookie);

    expect(resposta.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @arenahub/api test:integration -- auth-de-plataforma
```

Esperado: FALHA — a rota `/api/v1/platform/tenants` não existe (404, não 403).

- [ ] **Step 3: Escrever o contexto e o decorator**

`apps/api/src/common/platform/platform-context.ts`:

```ts
/**
 * Contexto do ator de PLATAFORMA -- o dono do SaaS.
 *
 * Separado de `TenantContext` de proposito: aquele exige `tenantId` e o
 * `require()` dele LANCA quando nao ha tenant. Afrouxa-lo para caber a
 * plataforma faria o Prisma listar tudo quando alguem esquecesse o filtro,
 * que e exatamente o que INV-003 impede.
 */
export interface PlatformContext {
  actorId: string;
  sessionId: string;
  platformAdminId: string;
}
```

`apps/api/src/common/platform/platform-context.service.ts` — espelhar `TenantContextService`:

```ts
import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../http/erro-de-dominio.js';
import type { PlatformContext } from './platform-context.js';

@Injectable({ scope: Scope.REQUEST })
export class PlatformContextService {
  constructor(@Inject(REQUEST) private readonly requisicao: Request) {}

  require(): PlatformContext {
    const contexto = this.requisicao.platformContext;

    if (!contexto) throw new NaoAutenticadoError();

    return contexto;
  }

  opcional(): PlatformContext | undefined {
    return this.requisicao.platformContext;
  }
}
```

`apps/api/src/common/security/platform-route.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const ROTA_DE_PLATAFORMA = 'ROTA_DE_PLATAFORMA';

/** Marca a rota como exclusiva do dono do SaaS. Ver `PlatformGuard`. */
export const PlatformRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ROTA_DE_PLATAFORMA, true);
```

`apps/api/src/common/security/platform.guard.ts`:

```ts
import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ROTA_DE_PLATAFORMA } from './platform-route.decorator.js';

/**
 * 403, e nao o 404 habitual de recurso alheio.
 *
 * O padrao do projeto e devolver 404 para recurso de outro tenant, porque
 * 403 confirmaria que ele existe. Aqui nao ha recurso a esconder: `/platform`
 * e uma superficie inteira, e a existencia dela nao e segredo.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    const exige = this.reflector.getAllAndOverride<boolean>(ROTA_DE_PLATAFORMA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exige) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();

    if (!requisicao.platformContext) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }

    return true;
  }
}
```

- [ ] **Step 4: Alterar o `AuthGuard`**

Em `apps/api/src/common/security/auth.guard.ts`, substituir o corpo do `try` do `canActivate` (linhas 43-51) por:

```ts
    try {
      const claims = this.tokens.verificarAcesso(token);

      // Token SEM tenant = sessao de plataforma. E o unico caminho em que
      // nao existe `TenantContext`, e toda rota de tenant o rejeita.
      if (claims.tenantId === null || claims.tenantId === undefined) {
        requisicao.platformContext = await this.montarContextoDePlataforma(claims.sub, claims);
      } else {
        requisicao.tenantContext = await this.montarContexto(claims.sub, claims.tenantId, claims);
      }
    } catch {
      throw new NaoAutenticadoError();
    }
```

E acrescentar o método:

```ts
  /**
   * Sessao de plataforma. Le `PlatformAdmin` ATIVO -- revogacao vale na
   * hora, pelo mesmo motivo que as permissoes de tenant vem do banco e nao
   * do token.
   */
  private async montarContextoDePlataforma(
    userId: string,
    claims: { sessionId: string },
  ): Promise<PlatformContext> {
    const admin = await this.db.platformAdmin.findFirst({
      where: { userId, revokedAt: null },
    });

    // Sem `PlatformAdmin` ativo, um token sem tenant nao autoriza nada.
    // Lancar aqui cai no `catch` do chamador e vira 401.
    if (!admin) throw new NaoAutenticadoError();

    return { actorId: userId, sessionId: claims.sessionId, platformAdminId: admin.id };
  }
```

Registrar o `PlatformGuard` em `apps/api/src/app.module.ts`, logo depois do `AuthGuard` e antes do `PermissionsGuard`:

```ts
    { provide: APP_GUARD, useClass: PlatformGuard },
```

E em `apps/api/src/types/express.d.ts`, acrescentar ao `Request`:

```ts
    platformContext?: PlatformContext;
```

- [ ] **Step 5: Afrouxar o claim de tenant**

Em `apps/api/src/modules/auth/token.service.ts:19-26`:

```ts
export interface ClaimsDeAcesso {
  sub: string;
  /** Nulo na sessao de plataforma -- o Super Admin nao esta em tenant nenhum. */
  tenantId: string | null;
  sessionId: string;
  permissions: string[];
  mfa: boolean;
  unitIds?: string[];
}
```

- [ ] **Step 6: Rodar os testes**

```bash
pnpm --filter @arenahub/api test:integration -- auth-de-plataforma
pnpm --filter @arenahub/api test
```

Esperado: os três novos passam; **a suíte existente continua verde** — nenhuma rota de tenant muda de comportamento.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common apps/api/src/modules/auth/token.service.ts apps/api/src/app.module.ts apps/api/src/types apps/api/test/platform
git commit -m "feat(platform): contexto de plataforma e ramo sem tenant no AuthGuard

Token sem tenantId monta PlatformContext lendo PlatformAdmin ativo do banco.
Rota marcada com @PlatformRoute responde 403 a usuario de tenant.

refs #284"
```

---

## Task 3: CRUD de tenant — criar

**Files:**
- Create: `apps/api/src/modules/platform/platform.module.ts`
- Create: `apps/api/src/modules/platform/platform-audit.service.ts`
- Create: `apps/api/src/modules/platform/tenant.repository.ts`
- Create: `apps/api/src/modules/platform/criar-tenant.use-case.ts`
- Create: `apps/api/src/modules/platform/dto/criar-tenant.dto.ts`
- Create: `apps/api/src/modules/platform/platform.controller.ts`
- Test: `apps/api/test/integration/platform-criar-tenant.int-spec.ts`

**Interfaces:**
- Consumes: `PlatformContext`, `@PlatformRoute()` (Task 2); `InvitationService.convidar` do módulo `iam`; `PERMISSOES_DO_OWNER` de `@arenahub/database`
- Produces:
  - `PlatformAuditService.registrar(contexto, dados, tx?)`
  - `CriarTenantUseCase.executar(contexto, entrada, correlationId): Promise<{ tenantId, gymUnitId, ownerInvitationToken }>`
  - `POST /api/v1/platform/tenants` · `GET /api/v1/platform/tenants`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/integration/platform-criar-tenant.int-spec.ts`:

```ts
describe('criar tenant pelo painel', () => {
  it('cria tenant, primeira unidade, papel OWNER e convite numa transacao', async () => {
    const { contexto } = await criarSuperAdmin();

    const resultado = await useCase.executar(
      contexto,
      {
        slug: `academia-${Date.now()}`,
        legalName: 'Academia Nova LTDA',
        displayName: 'Academia Nova',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: 'dono@academia.local',
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      'correlacao-teste',
    );

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: resultado.tenantId } });
    expect(tenant.status).toBe('ACTIVE');

    const unidades = await db.gymUnit.findMany({ where: { tenantId: resultado.tenantId } });
    expect(unidades).toHaveLength(1);

    const convite = await db.invitation.findFirstOrThrow({
      where: { tenantId: resultado.tenantId },
    });
    expect(convite.status).toBe('PENDING');
  });

  it('da ao OWNER exatamente as permissoes de PERMISSOES_DO_OWNER, sem lista repetida no teste', async () => {
    const { contexto } = await criarSuperAdmin();

    const resultado = await useCase.executar(contexto, entradaValida(), 'correlacao-teste');

    const papel = await db.role.findFirstOrThrow({
      where: { tenantId: resultado.tenantId, name: 'OWNER' },
      include: { permissions: { include: { permission: true } } },
    });

    const concedidas = papel.permissions.map((p) => p.permission.code).sort();
    expect(concedidas).toEqual([...PERMISSOES_DO_OWNER].sort());
  });

  it('registra o ato no PlatformAuditLog, que e onde ato sem tenant dono cabe', async () => {
    const { contexto } = await criarSuperAdmin();

    const resultado = await useCase.executar(contexto, entradaValida(), 'correlacao-unica-f61');

    const registro = await db.platformAuditLog.findFirstOrThrow({
      where: { correlationId: 'correlacao-unica-f61' },
    });
    expect(registro.action).toBe('tenant.created');
    expect(registro.tenantId).toBe(resultado.tenantId);
    expect(registro.actorUserId).toBe(contexto.actorId);
  });

  it('recusa slug repetido sem deixar tenant orfao no banco', async () => {
    const { contexto } = await criarSuperAdmin();
    const entrada = entradaValida();
    await useCase.executar(contexto, entrada, 'primeira');

    const antes = await db.tenant.count();
    await expect(useCase.executar(contexto, entrada, 'segunda')).rejects.toThrow();
    const depois = await db.tenant.count();

    // A transacao inteira volta atras: slug repetido nao deixa unidade,
    // papel nem convite pendurados.
    expect(depois).toBe(antes);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @arenahub/api test:integration -- criar-tenant
```

Esperado: FALHA — `CriarTenantUseCase` não existe.

- [ ] **Step 3: Escrever o serviço de auditoria**

`apps/api/src/modules/platform/platform-audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';

export interface AtoDePlataforma {
  action: string;
  target: string;
  targetId?: string;
  tenantId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Escrita do `PlatformAuditLog`.
 *
 * Aceita `tx` para entrar na MESMA transacao da mudanca de estado (regra de
 * arquitetura no 5). Sem ele, auditoria de ato que falhou depois ficaria
 * gravada como se tivesse acontecido.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly db: PrismaService) {}

  async registrar(
    contexto: PlatformContext,
    ato: AtoDePlataforma,
    correlationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const cliente = tx ?? this.db;

    await cliente.platformAuditLog.create({
      data: {
        actorUserId: contexto.actorId,
        action: ato.action,
        target: ato.target,
        ...(ato.targetId === undefined ? {} : { targetId: ato.targetId }),
        ...(ato.tenantId === undefined ? {} : { tenantId: ato.tenantId }),
        correlationId,
        ...(ato.metadata === undefined ? {} : { metadata: ato.metadata }),
      },
    });
  }
}
```

- [ ] **Step 4: Escrever o caso de uso**

`apps/api/src/modules/platform/criar-tenant.use-case.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PERMISSOES_DO_OWNER } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PlatformAuditService } from './platform-audit.service.js';

const CONVITE_VALIDO_POR_HORAS = 24;

export interface EntradaDeTenant {
  slug: string;
  legalName: string;
  displayName: string;
  cnpj: string;
  timezone: string;
  responsavelNome: string;
  responsavelEmail: string;
  unidade: { code: string; name: string; timezone: string };
}

/**
 * Cria o tenant inteiro numa transacao: tenant, primeira unidade, papel
 * OWNER com as permissoes, e o convite do dono.
 *
 * Substitui `bootstrap-tenant.ts` para CRIAR TENANT -- o script fica, porque
 * o primeiro Super Admin ainda precisa nascer fora do painel.
 */
@Injectable()
export class CriarTenantUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async executar(
    contexto: PlatformContext,
    entrada: EntradaDeTenant,
    correlationId: string,
  ): Promise<{ tenantId: string; gymUnitId: string; ownerInvitationToken: string }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiraEm = new Date(Date.now() + CONVITE_VALIDO_POR_HORAS * 60 * 60 * 1000);

    const resultado = await this.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: entrada.slug,
          legalName: entrada.legalName,
          displayName: entrada.displayName,
          cnpj: entrada.cnpj,
          timezone: entrada.timezone,
          responsavelNome: entrada.responsavelNome,
          responsavelEmail: entrada.responsavelEmail,
        },
      });

      const unidade = await tx.gymUnit.create({
        data: {
          tenantId: tenant.id,
          code: entrada.unidade.code,
          name: entrada.unidade.name,
          timezone: entrada.unidade.timezone,
          openingHours: {},
        },
      });

      const papel = await tx.role.create({
        data: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
      });

      // Fonte unica: `PERMISSOES_DO_OWNER`. Repetir a lista aqui ja produziu
      // OWNER real sem `access.read` em producao.
      for (const code of PERMISSOES_DO_OWNER) {
        const permissao = await tx.permission.upsert({
          where: { code },
          create: { code },
          update: {},
        });

        await tx.rolePermission.create({
          data: { roleId: papel.id, permissionId: permissao.id },
        });
      }

      const convite = await tx.invitation.create({
        data: {
          tenantId: tenant.id,
          email: entrada.responsavelEmail.toLowerCase(),
          roleId: papel.id,
          tokenHash,
          expiresAt: expiraEm,
        },
      });

      await this.auditoria.registrar(
        contexto,
        {
          action: 'tenant.created',
          target: 'tenant',
          targetId: tenant.id,
          tenantId: tenant.id,
          // Sem PII: slug e codigo de unidade sao dado operacional. O e-mail
          // do responsavel NAO entra.
          metadata: { slug: tenant.slug, unitCode: unidade.code },
        },
        correlationId,
        tx,
      );

      return { tenantId: tenant.id, gymUnitId: unidade.id, invitationId: convite.id };
    });

    return {
      tenantId: resultado.tenantId,
      gymUnitId: resultado.gymUnitId,
      ownerInvitationToken: token,
    };
  }
}
```

- [ ] **Step 5: Escrever o DTO e o controller**

`apps/api/src/modules/platform/dto/criar-tenant.dto.ts`:

```ts
import { z } from 'zod';

/**
 * `slug` e identificador publico usado em URL (F62 fara login por ele).
 * Minusculas, numeros e hifen -- nada que precise de escape.
 */
export const esquemaDeCriacaoDeTenant = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'slug aceita apenas minusculas, numeros e hifen'),
  legalName: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  cnpj: z.string().trim().regex(/^\d{14}$/, 'CNPJ deve ter 14 digitos'),
  timezone: z.string().min(1),
  responsavelNome: z.string().trim().min(1).max(120),
  responsavelEmail: z.string().trim().toLowerCase().email(),
  unidade: z.object({
    code: z.string().trim().min(1).max(32),
    name: z.string().trim().min(1).max(120),
    timezone: z.string().min(1),
  }),
});
```

`apps/api/src/modules/platform/platform.controller.ts`:

```ts
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { PlatformRoute } from '../../common/security/platform-route.decorator.js';
import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { esquemaDeCriacaoDeTenant } from './dto/criar-tenant.dto.js';
import { CriarTenantUseCase } from './criar-tenant.use-case.js';
import { TenantRepository } from './tenant.repository.js';
import { EmailDeConviteService } from '../iam/email-de-convite.service.js';

@Controller('api/v1/platform')
@PlatformRoute()
export class PlatformController {
  constructor(
    private readonly contexto: PlatformContextService,
    private readonly criarTenant: CriarTenantUseCase,
    private readonly tenants: TenantRepository,
    private readonly email: EmailDeConviteService,
  ) {}

  @Get('tenants')
  async listar() {
    return this.tenants.listar();
  }

  @Post('tenants')
  async criar(@Body() corpo: unknown, @Req() requisicao: Request) {
    const entrada = esquemaDeCriacaoDeTenant.parse(corpo);
    const correlationId = requisicao.correlationId ?? 'sem-correlacao';

    const resultado = await this.criarTenant.executar(
      this.contexto.require(),
      entrada,
      correlationId,
    );

    // FORA da transacao, como o `iam.controller` ja faz: e-mail que falha
    // nao pode desfazer o tenant que foi criado.
    const envio = await this.email.enviar(entrada.responsavelEmail, resultado.ownerInvitationToken);

    return {
      id: resultado.tenantId,
      gymUnitId: resultado.gymUnitId,
      emailEnviado: envio.enviado,
    };
  }
}
```

`tenant.repository.ts` com o `listar()` — **sem `TenantContext`**, porque o ator é de plataforma e enxerga todos:

```ts
import { Injectable } from '@nestjs/common';
import type { Tenant } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Acesso a tenants pelo ator de PLATAFORMA.
 *
 * Nao recebe `TenantContext` -- e a unica classe do projeto que legitimamente
 * le tenants sem filtro de tenant. Por isso ela vive no modulo `platform` e
 * so e alcancavel por rota `@PlatformRoute()`.
 */
@Injectable()
export class TenantRepository {
  constructor(private readonly db: PrismaService) {}

  async listar(): Promise<Array<Tenant & { _count: { gymUnits: number } }>> {
    return this.db.tenant.findMany({
      orderBy: { displayName: 'asc' },
      include: { _count: { select: { gymUnits: true } } },
    });
  }
}
```

E o `platform.module.ts` juntando tudo, importando `IamModule` para o `EmailDeConviteService`.

- [ ] **Step 6: Rodar os testes**

```bash
pnpm --filter @arenahub/api test:integration -- criar-tenant
pnpm --filter @arenahub/api test:integration -- auth-de-plataforma
```

Esperado: PASS. O teste de 403 da Task 2 agora encontra a rota de verdade — antes ele passava por 404, o que teria sido verde pelo motivo errado.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/platform apps/api/test/integration/platform-criar-tenant.int-spec.ts
git commit -m "feat(platform): criar tenant pelo painel com OWNER por convite

Tenant, primeira unidade, papel OWNER com PERMISSOES_DO_OWNER e convite numa
transacao so. Auditoria em PlatformAuditLog; e-mail fora da transacao.

refs #284"
```

---

## Task 4: Editar tenant e alternar status

**Files:**
- Create: `apps/api/src/modules/platform/alterar-tenant.use-case.ts`
- Modify: `apps/api/src/modules/platform/tenant.repository.ts`
- Modify: `apps/api/src/modules/platform/platform.controller.ts`
- Create: `apps/api/src/modules/platform/dto/alterar-tenant.dto.ts`
- Test: `apps/api/test/integration/platform-alterar-tenant.int-spec.ts`

**Interfaces:**
- Consumes: `PlatformAuditService`, `TenantRepository` (Task 3)
- Produces: `AlterarTenantUseCase.executar(contexto, tenantId, dados, correlationId, motivo?)`; `PATCH /api/v1/platform/tenants/:id`

- [ ] **Step 1: Escrever o teste que falha**

```ts
describe('alterar tenant', () => {
  it('inativa exigindo motivo, e grava o motivo na auditoria', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);

    await useCase.executar(
      contexto,
      tenantId,
      { status: 'INACTIVE' },
      'correlacao-inativa',
      'Contrato encerrado a pedido do cliente',
    );

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.status).toBe('INACTIVE');

    const registro = await db.platformAuditLog.findFirstOrThrow({
      where: { correlationId: 'correlacao-inativa' },
    });
    expect(registro.action).toBe('tenant.status_changed');
    expect(registro.metadata).toMatchObject({ motivo: 'Contrato encerrado a pedido do cliente' });
  });

  it('recusa inativacao sem motivo', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);

    await expect(
      useCase.executar(contexto, tenantId, { status: 'INACTIVE' }, 'x'),
    ).rejects.toThrow('MOTIVO_OBRIGATORIO');
  });

  it('reativa sem motivo e NAO grava motivo em branco', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    await useCase.executar(contexto, tenantId, { status: 'INACTIVE' }, 'a', 'Motivo qualquer aqui');

    await useCase.executar(contexto, tenantId, { status: 'ACTIVE' }, 'correlacao-reativa');

    const registro = await db.platformAuditLog.findFirstOrThrow({
      where: { correlationId: 'correlacao-reativa' },
    });
    // Motivo em branco na auditoria e pior que campo ausente: parece que
    // alguem respondeu e nao respondeu nada.
    expect(registro.metadata).not.toHaveProperty('motivo');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @arenahub/api test:integration -- alterar-tenant
```

Esperado: FALHA — `AlterarTenantUseCase` não existe.

- [ ] **Step 3: Escrever o caso de uso**

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma, TenantStatus } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PlatformAuditService } from './platform-audit.service.js';

export class MotivoObrigatorioError extends ErroDeDominio {
  constructor() {
    super('MOTIVO_OBRIGATORIO', 400, 'Informe o motivo ao tirar o tenant de operacao');
  }
}

const MOTIVO_MINIMO = 10;

@Injectable()
export class AlterarTenantUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async executar(
    contexto: PlatformContext,
    tenantId: string,
    dados: {
      legalName?: string | undefined;
      displayName?: string | undefined;
      cnpj?: string | undefined;
      timezone?: string | undefined;
      responsavelNome?: string | undefined;
      responsavelEmail?: string | undefined;
      status?: TenantStatus | undefined;
    },
    correlationId: string,
    motivo?: string,
  ): Promise<void> {
    const saindoDeOperacao = dados.status === 'INACTIVE' || dados.status === 'SUSPENDED';

    if (saindoDeOperacao && (motivo === undefined || motivo.trim().length < MOTIVO_MINIMO)) {
      throw new MotivoObrigatorioError();
    }

    const alteracoes = Object.fromEntries(
      Object.entries(dados).filter(([, valor]) => valor !== undefined),
    );

    await this.db.$transaction(async (tx) => {
      const alterados = await tx.tenant.updateMany({ where: { id: tenantId }, data: alteracoes });

      if (alterados.count === 0) throw new ErroDeDominio('NOT_FOUND', 404, 'Tenant nao encontrado');

      await this.auditoria.registrar(
        contexto,
        {
          action: dados.status === undefined ? 'tenant.updated' : 'tenant.status_changed',
          target: 'tenant',
          targetId: tenantId,
          tenantId,
          metadata: {
            campos: Object.keys(dados),
            // Motivo SO quando ele existe de verdade.
            ...(saindoDeOperacao && motivo !== undefined ? { motivo: motivo.trim() } : {}),
          },
        },
        correlationId,
        tx,
      );
    });
  }
}
```

Acrescentar ao controller:

```ts
  @Patch('tenants/:id')
  async alterar(@Param('id') id: string, @Body() corpo: unknown, @Req() requisicao: Request) {
    const entrada = esquemaDeAlteracaoDeTenant.parse(corpo);
    const { reason, ...dados } = entrada;

    await this.alterarTenant.executar(
      this.contexto.require(),
      id,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
      reason,
    );

    return { id };
  }
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm --filter @arenahub/api test:integration -- alterar-tenant
```

Esperado: PASS nos três.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/platform apps/api/test/integration/platform-alterar-tenant.int-spec.ts
git commit -m "feat(platform): editar tenant e alternar status com motivo auditado

Motivo obrigatorio ao tirar de operacao; reativacao nao grava motivo em branco.

refs #284"
```

---

## Task 5: Elevação de suporte

**Files:**
- Create: `apps/api/src/modules/platform/elevacao.repository.ts`
- Create: `apps/api/src/modules/platform/elevar.use-case.ts`
- Create: `apps/api/src/modules/platform/encerrar-elevacao.use-case.ts`
- Modify: `apps/api/src/common/security/auth.guard.ts`
- Modify: `apps/api/src/modules/platform/platform.controller.ts`
- Test: `apps/api/test/integration/platform-elevacao.int-spec.ts`

**Interfaces:**
- Consumes: `PlatformContext`, `PlatformAuditService`, `TokenService.emitirAcesso`, `SessionRepository`
- Produces:
  - `ElevarUseCase.executar(contexto, tenantId, reason, correlationId): Promise<{ accessToken, refreshToken, expiresAt }>`
  - `EncerrarElevacaoUseCase.executar(contexto, correlationId)`
  - `POST /api/v1/platform/tenants/:id/elevar` · `POST /api/v1/platform/elevacao/encerrar`
  - `TenantContext.supportElevation` passa a ser **preenchido**

- [ ] **Step 1: Escrever o teste que falha — com o canário**

```ts
describe('elevacao de suporte', () => {
  it('recusa elevacao sem justificativa', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);

    await expect(useCase.executar(contexto, tenantId, '   ', 'x')).rejects.toThrow(
      'JUSTIFICATIVA_OBRIGATORIA',
    );
  });

  it('grava DUAS linhas de auditoria: uma de plataforma e uma no tenant alvo', async () => {
    const { contexto } = await criarSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);

    await useCase.executar(contexto, tenantId, 'Cliente pediu ajuda com a catraca', 'corr-elev');

    const daPlataforma = await db.platformAuditLog.findFirstOrThrow({
      where: { correlationId: 'corr-elev', action: 'support.elevated' },
    });
    expect(daPlataforma.tenantId).toBe(tenantId);

    // O tenant precisa ENXERGAR que houve suporte -- por isso a segunda linha.
    const doTenant = await db.auditLog.findFirstOrThrow({
      where: { tenantId, correlationId: 'corr-elev' },
    });
    expect(doTenant.actorType).toBe('SUPPORT');
  });

  /*
   * CANARIO. Este par prova que a requisicao ALCANCA a checagem de prazo.
   *
   * Sozinho, o teste de "expirada" passaria mesmo que uma guarda anterior
   * recusasse antes -- verde pelo motivo errado. O primeiro caso mostra que
   * a mesma requisicao passa quando a elevacao esta viva; so entao o segundo
   * caso prova que foi o PRAZO que a barrou.
   */
  it('elevacao viva alcanca rota de tenant', async () => {
    const { cookie, contexto } = await logarComoSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const { cookieElevado } = await elevar(cookie, tenantId, 'Suporte combinado com o cliente');

    const resposta = await request(app.getHttpServer())
      .get('/api/v1/units')
      .set('Cookie', cookieElevado);

    expect(resposta.status).toBe(200);
  });

  it('a MESMA requisicao falha quando a elevacao expirou', async () => {
    const { cookie, contexto } = await logarComoSuperAdmin();
    const tenantId = await criarTenantDeTeste(contexto);
    const { cookieElevado, elevacaoId } = await elevar(cookie, tenantId, 'Suporte combinado');

    await db.supportElevation.update({
      where: { id: elevacaoId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const resposta = await request(app.getHttpServer())
      .get('/api/v1/units')
      .set('Cookie', cookieElevado);

    expect(resposta.status).toBe(403);
  });

  it('INV-006: Super Admin NAO elevado nao le dado de tenant nenhum', async () => {
    const { cookie, contexto } = await logarComoSuperAdmin();
    await criarTenantDeTeste(contexto);

    const resposta = await request(app.getHttpServer()).get('/api/v1/units').set('Cookie', cookie);

    // Sem tenant no token nao existe `TenantContext`, e a rota de tenant
    // nao tem de onde tirar um.
    expect(resposta.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @arenahub/api test:integration -- elevacao
```

Esperado: FALHA — `ElevarUseCase` não existe.

- [ ] **Step 3: Escrever o caso de uso de elevação**

```ts
import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { TokenService } from '../auth/token.service.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PlatformAuditService } from './platform-audit.service.js';

export class JustificativaObrigatoriaError extends ErroDeDominio {
  constructor() {
    super('JUSTIFICATIVA_OBRIGATORIA', 400, 'Escreva a justificativa da entrada de suporte');
  }
}

const JUSTIFICATIVA_MINIMA = 10;
const ELEVACAO_VALIDA_POR_MINUTOS = 30;

/**
 * Abre sessao de suporte num tenant. INV-005: nunca bypass silencioso --
 * justificativa, prazo e auditoria dos DOIS lados.
 */
@Injectable()
export class ElevarUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly tokens: TokenService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async executar(
    contexto: PlatformContext,
    tenantId: string,
    reason: string,
    correlationId: string,
  ): Promise<{ accessToken: string; expiresAt: Date; elevacaoId: string }> {
    const justificativa = reason.trim();

    if (justificativa.length < JUSTIFICATIVA_MINIMA) throw new JustificativaObrigatoriaError();

    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId } });

    if (!tenant) throw new ErroDeDominio('NOT_FOUND', 404, 'Tenant nao encontrado');

    const expiresAt = new Date(Date.now() + ELEVACAO_VALIDA_POR_MINUTOS * 60 * 1000);

    const elevacao = await this.db.$transaction(async (tx) => {
      const criada = await tx.supportElevation.create({
        data: {
          sessionId: contexto.sessionId,
          platformAdminUserId: contexto.actorId,
          tenantId,
          reason: justificativa,
          expiresAt,
        },
      });

      await this.auditoria.registrar(
        contexto,
        {
          action: 'support.elevated',
          target: 'tenant',
          targetId: tenantId,
          tenantId,
          metadata: { motivo: justificativa, expiraEm: expiresAt.toISOString() },
        },
        correlationId,
        tx,
      );

      // A SEGUNDA linha, no tenant alvo: quem opera a academia precisa ver
      // que houve suporte dentro da casa dele (INV-008).
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'SUPPORT',
          actorId: contexto.actorId,
          action: 'support.elevated',
          target: 'tenant',
          targetId: tenantId,
          correlationId,
          metadata: { motivo: justificativa, expiraEm: expiresAt.toISOString() },
        },
      });

      return criada;
    });

    const accessToken = this.tokens.emitirAcesso({
      sub: contexto.actorId,
      tenantId,
      sessionId: contexto.sessionId,
      permissions: [],
      mfa: true,
    });

    return { accessToken, expiresAt, elevacaoId: elevacao.id };
  }
}
```

`EncerrarElevacaoUseCase` escreve `endedAt`/`endedReason` e as duas linhas de saída (`action: 'support.ended'`), e emite token de volta **sem** tenant.

- [ ] **Step 4: Ligar a elevação no `AuthGuard`**

No `montarContexto` do `auth.guard.ts`, antes do `return`, acrescentar:

```ts
    // Super Admin operando dentro de um tenant: so vale com elevacao VIVA.
    // Quem tem `TenantMembership` e usuario normal do tenant e nao passa por
    // aqui -- a checagem custa uma query e so acontece para o ator de
    // plataforma.
    const admin = await this.db.platformAdmin.findFirst({
      where: { userId, revokedAt: null },
    });

    if (admin) {
      const membro = await this.db.tenantMembership.findFirst({
        where: { userId, tenantId, status: 'ACTIVE' },
      });

      if (!membro) {
        const elevacao = await this.db.supportElevation.findFirst({
          where: {
            sessionId: claims.sessionId,
            tenantId,
            endedAt: null,
            expiresAt: { gt: new Date() },
          },
        });

        if (!elevacao) {
          throw new ForbiddenException({ code: 'ELEVATION_REQUIRED' });
        }

        return {
          tenantId,
          actorId: userId,
          sessionId: claims.sessionId,
          permissions,
          allowedUnitIds: valeNoTenantInteiro ? 'ALL' : unidades,
          // O gancho declarado em `tenant-context.ts:21-22` e morto desde a
          // "Task 5" finalmente e preenchido.
          supportElevation: { reason: elevacao.reason, expiresAt: elevacao.expiresAt },
        };
      }
    }
```

**Atenção:** o `ForbiddenException` tem de escapar do `try/catch` do `canActivate`, que hoje converte tudo em 401. Ajustar o `catch` para repassar `ForbiddenException`:

```ts
    } catch (erro) {
      if (erro instanceof ForbiddenException) throw erro;

      throw new NaoAutenticadoError();
    }
```

Sem isso, o teste de elevação expirada veria 401 em vez de 403 — e passaria pelo motivo errado.

Além disso, o Super Admin elevado precisa das permissões do tenant. Como ele não tem `UserRole` lá, `permissions` sai vazio e toda rota com `@RequirePermissions` recusaria. Conceder, na elevação, o mesmo conjunto do OWNER:

```ts
        const permissoesDeSuporte = new Set<string>(PERMISSOES_DO_OWNER);
```

usando `permissoesDeSuporte` no lugar de `permissions` no retorno acima.

- [ ] **Step 5: Rodar os testes**

```bash
pnpm --filter @arenahub/api test:integration -- elevacao
pnpm --filter @arenahub/api test
```

Esperado: os cinco passam. O par de canário é o que importa: o primeiro **tem** de passar, senão o segundo não prova nada.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/platform apps/api/src/common/security/auth.guard.ts apps/api/test/integration/platform-elevacao.int-spec.ts
git commit -m "feat(platform): elevacao de suporte com justificativa, prazo e auditoria dupla

Preenche o supportElevation do TenantContext, declarado e morto desde a
Task 5 anterior. Elevacao expirada devolve 403, provado por canario.

refs #284"
```

---

## Task 6: MFA obrigatório para o Super Admin

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts:58-91`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Test: `apps/api/test/integration/platform-mfa-de-plataforma.int-spec.ts`

**Interfaces:**
- Consumes: `TokenService.emitirPreAuth`/`verificarPreAuth` (existem, nunca chamados); `MfaService`
- Produces: `POST /api/v1/auth/mfa/verify` — troca pre-auth por par definitivo

- [ ] **Step 1: Escrever o teste que falha**

```ts
describe('MFA do Super Admin', () => {
  it('login de Super Admin NAO devolve sessao completa, e sim desafio', async () => {
    await criarSuperAdminComMfa('dono@arenahub.local', 'senha-valida-123');

    const resposta = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'dono@arenahub.local', password: 'senha-valida-123' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.desafio).toBe('MFA_VERIFY');
    // Sem cookie de acesso: um fator so nao abre sessao de plataforma.
    expect(resposta.headers['set-cookie'] ?? []).not.toContainEqual(
      expect.stringContaining('arenahub_access='),
    );
  });

  it('login de usuario COMUM segue devolvendo sessao, sem mudar de comportamento', async () => {
    await criarOwnerDeTenant('gestor@academia.local', 'senha-valida-123');

    const resposta = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'gestor@academia.local', password: 'senha-valida-123' });

    expect(resposta.status).toBe(200);
    expect(resposta.headers['set-cookie']).toContainEqual(
      expect.stringContaining('arenahub_access='),
    );
  });

  it('codigo TOTP correto troca o pre-auth por sessao de plataforma', async () => {
    const { segredo } = await criarSuperAdminComMfa('dono@arenahub.local', 'senha-valida-123');
    const { preAuth } = await logar('dono@arenahub.local', 'senha-valida-123');

    const resposta = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .set('Authorization', `Bearer ${preAuth}`)
      .send({ code: gerarTotp(segredo) });

    expect(resposta.status).toBe(200);
    expect(resposta.headers['set-cookie']).toContainEqual(
      expect.stringContaining('arenahub_access='),
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @arenahub/api test:integration -- mfa-de-plataforma
```

Esperado: FALHA no primeiro caso — hoje o login devolve sessão completa para todo mundo.

- [ ] **Step 3: Escrever o ramo no `AuthService`**

Em `login`, depois de validar a senha e antes de `emitirPar`:

```ts
    const admin = await this.db.platformAdmin.findFirst({
      where: { userId: usuario.id, revokedAt: null },
    });

    // INV-007: MFA obrigatorio para o dono do SaaS. Nenhum outro papel muda
    // de comportamento -- ligar MFA para OWNER e TECH_OPERATOR quebraria o
    // login de quem ja existe e e fatia de migracao propria.
    if (admin) {
      const challengeId = randomUUID();
      const purpose = usuario.mfaStatus === 'ENABLED' ? 'MFA_VERIFY' : 'MFA_SETUP';

      return {
        desafio: purpose,
        preAuth: this.tokens.emitirPreAuth({
          sub: usuario.id,
          // Sessao de plataforma nao tem tenant. O claim existe no tipo por
          // compatibilidade com o fluxo de tenant.
          tenantId: '',
          challengeId,
          purpose,
        }),
      };
    }
```

O endpoint `POST /api/v1/auth/mfa/verify` valida o pre-auth, confere o TOTP com o `MfaService`, cria a `Session` com `tenantId: null` e devolve os cookies pelo mesmo caminho do `login`.

- [ ] **Step 4: Rodar os testes**

```bash
pnpm --filter @arenahub/api test:integration -- mfa-de-plataforma
pnpm --filter @arenahub/api test:integration
```

Esperado: PASS. O segundo caso é o que protege a base existente — se ele quebrar, o ramo pegou usuário comum.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth apps/api/test/integration/platform-mfa-de-plataforma.int-spec.ts
git commit -m "feat(auth): MFA obrigatorio no login do Super Admin

Liga emitirPreAuth/verificarPreAuth, que existiam e nunca foram chamados.
Nenhum outro papel muda de comportamento.

refs #284"
```

---

## Task 7: Painel — lista e cadastro de tenant

**Files:**
- Create: `apps/admin-web/app/(platform)/layout.tsx`
- Create: `apps/admin-web/app/(platform)/platform/page.tsx`
- Create: `apps/admin-web/app/(platform)/platform/novo/page.tsx`
- Create: `apps/admin-web/app/(platform)/platform/novo/formulario-de-tenant.tsx`
- Create: `apps/admin-web/app/actions/platform.ts`
- Modify: `apps/admin-web/proxy.ts:57`
- Test: `apps/admin-web/app/actions/platform.test.ts`

**Interfaces:**
- Consumes: `POST /api/v1/platform/tenants`, `GET /api/v1/platform/tenants` (Task 3)
- Produces: `criarTenant(anterior, formulario): Promise<EstadoDoTenant>`; `EstadoDoTenant { erro?, sucesso?, valores? }`

- [ ] **Step 1: Escrever o teste que falha**

`apps/admin-web/app/actions/platform.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));

import { chamarApi } from '../../lib/api/server-client';
import { criarTenant } from './platform';

describe('criarTenant', () => {
  beforeEach(() => vi.mocked(chamarApi).mockReset());

  it('devolve os valores digitados quando a validacao falha, para o form nao esvaziar', async () => {
    const formulario = new FormData();
    formulario.set('slug', 'AB');
    formulario.set('legalName', 'Academia Teste LTDA');

    const estado = await criarTenant({}, formulario);

    expect(estado.erro).toBeDefined();
    expect(estado.valores?.legalName).toBe('Academia Teste LTDA');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('recusa CNPJ com menos de 14 digitos antes de chamar a API', async () => {
    const estado = await criarTenant({}, formularioValido({ cnpj: '123' }));

    expect(estado.erro).toContain('CNPJ');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('mostra o codigo estavel quando a API recusa com codigo desconhecido', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { code: 'COISA_NOVA', type: '', title: '', status: 400, correlationId: 'x' },
      cookiesDaApi: [],
    });

    const estado = await criarTenant({}, formularioValido());

    // O codigo sempre aparece: "erro ao salvar" sozinho nao deixa ninguem agir.
    expect(estado.erro).toContain('COISA_NOVA');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @arenahub/admin-web test -- platform
```

Esperado: FALHA — `./platform` não existe.

- [ ] **Step 3: Escrever a server action**

`apps/admin-web/app/actions/platform.ts` — mesmo formato de `units.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * A validacao daqui NAO substitui a da API: ela existe para o dono do SaaS
 * ver o erro sem perder o que digitou. Server Action e superficie publica
 * tanto quanto um endpoint.
 */
const esquemaDeTenant = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'O identificador precisa de ao menos 3 caracteres')
    .max(48, 'Identificador longo demais')
    .regex(/^[a-z0-9-]+$/, 'Use apenas minusculas, numeros e hifen no identificador'),
  legalName: z.string().trim().min(1, 'Informe a razao social').max(200, 'Razao social longa demais'),
  displayName: z.string().trim().min(1, 'Informe o nome fantasia').max(120, 'Nome longo demais'),
  cnpj: z
    .string()
    .trim()
    .transform((valor) => valor.replace(/\D/g, ''))
    .refine((valor) => valor.length === 14, 'CNPJ precisa ter 14 digitos'),
  timezone: z.string().min(1, 'Selecione o fuso horario'),
  responsavelNome: z.string().trim().min(1, 'Informe o nome do responsavel'),
  responsavelEmail: z.string().trim().toLowerCase().email('E-mail do responsavel invalido'),
  unidadeCode: z.string().trim().min(1, 'Informe o codigo da primeira unidade').max(32),
  unidadeName: z.string().trim().min(1, 'Informe o nome da primeira unidade').max(120),
});

export interface EstadoDoTenant {
  erro?: string;
  sucesso?: { id: string; displayName: string; emailEnviado: boolean };
  valores?: Record<string, string>;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  FORBIDDEN: 'Este perfil nao administra a plataforma.',
  TENANT_SLUG_TAKEN: 'Ja existe uma academia com este identificador.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function criarTenant(
  _anterior: EstadoDoTenant,
  formulario: FormData,
): Promise<EstadoDoTenant> {
  const valores = {
    slug: texto(formulario, 'slug'),
    legalName: texto(formulario, 'legalName'),
    displayName: texto(formulario, 'displayName'),
    cnpj: texto(formulario, 'cnpj'),
    timezone: texto(formulario, 'timezone'),
    responsavelNome: texto(formulario, 'responsavelNome'),
    responsavelEmail: texto(formulario, 'responsavelEmail'),
    unidadeCode: texto(formulario, 'unidadeCode'),
    unidadeName: texto(formulario, 'unidadeName'),
  };

  const validado = esquemaDeTenant.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.', valores };
  }

  const dados = validado.data;

  const resposta = await chamarApi<{ id: string; emailEnviado: boolean }>(
    '/api/v1/platform/tenants',
    {
      metodo: 'POST',
      corpo: {
        slug: dados.slug,
        legalName: dados.legalName,
        displayName: dados.displayName,
        cnpj: dados.cnpj,
        timezone: dados.timezone,
        responsavelNome: dados.responsavelNome,
        responsavelEmail: dados.responsavelEmail,
        unidade: {
          code: dados.unidadeCode,
          name: dados.unidadeName,
          timezone: dados.timezone,
        },
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Nao foi possivel criar a academia'), valores };
  }

  revalidatePath('/platform');

  return {
    sucesso: {
      id: resposta.dados.id,
      displayName: dados.displayName,
      emailEnviado: resposta.dados.emailEnviado,
    },
  };
}
```

- [ ] **Step 4: Escrever as telas**

`app/(platform)/platform/page.tsx` — Server Component com `DataTable`, `EstadoSimples` para o status, `EmptyState` com ação, `ProblemDetail` no erro (**nunca tela vazia**). Molde exato: `app/(protected)/units/page.tsx`.

`app/(platform)/platform/novo/formulario-de-tenant.tsx` — `'use client'`, `useActionState(criarTenant, {})`, `useToastDeErro(estado.erro, 'error', 'erro-do-tenant')`, botão de submit em componente separado com `useFormStatus()`, `defaultValue={estado.valores?.x ?? ''}` em cada campo, `data-testid` em tudo.

Quando `estado.sucesso`, mostrar `role="status"` com `data-testid="tenant-criado"` dizendo se o convite foi enviado — `emailEnviado: false` precisa aparecer na tela, senão o dono acha que o e-mail saiu e ele não saiu.

- [ ] **Step 5: Liberar a rota no `proxy.ts`**

O `/platform` **não** entra em `PUBLICAS` — ele exige sessão. O array de rotas públicas em `proxy.ts:57` fica como está; a rota nova é protegida por padrão. Confirmar que o matcher (linha 145) a alcança.

- [ ] **Step 6: Rodar os testes**

```bash
pnpm --filter @arenahub/admin-web test -- platform
pnpm --filter @arenahub/admin-web test
pnpm lint && pnpm typecheck
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/app apps/admin-web/proxy.ts
git commit -m "feat(platform): telas de lista e cadastro de academia

Grupo de rotas (platform) fora do (protected), que exige tenant no layout.

refs #284"
```

---

## Task 8: Faixa de suporte e encerrar elevação

**Files:**
- Create: `packages/ui/src/faixa-de-suporte.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/admin-web/app/(protected)/layout.tsx:246-260`
- Create: `apps/admin-web/app/(platform)/platform/[tenantId]/elevar-tenant.tsx`
- Modify: `apps/admin-web/app/actions/platform.ts`
- Test: `packages/ui/test/faixa-de-suporte.test.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/platform/tenants/:id/elevar`, `POST /api/v1/platform/elevacao/encerrar` (Task 5); `/api/v1/auth/me` passa a devolver `supportElevation`

> **Onde enxertar no `/auth/me` (verificado em 09/09):** `apps/api/src/modules/auth/auth.controller.ts:83`
> já chama `this.contexto.opcional()` e devolve `permissions` a partir dele. O `supportElevation` mora
> **nesse mesmo `TenantContext`**, preenchido pela Task 5. Ou seja: **zero consulta nova** — basta expor
> o campo que já está em memória, exatamente como a F54 fez com as permissões. O comentário longo que
> está lá explica por que não se consulta o banco de novo; siga-o.
- Produces: `<FaixaDeSuporte tenant expiraEm onSair />`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FaixaDeSuporte } from '../src/faixa-de-suporte';

describe('FaixaDeSuporte', () => {
  it('nomeia o tenant e a hora de encerramento, porque operar as cegas e o risco', () => {
    render(
      <FaixaDeSuporte
        tenant="Arena Positiva"
        expiraEm={new Date('2026-09-09T15:30:00Z')}
        onSair={() => {}}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Arena Positiva');
    expect(screen.getByTestId('faixa-de-suporte')).toBeInTheDocument();
  });

  it('oferece saida imediata', async () => {
    const sair = vi.fn();
    render(<FaixaDeSuporte tenant="Arena" expiraEm={new Date()} onSair={sair} />);

    await userEvent.click(screen.getByRole('button', { name: /sair do suporte/i }));

    expect(sair).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @arenahub/ui test -- faixa-de-suporte
```

Esperado: FALHA — o componente não existe.

- [ ] **Step 3: Escrever o componente e ligar no layout**

`FaixaDeSuporte` com `role="status"`, `data-testid="faixa-de-suporte"`, fundo de alerta do design system (não hex literal — a lint proíbe), texto *"Você está operando como suporte em &lt;tenant&gt; · encerra às HH:mm"* e botão "Sair do suporte".

Em `app/(protected)/layout.tsx`, o `Perfil` ganha o campo e a faixa é renderizada acima de tudo quando ele vem preenchido:

```tsx
interface Perfil {
  id: string;
  email: string;
  permissions?: string[];
  supportElevation?: { tenant: string; expiraEm: string };
}
```

- [ ] **Step 4: Rodar os testes**

```bash
pnpm --filter @arenahub/ui test
pnpm --filter @arenahub/admin-web test
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui apps/admin-web/app
git commit -m "feat(platform): faixa de suporte visivel e saida da elevacao

refs #284"
```

---

## Task 9: E2E e fechamento

**Files:**
- Create: `e2e/platform.spec.ts`
- Modify: `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/TESTS.md`

**Interfaces:**
- Consumes: tudo das tasks anteriores

- [ ] **Step 1: Escrever o E2E**

`e2e/platform.spec.ts` — o fluxo que muda de forma: login de Super Admin passando pelo desafio MFA, criar academia, elevar com justificativa, ver a faixa, sair.

```ts
import { expect, test } from '@playwright/test';

test('dono do SaaS cria academia e entra por suporte', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email').fill('dono@arenahub.local');
  await page.getByTestId('senha').fill(process.env.E2E_PLATFORM_PASSWORD!);
  await page.getByTestId('entrar').click();

  // Um fator so nao abre a sessao de plataforma.
  await expect(page.getByTestId('desafio-mfa')).toBeVisible();
  await page.getByTestId('codigo-totp').fill(gerarTotp(process.env.E2E_PLATFORM_TOTP_SECRET!));
  await page.getByTestId('confirmar-mfa').click();

  await expect(page).toHaveURL(/\/platform/);

  await page.getByTestId('nova-academia').click();
  // ... preenche e submete
  await expect(page.getByTestId('tenant-criado')).toBeVisible();

  await page.getByTestId('elevar').click();
  await page.getByTestId('justificativa').fill('Suporte combinado com o cliente por telefone');
  await page.getByTestId('confirmar-elevacao').click();

  await expect(page.getByTestId('faixa-de-suporte')).toBeVisible();

  await page.getByRole('button', { name: /sair do suporte/i }).click();
  await expect(page.getByTestId('faixa-de-suporte')).toBeHidden();
});
```

- [ ] **Step 2: Rodar a suíte inteira**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e
```

**Antes do E2E, rebuildar** — `next start` serve o `.next` antigo, e um canário plantado num build velho passa verde sem provar nada.

- [ ] **Step 3: Rodar o relatório de evidência**

```bash
pnpm test:report
```

A guarda de evidência do CI compara o relatório com a execução. Número herdado da entrega anterior (quando o Jest crasha) é falha conhecida — conferir por duas medições.

- [ ] **Step 4: Atualizar a documentação**

- `docs/STATUS.md` — mover F61 no Índice; a §2 (Quadro) está defasada desde 25/08 e precisa ser reconciliada contra o board, não estimada.
- `docs/DEVELOPMENT.md` — passos da fatia e o que ficou de fora.
- `docs/TESTS.md` — a linha da SPEC-061 (nasce com `—` no campo do PR; preencher **depois** do merge, porque o `--check` não valida esse campo).

- [ ] **Step 5: Abrir o PR**

```bash
gh pr create --title "F61: Super Admin e ciclo de vida do tenant" --body "..."
```

Corpo com `refs #284` — **nunca `closes`**, que forjaria o aceite do PI. Registrar no corpo as cinco decisões da §1 do spec e o fato de que `bootstrap-tenant.ts` ficou.

- [ ] **Step 6: Esperar o CI**

```bash
gh pr checks <n> --watch
```

`--watch` já mentiu no código de saída antes (saiu 0 com job vermelho). Conferir job a job com `gh run watch <id> --exit-status`.

---

## Self-Review

**Cobertura do spec:**

| seção do spec | task |
|---|---|
| §2 dados | Task 1 |
| §3.1 contexto e guarda | Task 2 |
| §3.2 casos de uso — criar | Task 3 |
| §3.2 casos de uso — editar/status | Task 4 |
| §3.2 unidades do tenant | **lacuna assumida** — ver abaixo |
| §3.3 elevação | Task 5 |
| §3.4 MFA | Task 6 |
| §4 painel — lista/cadastro | Task 7 |
| §4 painel — faixa de suporte | Task 8 |
| §5 testes | tasks 1-8 + Task 9 |

**Lacuna registrada:** o CRUD de **unidades dentro do tenant pelo Super Admin** (spec §3.2, última linha) não ganhou task própria. Ele cai naturalmente na Task 5: uma vez elevado, o Super Admin usa as telas de unidade que já existem em `/units`, com as permissões do OWNER concedidas na elevação. **Isto é uma decisão, não um esquecimento** — construir uma segunda tela de unidade dentro de `/platform` duplicaria o CRUD inteiro para servir o mesmo ator. Se o PI quiser gerenciar unidade sem elevar, vira fatia própria.

**Consistência de tipos:** `PlatformContext` (Task 2) é consumido com os mesmos três campos nas Tasks 3, 4 e 5. `EstadoDoTenant` (Task 7) é o mesmo usado na Task 8. `ClaimsDeAcesso.tenantId: string | null` (Task 2) é o que a Task 5 preenche na elevação e a Task 6 deixa vazio no pre-auth.

**Sem placeholders:** todos os passos de código têm o código; todos os passos de teste têm o teste.
