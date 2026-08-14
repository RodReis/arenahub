# MVP 01.4 Online Access and Passage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber um reconhecimento do Edge, resolver a identidade correta, decidir acesso por entitlement/política, comandar a catraca uma única vez e correlacionar reconhecimento, decisão, comando e passagem em um evento imutável.

**Architecture:** Um package puro `access-policy` contém a única implementação das regras usadas pelo cloud e, depois, pelo Edge. A API resolve identidade e projeções tenant/unit, avalia a política e persiste `AccessEvent` antes de responder. O Edge persiste a decisão/comando em SQLite e usa a porta de catraca do MVP-00. Confirmação/timed-out atualiza apenas o estado de passagem; correções são eventos vinculados, não mutação destrutiva.

**Tech Stack:** TypeScript 5.9.3, NestJS 11.2.0, Prisma/PostgreSQL, Zod 4.4.3, fast-check 4.9.0, Jest 29.7.0, autocannon 8.0.0, Edge Agent/SQLite e bridge físico homologado.

---

## 1. Pré-condições

- [ ] Slice 1.3 concluída em hardware e `M1-HW-01` válido;
- [ ] ao menos um dispositivo facial e uma catraca estão vinculados à mesma unidade;
- [ ] relógios de API, Edge e hardware sincronizados; offset acima de 30 s gera alerta;
- [ ] limite de latência do MVP-00 registrado; objetivo padrão p95 < 300 ms;
- [ ] fallback durante indisponibilidade cloud ainda é `DENY` explícito até o plano 1.5.

## 2. Mapa de arquivos

```text
packages/access-policy/src/{types,evaluate-access,index}.ts
packages/access-policy/test/{table,property,golden}.test.ts
packages/contracts/src/access.ts
packages/database/prisma/migrations/*_access_events/
apps/api/src/modules/access/{domain,application,infrastructure,transport}/*
apps/api/src/modules/access/transport/edge-access.controller.ts
apps/api/src/modules/access/application/manual-override.use-case.ts
apps/edge-agent/src/application/online-access-orchestrator.ts
apps/edge-agent/src/persistence/access-event-repository.ts
apps/edge-agent/test/{contract,integration,hardware}/online-access*.test.ts
apps/admin-web/app/(protected)/access/override/*
```

## Task 1: Create the versioned pure access engine

**Files:**
- Create: `packages/access-policy/package.json`, `src/types.ts`, `src/evaluate-access.ts`, `src/index.ts`
- Test: `packages/access-policy/test/table.test.ts`
- Test: `packages/access-policy/test/property.test.ts`

- [ ] **Step 1: Write the complete decision table first**

At minimum cover active/blocked/archived student, no entitlement, scheduled/suspended/revoked/expired entitlement, wrong unit, before/inside/after window, overlapping windows, admin block and exact boundary minute. Expected: package/function missing.

- [ ] **Step 2: Freeze the input/output contract**

```ts
export interface AccessPolicyInput {
  evaluatedAt: string;
  unit: { id: string; timezone: string };
  student: { id: string; status: 'LEAD' | 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'CANCELLED' | 'ARCHIVED' };
  entitlements: ReadonlyArray<{
    id: string;
    status: 'SCHEDULED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
    startsAt: string;
    endsAt: string;
    unitIds: readonly string[];
    windows: ReadonlyArray<{ isoDay: number; startMinute: number; endMinute: number }>;
  }>;
  adminBlock: { active: boolean };
}

export interface AccessPolicyResult {
  outcome: 'ALLOW' | 'DENY';
  reason: 'ACTIVE_ENTITLEMENT' | 'NO_ENTITLEMENT' | 'OUTSIDE_SCHEDULE' | 'STUDENT_INACTIVE' | 'STUDENT_BLOCKED' | 'ADMIN_BLOCK';
  entitlementId?: string;
  validUntil?: string;
  policyVersion: '1.0.0';
}
```

No database, clock global, locale global or I/O may be imported by this package.

- [ ] **Step 3: Implement restrictive precedence**

Order: admin block → `BLOCKED` student → other non-`ACTIVE` student → no active/date/unit entitlement → outside all allowed windows → allow. Use `STUDENT_BLOCKED` only for `BLOCKED` and `STUDENT_INACTIVE` for `LEAD`, `TRIAL`, `SUSPENDED`, `CANCELLED` ou `ARCHIVED`. When multiple entitlements match, compute the earliest `validUntil`; never broaden a restrictive student/admin state.

- [ ] **Step 4: Add property tests**

Run `pnpm add -DE --filter @arenahub/access-policy fast-check@4.9.0`. Prove expired/non-active entitlement never allows, wrong unit never allows, admin block always denies and determinism (`same input => deep-equal output`). Use an injected timezone conversion helper with fixed tzdata behavior.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @arenahub/access-policy test
pnpm --filter @arenahub/access-policy typecheck
git add packages/access-policy package.json pnpm-lock.yaml
git commit -m "feat(access): add deterministic policy engine"
```

## Task 2: Persist immutable access events and identity resolution

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_access_events`
- Create: `apps/api/src/modules/access/infrastructure/*`
- Test: `apps/api/test/integration/access-event.integration.test.ts`

