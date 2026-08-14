# MVP-03.5 — IA assistida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute this plan task-by-task.

**Goal:** Produzir análises informativas e rastreáveis sobre avaliações, metas e frequência, com saída estruturada, validação determinística e aprovação profissional obrigatória.

**Architecture:** Uma orquestração assíncrona cria snapshot pseudonimizado e imutável, calcula fatos determinísticos e chama um `HealthAnalysisProvider` atrás de um adapter. A resposta passa por schema, grounding e políticas antidiagnóstico antes de chegar à fila de revisão. Nenhum texto do provedor é publicado diretamente e a visualização do aluno permanece bloqueada por gate independente.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, BullMQ, Redis, Zod, Next.js App Router, React, Jest (API/workers), Vitest (pacotes/UI), Playwright.

---

## Pré-condições

- Concluir `2026-08-14-mvp-03-02-history-comparisons.md` e `2026-08-14-mvp-03-04-goals-attendance.md`.
- Aprovar `M3-AI-01` antes de conectar provedor ou modelo real.
- Aprovar `M3-STUDENT-AI-01` separadamente antes de mostrar qualquer análise assistida ao aluno.
- Não enviar arquivos originais, observações livres desnecessárias ou identificadores diretos ao provedor.

### Task 1: Definir o contrato estruturado e o provider fake

**Files:**
- Create: `packages/health-ai/src/health-analysis-output.ts`
- Create: `packages/health-ai/src/health-analysis-output.test.ts`
- Create: `packages/health-ai/src/health-analysis-provider.ts`
- Create: `packages/health-ai/src/fake-health-analysis-provider.ts`
- Create: `packages/health-ai/src/fake-health-analysis-provider.test.ts`
- Create: `packages/health-ai/src/index.ts`
- Create: `packages/health-ai/package.json`

- [ ] **Step 1: Escrever testes do schema de saída**

Implemente e teste `HealthAnalysisOutput` com `summary`, `progress`, `positivePoints`, `attentionPoints`, `trends`, `goalProgress`, `questionsForProfessional` e `disclaimerCode: "NOT_MEDICAL_DIAGNOSIS"`. Limite tamanhos, itens e caracteres; rejeite campos extras.

- [ ] **Step 2: Escrever testes do provider fake**

O fake deve ser determinístico por snapshot e versão de prompt, retornar somente o contrato válido e ser identificado como `fake`. Não use frases aleatórias nem simule um fornecedor real.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/health-ai test`
Expected: FAIL porque pacote, schema e provider ainda não existem.

- [ ] **Step 4: Implementar schema, port e fake**

Defina request com `analysisId`, `snapshot`, `computedFacts`, `promptVersion`, locale e deadline. Defina resposta com output, provider, model, parâmetros, latência e contagem de uso; nunca aceite texto cru como contrato final.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/health-ai test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/health-ai
git commit -m "feat(health): define structured ai analysis contract"
```

### Task 2: Persistir snapshots mínimos e o ciclo de revisão

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_health_ai_analysis/migration.sql`
- Create: `apps/api/src/modules/health-ai/analysis-state-machine.ts`
- Create: `apps/api/src/modules/health-ai/analysis-state-machine.spec.ts`
- Create: `apps/api/src/modules/health-ai/analysis-snapshot.service.ts`
- Create: `apps/api/src/modules/health-ai/analysis-snapshot.service.spec.ts`

- [ ] **Step 1: Escrever testes da máquina de estados**

Cubra `REQUESTED -> PROCESSING -> REVIEW_REQUIRED -> APPROVED` e finais `VALIDATION_FAILED`, `REJECTED` e `FAILED`. Bloqueie aprovação sem revisor, alteração de snapshot e publicação direta pelo worker.

- [ ] **Step 2: Escrever testes de minimização**

O snapshot deve conter pseudônimo aleatório por análise, medições consentidas, metas, agregados de frequência e fatos calculados. Rejeite nome, documento, telefone, e-mail, arquivo original, URL, observação livre e identificador externo.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- analysis-snapshot analysis-state-machine`
Expected: FAIL porque serviços e estados ainda não existem.

- [ ] **Step 4: Criar modelos persistentes**

Adicione `HealthAIAnalysis`, `HealthAIAnalysisSnapshot`, `HealthAIPromptVersion`, `HealthAIAnalysisReview` e `HealthAIUsage`. Registre hashes, versões, provider/modelo, parâmetros, status, motivo de rejeição e auditoria; proteja snapshots contra update/delete fora da retenção aprovada.

