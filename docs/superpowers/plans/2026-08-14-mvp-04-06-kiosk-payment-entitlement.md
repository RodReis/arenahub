# MVP-04.6 — Pagamento e entitlement no kiosk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir pagamento discreto no totem e comprovar que somente a confirmação do backend restaura entitlement, sem desbloqueio local.

**Architecture:** O `kiosk-bff` delega invoice e payment às application services do MVP-02 e aplica uma política de campos para tela pública. PIX e checkout compartilham idempotência com mobile, mas a sessão kiosk permanece curta. `PaymentConfirmed` atualiza entitlement no backend; kiosk apenas observa a projeção e encerra.

**Tech Stack:** NestJS, módulos Billing/Access existentes, Next.js kiosk, hosted checkout homologado, Jest, Vitest, Playwright e sandbox do provider.

---

## Pré-condições

- Slice 4.5 concluída e `M4-PAYMENT-01` aprovado.
- Evento `PaymentConfirmed` e projeção de entitlement do MVP-02 estáveis.
- Feature flag `KIOSK_PAYMENTS=false` fora do piloto.

### Task 1: Criar porta de pagamento e política de privacidade kiosk

**Files:**
- Create: `apps/api/src/modules/kiosk-bff/ports/kiosk-payment.port.ts`
- Create: `apps/api/src/modules/kiosk-bff/infrastructure/kiosk-payment.adapter.ts`
- Create: `apps/api/src/modules/kiosk-bff/domain/kiosk-financial-privacy.ts`
- Create: `apps/api/src/modules/kiosk-bff/domain/kiosk-financial-privacy.spec.ts`
- Create: `apps/api/src/modules/kiosk-bff/infrastructure/kiosk-payment.adapter.spec.ts`

- [ ] **Step 1: Escrever testes de descrição discreta**

```ts
expect(toPublicScreenInvoice(detailedInvoice, { hideAmount: true })).toEqual({ id: detailedInvoice.id, status: 'ACTION_REQUIRED', description: 'Existe uma pendência para revisar' });
expect(JSON.stringify(toPublicScreenInvoice(detailedInvoice, { hideAmount: true }))).not.toContain(detailedInvoice.amountMinor);
```

Teste invoice alheia, tenant, status não pagável, chave idempotente e resposta sem token de provider.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- kiosk-financial-privacy kiosk-payment.adapter`
Expected: FAIL porque domínio e adapter não existem.

- [ ] **Step 3: Implementar porta e policy**

```ts
export interface KioskPaymentPort {
  listPayableInvoices(ctx: KioskStudentContext): Promise<KioskInvoice[]>;
  createPix(ctx: KioskStudentContext, invoiceId: string, idempotencyKey: string): Promise<KioskPaymentAttempt>;
  getAttempt(ctx: KioskStudentContext, attemptId: string): Promise<KioskPaymentAttempt>;
}

export interface KioskInvoice {
  id: string;
  status: 'ACTION_REQUIRED' | 'PROCESSING' | 'PAID';
  description: string;
  amountMinor?: string;
  currency?: string;
}

export interface KioskPaymentAttempt {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
  expiresAt: string | null;
}
```

Adapter usa MVP-02, nunca provider direto. Policy recebe `hideAmount` do tenant/kiosk manifest.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- kiosk-financial-privacy kiosk-payment.adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk-bff
git commit -m "feat(kiosk): add private billing projection"
```

### Task 2: Expor invoices, PIX e tentativas no kiosk

**Files:**
- Create: `apps/api/src/modules/kiosk-bff/kiosk-payments.controller.ts`
- Create: `apps/api/src/modules/kiosk-bff/kiosk-payments.controller.spec.ts`
- Create: `apps/api/src/modules/kiosk-bff/dto/kiosk-payment.dto.ts`
- Modify: `apps/api/src/modules/kiosk-bff/kiosk-bff.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Modify: `packages/api-contracts/src/kiosk.ts`

- [ ] **Step 1: Escrever testes HTTP**

```ts
await request(app).post(`/api/v1/kiosk/invoices/${invoiceId}/pix`).set(deviceCookie).set(sessionCookie).set('Idempotency-Key', 'kiosk-1').expect(202);
await request(app).post(`/api/v1/kiosk/invoices/${invoiceId}/pix`).set(otherDeviceCookie).set(sessionCookie).expect(401);
```

Cubra sessão pendente/expirada, invoice alheia, clique duplo, amount oculto e hosted checkout desabilitado.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- kiosk-payments.controller.spec.ts`
Expected: FAIL porque controller não existe.

- [ ] **Step 3: Implementar endpoints mínimos**

Adicione `GET /session/invoices`, `POST /invoices/:id/pix`, `POST /invoices/:id/checkout` e `GET /payment-attempts/:id`. Todas as rotas exigem cookies de device e sessão correlacionados.

- [ ] **Step 4: Gerar contrato e testar**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS.

Run: `pnpm --filter api test -- kiosk-payments.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk-bff packages/contracts/openapi/openapi.yaml packages/api-contracts/src/kiosk.ts
git commit -m "feat(api): expose kiosk payment endpoints"
```

