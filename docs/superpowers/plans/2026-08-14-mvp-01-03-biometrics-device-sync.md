# MVP 01.3 Biometrics and Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar consentimento biométrico versionado, criar uma identidade sem template bruto no cloud, sincronizá-la individualmente nos dispositivos homologados e comprovar que a revogação bloqueia imediatamente e remove o cadastro físico.

**Architecture:** Consentimento e identidade vivem no PostgreSQL. Uma outbox transacional dispara jobs BullMQ; o worker materializa comandos duráveis por Edge/dispositivo. WebSocket apenas notifica que há trabalho, enquanto o Edge busca comandos por REST assinado, executa pelo adapter do MVP-00 e envia resultados idempotentes. Revogação muda o estado lógico na mesma transação e mantém jobs de exclusão até confirmação por todos os dispositivos-alvo.

**Tech Stack:** NestJS 11.2.0, Prisma 7.9.1, PostgreSQL 17, Redis 8, BullMQ 6.1.1, `@nestjs/bullmq` 11.0.5, `@nestjs/websockets`/`@nestjs/platform-ws` 11.2.0, MinIO S3-compatible local, Node crypto, Edge Agent/SQLite do MVP-00 e simuladores homologados.

---

## 1. Pré-condições e stop gate físico

- [ ] Slice 1.2 concluída;
- [ ] termo biométrico contém `version`, `purpose`, texto/hash e vigência aprovados;
- [ ] responsáveis de privacidade e operação aprovaram retenção/exclusão;
- [ ] `M1-OPS-01` atendido antes de captura real.

Tasks 1 a 6 podem rodar com simuladores. Antes da Task 7, exigir `M1-HW-01`. Se o gate não estiver atendido, parar com o plano em estado `SIMULATOR_READY`; não marcar `M1-AC-004` nem `M1-AC-007` como concluídos fisicamente.

## 2. Mapa de arquivos

```text
apps/api/src/modules/privacy/*
apps/api/src/modules/biometrics/*
apps/api/src/modules/devices/*
apps/api/src/modules/edge-auth/*
apps/api/src/modules/device-sync/*
apps/api/src/workers/{outbox,device-sync}.processor.ts
apps/api/src/gateways/edge.gateway.ts
apps/edge-agent/src/cloud/{signed-client,command-poller,edge-socket}.ts
apps/edge-agent/src/application/device-sync-worker.ts
apps/edge-agent/src/persistence/device-sync-repository.ts
apps/admin-web/app/(protected)/students/[id]/biometrics/*
apps/admin-web/app/(protected)/operations/devices/*
packages/contracts/src/{biometrics,devices,edge-auth}.ts
packages/database/prisma/migrations/*_biometrics_devices/
infra/docker/compose.yaml
docs/DECISIONS.md
docs/operations/smart-access/supported-hardware.md
```

## Task 1: Add Redis, private object storage and queue health

