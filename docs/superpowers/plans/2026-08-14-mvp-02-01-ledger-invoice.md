# MVP 02.1 Ledger and Invoice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurar políticas financeiras, precificar planos, gerar uma invoice única por ciclo e registrar pagamento manual com aprovação/auditoria sem acesso direto às tabelas de entitlement.

**Architecture:** `packages/money` concentra operações `bigint`. Billing Settings e Plan Price alimentam um snapshot imutável de invoice. Pagamentos e movimentos financeiros são append-only. A confirmação manual usa a mesma orquestração transacional que futuramente receberá eventos do provedor e chama `BillingMembershipPort`, mantendo Membership dono de assinatura/entitlement.

**Tech Stack:** NestJS 11.2.0, Prisma 7.9.1/PostgreSQL 17, Node `bigint`/crypto, MinIO/S3 privado, Jest/fast-check 4.9.0, Next.js 16.3.1 e Playwright.

---

## 1. Pré-condições

- [ ] `M2-ENTRY-01` atendido no commit-base;
- [ ] permissões Billing do PRD adicionadas ao seed RBAC;
- [ ] interface real do Membership e transaction host identificados;
- [ ] feature flags `BILLING_PIX`, `BILLING_CARD`, `AUTOMATIC_DELINQUENCY_BLOCK`, `PAYMENT_REFUND` criadas desligadas;
- [ ] este slice não chama provedor externo.

## 2. Mapa de arquivos

```text
packages/money/src/{money,discount,serialization}.ts
packages/money/test/{money,property}.test.ts
apps/api/src/modules/billing-settings/*
apps/api/src/modules/invoices/*
apps/api/src/modules/invoices/discounts/*
apps/api/src/modules/payments/manual/*
apps/api/src/modules/payments/application/confirm-payment.use-case.ts
apps/api/src/modules/payments/ports/billing-membership.port.ts
apps/api/src/modules/payments/infrastructure/membership.adapter.ts
apps/api/src/modules/billing-notifications/*
apps/api/src/workers/invoice-generation.processor.ts
apps/admin-web/app/(protected)/billing/{settings,invoices}/*
packages/contracts/src/billing/{money,invoices,payments}.ts
packages/database/prisma/migrations/*_billing_ledger/
```

## Task 1: Create the money package and invariants

**Files:**
- Create: `packages/money/package.json`, `src/money.ts`, `src/discount.ts`, `src/serialization.ts`
- Test: `packages/money/test/money.test.ts`, `packages/money/test/property.test.ts`

- [ ] **Step 1: Write failing table/property tests**

Cover zero/negative rejection, add/subtract same currency, quantity multiplication, BRL serialization, large safe values, fixed discount, basis-point discount and `subtotal - discount = total`. JSON number input must be rejected.

- [ ] **Step 2: Freeze the complete type**

```ts
export type Currency = 'BRL';
export interface Money { currency: Currency; amountMinor: bigint }
export interface MoneyDto { currency: Currency; amountMinor: string }

export function money(amountMinor: bigint, currency: Currency = 'BRL'): Money {
  if (amountMinor < 0n) throw new MoneyError('MONEY_NEGATIVE');
  return { currency, amountMinor };
}
```

Parsing accepts `/^(0|[1-9][0-9]*)$/`, then `BigInt`; no sign, exponent, decimal point or whitespace.

- [ ] **Step 3: Implement discount arithmetic**

Fixed discount cannot exceed subtotal. Percentage is integer basis points `0..10000`; round half-up with `(subtotal * bps + 5000n) / 10000n`. Persist discount kind/value and computed minor amount in invoice item snapshot.

- [ ] **Step 4: Run tests and exact dependency install**

Run `pnpm add -DE --filter @arenahub/money fast-check@4.9.0`, then package test/typecheck. Expected: generated properties pass and no `number` cast exists.

- [ ] **Step 5: Commit**

```bash
git add packages/money pnpm-lock.yaml
git commit -m "feat(billing): add bigint money primitives"
```

