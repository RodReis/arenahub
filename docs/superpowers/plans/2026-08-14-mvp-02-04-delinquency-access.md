# MVP 02.4 Delinquency and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar reproduzível a sequência vencimento, carência, suspensão e restauração de acesso, com job reexecutável, relógio controlado, override excepcional e rollout em shadow mode.

**Architecture:** Invoice persiste `dueAt`/`graceEndsAt` UTC. Um worker idempotente marca invoice OVERDUE e assinatura PAST_DUE no vencimento, mas mantém entitlement durante carência. Após a carência, uma porta Membership suspende o entitlement somente quando a feature flag está ativa; antes disso o sistema registra a decisão shadow. Pagamento confirmado cancela ações pendentes e restaura pela mesma transação/porta.

**Tech Stack:** NestJS/Prisma/PostgreSQL, BullMQ repeatable jobs, injected `BillingClock`, feature flags do MVP-01, Membership/Entitlement e Edge sync existentes, Jest/fast-check/Playwright.

---

## 1. Pré-condições

- [ ] Slice 2.1 concluída; 2.2/2.3 necessárias para pagamento automático real;
- [ ] timezone/due/grace persistidos por invoice;
- [ ] `AUTOMATIC_DELINQUENCY_BLOCK=false` em todos os ambientes inicialmente;
- [ ] política de override, step-up e aprovação definida;
- [ ] `M2-BLOCKING-01` é stop gate antes de efeito real de suspensão.

## Task 1: Extend state machines and delinquency schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_delinquency`
- Create: `apps/api/src/modules/delinquency/domain/{invoice-overdue-policy,subscription-state}.ts`
- Test: `apps/api/test/unit/delinquency-state.test.ts`
- Test: `apps/api/test/integration/delinquency-schema.integration.test.ts`

- [ ] **Step 1: Write complete transition tests**

Invoice OPEN→PAID/OVERDUE/CANCELLED; OVERDUE→PAID/CANCELLED; PAID never reopens. Subscription ACTIVE→PAST_DUE at due, PAST_DUE→ACTIVE on eligible payment or →CANCELLED, and other existing transitions remain explicit. Invalid transition has zero movement/outbox effect.

- [ ] **Step 2: Add delinquency models**

Add `PAST_DUE` to Subscription. `DelinquencyAction` stores tenant/invoice/subscription, kind `MARK_OVERDUE|SUSPEND_ACCESS|RESTORE_ACCESS`, scheduled/effective times, mode `SHADOW|ENFORCED`, state, idempotency key and result. `BillingAccessException` stores subscription, new block-not-before, reason, requestor/approver, step-up, expiry/revocation and audit.

- [ ] **Step 3: Freeze policy output**

```ts
export type DelinquencyDecision =
  | { action: 'NONE'; reason: 'NOT_DUE' | 'PAID' | 'CANCELLED' | 'VALID_EXCEPTION' }
  | { action: 'MARK_OVERDUE'; effectiveAt: string }
  | { action: 'SUSPEND_ACCESS'; effectiveAt: string };
```

Inputs are invoice state/due/grace, payment eligibility, approved exception and injected now. No global `Date.now()` in domain.

- [ ] **Step 4: Add property/timezone tests**

Prove no suspension before `graceEndsAt`, payment always prevents future suspension, later exception cannot shorten grace, same input deterministic and contractual timezone/DST yields persisted exact instant.

- [ ] **Step 5: Verify and commit**

```bash
git add packages/database apps/api/src/modules/delinquency apps/api/test
git commit -m "feat(billing): add delinquency policy and states"
```

## Task 2: Mark overdue idempotently and run shadow decisions

**Files:**
- Create: `apps/api/src/workers/delinquency.processor.ts`
- Create: `apps/api/src/modules/delinquency/application/evaluate-delinquency.use-case.ts`
- Test: `apps/api/test/integration/delinquency-worker.integration.test.ts`

- [ ] **Step 1: Write scheduler/retry tests**

Run same scan ten times, two workers concurrently, crash after action insert, database retry, due boundary ±1 ms, paid race, tenant failure and delayed worker after grace. Expected: one logical action per kind/invoice.

