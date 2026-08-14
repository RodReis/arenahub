# MVP 02.3 Tokenized Card and Recurring Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular cartão por checkout/componente hospedado, criar recorrência tokenizada e representar sucesso, falha, próxima tentativa e cancelamento sem PAN/CVV no ArenaHub.

**Architecture:** A API cria uma sessão curta de checkout; somente um Client Component isolado carrega o SDK/domínio homologado. O retorno visual registra intenção, nunca confirmação. Referência tokenizada e assinatura externa são cifradas. Webhooks/consulta ativa reutilizam a inbox e a máquina de observação da slice 2.2. A agenda de retry do provedor é representada, não duplicada por um scheduler ArenaHub.

**Tech Stack:** NestJS/Prisma, provider adapter homologado, Node AES-256-GCM, Next.js App Router com Client Component mínimo, CSP estrita, Playwright e secret/PCI fixture scans.

---

## 1. Pré-condições

- [ ] Slice 2.2 concluída com adapter real;
- [ ] `M2-PROVIDER-01` e `M2-COMPLIANCE-01` aprovados;
- [ ] manifest contém hosted checkout/component domains, callback/origin e recorrência;
- [ ] `BILLING_CARD` desligada;
- [ ] provider-specific plan contém símbolos reais do frontend/backend.

## Task 1: Add encrypted payment method and recurring schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migration `*_card_recurring`
- Create: `apps/api/src/modules/recurring-billing/domain/*`
- Test: `apps/api/test/integration/payment-method-schema.integration.test.ts`

- [ ] **Step 1: Write schema/privacy tests**

Assert no field named/containing PAN, CVV, cardNumber or magnetic data; provider reference ciphertext differs for same plaintext; last4 exactly four digits; one default active method; provider subscription unique; attempts ordered and tenant isolated.

- [ ] **Step 2: Add models**

`PaymentMethod` stores tenant/student/provider account, encrypted provider reference envelope, fingerprint hash if provider permits, brand/last4/expiry, status/default and timestamps. `ProviderSubscription` stores internal subscription, external ref encrypted/hash, state, next charge/attempt and cancel metadata. Existing `PaymentAttempt` gains external attempt ID/hash and action URL metadata with short retention.

- [ ] **Step 3: Implement envelope crypto port**

AES-256-GCM uses random IV and versioned key ID from secret manager; associated data is `{tenantId}:{recordType}:{recordId}`. Persist ciphertext/IV/tag/keyId, never plaintext. Support decrypt current/previous key for rotation and rewrite through an audited worker.

- [ ] **Step 4: Add DB and repository restrictions**

Repositories return masked DTO by default; decrypt methods are package-private to provider application service. Audit/export paths cannot select ciphertext. Application logs redact keys matching token/reference/client secret patterns.

- [ ] **Step 5: Verify and commit**

Run migration, cross-tenant and schema name scan. Commit:

```bash
git add packages/database apps/api/src/modules/recurring-billing apps/api/test
git commit -m "feat(billing): add encrypted tokenized payment methods"
```

## Task 2: Create hosted checkout sessions safely

**Files:**
- Create: `apps/api/src/modules/recurring-billing/application/create-checkout-session.use-case.ts`
- Create: `apps/api/src/modules/recurring-billing/transport/checkout.controller.ts`
- Extend: `apps/payment-provider-simulator/src/checkout.ts`
- Test: `apps/api/test/integration/checkout-session.integration.test.ts`

- [ ] **Step 1: Write session abuse tests**

Cover authenticated student/finance actor, wrong tenant/student, changed return URL, repeated key, expired session, simulator callback success/cancel, callback tamper and confirmation absent. API request schema must reject PAN/CVV/card-like fields via whitelist.

- [ ] **Step 2: Implement server-side session creation**

Validate allowed origin/return path server-side; never accept arbitrary URL. Create short-lived provider session for internal student/subscription, store only session ID hash/expiry/idempotency and return public session token or hosted URL exactly as adapter contract allows.

- [ ] **Step 3: Treat browser return as nonauthoritative**

Return route displays `PROCESSING` and queries internal status. It may mark checkout session returned/cancelled for UX but cannot activate payment method, subscription, invoice or entitlement. Only verified provider observation does.

- [ ] **Step 4: Add simulator hosted page**

Simulator serves a distinct origin with test-only form, posts no card data to ArenaHub and emits tokenized-method/recurring events. Playwright network capture asserts ArenaHub domains never receive simulated PAN/CVV fields.

- [ ] **Step 5: Verify and commit**

```bash
git add apps/api/src/modules/recurring-billing apps/payment-provider-simulator apps/api/test packages/contracts/openapi
git commit -m "feat(billing): create hosted checkout sessions"
```

## Task 3: Create and cancel tokenized recurrence

**Files:**
- Create: `apps/api/src/modules/recurring-billing/application/{activate,cancel}-provider-subscription.use-case.ts`
- Create: `apps/api/src/modules/recurring-billing/provider-recurring-event.mapper.ts`
- Test: `apps/api/test/integration/recurring-subscription.integration.test.ts`

- [ ] **Step 1: Write lifecycle/idempotency tests**

Tokenized method ready→create recurring subscription; duplicate callback/create; success attempt; failed attempt with next date; requires action; provider cancellation; local cancellation racing success; unknown method; provider timeout and query recovery.