## Task 2: Add settings, price catalog and immutable ledger schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_billing_ledger`
- Create: `apps/api/src/modules/billing-settings/*`
- Test: `apps/api/test/integration/billing-schema.integration.test.ts`

- [ ] **Step 1: Write failing schema/tenant tests**

Prove one active settings row per tenant, versioned plan price with non-overlapping effective range, invoice unique per cycle, external refs nullable, movement append-only and cross-tenant guessed IDs rejected.

- [ ] **Step 2: Add enums and models**

Create PRD states plus `ManualPaymentApprovalStatus`. Models:

| Model | Required fields/constraints |
|---|---|
| `BillingSettings` | tenant, BRL, contractual timezone, due rule, grace, block/refund policy, manual/discount/refund thresholds, version |
| `PlanPrice` | tenant/plan, amount minor `BigInt`, effective interval, active/version |
| `Invoice` | tenant/subscription/student, number, cycle, due/grace instants, state, currency, subtotal/discount/total `BigInt`, immutable opened/paid timestamps |
| `InvoiceItem` | invoice, source plan, description snapshot, quantity, unit/subtotal/discount/total minor |
| `Payment` | tenant/invoice, method, state, amount/currency, source, provider refs encrypted/hashed where applicable |
| `PaymentAttempt` | payment, sequence, state, idempotency key, attempted/next times, error code |
| `FinancialMovement` | tenant, invoice/payment/refund refs, type, signed amount minor, currency, occurredAt, correlation, append-only |
| `ManualPaymentRequest` | invoice, actor, reason, private evidence key/hash, amount, approval state/actor/time |
| `BillingDiscountGrant` | tenant/subscription/period, fixed ou basis points, reason, requestor/approver, state, validity and resulting amount snapshot |
| `BillingSequence` | tenant/year, next invoice number, optimistic version |
| `BillingNotification` | tenant, recipient user/role, event ID/code, resource, created/read timestamps; unique recipient+event |

- [ ] **Step 3: Enforce immutability in PostgreSQL**

Migration adds constraints for nonnegative invoice/item/payment amounts, totals equation and a trigger rejecting update of monetary/currency/item fields after invoice leaves `DRAFT`. Application database role cannot update/delete `FinancialMovement`; corrective service appends compensation.

- [ ] **Step 4: Implement settings API**

`GET/PATCH /api/v1/billing/settings` accepts BRL only, validates IANA timezone, grace 0–90 days, policy enums and nonnegative thresholds. Every change increments version and writes audit/outbox; it never alters existing invoice snapshots.

- [ ] **Step 5: Migrate, test and commit**

Run Prisma generate/migrate and integration tests including direct rejected updates. Commit:

```bash
git add packages/database apps/api/src/modules/billing-settings apps/api/test packages/contracts
git commit -m "feat(billing): add settings and immutable ledger schema"
```

## Task 3: Generate invoice once per subscription cycle

**Files:**
- Create: `apps/api/src/modules/invoices/domain/{invoice-state,invoice-calculator}.ts`
- Create: `apps/api/src/modules/invoices/application/{create-invoice,open-invoice}.use-case.ts`
- Create: `apps/api/src/modules/invoices/infrastructure/invoice.repository.ts`
- Create: `apps/api/src/workers/invoice-generation.processor.ts`
- Test: `apps/api/test/integration/invoice-generation.integration.test.ts`

- [ ] **Step 1: Write concurrency/calendar tests**

Test 20 concurrent generation attempts, retry after crash, monthly periods, February/leap year, DST contractual timezone, price version boundary, discount arithmetic and cancelled subscription. Expected: missing use case.

- [ ] **Step 2: Implement calendar snapshot**

Read the subscription billing anchor and settings timezone. Calculate local contractual due date once, convert with PostgreSQL IANA timezone functions and persist UTC `periodStart`, `periodEnd`, `dueAt`, `graceEndsAt`. Tests assert exact instants; worker server timezone must not change results.

- [ ] **Step 3: Implement serializable creation**

