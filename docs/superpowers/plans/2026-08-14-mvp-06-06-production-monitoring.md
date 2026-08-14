# MVP-06.6 — Produção controlada e monitoramento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operar baseline e, quando elegível, modelo supervisionado com monitoramento por versão, kill switch, fallback e relatório de impacto.

**Architecture:** Uma configuração versionada escolhe provider por tenant e é lida antes de cada batch/priorização. Baseline é sempre fallback válido. Métricas de qualidade, performance, calibração, drift e operação formam reports imutáveis por período/provider. Kill switch atualiza banco/auditoria/outbox, invalida cache e impede novo uso do modelo em até cinco minutos sem tocar tarefas históricas.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/BullMQ, pacote `retention-domain`, OpenTelemetry, MinIO/S3 privado, Zod, OpenAPI, Next.js/React, Jest, Testcontainers, Playwright e k6.

---

## Pré-condições

- Slices 6.1 a 6.4 concluídas.
- `M6-MONITOR-01` aprovado.
- Baseline evidence aprovada para qualquer rollout.
- ML promotion só existe se o plano opcional passou e `M6-ML-01` continua válido.

### Task 1: Modelar configuração de provider e fallback baseline

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_retention_production_control/migration.sql`
- Create: `apps/api/src/modules/retention-scoring/domain/provider-configuration.ts`
- Create: `apps/api/src/modules/retention-scoring/domain/provider-configuration.spec.ts`
- Create: `apps/api/src/modules/retention-scoring/application/resolve-active-score-provider.use-case.ts`
- Create: `apps/api/src/modules/retention-scoring/application/resolve-active-score-provider.use-case.spec.ts`
- Modify: `apps/api/src/modules/retention-scoring/application/calculate-retention-score.use-case.ts`
- Modify: `apps/api/src/modules/retention-scoring/application/calculate-retention-score.use-case.spec.ts`
- Modify: `apps/api/src/modules/retention-scoring/retention-scoring.module.ts`

- [ ] **Step 1: Escrever testes de fallback core**

```ts
it('uses baseline when no supervised provider is installed', async () => {
  expect(await resolve.execute(coreOnlyTenant)).toMatchObject({ provider: 'RULE_BASELINE' });
});

