# MVP-06.4 — Experimento operacional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir impacto causal operacional da fila de retenção com assignment estável, controle não exposto e análise por intenção de tratar.

**Architecture:** Definições congeladas criam assignments append-only por aluno/estrato antes de qualquer exposição. O selector de tarefas consulta assignment: tratamento pode gerar tarefa, controle nunca aparece à equipe. Exposições, contatos e outcomes são agregados por janelas predefinidas; relatório ITT referencia a versão congelada e inclui efeitos adversos.

**Tech Stack:** NestJS, Prisma/PostgreSQL, pacote `retention-domain`, Node crypto, BullMQ, Zod, Jest, fast-check, Testcontainers, OpenAPI, Next.js/React e Playwright.

---

## Pré-condições

- Slice 6.3 concluída.
- `M6-EXPERIMENT-01` aprovado e hash/seed/métricas congelados.
- `RETENTION_EXPERIMENT=false` fora do piloto.

### Task 1: Modelar experimento, assignment e exposição

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_retention_experiments/migration.sql`
- Create: `packages/retention-domain/src/experiments/retention-experiment.ts`
- Create: `packages/retention-domain/src/experiments/retention-experiment.spec.ts`
- Create: `packages/retention-domain/src/experiments/experiment-assignment.ts`
- Create: `packages/retention-domain/src/experiments/experiment-assignment.spec.ts`

- [ ] **Step 1: Escrever testes de imutabilidade**

```ts
it('does not allow metric or allocation changes after start', () => {
  expect(() => reviseExperiment(runningExperiment, changedMetric)).toThrow('EXPERIMENT_FROZEN');
});

