# MVP 02.5 Refund and Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solicitar e acompanhar refunds, gerar recibo não fiscal e conciliar todos os movimentos internos/externos, permitindo resolver divergências sem SQL nem efeito financeiro duplicado.

**Architecture:** Refund é uma entidade/movimento próprio e só se confirma por observação autenticada do provedor. A política de acesso é aplicada prospectivamente na confirmação. Runs de conciliação importam movimentos do adapter, preservam snapshot/hash e executam matching determinístico. Resoluções são registros append-only e, quando exigem efeito, disparam comandos de domínio idempotentes. Recibos são snapshots verificáveis e imprimíveis, não documentos fiscais.

**Tech Stack:** NestJS/Prisma/PostgreSQL, provider `listMovements`/refund homologado, BullMQ, private object storage, csv-stringify já presente no MVP-01, Next.js/Playwright e métricas operacionais.

---

## 1. Pré-condições

- [ ] Slices 2.2 e 2.3 reais concluídas;
- [ ] `M2-PROVIDER-01` e refund/reconciliation do manifest válidos;
- [ ] política `KEEP_UNTIL_PERIOD_END` ou `SUSPEND_ON_CONFIRMATION` aprovada;
- [ ] limites de refund/step-up e retenção de extratos aprovados;
- [ ] `PAYMENT_REFUND` desligada até sandbox acceptance.

## Task 1: Add refund state machine and immutable schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_refund_reconciliation`
- Create: `apps/api/src/modules/refunds/domain/refund-state.ts`
- Test: `apps/api/test/integration/refund-schema.integration.test.ts`

- [ ] **Step 1: Write amount/state tests**

Refund only confirmed payment, positive amount ≤ remaining refundable, concurrent requests cannot exceed payment, `CONFIRMED→REFUND_PENDING→CONFIRMED` após refund parcial/falho, full transition to `REFUNDED`, duplicate provider ID, invalid terminal regression and tenant isolation.

- [ ] **Step 2: Add models**

`Refund` stores tenant/payment/invoice, amount/currency, state `REQUESTED|PROCESSING|CONFIRMED|FAILED|CANCELLED`, reason, requestor/approver, provider refs encrypted/hash, idempotency and timestamps. `Receipt` stores immutable number/snapshot/hash. `ReconciliationRun`, `ExternalMovement`, `ReconciliationItem` and `ReconciliationResolution` use PRD statuses and append-only evidence.

- [ ] **Step 3: Add monetary/uniqueness constraints**

Unique provider refund/movement IDs per account, run source hash, item pair and resolution idempotency. Serializable lock/payment query ensures sum of nonfailed refunds ≤ confirmed amount. Financial movements cannot update/delete.

- [ ] **Step 4: Define invoice result**

Refund request moves Payment from CONFIRMED to REFUND_PENDING while reserving the amount. Failed/cancelled or partial confirmed refund returns Payment to CONFIRMED after releasing/consuming the reservation; partial confirmed appends negative movement and invoice remains PAID. When confirmed cumulative refund equals paid total, Payment and Invoice become REFUNDED. Neither path reopens invoice or deletes receipt/payment history.

- [ ] **Step 5: Verify and commit**

```bash
git add packages/database apps/api/src/modules/refunds apps/api/test
git commit -m "feat(billing): add immutable refund and reconciliation schema"
```

## Task 2: Cancel charges, request refund and observe provider completion

**Files:**
- Create: `apps/api/src/modules/refunds/application/{request,observe}-refund.use-case.ts`
- Create: `apps/api/src/modules/refunds/transport/refunds.controller.ts`
- Extend: `apps/payment-provider-simulator/src/refunds.ts`
- Test: `apps/api/test/integration/refund.integration.test.ts`

- [ ] **Step 1: Write approval/provider failure tests**

