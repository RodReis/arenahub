# MVP-06.5 — ML supervisionado opcional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treinar, avaliar e executar shadow predictions por tenant com pipeline Python reproduzível, sem acesso direto ao banco ou capacidade de criar tarefas.

**Architecture:** NestJS exporta dataset imutável e pseudonimizado para S3, registra lineage e entrega um job manifest ao runner aprovado. `pipelines/retention-ml` valida schemas, treina com splits temporais/embargo, grava artefato/model card/predictions e checksum. NestJS importa somente batch completo e shadow. O executor de produção é um adapter condicionado ao `python-runtime.json`; local CLI serve apenas a testes.

**Tech Stack:** Python 3.13, uv + `uv.lock`, scikit-learn 1.7.1, pandas 2.x, pyarrow, pydantic, pytest, ruff, mypy, NestJS, Prisma/PostgreSQL, MinIO/S3 privado, Zod/JSON Schema e Testcontainers.

---

## Pré-condições

- Slices 6.1 e 6.2 concluídas.
- `M6-ML-01=ML_APPROVED` para o tenant alvo.
- Runtime/runner por digest, splits, baseline e promotion policy aprovados.
- `RETENTION_ML_SHADOW=false` e `RETENTION_ML_ACTIVE=false`.
- Se o gate não passar, registrar `ML_BLOCKED` e encerrar este plano sem impactar o core.

### Task 1: Modelar datasets, modelos, avaliações e batches

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_retention_model_registry/migration.sql`
- Create: `packages/contracts/schemas/retention/dataset-manifest.schema.json`
- Create: `packages/contracts/schemas/retention/model-run-manifest.schema.json`
- Create: `packages/contracts/schemas/retention/model-evaluation.schema.json`
- Create: `packages/contracts/schemas/retention/prediction-batch.schema.json`
- Create: `packages/contracts/src/retention/model-governance.contracts.ts`
- Create: `packages/contracts/src/retention/model-governance.contracts.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/domain/model-version.ts`
- Create: `apps/api/src/modules/retention-model-governance/domain/model-version.spec.ts`

- [ ] **Step 1: Escrever testes de tenant e lineage**

```ts
it('rejects a dataset manifest containing more than one tenant', () => {
  expect(() => datasetManifestSchema.parse(multiTenantManifest)).toThrow();
});