- [ ] **Step 2: Implement cursor scan and deterministic jobs**

Repeatable dispatcher selects candidate invoices by indexed `nextDelinquencyAt`, pages by `(nextDelinquencyAt,id)` and enqueues `delinquency:{invoiceId}:{action}:{effectiveAt}`. Worker uses DB/injected clock and serializable lock; server timezone is irrelevant.

- [ ] **Step 3: Mark overdue transactionally**

At/after `dueAt`, if unpaid, transition invoice OVERDUE and subscription PAST_DUE, append movements/audit/outbox `InvoiceOverdue`/`SubscriptionPastDue`, schedule grace action. Do not suspend entitlement yet.

- [ ] **Step 4: Record shadow suspension after grace**

When flag is false, evaluate exact action and store `DelinquencyAction(mode=SHADOW,state=COMPLETED)` plus metric, without calling Membership. Dashboard shows would-block count/date/reason. Reexecution returns existing action.

- [ ] **Step 5: Verify and commit**

Run controlled clock across due/grace with flag false. Entitlement remains active and shadow facts are deterministic. Commit:

```bash
git add apps/api/src/workers/delinquency.processor.ts apps/api/src/modules/delinquency apps/api/test
git commit -m "feat(billing): evaluate overdue accounts in shadow mode"
```

## Task 3: Enforce suspension only after the blocking gate

**Files:**
- Extend: `apps/api/src/modules/payments/ports/billing-membership.port.ts`
- Create: `apps/api/src/modules/delinquency/application/suspend-access.use-case.ts`
- Test: `apps/api/test/integration/delinquency-enforcement.integration.test.ts`

- [ ] **Step 1: Write gate and atomicity tests**

Flag off, gate absent, before grace, valid exception and paid race must not suspend. Flag on+gate evidence+after grace suspends once. Crash around Membership/outbox rolls back all. Existing entitlement history remains.

- [ ] **Step 2: Extend the port explicitly**

Add `markPastDue`, `suspendForDelinquency` and existing restore call, each requiring tenant/subscription/invoice/effectiveAt/shared transaction and returning affected entitlement/change flag. Adapter delegates to Membership service; no direct repository import.

- [ ] **Step 3: Check the release gate in configuration**

Production startup refuses `AUTOMATIC_DELINQUENCY_BLOCK=true` unless signed gate version/hash is configured and matches committed approved evidence. Runtime flag evaluation is tenant-scoped and audited.

- [ ] **Step 4: Enforce transactionally**

Re-lock invoice/payment/exception immediately before effect. Append enforced action, call Membership suspend preserving entitlement row/history, emit `EntitlementSuspended` and Edge projection event, audit policy version. Same action key is idempotent.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/delinquency apps/api/src/modules/payments/ports apps/api/test packages/contracts
git commit -m "feat(billing): enforce approved delinquency suspension"
```

## Task 4: Restore access on late eligible payment

**Files:**
- Modify: `apps/api/src/modules/payments/application/confirm-payment.use-case.ts`
- Create: `apps/api/src/modules/delinquency/application/restore-access.use-case.ts`
- Test: `apps/api/test/integration/late-payment-restoration.integration.test.ts`

- [ ] **Step 1: Write payment/block race tests**

Payment before worker lock, worker before payment, webhook duplicated, active-query race, payment during backlog, after shadow/enforced suspension, cancelled subscription and partial payment. Full eligible payment must converge to one ACTIVE entitlement restoration.

- [ ] **Step 2: Cancel pending delinquency atomically**

Payment confirmation locks invoice/subscription, marks future actions CANCELLED, transitions invoice PAID/subscription ACTIVE, calls Membership activate/restore and emits events. If suspension committed first, restoration reactivates/creates correct entitlement without deleting suspended history.

- [ ] **Step 3: Preserve original financial timestamps**

Eligibility uses provider `effectiveAt` validated by adapter; record observed/processed separately. A confirmed payment effective before suspension but delivered later restores access and audit explains backlog delay.

- [ ] **Step 4: Verify Edge propagation**

Integration/E2E proves restored entitlement creates snapshot/sync version and Edge accepts student again exactly once. Billing does not call Edge directly.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/payments apps/api/src/modules/delinquency apps/api/test
git commit -m "feat(billing): restore access after late payment"
```