it('resolves baseline when the active model is disabled or expired', async () => {
  expect(await resolve.execute(disabledModelTenant)).toMatchObject({ provider: 'RULE_BASELINE' });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- provider-configuration resolve-active-score-provider nest-score-provider-registry`
Expected: FAIL porque configuração e casos de uso não existem.

- [ ] **Step 3: Adicionar modelos e estados**

Crie `RetentionProviderConfiguration`, `RetentionProviderTransition`, `RetentionMonitoringPolicyVersion`, `RetentionDriftReport` e `RetentionImpactReport`. Configuração guarda tenant, provider/version opaca, validFrom/expiresAt, reason, requested/approved actors e revision; não possui foreign key obrigatória para tabela de modelo opcional.

- [ ] **Step 4: Implementar resolução extensível**

`ScoreProviderRegistryPort` sempre registra baseline. O adapter de ML, quando instalado pelo plano opcional, registra supervised provider. Conecte `calculate-retention-score` ao resolver ativo. Config ausente, expirada, desabilitada ou apontando para provider indisponível resolve baseline e alerta; nunca quebra scoring core.

- [ ] **Step 5: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name retention_production_control && pnpm --filter api test -- provider-configuration resolve-active-score-provider nest-score-provider-registry`
Expected: PASS para core sem ML, expiração, tenant e fallback.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/retention-scoring
git commit -m "feat(retention): configure baseline provider fallback"
```

### Task 2: Calcular performance, calibração e drift por versão

**Files:**
- Create: `packages/retention-domain/src/monitoring/precision-at-k.ts`
- Create: `packages/retention-domain/src/monitoring/precision-at-k.spec.ts`
- Create: `packages/retention-domain/src/monitoring/calibration-report.ts`
- Create: `packages/retention-domain/src/monitoring/calibration-report.spec.ts`
- Create: `packages/retention-domain/src/monitoring/distribution-drift.ts`
- Create: `packages/retention-domain/src/monitoring/distribution-drift.spec.ts`
- Create: `apps/api/src/modules/retention-operations/application/generate-retention-monitoring-report.use-case.ts`
- Create: `apps/api/src/modules/retention-operations/application/generate-retention-monitoring-report.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-operations/infrastructure/retention-monitoring.repository.ts`
- Create: `apps/api/src/workers/retention-monitoring.processor.ts`
- Create: `apps/api/src/workers/retention-monitoring.processor.spec.ts`
- Create: `packages/contracts/src/retention/model-drift-detected.event.ts`

- [ ] **Step 1: Escrever golden tests de métricas**

```ts
it('uses operational K from the capacity policy', () => {
  expect(precisionAtK(predictions, labels, { k: capacity.limit })).toEqual(expectedPrecision);
});

it('does not calculate outcome metrics on immature labels', () => {
  expect(buildMonitoringCohort(mixedLabels)).not.toContainEqual(expect.objectContaining({ labelStatus: 'IMMATURE' }));
});
```

Cubra baseline/model, períodos, bins vazios, missing drift, sample insuficiente, policy version e tenant isolation.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- monitoring && pnpm --filter api test -- generate-retention-monitoring-report retention-monitoring.processor`
Expected: FAIL porque métricas e worker não existem.

- [ ] **Step 3: Implementar métricas versionadas**

Calcule coverage/completeness, score age, distribution drift aprovado, precision/recall top-K, average precision, calibration bins e intervenção outcomes. Segmentos/fairness somente se policy autoriza e minimum cell size é atendido.

- [ ] **Step 4: Implementar report/alerta**

Report guarda inputs/high-water/checksum/policy e status `HEALTHY|WARNING|CRITICAL|INSUFFICIENT_DATA`. `CRITICAL` em provider supervisionado cria outbox `ModelDriftDetected`; baseline crítica cria alerta operacional sem fingir que existe modelo. `INSUFFICIENT_DATA` não é convertido em healthy.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/retention-domain test -- monitoring && pnpm --filter api test -- generate-retention-monitoring-report retention-monitoring.processor`
Expected: PASS para labels maduras, drift e repetição.

- [ ] **Step 6: Commit**

```bash
git add packages/retention-domain/src/monitoring apps/api/src/modules/retention-operations apps/api/src/workers/retention-monitoring.processor.ts apps/api/src/workers/retention-monitoring.processor.spec.ts packages/contracts/src/retention/model-drift-detected.event.ts
git commit -m "feat(retention): monitor score and intervention quality"
```

### Task 3: Implementar promoção e kill switch opcionais

Execute esta task somente depois de `2026-08-14-mvp-06-05-supervised-ml-optional.md` e com `M6-ML-01` aprovado. O core pula diretamente para a Task 4.

**Files:**
- Create: `apps/api/src/modules/retention-model-governance/application/promote-retention-model.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/promote-retention-model.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/disable-retention-model.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/disable-retention-model.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/ports/provider-configuration-cache.port.ts`
- Create: `apps/api/src/modules/retention-model-governance/infrastructure/redis-provider-configuration-cache.adapter.ts`
- Create: `apps/api/src/modules/retention-model-governance/infrastructure/redis-provider-configuration-cache.adapter.spec.ts`
- Create: `apps/api/src/workers/retention-model-safety.processor.ts`
- Create: `apps/api/src/workers/retention-model-safety.processor.spec.ts`
- Create: `packages/contracts/src/retention/retention-model-disabled.event.ts`
- Modify: `apps/api/src/modules/retention-model-governance/admin-retention-models.controller.ts`
- Modify: `apps/api/src/modules/retention-model-governance/admin-retention-models.controller.spec.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Modify: `packages/api-contracts/src/retention-models.ts`
- Modify: `apps/admin-web/app/(protected)/retention/models/page.tsx`
- Create: `apps/admin-web/components/retention/RetentionModelControls.tsx`
- Create: `apps/admin-web/components/retention/RetentionModelControls.test.tsx`

- [ ] **Step 1: Escrever testes de falha e prazo**

```ts
it('uses baseline after kill switch even when cache invalidation fails', async () => {
  cache.failInvalidation();
  await disable.execute(command);
  await clock.advance(policy.maximumProviderCacheAge);
  expect(await resolveProvider(tenant)).toMatchObject({ provider: 'RULE_BASELINE' });
});
```

Teste chamada repetida, operador sem permissão, outro tenant, worker em execução, drift critical, Redis down e task existente.

Teste também promoção sem gate atual, sem ganho shadow, com mesmo solicitante/aprovador ou modelo expirado.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- promote-retention-model disable-retention-model redis-provider-configuration-cache retention-model-safety admin-retention-models`
Expected: FAIL porque promoção, kill switch, cache, worker e endpoints não existem.

- [ ] **Step 3: Implementar promoção, desativação e cache bounded**

Promoção revalida gate, tenant, model state `SHADOW`, metrics policy, baseline comparison, fairness, shadow period, artefato, expiração e dois atores. Disable trava config/model, marca `DISABLED`, ativa baseline, registra reason/actors/audit/outbox. Invalide cache após commit. Cache TTL máximo vem da policy e deve ser menor que cinco minutos; worker também revalida config antes de importar/priorizar batch.

- [ ] **Step 4: Preservar histórico e CRM**

Não delete scores/model/tasks. Novos scores usam baseline; tasks existentes mantêm provider version e seguem operáveis. Batch ML em voo é recusado se config revision mudou.

Implemente `POST /api/v1/retention/models/:id/promote` e `POST /api/v1/retention/models/kill-switch` com step-up, expected revision e controles visíveis somente a papéis autorizados.

- [ ] **Step 5: Executar teste de SLO**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- promote-retention-model disable-retention-model redis-provider-configuration-cache retention-model-safety admin-retention-models && pnpm --filter admin-web test -- RetentionModelControls.test.tsx`
Expected: PASS com promoção auditada e kill switch comprovado dentro de cinco minutos em clock controlado.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-model-governance apps/api/src/workers/retention-model-safety.processor.ts apps/api/src/workers/retention-model-safety.processor.spec.ts packages/contracts/src/retention packages/contracts/openapi/openapi.yaml packages/api-contracts/src/retention-models.ts "apps/admin-web/app/(protected)/retention/models/page.tsx" apps/admin-web/components/retention/RetentionModelControls.tsx apps/admin-web/components/retention/RetentionModelControls.test.tsx
git commit -m "feat(retention): add model kill switch and fallback"
```

### Task 4: Expor monitoramento core

**Files:**
- Create: `apps/api/src/modules/retention-operations/admin-retention-operations.controller.ts`
- Create: `apps/api/src/modules/retention-operations/admin-retention-operations.controller.spec.ts`
- Create: `apps/api/src/modules/retention-operations/retention-operations.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/retention-operations.ts`
- Create: `apps/admin-web/app/(protected)/retention/operations/page.tsx`
- Create: `apps/admin-web/components/retention/RetentionOperationsDashboard.tsx`
- Create: `apps/admin-web/components/retention/RetentionOperationsDashboard.test.tsx`

- [ ] **Step 1: Escrever testes das APIs**

Cubra overview operacional e reports por provider/version, paginação, tenant/unidade, RBAC, período e problem+json. O endpoint funciona com baseline apenas.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- admin-retention-operations && pnpm --filter admin-web test -- RetentionOperationsDashboard.test.tsx`
Expected: FAIL porque endpoints/controles não existem.

- [ ] **Step 3: Implementar UI fail-safe**

Dashboard mostra provider, idade, cobertura, drift, calibração, top-K, task SLA/capacity e impacto. Sem ML instalado, apresenta baseline como provider ativo sem links ou controles de modelo inexistentes.

- [ ] **Step 4: Gerar OpenAPI e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- admin-retention-operations && pnpm --filter admin-web test -- RetentionOperationsDashboard.test.tsx`
Expected: PASS com RBAC, auditoria, acessibilidade e tenant isolation.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-operations apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/retention-operations.ts "apps/admin-web/app/(protected)/retention/operations" apps/admin-web/components/retention/RetentionOperationsDashboard.tsx apps/admin-web/components/retention/RetentionOperationsDashboard.test.tsx
git commit -m "feat(retention): expose production safety controls"
```

### Task 5: Aplicar retenção, opt-out e expiração de artefatos

**Files:**
- Create: `apps/api/src/modules/retention-operations/application/apply-retention-data-rights.use-case.ts`
- Create: `apps/api/src/modules/retention-operations/application/apply-retention-data-rights.use-case.spec.ts`
- Create: `apps/api/src/workers/retention-artifact-expiry.processor.ts`
- Create: `apps/api/src/workers/retention-artifact-expiry.processor.spec.ts`
- Create: `apps/api/src/workers/retention-suppression-propagation.processor.ts`
- Create: `apps/api/src/workers/retention-suppression-propagation.processor.spec.ts`
- Create: `docs/operations/retention/data-rights-runbook.md`
- Create: `tests/integration/retention/retention-data-rights.spec.ts`

- [ ] **Step 1: Escrever testes de propagação**

Teste opt-out bloqueando próximo snapshot/task, exclusion pending, dataset existente, artifact retention, pseudonymization, legal hold e job repetido.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- apply-retention-data-rights retention-artifact-expiry retention-suppression-propagation && pnpm test:integration -- retention-data-rights`
Expected: FAIL porque use case/workers não existem.

- [ ] **Step 3: Implementar policy por asset class**

Crie suppression imediata para futuro, cancele task não iniciada quando aplicável e marque datasets/models afetados. Delete/pseudonymize objects conforme policy com receipt/checksum; audit records mínimos permanecem conforme base aprovada.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- apply-retention-data-rights retention-artifact-expiry retention-suppression-propagation && pnpm test:integration -- retention-data-rights`
Expected: PASS sem novos snapshots/tarefas e com receipts dos artefatos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-operations/application/apply-retention-data-rights.use-case.ts apps/api/src/modules/retention-operations/application/apply-retention-data-rights.use-case.spec.ts apps/api/src/workers/retention-artifact-expiry.processor.ts apps/api/src/workers/retention-artifact-expiry.processor.spec.ts apps/api/src/workers/retention-suppression-propagation.processor.ts apps/api/src/workers/retention-suppression-propagation.processor.spec.ts docs/operations/retention/data-rights-runbook.md tests/integration/retention/retention-data-rights.spec.ts
git commit -m "feat(retention): enforce retention data rights"
```

### Task 6: Provar rollout, fallback, SLOs e impacto

**Files:**
- Create: `tests/integration/retention/kill-switch-fallback.spec.ts`
- Create: `tests/integration/retention/scoring-failure-crm-availability.spec.ts`
- Create: `tests/e2e/admin/retention-production-operations.spec.ts`
- Create: `tests/performance/retention/retention-dashboard.k6.js`
- Create: `docs/operations/retention/production-runbook.md`
- Create: `docs/operations/retention/rollback-runbook.md`
- Create: `docs/operations/retention/impact-report.md`
- Create: `docs/operations/retention/mvp-06-readiness-report.md`

- [ ] **Step 1: Executar rollout em estágios**

1. qualidade/snapshots sem exposição;
2. baseline shadow;
3. score apenas gerentes;
4. tarefas limitadas em uma unidade;
5. experimento controlado;
6. expansão baseline;
7. ML shadow por tenant elegível;
8. ML active após promoção.

Cada estágio exige owner, janela, métricas, efeitos adversos, go/no-go e rollback. ML bloqueado não impede chegar a `CORE_ROLLOUT_READY`.

- [ ] **Step 2: Executar bateria adversa**

Run: `pnpm test:integration -- kill-switch-fallback scoring-failure-crm-availability && pnpm test:e2e:admin -- retention-production-operations.spec.ts`
Expected: PASS; fallback <=5 min, CRM disponível e nenhuma ação automática.

- [ ] **Step 3: Executar carga**

Run: `pnpm test:performance -- retention-dashboard.k6.js`
Expected: fila/dashboard paginados p95 < 1 s no perfil aprovado; pipeline diário conclui antes do início operacional.

- [ ] **Step 4: Gerar relatório de impacto**

Inclua cobertura, completude, top-K, tempo/taxa de contato, permanência/reativação, ITT, opt-out/reclamação, custo operacional, limitações e decisão. Status readiness: `CORE_BLOCKED`, `CORE_PILOT_READY`, `CORE_ROLLOUT_READY`, `ML_SHADOW_READY`, `ML_ACTIVE_READY`.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/retention/kill-switch-fallback.spec.ts tests/integration/retention/scoring-failure-crm-availability.spec.ts tests/e2e/admin/retention-production-operations.spec.ts tests/performance/retention/retention-dashboard.k6.js docs/operations/retention/production-runbook.md docs/operations/retention/rollback-runbook.md docs/operations/retention/impact-report.md docs/operations/retention/mvp-06-readiness-report.md
git commit -m "test(retention): verify controlled production rollout"
```

## Verificação final do MVP-06

- [ ] Run: `pnpm retention:gates`
  Expected: core e ML reportados separadamente.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`
  Expected: PASS.
- [ ] Run: `pnpm test:e2e:admin -- retention`
  Expected: PASS para score, tarefa, experimento e operação.
- [ ] Se ML executado: `uv sync --project pipelines/retention-ml --frozen`
  Expected: ambiente reproduzível a partir do lock.
- [ ] Se ML executado: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests -q`
  Expected: PASS.
- [ ] Se ML executado: `uv run --project pipelines/retention-ml ruff check pipelines/retention-ml`
  Expected: PASS.
- [ ] Se ML executado: `uv run --project pipelines/retention-ml mypy pipelines/retention-ml/src`
  Expected: PASS.
- [ ] Confirmar snapshot sem leakage, task sem duplicação, dashboard p95 < 1 s e kill switch <= 5 min.
- [ ] Confirmar que score não altera acesso, cobrança, desconto, mensagem ou label.

## Encerramento

O núcleo termina em `CORE_PILOT_READY` ou `CORE_ROLLOUT_READY` sem depender de ML. `ML_ACTIVE_READY` exige gate e evidência adicionais do trilho opcional.
