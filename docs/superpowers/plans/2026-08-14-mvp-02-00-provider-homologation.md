# MVP 02 Payment Provider Homologation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecionar e comprovar um único provedor capaz de operar PIX, cartão tokenizado, recorrência, webhooks, refunds e conciliação para o CNPJ do cliente inaugural.

**Architecture:** A homologação é um gate de evidência, não uma escolha por familiaridade. Critérios eliminatórios são avaliados antes do score ponderado. Testes usam sandbox/valores mínimos e documentação oficial. A saída é um ADR, um manifest de capacidades validado e um plano complementar com os endpoints, SDK e assinaturas reais do provedor escolhido.

**Tech Stack:** documentação/API oficial dos candidatos, sandbox do provedor, PowerShell/cURL sem segredos em linha de comando, JSON Schema, ArenaHub `PaymentProvider` e writing-plans para o adapter final.

---

## 1. Regras do gate

- não selecionar por taxa anunciada sem proposta aplicável ao CNPJ/volume;
- não aceitar captura de PAN/CVV pelo ArenaHub;
- não marcar capacidade com base somente em página comercial;
- não commitar credenciais, raw webhooks reais, dados de pagador ou proposta confidencial;
- cada `PASS` cita documento oficial, data de consulta e evidência sandbox;
- qualquer requisito eliminatório ausente resulta em `REJECTED`, independentemente do score.

## Task 1: Freeze business, compliance and operational requirements

