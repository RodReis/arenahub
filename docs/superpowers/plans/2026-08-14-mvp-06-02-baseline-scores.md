# MVP-06.2 — Baseline explicável e scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular scores diários reproduzíveis, explicar fatores objetivos e impedir priorização de alunos inelegíveis ou suprimidos.

**Architecture:** Regras declarativas versionadas operam somente sobre snapshots validados. `RetentionScoreProvider` unifica baseline e futuro ML, mas a baseline é o único provider ativo desta slice. Score e explicações são append-only por snapshot/provider version; elegibilidade e supressão são decisões separadas e auditadas.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/BullMQ, Zod, pacote `retention-domain`, outbox, Jest, Testcontainers, OpenAPI e Next.js admin.

---

## Pré-condições

- Slice 6.1 concluída e evidência point-in-time aprovada.
- Catálogo de regras/faixas aprovado; sem expressão JavaScript/SQL.
- `RETENTION_BASELINE=false` fora do piloto.

### Task 1: Modelar regras, scores e explicações append-only

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_retention_baseline_scores/migration.sql`
- Create: `packages/retention-domain/src/scoring/retention-score.ts`
- Create: `packages/retention-domain/src/scoring/retention-score.spec.ts`
- Create: `packages/retention-domain/src/scoring/score-explanation.ts`
- Create: `packages/retention-domain/src/scoring/score-explanation.spec.ts`

- [ ] **Step 1: Escrever testes de invariantes**

```ts
it('does not expose probability when provider is not calibrated', () => {
  expect(createScore({ provider: 'RULE_BASELINE', calibrated: false }).calibratedProbability).toBeNull();
});