**Files:**
- Modify: `infra/docker/compose.yaml`, `infra/docker/.env.example`
- Modify: `apps/api/package.json`, `apps/api/src/config/env.ts`
- Create: `apps/api/src/common/storage/object-storage.port.ts`
- Create: `apps/api/src/common/storage/s3-object-storage.adapter.ts`
- Test: `apps/api/test/integration/infrastructure.integration.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Assert API readiness reports PostgreSQL, Redis and object storage independently; liveness stays up when dependencies fail. Assert uploaded enrollment object is private and temporary URL expires. Expected: dependencies not configured.

- [ ] **Step 2: Add exact runtime packages**

```bash
pnpm add -E --filter api bullmq@6.1.1 @nestjs/bullmq@11.0.5 ioredis@6.0.0 @aws-sdk/client-s3@3.1110.0 @aws-sdk/s3-request-presigner@3.1110.0 @nestjs/websockets@11.2.0 @nestjs/platform-ws@11.2.0 ws@8.21.3
pnpm add -DE --filter api @types/ws@8.18.1
pnpm add -DE --filter api testcontainers@12.1.0
```

Add Redis 8 and MinIO to compose with healthchecks and named volumes. Credentials live in ignored environment files; `.env.example` contains local-only placeholders marked non-production.

- [ ] **Step 3: Implement storage boundary**

```ts
export interface ObjectStoragePort {
  createPrivateUpload(input: {
    key: string;
    contentType: 'image/jpeg' | 'image/png';
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<{ uploadUrl: string; expiresAt: string }>;
  headPrivateObject(key: string): Promise<{ size: number; contentType: string }>;
  deletePrivateObject(key: string): Promise<void>;
}
```

Keys are generated server-side as `tenants/{tenantId}/biometrics/{identityId}/enrollment`; clients never choose tenant prefixes.

- [ ] **Step 4: Verify and commit**

Run infrastructure tests with Testcontainers/local MinIO. Expected: anonymous GET is denied, presigned URL expires and readiness identifies dependency code without secret. Commit:

```bash
git add infra/docker apps/api/package.json apps/api/src/config apps/api/src/common/storage apps/api/test pnpm-lock.yaml
git commit -m "build(sync): add redis and private object storage"
```

## Task 2: Persist consent, biometric identity and devices

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_biometrics_devices`
- Create: `apps/api/src/modules/privacy/*`
- Create: `apps/api/src/modules/biometrics/*`
- Create: `apps/api/src/modules/devices/*`
- Test: `apps/api/test/integration/biometric-consent.integration.test.ts`

- [ ] **Step 1: Write failing privacy/schema tests**

Cover consent accept/refuse/revoke, version coexistence, identity blocked without accepted consent, consent revocation fan-out to every active identity, device external ID uniqueness, identity without raw template column, tenant isolation and immutable consent evidence.

- [ ] **Step 2: Add complete models and states**

| Model | Required contract |
|---|---|
| `ConsentDocument` | tenant/global scope, type, version, purpose, content SHA-256, effective/retired dates; unique scope+type+version |
| `ConsentRecord` | tenant, student, document, decision, actor/IP/user-agent, occurredAt, superseded/revoked metadata; immutable |
| `BiometricIdentity` | tenant, student, state, provider kind, object key/reference, created/revoked/deleted timestamps; no template/raw bytes |
| `EdgeNode` | tenant/unit, stable ID, status, version, heartbeat, clock offset, credential metadata |
| `Device` | tenant/unit/edge, kind, model, firmware, serial, status, capabilities, last sync/heartbeat; unique tenant+serial |
| `DeviceUser` | tenant, device, student, identity, externalUserId, state, syncedAt; unique `(deviceId, externalUserId)` and `(deviceId, identityId)` |
| `DeviceSyncJob` | tenant, device, identity, operation, state, attempts, nextAttempt, errorCode, correlation; unique idempotency key |
| `DeviceCommand` | edge, type, payload, state, available/leased/ack timestamps, idempotency; durable |
| `EdgeCredential` | edge, keyId, encrypted secret, active/revoked dates |
| `ReplayNonce` | edge, keyId, nonce hash, expiresAt; unique tuple |

- [ ] **Step 3: Implement consent endpoints and identity creation**

Expose the PRD endpoints plus `POST /api/v1/students/:id/biometric-identities/upload` and a distinct consent-revocation command. Acceptance transaction validates the active document version and stores evidence. Identity creation requires the latest accepted non-revoked consent, validates private object metadata, sets `ACTIVE` and emits sync requests. Refusal does not prevent administrative student creation. Consent revocation blocks every active identity immediately and fans out deletion; deleting a single identity does not rewrite the immutable consent record.

- [ ] **Step 4: Implement device inventory endpoints**

`POST/GET/PATCH /api/v1/devices` requires `device.manage`; model/firmware must match `supported-hardware.md`. Unknown hardware returns `DEVICE_UNSUPPORTED_HARDWARE`, not a generic 500. Audit every mutation.

- [ ] **Step 5: Verify and commit**

Inspect generated schema to prove no binary/template field exists. Run tenant and consent tests. Commit:

```bash
git add packages/database apps/api/src/modules/privacy apps/api/src/modules/biometrics apps/api/src/modules/devices apps/api/test packages/contracts
git commit -m "feat(biometrics): add consent identity and device inventory"
```

## Task 3: Authenticate Edge requests and prevent replay

**Files:**
- Create: `apps/api/src/modules/edge-auth/*`
- Create: `packages/contracts/src/edge-auth.ts`
- Create: `apps/edge-agent/src/cloud/signed-client.ts`
- Test: `apps/api/test/integration/edge-auth.integration.test.ts`
- Test: `apps/edge-agent/test/contract/edge-signing.test.ts`

- [ ] **Step 1: Write shared golden-vector tests**

API and Edge use the same fixtures for body hash, canonical request and signature. Test body tamper, method/path tamper, wrong key, revoked key, nonce replay, timestamp outside ±300 s and Edge attempting another unit.

- [ ] **Step 2: Freeze the canonical request**

```text
ARENAHUB-HMAC-SHA256
{keyId}
{unixTimestampSeconds}
{nonceBase64url}
{UPPERCASE_METHOD}
{normalizedPathAndQuery}
{lowercaseHexSha256Body}
```

Signature is lowercase hex HMAC-SHA256 over the UTF-8 canonical text. Headers are `X-Edge-Key-Id`, `X-Edge-Timestamp`, `X-Edge-Nonce`, `X-Edge-Signature`. Query parameters are sorted by encoded key/value.

- [ ] **Step 3: Implement atomic replay protection**

After signature/time validation, insert nonce hash with unique constraint inside the request transaction. A duplicate returns 401 `EDGE_REPLAY_DETECTED`. Resolve tenant/unit exclusively from `EdgeCredential`; body tenant/unit fields, if present, must exactly match or be rejected.

- [ ] **Step 4: Implement rotation overlap**

Allow current and next credential for a maximum 24-hour rotation window; each has distinct `keyId`. Revocation is immediate. Edge stores the secret through the Windows secure-storage adapter defined by the MVP-00 follow-on; development uses an ignored local file adapter and explicit warning.

- [ ] **Step 5: Verify and commit**

Both runtime golden-vector tests must produce identical signatures. Logs contain key ID only. Commit:

```bash
git add apps/api/src/modules/edge-auth apps/edge-agent/src/cloud apps/api/test apps/edge-agent/test packages/contracts
git commit -m "feat(edge): authenticate requests and block replay"
```

## Task 4: Build transactional sync jobs, BullMQ retries and DLQ

**Files:**
- Create: `apps/api/src/modules/device-sync/*`
- Create: `apps/api/src/workers/{outbox,device-sync}.processor.ts`
- Create: `apps/api/src/gateways/edge.gateway.ts`
- Test: `apps/api/test/integration/device-sync-queue.integration.test.ts`

- [ ] **Step 1: Write failure/retry/idempotency tests**

Test one job per identity/device/operation, outbox crash before enqueue, worker crash after command insert, retryable vs permanent error, attempts 1/2/3/5/8 minute backoff, DLQ after five attempts, signed heartbeat replay/cross-unit attempts and WebSocket disconnect without job loss.

- [ ] **Step 2: Implement outbox dispatcher and queue contract**

The dispatcher locks unpublished outbox rows with `FOR UPDATE SKIP LOCKED`, enqueues using `eventId` as BullMQ `jobId`, then marks published. Duplicate enqueue is success. The device-sync processor creates a durable `DeviceCommand` transactionally and emits only a `commands.available` socket notification.

- [ ] **Step 3: Implement authenticated WebSocket notification**

Edge opens `/api/v1/edge/socket` with a single-use signed challenge. Gateway binds socket to edge/unit; messages contain command count and highest sequence only, never biometric content. Disconnect has no effect on durable commands.

Implement signed `POST /api/v1/edge/heartbeat` and an Edge sender every 30 seconds. Payload reports Edge version, local time/clock offset observation, queue depth and per-device model/firmware/status/last sync. API derives tenant/unit from credential, updates only newer observations and returns server time plus current config version. No serial/credential is written to general logs.

- [ ] **Step 4: Expose observable sync state**

Implement `GET /api/v1/device-sync-jobs` with filters/cursor and stable states `PENDING`, `PROCESSING`, `SYNCED`, `FAILED`, `RETRYING`, `REMOVED`. Responses include device, error code, attempt/last attempt and recommended action, never raw photo/template.

- [ ] **Step 5: Verify and commit**

Stop Redis and WebSocket during tests, restart, and prove command becomes available once. Commit:

```bash
git add apps/api/src/modules/device-sync apps/api/src/workers apps/api/src/gateways apps/api/test
git commit -m "feat(sync): add durable device command pipeline"
```

## Task 5: Execute sync commands in the Edge Agent

**Files:**
- Create: `apps/edge-agent/src/cloud/{command-poller,edge-socket}.ts`
- Create: `apps/edge-agent/src/application/device-sync-worker.ts`
- Create: `apps/edge-agent/src/persistence/device-sync-repository.ts`
- Modify: `apps/edge-agent/src/main.ts`, `apps/edge-agent/src/persistence/database.ts`
- Test: `apps/edge-agent/test/integration/device-sync-worker.test.ts`

- [ ] **Step 1: Write crash and duplicate command tests**

Cover UPSERT/DELETE through simulator, same command twice, process crash after physical success before cloud ack, unavailable bridge, permanent unsupported operation and restart with leased command. Expected: worker missing.

- [ ] **Step 2: Add Edge inbox schema**

SQLite migration adds `cloud_commands`, `command_results` and `device_sync_state`. Persist command before execution. Unique command ID prevents repeat; completed result remains until cloud acknowledges it.

- [ ] **Step 3: Implement pull/lease/result protocol**

```text
GET  /api/v1/edge/commands?after=<sequence>&limit=50
POST /api/v1/edge/commands/:id/lease
POST /api/v1/edge/sync-results/batch
```

Lease is 60 seconds and renewable. API accepts repeated identical result, rejects changed result for the same command and retains original device timestamp plus receive timestamp.

- [ ] **Step 4: Call only the MVP-00 device adapter**

Map UPSERT to the existing facial adapter's user upsert and DELETE to user delete. No SDK import enters Node code. External user ID is generated per device, unrelated to CPF, and stored before command execution.

- [ ] **Step 5: Verify and commit**

Run Edge unit, integration and simulator suites including process restart. Expected: physical effect logically once and cloud result eventually once. Commit:

```bash
git add apps/edge-agent/src apps/edge-agent/test
git commit -m "feat(edge): execute durable biometric sync commands"
```

## Task 6: Implement revocation and deletion verification

**Files:**
- Create: `apps/api/src/modules/biometrics/application/revoke-biometric.use-case.ts`
- Create: `apps/api/src/modules/device-sync/application/reconcile-deletion.use-case.ts`
- Test: `apps/api/test/integration/biometric-revocation.integration.test.ts`
- Test: `apps/admin-web/tests/e2e/biometric-revocation.spec.ts`

- [ ] **Step 1: Write revocation invariants**

Immediately after commit, identity is unusable even with pending physical deletion. One DELETE job exists for every target device. State becomes `DELETION_PENDING` until all devices confirm `REMOVED`, then `DELETED`; failed device remains visible/DLQ and never reactivates identity.

- [ ] **Step 2: Implement atomic logical block and job fan-out**

`DELETE /api/v1/students/:id/biometric-identities/:identityId` requires confirmation/reason, changes identity state, writes audit/outbox and materializes target list in one transaction; it does not rewrite the consent decision. Delete the private enrollment object as soon as every required UPSERT is confirmed and the approved short retention ends, or immediately during revocation once commands contain all data required by the adapter.

- [ ] **Step 3: Implement reconciliation**

Result processor updates `DeviceUser` and job idempotently. It marks identity `DELETED` only when no active/pending/failed device user remains. Manual retry creates a new attempt for the same logical deletion, not a new identity.

- [ ] **Step 4: Build admin enrollment/sync UI**

UI shows consent document/version/purpose, explicit acceptance, private upload, device-by-device status, attempt/error/action and revocation confirmation. No template/photo URL appears after expiry; states use text, icon and accessible live region.

- [ ] **Step 5: Verify simulator slice and commit**

Run end-to-end simulator enrollment and revocation across at least two devices, with one failure/retry. Commit:

```bash
git add apps/api/src/modules apps/api/test apps/admin-web packages/contracts packages/database/prisma
git commit -m "feat(biometrics): revoke and verify physical deletion"
```

## Task 7: Cross the hardware gate and prove physical sync

**Files:**
- Read: `docs/lab/topdata/*`, real ignored inventory and signed MVP-00 decision
- Create: `docs/operations/smart-access/supported-hardware.md`
- Create: `docs/operations/smart-access/biometric-sync-evidence.md`
- Modify: `docs/prd/academia/MVP-01-smart-access.md` only from evidence

- [ ] **Step 1: Validate `M1-HW-01` without bypass**

Run `pnpm --filter edge-agent lab:gate` and inspect the signed decision. Expected: `READY` plus `GO` or `GO_WITH_CONSTRAINTS`. On exit 2, unsigned decision or `NO_GO`, stop here.

- [ ] **Step 2: Propagate exact constraints**

Record supported device kind/model/firmware/SDK/bridge version, network topology, latency limit and known restrictions. No `any model` wording is allowed.

- [ ] **Step 3: Run physical acceptance matrix**

For at least three consenting test identities and every supported device:

```text
create -> sync -> verify presence/recognition
repeat same sync -> no duplicate device user
revoke -> immediate logical block -> physical delete -> verify absence
disconnect/reconnect during sync -> retry -> single final state
```

Use synthetic/test participants with documented deletion at the end.

- [ ] **Step 4: Run full gate and record evidence**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm --filter edge-agent test:hardware:sync
```

Map `M1-FR-013`–`018`, `M1-BR-004/005`, `M1-AC-004/007` to commands, device inventory and result IDs. Do not commit biometric files, credentials or participant PII.

- [ ] **Step 5: Commit only sanitized evidence**

```bash
git add docs/DECISIONS.md docs/operations/smart-access/supported-hardware.md docs/operations/smart-access/biometric-sync-evidence.md docs/prd/academia/MVP-01-smart-access.md packages/contracts/openapi
git commit -m "docs(sync): record physical biometric evidence"
```

## 3. Definition of done

- [ ] ausência/recusa de consentimento impede biometria, não cadastro do aluno;
- [ ] cloud não possui template bruto nem log/URL permanente de imagem;
- [ ] socket perdido não perde comando;
- [ ] retries e DLQ são visíveis e idempotentes;
- [ ] revogação bloqueia logicamente no commit e confirma exclusão por dispositivo;
- [ ] `M1-AC-004/007` passam em simulador e hardware homologado;
- [ ] restrições `GO_WITH_CONSTRAINTS` estão nos testes e rollout.

## 4. Opções de execução

1. **Subagent-Driven (recomendado):** Tasks 1–6 com simuladores, pausa explícita no gate e Task 7 física separada.
2. **Inline:** mesma ordem, sem atravessar o stop gate automaticamente.

Após evidência física, seguir para `2026-08-14-mvp-01-04-online-access.md`.