- [ ] **Step 1: Write schema and identity resolution tests**

Test external user ID uniqueness per device, same external ID on another device/tenant, revoked/deleted identity, device in wrong unit, immutable event, event correction linkage and idempotency key conflict.

- [ ] **Step 2: Add access models**

`AccessPolicy` stores tenant/unit version/config/effective dates. `AdministrativeBlock` stores tenant/student, reason, actor, interval. `AccessEvent` stores tenant/unit/edge/device/student nullable, identity reference, external recognition ID, decision/reason/policy version, method, mode ONLINE/OFFLINE/OVERRIDE, occurred/received timestamps, correlation ID, idempotency key and immutable detail JSON. `AccessPassage` is a terminal record linked one-to-one ao evento, with command ID, `CONFIRMED` ou `TIMED_OUT` e timestamps. `AccessEventCorrection` links original/new fact and actor/reason.

Constraints: unique `(sourceEdgeId, idempotencyKey)`; index `(tenantId, gymUnitId, occurredAt)`; no update/delete repository for decision facts.

- [ ] **Step 3: Implement tenant/unit identity resolver**

Resolve by authenticated Edge → device → `DeviceUser.externalUserId` → active `BiometricIdentity` → student. Every join includes the same tenant/unit/device scope. Unknown/revoked identity returns a DENY input; it never falls back to a global lookup.

- [ ] **Step 4: Add event append/correction repositories**

`append` accepts an idempotency key and returns the existing identical event on retry. Same key with changed body hash returns 409 `ACCESS_IDEMPOTENCY_CONFLICT`. Correction appends a linked record and audit; original event remains unchanged.

- [ ] **Step 5: Verify and commit**

Run integration and tenant abuse tests. Direct Prisma update is not exposed from access application module. Commit:

```bash
git add packages/database apps/api/src/modules/access apps/api/test packages/contracts
git commit -m "feat(access): persist immutable tenant-scoped events"
```

## Task 3: Implement the authenticated online decision endpoint

**Files:**
- Create: `apps/api/src/modules/access/transport/edge-access.controller.ts`
- Create: `apps/api/src/modules/access/application/decide-online-access.use-case.ts`
- Test: `apps/api/test/contract/edge-access.contract.test.ts`
- Test: `apps/api/test/integration/online-decision.integration.test.ts`

- [ ] **Step 1: Write contract tests with stable reasons**

Request includes `recognitionId`, `deviceId`, `externalUserId`, `recognizedAt`, confidence metadata allowed by hardware policy and idempotency key. Response always contains `accessEventId`, `correlationId`, decision, reason, policy version and optional validUntil. Test malformed, replayed and cross-unit requests.

- [ ] **Step 2: Implement one transactional decision path**

Expose `POST /api/v1/edge/access-decisions`. Authenticate using Edge HMAC. Validate `recognizedAt` against the approved clock-drift limit, but evaluate policy with an API-injected server clock; preserve both recognition and evaluation timestamps as evidence. Within a repeatable-read transaction: resolve identity, load the current access projection, evaluate pure policy, append event/outbox and return. It does not command hardware from cloud.

- [ ] **Step 3: Emit domain events reliably**

Write `AccessGranted` or `AccessDenied` to outbox using `accessEventId` as aggregate. Payload contains stable reason/mode/unit and no CPF, debt, photo or biometric template.

- [ ] **Step 4: Make denial safe under partial data**

Missing projection, unknown identity, revoked biometrics, invalid device or internal validation failure never becomes ALLOW. Expected domain denials are 200 with `DENY`; authentication/replay/protocol errors use HTTP problem status and do not command catraca.

- [ ] **Step 5: Verify and commit**

Run OpenAPI/contract tests. Expected: repeated identical request returns same event/decision, changed body conflicts. Commit:

```bash
git add apps/api/src/modules/access apps/api/test packages/contracts/openapi
git commit -m "feat(access): decide authenticated online access"
```

## Task 4: Correlate Edge recognition, command and passage

**Files:**
- Create: `apps/edge-agent/src/application/online-access-orchestrator.ts`
- Modify: `apps/edge-agent/src/application/access-orchestrator.ts`
- Create: `apps/edge-agent/src/persistence/access-event-repository.ts`
- Test: `apps/edge-agent/test/integration/online-access.test.ts`

- [ ] **Step 1: Write crash/timing tests first**

Cover ALLOW, DENY, API timeout, duplicate recognition, duplicate response, crash before command, crash after command, passage confirmed, timed out and device callback with wrong correlation. Until offline plan, cloud timeout must not release.

- [ ] **Step 2: Persist the local state machine before effects**

```text
RECOGNIZED -> DECISION_PENDING -> DENIED
RECOGNIZED -> DECISION_PENDING -> ALLOWED -> COMMAND_PENDING -> COMMAND_SENT
COMMAND_SENT -> PASSAGE_CONFIRMED | PASSAGE_TIMED_OUT
```

