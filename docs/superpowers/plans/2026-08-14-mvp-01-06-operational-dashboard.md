# MVP 01.6 Operational Dashboard and Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à equipe um painel para identificar Edge/dispositivo offline, sync falho, negações e backlog, consultar/exportar eventos e operar um turno piloto sem banco, terminal ou logs brutos.

**Architecture:** Projeções operacionais no PostgreSQL consolidam heartbeat, sync, acesso, backlog e alertas sem consultar tabelas privadas diretamente na UI. Workers calculam alertas idempotentes e exportações assíncronas para storage privado. O painel Next.js lê snapshots por Server Components e usa uma pequena fronteira cliente para atualização ao vivo. Runbooks e smoke automatizado fecham o release e o rollback N/N-1.

**Tech Stack:** NestJS/Prisma/PostgreSQL, BullMQ/Redis, MinIO/S3, `prom-client` 15.1.3, `csv-stringify` 6.8.3, Next.js 16.3.1, Vitest, Playwright 1.62.1 e `@axe-core/playwright` 4.13.0.

---

## 1. Pré-condições

- [ ] Slices 1.1 a 1.5 concluídas;
- [ ] códigos de erro/alerta e estados de Edge/device/sync/backlog estão estáveis;
- [ ] contatos de incidente e horários de cobertura definidos;
- [ ] política de retenção de access/audit/export aprovada;
- [ ] ambiente de homologação representa ao menos uma unidade com Edge e dispositivos homologados.

## 2. Mapa de arquivos

```text
apps/api/src/modules/operations/*
apps/api/src/modules/access-query/*
apps/api/src/modules/exports/*
apps/api/src/workers/{operational-projection,alert,export}.processor.ts
apps/api/src/common/observability/{metrics,health}.ts
apps/admin-web/app/(protected)/operations/*
apps/admin-web/app/(protected)/access-events/*
apps/admin-web/components/operations/*
apps/admin-web/tests/e2e/{operations,access-export}.spec.ts
packages/database/prisma/migrations/*_operations_exports/
scripts/smoke/smart-access.mjs
docs/operations/smart-access/{install,upgrade,diagnose,rollback,backup-restore,pilot}.md
docs/operations/smart-access/evidence/*
```