it('requires every factor to reference a snapshot feature and rule', () => {
  expect(() => createExplanation({ featureKey: 'unknown', ruleVersionId, snapshotSchema })).toThrow('EXPLANATION_FEATURE_NOT_FOUND');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- retention-score score-explanation`
Expected: FAIL porque domínio não existe.

- [ ] **Step 3: Adicionar modelos**

Crie `RetentionRule`, `RetentionRuleVersion`, `RetentionScore`, `RetentionScoreExplanation`, `RetentionScoringRun` e `RetentionSuppression`.

```ts
export type RetentionScoreProviderType = 'RULE_BASELINE' | 'SUPERVISED_MODEL';
export type RetentionRiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RetentionSuppressionReason = 'OPT_OUT' | 'DELETION_PENDING' | 'CANCELLED' | 'LEGAL_HOLD' | 'MANUAL_WITH_REASON';
```

Unique score: tenant/snapshot/provider version. Explicação possui ordem, direção, feature key, rule/model reference e template version. Nenhuma migration calcula risco a partir de estado atual.

- [ ] **Step 4: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name retention_baseline_scores && pnpm --filter @arenahub/retention-domain test -- retention-score score-explanation`
Expected: PASS para faixa, completude, probabilidade nula e provenance.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma packages/retention-domain/src/scoring
git commit -m "feat(retention): model explainable scores"
```

### Task 2: Implementar motor declarativo da baseline

**Files:**
- Create: `packages/retention-domain/src/scoring/retention-rule.ts`
- Create: `packages/retention-domain/src/scoring/retention-rule.spec.ts`
- Create: `packages/retention-domain/src/scoring/evaluate-baseline.ts`
- Create: `packages/retention-domain/src/scoring/evaluate-baseline.spec.ts`
- Create: `apps/api/src/modules/retention-scoring/infrastructure/retention-rule-catalog.loader.ts`
- Create: `apps/api/src/modules/retention-scoring/infrastructure/retention-rule-catalog.loader.spec.ts`

- [ ] **Step 1: Escrever golden tests de regras**

```ts
it('does not add risk for a missing feature', () => {
  const result = evaluateBaseline(snapshotWithMissing('days_past_due'), rules);
  expect(result.factors).not.toContainEqual(expect.objectContaining({ featureKey: 'days_past_due', direction: 'INCREASE' }));
});

it('is deterministic for the same snapshot and version', () => {
  expect(evaluateBaseline(snapshot, v1)).toEqual(evaluateBaseline(snapshot, v1));
});
```

Cubra queda de frequência, ausência, cobrança vencida, falhas, pausa, avaliação, limites exatos, factors positivos/negativos e máximo cinco fatores.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- retention-rule evaluate-baseline`
Expected: FAIL porque interpretador não existe.

- [ ] **Step 3: Implementar allowlist declarativa**

```ts
export type RetentionRuleOperator =
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'PERCENT_DROP_AT_LEAST'
  | 'IS_PRESENT';
```

Loader verifica schema/hash/status/effectiveAt e recusa regra alterada sem nova versão, feature proibida, pesos negativos não autorizados ou expressão executável.

- [ ] **Step 4: Implementar faixa e fatores**

Some apenas regras com feature presente. Ordene fatores por contribuição absoluta e tie-break estável pela rule ID. Faixas vêm da versão; score numérico interno não é apresentado como probabilidade.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/retention-domain test -- retention-rule evaluate-baseline && pnpm --filter api test -- retention-rule-catalog.loader.spec.ts`
Expected: PASS para golden fixtures e catálogo adulterado.

- [ ] **Step 6: Commit**

```bash
git add packages/retention-domain/src/scoring apps/api/src/modules/retention-scoring/infrastructure
git commit -m "feat(retention): evaluate deterministic baseline"
```

### Task 3: Implementar provider, elegibilidade e supressão

**Files:**
- Create: `apps/api/src/modules/retention-scoring/ports/retention-score-provider.port.ts`
- Create: `apps/api/src/modules/retention-scoring/ports/score-provider-registry.port.ts`
- Create: `apps/api/src/modules/retention-scoring/adapters/rule-baseline-score.provider.ts`
- Create: `apps/api/src/modules/retention-scoring/adapters/rule-baseline-score.provider.spec.ts`
- Create: `apps/api/src/modules/retention-scoring/infrastructure/nest-score-provider-registry.ts`
- Create: `apps/api/src/modules/retention-scoring/infrastructure/nest-score-provider-registry.spec.ts`
- Create: `apps/api/src/modules/retention-scoring/application/evaluate-retention-eligibility.use-case.ts`
- Create: `apps/api/src/modules/retention-scoring/application/evaluate-retention-eligibility.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-scoring/application/calculate-retention-score.use-case.ts`
- Create: `apps/api/src/modules/retention-scoring/application/calculate-retention-score.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-scoring/infrastructure/retention-score.repository.ts`

- [ ] **Step 1: Escrever testes de inelegibilidade**

```ts
it.each(['CANCELLED', 'INSUFFICIENT_HISTORY', 'DELETION_PENDING', 'OPT_OUT'])(
  'stores decision but does not score an ineligible student: %s', async reason => {
    const result = await calculate.execute(commandFor(reason));
    expect(result).toMatchObject({ scored: false, reason });
  },
);
```

Teste `ACTIVE`, `PAST_DUE`, completude abaixo do threshold, supressão expirada, outro tenant e feature set incompatível.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- evaluate-retention-eligibility calculate-retention-score rule-baseline-score.provider`
Expected: FAIL porque provider e casos de uso não existem.

- [ ] **Step 3: Definir contrato do provider**

```ts
export interface RetentionScoreProvider {
  score(input: { tenantId: string; snapshot: RetentionFeatureSnapshot; providerVersionId: string }): Promise<RetentionScoreResult>;
}
```

Nesta slice, o caso de uso obtém o provider default do registry, que contém somente baseline. Ele revalida tenant, snapshot, qualidade e supressão antes de chamar provider. A configuração ativa é conectada apenas na Slice 6.6, depois que monitoramento/fallback existem.

`ScoreProviderRegistryPort` registra a baseline por token NestJS e permite que o módulo opcional adicione o provider supervisionado sem mudar o caso de uso.

- [ ] **Step 4: Persistir score/outbox atomicamente**

Insira score, fatores e `RetentionScoreCalculated` em uma transação. Emita `RetentionRiskIncreased` somente quando a faixa aumenta em relação ao score comparável anterior; retry retorna existente.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- evaluate-retention-eligibility calculate-retention-score rule-baseline-score.provider nest-score-provider-registry`
Expected: PASS para elegibilidade, supressão, retry e risk increase.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-scoring
git commit -m "feat(retention): calculate eligible baseline scores"
```

### Task 4: Processar scores diariamente e marcar staleness

**Files:**
- Create: `apps/api/src/workers/retention-score-trigger.processor.ts`
- Create: `apps/api/src/workers/retention-score-trigger.processor.spec.ts`
- Create: `apps/api/src/workers/retention-score.processor.ts`
- Create: `apps/api/src/workers/retention-score.processor.spec.ts`
- Create: `apps/api/src/workers/retention-score-expiry.processor.ts`
- Create: `apps/api/src/workers/retention-score-expiry.processor.spec.ts`
- Create: `packages/contracts/src/retention/retention-score-calculated.event.ts`
- Create: `packages/contracts/src/retention/retention-risk-increased.event.ts`

- [ ] **Step 1: Escrever testes de schedule/replay**

Garanta que score inicia depois do snapshot validado, termina antes do horário operacional configurado, processa por páginas e não duplica em 100 replays.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- retention-score-trigger retention-score.processor retention-score-expiry`
Expected: FAIL porque processors não existem.

- [ ] **Step 3: Implementar triggers e worker**

Scheduler cria trigger; trigger adiciona jobs deduplicados por tenant/snapshot/provider version. Database unique é garantia final. Falha de contrato usa erro não recuperável; indisponibilidade transitória usa backoff.

- [ ] **Step 4: Implementar validade**

Expiry marca projeção `STALE`/`EXPIRED` sem alterar score histórico. `STALE` mostra idade; `EXPIRED` não participa de nova priorização. Policy define limites e alerta.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- retention-score-trigger retention-score.processor retention-score-expiry`
Expected: PASS para atraso, retry, DLQ e expiração.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/retention-score-trigger.processor.ts apps/api/src/workers/retention-score-trigger.processor.spec.ts apps/api/src/workers/retention-score.processor.ts apps/api/src/workers/retention-score.processor.spec.ts apps/api/src/workers/retention-score-expiry.processor.ts apps/api/src/workers/retention-score-expiry.processor.spec.ts packages/contracts/src/retention
git commit -m "feat(retention): schedule and expire baseline scores"
```

### Task 5: Expor scores e explicações para operação

**Files:**
- Create: `apps/api/src/modules/retention-scoring/admin-retention-scores.controller.ts`
- Create: `apps/api/src/modules/retention-scoring/admin-retention-scores.controller.spec.ts`
- Create: `apps/api/src/modules/retention-scoring/retention-scoring.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/retention-scores.ts`
- Create: `apps/admin-web/app/(protected)/retention/scores/page.tsx`
- Create: `apps/admin-web/app/(protected)/retention/students/[studentId]/page.tsx`
- Create: `apps/admin-web/components/retention/RetentionScoreList.tsx`
- Create: `apps/admin-web/components/retention/RetentionScoreHistory.tsx`
- Create: `apps/admin-web/components/retention/RetentionScores.test.tsx`

- [ ] **Step 1: Escrever testes HTTP/UI**

Cubra `GET /api/v1/retention/scores` e `GET /api/v1/retention/students/:studentId/history`, cursor, tenant/unidade, role, completude, até cinco fatores, stale/expired e aviso de estimativa.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- admin-retention-scores.controller.spec.ts && pnpm --filter admin-web test -- RetentionScores.test.tsx`
Expected: FAIL porque endpoints e telas não existem.

- [ ] **Step 3: Implementar DTO minimizado e telas**

Lista não retorna vetor. Histórico mostra faixa/data/provider/version/completude/fatores e evolução. Probabilidade fica ausente quando `calibratedProbability=null`; nenhuma cor isolada comunica risco.

- [ ] **Step 4: Gerar OpenAPI e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- admin-retention-scores.controller.spec.ts && pnpm --filter admin-web test -- RetentionScores.test.tsx`
Expected: PASS com pílulas textuais, teclado, leitor de tela e autorização por objeto.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-scoring apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/retention-scores.ts "apps/admin-web/app/(protected)/retention" apps/admin-web/components/retention
git commit -m "feat(retention): expose explainable risk history"
```

### Task 6: Provar reexecução, lineage e isolamento

**Files:**
- Create: `tests/integration/retention/baseline-replay-lineage.spec.ts`
- Create: `tests/integration/retention/suppressed-student-score.spec.ts`
- Create: `docs/operations/retention/baseline-rebuild-runbook.md`
- Create: `docs/operations/retention/baseline-evidence.json`

- [ ] **Step 1: Criar cenário adverso**

Inclua 100 replays, regra v1/v2, missing, snapshot adulterado, opt-out, cancelamento, tenant B e falha antes/depois do outbox.

- [ ] **Step 2: Executar integração**

Run: `pnpm test:integration -- baseline-replay-lineage suppressed-student-score`
Expected: PASS; um score por versão/snapshot, fatores apontam lineage correto e suprimido não é priorizável.

- [ ] **Step 3: Documentar rebuild**

Runbook fixa versão, high-water, shadow table, diff/checksum, swap e rollback. Regra nova não reescreve score antigo.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/retention/baseline-replay-lineage.spec.ts tests/integration/retention/suppressed-student-score.spec.ts docs/operations/retention/baseline-rebuild-runbook.md docs/operations/retention/baseline-evidence.json
git commit -m "test(retention): prove baseline replay and lineage"
```

## Verificação da slice

- [ ] Run: `pnpm --filter @arenahub/retention-domain test -- scoring`
  Expected: PASS.
- [ ] Run: `pnpm --filter api test -- retention-scoring retention-score`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- baseline-replay-lineage suppressed-student-score`
  Expected: PASS.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com baseline e scores estáveis, executar `2026-08-14-mvp-06-03-retention-crm.md`.
