# MVP-06.1 — Contrato de dados e snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materializar snapshots diários reproduzíveis e labels maduras usando apenas fatos conhecidos na data de observação.

**Architecture:** Uma inbox retention preserva o primeiro recebimento de cada evento. O pacote puro `retention-domain` calcula janelas e features a partir de fatos as-of. Snapshots são imutáveis por versão/data/revisão, guardam valores validados, missing/quality, watermarks e checksum. Labels vivem separadas e amadurecem após a janela completa.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/BullMQ, Zod, Node crypto, MinIO/S3 privado, Jest, fast-check, Testcontainers, Next.js admin e OpenAPI.

---

## Pré-condições

- `M6-ENTRY-01` e `M6-DATA-01` aprovados.
- Contratos upstream e `target-policy.json` disponíveis no commit-base.
- `RETENTION_BASELINE=false` e nenhuma tela individual de score ativa.

### Task 1: Criar domínio e persistência versionada

**Files:**
- Create: `packages/retention-domain/package.json`
- Create: `packages/retention-domain/tsconfig.json`
- Create: `packages/retention-domain/src/index.ts`
- Create: `packages/retention-domain/src/target/retention-target.ts`
- Create: `packages/retention-domain/src/target/retention-target.spec.ts`
- Create: `packages/retention-domain/src/features/feature-snapshot.ts`
- Create: `packages/retention-domain/src/features/feature-snapshot.spec.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_retention_data_contracts/migration.sql`

- [ ] **Step 1: Escrever testes de invariantes**

```ts
it('keeps missing distinct from observed zero', () => {
  expect(createFeatureValue({ value: null, missingReason: 'NO_HISTORY' })).not.toEqual(
    createFeatureValue({ value: 0, missingReason: null }),
  );
});

it('requires target maturity to cover prediction and confirmation windows', () => {
  expect(() => createTargetVersion({ predictionDays: 30, confirmationDays: 30, maturityDays: 59 })).toThrow(
    'TARGET_MATURITY_TOO_SHORT',
  );
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- retention-target feature-snapshot`
Expected: FAIL porque pacote e tipos não existem.

- [ ] **Step 3: Adicionar modelos aditivos**

Crie `RetentionTargetVersion`, `RetentionFeatureDefinition`, `RetentionFeatureSetVersion`, `RetentionEventInbox`, `StudentFeatureSnapshot`, `RetentionLabel` e `RetentionDataQualityReport`.

```ts
export type RetentionLabelStatus = 'IMMATURE' | 'POSITIVE' | 'NEGATIVE' | 'EXCLUDED';
export type FeatureMissingReason = 'NO_HISTORY' | 'SOURCE_UNAVAILABLE' | 'NOT_APPLICABLE' | 'SUPPRESSED';
```

Snapshot possui `observationAt`, `knowledgeCutoffAt`, `revision`, `featureValues` JSON validado, `completeness`, quality flags, source watermarks e checksum. Unique: tenant/aluno/observation/target/feature set/revision.

- [ ] **Step 4: Aplicar migration**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name retention_data_contracts`
Expected: migration aplicada sem tabela global sem tenant e sem backfill de feature ausente como zero.

- [ ] **Step 5: Implementar domínio e executar testes**

Run: `pnpm --filter @arenahub/retention-domain test -- retention-target feature-snapshot`
Expected: PASS para missing, checksum canônico, target e revisão.

- [ ] **Step 6: Commit**

```bash
git add packages/retention-domain packages/database/prisma
git commit -m "feat(retention): model versioned feature snapshots"
```

### Task 2: Ingerir eventos preservando first-seen

**Files:**
- Create: `apps/api/src/modules/retention-data-contracts/application/ingest-retention-event.use-case.ts`
- Create: `apps/api/src/modules/retention-data-contracts/application/ingest-retention-event.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-data-contracts/infrastructure/retention-event-inbox.repository.ts`
- Create: `apps/api/src/modules/retention-data-contracts/domain/retention-source-event.ts`
- Create: `apps/api/src/modules/retention-data-contracts/domain/retention-source-event.spec.ts`
- Create: `apps/api/src/modules/retention-data-contracts/retention-data-contracts.module.ts`

- [ ] **Step 1: Escrever testes de duplicação e atraso**

```ts
it('preserves the first received instant across replays', async () => {
  await ingest(event, instant('2026-01-10T10:00:00Z'));
  await ingest(event, instant('2026-03-01T10:00:00Z'));
  expect(await inbox.get(event.eventId)).toMatchObject({ firstReceivedAt: '2026-01-10T10:00:00.000Z', replayCount: 2 });
});
```

Cubra schema desconhecido, tenant ausente, evento com `occurredAt` futuro, evento de outro tenant e payload sem campos mínimos.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- ingest-retention-event retention-source-event`
Expected: FAIL porque consumer e repository não existem.

- [ ] **Step 3: Implementar inbox idempotente**

Primeiro insert grava `firstReceivedAt` do clock do consumer. Replay incrementa contador/último recebimento sem alterar first-seen. Payload validado e minimizado fica criptografado/retention-tagged quando necessário; features preferem campos canônicos extraídos.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- ingest-retention-event retention-source-event`
Expected: PASS para 100 replays concorrentes e first-seen imutável.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-data-contracts
git commit -m "feat(retention): preserve event knowledge time"
```

