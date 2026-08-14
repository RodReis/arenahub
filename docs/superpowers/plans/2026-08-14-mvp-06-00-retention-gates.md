# MVP-06.0 — Gates de Retention AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converter base histórica, point-in-time, privacidade, capacidade, experimento e ML em gates verificáveis antes de cada trilho do MVP-06.

**Architecture:** JSON Schemas definem evidências; manifests registram valores aprovados e hashes. Verificadores falham fechados e distinguem `CORE_BLOCKED`, `CORE_APPROVED`, `ML_BLOCKED` e `ML_APPROVED`. ML não aprovado nunca bloqueia o núcleo baseado em regras.

**Tech Stack:** TypeScript, JSON Schema 2020-12, Ajv, Zod, OpenAPI, contract tests, Jest, scripts pnpm e uv para validação do runtime opcional.

---

## Pré-condições

- Design aprovado em `docs/superpowers/specs/2026-08-14-mvp-06-retention-ai-design.md`.
- PRD `docs/prd/academia/MVP-06-retention-ai.md` aprovado.
- Nenhuma qualidade, capacidade, threshold estatístico, runtime ou regra será registrada como aprovada sem evidência real.

### Task 1: Verificar contratos upstream e histórico as-of

**Files:**
- Create: `docs/operations/retention/upstream-contracts.schema.json`
- Create: `docs/operations/retention/upstream-contracts.json`
- Create: `docs/operations/retention/historical-data-readiness.schema.json`
- Create: `docs/operations/retention/historical-data-readiness.json`
- Create: `scripts/retention/verify-upstream-readiness.ts`
- Create: `scripts/retention/verify-upstream-readiness.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Escrever testes do entry gate**

```ts
it('blocks a source that cannot reproduce first-seen history', async () => {
  await expect(verifyUpstreamReadiness(sourceWithoutFirstSeen)).rejects.toThrow('M6_ENTRY_01_FIRST_SEEN_REQUIRED');
});

