# MVP 01.1 Core Security and Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o backend e o painel mínimos para um proprietário autenticar com MFA, criar uma unidade e convidar uma recepcionista que somente enxerga o tenant e as unidades autorizadas.

**Architecture:** Um monólito modular NestJS recebe o principal autenticado, constrói `TenantContext` e aplica guards globais de autenticação/permissão. PostgreSQL/Prisma persiste tenant, unidade, usuários, funções, sessões e auditoria. O Next.js usa Server Components para leitura e Server Actions para autenticação/mutações sensíveis, com cookies HttpOnly emitidos no mesmo host do painel.

**Tech Stack:** NestJS 11.2.0, Prisma 7.9.1, `@prisma/adapter-pg` 7.9.1, PostgreSQL 17, `@nestjs/jwt` 11.0.2, Next.js 16.3.1, React 19.2.8, Vitest 4.1.10 e Playwright 1.62.1.

---

## 1. Pré-condições

- [ ] `M1-ENTRY-01` do índice mestre está atendido;
- [ ] `apps/edge-agent` e scripts raiz do MVP-00 estão verdes;
- [ ] portas locais `3000`, `3001` e `5432` estão livres ou foram alteradas apenas em `.env.local` ignorado;
- [ ] RSA 2048 bits de desenvolvimento foi gerada localmente; chave privada nunca entra no Git.

Este plano não depende do gate físico.

## 2. Mapa de arquivos

```text
apps/api/
├── src/main.ts
├── src/app.module.ts
├── src/config/env.ts
├── src/common/http/problem-details.filter.ts
├── src/common/http/correlation-id.middleware.ts
├── src/common/security/public.decorator.ts
├── src/common/security/permissions.decorator.ts
├── src/common/security/auth.guard.ts
├── src/common/security/permissions.guard.ts
├── src/common/tenant/tenant-context.ts
├── src/common/tenant/tenant-context.service.ts
├── src/modules/auth/*
├── src/modules/iam/*
├── src/modules/tenancy/*
├── src/modules/audit/*
├── src/cli/bootstrap-platform-admin.ts
└── test/{integration,e2e}/*

apps/admin-web/
├── app/(auth)/login/*
├── app/(protected)/layout.tsx
├── app/(protected)/units/*
├── app/actions/auth.ts
├── lib/api/server-client.ts
├── lib/auth/session.ts
└── tests/e2e/core-security.spec.ts

packages/database/
├── prisma.config.ts
├── prisma/schema.prisma
├── prisma/migrations/*
├── src/client.ts
└── test/core-isolation.integration.test.ts

packages/contracts/src/{auth,tenancy,problem}.ts
infra/docker/compose.yaml
infra/docker/.env.example
docs/DECISIONS.md
```

## Task 1: Add API, web and PostgreSQL workspaces