Within `Serializable` transaction lock sequence, resolve effective price and any approved `BillingDiscountGrant` for the exact subscription/period, create DRAFT/items, verify totals, assign `{year}-{8-digit sequence}`, transition OPEN, append `INVOICE_OPENED` movement, audit and `InvoiceOpened`. Retry only Prisma `P2034` up to three times. Unique cycle converts identical retry into existing invoice; changed body conflicts. A discount created after OPEN applies only to a future invoice or exige cancel/reissue auditado; it never mutates the opened snapshot.

- [ ] **Step 4: Run worker standalone**

BullMQ job key is `invoice:{tenantId}:{subscriptionId}:{periodStart}`. Worker uses Nest application context without HTTP and scans only due subscriptions by cursor. One tenant failure does not stop others and appears in DLQ after bounded retries.

- [ ] **Step 5: Verify and commit**

Run unit/integration with database timezone changed. Expected: one invoice/movement/event. Commit:

```bash
git add apps/api/src/modules/invoices apps/api/src/workers/invoice-generation.processor.ts apps/api/test packages/contracts/openapi
git commit -m "feat(billing): generate cycle invoices idempotently"
```

## Task 4: Confirm payments through a Membership port

**Files:**
- Create: `apps/api/src/modules/payments/ports/billing-membership.port.ts`
- Create: `apps/api/src/modules/payments/infrastructure/membership.adapter.ts`
- Create: `apps/api/src/modules/payments/application/confirm-payment.use-case.ts`
- Test: `apps/api/test/integration/payment-membership.integration.test.ts`

- [ ] **Step 1: Write atomicity/idempotency tests**

Confirm eligible full payment twice, simulate failure before/after Membership call, partial amount, already paid invoice, archived subscription and concurrent confirmations. Assert payment/invoice/subscription/entitlement/outbox all commit or all rollback.

- [ ] **Step 2: Freeze the port**

```ts
export interface BillingMembershipPort {
  activateFromPayment(input: {
    tenantId: string;
    subscriptionId: string;
    invoiceId: string;
    paymentId: string;
    paidAt: Date;
    transaction: DatabaseTransaction;
  }): Promise<{ entitlementId: string; changed: boolean }>;
}
```

Adapter calls the real Membership application service with the shared transaction. It never imports a Membership repository/table directly.

- [ ] **Step 3: Implement confirmation state machine**

Lock payment/invoice. Only full eligible amount transitions payment to `CONFIRMED` and invoice OPEN/OVERDUE to `PAID`; PAID is idempotent, terminal FAILED/CANCELLED cannot confirm without a new payment. Append payment movement, call port, audit and emit `PaymentConfirmed`/`EntitlementActivated` in one transaction.

- [ ] **Step 4: Prove sync handoff**

