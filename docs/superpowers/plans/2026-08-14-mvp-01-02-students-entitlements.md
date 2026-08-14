# MVP 01.2 Students and Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a recepção cadastre um aluno, atribua um plano e uma assinatura manual e visualize o entitlement explícito que determina onde e quando o acesso é válido.

**Architecture:** Os módulos `Students` e `Membership` permanecem separados. A assinatura é um fato comercial manual; um serviço de domínio deriva entitlements imutavelmente rastreáveis a partir do plano. O módulo de acesso consumirá somente entitlement/status projetados, nunca assinatura. Mudanças de estado, timeline e outbox são atômicas no PostgreSQL.

**Tech Stack:** NestJS 11.2.0, Prisma 7.9.1/PostgreSQL 17, Zod 4.4.3, Jest 29.7.0, fast-check para propriedades, Next.js 16.3.1 e Playwright 1.62.1.

---

## 1. Pré-condições e fronteiras

- [ ] Slice 1.1 concluída e `M1-AC-001` verde;
- [ ] permissões `student.*`, `plan.manage` e `subscription.manage` semeadas;
- [ ] timezone e horários das unidades validados;
- [ ] nenhuma integração financeira será criada neste plano.

CPF é opcional e sensível. Matrícula é o identificador operacional imutável. Nenhuma regra deste plano consulta hardware.

## 2. Mapa de arquivos

```text
apps/api/src/modules/students/
├── domain/student.ts
├── application/{create,search,update,archive}-student.use-case.ts
├── infrastructure/student.repository.ts
└── transport/students.controller.ts

apps/api/src/modules/membership/
├── domain/{plan,subscription,entitlement}.ts
├── application/{create-plan,activate-subscription,change-subscription,grant-courtesy}.use-case.ts
├── infrastructure/{plan,subscription,entitlement}.repository.ts
└── transport/{plans,subscriptions,entitlements}.controller.ts

apps/api/src/modules/timeline/*
apps/admin-web/app/(protected)/students/*
apps/admin-web/app/(protected)/plans/*
packages/contracts/src/{students,membership}.ts
packages/database/prisma/migrations/*_students_membership/
packages/testing/src/builders/{student,plan,subscription}.ts
```