**Files:**
- Modify: `package.json`, `pnpm-workspace.yaml`, `turbo.json`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/jest.config.cjs`
- Create: `apps/admin-web/package.json`, `apps/admin-web/tsconfig.json`, `apps/admin-web/next.config.ts`
- Create: `packages/database/package.json`, `packages/contracts/package.json`
- Create: `infra/docker/compose.yaml`, `infra/docker/.env.example`

- [ ] **Step 1: Write failing workspace smoke tests**

Create `apps/api/test/unit/version.test.ts` expecting `getApiVersion()` to return the root package version, and `apps/admin-web/src/version.test.ts` expecting the same from `src/version.ts`. Run:

```bash
pnpm --filter api test --runInBand
pnpm --filter admin-web test --run
```

Expected: both commands fail because packages/files do not exist.

- [ ] **Step 2: Add exact dependencies without changing MVP-00 pins**

Run these commands so pnpm writes exact versions and the lockfile:

```bash
pnpm add -E --filter api @nestjs/common@11.2.0 @nestjs/core@11.2.0 @nestjs/platform-express@11.2.0 @nestjs/swagger@11.4.6 @nestjs/jwt@11.0.2 @nestjs/throttler@6.5.0 class-transformer@0.5.1 class-validator@0.15.1 reflect-metadata@0.2.2 rxjs@7.8.2
pnpm add -DE --filter api supertest@7.2.2 @types/supertest@7.2.1 jest@29.7.0 ts-jest@29.4.12
pnpm add -E --filter admin-web next@16.3.1 react@19.2.8 react-dom@19.2.8 zod@4.4.3
pnpm add -DE --filter admin-web vitest@4.1.10 @testing-library/react@16.3.2 @testing-library/jest-dom@7.0.1 jsdom@30.0.1 @playwright/test@1.62.1
pnpm add -E --filter @arenahub/database @prisma/client@7.9.1 @prisma/adapter-pg@7.9.1 pg@8.23.0 dotenv@17.4.2
pnpm add -DE --filter @arenahub/database prisma@7.9.1 testcontainers@12.1.0 @types/pg@8.21.0
```

If pnpm reports a peer conflict, stop and resolve from the package's official compatibility matrix; do not use `--force`.

- [ ] **Step 3: Create the local infrastructure contract**

`infra/docker/compose.yaml` must define PostgreSQL 17 with healthcheck, named volume and host port from `POSTGRES_PORT`; no password is hard-coded outside `.env.example`. Redis and MinIO are added only in later plans. Add `db:up`, `db:down`, `db:migrate` and `db:test` scripts at root.

- [ ] **Step 4: Implement version modules and health endpoints**

Expose `GET /health/live`, `GET /health/ready` and `GET /version`. Readiness checks PostgreSQL with `SELECT 1`; it returns 503 and a stable code when unavailable. Responses never expose connection strings.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter api lint && pnpm --filter api typecheck && pnpm --filter api test
pnpm --filter admin-web lint && pnpm --filter admin-web typecheck && pnpm --filter admin-web test
pnpm build
git diff --check
```

Expected: all PASS; `/health/live` does not require database, `/health/ready` does. Commit:

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json apps/api apps/admin-web packages/database packages/contracts infra/docker
git commit -m "build(core): add api web and postgres workspaces"
```

## Task 2: Create the core Prisma schema and transactional audit base

**Files:**
- Create: `packages/database/prisma.config.ts`
- Create: `packages/database/prisma/schema.prisma`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/transaction.ts`
- Test: `packages/database/test/core-isolation.integration.test.ts`

- [ ] **Step 1: Write constraint tests first**

Using a PostgreSQL Testcontainer, prove these tests fail before the schema exists:

```text
tenant slug is globally unique
unit code is unique within tenant and reusable in another tenant
user email is normalized and globally unique
role name is unique within tenant
session tokenHash is unique and contains no raw token
audit log cannot be updated or deleted through the application repository
```

Run `pnpm --filter @arenahub/database test:integration`; expected failure is missing migration/schema.

- [ ] **Step 2: Configure Prisma 7 explicitly**

Create `packages/database/prisma.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

The schema generator must be `prisma-client` with output `../generated/client`. `src/client.ts` must instantiate `PrismaPg` with the validated runtime URL and pass the adapter to `PrismaClient`.

- [ ] **Step 3: Add complete core entities**

Create enums `UserStatus`, `SessionStatus`, `MfaStatus` and models with UUID primary keys:

| Model | Required fields/constraints |
|---|---|
| `Tenant` | `id`, unique `slug`, `legalName`, `displayName`, `status`, timestamps |
| `GymUnit` | `tenantId`, `code`, `name`, `timezone`, `openingHours` JSON, status; unique `(tenantId, code)` |
| `User` | normalized unique email, `passwordHash`, status, `mfaStatus`, encrypted TOTP fields, timestamps |
| `TenantMembership` | `tenantId`, `userId`, status; unique pair |
| `Role` | `tenantId`, `name`, `isSystem`; unique `(tenantId, name)` |
| `Permission` | stable unique `code` |
| `RolePermission` | composite key `(roleId, permissionId)` |
| `UserRole` | `tenantId`, `userId`, `roleId`, nullable `gymUnitId`; unique scope |
| `Session` | `userId`, `tenantId`, `tokenHash`, `familyId`, expiry, rotation/revocation metadata |
| `Invitation` | tenant, email, role/unit scope, `tokenHash`, expiry, accepted/revoked metadata |
| `AuditLog` | tenant, nullable unit/user, actor type/id, action, target, correlation, IP, user agent, masked JSON, timestamp |
| `OutboxEvent` | standard event envelope, payload JSON, publish state and attempts |
| `InboxReceipt` | consumer/event unique pair and processed timestamp |

No business model may omit `tenantId`. `AuditLog` and `OutboxEvent` have no `updatedAt`.

- [ ] **Step 4: Generate and apply the named migration**

Run:

```bash
pnpm --filter @arenahub/database prisma generate
pnpm --filter @arenahub/database prisma migrate dev --name core_identity
pnpm --filter @arenahub/database test:integration
```

Expected: generated client succeeds and all constraint/isolation tests PASS.

- [ ] **Step 5: Commit migration and tests**

```bash
git add packages/database
git commit -m "feat(core): add tenant identity and audit schema"
```

## Task 3: Implement login, refresh rotation and problem details

**Files:**
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/common/http/{correlation-id.middleware,problem-details.filter}.ts`
- Create: `apps/api/src/modules/auth/{auth.module,auth.controller,auth.service,password.service,token.service,session.repository}.ts`
- Create: `packages/contracts/src/{auth,problem}.ts`
- Test: `apps/api/test/integration/auth.integration.test.ts`

