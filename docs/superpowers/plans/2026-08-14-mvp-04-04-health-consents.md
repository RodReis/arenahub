# MVP-04.4 — Saúde e consentimentos mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir ao aluno consultar avaliações publicadas e análises aprovadas, gerir consentimentos permitidos e solicitar exportação sem expor rascunhos ou reinterpretar dados de saúde.

**Architecture:** O BFF mobile usa portas públicas do MVP-03 e reduz os DTOs ao titular. Gráficos mobile recebem séries e comparações calculadas no backend e sempre possuem tabela equivalente. Consentimento e exportação são comandos auditados, com step-up e estados assíncronos.

**Tech Stack:** NestJS, contratos Health do MVP-03, Expo/React Native, SVG acessível, Jest, Testing Library e runner mobile.

---

## Pré-condições

- Slice 4.1 concluída e MVP-03 estável.
- Somente avaliações `PUBLISHED` e análises `APPROVED` podem sair pela porta mobile.
- Visibilidade de IA depende de `M3-STUDENT-AI-01`.

### Task 1: Criar portas públicas de saúde do aluno

**Files:**
- Create: `apps/api/src/modules/student-mobile/ports/student-health.port.ts`
- Create: `apps/api/src/modules/student-mobile/ports/student-consent.port.ts`
- Create: `apps/api/src/modules/student-mobile/ports/student-health-export.port.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/health.adapter.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/consent.adapter.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/health-export.adapter.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/health-adapters.spec.ts`
- Create: `packages/contracts/src/student-channels/mobile-health.ts`

- [ ] **Step 1: Escrever testes de minimização**

```ts
it('returns published assessments and approved analyses only', async () => {
  const result = await adapter.getHistory(ctx, query);
  expect(result.assessments.every(item => item.status === 'PUBLISHED')).toBe(true);
  expect(result.analyses.every(item => item.status === 'APPROVED')).toBe(true);
});
```

Teste rascunho, revisão rejeitada, outro aluno, consentimento revogado e observação profissional não autorizada.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- health-adapters.spec.ts`
Expected: FAIL porque portas e adapters não existem.

- [ ] **Step 3: Implementar portas estreitas**

```ts
export interface StudentHealthPort {
  getPublishedHistory(ctx: StudentChannelContext, period: HealthPeriod): Promise<StudentHealthHistory>;
  getApprovedAnalysis(ctx: StudentChannelContext, analysisId: string): Promise<StudentHealthAnalysis>;
}

export type HealthPeriod = '30D' | '90D' | '6M' | '1Y' | 'ALL';
export interface StudentHealthHistory {
  assessments: Array<{ id: string; status: 'PUBLISHED'; assessedAt: string }>;
  analyses: Array<{ id: string; status: 'APPROVED'; approvedAt: string }>;
}
export interface StudentHealthAnalysis {
  id: string;
  status: 'APPROVED';
  disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS';
}
```

Adapters chamam services públicos do MVP-03 e removem campos fora do contrato mobile.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- health-adapters.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-mobile/ports apps/api/src/modules/student-mobile/infrastructure packages/contracts/src/student-channels/mobile-health.ts
git commit -m "feat(mobile): add student health ports"
```

### Task 2: Expor histórico, análise, consentimento e exportação

**Files:**
- Create: `apps/api/src/modules/student-mobile/mobile-health.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-consents.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-health.controller.spec.ts`
- Create: `apps/api/src/modules/student-mobile/dto/mobile-health.dto.ts`
- Modify: `apps/api/src/modules/student-mobile/student-mobile.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-health.ts`

- [ ] **Step 1: Escrever testes HTTP**

```ts
await request(app).get('/api/v1/mobile/assessments').set(auth).expect(200).expect(({ body }) => {
  expect(JSON.stringify(body)).not.toContain('DRAFT');
  expect(JSON.stringify(body)).not.toContain('REJECTED');
});
```

Cubra export com step-up vencido, consentimento não revogável, análise bloqueada pelo gate e link de export de outro aluno.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-health.controller.spec.ts`
Expected: FAIL porque controllers não existem.

- [ ] **Step 3: Implementar rotas**

Adicione `GET /assessments`, `GET /health/analyses/:id`, `GET /consents`, `POST /consents/:code/revoke`, `POST /health/exports` e `GET /health/exports/:id`. Export retorna URL curta somente no estado `READY`.

- [ ] **Step 4: Gerar contrato e testar**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS.

Run: `pnpm --filter api test -- mobile-health.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-mobile packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-health.ts
git commit -m "feat(api): expose student mobile health"
```

### Task 3: Construir histórico e gráficos acessíveis

**Files:**
- Create: `apps/mobile/app/(protected)/health/index.tsx`
- Create: `apps/mobile/app/(protected)/health/[assessmentId].tsx`
- Create: `apps/mobile/src/features/health/health-history.tsx`
- Create: `apps/mobile/src/features/health/measurement-chart.tsx`
- Create: `apps/mobile/src/features/health/measurement-table.tsx`
- Create: `apps/mobile/src/features/health/health-history.test.tsx`

- [ ] **Step 1: Escrever testes de equivalência**

```ts
expect(chartValues(history)).toEqual(tableValues(history));
expect(renderHistory(missingPoint)).not.toHaveTextContent('0 kg');
```

Teste primeiro/anterior/atual/meta, unidades, correção, fonte ampliada, leitor de tela e identificação além de cor.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- health-history.test.tsx`
Expected: FAIL porque componentes não existem.