## Task 1: Add student persistence, membership number and duplicate candidates

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_students_membership_base`
- Create: `apps/api/src/modules/students/*`
- Test: `apps/api/test/integration/students.integration.test.ts`

- [ ] **Step 1: Write failing student tests**

Cover required name/birth date/contact validation, normalized email/phone/CPF, tenant isolation, same CPF in another tenant, immutable membership number, archive behavior and concurrent creation. Search must support name, exact matrícula, normalized phone and masked CPF response. Run test; expect missing schema/module.

- [ ] **Step 2: Add student schema and constraints**

Create `StudentStatus` from the PRD and models:

| Model | Required contract |
|---|---|
| `Student` | `tenantId`, immutable `membershipNumber`, full name, birth date, optional normalized/hashed CPF lookup fields, status, `archivedAt`, timestamps; unique `(tenantId, membershipNumber)` |
| `StudentContact` | tenant/student, type, normalized value, primary flag |
| `StudentAddress` | tenant/student, postal/address fields, nullable geodata |
| `StudentSequence` | one row per tenant with next integer and optimistic version |
| `StudentTimelineEvent` | tenant/student, type, actor, correlation, masked payload, immutable timestamp |

Soft delete never removes the matrícula uniqueness constraint.

- [ ] **Step 3: Implement collision-safe matrícula generation**

Inside the creation transaction, lock `StudentSequence` for the tenant, increment and format `AP-{year}-{8 digit sequence}`. Do not derive from CPF, UUID fragment or row count. On retryable serialization failure, retry at most three times with jitter and preserve the same idempotency key.

- [ ] **Step 4: Implement duplicate candidates without automatic merge**

Return `duplicateCandidates` based on exact normalized CPF, exact email/phone and fuzzy name+birth date. Results are tenant-scoped and masked; they warn the operator but do not block creation unless exact CPF is already active and policy says manual review. No merge endpoint is included.

- [ ] **Step 5: Verify and commit**

Run 20 concurrent creates in integration test and assert unique sequential memberships. Run tenant abuse tests. Commit:

```bash
git add packages/database apps/api/src/modules/students apps/api/test packages/testing
git commit -m "feat(students): add tenant-safe registration and search"
```

## Task 2: Implement explicit student state transitions and archival

**Files:**
- Create: `apps/api/src/modules/students/domain/student.ts`
- Create: `apps/api/src/modules/students/application/{update,archive}-student.use-case.ts`
- Test: `apps/api/test/unit/student-state.test.ts`

- [ ] **Step 1: Write the full transition table as tests**

Allowed transitions:

```text
LEAD -> TRIAL | ACTIVE | CANCELLED | ARCHIVED
TRIAL -> ACTIVE | CANCELLED | ARCHIVED
ACTIVE -> SUSPENDED | BLOCKED | CANCELLED | ARCHIVED
SUSPENDED -> ACTIVE | BLOCKED | CANCELLED | ARCHIVED
BLOCKED -> ACTIVE | CANCELLED | ARCHIVED
CANCELLED -> ACTIVE | ARCHIVED
ARCHIVED -> no transition
```

Every rejected transition returns `STUDENT_INVALID_TRANSITION` and writes neither timeline nor outbox.

- [ ] **Step 2: Implement a pure transition function**

```ts
export function transitionStudent(
  current: StudentStatus,
  target: StudentStatus,
): StudentStatus {
  const allowed = STUDENT_TRANSITIONS[current];
  if (!allowed.has(target)) {
    throw new DomainError('STUDENT_INVALID_TRANSITION', { current, target });
  }
  return target;
}
```

Define `STUDENT_TRANSITIONS` as a complete `Record<StudentStatus, ReadonlySet<StudentStatus>>`; do not use a `default allow` branch.

- [ ] **Step 3: Make archive transactional**

Archiving sets status/timestamp, suspends active entitlements, emits `StudentStatusChanged`, appends timeline and audit in one transaction. It does not delete contacts, subscriptions or events.

- [ ] **Step 4: Verify and commit**

Run unit and integration tests; assert archived student cannot create new subscription or receive normal access projection. Commit:

```bash
git add apps/api/src/modules/students apps/api/test
git commit -m "feat(students): enforce lifecycle and archival"
```

## Task 3: Add plans with unit and weekly schedule rules

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_plans`
- Create: `apps/api/src/modules/membership/domain/plan.ts`
- Create: `apps/api/src/modules/membership/application/create-plan.use-case.ts`
- Test: `apps/api/test/unit/plan-policy.test.ts`

- [ ] **Step 1: Write plan validation tests**

Cover at least one unit, valid date range, day-of-week 1–7, `HH:mm` local intervals, non-overlapping intervals, overnight intervals represented as two ranges, unit belonging to tenant and more restrictive overlap behavior. Expected: no plan domain yet.

- [ ] **Step 2: Add normalized plan schema**

Create `Plan`, `PlanUnit` and `PlanAccessWindow`. `Plan` stores tenant, name, description, active flag and optional sale validity. `PlanAccessWindow` stores unit, ISO day of week, local start/end minute. Do not bury access rules in unvalidated JSON.

- [ ] **Step 3: Implement deterministic validation**

Sort windows by unit/day/start; reject overlap and zero-length ranges. Convert to instants only when evaluating a specific date using the unit IANA timezone. DST ambiguity selects the more restrictive outcome and records the timezone database behavior in tests.

- [ ] **Step 4: Expose API and audit**

Implement `POST /api/v1/plans`, `GET /api/v1/plans` and `GET /api/v1/plans/:id`, protected by `plan.manage/read`. Creation writes audit/outbox. DTO response includes explicit units/windows.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter api test -- plan-policy.test.ts
pnpm --filter api test:integration
git add packages/database apps/api/src/modules/membership apps/api/test packages/contracts
git commit -m "feat(membership): add plans and access schedules"
```

## Task 4: Derive entitlements from manual subscriptions

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_subscriptions_entitlements`
- Create: `apps/api/src/modules/membership/domain/{subscription,entitlement}.ts`
- Create: `apps/api/src/modules/membership/application/{activate-subscription,change-subscription}.use-case.ts`
- Test: `apps/api/test/integration/subscription-entitlement.integration.test.ts`

- [ ] **Step 1: Write state-machine and transaction tests**

Test create `PENDING`, activate, pause, resume, cancel and expire; invalid transitions; idempotency; plan snapshot preservation; entitlement dates/unit/windows; archived/blocked student; and rollback if outbox insert fails.

- [ ] **Step 2: Add subscription and entitlement models**

`Subscription` stores student, plan, start/end, status and manual actor/reason. `Entitlement` stores source type/id, validity, status and immutable policy snapshot. `EntitlementUnitWindow` stores normalized allowed unit/windows. Index active lookups by `(tenantId, studentId, status, startsAt, endsAt)`.

- [ ] **Step 3: Implement explicit derivation**

`activateSubscription` loads student and plan within tenant, rejects invalid state, snapshots the plan, creates/activates subscription and entitlement, then emits `SubscriptionActivated` and `EntitlementActivated` in the same transaction. The access path never joins `Subscription`.

- [ ] **Step 4: Implement pause/resume/cancel/expiry**

Pause suspends the entitlement at the same instant; resume creates or reactivates a correctly bounded entitlement; cancel revokes it; scheduled expiry is idempotent and emits events once. Each command requires reason and optimistic version to prevent lost updates.

- [ ] **Step 5: Verify and commit**

Expected: a failed transaction leaves neither subscription state nor entitlement/outbox partial. Commit:

```bash
git add packages/database apps/api/src/modules/membership apps/api/test packages/contracts
git commit -m "feat(membership): derive entitlements from manual subscriptions"
```

## Task 5: Add courtesy entitlements and administrative timeline

**Files:**
- Create: `apps/api/src/modules/membership/application/grant-courtesy.use-case.ts`
- Create: `apps/api/src/modules/timeline/*`
- Test: `apps/api/test/integration/courtesy-timeline.integration.test.ts`

- [ ] **Step 1: Write authorization and limit tests**

Courtesy requires `subscription.manage`, non-empty reason, responsible actor, future expiry and explicit units/windows. It cannot outlive the configured maximum of 30 days without OWNER permission. An overlapping normal entitlement does not get silently modified.

- [ ] **Step 2: Implement source-typed entitlement**

Create source `COURTESY` with nullable subscription and required reason/actor. Emit `EntitlementActivated`; revocation emits `EntitlementRevoked`. More restrictive student/admin status always overrides courtesy.

- [ ] **Step 3: Build cursor timeline query**

`GET /api/v1/students/:id/timeline` combines immutable student, subscription, entitlement and audit projections ordered by `(occurredAt, id)`, with opaque cursor and masked payload. It never exposes biometric/template data.

- [ ] **Step 4: Verify and commit**

Run permission, tenant and pagination tests. Commit:

```bash
git add apps/api/src/modules/membership apps/api/src/modules/timeline apps/api/test packages/contracts
git commit -m "feat(membership): add courtesy and student timeline"
```

## Task 6: Build reception workflows in the admin panel

**Files:**
- Create: `apps/admin-web/app/(protected)/students/*`
- Create: `apps/admin-web/app/(protected)/plans/*`
- Create: `apps/admin-web/components/membership/*`
- Test: `apps/admin-web/tests/e2e/student-entitlement.spec.ts`

- [ ] **Step 1: Write failing E2E acceptance flow**

Receptionist searches, creates student, reviews duplicate warning, assigns plan, activates manual subscription and sees exact entitlement period/unit/schedule. Negative flow archives the student and shows suspended access. Verify 390 px, keyboard and explicit textual states.

- [ ] **Step 2: Implement student search/list/detail**

Search is debounced only on the client; authoritative query runs on API with cursor. Mask CPF except to permitted roles, show matrícula prominently and status as text+icon. Do not infer access solely from subscription badge.

- [ ] **Step 3: Implement plan/subscription forms**

Validate dates and local schedules on client for feedback and again on API. Confirmation for pause/cancel/courtesy shows resulting entitlement effect. Preserve non-sensitive values after validation errors.

- [ ] **Step 4: Implement entitlement card and timeline**

Display source, status, UTC-derived local start/end, units, days/windows and reason. If multiple entitlements exist, show each and the effective most-restrictive student/admin state.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter admin-web test
pnpm --filter admin-web test:e2e -- student-entitlement.spec.ts
pnpm --filter admin-web lint
pnpm --filter admin-web typecheck
pnpm --filter admin-web build
git add apps/admin-web
git commit -m "feat(admin): add student and entitlement workflows"
```

## Task 7: Close slice 1.2 with property and contract evidence

**Files:**
- Create: `apps/api/test/property/entitlement.property.test.ts`
- Create: `docs/operations/smart-access/students-entitlements-evidence.md`
- Modify: `packages/contracts/openapi/arenahub-v1.json`
- Modify: `docs/prd/academia/MVP-01-smart-access.md` after evidence

- [ ] **Step 1: Add invariant properties**

Run `pnpm add -DE --filter api fast-check@4.9.0` before creating the property suite.

Generate random status/date/window combinations and prove:

```text
expired entitlement is never effective
archived/blocked/cancelled student is never effective
effective unit is always present in entitlement snapshot
more restrictive overlapping window wins
subscription mutation cannot bypass entitlement derivation
```

- [ ] **Step 2: Run complete gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
git diff --check
```

Expected: all PASS and OpenAPI snapshot updated intentionally.

- [ ] **Step 3: Record and commit evidence**

Map `M1-FR-006`–`012`, `M1-BR-001`–`003/006/010`, `M1-AC-002/003` to test names and commits.

```bash
git add apps/api/test/property packages/contracts/openapi docs/operations/smart-access/students-entitlements-evidence.md docs/prd/academia/MVP-01-smart-access.md
git commit -m "docs(membership): record slice 1.2 evidence"
```

## 3. Definition of done

- [ ] matrícula única resiste concorrência e nunca usa CPF;
- [ ] todas as transições inválidas são atômicas e auditadas como falha sem efeito parcial;
- [ ] assinatura manual gera entitlement explícito com snapshot de regra;
- [ ] a UI apresenta período, unidade e horário de acesso sem inferência financeira;
- [ ] `M1-AC-002` e `M1-AC-003` passam em E2E multi-tenant;
- [ ] comandos raiz e regressão do MVP-00/1.1 estão verdes.

## 4. Opções de execução

1. **Subagent-Driven (recomendado):** executar tasks em ordem e revisar migrations/domínio antes da UI.
2. **Inline:** executar sequencialmente com os commits indicados.

Após concluir, seguir para `2026-08-14-mvp-01-03-biometrics-device-sync.md`.