- [ ] **Step 1: Write failing auth abuse tests**

Cover valid login, invalid password, unknown email with indistinguishable response, expired access JWT, refresh rotation, reuse of old refresh token revoking the family, logout, Origin inválida, CSRF ausente/incorreto, rate limit e redaction. Run the test and expect missing module/routes.

- [ ] **Step 2: Implement password hashing with a versioned envelope**

`PasswordService` must serialize `scrypt$v=1$N=16384$r=8$p=1$<saltBase64url>$<hashBase64url>`, use a random 16-byte salt, derive 64 bytes and compare with `timingSafeEqual`. Invalid envelopes return `false`, never throw details to the caller.

- [ ] **Step 3: Implement the token/session contract**

Full access JWT claims are exactly `sub`, `tenantId`, `sessionId`, `permissions`, optional `unitIds`, `mfa`, `iat`, `exp`, `iss`, `aud`, signed RS256 for 10 minutes. Refresh token is 32 random bytes, returned only as opaque base64url and persisted as SHA-256. Rotation occurs in one transaction: mark current token rotated, insert successor, reject/revoke family on reuse.

Privileged login before MFA completion receives only a five-minute `arenahub_pre_auth` cookie with claims `sub`, `tenantId`, `challengeId`, `purpose: MFA_SETUP | MFA_VERIFY`, `iat`, `exp`, `iss`, `aud`. It has no permissions and is accepted solely by MFA setup/verify endpoints. Global `AuthGuard` rejects it on every business route. Full access/refresh cookies are issued only after MFA verification.

- [ ] **Step 4: Expose transport safely**

Implement:

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Login/refresh set `arenahub_access` and `arenahub_refresh` cookies; JSON never contains tokens. Every error follows `application/problem+json` with `type`, `title`, `status`, stable `code` and `correlationId`. Add global validation with whitelist, transform and reject unknown fields.

For unsafe administrative methods, validate the request `Origin` against the configured web origins and require `X-CSRF-Token` equal to a session-bound HMAC token issued in `arenahub_csrf`. The CSRF cookie is readable but carries no credential; access/refresh remain HttpOnly. Login/refresh validate Origin and rate limits even before a session exists. Edge HMAC routes use their own guard and are never broadly marked CSRF-free.

Apply `@nestjs/throttler` limits by IP+normalized login identity on authentication and by actor+tenant/IP on administration. Return 429 Problem Details without confirming whether an account exists.

- [ ] **Step 5: Verify and commit**

Run `pnpm --filter api test -- auth.integration.test.ts`, full API tests, lint and typecheck. Expected: old refresh reuse returns 401 `AUTH_REFRESH_REUSED`, session family is revoked and logs contain no token/password. Commit:

```bash
git add apps/api packages/contracts
git commit -m "feat(auth): add rotating sessions and problem responses"
```

## Task 4: Enforce TenantContext, RBAC and unit scope

**Files:**
- Create: `apps/api/src/common/security/{public.decorator,permissions.decorator,auth.guard,permissions.guard}.ts`
- Create: `apps/api/src/common/tenant/{tenant-context,tenant-context.service}.ts`
- Create: `apps/api/src/modules/tenancy/*`
- Test: `apps/api/test/integration/tenant-isolation.integration.test.ts`

- [ ] **Step 1: Write cross-tenant tests before repositories**