Require `payment.refund`, recent MFA, reason and distinct approver above threshold. Test cancellation of PENDING/PROCESSING payment, invoice cancellation without confirmed payment, same key, changed hash, provider timeout, query recovery, duplicate/out-of-order webhook, partial/full refund, failed refund and amount race. Confirmed payment cannot be cancelled; it requires refund.

- [ ] **Step 2: Persist before provider call**

`POST /api/v1/payments/:id/cancel` records a deterministic provider cancellation operation for nonconfirmed payment; verified cancellation transitions Payment to CANCELLED. `POST /api/v1/invoices/:id/cancel` is allowed only without confirmed/processing payment and appends cancellation movement/audit. `POST /api/v1/payments/:id/refunds` transactionally reserves refundable amount with Refund REQUESTED and ProviderOperation deterministic key. Workers call `cancelPayment` or `refundPayment`; ambiguous result remains PROCESSING and queries status, never submits a new key.

- [ ] **Step 3: Normalize provider refund events**

Verified webhook/query maps to observation and locks Refund/Payment. CONFIRMED appends `PaymentRefunded`, refund movement, invoice state if full and audit/outbox once. Delayed PROCESSING/FAILED cannot regress CONFIRMED.

- [ ] **Step 4: Apply access policy prospectively**

At confirmed timestamp load versioned tenant refund policy. `KEEP_UNTIL_PERIOD_END` leaves current entitlement and prevents future renewal credit; `SUSPEND_ON_CONFIRMATION` calls Membership port effective now. It never retroactively changes past access events. Record policy version/result in audit.

- [ ] **Step 5: Verify and commit**

Run simulator duplicates/races and assert one provider refund logically, one movement and one policy effect.

```bash
git add apps/api/src/modules/refunds apps/payment-provider-simulator apps/api/test packages/contracts/openapi
git commit -m "feat(billing): process refunds idempotently"
```

## Task 3: Generate verifiable non-fiscal receipts

**Files:**
- Create: `apps/api/src/modules/receipts/*`
- Create: `apps/admin-web/app/(protected)/billing/receipts/[id]/*`
- Test: `apps/api/test/integration/receipt.integration.test.ts`
- Test: `apps/admin-web/tests/e2e/receipt.spec.ts`

- [ ] **Step 1: Write snapshot/authorization tests**

Receipt only for confirmed payment, once per payment/version, immutable after invoice/refund, tenant isolation, masked payer/provider data and hash verification. Refund generates separate linked receipt/credit evidence, not mutation.

- [ ] **Step 2: Freeze receipt snapshot**

Snapshot contains ArenaHub receipt number, explicit `RECIBO NÃO FISCAL`, tenant legal/display info approved for display, payer masked name/matrícula, invoice/payment IDs, paid amount/date/method masked, provider transaction suffix, item snapshot and SHA-256 verification code. No tax claim, PAN/token or webhook ID.

- [ ] **Step 3: Implement idempotent generation**

Payment confirmation writes Receipt in same transaction or outbox-driven idempotent worker with unique payment ID. Canonical JSON hash and sequential tenant/year receipt number are persisted; later display renders snapshot, not live mutable records.

- [ ] **Step 4: Build printable accessible view**

