# MVP 02.2 PIX and Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar cobrança PIX, autenticar/persistir webhooks e convergir webhook/consulta ativa em uma única confirmação lógica que ativa entitlement dentro do SLO.

**Architecture:** Um simulator HTTP implementa o contrato interno antes do adapter real. `PaymentProvider` cria/query PIX com idempotência. Webhook preserva raw body, resolve conta/tenant por endpoint configurado, verifica assinatura e grava inbox privada antes do ACK. Worker normaliza eventos e chama a mesma máquina de estado usada pela consulta ativa. O provider adapter real permanece atrás de `M2-PROVIDER-01`.

**Tech Stack:** NestJS 11 raw body, Prisma/PostgreSQL Serializable, BullMQ/Redis, Node crypto, private object storage, provider simulator TypeScript, Next.js e Playwright.

---

## 1. Pré-condições

- [ ] Slice 2.1 concluída;
- [ ] `FakePaymentProvider` é sempre identificado como simulador;
- [ ] Task 1–5 podem rodar sem provedor; Task 6 exige `M2-PROVIDER-01`;
- [ ] retenção de raw webhook e endpoint size/replay window aprovados antes de sandbox real;
- [ ] `BILLING_PIX` desligada por padrão.

## Task 1: Freeze provider contracts and build the simulator

**Files:**
- Create: `apps/api/src/modules/payment-provider/{payment-provider.port,provider-errors}.ts`
- Create: `packages/contracts/src/billing/provider.ts`
- Create: `apps/payment-provider-simulator/package.json`, `src/{server,state,signing}.ts`
- Test: `apps/api/test/contract/payment-provider.contract.test.ts`

- [ ] **Step 1: Write contract tests against a missing fake**

Test deterministic create PIX, identical idempotency retry, conflicting retry, pending→confirmed/expired, status query, webhook valid/tampered/replayed/out-of-order, provider unavailable/rate-limited and redacted errors.

- [ ] **Step 2: Define complete provider-neutral PIX types**

`CreatePixInput` contains internal payment ID, BRL amount minor string, expiry instant, payer reference minimized and idempotency key. `PixCharge` returns external payment ID, status, expiry, copy-paste payload as a sensitive value, optional short-lived provider QR image URL and provider request ID. No tenant is inferred from provider response.

- [ ] **Step 3: Implement stable error translation**

```ts
export class PaymentProviderError extends Error {
  constructor(
    readonly code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED' | 'PROVIDER_AUTH_FAILED' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_PROTOCOL_ERROR',
    readonly retryable: boolean,
    readonly providerRequestId?: string,
  ) { super(code); }
}
```

Messages/cause are logged only after redaction; API returns internal code/correlation.

- [ ] **Step 4: Implement a deterministic simulator**

Simulator persists in memory/test file, uses HMAC fixture key, exposes create/query/confirm/expire and delivery control endpoints, and can send N duplicates, delayed/out-of-order/invalid signatures. It rejects same idempotency key with changed hash.

- [ ] **Step 5: Verify and commit**

Run provider contract suite against simulator. Commit:

```bash
git add apps/payment-provider-simulator apps/api/src/modules/payment-provider apps/api/test/contract packages/contracts package.json pnpm-lock.yaml
git commit -m "test(billing): add payment provider contract simulator"
```

