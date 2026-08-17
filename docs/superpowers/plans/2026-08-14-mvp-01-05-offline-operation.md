# MVP 01.5 Offline Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manter a unidade operando durante queda cloud apenas dentro da política aprovada, usando snapshot íntegro e expirável, decisão local determinística e fila persistente reconciliada sem perda ou duplicação lógica.

**Architecture:** A API gera snapshots completos ou incrementais de projeções de acesso, serializa deterministicamente e assina com Ed25519. O Edge valida chave/assinatura/tenant/unidade/base/version/expiração e aplica atomicamente ao SQLite. Na queda cloud, ele executa o mesmo package `access-policy`, persiste o evento antes do comando físico e envia o backlog em lotes idempotentes quando a conexão retorna.

**Tech Stack:** NestJS/Prisma/PostgreSQL, Node `crypto` Ed25519, BullMQ, `packages/access-policy`, Edge Agent Node 24 com `node:sqlite`, Jest/fast-check e simuladores/hardware homologados.

---

## 1. Pré-condições e política obrigatória

- [ ] Slice 1.4 concluída e policy version `1.0.0` publicada;
- [ ] operação aprovou por unidade: `snapshotTtlMinutes`, `graceMinutes`, máximo de clock drift e fallback após expiração;
- [ ] fallback deste MVP é um de `DENY_ALL` ou `MANUAL_OVERRIDE_ONLY`; `ALLOW_ALL` é proibido;
- [ ] par de chaves Ed25519 por ambiente foi criado em secret manager; apenas chaves públicas ficam no Edge;
- [ ] backup SQLite e espaço mínimo em disco fazem parte do diagnóstico.

Política padrão para ambiente local/teste: TTL 15 min, grace 5 min, `DENY_ALL` após expiração e clock drift máximo 30 s. Produção não herda automaticamente esses valores: exige aprovação registrada.

## 2. Mapa de arquivos

```text
apps/api/src/modules/offline-access/*
apps/api/src/modules/offline-access/snapshot/{canonicalize,sign,build}.ts
apps/api/src/modules/offline-access/reconciliation/*
apps/api/src/workers/access-snapshot.processor.ts
apps/edge-agent/src/offline/{snapshot-client,snapshot-validator,snapshot-applier}.ts
apps/edge-agent/src/application/offline-access-orchestrator.ts
apps/edge-agent/src/application/backlog-reconciler.ts
apps/edge-agent/src/persistence/{access-cache,offline-outbox}.repository.ts
packages/contracts/src/offline-access.ts
packages/database/prisma/migrations/*_offline_snapshots/
apps/edge-agent/test/faults/*
docs/DECISIONS.md
docs/operations/smart-access/offline-policy.md
```

## Task 1: Freeze the canonical snapshot and key-rotation contract

**Files:**
- Create: `packages/contracts/src/offline-access.ts`
- Create: `apps/api/src/modules/offline-access/snapshot/{canonicalize,sign}.ts`
- Test: `apps/api/test/contract/snapshot-signature.contract.test.ts`
- Test: `apps/edge-agent/test/contract/snapshot-signature.contract.test.ts`

- [ ] **Step 1: Write shared golden-vector tests**

API signs and Edge verifies the same committed fixture. Tamper tenant, unit, record, expiry, base version, order or signature and expect rejection. Unknown/revoked key is rejected. Expected: modules missing.

- [ ] **Step 2: Freeze the envelope**

```ts
export interface AccessSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  kind: 'FULL' | 'INCREMENTAL';
  tenantId: string;
  gymUnitId: string;
  version: number;
  baseVersion: number | null;
  policyVersion: '1.0.0';
  generatedAt: string;
  validUntil: string;
  graceUntil: string;
  records: ReadonlyArray<{
    studentId: string;
    externalUserIds: ReadonlyArray<{ deviceId: string; externalUserId: string }>;
    studentStatus: string;
    adminBlocked: boolean;
    entitlements: ReadonlyArray<{
      id: string;
      status: string;
      startsAt: string;
      endsAt: string;
      windows: ReadonlyArray<{ isoDay: number; startMinute: number; endMinute: number }>;
    }>;
    operation: 'UPSERT' | 'DELETE';
  }>;
  keyId: string;
  signature: string;
}
```