### Task 3: Implementar portas as-of e calculadores de features

**Files:**
- Create: `apps/api/src/modules/retention-snapshots/ports/retention-sources.port.ts`
- Create: `apps/api/src/modules/retention-snapshots/ports/retention-sources.contract.spec.ts`
- Create: `packages/retention-domain/src/features/attendance-features.ts`
- Create: `packages/retention-domain/src/features/attendance-features.spec.ts`
- Create: `packages/retention-domain/src/features/billing-features.ts`
- Create: `packages/retention-domain/src/features/billing-features.spec.ts`
- Create: `packages/retention-domain/src/features/subscription-features.ts`
- Create: `packages/retention-domain/src/features/subscription-features.spec.ts`
- Create: `packages/retention-domain/src/features/engagement-assessment-features.ts`
- Create: `packages/retention-domain/src/features/engagement-assessment-features.spec.ts`

- [ ] **Step 1: Escrever contract tests point-in-time**

```ts
it('excludes a fact first received after observation even if occurred earlier', async () => {
  const facts = await source.readAsOf({ observationAt, knowledgeCutoffAt: observationAt });
  expect(facts.map(item => item.sourceEventId)).not.toContain(lateEvent.id);
});
```

Teste exatamente as 13 features iniciais, fronteiras 7/30/90/180 dias, timezone, assinatura curta e source indisponível.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/retention-domain test -- features && pnpm --filter api test -- retention-sources.contract.spec.ts`
Expected: FAIL porque portas e calculadores não existem.

- [ ] **Step 3: Definir porta única com adapters públicos**

```ts
export interface RetentionSourceFacts {
  facts: Array<{
    sourceEventId: string;
    occurredAt: string;
    firstReceivedAt: string;
    kind: string;
    numericValue: number | null;
  }>;
  qualityFlags: string[];
}

export interface RetentionSourcesPort {
  readStudentFacts(input: {
    tenantId: string;
    studentId: string;
    observationAt: string;
    knowledgeCutoffAt: string;
    featureSetVersionId: string;
  }): Promise<RetentionSourceFacts>;
}
```

Adapters usam inbox/event history ou portas as-of dos owners. Nenhum adapter consulta “estado atual” para passado. Assessment contribui apenas data de publicação; engagement retorna atividade agregada permitida e respeita opt-out.

- [ ] **Step 4: Implementar funções puras**

Cada função retorna valor ou missing reason, evidence IDs e quality flags. Percentuais/divisões tratam denominador zero como missing, não risco máximo.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/retention-domain test -- features && pnpm --filter api test -- retention-sources.contract.spec.ts`
Expected: PASS nas fronteiras, missing e late events.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/retention-snapshots/ports packages/retention-domain/src/features
git commit -m "feat(retention): calculate point-in-time features"
```

### Task 4: Materializar snapshots e labels maduras

**Files:**
- Create: `apps/api/src/modules/retention-snapshots/application/materialize-feature-snapshot.use-case.ts`
- Create: `apps/api/src/modules/retention-snapshots/application/materialize-feature-snapshot.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-snapshots/application/mature-retention-label.use-case.ts`
- Create: `apps/api/src/modules/retention-snapshots/application/mature-retention-label.use-case.spec.ts`
- Create: `apps/api/src/modules/retention-snapshots/infrastructure/retention-snapshot.repository.ts`
- Create: `apps/api/src/modules/retention-snapshots/infrastructure/retention-label.repository.ts`
- Create: `apps/api/src/modules/retention-snapshots/retention-snapshots.module.ts`

- [ ] **Step 1: Escrever testes de idempotência e maturação**

```ts
it('does not mature a label before observation plus 60 days', async () => {
  await expect(mature.execute({ snapshotId, now: addDays(observationAt, 59) })).resolves.toMatchObject({ status: 'IMMATURE' });
});

it('recreates the same checksum for the same knowledge cutoff', async () => {
  expect((await materialize(command)).checksum).toBe((await materialize(command)).checksum);
});
```

Cubra churn no dia 30, reativação no último dia, cancelado antes da observação, exclusão pendente e corrida entre dois workers.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- materialize-feature-snapshot mature-retention-label`
Expected: FAIL porque casos de uso não existem.

- [ ] **Step 3: Implementar transações e checksums**

Materialização fixa catálogo/target/watermarks, calcula fora da transação longa e insere por chave única com compare-checksum. Divergência cria erro `SNAPSHOT_NON_DETERMINISTIC`; correção autorizada usa nova revisão. Label lê somente eventos dentro das janelas e nunca interação retention.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- materialize-feature-snapshot mature-retention-label`
Expected: PASS para concorrência, bordas e label imutável.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-snapshots
git commit -m "feat(retention): materialize snapshots and mature labels"
```

### Task 5: Agendar pipeline diário e reconstrução auditada

