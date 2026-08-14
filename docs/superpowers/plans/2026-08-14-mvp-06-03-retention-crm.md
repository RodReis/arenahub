# MVP-06.3 — CRM humano de retenção Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar scores elegíveis em uma fila limitada de tarefas humanas, ligando prioridade, responsável, contato e resultado sem executar ação automaticamente.

**Architecture:** Um selector diário escolhe top-K por capacidade após revalidar elegibilidade, supressão, assignment e cooldown. Constraint parcial impede duas tarefas ativas por aluno/estratégia. Tarefas e interações usam máquinas de estado, optimistic concurrency, RBAC por unidade e outbox. Templates descrevem roteiro/resultados, não integrações de envio.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/BullMQ, pacote `retention-domain`, Zod, outbox, Jest, Testcontainers, OpenAPI, Next.js/React, Vitest e Playwright.

---

## Pré-condições

- Slice 6.2 concluída.
- `M6-OPS-01` aprovado com capacidade, cooldown, canais e RBAC reais.
- `RETENTION_TASKS=false` fora da unidade piloto.

### Task 1: Modelar capacidade, templates, tarefas e interações

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_retention_tasks/migration.sql`
- Create: `packages/retention-domain/src/tasks/retention-task.ts`
- Create: `packages/retention-domain/src/tasks/retention-task.spec.ts`
- Create: `packages/retention-domain/src/tasks/task-capacity.ts`
- Create: `packages/retention-domain/src/tasks/task-capacity.spec.ts`

- [ ] **Step 1: Escrever testes de estados e capacidade**

```ts
it('does not carry unused capacity into an infinite backlog', () => {
  expect(selectDailyCapacity({ limit: 10, candidates: 20 }).selected).toHaveLength(10);
});