Canonical JSON sorts object keys recursively and sorts records/external IDs/entitlements/windows by stable IDs/fields before signing. Signature excludes only the `signature` field.

- [ ] **Step 3: Implement Ed25519 signing/verification**

API loads private key by `keyId`; Edge trusts an allowlist of public keys with activation/revocation timestamps. Sign UTF-8 canonical bytes using `crypto.sign(null, bytes, privateKey)`. Verification uses `crypto.verify`. Never use the HMAC transport secret for snapshot signing.

- [ ] **Step 4: Define rotation**

Publish new public key to Edge while old key remains trusted; begin signing with new key after acknowledged distribution; revoke old key only after all online Edges confirm. A revoked key cannot validate a newly received snapshot, but an already-applied non-expired snapshot records the key used for audit.

- [ ] **Step 5: Verify and commit**

Run both contract tests and compare canonical byte SHA-256. Commit:

```bash
git add packages/contracts apps/api/src/modules/offline-access/snapshot apps/api/test/contract apps/edge-agent/test/contract
git commit -m "feat(offline): define signed snapshot contract"
```

## Task 2: Build full and incremental snapshots transactionally

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_offline_snapshots`
- Create: `apps/api/src/modules/offline-access/snapshot/build.ts`
- Create: `apps/api/src/workers/access-snapshot.processor.ts`
- Test: `apps/api/test/integration/access-snapshot.integration.test.ts`

- [ ] **Step 1: Write snapshot consistency tests**

Cover one tenant/unit only, active/revoked/deleted projections, monotonically increasing version, correct incremental base, concurrent entitlement change, full recovery after missing base and generation retry idempotency.

- [ ] **Step 2: Add persistence models**

`AccessProjectionChange` is an ordered per-unit change log. `AccessSnapshotManifest` stores tenant/unit/version/base/kind/hash/key/times/record count/object key/status. `EdgeSnapshotAck` stores edge/version/applied/rejected code and clock offset. Unique `(gymUnitId, version)` and `(edgeId, version)`.

- [ ] **Step 3: Produce a consistent projection**

In repeatable-read transaction, reserve next version, read changes through a high-water mark and build DTO only from entitlement/student/admin/identity projections. For full snapshots include every current external user projection. For incremental include UPSERT/DELETE changes since base. Commit manifest/outbox, then worker serializes/signs/uploads privately and marks ready.

- [ ] **Step 4: Expose latest/download endpoints**

`GET /api/v1/edge/access-snapshots/latest?currentVersion=n` returns `NO_CHANGE`, incremental if base matches, otherwise full. Response uses Edge auth, fixed unit scope and private streamed body/presigned URL valid at most 60 s. Hash is checked after download.

- [ ] **Step 5: Verify and commit**

Force worker retry after upload and prove one logical version/hash. Commit:

```bash
git add packages/database apps/api/src/modules/offline-access apps/api/src/workers apps/api/test packages/contracts
git commit -m "feat(offline): generate full and incremental snapshots"
```

## Task 3: Validate and atomically apply snapshots on Edge

**Files:**
- Create: `apps/edge-agent/src/offline/{snapshot-client,snapshot-validator,snapshot-applier}.ts`
- Create: `apps/edge-agent/src/persistence/access-cache.repository.ts`
- Modify: `apps/edge-agent/src/persistence/database.ts`
- Test: `apps/edge-agent/test/integration/snapshot-apply.test.ts`

- [ ] **Step 1: Write rejection and crash tests**

Reject wrong tenant/unit, bad signature/hash, future generation beyond drift, expired, wrong base, rollback version, unsupported schema/policy. Simulate crash halfway through application; old snapshot must remain active.

- [ ] **Step 2: Add shadow/active cache tables**

SQLite adds `snapshot_manifests`, `snapshot_records`, `snapshot_entitlements`, `snapshot_windows`, `snapshot_external_users` keyed by snapshot version and `edge_state.active_snapshot_version`. Foreign keys cascade only within inactive version; active data is not overwritten in place.

- [ ] **Step 3: Validate in strict order**

Validate content length/hash → schema → signature/key → tenant/unit → monotonic version/base → policy compatibility → generated time/drift → valid/grace dates → every record. On any error store sanitized rejection code and keep previous active snapshot.

- [ ] **Step 4: Apply and switch atomically**

In one SQLite transaction insert new version/records and update active pointer. Incremental application materializes a complete new version from base plus operations; it never mutates the active base. After commit send signed ack and prune only versions older than active-1 with no pending event reference.

- [ ] **Step 5: Verify and commit**

Restart after every simulated crash point and assert exactly one active consistent version. Commit:

```bash
git add apps/edge-agent/src/offline apps/edge-agent/src/persistence apps/edge-agent/test
git commit -m "feat(edge): validate and atomically apply access snapshots"
```

## Task 4: Decide locally with explicit expiry and degraded mode

**Files:**
- Create: `apps/edge-agent/src/application/offline-access-orchestrator.ts`
- Create: `apps/edge-agent/src/domain/offline-policy.ts`
- Test: `apps/edge-agent/test/unit/offline-policy.test.ts`
- Test: `apps/edge-agent/test/integration/offline-decision.test.ts`

- [ ] **Step 1: Write the complete availability matrix**

```text
cloud online -> online path
cloud unavailable + now <= validUntil -> offline policy
validUntil < now <= graceUntil -> offline policy with DEGRADED_GRACE alert
now > graceUntil + DENY_ALL -> deny SNAPSHOT_EXPIRED
now > graceUntil + MANUAL_OVERRIDE_ONLY -> deny normal; explicit local fallback workflow only
clock drift > approved maximum -> deny normal and show CLOCK_UNTRUSTED
no valid snapshot -> deny NO_VALID_SNAPSHOT
```

- [ ] **Step 2: Reuse the same policy package**

Map active snapshot record to `AccessPolicyInput`, pass recognition timestamp and unit timezone, call `evaluateAccess`. Do not copy rules into Edge. Offline decision response uses the same stable reasons plus `SNAPSHOT_EXPIRED`, `CLOCK_UNTRUSTED` and `IDENTITY_UNKNOWN` from the transport layer.

- [ ] **Step 3: Persist before physical command**

For every offline recognition, insert local `AccessEvent` and outbox row in one SQLite transaction before returning decision to orchestrator. ALLOW then invokes the idempotent turnstile command with local event UUID. If persistence fails/full disk, do not release.

- [ ] **Step 4: Expose mode and cache age**

Edge health includes `connectivityMode`, active snapshot version, age, valid/grace timestamps, queue depth, clock offset and stable alert codes. Public/catraca output contains only allow/deny; technical dashboard gets detailed mode.

- [ ] **Step 5: Verify and commit**

Run golden policy inputs through cloud and Edge and assert byte-equivalent result JSON. Commit:

```bash
git add apps/edge-agent/src/application apps/edge-agent/src/domain apps/edge-agent/test packages/access-policy
git commit -m "feat(edge): decide access from expiring offline cache"
```

## Task 5: Reconcile the offline backlog idempotently

**Files:**
- Create: `apps/edge-agent/src/application/backlog-reconciler.ts`
- Create: `apps/edge-agent/src/persistence/offline-outbox.repository.ts`
- Create: `apps/api/src/modules/offline-access/reconciliation/*`
- Test: `apps/api/test/integration/access-reconciliation.integration.test.ts`
- Test: `apps/edge-agent/test/faults/backlog-recovery.test.ts`

- [ ] **Step 1: Write fault matrix**

Generate at least 100 events, duplicate batches, reorder batches, timeout after API commit, Edge restart, API restart, corrupted local row, wrong tenant, passage arriving after decision and two Edges with same local UUID. Assert no loss and one logical cloud event per edge/idempotency key.

- [ ] **Step 2: Freeze batch contract**

`POST /api/v1/edge/access-events/batch` accepts at most 100 events or 1 MiB. Envelope contains edge ID, batch ID and ordered records with original `occurredAt`, local ID, decision/reason/policy/snapshot version, command/passage correlation and payload hash. API returns accepted duplicate/conflict status per item.

- [ ] **Step 3: Implement cloud inbox transaction**

For each item, validate authenticated unit, insert `InboxReceipt` and `AccessEvent`/outbox in one transaction. Identical retry returns accepted existing ID. Same edge/local ID with different hash returns conflict, moves local item to manual quarantine and raises critical alert.

- [ ] **Step 4: Implement Edge delivery lifecycle**

States `PENDING`, `IN_FLIGHT`, `ACKED`, `QUARANTINED`; leases expire for retry. Delete/prune only ACKED rows after retention. Preserve original timestamp and store cloud receipt ID. Backoff applies only to recoverable errors.

- [ ] **Step 5: Verify and commit**

Run fault suite with process kills, not only mocked exceptions. Expected: 100 unique logical events, original timestamps retained, duplicate count tracked. Commit:

```bash
git add apps/api/src/modules/offline-access apps/edge-agent/src/application apps/edge-agent/src/persistence apps/api/test apps/edge-agent/test
git commit -m "feat(offline): reconcile access backlog exactly once logically"
```

## Task 6: Prove recovery, rollback and policy safety

**Files:**
- Create: `apps/edge-agent/test/faults/offline-shift.test.ts`
- Modify: `docs/DECISIONS.md` — decisão estrutural vira ADR novo em `docs/DECISIONS.md`, aprovado pelo PI
- Create: `docs/operations/smart-access/offline-policy.md`
- Create: `docs/operations/smart-access/offline-evidence.md`
- Modify: `docs/prd/academia/MVP-01-smart-access.md` after evidence

- [ ] **Step 1: Execute a timed outage scenario**

In homologation/hardware: warm snapshot, cut cloud network, exercise authorized/expired/blocked/unknown identities through valid and grace periods, restart Edge, restore cloud and reconcile. Do not manipulate clock backwards; use injected clock in automated tests and real waiting/approved shortened TTL in hardware test.

- [ ] **Step 2: Exercise clock and storage failures**

Test +31 s drift, disk nearly full, corrupted downloaded snapshot, Redis/API unavailable and previous version rollback. Every failure is visible and no unsafe allow occurs.

- [ ] **Step 3: Test Edge upgrade rollback**

Upgrade N→N+1 with pending SQLite events, create more events, rollback to N, reconcile all. Schema migration must be backward-compatible for current/previous Edge during rollout; destructive SQLite migration is forbidden.

- [ ] **Step 4: Run full gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm --filter edge-agent test:faults
pnpm --filter edge-agent test:hardware:offline
```

- [ ] **Step 5: Record and commit evidence**

Map `M1-FR-025`–`029`, `M1-BR-008/009`, `M1-NFR-002`–`004/006`, `M1-AC-009/010` to reports and exact approved policy.

```bash
git add docs/DECISIONS.md docs/operations/smart-access/offline-policy.md docs/operations/smart-access/offline-evidence.md docs/prd/academia/MVP-01-smart-access.md apps/edge-agent/test/faults
git commit -m "docs(offline): record outage and recovery evidence"
```

## 3. Definition of done

- [ ] snapshot adulterado, fora de unidade, regressivo ou vencido nunca é ativado;
- [ ] aplicação interrompida preserva snapshot anterior consistente;
- [ ] decisão local usa o mesmo engine e nunca permite acesso ilimitado;
- [ ] evento é durável antes do comando físico;
- [ ] backlog sobrevive reinício e reconcilia uma vez logicamente;
- [ ] modo, idade do cache, clock drift e backlog são observáveis;
- [ ] rollback N/N-1 com SQLite pendente foi demonstrado;
- [ ] `M1-AC-009/010` passam com política assinada pela operação.

## 4. Opções de execução

1. **Subagent-Driven (recomendado):** contrato/cloud/Edge/policy/reconciliação/fault evidence separados.
2. **Inline:** executar sequencialmente, com janela física aprovada para fault tests.

Após concluir, seguir para `2026-08-14-mvp-01-06-operational-dashboard.md`.