**Files:**
- Create: `apps/api/src/workers/retention-snapshot-trigger.processor.ts`
- Create: `apps/api/src/workers/retention-snapshot-trigger.processor.spec.ts`
- Create: `apps/api/src/workers/retention-snapshot.processor.ts`
- Create: `apps/api/src/workers/retention-snapshot.processor.spec.ts`
- Create: `apps/api/src/workers/retention-label-maturity.processor.ts`
- Create: `apps/api/src/workers/retention-label-maturity.processor.spec.ts`
- Create: `apps/api/src/modules/retention-snapshots/application/rebuild-feature-snapshots.use-case.ts`
- Create: `apps/api/src/modules/retention-snapshots/application/rebuild-feature-snapshots.use-case.spec.ts`
- Create: `docs/operations/retention/snapshot-rebuild-runbook.md`

- [ ] **Step 1: Escrever testes de scheduler e replay**

Scheduler gera trigger diário por timezone/unidade; trigger cria jobs deduplicados por tenant/unidade/observation/feature set. Banco continua impedindo duplicação após job completar/falhar.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- retention-snapshot-trigger retention-snapshot retention-label-maturity rebuild-feature-snapshots`
Expected: FAIL porque processors e rebuild não existem.

- [ ] **Step 3: Implementar Job Scheduler e paginação**

Use `upsertJobScheduler` apenas para trigger. Worker do trigger adiciona jobs com deduplication ID, attempts/backoff e páginas estáveis. Falha permanente de contrato vai à DLQ sem retry infinito.

- [ ] **Step 4: Implementar rebuild sombra**

Rebuild fixa target/feature set/knowledge cutoff, escreve nova revisão em namespace de run, compara checksums e publica relatório. Ele não altera revisão original nem inclui late facts.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- retention-snapshot-trigger retention-snapshot retention-label-maturity rebuild-feature-snapshots`
Expected: PASS para worker duplicado, restart, DST, DLQ e rebuild.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/retention-snapshot-trigger.processor.ts apps/api/src/workers/retention-snapshot-trigger.processor.spec.ts apps/api/src/workers/retention-snapshot.processor.ts apps/api/src/workers/retention-snapshot.processor.spec.ts apps/api/src/workers/retention-label-maturity.processor.ts apps/api/src/workers/retention-label-maturity.processor.spec.ts apps/api/src/modules/retention-snapshots/application/rebuild-feature-snapshots.use-case.ts apps/api/src/modules/retention-snapshots/application/rebuild-feature-snapshots.use-case.spec.ts docs/operations/retention/snapshot-rebuild-runbook.md
git commit -m "feat(retention): schedule reproducible snapshots"
```

### Task 6: Expor qualidade e provar ausência de leakage

**Files:**
- Create: `apps/api/src/modules/retention-snapshots/admin-retention-data.controller.ts`
- Create: `apps/api/src/modules/retention-snapshots/admin-retention-data.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/retention-data.ts`
- Create: `apps/admin-web/app/(protected)/retention/data-quality/page.tsx`
- Create: `apps/admin-web/components/retention/RetentionDataQuality.tsx`
- Create: `apps/admin-web/components/retention/RetentionDataQuality.test.tsx`
- Create: `tests/integration/retention/point-in-time-correctness.spec.ts`
- Create: `tests/integration/retention/tenant-snapshot-isolation.spec.ts`
- Create: `docs/operations/retention/data-quality-evidence.json`

- [ ] **Step 1: Escrever testes API/UI e integração**

Teste cobertura/distribuição agregada, cursor, RBAC, tenant/unidade, evento conhecido depois, label imatura e tentativa de exportar vetor pela tela.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- admin-retention-data.controller.spec.ts && pnpm --filter admin-web test -- RetentionDataQuality.test.tsx && pnpm test:integration -- point-in-time-correctness tenant-snapshot-isolation`
Expected: FAIL porque API, UI e fixtures não existem.

- [ ] **Step 3: Implementar overview agregado**

`GET /api/v1/retention/overview` retorna status do pipeline, coverage/completeness/distribution agregadas, oldest/newest observation e quality flags. Não retorna feature vector individual.

- [ ] **Step 4: Gerar OpenAPI e executar bateria**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- admin-retention-data.controller.spec.ts && pnpm --filter admin-web test -- RetentionDataQuality.test.tsx && pnpm test:integration -- point-in-time-correctness tenant-snapshot-isolation`
Expected: PASS; fixture futura não aparece e outro tenant retorna 404/forbidden uniforme.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/retention-snapshots apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/retention-data.ts "apps/admin-web/app/(protected)/retention/data-quality" apps/admin-web/components/retention tests/integration/retention docs/operations/retention/data-quality-evidence.json
git commit -m "test(retention): prove point-in-time snapshots"
```

## Verificação da slice

- [ ] Run: `pnpm --filter @arenahub/retention-domain test`
  Expected: PASS.
- [ ] Run: `pnpm --filter api test -- retention-data-contracts retention-snapshots`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- point-in-time-correctness tenant-snapshot-isolation`
  Expected: PASS sem leakage ou cruzamento de tenant.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com snapshots/labels reproduzíveis, executar `2026-08-14-mvp-06-02-baseline-scores.md`.