- [ ] **Step 3: Implementar gráfico e tabela**

O app formata decimais fornecidos e nunca recalcula IMC, comparação ou progresso. A tabela é sempre acessível, mesmo quando o gráfico está visível.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter mobile test -- health-history.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(protected\)/health apps/mobile/src/features/health
git commit -m "feat(mobile): add accessible health history"
```

### Task 4: Exibir análise aprovada com aviso persistente

**Files:**
- Create: `apps/mobile/app/(protected)/health/analyses/[analysisId].tsx`
- Create: `apps/mobile/src/features/health/approved-analysis.tsx`
- Create: `apps/mobile/src/features/health/approved-analysis.test.tsx`

- [ ] **Step 1: Escrever testes de visibilidade**

```ts
expect(renderAnalysis(approved)).toHaveTextContent('Não é diagnóstico médico');
expect(() => renderAnalysis(rejected)).toThrow('ANALYSIS_NOT_AVAILABLE');
```

Teste gate fechado, consentimento revogado, disclaimer fixo da aplicação e ausência de provider prompt/output bruto.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- approved-analysis.test.tsx`
Expected: FAIL porque a tela não existe.

- [ ] **Step 3: Implementar saída estruturada**

Renderize summary, progresso, pontos, tendências, metas e perguntas ao profissional. O disclaimer é componente fixo e não vem do texto gerado.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter mobile test -- approved-analysis.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(protected\)/health/analyses apps/mobile/src/features/health
git commit -m "feat(mobile): show approved health analysis"
```

### Task 5: Implementar consentimentos e exportação assíncrona

**Files:**
- Create: `apps/mobile/app/(protected)/profile/consents.tsx`
- Create: `apps/mobile/app/(protected)/profile/health-export.tsx`
- Create: `apps/mobile/src/features/privacy/consent-list.tsx`
- Create: `apps/mobile/src/features/privacy/health-export.tsx`
- Create: `apps/mobile/src/features/privacy/privacy-actions.test.tsx`
- Create: `apps/mobile/e2e/mobile-health-privacy.e2e.ts`

- [ ] **Step 1: Escrever testes de step-up e revogação**

```ts
it('requires reauthentication before consent revocation', async () => {
  await revokeConsent();
  expect(router.push).toHaveBeenCalledWith('/reauthenticate?returnTo=/profile/consents');
});
```

Teste revogação idempotente, efeito informado, export `REQUESTED/PROCESSING/READY/EXPIRED/FAILED` e URL que não persiste.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- privacy-actions.test.tsx`
Expected: FAIL porque jornadas não existem.

- [ ] **Step 3: Implementar jornadas**

Confirmação mostra finalidade e consequência do backend. URL de export abre externamente e é descartada ao perder foco; nenhum arquivo é salvo pelo app sem ação do sistema operacional.

- [ ] **Step 4: Executar unitários e E2E**

Run: `pnpm --filter mobile test -- privacy-actions.test.tsx`
Expected: PASS.

Run: `pnpm --filter mobile test:e2e -- mobile-health-privacy.e2e.ts`
Expected: PASS para histórico, análise, revogação e export.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(protected\)/profile apps/mobile/src/features/privacy apps/mobile/e2e/mobile-health-privacy.e2e.ts
git commit -m "feat(mobile): add health privacy controls"
```

### Task 6: Fechar autorização e evidências de saúde

**Files:**
- Create: `apps/api/test/security/mobile-health-authorization.e2e-spec.ts`
- Create: `docs/operations/app-totem/evidence/mvp-04-04-health-consents.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md`

- [ ] **Step 1: Executar abuso por objeto**

Run: `pnpm --filter api test:e2e -- mobile-health-authorization`
Expected: PASS para assessment, análise, consentimento e export de outro aluno/tenant.

- [ ] **Step 2: Executar regressão mobile**

Run: `pnpm --filter mobile test && pnpm --filter mobile test:e2e -- mobile-health-privacy.e2e.ts`
Expected: PASS nos devices aprovados.

- [ ] **Step 3: Registrar evidências**

Mapeie `M4-FR-012`, `M4-FR-013`, `M4-BR-008`, `M4-BR-009`, `M4-NFR-001`, `M4-NFR-002`, `M4-NFR-006`, `M4-NFR-007` e `M4-AC-004`.

- [ ] **Step 4: Atualizar checkboxes comprovados e commit**

```bash
git add apps/api/test/security/mobile-health-authorization.e2e-spec.ts docs/operations/app-totem/evidence/mvp-04-04-health-consents.md docs/prd/academia/MVP-04-app-totem.md
git commit -m "docs(mobile): record health and privacy evidence"
```