## Task 2: Create PIX charges idempotently

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_pix_provider_accounts`
- Create: `apps/api/src/modules/payments/pix/*`
- Test: `apps/api/test/integration/pix-payment.integration.test.ts`

- [ ] **Step 1: Write creation/crash tests**

Cover provider account create/rotate/disable with step-up, secret never returned, OPEN invoice, exact total, feature flag, same key retry, changed hash conflict, crash before call, provider success then API timeout, crash after response, provider permanent/retryable failure, cross-tenant invoice and expired charge.

- [ ] **Step 2: Add provider account and operation models**

`PaymentProviderAccount` stores tenant, provider code, opaque endpoint key hash, encrypted credential references, status/config version and rotation metadata. `ProviderOperation` stores internal idempotency/body hash, operation, state, external ID/request ID, attempts and response snapshot sanitized. `Payment` stores encrypted PIX payload/reference and expiry; no QR payload enters logs/events.

- [ ] **Step 3: Implement create-before-call protocol**

In transaction create PENDING Payment/Attempt/ProviderOperation and `PaymentCreated`. Worker claims operation, calls provider with stored deterministic key, then transactionally records external ID/status/payload. Ambiguous timeout schedules `getPaymentStatus`; it never creates a second charge with a new key.

- [ ] **Step 4: Expose API safely**

Add `GET/PUT /api/v1/billing/provider-account` and rotate/disable commands requiring `billing.configure`, recent MFA and audit. Write-only credential fields are encrypted/secret-managed and never returned; responses expose provider code, account alias suffix, status, config version and webhook endpoint status. Real provider code is rejected before the gate; simulator is allowed only outside production. `POST /api/v1/invoices/:id/payments/pix` requires permission/CSRF/idempotency and returns payment ID/status/amount/expiry plus sensitive PIX presentation only to authorized actor over no-store response. `GET /api/v1/payments/:id/status` masks provider refs.

- [ ] **Step 5: Verify and commit**

Assert provider create call count is one through crash/retry fixtures. Commit:

```bash
git add packages/database apps/api/src/modules/payments/pix apps/api/test packages/contracts/openapi
git commit -m "feat(billing): create idempotent PIX charges"
```

## Task 3: Persist authenticated raw webhooks before ACK

**Files:**
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/src/modules/payment-webhooks/{webhook.controller,webhook-inbox.service,webhook-retention.service}.ts`
- Test: `apps/api/test/integration/payment-webhook-ingress.integration.test.ts`

- [ ] **Step 1: Write ingress security tests**

Test valid signature, tampered byte, invalid/stale signature, unknown endpoint/provider, >256 KiB, burst above configured rate, duplicate external event, same ID/different hash, tenant in payload mismatch, storage failure and Redis unavailable. Invalid requests create no business transition.

- [ ] **Step 2: Enable raw body with bounded parsing**

Bootstrap exactly:

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  rawBody: true,
});
```

Set JSON/raw limit so webhook route rejects above 256 KiB before persistence; other API limits remain at their approved smaller defaults. Controller receives `RawBodyRequest<Request>` and passes untouched `Buffer` plus allowlisted headers to adapter verification.

- [ ] **Step 3: Resolve account without trusting payload tenant**

Use `POST /api/v1/webhooks/payments/:provider/:endpointKey`. Store only endpoint key hash; resolve candidate account, verify signature with its secret, then bind tenant/account from configuration. Provider-specific alternative routing requires the approved adapter plan and equivalent verified account binding.

- [ ] **Step 4: Persist durable inbox and private raw evidence**

Apply a coarse gateway/IP+endpoint rate limit sized above the measured provider retry burst; provider IP allowlist, when officially documented, is defense in depth and never replaces signature. After verification, write encrypted/private raw body object, hash, allowlisted headers, external event/type/account/timestamps and `ProviderEventInbox` unique key in one durable flow. ACK 2xx only after DB/object evidence is consistent and outbox/queue marker exists. Redis failure does not lose the inbox; dispatcher retries later.

- [ ] **Step 5: Verify and commit**

Expected: ten valid deliveries yield one inbox row; invalid signatures yield safe metric/code and no raw body retained beyond security policy. Commit:

```bash
git add apps/api/src/main.ts apps/api/src/modules/payment-webhooks apps/api/test packages/database packages/contracts/openapi
git commit -m "feat(billing): persist verified payment webhooks"
```

## Task 4: Normalize events and converge webhook with active polling

**Files:**
- Create: `apps/api/src/modules/payment-webhooks/provider-event.processor.ts`
- Create: `apps/api/src/modules/payments/application/observe-provider-payment.use-case.ts`
- Create: `apps/api/src/workers/{provider-event,payment-status-poll}.processor.ts`
- Test: `apps/api/test/integration/provider-payment-ordering.integration.test.ts`

- [ ] **Step 1: Write the full ordering matrix**

Cover PENDING→PROCESSING→CONFIRMED, FAILED before/after CONFIRMED, duplicate CONFIRMED, delayed PENDING after terminal, query CONFIRMED racing webhook FAILED/CONFIRMED, unknown event and worker crash after inbox claim. Confirmed never regresses.

- [ ] **Step 2: Freeze normalized observation**

```ts
export interface ProviderPaymentObservation {
  providerAccountId: string;
  externalPaymentId: string;
  externalEventId: string;
  status: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  amountMinor: string;
  currency: 'BRL';
  effectiveAt: string;
  observedAt: string;
  source: 'WEBHOOK' | 'ACTIVE_QUERY';
}
```

Adapter is responsible for authenticated mapping; unsupported type becomes quarantined inbox without fabricated status.

- [ ] **Step 3: Implement one serializable observer**

Lock provider account/payment, validate amount/currency/external ID, record observation, apply explicit state transition and call `confirmPayment` only once. Insert inbox receipt/audit/outbox in same transaction. Retry P2034 at most three times.

- [ ] **Step 4: Implement active query triggers**

Poll when create result is ambiguous, webhook age exceeds approved threshold or operator requests safe refresh. BullMQ key is payment ID+expected observation version. Query response enters the same observer with a deterministic synthetic event ID; racing sources converge by terminal precedence.

- [ ] **Step 5: Verify and commit**

Kill workers at transaction boundaries and rerun. Expected: one payment movement, one Membership activation and one entitlement event. Commit:

```bash
git add apps/api/src/modules/payment-webhooks apps/api/src/modules/payments/application apps/api/src/workers apps/api/test
git commit -m "feat(billing): converge provider payment observations"
```

## Task 5: Build PIX UI, SLO metrics and simulator E2E

**Files:**
- Create: `apps/admin-web/app/(protected)/billing/invoices/[id]/pix/*`
- Create: `apps/admin-web/tests/e2e/pix-payment.spec.ts`
- Create: `apps/api/test/load/payment-webhooks.mjs`
- Create: `docs/operations/smart-billing/pix-webhook-simulator-evidence.md`

- [ ] **Step 1: Write the failing E2E**

Owner configures/rotates the simulator account and sees only masked status. Finance creates PIX, displays exact BRL/expiry/identifier/copy code, simulator confirms and sends ten duplicates, invoice becomes PAID, entitlement ACTIVE and Edge sync change appears once. Invalid webhook shows safe alert and no state change.

- [ ] **Step 2: Implement minimal secure presentation**

Server Action creates charge. A Client Component handles copy and provider QR image/adapter presentation only; it receives no provider secret and does not persist payload in localStorage/analytics. Response/page uses no-store and hides payload after expiry/confirmation.

- [ ] **Step 3: Add webhook operational metrics**

Measure ingress accepted/rejected, inbox age, processing latency, duplicate/out-of-order/quarantine, poll count, DLQ and `webhookPersistedAt→entitlementActivatedAt`. Labels are bounded; no tenant/payment/event IDs.

- [ ] **Step 4: Run load/recovery**

Generate approved 10× peak with duplicates/out-of-order, stop workers, accumulate backlog, restart and drain. API invoice reads stay available. Record p50/p95/p99 and prove p95 <30 s at target or block release.

- [ ] **Step 5: Commit simulator evidence**

```bash
git add apps/admin-web apps/api/test/load docs/operations/smart-billing/pix-webhook-simulator-evidence.md
git commit -m "test(billing): prove PIX webhook pipeline with simulator"
```

## Task 6: Implement and prove the homologated PIX adapter

**Files:**
- Read/execute: approved `docs/superpowers/plans/2026-08-14-mvp-02-provider-adapter.md`
- Create according to that plan: `apps/api/src/modules/payment-provider/homologated/*`
- Create: `docs/operations/smart-billing/pix-webhook-provider-evidence.md`
- Modify: `docs/prd/academia/MVP-02-smart-billing.md` only after evidence

- [ ] **Step 1: Validate provider gate**

ADR approved, manifest valid, credentials injected, exact adapter plan present. If any fail, stop at simulator-ready.

- [ ] **Step 2: Execute the provider-specific TDD plan**

Do not replace symbols/endpoints from that plan with guesses. Contract suite must pass unchanged against fake and real adapter mapping tests.

- [ ] **Step 3: Run sandbox and minimum-value homologation**

Prove create/query/expiry, valid/invalid signature, re-delivery, ten duplicates, delayed event, active-query race, account→tenant resolution and credential rotation.

- [ ] **Step 4: Run end-to-end SLO**

Provider confirmation→durable webhook→payment/invoice→Membership/entitlement→Edge sync, with timestamps and p95 report. No raw sensitive artifact is committed.

- [ ] **Step 5: Record and commit evidence**

Map `M2-FR-005`–`010`, relevant BR/NFR and `M2-AC-002`–`006/011`.

```bash
git add docs/operations/smart-billing/pix-webhook-provider-evidence.md docs/prd/academia/MVP-02-smart-billing.md packages/contracts/openapi
git commit -m "docs(billing): record homologated PIX evidence"
```

## 2. Definition of done

- [ ] PIX create is idempotent through ambiguous failures;
- [ ] invalid/tampered webhook has zero business effect;
- [ ] ACK occurs only after durable verified inbox;
- [ ] duplicate/out-of-order/poll races converge once;
- [ ] entitlement/Edge update comes only from confirmed payment;
- [ ] SLO <30 s passes at target load;
- [ ] real acceptance remains blocked until provider plan/sandbox pass;
- [ ] no PAN/CVV/token/secret/raw sensitive payload in evidence.

## 3. Opções de execução

1. **Subagent-Driven (recomendado):** simulator, PIX, ingress, ordering, UI/load e adapter real separados.
2. **Inline:** executar Tasks 1–5 e pausar no provider gate antes da Task 6.

Depois do adapter real, seguir para `2026-08-14-mvp-02-03-card-recurring.md`.