it('requires six measured months, not a configured start date', async () => {
  await expect(verifyUpstreamReadiness(shortHistory)).rejects.toThrow('M6_ENTRY_01_HISTORY_INSUFFICIENT');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- verify-upstream-readiness.spec.ts`
Expected: FAIL porque schemas e verificador não existem.

- [ ] **Step 3: Definir manifests de evidência**

Cada evento consumido informa producer owner, schema/version, fixture, contract test, período observado, duplicatas, lacunas e regra de `firstReceivedAt`. Cada feature informa porta as-of e prova de que não consulta estado atual ao reconstruir passado.

```ts
export const requiredRetentionEvents = [
  'PassageConfirmed',
  'InvoiceOverdue',
  'PaymentConfirmed',
  'SubscriptionPaused',
  'SubscriptionCancelled',
  'AssessmentPublished',
  'EngagementOptedOut',
] as const;
```

- [ ] **Step 4: Implementar comando**

Adicione `retention:gates:upstream`. Ele resolve paths, roda contract tests citados e recusa evidência apenas declarativa, schema incompatível ou período com definição instável.

- [ ] **Step 5: Executar verificação**

Run: `pnpm test -- verify-upstream-readiness.spec.ts && pnpm retention:gates:upstream`
Expected: testes PASS; gate mostra bloqueios reais até os MVPs anteriores estarem implementados.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/retention/upstream-contracts.schema.json docs/operations/retention/upstream-contracts.json docs/operations/retention/historical-data-readiness.schema.json docs/operations/retention/historical-data-readiness.json scripts/retention package.json
git commit -m "docs(retention): define historical data gate"
```

### Task 2: Fixar target, features, qualidade e privacidade

**Files:**
- Create: `docs/operations/retention/target-policy.schema.json`
- Create: `docs/operations/retention/target-policy.json`
- Create: `docs/operations/retention/feature-catalog.schema.json`
- Create: `docs/operations/retention/feature-catalog.json`
- Create: `docs/operations/retention/data-quality-policy.schema.json`
- Create: `docs/operations/retention/data-quality-policy.json`
- Create: `docs/operations/retention/privacy-retention-policy.schema.json`
- Create: `docs/operations/retention/privacy-retention-policy.json`
- Create: `scripts/retention/verify-data-policy.ts`
- Create: `scripts/retention/verify-data-policy.spec.ts`

- [ ] **Step 1: Escrever testes de leakage e features proibidas**

```ts
it.each(['diagnosis', 'biometricTemplate', 'bodyComposition', 'inferredRace', 'sex'])(
  'rejects forbidden initial feature %s', feature => {
    expect(() => verifyFeatureCatalog(withFeature(feature))).toThrow('M6_DATA_01_FORBIDDEN_FEATURE');
  },
);

it('requires a 60-day label maturity rule', () => {
  expect(verifyTargetPolicy({ ...policy, maturityDays: 59 })).toMatchObject({ approved: false });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- verify-data-policy.spec.ts`
Expected: FAIL porque políticas e verificador não existem.

- [ ] **Step 3: Registrar contrato completo**

Target fixa observação, feature windows, previsão, confirmação, elegibilidade e timezone. Feature catalog enumera tipo, missing semantics, source port, allowed purpose e quality metric. Privacy policy fixa transparência, supressão, exclusão, retenção de snapshots/datasets/artefatos e audience.

- [ ] **Step 4: Implementar verificações cruzadas**

Recuse feature sem source as-of, missing tratado como zero, target sem versão, threshold sem owner/evidência, retenção incompatível e engagement sem finalidade permitida.

- [ ] **Step 5: Executar testes**

Run: `pnpm test -- verify-data-policy.spec.ts`
Expected: PASS para catálogo aprovado e falha fechada para qualquer decisão ausente.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/retention/target-policy.schema.json docs/operations/retention/target-policy.json docs/operations/retention/feature-catalog.schema.json docs/operations/retention/feature-catalog.json docs/operations/retention/data-quality-policy.schema.json docs/operations/retention/data-quality-policy.json docs/operations/retention/privacy-retention-policy.schema.json docs/operations/retention/privacy-retention-policy.json scripts/retention/verify-data-policy.ts scripts/retention/verify-data-policy.spec.ts
git commit -m "docs(retention): gate target features and privacy"
```

### Task 3: Fixar capacidade, intervenção e experimento

**Files:**
- Create: `docs/operations/retention/operations-policy.schema.json`
- Create: `docs/operations/retention/operations-policy.json`
- Create: `docs/operations/retention/action-templates.schema.json`
- Create: `docs/operations/retention/action-templates.json`
- Create: `docs/operations/retention/experiment-policy.schema.json`
- Create: `docs/operations/retention/experiment-policy.json`
- Create: `docs/operations/retention/retention-permissions.json`
- Create: `scripts/retention/verify-operations-policy.ts`
- Create: `scripts/retention/verify-operations-policy.spec.ts`

- [ ] **Step 1: Escrever testes contra ação automática e cherry-picking**

```ts
it('rejects an action template with automatic execution', () => {
  expect(() => verifyActionTemplate({ ...template, execution: 'AUTOMATIC' })).toThrow('HUMAN_DECISION_REQUIRED');
});

it('requires metric and assignment policy before experiment start', () => {
  expect(() => verifyExperimentPolicy(unfrozenExperiment)).toThrow('EXPERIMENT_POLICY_NOT_FROZEN');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- verify-operations-policy.spec.ts`
Expected: FAIL porque manifests e verificador não existem.

- [ ] **Step 3: Definir operação limitada**

Registre capacidade por unidade/equipe/dia, timezone, SLA, cooldown, status/resultados, canais/finalidades, supressões e segregação de permissões. Template contém apenas roteiro e resultados permitidos; não contém credencial ou chamada de provider.

- [ ] **Step 4: Definir experimento congelado**

Fixe unidade de análise aluno, estratos unidade/faixa baseline, seed/hash versionado, proporção, controle/tratamento, janela, métrica primária, efeitos adversos, tamanho/limitações e análise ITT.

- [ ] **Step 5: Executar testes**

Run: `pnpm test -- verify-operations-policy.spec.ts`
Expected: PASS sem canal automático, capacidade infinita ou métrica mutável.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/retention/operations-policy.schema.json docs/operations/retention/operations-policy.json docs/operations/retention/action-templates.schema.json docs/operations/retention/action-templates.json docs/operations/retention/experiment-policy.schema.json docs/operations/retention/experiment-policy.json docs/operations/retention/retention-permissions.json scripts/retention/verify-operations-policy.ts scripts/retention/verify-operations-policy.spec.ts
git commit -m "docs(retention): gate operations and experiment"
```

### Task 4: Homologar runtime e gate supervisionado por tenant

**Files:**
- Create: `docs/operations/retention/python-runtime.schema.json`
- Create: `docs/operations/retention/python-runtime.json`
- Create: `docs/operations/retention/ml-gate.schema.json`
- Create: `docs/operations/retention/ml-gate.json`
- Create: `docs/operations/retention/model-promotion-policy.schema.json`
- Create: `docs/operations/retention/model-promotion-policy.json`
- Create: `docs/operations/retention/fairness-policy.schema.json`
- Create: `docs/operations/retention/fairness-policy.json`
- Create: `scripts/retention/verify-ml-gate.ts`
- Create: `scripts/retention/verify-ml-gate.spec.ts`

- [ ] **Step 1: Escrever testes do gate opcional**

```ts
it('keeps core approved while ML is statistically blocked', () => {
  expect(verifyMlGate({ positiveLabels: 120, eligibleSnapshots: 800 })).toEqual({ core: 'APPROVED', ml: 'BLOCKED' });
});

it('rejects a shared-tenant dataset', () => {
  expect(() => verifyMlGate(multiTenantDataset)).toThrow('M6_ML_01_SINGLE_TENANT_REQUIRED');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- verify-ml-gate.spec.ts`
Expected: FAIL porque manifests e verificador não existem.

- [ ] **Step 3: Fixar runtime reproduzível**

Manifest registra Python 3.13, uv, scikit-learn 1.7.1, imagem por digest, plataformas, scanner, CPU/memória, network policy e executor homologado. `uv.lock` será source of truth dos pacotes resolvidos; digest e versões reais vêm da evidência, não do plano.

- [ ] **Step 4: Fixar promoção antes do treino**

Por tenant, registre contagens maduras, splits com embargo de 60 dias, dataset checksum, baseline congelada, métricas/thresholds, segmentos permitidos, tamanho mínimo de fairness, explainer aceito, shadow, owner e rollback. Ausência produz `ML_BLOCKED`, não exceção no core.

- [ ] **Step 5: Executar testes**

Run: `pnpm test -- verify-ml-gate.spec.ts`
Expected: PASS para estados separados e recusa de leakage/tenant compartilhado.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/retention/python-runtime.schema.json docs/operations/retention/python-runtime.json docs/operations/retention/ml-gate.schema.json docs/operations/retention/ml-gate.json docs/operations/retention/model-promotion-policy.schema.json docs/operations/retention/model-promotion-policy.json docs/operations/retention/fairness-policy.schema.json docs/operations/retention/fairness-policy.json scripts/retention/verify-ml-gate.ts scripts/retention/verify-ml-gate.spec.ts
git commit -m "docs(retention): add optional supervised model gate"
```

### Task 5: Agregar decisão de readiness sem aprovação fictícia

**Files:**
- Create: `docs/operations/retention/readiness-decision.schema.json`
- Create: `docs/operations/retention/readiness-decision.json`
- Create: `scripts/retention/verify-gates.ts`
- Create: `scripts/retention/verify-gates.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Escrever teste da matriz de decisão**

```ts
it.each([
  [{ coreData: false, ml: false }, 'CORE_BLOCKED'],
  [{ coreData: true, ml: false }, 'CORE_APPROVED_ML_BLOCKED'],
  [{ coreData: true, ml: true }, 'CORE_AND_ML_APPROVED'],
])('maps %j to %s', (input, expected) => expect(decideReadiness(input).status).toBe(expected));
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- verify-gates.spec.ts`
Expected: FAIL porque agregador não existe.

- [ ] **Step 3: Implementar comando agregado**

Adicione `retention:gates`. O relatório lista gate, evidência, hash, owner, validade e ação. `RETENTION_ML_SHADOW/ACTIVE` ficam falsas quando ML está bloqueado; flags core dependem apenas dos gates correspondentes.

- [ ] **Step 4: Executar verificação**

Run: `pnpm test -- verify-gates.spec.ts && pnpm retention:gates`
Expected: verificador PASS; decisão real provavelmente bloqueada até existirem dados/implementação, sem preencher aprovação simulada.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/retention/readiness-decision.schema.json docs/operations/retention/readiness-decision.json scripts/retention/verify-gates.ts scripts/retention/verify-gates.spec.ts package.json
git commit -m "docs(retention): aggregate core and ml readiness"
```

## Verificação da fase

- [ ] Run: `pnpm retention:gates`
  Expected: estados core/ML independentes, evidências resolvíveis e nenhuma aprovação presumida.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm test`
  Expected: PASS.
- [ ] Confirmar ausência de marcador pendente, threshold sem owner, feature proibida e ação automática nos manifests aprovados.

## Próximo plano

Com `M6-ENTRY-01` e `M6-DATA-01` aprovados, executar `2026-08-14-mvp-06-01-data-snapshots.md`.