Server Component fetches receipt, renders print stylesheet and verification code. `GET /api/v1/receipts/:id` returns no-store JSON/HTML representation. Browser print is sufficient for MVP; no PDF/runtime renderer is introduced.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/receipts apps/admin-web apps/api/test packages/contracts/openapi
git commit -m "feat(billing): add verifiable non-fiscal receipts"
```

## Task 4: Import provider movements and reconcile deterministically

**Files:**
- Create: `apps/api/src/modules/reconciliation/application/{start-run,match-movements}.use-case.ts`
- Create: `apps/api/src/workers/reconciliation.processor.ts`
- Test: `apps/api/test/integration/reconciliation.integration.test.ts`

- [ ] **Step 1: Write matching matrix**

Exact external payment/refund ID+account+amount/currency → MATCHED. External only → MISSING_INTERNAL. Internal confirmed without external in closed window → MISSING_EXTERNAL. Same ID with amount/currency mismatch → AMOUNT_MISMATCH. Duplicate statement/page/retry yields same result.

- [ ] **Step 2: Persist run boundaries and source evidence**

`POST /api/v1/reconciliation/runs` requires account and closed UTC interval. Persist provider cursor/page hashes, imported movement normalized snapshot and raw private evidence reference. Same account/interval/source hash is idempotent.

- [ ] **Step 3: Stream `listMovements` safely**

Worker reads adapter async iterable page-by-page, validates account/currency/timestamps, upserts external movement by unique ID and records final high-water mark. Rate limit/unavailability pauses retry without changing stored invoices/payments.

- [ ] **Step 4: Match only deterministic keys**

Automatic matching never uses fuzzy payer name/value alone. It first matches provider account+external ref, then validates amount/currency/type. Unmatched/mismatched items remain open with recommended action and evidence.

- [ ] **Step 5: Verify and commit**

Run statement page replay, provider outage and 100% fixture accounting: every external/internal movement is MATCHED or an explicit item.

```bash
git add apps/api/src/modules/reconciliation apps/api/src/workers/reconciliation.processor.ts apps/api/test
git commit -m "feat(billing): reconcile provider movements deterministically"
```

## Task 5: Resolve divergences without database edits

**Files:**
- Create: `apps/api/src/modules/reconciliation/application/resolve-item.use-case.ts`
- Create: `apps/api/src/modules/reconciliation/transport/reconciliation.controller.ts`
- Create: `apps/admin-web/app/(protected)/billing/reconciliation/*`
- Test: `apps/api/test/integration/reconciliation-resolution.integration.test.ts`
- Test: `apps/admin-web/tests/e2e/reconciliation.spec.ts`

- [ ] **Step 1: Write permission/resolution tests**

Require `reconciliation.resolve`, recent MFA for monetary action, reason/evidence, optional distinct approver above threshold. Self-approval, changed resolved item, duplicate command and cross-tenant links fail.

- [ ] **Step 2: Define allowed resolution commands**

`LINK_EXISTING` links exact internal/external movement after amount/currency validation; `REPROCESS_PROVIDER_EVENT` requeues original inbox through same idempotent processor; `REQUERY_PROVIDER` schedules query; `ACCEPT_DOCUMENTED_DIFFERENCE` records approved nonmonetary disposition; `CREATE_COMPENSATING_MOVEMENT` invokes controlled domain command. No generic edit/delete.

- [ ] **Step 3: Append resolution atomically**

Lock open item, validate current evidence, append `ReconciliationResolution`, execute allowed command with idempotency, set item RESOLVED only when resulting invariant is satisfied, audit actor/approver. Original events/movements remain.

- [ ] **Step 4: Build exception queue UI**

Show run/account/period, internal/external facts side-by-side, mismatch code, recommended commands and complete resolution timeline. Never expose raw webhook, encrypted token or full payer data.

- [ ] **Step 5: Verify and commit**

Finance operator resolves each fixture without terminal/SQL. Rerun reconciliation and assert stable resolution/no duplicate effect.

```bash
git add apps/api/src/modules/reconciliation apps/admin-web apps/api/test packages/contracts/openapi
git commit -m "feat(billing): resolve reconciliation exceptions safely"
```

## Task 6: Add export, webhook health and safe reprocessing runbook

**Files:**
- Create: `apps/api/src/modules/reconciliation/reconciliation-export.service.ts`
- Create: `apps/admin-web/app/(protected)/billing/operations/*`
- Create: `docs/operations/smart-billing/{refund,reconciliation,webhook-reprocessing}.md`
- Create: `scripts/smoke/smart-billing.mjs`
- Test: `apps/admin-web/tests/e2e/billing-operations.spec.ts`

- [ ] **Step 1: Write export isolation/formula tests**

Async CSV export uses private object/temporary URL, tenant/account/period authorization and formula neutralization: prefix any cell starting with `=`, `+`, `-`, `@`, tab or carriage return with a single quote. Large export streams by cursor and does not block API. Cross-tenant guessed export returns 404.

- [ ] **Step 2: Build health dashboard**

Show provider account status, last valid/invalid webhook, inbox oldest/count, processing p95, poll/retry/DLQ, reconciliation last run/open mismatches and refund pending age. Codes include impact/action, no raw secrets.

- [ ] **Step 3: Write exact reprocessing runbook**

Operator locates inbox/event, verifies signature/hash/account, dry-runs normalized observation, then enqueues same event ID. Expected outputs and stop conditions cover hash conflict, already processed, unknown type and provider drift. SQL mutation is explicitly prohibited.

- [ ] **Step 4: Implement smoke**

Simulator/provider mode creates minimum charge, confirms, verifies receipt, requests test refund if enabled, runs reconciliation and asserts match. Production smoke never auto-refunds or creates real charge without explicit approved flag.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/reconciliation apps/admin-web docs/operations/smart-billing scripts/smoke
git commit -m "docs(billing): add financial operations and runbooks"
```

## Task 7: Close the pilot financial cycle

**Files:**
- Create: `docs/operations/smart-billing/pilot-cycle-evidence.md`
- Modify: `docs/prd/academia/MVP-02-smart-billing.md` after signed decision

- [ ] **Step 1: Run sandbox/refund/reconciliation acceptance**

Execute full/partial behavior supported, duplicate/out-of-order observations, policy effect, receipt, movement listing and deterministic match. Validate provider plan/manifest still current.

- [ ] **Step 2: Run one parallel production cycle**

With approved pilot group/values, generate invoices and observe payments without automatic blocking first. Reconcile 100% as MATCHED or reviewed divergence; no raw sensitive artifact in evidence.

- [ ] **Step 3: Resolve every divergence through UI/runbook**

Record item ID suffix, cause, command, approver and post-resolution invariant. No direct database edit. Repeat run proves no duplicate movement/effect.

- [ ] **Step 4: Run full gates and security scan**

Root commands, webhook load/recovery, refund races, tenant isolation, export, secret/PAN/CVV/token scan and SLO. Restore the latest cloud backup into an isolated environment and reconcile counts/hashes for invoices, payments, movements, provider inbox, refunds and reconciliation items before destroying the isolated restore. Map `M2-FR-017`–`020`, BR/NFR and `M2-AC-009/010/011`.

- [ ] **Step 5: Sign final decision and commit**

Produto, Financeiro, Técnico and Operação approve metrics, unresolved risks and rollout flags. Failure keeps MVP `EM_DESENVOLVIMENTO`/`BLOQUEADO`.

```bash
git add docs/operations/smart-billing/pilot-cycle-evidence.md docs/prd/academia/MVP-02-smart-billing.md packages/contracts/openapi
git commit -m "docs(mvp2): record smart billing pilot decision"
```

## 2. Definition of done

- [ ] refund uses provider observation and never reopens invoice;
- [ ] refund access effect is prospective/versioned;
- [ ] receipt snapshot is imutável, verificável e não fiscal;
- [ ] every movement is matched or explicit divergence;
- [ ] resolutions are append-only/domain commands, never SQL edits;
- [ ] exports/health respect tenant and secret boundaries;
- [ ] reprocessing is idempotent and rehearsed;
- [ ] `M2-AC-009/010/011` and pilot reconciliation pass.

## 3. Opções de execução

1. **Subagent-Driven (recomendado):** refund, receipt, import/match, resolution, operations e pilot separados.
2. **Inline:** executar sequencialmente, exigindo approval para sandbox/produção/refund real.

Ao concluir, retornar ao índice e executar o gate final do MVP-02.