Create Tenant A/B, users and unit codes equal in both. Attempt list, get by guessed UUID, update, role assignment and unit creation using the wrong principal. Expected before implementation: route/module missing; after implementation every attempt returns 404 or 403 without revealing existence.

- [ ] **Step 2: Implement the required context type**

```ts
export interface TenantContext {
  tenantId: string;
  actorId: string;
  sessionId: string;
  permissions: ReadonlySet<string>;
  allowedUnitIds: 'ALL' | ReadonlySet<string>;
  supportElevation?: { reason: string; expiresAt: Date };
}
```

`TenantContextService.require()` throws if no authenticated request scope exists. Repository methods accept this context as the first argument; no controller receives `tenantId` DTO for normal operations.

- [ ] **Step 3: Register global guards with explicit public routes**

`AuthGuard` is an `APP_GUARD`; `PermissionsGuard` follows it. Only health, version, login, refresh and invitation acceptance use `@Public()`. `@RequirePermissions('unit.create')` requires all listed permissions and validates unit scope when a route contains a unit resource.

- [ ] **Step 4: Implement tenant/unit administration transactionally**

Expose `POST /api/v1/units`, `GET /api/v1/units` and `PATCH /api/v1/units/:id`. Creation validates IANA timezone and weekly opening-hours structure, writes `AuditLog` and `OutboxEvent` in the same transaction, and returns DTO without private fields.

Add `POST /api/v1/platform/tenants`, restricted to an MFA-confirmed Super Admin with active platform elevation. It creates tenant, system roles and a one-time OWNER invitation atomically. Add `bootstrap-platform-admin.ts`: it works only when no platform admin exists, reads the initial password from a masked prompt or protected stdin, requires MFA enrollment on first login, never prints credentials and exits permanently with `BOOTSTRAP_ALREADY_COMPLETED` after success. Integration tests start from an empty database and prove a second execution cannot create another bootstrap admin.

- [ ] **Step 5: Verify and commit**

Run API integration tests twice with randomized tenant order. Expected: no cross-tenant mutation/read and no request query accepts `tenantId`. Commit:

```bash
git add apps/api/src/common apps/api/src/modules/tenancy apps/api/test
git commit -m "feat(core): enforce tenant and unit permissions"
```

## Task 5: Add invitations, MFA and audited support elevation

**Files:**
- Create: `apps/api/src/modules/iam/*`
- Create: `apps/api/src/modules/auth/mfa.service.ts`
- Create: `apps/api/src/modules/audit/*`
- Test: `apps/api/test/integration/iam-mfa.integration.test.ts`

- [ ] **Step 1: Write invitation/MFA transition tests**

Cover one-time invitation, expiry, wrong tenant, role/unit assignment, TOTP valid/invalid/replayed, pre-auth token rejected outside MFA endpoints, mandatory-MFA profiles in production and support elevation expiry. Expected: missing endpoints.

- [ ] **Step 2: Implement one-time invitation links**

Expose `POST /api/v1/users/invitations`, `POST /api/v1/users/invitations/accept` and `GET /api/v1/users`. Store only token hash, expire in 24 h, invalidate after acceptance and show the invitation URL once to the authenticated owner for operational delivery. Never log or list the token later. Acceptance sets the initial password, creates membership/role atomically and requires MFA setup before privileged access.

- [ ] **Step 3: Implement RFC 6238 TOTP without storing plaintext**

Use HMAC-SHA1, 30-second step, 6 digits, drift window ±1 and persist the last accepted counter to prevent replay. Encrypt the secret with AES-256-GCM using `MFA_ENCRYPTION_KEY`; persist IV, auth tag and ciphertext. Expose setup, confirm, verify and recovery-code regeneration endpoints. Recovery codes are random and stored hashed.

- [ ] **Step 4: Seed permissions and audit sensitive actions**

Seed the exact permission list from the PRD and system roles `OWNER`, `MANAGER`, `RECEPTIONIST`, `TECH_OPERATOR`. Audit login success/failure, invitation, role change, MFA setup/recovery, unit mutation and support elevation. Mask email/CPF-like fields in metadata.

- [ ] **Step 5: Verify and commit**

Run tests with `NODE_ENV=test` and a second suite emulating production MFA policy. Expected: privileged user without confirmed MFA receives `MFA_REQUIRED`; a reused TOTP counter receives `MFA_CODE_REPLAYED`. Commit:

```bash
git add apps/api/src/modules apps/api/test packages/database/prisma
git commit -m "feat(iam): add invitations mfa and audited elevation"
```

## Task 6: Build the protected admin shell and unit journey

**Files:**
- Create: `apps/admin-web/app/(auth)/login/*`
- Create: `apps/admin-web/app/(protected)/layout.tsx`
- Create: `apps/admin-web/app/(protected)/units/*`
- Create: `apps/admin-web/app/actions/auth.ts`
- Create: `apps/admin-web/lib/api/server-client.ts`
- Test: `apps/admin-web/tests/e2e/core-security.spec.ts`

- [ ] **Step 1: Write failing Playwright journey**

Test owner login → MFA → create unit → create invitation; accept invitation in isolated browser context; verify receptionist only sees its tenant/unit. Add keyboard-only flow, labels, focus on validation error and non-color status text. Expected: route not found.

- [ ] **Step 2: Implement server-side API client**

`server-client.ts` reads cookies with awaited `cookies()`, forwards them to the configured Nest API, sets `cache: 'no-store'` for authenticated data and converts Problem Details into typed action errors. It never exposes `API_INTERNAL_URL` to client bundles.

- [ ] **Step 3: Implement login/MFA Server Actions**

Actions validate input with Zod, call Nest, copy only the two allowed `Set-Cookie` values into the Next cookie store and redirect after success. Password and TOTP never become URL params or serialized page props.

- [ ] **Step 4: Implement accessible unit and invitation screens**

Use Server Components for lists/details and Client Components only for form state. Display explicit permission denial, unit timezone, opening hours and invitation expiry. Preserve entered form values after recoverable errors, excluding secrets.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter admin-web test
pnpm --filter admin-web test:e2e -- core-security.spec.ts
pnpm --filter admin-web lint
pnpm --filter admin-web typecheck
pnpm --filter admin-web build
```

Expected: all PASS at desktop and 390 px viewport, with no serious accessibility violations. Commit:

```bash
git add apps/admin-web
git commit -m "feat(admin): add secure tenant and unit journey"
```

## Task 7: Close slice 1.1 with contract and security evidence

**Files:**
- Modify: `docs/DECISIONS.md` — decisão estrutural vira ADR novo em `docs/DECISIONS.md`, aprovado pelo PI
- Create: `docs/operations/smart-access/core-security-evidence.md`
- Modify: `docs/prd/academia/MVP-01-smart-access.md` only after evidence exists

- [ ] **Step 1: Generate and diff OpenAPI**

Run the API OpenAPI generator and commit `packages/contracts/openapi/arenahub-v1.json`. A contract test must fail if runtime routes differ from the snapshot.

- [ ] **Step 2: Run the complete slice gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
git diff --check
```

Expected: all PASS. Inspect structured logs and database fixtures for passwords, raw refresh/invitation tokens, MFA secrets and cross-tenant IDs.

- [ ] **Step 3: Record evidence and commit**

Evidence records command, timestamp, commit, Testcontainer/PostgreSQL version and mappings `M1-FR-001`–`005`, `M1-NFR-001/005/007/008/010`, `M1-AC-001`. Then mark only Slice 1.1 evidence in the PRD.

```bash
git add packages/contracts/openapi docs/DECISIONS.md docs/operations/smart-access/core-security-evidence.md docs/prd/academia/MVP-01-smart-access.md
git commit -m "docs(core): record slice 1.1 evidence"
```

## 3. Definition of done

- [ ] `M1-AC-001` passa em E2E com dois tenants;
- [ ] MFA privilegiado, rotação/reuse detection e elevação expirada estão provados;
- [ ] nenhuma rota de negócio aceita tenant livre do cliente;
- [ ] WCAG 2.2 AA essencial tem evidência automatizada e revisão por teclado;
- [ ] OpenAPI, migration, rollback aditivo e ADR estão versionados;
- [ ] comandos raiz estão verdes e o Edge do MVP-00 não regrediu.

## 4. Opções de execução

1. **Subagent-Driven (recomendado):** uma task por agente, revisão de diff e testes entre tasks.
2. **Inline:** executar sequencialmente neste task, mantendo cada commit indicado.

Após concluir, seguir para `2026-08-14-mvp-01-02-students-entitlements.md`.
