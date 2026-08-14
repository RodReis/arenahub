# MVP-05.4 — Rankings privados por padrão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar rankings opt-in de frequência, consistência e evolução relativa sem revelar não participantes, medidas absolutas ou coortes pequenas.

**Architecture:** Definições versionadas geram snapshots assíncronos `DRAFT` e imutáveis após publicação. A materialização chama `EngagementExposurePolicy` antes de criar entradas. Uma projeção pública/cache aplica novamente consentimento e tombstones em toda leitura; o snapshot bruto fica restrito à auditoria. Desempate e motivo de retenção são determinísticos.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/BullMQ Job Schedulers, Zod, outbox, Jest, Testcontainers, OpenAPI, Expo/React Native e Next.js admin.

---

## Pré-condições

- Slices 5.1 a 5.3 concluídas.
- `M5-PRIVACY-01` e catálogo de ranking aprovados.
- Métricas de evolução física comparável expostas por porta do MVP-03.
- Coorte mínima e desempates assinados; sem valor default inventado.
- `RANKINGS=false` fora do tenant piloto.

### Task 1: Modelar definições, snapshots e revisões imutáveis

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_rankings/migration.sql`
- Create: `packages/engagement-domain/src/rankings/ranking-definition.ts`
- Create: `packages/engagement-domain/src/rankings/ranking-definition.spec.ts`
- Create: `packages/engagement-domain/src/rankings/ranking-snapshot.ts`
- Create: `packages/engagement-domain/src/rankings/ranking-snapshot.spec.ts`

- [ ] **Step 1: Escrever testes de estado e versão**

```ts
it('does not mutate a published snapshot', () => {
  expect(() => transition(published, { type: 'RECALCULATE_IN_PLACE' })).toThrow('PUBLISHED_SNAPSHOT_IMMUTABLE');
});