## Task 1: Build operational read models and metrics

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_operational_projections`
- Create: `apps/api/src/modules/operations/*`
- Create: `apps/api/src/workers/operational-projection.processor.ts`
- Create: `apps/api/src/common/observability/{metrics,health}.ts`
- Test: `apps/api/test/integration/operations-projection.integration.test.ts`

- [ ] **Step 1: Write projection/idempotency tests**

Feed duplicate/out-of-order `EdgeOnline`, `EdgeOffline`, `DeviceSyncFailed`, `AccessDenied` and backlog observations. Assert one current read model per resource, correct tenant/unit, monotonic `observedAt`, no state regression from late events and rebuild from event history.

- [ ] **Step 2: Add read models**

`EdgeOperationalState`, `DeviceOperationalState`, `SyncOperationalState`, `UnitAccessSummary` and `BacklogOperationalState` store current projection plus source event/high-water mark. They are rebuildable and never become source of truth for access decisions.

- [ ] **Step 3: Implement projection workers**

Consumers claim `InboxReceipt`/event ID, ignore already applied events and update only when source version/timestamp is newer under defined ordering. Tenant/unit are copied from authenticated source event, never payload-only free text.

- [ ] **Step 4: Add bounded metrics and health/version**

Run `pnpm add -E --filter api prom-client@15.1.3`. Expose protected `/metrics` with request latency/error, decision latency/outcome, queue/DLQ depth, reconciliation lag, Edge/device online state and sync counts. Labels must not include student/device serial/event ID. API/web/Edge version and health include build SHA and contract version.

- [ ] **Step 5: Verify and commit**

Rebuild projections twice and compare. Assert metric cardinality stays bounded with 1,000 students. Commit:

```bash
git add packages/database apps/api/src/modules/operations apps/api/src/workers apps/api/src/common/observability apps/api/test package.json pnpm-lock.yaml
git commit -m "feat(operations): add projections metrics and health"
```

## Task 2: Detect actionable operational alerts

**Files:**
- Create: `apps/api/src/modules/operations/domain/alert-rules.ts`
- Create: `apps/api/src/workers/alert.processor.ts`
- Test: `apps/api/test/unit/alert-rules.test.ts`
- Test: `apps/api/test/integration/alert-lifecycle.integration.test.ts`

- [ ] **Step 1: Write alert threshold/lifecycle tests**

Rules:

```text
EDGE_OFFLINE: no heartbeat for configured 90 s
DEVICE_OFFLINE: no device heartbeat for configured 90 s
SYNC_FAILED: permanent failure or retries exhausted
SYNC_SUCCESS_RATE_LOW: rolling daily rate below 99%, excluding documented physical downtime
BACKLOG_HIGH: count or oldest age above configured unit threshold
SNAPSHOT_STALE: age entered grace or expired
CLOCK_DRIFT: absolute offset above approved maximum
DLQ_NON_EMPTY: any unresolved dead letter
```

Test OPEN→ACKNOWLEDGED→RESOLVED, reopen, deduplication, delayed events and tenant isolation.

- [ ] **Step 2: Persist alert lifecycle**

`OperationalAlert` has stable fingerprint `(tenant, unit, resource, code)`, severity, impact, recommended action, first/last seen, acknowledged actor/time, resolved time and source evidence. A condition still active updates last seen; it does not spam new rows.

- [ ] **Step 3: Implement scheduler/worker**

Evaluate rules every 30 s with an injected clock and distributed BullMQ repeatable job. Resolution requires healthy observation for two consecutive windows to avoid flapping. Manual acknowledgement never resolves an active condition.

- [ ] **Step 4: Expose alert APIs**

`GET /api/v1/operations/alerts` and `POST /api/v1/operations/alerts/:id/acknowledge` require operational permissions/unit scope. Response always includes impact and recommended action, not stack trace.

- [ ] **Step 5: Verify and commit**

Run fake-clock tests and two concurrent workers; expect one logical alert. Commit:

```bash
git add apps/api/src/modules/operations apps/api/src/workers/alert.processor.ts apps/api/test
git commit -m "feat(operations): add actionable alert lifecycle"
```

## Task 3: Query immutable access events safely

**Files:**
- Create: `apps/api/src/modules/access-query/*`
- Modify: `packages/contracts/src/access.ts`
- Test: `apps/api/test/integration/access-query.integration.test.ts`

- [ ] **Step 1: Write filter/pagination/isolation tests**

Cover period, student, unit, ALLOW/DENY, online/offline/override method, stable `(occurredAt,id)` cursor, timezone boundaries, guessed student/event ID from another tenant and large result rejection without cursor.

- [ ] **Step 2: Implement indexed query**

`GET /api/v1/access-events` requires a bounded period (default 24 h, max interactive 31 days), tenant context and unit scope. Query uses indexes and returns masked student summary, result/reason/method/passage/correlation. It never returns image, CPF, debt or device secret.

- [ ] **Step 3: Add event detail and correction visibility**

`GET /api/v1/access-events/:id` shows immutable original plus linked corrections/audit to authorized users. It does not offer edit/delete. Missing/wrong tenant returns indistinguishable 404.

- [ ] **Step 4: Verify latency**

Seed representative volume and measure p95 administrative query < 500 ms for indexed filters. Store `EXPLAIN (ANALYZE, BUFFERS)` sanitized evidence; add missing compound indexes via a named migration, not runtime hints.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/access-query apps/api/test packages/contracts packages/database/prisma
git commit -m "feat(access): query immutable events with bounded filters"
```

## Task 4: Export access and audit data asynchronously

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_exports`
- Create: `apps/api/src/modules/exports/*`
- Create: `apps/api/src/workers/export.processor.ts`
- Test: `apps/api/test/integration/export.integration.test.ts`

- [ ] **Step 1: Write export security/idempotency tests**

Test large export returns 202, repeated idempotency key creates one job, tenant/unit filters persist, CSV formula injection, private storage, expired download, worker retry, cancellation and retention deletion.

- [ ] **Step 2: Add export job model**

`DataExportJob` stores tenant/requester/type, normalized filters/hash, status, progress, object key, row count, error code, expiry and audit timestamps. Unique `(tenantId, requesterId, idempotencyKey)`.

- [ ] **Step 3: Stream CSV without spreadsheet execution**

Run `pnpm add -E --filter api csv-stringify@6.8.3`. Page database rows by cursor and stream to multipart/private object storage; never load full result in memory. Prefix cells beginning with `=`, `+`, `-`, `@`, tab or carriage return with a single quote. Emit UTF-8 with header and documented UTC/local columns.

- [ ] **Step 4: Expose lifecycle endpoints**

`POST /api/v1/access-events/exports`, `GET /api/v1/exports/:id`, `POST /api/v1/exports/:id/cancel` and short-lived download URL. Authorization is rechecked at download; completed objects expire and are deleted by retention worker.

- [ ] **Step 5: Verify and commit**

Export at least 100k generated rows while asserting bounded process memory and responsive API health. Commit:

```bash
git add packages/database apps/api/src/modules/exports apps/api/src/workers/export.processor.ts apps/api/test package.json pnpm-lock.yaml
git commit -m "feat(exports): add private asynchronous event exports"
```

## Task 5: Build the live operational dashboard

**Files:**
- Create: `apps/admin-web/app/(protected)/operations/*`
- Create: `apps/admin-web/app/(protected)/access-events/*`
- Create: `apps/admin-web/components/operations/*`
- Test: `apps/admin-web/tests/e2e/operations.spec.ts`
- Test: `apps/admin-web/tests/e2e/access-export.spec.ts`

- [ ] **Step 1: Write operator journeys first**

E2E finds an offline Edge, failed sync, non-empty backlog and denied event; filters events; acknowledges alert; starts/downloads export. No journey opens database, terminal or raw log. Test Owner, Receptionist and Tech Operator permission differences.

- [ ] **Step 2: Implement dashboard information hierarchy**

Top row: unit/mode/active critical alerts. Then Edge/devices, sync success/failures, access allow/deny, offline backlog/oldest age. Every state has text, timestamp/age, impact and action. Color is supplemental.

- [ ] **Step 3: Add bounded live refresh**

Initial data comes from Server Component. One Client Component subscribes to operational WebSocket notifications or polls every 15 s with visibility/backoff controls, then refetches read models. It does not receive biometric/access PII over socket.

- [ ] **Step 4: Build event/export views**

Filters serialize to URL, preserve timezone and pagination cursor, and clearly separate decision time from receive time. Export progress is asynchronous. Empty/error/loading states explain next action.

- [ ] **Step 5: Verify accessibility and commit**

Run `pnpm add -DE --filter admin-web @axe-core/playwright@4.13.0`. Execute desktop/390 px, keyboard, zoom 200%, screen-reader labels and axe on login, dashboard, events, student and override flows. No serious/critical violations.

```bash
git add apps/admin-web package.json pnpm-lock.yaml
git commit -m "feat(admin): add operational access dashboard"
```

## Task 6: Write and rehearse installation, upgrade, diagnosis and rollback

**Files:**
- Create: `docs/operations/smart-access/install.md`
- Create: `docs/operations/smart-access/upgrade.md`
- Create: `docs/operations/smart-access/diagnose.md`
- Create: `docs/operations/smart-access/rollback.md`
- Create: `docs/operations/smart-access/backup-restore.md`
- Create: `scripts/smoke/smart-access.mjs`
- Test: `scripts/smoke/smart-access.test.mjs`

- [ ] **Step 1: Write a failing smoke specification**

Smoke checks API/web/Edge versions, ready health, Edge/device online, snapshot valid, queue/DLQ, create synthetic student/entitlement/identity via test fixture, simulated or observation-mode recognition, event correlation and cleanup. Production smoke never creates real biometric identity automatically.

- [ ] **Step 2: Write exact runbooks**

Each runbook includes prerequisites, safe commands, expected output, stop conditions, rollback and evidence location. Install documents Windows service account/secure secret storage/firewall. Diagnose starts in dashboard and only then uses sanitized CLI. Upgrade supports Edge N/N-1 and database expand/contract.

- [ ] **Step 3: Rehearse cloud backup and restore**

Restore a backup into isolated environment, run migrations/readiness and compare counts/hashes for tenants, entitlements and events. Record achieved RPO/RTO. Never restore over production during rehearsal.

- [ ] **Step 4: Rehearse Edge rollback**

With pending outbox, upgrade N→N+1, generate event, rollback N and reconcile. Preserve SQLite and secure credential. A person other than the runbook author executes and annotates gaps.

- [ ] **Step 5: Verify and commit**

```bash
pnpm smoke:smart-access -- --base-url http://localhost:3000 --mode simulator
pnpm test
git add docs/operations/smart-access scripts/smoke package.json
git commit -m "docs(operations): add and rehearse smart access runbooks"
```

## Task 7: Execute observation mode, assisted window and full pilot shift

**Files:**
- Create: `docs/operations/smart-access/pilot.md`
- Create: `docs/operations/smart-access/evidence/pilot-summary.md`
- Modify: `docs/prd/academia/MVP-01-smart-access.md` only after signed evidence

- [ ] **Step 1: Approve pilot checklist**

Confirm hardware, supported versions, consent participants, fallback staff, emergency release independent of software, contacts, maintenance window, success/abort thresholds and data cleanup. Physical safety procedure is owned by the facility, not inferred by code.

- [ ] **Step 2: Run observation mode**

Process real recognitions/decisions/events without commanding the turnstile. Compare ArenaHub decision to existing/manual operation. Any unexplained false allow blocks assisted mode; false deny is investigated and threshold approved.

- [ ] **Step 3: Run assisted command window**

Enable one controlled lane with staff/fallback. Exercise normal allow/deny, override, cloud cut/recovery, sync failure and alert acknowledgement. Abort on uncorrelated command, unsafe release, event loss, stale-cache violation or critical security alert.

- [ ] **Step 4: Run a complete operational shift**

Operators use only dashboard/runbooks. Record access count/outcomes, sync rate, p95 latency, offline/backlog, alerts, overrides, incidents and manual interventions. End with reconciliation count equality and participant biometric cleanup where applicable.

- [ ] **Step 5: Close the MVP gate or record blocker**

Run all root commands and verify:

```text
M1-AC-001..012 passed
daily identity sync >= 99% excluding documented physical downtime
no lost or duplicate logical event
no known unauthorized access
restore and rollback evidence accepted
critical security findings = 0
```

If any condition fails, keep PRD `EM_DESENVOLVIMENTO` or `BLOQUEADO` with owner/evidence; do not relabel as success. If all pass, update checklist/status and commit:

```bash
git add docs/operations/smart-access/evidence/pilot-summary.md docs/operations/smart-access/pilot.md docs/prd/academia/MVP-01-smart-access.md packages/contracts/openapi
git commit -m "docs(mvp1): record smart access pilot decision"
```

## 3. Definition of done

- [ ] painel mostra estados/impacto/ação sem logs brutos;
- [ ] alertas são deduplicados, reconhecíveis e resolvidos por evidência;
- [ ] consultas são isoladas/indexadas e exportações grandes são assíncronas/privadas;
- [ ] API, web e Edge expõem health/version sem segredos;
- [ ] runbooks foram executados por outra pessoa;
- [ ] backup/restore e Edge rollback foram demonstrados;
- [ ] `M1-AC-011/012` passam em piloto;
- [ ] status do PRD reflete evidência, não intenção.

## 4. Opções de execução

1. **Subagent-Driven (recomendado):** projeções, alertas, query/export, UI, runbooks e piloto em revisões separadas.
2. **Inline:** executar até os runbooks; o piloto físico ainda exige janela e responsáveis aprovados.

Ao concluir, retornar ao índice mestre e executar o gate de saída do MVP-01.
