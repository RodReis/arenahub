# MVP-04.3 — Financeiro mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o aluno consulte invoices, inicie PIX ou checkout tokenizado e acompanhe confirmação do backend sem duplicar cobrança lógica ou confiar no retorno visual.

**Architecture:** O BFF mobile expõe uma projeção própria e delega criação/observação às application services do MVP-02 por portas. Cada tentativa usa `Idempotency-Key` e pertence ao aluno autenticado. O app abre somente checkout emitido pelo backend, trata o retorno como navegação e consulta status confirmado separadamente.

**Tech Stack:** NestJS, contratos do MVP-02, Expo Router, React Native WebView somente se homologada, deep links, Jest, Testing Library e runner mobile.

---

## Pré-condições

- Slice 4.1 concluída.
- `M4-PAYMENT-01` aprovado e MVP-02 estável.
- Feature flag `MOBILE_PAYMENTS=false` fora do piloto financeiro.

### Task 1: Criar portas mobile para invoices e pagamentos

**Files:**
- Create: `apps/api/src/modules/student-mobile/ports/student-invoice.port.ts`
- Create: `apps/api/src/modules/student-mobile/ports/student-payment.port.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/invoice.adapter.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/payment.adapter.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/billing-adapters.spec.ts`

- [ ] **Step 1: Escrever testes de fronteira**

```ts
it('uses the authenticated student and preserves the idempotency key', async () => {
  await adapter.createPix(ctx, invoiceId, 'idem-1');
  expect(payments.createPix).toHaveBeenCalledWith({ tenantId: ctx.tenantId, studentId: ctx.studentId, invoiceId, idempotencyKey: 'idem-1' });
});
```

Teste invoice de outro aluno, tenant cruzado, status não pagável, provider indisponível e retorno sem PAN/CVV/token reutilizável.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- billing-adapters.spec.ts`
Expected: FAIL porque portas e adapters não existem.

- [ ] **Step 3: Implementar contratos mínimos**

```ts
export interface StudentPaymentPort {
  createPix(ctx: StudentChannelContext, input: { invoiceId: string; idempotencyKey: string }): Promise<ChannelPaymentAttempt>;
  createHostedCheckout(ctx: StudentChannelContext, input: { invoiceId: string; idempotencyKey: string }): Promise<ChannelPaymentAttempt>;
  getAttempt(ctx: StudentChannelContext, attemptId: string): Promise<ChannelPaymentAttempt>;
}

export interface ChannelPaymentAttempt {
  id: string;
  method: 'PIX' | 'HOSTED_CARD';
  status: 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
  expiresAt: string | null;
  pix: { copyPaste: string; qrPayload: string } | null;
  checkout: { url: string; returnState: string } | null;
}
```

Adapters não confirmam pagamento e não chamam provider diretamente; usam os casos de uso do MVP-02.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- billing-adapters.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-mobile/ports apps/api/src/modules/student-mobile/infrastructure
git commit -m "feat(mobile): add student billing ports"
```

### Task 2: Expor invoices, tentativas e recibos no BFF mobile

**Files:**
- Create: `apps/api/src/modules/student-mobile/mobile-invoices.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-payments.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-billing.controller.spec.ts`
- Create: `apps/api/src/modules/student-mobile/dto/mobile-billing.dto.ts`
- Modify: `apps/api/src/modules/student-mobile/student-mobile.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-billing.ts`

- [ ] **Step 1: Escrever testes HTTP**

```ts
await request(app).post(`/api/v1/mobile/invoices/${invoiceId}/pix`).set(auth).set('Idempotency-Key', 'same-key').expect(202);
await request(app).post(`/api/v1/mobile/invoices/${invoiceId}/pix`).set(auth).set('Idempotency-Key', 'same-key').expect(202).expect(({ body }) => expect(body.attemptId).toBe(firstAttemptId));
```

Cubra chave ausente, invoice alheia, checkout host não homologado, tentativa própria/alheia e recibo inexistente.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-billing.controller.spec.ts`
Expected: FAIL porque os controllers não existem.

- [ ] **Step 3: Implementar endpoints**

Adicione `GET /invoices`, `GET /invoices/:id`, `POST /invoices/:id/pix`, `POST /invoices/:id/checkout`, `GET /payment-attempts/:id` e `GET /receipts`. Valores usam `amountMinor` string e moeda; checkout URL é curta e vinculada à tentativa.

- [ ] **Step 4: Gerar OpenAPI e testar**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS.

Run: `pnpm --filter api test -- mobile-billing.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-mobile packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-billing.ts
git commit -m "feat(api): expose student mobile billing"
```

### Task 3: Construir lista e detalhe de invoices

**Files:**
- Create: `apps/mobile/app/(protected)/billing/index.tsx`
- Create: `apps/mobile/app/(protected)/billing/[invoiceId].tsx`
- Create: `apps/mobile/src/features/billing/invoice-list.tsx`
- Create: `apps/mobile/src/features/billing/invoice-detail.tsx`
- Create: `apps/mobile/src/features/billing/invoices.test.tsx`

- [ ] **Step 1: Escrever testes de estados**

```ts
expect(renderInvoice({ status: 'PAID' })).toHaveTextContent(apiPaidDescription);
expect(renderInvoice({ status: 'OVERDUE' })).not.toHaveTextContent('Acesso bloqueado');
```

Teste vazio, indisponível, paginação, moeda, `asOf`, leitor de tela e invoice sem ação pagável.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- invoices.test.tsx`
Expected: FAIL porque telas e componentes não existem.