it('rejects completion without a result', () => {
  expect(() => transitionTask(inProgressTask, { type: 'COMPLETE', resultCode: null })).toThrow('TASK_RESULT_REQUIRED');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- retention-task task-capacity`
Expected: FAIL porque domínio não existe.

- [ ] **Step 3: Adicionar modelos e constraint parcial**

Crie `RetentionCapacityPolicy`, `RetentionActionTemplate`, `RetentionStrategyVersion`, `RetentionTask`, `RetentionTaskAssignment`, `RetentionTaskTransition` e `RetentionInteraction`.

```ts
export type RetentionTaskStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED' | 'EXPIRED';
export type RetentionTaskResult = 'CONTACTED' | 'NO_ANSWER' | 'CHANNEL_UNAVAILABLE' | 'DECLINED' | 'FOLLOW_UP' | 'RESOLVED_OTHER';
```

Migration cria índice parcial único para estados ativos por tenant/aluno/strategy version. Tarefa referencia score/provider version, template, unit, dueAt, cooldown window e experiment assignment quando houver.

- [ ] **Step 4: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name retention_tasks && pnpm --filter @arenahub/retention-domain test -- retention-task task-capacity`
Expected: PASS para transições, limite e concorrência da constraint.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma packages/retention-domain/src/tasks
git commit -m "feat(retention): model bounded human tasks"
```

### Task 2: Selecionar top-K e criar tarefas idempotentes

**Files:**
- Create: `apps/api/src/modules/retention-tasks/application/select-retention-candidates.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/select-retention-candidates.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-tasks/application/create-retention-task.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/create-retention-task.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-tasks/infrastructure/retention-task.repository.ts`
- Create: `apps/api/src/modules/retention-tasks/infrastructure/retention-capacity.repository.ts`
- Create: `apps/api/src/workers/retention-task-selection.processor.ts`
- Create: `apps/api/src/workers/retention-task-selection.processor.spec.ts`
- Create: `packages/contracts/src/retention/retention-task-created.event.ts`

- [ ] **Step 1: Escrever testes top-K/cooldown**

```ts
it('selects at most capacity and suppresses an active/cooldown duplicate', async () => {
  const result = await select.execute(dayWithCandidates(25, { capacity: 10, activeDuplicates: 2 }));
  expect(result.created).toHaveLength(10);
  expect(result.suppressedByActiveTask).toBe(2);
  expect(result.carriedBacklog).toBe(0);
});
```

Cubra tie-break estável, score expired, cancelado, opt-out, deletion pending, outro tenant/unidade, worker 100× e capacidade concorrente.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- select-retention-candidates create-retention-task retention-task-selection.processor`
Expected: FAIL porque selector, casos de uso e worker não existem.

- [ ] **Step 3: Implementar seleção determinística**

Ordene por faixa, score interno permitido, completude, risk increased at e opaque score ID. Revalide eligibility/suppression/cooldown na mesma transação que reserva capacidade/cria tarefa/outbox. Controle experimental é excluído antes da equipe ver.

- [ ] **Step 4: Implementar idempotência**

Run key: tenant/unit/localDate/strategy version. Unique task e `Idempotency-Key` convergem; conflito ativo retorna supressão, não retry infinito. Score continua histórico mesmo sem tarefa.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- select-retention-candidates create-retention-task retention-task-selection.processor`
Expected: PASS com no máximo K tarefas e zero backlog carregado.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-tasks apps/api/src/workers/retention-task-selection.processor.ts apps/api/src/workers/retention-task-selection.processor.spec.ts packages/contracts/src/retention/retention-task-created.event.ts
git commit -m "feat(retention): create capacity-bounded tasks"
```

### Task 3: Implementar atribuição e máquina de estados

**Files:**
- Create: `apps/api/src/modules/retention-tasks/application/assign-retention-task.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/reassign-retention-task.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/start-retention-task.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/complete-retention-task.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/dismiss-retention-task.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/retention-task-lifecycle.use-cases.spec.ts`
- Create: `apps/api/src/workers/retention-task-expiry.processor.ts`
- Create: `apps/api/src/workers/retention-task-expiry.processor.spec.ts`
- Create: `packages/contracts/src/retention/retention-task-completed.event.ts`

- [ ] **Step 1: Escrever testes de RBAC e concorrência**

Teste assign fora da unidade, duas pessoas atribuindo, expectedVersion antigo, complete sem interação/resultado, dismiss sem motivo, reassign com histórico e expiry idempotente.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- retention-task-lifecycle retention-task-expiry`
Expected: FAIL porque casos de uso e worker não existem.

- [ ] **Step 3: Implementar optimistic concurrency**

Cada comando exige tenant context, permission, task ID, `expectedVersion` e idempotency key. Atribuição/reassign escreve `RetentionTaskAssignment`; transição append-only guarda ator, from/to, motivo e correlationId.

- [ ] **Step 4: Implementar conclusão/dispensa/expiração**

Conclusão exige resultado coerente. Dispensa exige reason code e não altera score/label. Expiry usa dueAt indexado e preserva capacidade histórica; tarefa expirada não reabre automaticamente.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- retention-task-lifecycle retention-task-expiry`
Expected: PASS para transições, object authorization e corrida.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-tasks/application apps/api/src/workers/retention-task-expiry.processor.ts apps/api/src/workers/retention-task-expiry.processor.spec.ts packages/contracts/src/retention/retention-task-completed.event.ts
git commit -m "feat(retention): manage task lifecycle"
```

### Task 4: Registrar contato humano e próximo passo

**Files:**
- Create: `apps/api/src/modules/retention-tasks/application/record-retention-interaction.use-case.ts`
- Create: `apps/api/src/modules/retention-tasks/application/record-retention-interaction.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-tasks/ports/contact-permission.port.ts`
- Create: `apps/api/src/modules/retention-tasks/domain/retention-interaction.ts`
- Create: `apps/api/src/modules/retention-tasks/domain/retention-interaction.spec.ts`
- Create: `packages/contracts/src/retention/retention-interaction-recorded.event.ts`

- [ ] **Step 1: Escrever testes de consentimento e autoria**

```ts
it('rejects a contact channel not permitted for the strategy/student', async () => {
  await expect(record.execute(disallowedChannelCommand)).rejects.toMatchObject({ code: 'CONTACT_CHANNEL_NOT_ALLOWED' });
});

it('never sends a message while recording an interaction', async () => {
  await expect(record.execute(validManualContact)).resolves.toMatchObject({
    recorded: true,
    execution: 'HUMAN_REPORTED',
    deliveryId: null,
  });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- retention-interaction record-retention-interaction`
Expected: FAIL porque domínio e use case não existem.

- [ ] **Step 3: Implementar registro minimizado**

Comando recebe channel enum, occurredAt, result code, nextStep code/date e nota curta opcional. Backend deriva ator/tarefa/aluno, revalida finalidade/canal, sanitiza nota e grava interação/outbox. Não existe `send()` no módulo.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- retention-interaction record-retention-interaction`
Expected: PASS para canal, duplicate command, timezone, note limit e auditoria.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-tasks packages/contracts/src/retention/retention-interaction-recorded.event.ts
git commit -m "feat(retention): record human interactions"
```

### Task 5: Expor fila operacional e UI

**Files:**
- Create: `apps/api/src/modules/retention-tasks/admin-retention-tasks.controller.ts`
- Create: `apps/api/src/modules/retention-tasks/admin-retention-tasks.controller.spec.ts`
- Create: `apps/api/src/modules/retention-tasks/retention-tasks.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/retention-tasks.ts`
- Create: `apps/admin-web/app/(protected)/retention/tasks/page.tsx`
- Create: `apps/admin-web/app/(protected)/retention/tasks/[taskId]/page.tsx`
- Create: `apps/admin-web/components/retention/RetentionTaskQueue.tsx`
- Create: `apps/admin-web/components/retention/RetentionTaskDetail.tsx`
- Create: `apps/admin-web/components/retention/RetentionTaskQueue.test.tsx`

- [ ] **Step 1: Escrever testes das rotas do PRD**

Cubra `GET /api/v1/retention/tasks`, `POST /api/v1/retention/tasks/:id/assign`, `POST /api/v1/retention/tasks/:id/interactions`, `POST /api/v1/retention/tasks/:id/complete` e `POST /api/v1/retention/tasks/:id/dismiss`, paginação por cursor, filtros por unit/status/assignee/dueAt, idempotency key e `application/problem+json`.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- admin-retention-tasks.controller.spec.ts && pnpm --filter admin-web test -- RetentionTaskQueue.test.tsx`
Expected: FAIL porque API/UI não existem.

- [ ] **Step 3: Implementar controllers finos e UI operacional**

Fila mostra faixa, data/completude, fatores, prazo e responsável; não mostra vetor/probabilidade não calibrada. Detalhe oferece ações permitidas, roteiro, histórico e registro manual. Estados vazios/erro explicam próximo passo.

- [ ] **Step 4: Gerar OpenAPI e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- admin-retention-tasks.controller.spec.ts && pnpm --filter admin-web test -- RetentionTaskQueue.test.tsx`
Expected: PASS com teclado, leitor de tela e isolamento por unidade.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-tasks apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/retention-tasks.ts "apps/admin-web/app/(protected)/retention/tasks" apps/admin-web/components/retention
git commit -m "feat(retention): expose human retention queue"
```

### Task 6: Provar fluxo E2E, performance e independência do scoring

**Files:**
- Create: `tests/integration/retention/task-capacity-cooldown.spec.ts`
- Create: `tests/e2e/admin/retention-task-flow.spec.ts`
- Create: `tests/performance/retention/task-queue.k6.js`
- Create: `docs/operations/retention/task-queue-runbook.md`
- Create: `docs/operations/retention/task-queue-slo-evidence.json`

- [ ] **Step 1: Criar bateria adversa**

Inclua 100 replays, capacidade concorrente, control group, opt-out antes/depois da task, score pipeline desligado, reassign, contato e conclusão.

- [ ] **Step 2: Executar integração/E2E/carga**

Run: `pnpm test:integration -- task-capacity-cooldown && pnpm test:e2e:admin -- retention-task-flow.spec.ts && pnpm test:performance -- task-queue.k6.js`
Expected: PASS; uma active task, K respeitado, CRM operável sem scoring e fila p95 < 1 s no perfil aprovado.

- [ ] **Step 3: Documentar operação**

Runbook cobre capacidade, aging, reassignment, DLQ, expiração, supressão, indisponibilidade de scoring e rollback da flag.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/retention/task-capacity-cooldown.spec.ts tests/e2e/admin/retention-task-flow.spec.ts tests/performance/retention/task-queue.k6.js docs/operations/retention/task-queue-runbook.md docs/operations/retention/task-queue-slo-evidence.json
git commit -m "test(retention): prove bounded crm workflow"
```

## Verificação da slice

- [ ] Run: `pnpm --filter api test -- retention-tasks`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- task-capacity-cooldown`
  Expected: PASS.
- [ ] Run: `pnpm test:e2e:admin -- retention-task-flow.spec.ts`
  Expected: PASS sem ação automática.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com CRM estável, executar `2026-08-14-mvp-06-04-operational-experiment.md`.