Every transition is stored in SQLite with correlation/access event/recognition/command IDs. Re-entry resumes idempotently.

- [ ] **Step 3: Command catraca exactly once logically**

Only `ALLOW` invokes the existing turnstile adapter using `accessEventId` as command idempotency key. `DENY`, timeout, malformed response and identity mismatch never invoke grant. Log reason/correlation, not student PII.

- [ ] **Step 4: Report passage result**

Expose signed `POST /api/v1/edge/access-events/:id/passage` with `CONFIRMED` or `TIMED_OUT`, device timestamp and command ID. API appends one `AccessPassage` idempotently and rejects a different terminal result with conflict/correction workflow; it never updates the immutable decision row.

- [ ] **Step 5: Verify and commit**

Run simulator and hardware smoke with physical command disabled first, then enabled in assisted window. Commit:

```bash
git add apps/edge-agent/src apps/edge-agent/test apps/api/src/modules/access apps/api/test
git commit -m "feat(edge): correlate online decision and passage"
```

## Task 5: Add audited manual override

**Files:**
- Create: `apps/api/src/modules/access/application/manual-override.use-case.ts`
- Create: `apps/admin-web/app/(protected)/access/override/*`
- Test: `apps/api/test/integration/manual-override.integration.test.ts`
- Test: `apps/admin-web/tests/e2e/manual-override.spec.ts`

- [ ] **Step 1: Write permission and audit tests**

Override requires `access.override`, unit scope, student or visitor descriptor, target device, reason of at least 10 chars, actor MFA when policy requires and idempotency key. It never changes student, subscription or entitlement.

- [ ] **Step 2: Implement explicit override command**

`POST /api/v1/access/manual-overrides` creates `ManualAccessOverride`, `AccessEvent` mode OVERRIDE and durable Edge command in one transaction. Edge still deduplicates physical grant by event ID. Visitor description is minimized and retention-tagged.

- [ ] **Step 3: Build confirmation-first UI**

Show student/current access result, device/unit and reason. Require final confirmation. Success shows access event ID; failure preserves reason and never optimistically reports passage.

- [ ] **Step 4: Verify and commit**

Expected: unauthorized user gets 403; valid override appears in audit/timeline and leaves entitlement unchanged. Commit:

```bash
git add apps/api/src/modules/access apps/admin-web apps/api/test
git commit -m "feat(access): add audited manual override"
```

## Task 6: Prove latency, capacity and physical acceptance

**Files:**
- Create: `apps/api/test/load/online-access.mjs`
- Create: `apps/edge-agent/test/hardware/online-passage.test.ts`
- Create: `docs/operations/smart-access/online-access-evidence.md`
- Modify: `docs/prd/academia/MVP-01-smart-access.md` after evidence

- [ ] **Step 1: Establish measured peak and load target**

Run `pnpm add -DE --filter api autocannon@8.0.0` to install the pinned load runner.

Record the observed first-unit peak or, before pilot, the approved conservative baseline. Load test at 10× that rate for 15 minutes with representative allow/deny mix; never invent a passed capacity number without report.

- [ ] **Step 2: Measure end-to-end physical latency**

Measure recognition timestamp to command acknowledgement for at least 100 trials per supported model/firmware, reporting p50/p95/p99/max/errors. Compare to the exact MVP-00 limit and objective 300 ms.

- [ ] **Step 3: Run negative physical matrix**

Expired, wrong schedule, blocked, revoked biometric, unknown identity and duplicate recognition must not release. Valid identity must create one command and correlated passage state. Override requires separate test.

- [ ] **Step 4: Run full gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm --filter api test:load:access
pnpm --filter edge-agent test:hardware:access
```

- [ ] **Step 5: Record and commit evidence**

Map `M1-FR-019`–`024`, `M1-BR-002/003/006/007/009`, `M1-NFR-002/003`, `M1-AC-005/006/008` to test/report IDs.

```bash
git add docs/operations/smart-access/online-access-evidence.md docs/prd/academia/MVP-01-smart-access.md apps/api/test/load apps/edge-agent/test/hardware packages/contracts/openapi
git commit -m "docs(access): record online passage evidence"
```

## 3. Definition of done

- [ ] cloud e Edge compartilham a mesma política/versionamento;
- [ ] nenhuma falha, timeout ou dado ausente produz ALLOW;
- [ ] ALLOW físico ocorre uma vez por access event;
- [ ] passagem e timeout ficam correlacionados e eventos originais são imutáveis;
- [ ] override é explícito, autorizado, auditado e não altera entitlement;
- [ ] latência/capacidade têm relatório real por hardware suportado;
- [ ] `M1-AC-005/006/008` passam.

## 4. Opções de execução

1. **Subagent-Driven (recomendado):** engine/schema/API/Edge/override/evidência em tasks isoladas.
2. **Inline:** executar na ordem, mantendo stop antes do comando físico assistido.

Após concluir, seguir para `2026-08-14-mvp-01-05-offline-operation.md`.