Integration fixture consumes entitlement event through the MVP-01 path and creates the expected Edge snapshot/sync change. Billing has no import from Edge/device modules.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter api test -- payment-membership.integration.test.ts
git add apps/api/src/modules/payments apps/api/test packages/contracts
git commit -m "feat(billing): activate membership from confirmed payment"
```

## Task 5: Add controlled discounts and manual payment

**Files:**
- Create: `apps/api/src/modules/payments/manual/*`
- Create: `apps/api/src/modules/invoices/discounts/*`
- Test: `apps/api/test/integration/manual-payment.integration.test.ts`

- [ ] **Step 1: Write authorization/approval tests**

For discounts require `discount.apply`, reason, target subscription/period and recent MFA; above threshold requires distinct `discount.approve`. For manual payment require `payment.record_manual`, full amount, reason, private evidence hash and recent MFA. Above threshold requires request plus distinct approver; self-approval, expired step-up and duplicate idempotency key fail.

- [ ] **Step 2: Implement discount request/approval lifecycle**

Below threshold an authorized actor can approve a fixed/basis-point grant for one future period. Above threshold creates `PENDING_APPROVAL`; approver differs from requestor. Approval freezes kind/value/maximum resulting amount and validity. Generator consumes it once and records grant ID/calculated amount in invoice snapshot. Rejection/revocation is terminal for that grant and never changes an OPEN/PAID invoice.

- [ ] **Step 3: Implement manual payment request/approval**

Below threshold an authorized step-up actor can apply immediately. Above threshold creates `PENDING_APPROVAL`; approval validates actor difference and unchanged invoice, then creates payment source MANUAL and invokes `confirmPayment`. Rejection is terminal and audited. Approval-pending/approved/rejected events feed the internal notification port.

- [ ] **Step 4: Store evidence and expose APIs privately**

Server generates tenant-scoped object key and presigned upload. Accept PDF/JPEG/PNG under approved size, verify hash/content type and expose only temporary download to billing-authorized users. Evidence content never enters event/log.

Implement discount request/approve/reject and PRD manual endpoint plus approve/reject routes with Problem Details, CSRF, tenant/unit scope and idempotency hash conflict.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/payments/manual apps/api/test packages/contracts/openapi
git commit -m "feat(billing): add approved manual payments"
```

## Task 6: Build invoice and manual-payment administration

**Files:**
- Create: `apps/api/src/modules/billing-notifications/*`
- Create: `apps/admin-web/app/(protected)/billing/settings/*`
- Create: `apps/admin-web/app/(protected)/billing/invoices/*`
- Create: `apps/admin-web/app/(protected)/billing/notifications/*`
- Test: `apps/admin-web/tests/e2e/billing-invoice.spec.ts`

- [ ] **Step 1: Write failing finance journey**

Owner configures settings/price; Finance generates/views invoice; Reception records below-limit payment; above-limit request requires another actor. Verify tenant isolation, 390 px, keyboard and textual states.

- [ ] **Step 2: Implement Server Component lists/details**

Query API directly server-side. Display BRL formatted from minor string without converting storage values to float for calculations. Show invoice snapshot, movements, payment attempts and audit timeline.

- [ ] **Step 3: Implement mutation Server Actions**

Validate Zod strings, add idempotency key/CSRF, require confirmation and preserve non-sensitive fields on recoverable errors. Step-up redirects to existing MFA challenge and resumes the intended action only once.

- [ ] **Step 4: Prevent misleading UI**

Invoice PAID and entitlement result are separate labeled facts. Manual request pending approval never appears as paid. Add an internal notification feed/mark-read API populated idempotently from financial outbox events for users with the corresponding permission. Initial codes are approval pending/result and invoice opened; later slices add payment failure/confirmation, overdue, refund and reconciliation mismatch. Public/catraca UI receives no outstanding value.

- [ ] **Step 5: Verify and commit**

Run Vitest, Playwright/axe, lint, typecheck and build. Commit:

```bash
git add apps/api/src/modules/billing-notifications apps/admin-web
git commit -m "feat(admin): add billing invoice operations"
```

## Task 7: Close slice 2.1

**Files:**
- Create: `docs/operations/smart-billing/ledger-invoice-evidence.md`
- Modify: `docs/prd/academia/MVP-02-smart-billing.md` only after evidence

- [ ] **Step 1: Run complete gate**

Run all root commands, OpenAPI diff, 20-way invoice concurrency and secret scan. Expected: PASS, one invoice per cycle, no provider call.

- [ ] **Step 2: Record requirement evidence**

Map `M2-FR-001`–`M2-FR-004`, mapped BR/NFR and `M2-AC-001` to exact tests, migration and commit.

- [ ] **Step 3: Commit sanitized evidence**

```bash
git add docs/operations/smart-billing/ledger-invoice-evidence.md docs/prd/academia/MVP-02-smart-billing.md packages/contracts/openapi
git commit -m "docs(billing): record ledger and invoice evidence"
```

## 3. Definition of done

- [ ] money never uses float/JSON number;
- [ ] invoice unique/immutable survives concorrência e retry;
- [ ] manual high-value payment has distinct approver and step-up;
- [ ] confirmation updates Membership atomically through its port;
- [ ] ledger/audit are append-only for tenant users;
- [ ] `M2-AC-001` passes and no provider is faked as real.

## 4. Opções de execução

1. **Subagent-Driven (recomendado):** money, schema, invoice, port, manual, UI e evidence separados.
2. **Inline:** sequência completa com commit por task.

Depois, seguir para o núcleo simulado de `2026-08-14-mvp-02-02-pix-webhooks.md`.