- [ ] **Step 2: Create recurrence only from verified method event**

After provider confirms tokenized method, persist encrypted reference, then call `createTokenizedSubscription` with deterministic key and plan/amount/billing anchor snapshot. Provider external subscription is recorded before state ACTIVE. Ambiguous result is queried/reconciled, not recreated.

- [ ] **Step 3: Normalize attempts through webhook pipeline**

Map provider attempt to `CREATED`, `REQUIRES_ACTION`, `PROCESSING`, `SUCCEEDED` or `FAILED`, with immutable attempt rows. Resolve the target invoice by verified provider subscription plus provider billing period; create it through the idempotent invoice generator if the period is not yet materialized. Amount/currency must equal the invoice snapshot or the event is quarantined for reconciliation. `SUCCEEDED` creates/observes Payment and invokes common confirmation; `FAILED` records stable reason/next attempt and never blocks before delinquency policy.

- [ ] **Step 4: Cancel idempotently**

Local request records desired cancellation and provider operation. Verified provider cancellation makes recurring state terminal and calls Membership cancellation policy only through its service; it does not delete method/payment history. Duplicate cancel is success.

- [ ] **Step 5: Verify and commit**

Kill worker around provider call/result persistence and prove one external subscription logically. Commit:

```bash
git add apps/api/src/modules/recurring-billing apps/api/test packages/contracts
git commit -m "feat(billing): manage tokenized recurring charges"
```

## Task 4: Build the provider-isolated card UI

**Files:**
- Create: `apps/admin-web/app/(protected)/billing/payment-methods/*`
- Create: `apps/admin-web/components/billing/provider-checkout-boundary.tsx`
- Modify: `apps/admin-web/next.config.ts`
- Test: `apps/admin-web/tests/e2e/card-recurring.spec.ts`

- [ ] **Step 1: Write network/CSP E2E first**

Network recorder fails if PAN/CVV-like form data reaches admin-web/API hosts. Test session expiry, cancel, success-processing, verified method, recurrence success/failure/next attempt and cancellation. Unknown external origin must be blocked by CSP.

- [ ] **Step 2: Keep provider code in one Client Component**

Server Component fetches masked methods/attempts. Client boundary receives only public session config and loads exact provider SDK/hosted redirect from the approved adapter plan. It never receives API/webhook secret or persisted provider reference.

- [ ] **Step 3: Generate strict CSP from manifest**

Allow `script-src`, `frame-src`, `connect-src` and `img-src` only for self plus exact approved provider domains/nonces. Do not add wildcard. Sandbox and production manifests are environment-specific and validated at startup.

- [ ] **Step 4: Present states without false success**

Callback displays `Aguardando confirmação`; method shows brand/last4/expiry after verified webhook only. Attempt failure shows stable user-safe action and next attempt, not provider raw error.

- [ ] **Step 5: Verify and commit**

Run Playwright with simulator and provider sandbox per adapter plan, axe, lint/typecheck/build. Commit:

```bash
git add apps/admin-web
git commit -m "feat(admin): add hosted card and recurrence UI"
```

## Task 5: Execute real provider card/recurrence acceptance

**Files:**
- Execute: card/recurrence tasks in approved provider-specific plan
- Create: `docs/operations/smart-billing/card-recurring-evidence.md`
- Modify: `docs/prd/academia/MVP-02-smart-billing.md` after evidence

- [ ] **Step 1: Revalidate gate and domains**

Confirm API/SDK versions, sandbox keys, hosted domains, test-card procedure and recurrence semantics still match approved manifest. Drift blocks execution until ADR/plan update.

- [ ] **Step 2: Run hosted tokenization acceptance**

Use provider test card only. Capture sanitized network evidence proving ArenaHub gets no PAN/CVV and receives verified tokenized method metadata.

- [ ] **Step 3: Run recurrence matrix**

Success, decline, requires-action if supported, next attempt, duplicate/out-of-order webhook and cancel. Each maps to one internal attempt/payment transition.

- [ ] **Step 4: Scan all artifacts**

Scan Git diff, test output, logs, database fixtures and screenshots for PAN/CVV, provider test token, API key and webhook secret. Any hit blocks commit until removed/rotated.

- [ ] **Step 5: Commit sanitized evidence**

Map `M2-FR-011/012`, relevant BR/NFR and `M2-AC-011`.

```bash
git add docs/operations/smart-billing/card-recurring-evidence.md docs/prd/academia/MVP-02-smart-billing.md packages/contracts/openapi
git commit -m "docs(billing): record hosted card recurrence evidence"
```

## 2. Definition of done

- [ ] no ArenaHub request/schema/log/fixture contains PAN/CVV;
- [ ] tokenized references are encrypted and masked by default;
- [ ] visual callback has no financial effect;
- [ ] attempts and next retry reflect provider observations once;
- [ ] cancellation is idempotent and history-preserving;
- [ ] CSP contains no wildcard/provider domain não aprovado;
- [ ] simulator and real sandbox contract pass.

## 3. Opções de execução

1. **Subagent-Driven (recomendado):** schema/crypto, checkout, recurrence, UI e acceptance separados.
2. **Inline:** sequência única, com pausa antes do sandbox real se manifest/credencial divergir.

Depois, seguir para `2026-08-14-mvp-02-04-delinquency-access.md`.