it('withholds a cohort below the approved minimum', () => {
  expect(validateDraft({ eligibleCount: policy.minimumCohort - 1 }, policy).status).toBe('WITHHELD');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/engagement-domain test -- ranking`
Expected: FAIL porque domínio não existe.

- [ ] **Step 3: Adicionar modelos**

Crie `RankingDefinition`, `RankingDefinitionVersion`, `RankingSnapshot`, `RankingEntry`, `RankingPublicProjection` e `RankingRecalculationRun`. Snapshot registra tenant, unidade, período, categoria, timezone, versão da regra, query high-water, hash e revisão anterior.

```ts
export type RankingSnapshotStatus = 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'SUPERSEDED' | 'WITHHELD';
export type RankingCategory = 'ATTENDANCE' | 'CONSISTENCY' | 'RELATIVE_PHYSICAL_EVOLUTION';
export type RankingPeriod = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';
```

Entrada auditável referencia aluno internamente; DTO público nunca retorna `studentId` ou medida bruta.

- [ ] **Step 4: Aplicar migration e implementar domínio**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_rankings && pnpm --filter @arenahub/engagement-domain test -- ranking`
Expected: PASS para transições, revisão e coorte mínima.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma packages/engagement-domain/src/rankings
git commit -m "feat(engagement): model immutable ranking snapshots"
```

### Task 2: Implementar calculadores permitidos e desempate estável

**Files:**
- Create: `packages/engagement-domain/src/rankings/calculate-attendance-ranking.ts`
- Create: `packages/engagement-domain/src/rankings/calculate-attendance-ranking.spec.ts`
- Create: `packages/engagement-domain/src/rankings/calculate-consistency-ranking.ts`
- Create: `packages/engagement-domain/src/rankings/calculate-consistency-ranking.spec.ts`
- Create: `packages/engagement-domain/src/rankings/calculate-relative-evolution-ranking.ts`
- Create: `packages/engagement-domain/src/rankings/calculate-relative-evolution-ranking.spec.ts`
- Create: `packages/engagement-domain/src/rankings/stable-tiebreak.ts`
- Create: `packages/engagement-domain/src/rankings/stable-tiebreak.spec.ts`
- Create: `apps/api/src/modules/engagement-rankings/ports/health-ranking-metrics.port.ts`

- [ ] **Step 1: Escrever testes com golden fixtures**

Cubra período, sessão elegível, semanas qualificadas, baseline não comparável, consentimento físico ausente, empate total e ordem repetida.

```ts
it('never includes absolute physical values in its result', () => {
  const result = calculateRelativeEvolutionRanking(comparableAssessments, policy);
  expect(JSON.stringify(result)).not.toContain('absoluteValue');
});

it('produces the same order on repeated runs', () => {
  expect(rank(tiedEntries)).toEqual(rank([...tiedEntries].reverse()));
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/engagement-domain test -- calculate- ranking stable-tiebreak`
Expected: FAIL porque calculadores não existem.

- [ ] **Step 3: Implementar métricas e tiebreak**

Frequência conta sessões elegíveis; consistência usa semanas qualificadas. Evolução aceita somente métrica relativa permitida, baseline comparável, mesma metodologia/equipamento quando a política exigir e consentimento específico. Desempate usa sequência publicada de métricas, instante de alcance e ID opaco derivado do snapshot; nunca sorteio.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter @arenahub/engagement-domain test -- calculate- ranking stable-tiebreak`
Expected: PASS e nenhuma fixture pública contém valor absoluto.

- [ ] **Step 5: Commit**

```bash
git add packages/engagement-domain/src/rankings apps/api/src/modules/engagement-rankings/ports/health-ranking-metrics.port.ts
git commit -m "feat(engagement): calculate approved ranking categories"
```

### Task 3: Gerar e validar snapshot assíncrono

**Files:**
- Create: `apps/api/src/modules/engagement-rankings/application/generate-ranking-snapshot.use-case.ts`
- Create: `apps/api/src/modules/engagement-rankings/application/generate-ranking-snapshot.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-rankings/application/validate-ranking-snapshot.use-case.ts`
- Create: `apps/api/src/modules/engagement-rankings/application/validate-ranking-snapshot.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-rankings/infrastructure/ranking.repository.ts`
- Create: `apps/api/src/workers/engagement-ranking-snapshot.processor.ts`
- Create: `apps/api/src/workers/engagement-ranking-snapshot.processor.spec.ts`

- [ ] **Step 1: Escrever testes de materialização**

```ts
it('filters consent before creating entries', async () => {
  await generate(definition);
  expect(await entries.forStudent(nonParticipant.id)).toHaveLength(0);
});
```

Teste opt-out concorrente, coorte que cai abaixo do mínimo, worker duplicado, high-water diferente e cálculo falho sem bloquear passagem.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- generate-ranking-snapshot validate-ranking-snapshot engagement-ranking-snapshot.processor`
Expected: FAIL porque pipeline não existe.

- [ ] **Step 3: Implementar pipeline isolado**

BullMQ agenda triggers com `upsertJobScheduler`; trigger cria job com deduplication ID por definição/período/revisão. Worker abre snapshot, fixa high-water, carrega apenas elegíveis pela porta, calcula em páginas, valida e deixa `DRAFT` ou `WITHHELD`. Falha usa retry/backoff sem transação longa nos módulos operacionais.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- generate-ranking-snapshot validate-ranking-snapshot engagement-ranking-snapshot.processor`
Expected: PASS; job repetido converge e API de acesso permanece disponível durante geração.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-rankings apps/api/src/workers/engagement-ranking-snapshot.processor.ts apps/api/src/workers/engagement-ranking-snapshot.processor.spec.ts
git commit -m "feat(engagement): generate ranking snapshots asynchronously"
```

### Task 4: Publicar projeção pública com consentimento atual

**Files:**
- Create: `apps/api/src/modules/engagement-rankings/application/publish-ranking.use-case.ts`
- Create: `apps/api/src/modules/engagement-rankings/application/publish-ranking.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-rankings/application/read-public-ranking.use-case.ts`
- Create: `apps/api/src/modules/engagement-rankings/application/read-public-ranking.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-rankings/domain/public-ranking-entry.ts`
- Create: `apps/api/src/modules/engagement-rankings/domain/public-ranking-entry.spec.ts`
- Create: `packages/contracts/src/engagement/ranking-published.event.ts`

- [ ] **Step 1: Escrever testes de privacy overlay**

```ts
it('hides an opted-out student even when the immutable snapshot still references them', async () => {
  await preferences.optOut(student.id, 'RANKING');
  expect(await readPublic(snapshot.id)).not.toContainEqual(expect.objectContaining({ publicProfileId: student.publicProfileId }));
});
```

Teste alias pendente/oculto, pseudônimo por snapshot, cache antigo, export e coorte após remoção.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- publish-ranking read-public-ranking public-ranking-entry`
Expected: FAIL porque publicação e DTO público não existem.

- [ ] **Step 3: Implementar publicação e overlay**

Publicação revalida consentimento/coorte, grava projeção pública, hash e outbox numa transação. Toda leitura chama `EngagementExposurePolicy`; tombstone remove entrada imediatamente. Se a remoção comprometer a coorte, a projeção inteira é retida e uma revisão é enfileirada.

```ts
export type PublicRankingEntryDto = {
  position: number;
  displayIdentity: string;
  metricLabel: string;
  relativeValue: number | null;
  achievedAt: string;
};
```

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- publish-ranking read-public-ranking public-ranking-entry`
Expected: PASS; DTO não contém `studentId`, nome civil ou medida absoluta.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-rankings packages/contracts/src/engagement/ranking-published.event.ts
git commit -m "feat(engagement): publish consent-aware rankings"
```

### Task 5: Expor APIs mobile/admin e telas

**Files:**
- Create: `apps/api/src/modules/engagement-rankings/mobile-rankings.controller.ts`
- Create: `apps/api/src/modules/engagement-rankings/admin-rankings.controller.ts`
- Create: `apps/api/src/modules/engagement-rankings/rankings.controllers.spec.ts`
- Create: `apps/api/src/modules/engagement-rankings/engagement-rankings.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-engagement-rankings.ts`
- Create: `apps/mobile/app/(protected)/engagement/rankings.tsx`
- Create: `apps/mobile/src/features/engagement/rankings/RankingsScreen.tsx`
- Create: `apps/mobile/src/features/engagement/rankings/RankingsScreen.test.tsx`
- Create: `apps/admin-web/app/(protected)/engagement/rankings/page.tsx`
- Create: `apps/admin-web/components/engagement/RankingPublicationPanel.tsx`
- Create: `apps/admin-web/components/engagement/RankingPublicationPanel.test.tsx`

- [ ] **Step 1: Escrever testes HTTP e UI**

Cubra `GET /api/v1/mobile/engagement/rankings`, detalhe por snapshot e `POST /api/v1/admin/engagement/rankings/:definitionId/publish`. Exija permissão, validação recente, confirmação de versão e idempotency key.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- rankings.controllers.spec.ts && pnpm --filter mobile test -- RankingsScreen.test.tsx && pnpm --filter admin-web test -- RankingPublicationPanel.test.tsx`
Expected: FAIL porque controllers e telas não existem.

- [ ] **Step 3: Implementar contratos e telas**

Mobile mostra período, data, regras, tamanho “suficiente” sem revelar contagem quando proibida, posição opcional e opção de ocultar. Admin mostra diff/validações e nunca permite edição de entrada. Evolução física usa rótulo relativo e explicação de baseline.

- [ ] **Step 4: Gerar contrato e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- rankings.controllers.spec.ts && pnpm --filter mobile test -- RankingsScreen.test.tsx && pnpm --filter admin-web test -- RankingPublicationPanel.test.tsx`
Expected: PASS com autorização por tenant/unidade e acessibilidade.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-rankings apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-engagement-rankings.ts apps/mobile/app/(protected)/engagement/rankings.tsx apps/mobile/src/features/engagement/rankings apps/admin-web/app/(protected)/engagement/rankings apps/admin-web/components/engagement
git commit -m "feat(engagement): expose ranking publication and views"
```

### Task 6: Provar performance, opt-out e revisão sem mutação

**Files:**
- Create: `apps/api/src/modules/engagement-rankings/application/recalculate-ranking.use-case.ts`
- Create: `apps/api/src/modules/engagement-rankings/application/recalculate-ranking.use-case.spec.ts`
- Create: `apps/api/src/workers/engagement-ranking-recalculation.processor.ts`
- Create: `tests/integration/engagement/ranking-privacy-revision.spec.ts`
- Create: `tests/performance/engagement/published-ranking.k6.js`
- Create: `docs/operations/engagement/ranking-publication-runbook.md`
- Create: `docs/operations/engagement/ranking-slo-evidence.json`

- [ ] **Step 1: Escrever teste de revisão**

Dry-run gera diff por razão, revisão nova referencia snapshot anterior e publicação supersede sem alterar linhas antigas. Opt-out durante o processo continua invisível em leitura.

- [ ] **Step 2: Executar integração e confirmar falha**

Run: `pnpm test:integration -- ranking-privacy-revision.spec.ts`
Expected: FAIL porque revisão e diff não existem.

- [ ] **Step 3: Implementar recálculo e runbook**

Estados do run: `REQUESTED`, `CALCULATING`, `DIFF_READY`, `APPROVED`, `PUBLISHED`, `FAILED`. Exija ator, motivo, escopo, regra e autorização. Rollback reponta a projeção pública apenas se ela ainda satisfaz consentimento/coorte atuais.

- [ ] **Step 4: Executar testes e carga**

Run: `pnpm test:integration -- ranking-privacy-revision.spec.ts && pnpm test:performance -- published-ranking.k6.js`
Expected: PASS; leitura p95 < 500 ms no perfil aprovado e geração não degrada APIs operacionais além do orçamento do gate.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-rankings/application/recalculate-ranking.use-case.ts apps/api/src/modules/engagement-rankings/application/recalculate-ranking.use-case.spec.ts apps/api/src/workers/engagement-ranking-recalculation.processor.ts tests/integration/engagement/ranking-privacy-revision.spec.ts tests/performance/engagement/published-ranking.k6.js docs/operations/engagement/ranking-publication-runbook.md docs/operations/engagement/ranking-slo-evidence.json
git commit -m "test(engagement): prove private ranking publication"
```

## Verificação da slice

- [ ] Run: `pnpm --filter @arenahub/engagement-domain test -- ranking`
  Expected: PASS.
- [ ] Run: `pnpm --filter api test -- engagement-rankings`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- ranking-privacy-revision.spec.ts`
  Expected: PASS sem PII ou medida absoluta.
- [ ] Run: `pnpm test:performance -- published-ranking.k6.js`
  Expected: p95 < 500 ms.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com rankings seguros, executar `2026-08-14-mvp-05-05-challenges-notifications.md`.