## Task 5: Add exceptional financial access override

**Files:**
- Create: `apps/api/src/modules/delinquency/application/{request,approve,revoke}-access-exception.use-case.ts`
- Create: `apps/admin-web/app/(protected)/billing/delinquency/*`
- Test: `apps/api/test/integration/billing-access-exception.integration.test.ts`
- Test: `apps/admin-web/tests/e2e/delinquency.spec.ts`

- [ ] **Step 1: Write approval/expiry tests**

Require billing permission, recent MFA, reason, future expiration ≤ approved maximum and distinct approver above threshold. Exception cannot mark invoice paid, create Payment or permanently mutate entitlement. Expiry triggers reevaluation.

- [ ] **Step 2: Implement exception lifecycle**

Request/approve/reject/revoke are immutable transitions. Approved exception sets block-not-before only for its subscription and is checked under same delinquency transaction. Expiry job reevaluates current payment/grace instead of blindly suspending.

- [ ] **Step 3: Build shadow/enforcement UI**

Show invoice due/grace, would-block/blocked state, policy version, active exception, payment observations and exact next action. Confirmation states clearly that exception does not settle debt.

- [ ] **Step 4: Add operational metrics/alerts**

Metrics: overdue count/value, grace population, shadow would-block, enforced blocks, restoration latency, stale actions/DLQ and exceptions nearing expiry. No student/payment ID label.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/delinquency apps/admin-web apps/api/test
git commit -m "feat(billing): add expiring delinquency exceptions"
```

## Task 6: Approve blocking rollout and close slice

**Files:**
- Create: `docs/operations/smart-billing/delinquency-policy.md`
- Create: `docs/operations/smart-billing/delinquency-shadow-report.md`
- Create: `docs/operations/smart-billing/delinquency-evidence.md`
- Modify: `docs/prd/academia/MVP-02-smart-billing.md` after evidence

- [ ] **Step 1: Run one complete shadow cycle**

Generate invoices, reach due/grace, compare would-blocks with Financeiro, reconcile all payments and classify every discrepancy. No entitlement effect.

- [ ] **Step 2: Validate `M2-BLOCKING-01`**

Require zero critical divergence, tested flag rollback, on-call/runbook, approved policy/hash and signed Financeiro/Operação/Técnico decision. Otherwise remain shadow.

- [ ] **Step 3: Enable pilot group and execute timeline**

For approved synthetic/pilot accounts: due→grace active→suspend after boundary→pay→restore→Edge update. Test exception expiry and provider backlog. Abort flag on early/incorrect suspension.

- [ ] **Step 4: Run full root/fault tests**

Include different timezones, clock boundaries, worker restarts, duplicate jobs and payment races. Map `M2-FR-013`–`016`, BR/NFR and `M2-AC-007/008`.

- [ ] **Step 5: Commit signed sanitized evidence**

```bash
git add docs/operations/smart-billing/delinquency-policy.md docs/operations/smart-billing/delinquency-shadow-report.md docs/operations/smart-billing/delinquency-evidence.md docs/prd/academia/MVP-02-smart-billing.md
git commit -m "docs(billing): approve delinquency access rollout"
```

## 2. Definition of done

- [ ] invoice/subscription overdue states are idempotent;
- [ ] entitlement stays active through exact grace boundary;
- [ ] production enforcement cannot start without signed gate hash;
- [ ] suspension/restoration preserve history and sync Edge through Membership events;
- [ ] backlog/out-of-order payment restores correctly;
- [ ] override is expiring, step-up, audited and never marks debt paid;
- [ ] `M2-AC-007/008` pass in pilot.

## 3. Opções de execução

1. **Subagent-Driven (recomendado):** state/schema, shadow, enforcement, restore, override e rollout separados.
2. **Inline:** executar até shadow report e pausar obrigatoriamente no blocking gate.

Depois, seguir para `2026-08-14-mvp-02-05-refund-reconciliation.md`.