- [ ] **Step 3: Implementar renderização fiel**

Use descrições fornecidas pelo backend; o app não deriva atraso, entitlement ou acesso. Formate `amountMinor` apenas para apresentação com moeda da resposta.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter mobile test -- invoices.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(protected\)/billing apps/mobile/src/features/billing
git commit -m "feat(mobile): add invoice history"
```

### Task 4: Implementar PIX idempotente e retomável

**Files:**
- Create: `apps/mobile/src/features/billing/pix-payment.tsx`
- Create: `apps/mobile/src/features/billing/pix-payment.test.tsx`
- Create: `apps/mobile/src/features/billing/payment-attempt-store.ts`
- Create: `apps/mobile/src/features/billing/payment-attempt-store.test.ts`
- Create: `apps/mobile/app/(protected)/billing/payment/[attemptId].tsx`

- [ ] **Step 1: Escrever testes de clique duplo e retomada**

```ts
it('reuses one idempotency key until attempt creation resolves', async () => {
  await Promise.all([startPix(), startPix()]);
  expect(api.createPix).toHaveBeenCalledTimes(1);
});
```

`payment-attempt-store` guarda somente `attemptId` opaco em memória; fechar app exige recuperar a tentativa pela invoice, não por storage persistente.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- pix-payment payment-attempt-store`
Expected: FAIL porque jornada e store não existem.

- [ ] **Step 3: Implementar PIX e polling controlado**

Copiar payload PIX exige ação explícita. Polling usa backoff e respeita `retryAfter`; estado só muda para pago quando API retorna `CONFIRMED`.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter mobile test -- pix-payment payment-attempt-store`
Expected: PASS para clique duplo, background, expiração e webhook atrasado.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/billing apps/mobile/app/\(protected\)/billing/payment
git commit -m "feat(mobile): add idempotent pix journey"
```

### Task 5: Implementar hosted checkout com allowlist

**Files:**
- Create: `apps/mobile/src/features/billing/checkout-navigation-policy.ts`
- Create: `apps/mobile/src/features/billing/checkout-navigation-policy.test.ts`
- Create: `apps/mobile/src/features/billing/hosted-checkout.tsx`
- Create: `apps/mobile/src/features/billing/hosted-checkout.test.tsx`
- Create: `apps/mobile/e2e/mobile-payment.e2e.ts`

- [ ] **Step 1: Escrever testes de navegação hostil**

```ts
expect(policy.allow('https://checkout.approved.test/session/x')).toBe(true);
expect(policy.allow('http://checkout.approved.test/session/x')).toBe(false);
expect(policy.allow('https://approved.test.evil.test/x')).toBe(false);
expect(policy.allow('file:///etc/passwd')).toBe(false);
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- checkout-navigation-policy hosted-checkout`
Expected: FAIL porque policy e checkout não existem.

- [ ] **Step 3: Implementar checkout homologado**

Use hosts exatos de `channel-payment.json`, bloqueie mixed content, popup, download e navegação externa. Retorno permitido fecha a tela e abre status `PROCESSING`; nunca marca `CONFIRMED`.

- [ ] **Step 4: Executar unitários e E2E**

Run: `pnpm --filter mobile test -- checkout-navigation-policy hosted-checkout`
Expected: PASS.

Run: `pnpm --filter mobile test:e2e -- mobile-payment.e2e.ts`
Expected: PASS para PIX, cartão hospedado, fechamento do app, redirect adulterado e webhook ausente.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/billing apps/mobile/e2e/mobile-payment.e2e.ts
git commit -m "feat(mobile): add restricted hosted checkout"
```

### Task 6: Fechar segurança e evidências do financeiro mobile

**Files:**
- Create: `apps/api/test/security/mobile-billing-authorization.e2e-spec.ts`
- Create: `docs/operations/app-totem/evidence/mvp-04-03-mobile-billing.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md`

- [ ] **Step 1: Executar abuso e idempotência**

Run: `pnpm --filter api test:e2e -- mobile-billing-authorization`
Expected: PASS para invoice/tentativa/recibo alheios, chave repetida e sessão revogada.

- [ ] **Step 2: Executar regressão de provider**

Run: `pnpm --filter api test:integration -- mobile-billing payment-webhooks`
Expected: PASS para webhook duplicado/atrasado/ausente e retorno visual sem confirmação.

- [ ] **Step 3: Executar E2E mobile**

Run: `pnpm --filter mobile test:e2e -- mobile-payment.e2e.ts`
Expected: PASS nos devices aprovados.

- [ ] **Step 4: Registrar evidências**

Mapeie `M4-FR-009`–`M4-FR-011`, `M4-BR-001`, `M4-BR-008`, `M4-NFR-001`, `M4-NFR-002`, `M4-NFR-006`, `M4-NFR-007`, `M4-AC-004`, `M4-AC-005` e `M4-AC-006`.

- [ ] **Step 5: Atualizar checkboxes comprovados e commit**

```bash
git add apps/api/test/security/mobile-billing-authorization.e2e-spec.ts docs/operations/app-totem/evidence/mvp-04-03-mobile-billing.md docs/prd/academia/MVP-04-app-totem.md
git commit -m "docs(mobile): record billing journey evidence"
```