it('does not allow a model without dataset code environment and metrics lineage', () => {
  expect(() => registerModel(incompleteVersion)).toThrow('MODEL_LINEAGE_INCOMPLETE');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/contracts test -- model-governance && pnpm --filter api test -- model-version`
Expected: FAIL porque schemas/modelos não existem.

- [ ] **Step 3: Adicionar modelos**

Crie `RetentionDatasetVersion`, `RetentionDatasetObject`, `RetentionModelVersion`, `RetentionModelEvaluation`, `RetentionPredictionBatch`, `RetentionPrediction`, `RetentionMlJob` e `RetentionModelStateTransition`.

```ts
export type RetentionModelStatus = 'CANDIDATE' | 'EVALUATED' | 'REJECTED' | 'SHADOW_READY' | 'SHADOW' | 'ACTIVE' | 'DISABLED' | 'EXPIRED';
export type RetentionMlJobStatus = 'CREATED' | 'DISPATCHED' | 'RUNNING' | 'OUTPUT_READY' | 'IMPORTED' | 'FAILED';
```

Objects guardam bucket/key, checksum, size, encryption/retention tag; nunca URL permanente. Registry é sempre tenant-scoped.

- [ ] **Step 4: Aplicar migration e validar schemas**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name retention_model_registry && pnpm --filter @arenahub/contracts test -- model-governance && pnpm --filter api test -- model-version`
Expected: PASS para status, tenant único, lineage e transições.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma packages/contracts/schemas/retention packages/contracts/src/retention apps/api/src/modules/retention-model-governance/domain
git commit -m "feat(retention): model tenant-scoped ml registry"
```

### Task 2: Exportar dataset imutável e pseudonimizado

**Files:**
- Create: `apps/api/src/modules/retention-model-governance/application/create-retention-dataset.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/create-retention-dataset.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/domain/dataset-split-policy.ts`
- Create: `apps/api/src/modules/retention-model-governance/domain/dataset-split-policy.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/ports/model-artifact-storage.port.ts`
- Create: `apps/api/src/modules/retention-model-governance/infrastructure/s3-model-artifact-storage.adapter.ts`
- Create: `apps/api/src/modules/retention-model-governance/infrastructure/s3-model-artifact-storage.adapter.spec.ts`
- Create: `apps/api/src/workers/retention-dataset-export.processor.ts`
- Create: `apps/api/src/workers/retention-dataset-export.processor.spec.ts`

- [ ] **Step 1: Escrever testes de split e minimização**

```ts
it('embargoes 60 days between observation windows', () => {
  expect(validateSplits({ trainEnd, validationStart: addDays(trainEnd, 59) })).toMatchObject({ valid: false });
});

it('exports no direct identifier or forbidden feature', async () => {
  const columns = await parquetColumns(await exportDataset(tenant));
  expect(columns).toEqual(expect.not.arrayContaining(['studentId', 'name', 'email', 'cpf', 'diagnosis', 'bodyComposition']));
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- create-retention-dataset dataset-split-policy s3-model-artifact-storage retention-dataset-export`
Expected: FAIL porque exportador e porta não existem.

- [ ] **Step 3: Implementar dataset por cursor**

Selecione somente snapshots do target/feature set/tenant aprovados, labels maduras e quality threshold. Gere `subject_key` por HMAC tenant-specific, escreva Parquet multipart em prefixo privado do job e calcule SHA-256 durante stream. Nunca carregue o dataset completo em memória.

- [ ] **Step 4: Implementar split temporal congelado**

Manifest lista ranges train/validation/test, embargo de 60 dias, contagens/prevalência, feature schema, missing rates, source checksums e baseline version. Nenhuma linha escolhe split aleatório.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- create-retention-dataset dataset-split-policy s3-model-artifact-storage retention-dataset-export`
Expected: PASS para storage privado, checksum, embargo, single tenant e retry idempotente.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-model-governance apps/api/src/workers/retention-dataset-export.processor.ts apps/api/src/workers/retention-dataset-export.processor.spec.ts
git commit -m "feat(retention): export immutable training datasets"
```

### Task 3: Criar pacote Python reproduzível e contratos

**Files:**
- Create: `pipelines/retention-ml/pyproject.toml`
- Create: `pipelines/retention-ml/.python-version`
- Create: `pipelines/retention-ml/uv.lock`
- Create: `pipelines/retention-ml/src/retention_ml/__init__.py`
- Create: `pipelines/retention-ml/src/retention_ml/contracts.py`
- Create: `pipelines/retention-ml/src/retention_ml/io.py`
- Create: `pipelines/retention-ml/src/retention_ml/cli.py`
- Create: `pipelines/retention-ml/tests/test_contracts.py`
- Create: `pipelines/retention-ml/tests/test_io_security.py`
- Create: `pipelines/retention-ml/README.md`
- Modify: `package.json`

- [ ] **Step 1: Escrever testes Python que falham**

```python
def test_rejects_multi_tenant_manifest():
    with pytest.raises(ContractError, match="SINGLE_TENANT_REQUIRED"):
        DatasetManifest.model_validate(multi_tenant_manifest())

def test_rejects_checksum_mismatch(tmp_path):
    with pytest.raises(ArtifactIntegrityError):
        read_verified_parquet(tampered_file(tmp_path), expected_sha256="0" * 64)
```

- [ ] **Step 2: Criar pyproject e lock**

```toml
[project]
name = "arenahub-retention-ml"
version = "0.1.0"
requires-python = ">=3.13,<3.14"
dependencies = [
  "pandas>=2.3,<3",
  "pyarrow>=20,<24",
  "pydantic>=2.11,<3",
  "scikit-learn==1.7.1",
]

[dependency-groups]
dev = ["mypy>=1.17,<2", "pytest>=8,<9", "pytest-cov>=6,<8", "ruff>=0.12,<1"]

[project.scripts]
retention-ml = "retention_ml.cli:main"
```

Run: `uv lock --project pipelines/retention-ml`
Expected: `uv.lock` criado.

Run: `uv sync --project pipelines/retention-ml --frozen`
Expected: ambiente sincronizado sem atualizar o lock.

- [ ] **Step 3: Executar e confirmar falha dos testes**

Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests/test_contracts.py pipelines/retention-ml/tests/test_io_security.py -q`
Expected: FAIL porque contratos/IO ainda não foram implementados.

- [ ] **Step 4: Implementar validação e IO seguro**

Carregue manifests contra JSON Schema compartilhado e modelos Pydantic. Recuse path traversal, URI fora do prefixo do job, schema extra, checksum/size divergente e tenant mismatch. Logs usam job/model/dataset IDs; nunca linhas/features.

- [ ] **Step 5: Executar qualidade Python**

Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests -q`
Expected: PASS.

Run: `uv run --project pipelines/retention-ml ruff check pipelines/retention-ml`
Expected: PASS.

Run: `uv run --project pipelines/retention-ml mypy pipelines/retention-ml/src`
Expected: PASS.

- [ ] **Step 6: Adicionar comandos raiz e commit**

Adicione `retention:ml:sync`, `retention:ml:test`, `retention:ml:lint` e `retention:ml:typecheck` usando `uv --project pipelines/retention-ml`.

```bash
git add pipelines/retention-ml package.json
git commit -m "build(retention): add reproducible python ml pipeline"
```

### Task 4: Treinar e avaliar candidatos temporais

**Files:**
- Create: `pipelines/retention-ml/src/retention_ml/preprocessing.py`
- Create: `pipelines/retention-ml/src/retention_ml/models.py`
- Create: `pipelines/retention-ml/src/retention_ml/train.py`
- Create: `pipelines/retention-ml/src/retention_ml/evaluate.py`
- Create: `pipelines/retention-ml/src/retention_ml/explain.py`
- Create: `pipelines/retention-ml/src/retention_ml/model_card.py`
- Create: `pipelines/retention-ml/tests/test_point_in_time_training.py`
- Create: `pipelines/retention-ml/tests/test_temporal_splits.py`
- Create: `pipelines/retention-ml/tests/test_reproducibility.py`
- Create: `pipelines/retention-ml/tests/test_evaluation_gate.py`
- Create: `pipelines/retention-ml/tests/test_explanations.py`

- [ ] **Step 1: Escrever testes de leakage e promoção**

```python
def test_preprocessing_is_fit_only_on_training_rows():
    result = train_with_spy_transformer(dataset_fixture())
    assert result.fit_observation_dates <= set(result.splits.train_dates)

def test_candidate_without_baseline_gain_is_rejected():
    decision = evaluate_candidate(candidate_metrics=weaker_than_baseline(), frozen_policy=policy())
    assert decision.status == "REJECTED_NO_GAIN"
```

Cubra label imatura, split overlap, embargo, seed, missing indicator, top-K capacity, calibração, PR-AUC, fairness cell pequena e tenant mismatch.

- [ ] **Step 2: Executar e confirmar falha**

Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests/test_point_in_time_training.py pipelines/retention-ml/tests/test_temporal_splits.py pipelines/retention-ml/tests/test_reproducibility.py pipelines/retention-ml/tests/test_evaluation_gate.py pipelines/retention-ml/tests/test_explanations.py -q`
Expected: FAIL porque pipeline não existe.

- [ ] **Step 3: Implementar pipelines scikit-learn**

Use `Pipeline`/`ColumnTransformer`; imputer/indicator/scaler são fit apenas em treino. Logistic regression usa class weighting somente se a policy congelada autorizar e calibração fit sem tocar no teste. HistGradientBoosting é challenger de avaliação.

```python
logistic_pipeline = Pipeline([
    ("preprocessor", build_preprocessor(feature_schema)),
    ("classifier", LogisticRegression(random_state=seed, max_iter=2000)),
])
```

- [ ] **Step 4: Implementar métricas e explicações**

Calcule prevalência, precision/recall at K, average precision, calibration bins, temporal stability e fairness permitida. Logistic factors usam contribuições feature×coeficiente revertidas para feature original. Gradient booster sem explainer aprovado recebe `EVALUATION_ONLY` e não pode shadow/promote.

- [ ] **Step 5: Executar testes**

Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests -q`
Expected: PASS e duas execuções com mesmo dataset/seed/environment produzem mesmo metrics checksum.

Run: `uv run --project pipelines/retention-ml ruff check pipelines/retention-ml`
Expected: PASS.

Run: `uv run --project pipelines/retention-ml mypy pipelines/retention-ml/src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add pipelines/retention-ml
git commit -m "feat(retention): train temporally validated churn models"
```

### Task 5: Orquestrar runner, artefatos e registry

**Files:**
- Create: `apps/api/src/modules/retention-model-governance/ports/retention-ml-runner.port.ts`
- Create: `apps/api/src/modules/retention-model-governance/adapters/local-cli-retention-ml.runner.ts`
- Create: `apps/api/src/modules/retention-model-governance/adapters/local-cli-retention-ml.runner.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/request-model-training.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/request-model-training.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/import-model-run.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/import-model-run.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/infrastructure/retention-model.repository.ts`
- Create: `apps/api/src/workers/retention-model-run.processor.ts`
- Create: `apps/api/src/workers/retention-model-run.processor.spec.ts`
- Create: `docs/operations/retention/ml-runner-adapter-gate.md`

- [ ] **Step 1: Escrever testes de trust boundary**

```ts
it('imports nothing from a partial or unsigned run', async () => {
  await expect(importRun.execute(partialOutput)).rejects.toMatchObject({ code: 'MODEL_RUN_OUTPUT_INVALID' });
  expect(await modelRepository.count()).toBe(0);
});
```

Teste gate expirado, tenant mismatch, artifact checksum, dataset mismatch, duplicate job e subprocess argument injection.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- local-cli-retention-ml.runner request-model-training import-model-run retention-model-run.processor`
Expected: FAIL porque porta/adapters não existem.

- [ ] **Step 3: Implementar porta e adapter local seguro**

```ts
export interface RetentionMlRunnerPort {
  dispatch(job: { jobId: string; tenantId: string; inputManifestObjectKey: string }): Promise<{ externalRunId: string }>;
}
```

Adapter local usa executable/args fixos do manifesto, `shell:false`, timeout, cwd dedicado e environment allowlist. Ele é habilitado apenas em dev/test. Produção exige adapter específico referenciado por `python-runtime.json` e plano complementar com os mesmos contract tests.

- [ ] **Step 4: Implementar importação atômica**

Valide manifests/schemas/checksums/model card/policy antes de registrar model/evaluation/artifacts. Estado final é `REJECTED`, `EVALUATED` ou `SHADOW_READY`; nunca `ACTIVE` nesta task.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- local-cli-retention-ml.runner request-model-training import-model-run retention-model-run.processor`
Expected: PASS para retry, adulteração e isolamento.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-model-governance apps/api/src/workers/retention-model-run.processor.ts apps/api/src/workers/retention-model-run.processor.spec.ts docs/operations/retention/ml-runner-adapter-gate.md
git commit -m "feat(retention): register trusted model runs"
```

### Task 6: Executar shadow batch e comparar providers

**Files:**
- Create: `pipelines/retention-ml/src/retention_ml/predict.py`
- Create: `pipelines/retention-ml/tests/test_prediction_batch.py`
- Create: `apps/api/src/modules/retention-model-governance/application/activate-model-shadow.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/activate-model-shadow.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/import-shadow-predictions.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/import-shadow-predictions.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/compare-retention-providers.use-case.ts`
- Create: `apps/api/src/modules/retention-model-governance/application/compare-retention-providers.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/adapters/supervised-model-score.provider.ts`
- Create: `apps/api/src/modules/retention-model-governance/adapters/supervised-model-score.provider.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/admin-retention-models.controller.ts`
- Create: `apps/api/src/modules/retention-model-governance/admin-retention-models.controller.spec.ts`
- Create: `apps/api/src/modules/retention-model-governance/retention-model-governance.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/retention-models.ts`
- Create: `apps/admin-web/app/(protected)/retention/models/page.tsx`
- Create: `apps/admin-web/components/retention/RetentionModelRegistry.tsx`
- Create: `apps/admin-web/components/retention/RetentionModelRegistry.test.tsx`

- [ ] **Step 1: Escrever testes de shadow**

Teste batch com todos snapshots esperados, prediction duplicate, factors coerentes, modelo/dataset/tenant errado, shadow sem afetar task priority e comparação com mesma cohort/high-water.

- [ ] **Step 2: Executar e confirmar falha**

Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests/test_prediction_batch.py -q`
Expected: FAIL porque predict não existe.

Run: `pnpm --filter api test -- activate-model-shadow import-shadow-predictions compare-retention-providers admin-retention-models.controller.spec.ts`
Expected: FAIL porque shadow/API não existem.

- [ ] **Step 3: Implementar prediction batch completo**

Python carrega somente artefato do próprio trusted run/checksum, gera band/probabilidade/fatores e manifest final. NestJS importa em staging, valida contagem/checksum e troca batch para `IMPORTED` atomicamente. Shadow predictions nunca entram no selector de tarefas.

`SupervisedModelScoreProvider` implementa o contrato da Slice 6.2 usando apenas prediction batch importado para o mesmo snapshot/model/tenant. Registre-o no `ScoreProviderRegistryPort`; enquanto o model state não for `ACTIVE`, o resolver continua retornando baseline.

- [ ] **Step 4: Implementar APIs e UI de governança**

Cubra `GET /api/v1/retention/models` e `POST /api/v1/retention/models/:id/activate-shadow`. Mostre dataset/code/environment, splits, baseline comparison, calibration, fairness, limitações e shadow age. Sem botão promover nesta slice.

- [ ] **Step 5: Gerar contratos e executar bateria**

Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests -q`
Expected: PASS.

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- retention-model-governance && pnpm --filter admin-web test -- RetentionModelRegistry.test.tsx`
Expected: PASS; priority/task idênticas com shadow ligado/desligado.

- [ ] **Step 6: Commit**

```bash
git add pipelines/retention-ml apps/api/src/modules/retention-model-governance apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/retention-models.ts "apps/admin-web/app/(protected)/retention/models" apps/admin-web/components/retention
git commit -m "feat(retention): compare supervised models in shadow"
```

### Task 7: Provar pipeline temporal e isolamento ponta a ponta

**Files:**
- Create: `tests/integration/retention/ml-dataset-tenant-isolation.spec.ts`
- Create: `tests/integration/retention/ml-shadow-no-task-impact.spec.ts`
- Create: `pipelines/retention-ml/tests/test_end_to_end_pipeline.py`
- Create: `docs/operations/retention/model-training-runbook.md`
- Create: `docs/operations/retention/model-card-template.md`
- Create: `docs/operations/retention/ml-shadow-evidence.json`

- [ ] **Step 1: Montar fixture temporal adversa**

Inclua late events, label imatura, 2 tenants, missing, drift artificial, split embargo, artefato adulterado e baseline melhor que candidato.

- [ ] **Step 2: Executar E2E técnico**

Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests/test_end_to_end_pipeline.py -q`
Expected: PASS; tenant único, nenhum leakage e candidato fraco rejeitado.

Run: `pnpm test:integration -- ml-dataset-tenant-isolation ml-shadow-no-task-impact`
Expected: PASS; shadow sem task effect.

- [ ] **Step 3: Documentar treino/reprodução**

Runbook registra gate, dataset, environment, command, checksums, métricas, model card, shadow, expiração e remoção. Template inclui uso proibido e limitações.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/retention/ml-dataset-tenant-isolation.spec.ts tests/integration/retention/ml-shadow-no-task-impact.spec.ts pipelines/retention-ml/tests/test_end_to_end_pipeline.py docs/operations/retention/model-training-runbook.md docs/operations/retention/model-card-template.md docs/operations/retention/ml-shadow-evidence.json
git commit -m "test(retention): prove optional ml pipeline"
```

## Verificação da slice opcional

- [ ] Run: `pnpm retention:gates`
  Expected: `CORE_AND_ML_APPROVED` para o tenant executado.
- [ ] Run: `uv sync --project pipelines/retention-ml --frozen`
  Expected: ambiente reproduzível a partir do lock.
- [ ] Run: `uv run --project pipelines/retention-ml pytest pipelines/retention-ml/tests -q`
  Expected: PASS.
- [ ] Run: `uv run --project pipelines/retention-ml ruff check pipelines/retention-ml`
  Expected: PASS.
- [ ] Run: `uv run --project pipelines/retention-ml mypy pipelines/retention-ml/src`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- ml-dataset-tenant-isolation ml-shadow-no-task-impact`
  Expected: PASS.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com shadow aprovado, `2026-08-14-mvp-06-06-production-monitoring.md` pode planejar promoção. Sem `M6-ML-01`, pule este arquivo e execute produção baseline.