### Task 3: Construir jornada pendência para PIX

**Files:**
- Create: `apps/kiosk/app/session/payment/page.tsx`
- Create: `apps/kiosk/src/features/payment/kiosk-invoice-list.tsx`
- Create: `apps/kiosk/src/features/payment/kiosk-pix.client.tsx`
- Create: `apps/kiosk/src/features/payment/kiosk-pix.test.tsx`
- Create: `apps/kiosk/src/features/payment/kiosk-payment-machine.ts`
- Create: `apps/kiosk/src/features/payment/kiosk-payment-machine.test.ts`

- [ ] **Step 1: Escrever testes de idempotência e timeout**

```ts
it('does not create another PIX after double tap', async () => {
  await Promise.all([machine.send('START_PIX'), machine.send('START_PIX')]);
  expect(api.createPix).toHaveBeenCalledTimes(1);
});
```

Teste amount oculto, QR expirado, sessão próxima do fim, polling e encerramento após janela de handoff.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter kiosk test -- kiosk-pix kiosk-payment-machine`
Expected: FAIL porque jornada não existe.

- [ ] **Step 3: Implementar PIX e handoff**

Mostre descrição discreta e valor apenas quando policy permitir. QR PIX e copia/cola existem somente em memória; ao expirar ou encerrar sessão, remova payload, DOM e clipboard. Backend continua processando a tentativa.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter kiosk test -- kiosk-pix kiosk-payment-machine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/app/session/payment apps/kiosk/src/features/payment
git commit -m "feat(kiosk): add private pix handoff"
```

### Task 4: Implementar checkout hospedado restrito

**Files:**
- Create: `apps/kiosk/src/features/payment/kiosk-checkout.client.tsx`
- Create: `apps/kiosk/src/features/payment/kiosk-checkout-policy.ts`
- Create: `apps/kiosk/src/features/payment/kiosk-checkout-policy.test.ts`
- Modify: `apps/kiosk/next.config.ts`

- [ ] **Step 1: Escrever testes de allowlist**

```ts
expect(allowCheckoutNavigation('https://checkout.approved.test/s/1')).toBe(true);
expect(allowCheckoutNavigation('https://checkout.approved.test.evil.test/s/1')).toBe(false);
expect(allowCheckoutNavigation('javascript:alert(1)')).toBe(false);
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter kiosk test -- kiosk-checkout-policy`
Expected: FAIL porque policy não existe.

- [ ] **Step 3: Implementar navegação confinada**

Use CSP/frame-src e hosts exatos de `channel-payment.json`; bloqueie popup, download, mixed content, navegação externa e persistência. Return URL muda a tela para “aguardando confirmação”, sem alterar invoice/entitlement.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter kiosk test -- kiosk-checkout-policy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/features/payment apps/kiosk/next.config.ts
git commit -m "feat(kiosk): restrict hosted checkout navigation"
```

### Task 5: Comprovar confirmação e restauração pelo backend

**Files:**
- Create: `apps/api/test/integration/kiosk-payment-entitlement.integration.test.ts`
- Create: `apps/kiosk/e2e/kiosk-payment-entitlement.spec.ts`
- Create: `docs/operations/app-totem/evidence/mvp-04-06-kiosk-payment-entitlement.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md`

- [ ] **Step 1: Escrever integração ponta a ponta**

```ts
expect(await accessDecision(student)).toMatchObject({ outcome: 'DENY' });
await provider.emitPaymentConfirmed(attempt.externalId);
await waitForProjection();
expect(await accessDecision(student)).toMatchObject({ outcome: 'ALLOW', reason: 'ACTIVE_ENTITLEMENT' });
```

Um redirect sem evento mantém `DENY`; evento duplicado mantém um único efeito lógico.

- [ ] **Step 2: Executar integração**

Run: `pnpm --filter api test:integration -- kiosk-payment-entitlement.integration.test.ts`
Expected: PASS para confirmação, duplicata, atraso e redirect sem webhook.

- [ ] **Step 3: Executar E2E no hardware**

Run: `pnpm --filter kiosk test:e2e:hardware -- kiosk-payment-entitlement.spec.ts`
Expected: PASS para sessão curta, PIX/checkout, confirmação backend e limpeza A→B.

- [ ] **Step 4: Registrar evidências**

Mapeie `M4-FR-021`, `M4-BR-001`, `M4-BR-007`, `M4-BR-008`, `M4-NFR-004`, `M4-NFR-006`, `M4-NFR-007`, `M4-AC-005`, `M4-AC-006` e `M4-AC-009`.

- [ ] **Step 5: Atualizar checkboxes comprovados e commit**

```bash
git add apps/api/test/integration/kiosk-payment-entitlement.integration.test.ts apps/kiosk/e2e/kiosk-payment-entitlement.spec.ts docs/operations/app-totem/evidence/mvp-04-06-kiosk-payment-entitlement.md docs/prd/academia/MVP-04-app-totem.md
git commit -m "test(kiosk): prove payment entitlement restoration"
```