**Files:**
- Create: `docs/operations/smart-billing/provider-requirements.md`
- Create: `docs/operations/smart-billing/provider-evidence/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create the requirements document with owners**

Record legal entity/CNPJ, settlement account ownership, estimated monthly transactions/value, average ticket, desired due/expiry rules, refund authority, support hours and rollout dates. Mark commercial numbers confidential and keep them outside Git; the committed document contains ranges and evidence references only.

- [ ] **Step 2: Record hard compliance boundaries**

Require hosted fields/checkout or provider component that prevents PAN/CVV from reaching ArenaHub, DPA/LGPD terms, PCI responsibility matrix, retention/export/deletion process, incident contact and credential rotation.

- [ ] **Step 3: Record mandatory capabilities**

The pass list is exact: dynamic PIX with expiry/status query, tokenized card, recurring charge/subscription, signed replayable webhooks, idempotency keys, cancellation, full/partial refund or explicit full-only constraint accepted by Produto, movement/settlement listing, sandbox, BRL/CNPJ receiver and production support.

- [ ] **Step 4: Protect evidence paths**

Ignore `docs/operations/smart-billing/provider-evidence/private/`, `.env.provider*`, exported statements, webhook bodies and proposals. Commit only sanitized hashes, timestamps, provider request IDs and screenshots with PII removed.

- [ ] **Step 5: Review and commit**

Financeiro, Técnico and Legal/Privacy approve the requirements before candidate testing.

```bash
git add .gitignore docs/operations/smart-billing/provider-requirements.md docs/operations/smart-billing/provider-evidence/.gitkeep
git commit -m "docs(billing): define payment provider requirements"
```

## Task 2: Build and apply the candidate scorecard

**Files:**
- Create: `docs/operations/smart-billing/payment-provider-scorecard.md`
- Create: `docs/operations/smart-billing/provider-evidence/sanitized-candidates.md`

- [ ] **Step 1: Identify at least two viable candidates**

Use current official documentation and proposals. If fewer than two accept the CNPJ/use case, record contacted alternatives, date, rejection reason and evidence; do not fabricate a comparison row.

- [ ] **Step 2: Apply eliminatory checks first**

For each candidate mark `PASS`, `FAIL` or `UNPROVEN` for every mandatory capability. `UNPROVEN` behaves as failure until sandbox/proposal evidence exists. A candidate lacking PIX, hosted tokenization or recurrence cannot be the sole adapter.

- [ ] **Step 3: Score only surviving candidates**

Use this fixed 100-point weighting:

| Criterion | Weight |
|---|---:|
| API, SDK, sandbox and documentation | 20 |
| webhook signature, replay and idempotency | 15 |
| PIX/card/recurrence lifecycle completeness | 20 |
| reconciliation and settlement evidence | 15 |
| LGPD/PCI/security controls | 10 |
| fees, settlement time and contractual fit | 10 |
| SLA, incident response and support | 10 |

Each score includes rationale and source. Missing evidence scores zero.

- [ ] **Step 4: Record architecture constraints**

Capture API base/version, auth model, SDK/runtime, webhook signature algorithm/raw-body needs, event IDs/order guarantees, idempotency header semantics, rate limits, timeout/retry guidance, sandbox differences, account routing and movement pagination.

- [ ] **Step 5: Review and commit sanitized scorecard**

```bash
git add docs/operations/smart-billing/payment-provider-scorecard.md docs/operations/smart-billing/provider-evidence/sanitized-candidates.md
git commit -m "docs(billing): compare payment provider candidates"
```

## Task 3: Prove mandatory lifecycles in sandbox

**Files:**
- Create: `docs/operations/smart-billing/provider-sandbox-test-plan.md`
- Create: `docs/operations/smart-billing/provider-evidence/sandbox-summary.md`

- [ ] **Step 1: Define the sanitized evidence envelope**

Every trial records provider, sandbox account alias, capability, request correlation, external ID suffix, request/response timestamps, HTTP status, webhook event type/ID suffix, result and private evidence SHA-256. It excludes credentials, tokens, QR payload, card data, payer PII and raw body.

- [ ] **Step 2: Execute PIX lifecycle**

Create charge with minimum sandbox value, verify value/expiry/identifier, receive signed webhook, request replay, query status, expire/cancel where supported and confirm movement listing. Record whether repeated idempotency key returns the same resource.

- [ ] **Step 3: Execute hosted card/recurrence lifecycle**

Use only provider test cards in its hosted UI/component. Prove ArenaHub-facing request contains no PAN/CVV; capture tokenized reference metadata, success, decline, requires-action if applicable, next attempt, recurring cancellation and webhook replay.

- [ ] **Step 4: Execute refund and reconciliation lifecycle**

Refund a confirmed sandbox payment, observe intermediate/final states, list corresponding external movement and match amount/currency/reference. If partial refund is unsupported, record full-only as an explicit product constraint requiring approval.

- [ ] **Step 5: Run security/operability negatives**

Test invalid signature, changed raw body, stale/replayed delivery, unknown event type, rate limit response, provider timeout and credential rotation procedure. No destructive production call is allowed.

## Task 4: Approve the provider and capability manifest

**Files:**
- Create: `docs/adr/0005-payment-provider.md`
- Create: `docs/operations/smart-billing/payment-provider-capabilities.schema.json`
- Create: `docs/operations/smart-billing/payment-provider-capabilities.json`

- [ ] **Step 1: Create a strict capability schema**

Require provider code/API version, auth/signature/idempotency models, PIX/card/recurrence/refund/reconciliation booleans, webhook max body/replay window, rate limits, timeout guidance, sandbox/production differences, account routing, supported currency/country and evidence links. `additionalProperties` is false.

- [ ] **Step 2: Validate the selected manifest**

Every mandatory boolean is true except a documented partial-refund constraint explicitly approved. Evidence paths must exist. No endpoint URL may contain account IDs or secrets.

- [ ] **Step 3: Write the ADR**

Record candidates, eliminations, weighted result, commercial/security constraints, accepted risks, why a second adapter is out of scope, rollback before production enablement and approver names/roles/dates.

- [ ] **Step 4: Obtain four approvals**

Produto, Financeiro, Técnico and Legal/Privacy sign. Missing approval keeps status `PROPOSED` and `M2-PROVIDER-01` blocked.

- [ ] **Step 5: Commit only approved sanitized artifacts**

```bash
git add docs/adr/0005-payment-provider.md docs/operations/smart-billing/payment-provider-capabilities.schema.json docs/operations/smart-billing/payment-provider-capabilities.json
git commit -m "docs(billing): approve payment provider capability gate"
```

## Task 5: Generate the provider-specific adapter plan

**Files:**
- Read: approved ADR, manifest, official provider docs/SDK and sanitized sandbox summary
- Create: `docs/superpowers/plans/2026-08-14-mvp-02-provider-adapter.md`

- [ ] **Step 1: Resolve current official SDK/API documentation**

Use Context7 when the SDK exists there; otherwise use only the provider's versioned official API reference. Record exact API/SDK version and release date in the new plan.

- [ ] **Step 2: Map real operations to `PaymentProvider`**

For every interface method identify exact endpoint/SDK symbol, request fields, idempotency header, timeout, response mapping, error codes and retry rule. Unknown fields remain a gate failure; do not infer.

- [ ] **Step 3: Map webhook and account routing**

Name the exact signature headers/algorithm, raw-body verification call, replay timestamp semantics, external event/account IDs, ordering guarantees and tenant resolution. Include golden fixtures generated by official tooling or sandbox with secrets removed.

- [ ] **Step 4: Write TDD tasks for the real adapter**

The plan creates exact adapter files, contract tests against the fake provider interface, sandbox tests for PIX/card/refund/movements, credential rotation, rate-limit/backoff, secret redaction and feature-flag rollout. Each code step includes complete provider-specific types/calls.

- [ ] **Step 5: Validate `M2-PROVIDER-01`**

Gate passes only when ADR is approved, manifest validates, sandbox mandatory flows pass and the adapter-specific plan has no placeholder. Record the plan path in the Smart Billing index.

## 2. Definition of done

- [ ] no mandatory capability is `UNPROVEN`;
- [ ] sandbox covers PIX, hosted card, recurrence, webhook replay, refund and movements;
- [ ] commercial/CNPJ/settlement constraints are accepted;
- [ ] PCI/LGPD responsibility and retention are recorded;
- [ ] ADR has four approvals;
- [ ] capability manifest validates;
- [ ] adapter-specific implementation plan names real symbols and versions;
- [ ] secrets/private evidence remain ignored.

## 3. Opções de execução

1. **Subagent-Driven (recomendado):** pesquisa técnica, comercial/compliance e sandbox como tarefas separadas, com aprovação humana no ADR.
2. **Inline:** executar sequencialmente e parar quando faltar credencial, proposta ou aprovação.

Este plano não pode autoaprovar contrato comercial nem movimentar produção.