it('keeps the persisted assignment when risk band changes', () => {
  expect(resolveAssignment(existingAssignment, newRiskBand)).toBe(existingAssignment);
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- retention-experiment experiment-assignment`
Expected: FAIL porque domínio não existe.

- [ ] **Step 3: Adicionar modelos**

Crie `RetentionExperiment`, `RetentionExperimentVersion`, `RetentionExperimentAssignment`, `RetentionExperimentExposure`, `RetentionExperimentOutcome` e `RetentionExperimentReport`.

```ts
export type RetentionExperimentStatus = 'DRAFT' | 'VALIDATED' | 'RUNNING' | 'STOPPING' | 'COMPLETED' | 'CANCELLED';
export type RetentionExperimentGroup = 'CONTROL' | 'TREATMENT';
```

Assignment unique por tenant/experiment version/aluno. Versão registra população, strata, allocation, seed/hash version, datas, primary/guardrail metrics e analysis policy.

- [ ] **Step 4: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name retention_experiments && pnpm --filter @arenahub/retention-domain test -- retention-experiment experiment-assignment`
Expected: PASS para freeze, estados e assignment imutável.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma packages/retention-domain/src/experiments
git commit -m "feat(retention): model frozen operational experiments"
```

### Task 2: Implementar randomização estratificada reproduzível

**Files:**
- Create: `packages/retention-domain/src/experiments/assign-experiment-group.ts`
- Create: `packages/retention-domain/src/experiments/assign-experiment-group.spec.ts`
- Create: `apps/api/src/modules/retention-experiments/application/assign-retention-experiment.use-case.ts`
- Create: `apps/api/src/modules/retention-experiments/application/assign-retention-experiment.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-experiments/infrastructure/retention-experiment.repository.ts`
- Create: `apps/api/src/modules/retention-experiments/infrastructure/retention-assignment.repository.ts`

- [ ] **Step 1: Escrever property tests**

```ts
it('is stable for the same tenant experiment student and stratum', () => {
  expect(assign(input)).toEqual(assign(input));
});

it('never uses PII in the hash input', () => {
  expect(buildAssignmentKey(input)).toEqual(`${input.tenantId}:${input.experimentVersionId}:${input.studentOpaqueId}:${input.stratumKey}`);
});
```

Use fast-check para determinismo, distribuição dentro da tolerância aprovada, tenants diferentes e retries concorrentes.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- assign-experiment-group && pnpm --filter api test -- assign-retention-experiment`
Expected: FAIL porque função e caso de uso não existem.

- [ ] **Step 3: Implementar hash versionado**

Use HMAC com segredo de experimento em secret manager; armazene hash version, não segredo. Estrato é unidade + faixa da baseline no instante de elegibilidade. Persisted assignment vence qualquer recomputação.

- [ ] **Step 4: Implementar criação before-exposure**

Caso de uso bloqueia experimento não validado, aluno fora da população e assignment após uma exposição. Insert/unique resolve corrida e retorna o registro vencedor.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/retention-domain test -- assign-experiment-group && pnpm --filter api test -- assign-retention-experiment`
Expected: PASS para estabilidade, distribuição e concorrência.

- [ ] **Step 6: Commit**

```bash
git add packages/retention-domain/src/experiments apps/api/src/modules/retention-experiments
git commit -m "feat(retention): assign stable experiment groups"
```

### Task 3: Integrar controle/tratamento à criação de tarefas

**Files:**
- Create: `apps/api/src/modules/retention-experiments/application/resolve-experiment-treatment.use-case.ts`
- Create: `apps/api/src/modules/retention-experiments/application/resolve-experiment-treatment.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-experiments/application/record-retention-exposure.use-case.ts`
- Create: `apps/api/src/modules/retention-experiments/application/record-retention-exposure.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-experiments/ports/experiment-treatment.port.ts`
- Modify: `apps/api/src/modules/retention-tasks/application/select-retention-candidates.use-case.ts`
- Modify: `apps/api/src/modules/retention-tasks/application/select-retention-candidates.use-case.spec.ts`

- [ ] **Step 1: Escrever testes de não contaminação**

```ts
it('does not create or reveal a task for control', async () => {
  const result = await selector.execute(candidateAssignedToControl);
  expect(result.created).toHaveLength(0);
  expect(await taskRepository.findForStudent(candidate.studentId)).toHaveLength(0);
});
```

Teste tratamento, assignment ausente, opt-out depois do assignment, experimento parado e capacidade contando apenas tarefas realmente criadas.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- resolve-experiment-treatment record-retention-exposure select-retention-candidates`
Expected: FAIL porque porta e integração não existem.

- [ ] **Step 3: Implementar porta fail-closed**

Selector pede decisão antes de reservar capacidade. Em experimento ativo: assignment CONTROL retorna `SUPPRESS_TASK`; TREATMENT permite criação. Sem assignment válido, não cria tarefa e registra erro operacional.

- [ ] **Step 4: Registrar exposição corretamente**

Tratamento é exposto quando tarefa fica disponível à equipe; controle recebe exposure analítica cega na mesma seleção, sem UI. Grave uma exposição por experiment assignment/observation window.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- resolve-experiment-treatment record-retention-exposure select-retention-candidates`
Expected: PASS sem controle na fila, logs ou export operacional.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-experiments apps/api/src/modules/retention-tasks/application/select-retention-candidates.use-case.ts apps/api/src/modules/retention-tasks/application/select-retention-candidates.use-case.spec.ts
git commit -m "feat(retention): isolate experiment control group"
```

### Task 4: Calcular outcomes e análise por intenção de tratar

**Files:**
- Create: `packages/retention-domain/src/experiments/calculate-itt-report.ts`
- Create: `packages/retention-domain/src/experiments/calculate-itt-report.spec.ts`
- Create: `apps/api/src/modules/retention-experiments/application/materialize-experiment-outcomes.use-case.ts`
- Create: `apps/api/src/modules/retention-experiments/application/materialize-experiment-outcomes.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-experiments/application/generate-experiment-report.use-case.ts`
- Create: `apps/api/src/modules/retention-experiments/application/generate-experiment-report.use-case.spec.ts`
- Create: `apps/api/src/workers/retention-experiment-outcomes.processor.ts`
- Create: `apps/api/src/workers/retention-experiment-outcomes.processor.spec.ts`

- [ ] **Step 1: Escrever golden tests ITT**

```ts
it('keeps non-contacted treatment subjects in the treatment denominator', () => {
  expect(calculateIttReport(assignments, outcomes).treatment.assigned).toBe(allTreatmentAssignments.length);
});

it('does not replace historical churn label with operator result', () => {
  expect(materializeOutcome(contactMarkedResolved).churnLabel).toBe(sourceLabel.value);
});
```

Cubra cancelamento, expiração, reativação, permanência, opt-out, reclamação, janela incompleta, perdas e grupo pequeno.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- calculate-itt-report && pnpm --filter api test -- materialize-experiment-outcomes generate-experiment-report`
Expected: FAIL porque cálculos não existem.

- [ ] **Step 3: Implementar outcomes versionados**

Use eventos/labels maduros as-of, não status atual. Outcome referencia assignment, analysis window e source lineage. Janela incompleta fica `PENDING`; não é removida do denominador silenciosamente.

- [ ] **Step 4: Implementar relatório congelado**

Relatório inclui assigned/exposed/contacted, primary metric, intervalos, attrition, capacidade, opt-out/reclamação, limitações e decisão `CONTINUE|ADJUST_NEW_VERSION|STOP|INCONCLUSIVE`. Nova métrica exige nova experiment version.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/retention-domain test -- calculate-itt-report && pnpm --filter api test -- materialize-experiment-outcomes generate-experiment-report retention-experiment-outcomes`
Expected: PASS para ITT, janela e efeitos adversos.

- [ ] **Step 6: Commit**

```bash
git add packages/retention-domain/src/experiments apps/api/src/modules/retention-experiments apps/api/src/workers/retention-experiment-outcomes.processor.ts apps/api/src/workers/retention-experiment-outcomes.processor.spec.ts
git commit -m "feat(retention): calculate intention-to-treat outcomes"
```

### Task 5: Expor resultados e operação do experimento

**Files:**
- Create: `apps/api/src/modules/retention-experiments/admin-retention-experiments.controller.ts`
- Create: `apps/api/src/modules/retention-experiments/admin-retention-experiments.controller.spec.ts`
- Create: `apps/api/src/modules/retention-experiments/retention-experiments.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/retention-experiments.ts`
- Create: `apps/admin-web/app/(protected)/retention/experiments/[experimentId]/page.tsx`
- Create: `apps/admin-web/components/retention/RetentionExperimentResults.tsx`
- Create: `apps/admin-web/components/retention/RetentionExperimentResults.test.tsx`

- [ ] **Step 1: Escrever testes API/UI**

Cubra `GET /api/v1/retention/experiments/:id/results`, permissão gerente/analista, agregação, minimum cell size, janela pendente, ITT e nenhuma lista de controles para operação.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- admin-retention-experiments.controller.spec.ts && pnpm --filter admin-web test -- RetentionExperimentResults.test.tsx`
Expected: FAIL porque API/UI não existem.

- [ ] **Step 3: Implementar DTO agregado e tela**

Mostre definição congelada, fluxo assigned→exposed→contacted, primary outcome, efeitos adversos, intervalos e limitações. Célula abaixo do mínimo é suprimida. Operadores não recebem identidade do controle.

- [ ] **Step 4: Gerar OpenAPI e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- admin-retention-experiments.controller.spec.ts && pnpm --filter admin-web test -- RetentionExperimentResults.test.tsx`
Expected: PASS com acessibilidade e RBAC.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-experiments apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/retention-experiments.ts "apps/admin-web/app/(protected)/retention/experiments" apps/admin-web/components/retention
git commit -m "feat(retention): expose controlled experiment results"
```

### Task 6: Provar assignment, não contaminação e relatório

**Files:**
- Create: `tests/integration/retention/experiment-assignment-stability.spec.ts`
- Create: `tests/integration/retention/experiment-control-contamination.spec.ts`
- Create: `tests/e2e/admin/retention-experiment-results.spec.ts`
- Create: `docs/operations/retention/experiment-runbook.md`
- Create: `docs/operations/retention/experiment-evidence.json`

- [ ] **Step 1: Criar bateria adversa**

Inclua reprocessamento, mudança de faixa, retry, unidade diferente, operador buscando controle, opt-out, janela imatura, métrica adversa e tentativa de editar experimento ativo.

- [ ] **Step 2: Executar testes**

Run: `pnpm test:integration -- experiment-assignment-stability experiment-control-contamination && pnpm test:e2e:admin -- retention-experiment-results.spec.ts`
Expected: PASS; assignment invariável, controle invisível e relatório ITT reproduzível.

- [ ] **Step 3: Documentar parada e análise**

Runbook cobre start/freeze, capacity, exposure, guardrail, STOPPING, janela de maturação, relatório, decisão e nova versão para ajustes.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/retention/experiment-assignment-stability.spec.ts tests/integration/retention/experiment-control-contamination.spec.ts tests/e2e/admin/retention-experiment-results.spec.ts docs/operations/retention/experiment-runbook.md docs/operations/retention/experiment-evidence.json
git commit -m "test(retention): prove stable retention experiment"
```

## Verificação da slice

- [ ] Run: `pnpm --filter @arenahub/retention-domain test -- experiments`
  Expected: PASS.
- [ ] Run: `pnpm --filter api test -- retention-experiments`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- experiment-assignment-stability experiment-control-contamination`
  Expected: PASS.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

O núcleo pode seguir para `2026-08-14-mvp-06-06-production-monitoring.md`. Execute `2026-08-14-mvp-06-05-supervised-ml-optional.md` somente com `M6-ML-01` aprovado.