- [ ] **Step 5: Aplicar migration e implementar serviços**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name health_ai_analysis`
Expected: migration aplicada sem drift.

- [ ] **Step 6: Executar testes**

Run: `pnpm --filter @arenahub/api test -- analysis-snapshot analysis-state-machine`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/health-ai
git commit -m "feat(health): persist minimized ai analysis snapshots"
```

### Task 3: Validar grounding e bloquear linguagem clínica imprópria

**Files:**
- Create: `packages/health-ai/src/grounding-validator.ts`
- Create: `packages/health-ai/src/grounding-validator.test.ts`
- Create: `packages/health-ai/src/safety-policy.ts`
- Create: `packages/health-ai/src/safety-policy.test.ts`
- Create: `packages/health-ai/test/fixtures/synthetic-safety-cases.json`
- Modify: `packages/health-ai/src/index.ts`

- [ ] **Step 1: Escrever testes de grounding**

Exija que códigos de métrica, períodos, tendências e progresso citados existam nos fatos calculados. Números em texto livre devem corresponder a valores formatados permitidos ou ser rejeitados; não aceite números inventados pelo provedor.

- [ ] **Step 2: Escrever testes antidiagnóstico**

Inclua casos sintéticos com diagnóstico, prognóstico, prescrição de treino/dieta/medicamento, certeza causal, urgência clínica e tentativa de alterar instruções via conteúdo de dado. A saída deve ser inválida e nunca chegar à revisão como válida.

- [ ] **Step 3: Escrever casos informativos permitidos**

Permita descrição factual de aumento, redução, estabilidade, ausência de dado e pergunta ao profissional, sempre com disclaimer fixo e sem classificar saúde.

- [ ] **Step 4: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/health-ai test -- grounding-validator safety-policy`
Expected: FAIL porque validadores ainda não existem.

- [ ] **Step 5: Implementar validadores determinísticos**

Trate qualquer texto vindo de medições ou importações como dado, nunca instrução. Separe template versionado de payload e valide saída depois da chamada; filtro não substitui revisão profissional.

- [ ] **Step 6: Executar testes**

Run: `pnpm --filter @arenahub/health-ai test -- grounding-validator safety-policy`
Expected: PASS para todos os casos sintéticos aprovados em `M3-AI-01`.

- [ ] **Step 7: Commit**

```bash
git add packages/health-ai
git commit -m "feat(health): validate ai grounding and safety"
```

### Task 4: Orquestrar geração assíncrona com limites operacionais

**Files:**
- Create: `apps/api/src/modules/health-ai/health-analysis.controller.ts`
- Create: `apps/api/src/modules/health-ai/health-analysis.service.ts`
- Create: `apps/api/src/modules/health-ai/health-analysis.service.spec.ts`
- Create: `apps/api/src/workers/health-ai/health-analysis.worker.ts`
- Create: `apps/api/src/workers/health-ai/health-analysis.worker.spec.ts`
- Create: `apps/api/src/workers/health-ai/provider-circuit-breaker.ts`
- Create: `apps/api/src/workers/health-ai/provider-circuit-breaker.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes de solicitação**

Exija consentimento ativo, profissional vinculado, amostra mínima configurada, chave idempotente e `M3-AI-01` ativo para provider real. Solicitações idênticas em andamento devem retornar a mesma análise.

- [ ] **Step 2: Escrever testes do worker**

Cubra timeout, limite concorrente, orçamento diário por tenant, circuito aberto, resposta fora do schema, falha de grounding e cancelamento por consentimento revogado. Faça no máximo um retry em falha transitória com o mesmo `analysisId`; não repita saída inválida.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-analysis.service.spec.ts`
Expected: FAIL porque a orquestração ainda não existe.

Run: `pnpm --filter @arenahub/api test -- health-ai`
Expected: FAIL porque worker e circuito ainda não existem.

- [ ] **Step 4: Implementar API e worker com provider fake**

Crie `POST /v1/health/students/:studentId/analyses` retornando `202`. Leia timeout, concorrência e orçamento do manifesto aprovado, registre uso mesmo em falha faturável e mova somente saída validada para `REVIEW_REQUIRED`.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/api test -- health-analysis.service.spec.ts`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- health-ai`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/health-ai apps/api/src/app.module.ts apps/api/src/workers/health-ai
git commit -m "feat(health): orchestrate reviewed ai analyses"
```

### Task 5: Implementar revisão profissional e visibilidade controlada

**Files:**
- Create: `apps/api/src/modules/health-ai/health-analysis-review.service.ts`
- Create: `apps/api/src/modules/health-ai/health-analysis-review.service.spec.ts`
- Create: `apps/api/src/modules/health-ai/health-analysis-review.controller.ts`
- Create: `apps/admin-web/app/(protected)/health/students/[id]/analyses/[analysisId]/page.tsx`
- Create: `apps/admin-web/app/(protected)/my-health/analyses/[analysisId]/page.tsx`
- Create: `apps/admin-web/components/health/ai/analysis-review.client.tsx`
- Create: `apps/admin-web/components/health/ai/analysis-review.test.tsx`
- Create: `apps/admin-web/tests/e2e/health-ai-review.spec.ts`

- [ ] **Step 1: Escrever testes de aprovação, rejeição e regeneração**

Somente profissional autorizado revisa. Aprovação exige confirmação do disclaimer; rejeição e regeneração exigem motivo. Regeneração cria nova tentativa ligada ao mesmo snapshot ou um novo snapshot explicitamente versionado.

- [ ] **Step 2: Escrever testes do gate do aluno**

Mesmo aprovada, a análise retorna `404` para o aluno enquanto `M3-STUDENT-AI-01` estiver fechado. Depois do gate, somente o titular vê a versão aprovada; rascunho e texto rejeitado nunca aparecem.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-analysis-review.service.spec.ts`
Expected: FAIL porque revisão ainda não existe.

- [ ] **Step 4: Implementar revisão e interface**

Mostre fatos usados, output estruturado, provider/modelo, versão de prompt, alertas de validação e disclaimer. Não permita edição silenciosa: edição profissional deve gerar revisão auditada com diferença registrada.

- [ ] **Step 5: Executar testes e E2E**

Run: `pnpm --filter @arenahub/api test -- health-analysis-review.service.spec.ts`
Expected: PASS.

Run: `pnpm --filter admin-web test -- analysis-review.test.tsx`
Expected: PASS.

Run: `pnpm --filter admin-web e2e -- health-ai-review.spec.ts`
Expected: PASS para aprovação, rejeição e bloqueio do aluno.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/health-ai apps/admin-web/app/\(protected\)/health apps/admin-web/app/\(protected\)/my-health apps/admin-web/components/health/ai apps/admin-web/tests/e2e/health-ai-review.spec.ts
git commit -m "feat(health): add professional ai analysis review"
```

### Task 6: Conectar e certificar um provider real

**Files:**
- Modify: `docs/operations/health/ai-capabilities.md`
- Create: `docs/operations/health/evidence/mvp-03-05-assisted-ai.md`
- Modify: `docs/prd/academia/MVP-03-health-intelligence.md`

- [ ] **Step 1: Executar o plano fixo do provider**

Execute `2026-08-14-mvp-03-ai-provider-adapter.md` após `M3-AI-01`. Mantenha chave no secret manager e ambiente do fornecedor; nenhuma credencial, payload real ou resposta identificável entra no Git.

- [ ] **Step 2: Rodar a suíte sintética e de resiliência**

Run: `pnpm --filter @arenahub/health-ai test`
Expected: PASS com o adapter real também submetido aos mesmos contratos.

Run: `pnpm --filter @arenahub/api test -- health-ai`
Expected: PASS para timeout, circuito, orçamento, schema e grounding.

Run: `pnpm --filter admin-web e2e -- health-ai-review.spec.ts`
Expected: PASS sem publicação automática.

- [ ] **Step 3: Validar amostra anonimizada com dois profissionais**

Registre concordância, rejeições, linguagem proibida, fatos inventados, custo e latência. Não abra `M3-STUDENT-AI-01` enquanto houver saída clínica indevida, grounding inconsistente ou processo de revisão incompleto.

- [ ] **Step 4: Registrar evidências**

Documente `M3-FR-015`, `M3-FR-016`, `M3-BR-004`, `M3-BR-009`, `M3-BR-010`, `M3-NFR-004`, `M3-NFR-005`, `M3-NFR-006`, `M3-AC-007` e `M3-AC-008`, distinguindo fake, adapter real e aprovação profissional.

- [ ] **Step 5: Atualizar somente checkboxes comprovados e commit**

```bash
git add docs/operations/health/ai-capabilities.md docs/operations/health/evidence/mvp-03-05-assisted-ai.md docs/prd/academia/MVP-03-health-intelligence.md
git commit -m "docs(health): record assisted ai evidence"
```
