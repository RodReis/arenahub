# MVP-05.6 — Operação, moderação e experimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operar o engagement com disputas rastreáveis, correções não destrutivas, métricas de segurança e rollout experimental reversível.

**Architecture:** Disputas congelam referências de evidência e são resolvidas por comandos compensatórios ou novas revisões. Recalculation runs produzem projeção sombra e diff antes de qualquer swap. Experimentos atribuem grupo antes da exposição, registram eventos sem PII e avaliam intenção de tratar com guardrails adversos. Feature flags permitem rollback por capacidade e tenant.

**Tech Stack:** NestJS, Prisma/PostgreSQL, BullMQ, OpenTelemetry/stack de observabilidade do MVP-00, Zod, OpenAPI, Next.js admin, Jest, Playwright e Testcontainers.

---

## Pré-condições

- Slices 5.1 a 5.5 concluídas e verificadas.
- `M5-MODERATION-01` e `M5-BASELINE-01` aprovados.
- RBAC, segregação de função, baseline e thresholds de parada possuem evidência real.
- Todas as flags permanecem fechadas fora do rollout descrito neste plano.

### Task 1: Modelar disputas, evidências e decisões

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_disputes/migration.sql`
- Create: `apps/api/src/modules/engagement-moderation/domain/engagement-dispute.ts`
- Create: `apps/api/src/modules/engagement-moderation/domain/engagement-dispute.spec.ts`
- Create: `apps/api/src/modules/engagement-moderation/domain/moderation-decision.ts`
- Create: `apps/api/src/modules/engagement-moderation/domain/moderation-decision.spec.ts`

- [ ] **Step 1: Escrever testes de máquina de estados**

```ts
it('cannot resolve a dispute without immutable evidence references', () => {
  expect(() => resolveDispute(openDispute, { evidenceRefs: [] })).toThrow('DISPUTE_EVIDENCE_REQUIRED');
});

it('requires a second authorized actor for a corrective movement', () => {
  expect(() => authorizeCorrection({ requestedBy: operatorA, authorizedBy: operatorA })).toThrow('SEGREGATION_OF_DUTIES_REQUIRED');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-dispute moderation-decision`
Expected: FAIL porque domínio não existe.

- [ ] **Step 3: Adicionar modelos**

Crie `EngagementDispute`, `EngagementDisputeEvidence`, `EngagementDisputeDecision`, `EngagementModerationAction` e `EngagementAppeal`. Evidência referencia source event, ledger entry, achievement, streak week, ranking snapshot/entry ou challenge progress por ID/hash; não duplica payload sensível.

```ts
export type EngagementDisputeSubject = 'XP' | 'ACHIEVEMENT' | 'STREAK' | 'RANKING' | 'CHALLENGE' | 'PUBLIC_PROFILE';
export type EngagementDisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED' | 'APPEALED';
```

- [ ] **Step 4: Aplicar migration e implementar domínio**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_disputes && pnpm --filter api test -- engagement-dispute moderation-decision`
Expected: PASS para transições, recurso, evidência e segregação.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/engagement-moderation/domain
git commit -m "feat(engagement): model auditable disputes"
```

### Task 2: Implementar abertura, investigação e resolução corretiva

**Files:**
- Create: `apps/api/src/modules/engagement-moderation/application/open-engagement-dispute.use-case.ts`
- Create: `apps/api/src/modules/engagement-moderation/application/open-engagement-dispute.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-moderation/application/investigate-engagement-dispute.use-case.ts`
- Create: `apps/api/src/modules/engagement-moderation/application/resolve-engagement-dispute.use-case.ts`
- Create: `apps/api/src/modules/engagement-moderation/application/resolve-engagement-dispute.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-moderation/infrastructure/engagement-dispute.repository.ts`
- Create: `apps/api/src/modules/engagement-moderation/ports/engagement-correction.port.ts`

- [ ] **Step 1: Escrever testes de autorização e idempotência**

Cubra aluno abrindo disputa de outro aluno, operador fora da unidade, decisão duplicada, evidência removida, ajuste sem motivo e revisão de ranking sem aprovação.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- open-engagement-dispute resolve-engagement-dispute`
Expected: FAIL porque casos de uso não existem.

- [ ] **Step 3: Implementar portas corretivas**

```ts
export interface EngagementCorrectionPort {
  createXpCompensation(command: AuthorizedCorrection): Promise<{ movementId: string }>;
  reverseAchievement(command: AuthorizedCorrection): Promise<{ reversalId: string }>;
  requestStreakRebuild(command: AuthorizedCorrection): Promise<{ runId: string }>;
  requestRankingRevision(command: AuthorizedCorrection): Promise<{ runId: string }>;
  requestChallengeRebuild(command: AuthorizedCorrection): Promise<{ runId: string }>;
}
```

Resolução e comando corretivo são ligados pelo outbox. Falha do worker deixa decisão `CORRECTION_PENDING`; não marca como aplicada antecipadamente.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- open-engagement-dispute resolve-engagement-dispute`
Expected: PASS; nenhuma tabela histórica recebe edição destrutiva.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-moderation
git commit -m "feat(engagement): resolve disputes with compensations"
```

### Task 3: Implementar recálculo com dry-run e diff

**Files:**
- Create: `apps/api/src/modules/engagement-operations/domain/recalculation-run.ts`
- Create: `apps/api/src/modules/engagement-operations/domain/recalculation-run.spec.ts`
- Create: `apps/api/src/modules/engagement-operations/application/request-recalculation.use-case.ts`
- Create: `apps/api/src/modules/engagement-operations/application/request-recalculation.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-operations/application/approve-recalculation.use-case.ts`
- Create: `apps/api/src/modules/engagement-operations/application/publish-recalculation.use-case.ts`
- Create: `apps/api/src/modules/engagement-operations/infrastructure/recalculation.repository.ts`
- Create: `apps/api/src/workers/engagement-recalculation.processor.ts`
- Create: `apps/api/src/workers/engagement-recalculation.processor.spec.ts`

- [ ] **Step 1: Escrever testes de diff e concorrência**

```ts
it('cannot publish before a reviewed diff exists', async () => {
  await expect(publish(runWithoutDiff)).rejects.toMatchObject({ code: 'RECALCULATION_DIFF_REQUIRED' });
});
```

Teste mudança de high-water, consentimento revogado durante o run, nova versão de regra, retry e rollback de ponteiro.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- recalculation-run request-recalculation engagement-recalculation.processor`
Expected: FAIL porque orquestração não existe.

- [ ] **Step 3: Implementar projeção sombra**

Run fixa escopo, fonte, regra, high-water e motivo. Worker reconstrói em namespace/versionamento novo e produz contagens de adição, remoção, alteração e razões sem PII. Aprovação requer ator diferente; publicação faz swap atômico e mantém versão anterior para rollback.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- recalculation-run request-recalculation engagement-recalculation.processor`
Expected: PASS; snapshot publicado anterior permanece intacto e exposure policy atual vence o resultado.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-operations apps/api/src/workers/engagement-recalculation.processor.ts apps/api/src/workers/engagement-recalculation.processor.spec.ts
git commit -m "feat(engagement): add reviewed projection recalculation"
```

### Task 4: Expor APIs mobile/admin e console operacional

**Files:**
- Create: `apps/api/src/modules/engagement-moderation/mobile-engagement-disputes.controller.ts`
- Create: `apps/api/src/modules/engagement-moderation/admin-engagement-disputes.controller.ts`
- Create: `apps/api/src/modules/engagement-moderation/engagement-disputes.controllers.spec.ts`
- Create: `apps/api/src/modules/engagement-moderation/engagement-moderation.module.ts`
- Create: `apps/api/src/modules/engagement-operations/admin-engagement-operations.controller.ts`
- Create: `apps/api/src/modules/engagement-operations/admin-engagement-operations.controller.spec.ts`
- Create: `apps/api/src/modules/engagement-operations/engagement-operations.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/engagement-operations.ts`
- Create: `apps/mobile/app/(protected)/engagement/disputes.tsx`
- Create: `apps/mobile/src/features/engagement/disputes/EngagementDisputesScreen.tsx`
- Create: `apps/mobile/src/features/engagement/disputes/EngagementDisputesScreen.test.tsx`
- Create: `apps/admin-web/app/(protected)/engagement/operations/page.tsx`
- Create: `apps/admin-web/components/engagement/DisputeQueue.tsx`
- Create: `apps/admin-web/components/engagement/RecalculationDiff.tsx`
- Create: `apps/admin-web/components/engagement/EngagementOperations.test.tsx`

- [ ] **Step 1: Escrever testes de contrato**

Cubra `POST /api/v1/mobile/engagement/disputes`, listagem própria, `GET /api/v1/admin/engagement/disputes`, `POST .../:id/resolve`, criação/aprovação/publicação de recálculo e moderação de alias.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-disputes.controllers admin-engagement-operations && pnpm --filter mobile test -- EngagementDisputesScreen.test.tsx && pnpm --filter admin-web test -- EngagementOperations.test.tsx`
Expected: FAIL porque APIs e telas não existem.

- [ ] **Step 3: Implementar console seguro**

Mobile permite categoria, descrição mínima e acompanhamento, sem upload arbitrário no primeiro corte. Admin mostra evidências referenciadas, diff, ator/tempo e ações autorizadas. Não oferece edição inline de XP, posição, streak ou progresso.

- [ ] **Step 4: Gerar contrato e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- engagement-disputes.controllers admin-engagement-operations && pnpm --filter mobile test -- EngagementDisputesScreen.test.tsx && pnpm --filter admin-web test -- EngagementOperations.test.tsx`
Expected: PASS com autorização por objeto, tenant e unidade.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-moderation apps/api/src/modules/engagement-operations apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/engagement-operations.ts apps/mobile/app/(protected)/engagement/disputes.tsx apps/mobile/src/features/engagement/disputes apps/admin-web/app/(protected)/engagement/operations apps/admin-web/components/engagement
git commit -m "feat(engagement): add dispute and recalculation operations"
```

### Task 5: Medir exposição, segurança e experimento

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_experiments/migration.sql`
- Create: `apps/api/src/modules/engagement-operations/domain/experiment-assignment.ts`
- Create: `apps/api/src/modules/engagement-operations/domain/experiment-assignment.spec.ts`
- Create: `apps/api/src/modules/engagement-operations/application/assign-engagement-experiment.use-case.ts`
- Create: `apps/api/src/modules/engagement-operations/application/record-engagement-metric.use-case.ts`
- Create: `apps/api/src/modules/engagement-operations/application/record-engagement-metric.use-case.spec.ts`
- Create: `packages/observability/src/engagement/engagement-metrics.ts`
- Create: `packages/observability/src/engagement/engagement-metrics.spec.ts`
- Create: `apps/api/src/workers/engagement-guardrails.processor.ts`
- Create: `apps/api/src/workers/engagement-guardrails.processor.spec.ts`

- [ ] **Step 1: Escrever testes de atribuição e minimização**

```ts
it('assigns before exposure and remains stable', () => {
  expect(assign(experiment, studentKey)).toEqual(assign(experiment, studentKey));
});

it('never emits public identity or body measurements', () => {
  expect(Object.keys(metricPayload)).toEqual(expect.not.arrayContaining(['studentId', 'alias', 'absoluteMeasurement']));
});
```

Teste controle sem nudge, opt-out/report por campanha/challenge, sinais de sobreuso, atraso de dados e threshold de parada.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- experiment-assignment record-engagement-metric engagement-guardrails && pnpm --filter @arenahub/observability test -- engagement-metrics`
Expected: FAIL porque atribuição e métricas não existem.

- [ ] **Step 3: Modelar e implementar**

Crie `EngagementExperiment`, `EngagementExperimentAssignment`, `EngagementExposureEvent` e agregados diários sem PII. Assignment usa hash estável tenant/experiment/subject e é persistido antes do primeiro feature event. Métricas: elegibilidade, exposição, adesão, conclusão, opt-out, denúncia, disputa, notificação, frequência consistente e sinais adversos aprovados.

- [ ] **Step 4: Implementar guardrails**

Worker compara janela e baseline assinados. Ruptura de threshold marca experimento `STOPPING`, desliga flags na população, cancela nudges e alerta operador. Não bloqueia acesso, não pune aluno e não gera diagnóstico.

- [ ] **Step 5: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_experiments && pnpm --filter api test -- experiment-assignment record-engagement-metric engagement-guardrails && pnpm --filter @arenahub/observability test -- engagement-metrics`
Expected: PASS para intenção de tratar, controle e parada.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/engagement-operations packages/observability/src/engagement apps/api/src/workers/engagement-guardrails.processor.ts apps/api/src/workers/engagement-guardrails.processor.spec.ts
git commit -m "feat(engagement): add safety-first experiment metrics"
```

### Task 6: Executar rollout, bateria adversa e rollback

**Files:**
- Create: `tests/integration/engagement/dispute-correction-audit.spec.ts`
- Create: `tests/integration/engagement/experiment-guardrails.spec.ts`
- Create: `tests/e2e/admin/engagement-operations.spec.ts`
- Create: `docs/operations/engagement/moderation-runbook.md`
- Create: `docs/operations/engagement/dispute-runbook.md`
- Create: `docs/operations/engagement/experiment-runbook.md`
- Create: `docs/operations/engagement/engagement-rollout-runbook.md`
- Create: `docs/operations/engagement/engagement-rollback-runbook.md`
- Create: `docs/operations/engagement/mvp-05-readiness-report.md`

- [ ] **Step 1: Escrever bateria adversa ponta a ponta**

Inclua não participante, replay 100×, duas passagens/dia, pausa, baseline não comparável, coorte pequena, regra nova, desafio inseguro, opt-out, disputa/correção, token inválido e guardrail rompido.

- [ ] **Step 2: Executar testes**

Run: `pnpm test:integration -- dispute-correction-audit.spec.ts experiment-guardrails.spec.ts && pnpm test:e2e:admin -- engagement-operations.spec.ts`
Expected: PASS com trilha completa, sem mutação histórica e parada automática das exposições.

- [ ] **Step 3: Executar rollout em estágios**

1. `ENGAGEMENT_XP_PRIVATE` para grupo interno opt-in;
2. `ACHIEVEMENTS` e `STREAKS` em piloto de uma unidade;
3. ranking anônimo/privado para validação sem publicação ampla;
4. `RANKINGS` opt-in em uma unidade após coorte e baseline;
5. `CHALLENGES` com um template limitado;
6. `ENGAGEMENT_PUSH` somente se provider e guardrails estiverem verdes.

Cada estágio possui janela, owner, métricas, evidência, go/no-go e comando de rollback. Não avance por calendário quando os dados forem inconclusivos.

- [ ] **Step 4: Validar rollback**

Desligar flags impede novas exposições, preserva XP/ledger privado, cancela jobs e notificações não essenciais, mantém disputas e permite leitura privada necessária. Ranking público é retirado por ponteiro sem apagar snapshot auditável.

- [ ] **Step 5: Fechar readiness**

`mvp-05-readiness-report.md` referencia comandos, resultados, SLOs, riscos aceitos, incidentes, baseline e aprovações. Status permitido: `BLOCKED`, `PILOT_READY`, `ROLLOUT_READY`.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/engagement/dispute-correction-audit.spec.ts tests/integration/engagement/experiment-guardrails.spec.ts tests/e2e/admin/engagement-operations.spec.ts docs/operations/engagement/moderation-runbook.md docs/operations/engagement/dispute-runbook.md docs/operations/engagement/experiment-runbook.md docs/operations/engagement/engagement-rollout-runbook.md docs/operations/engagement/engagement-rollback-runbook.md docs/operations/engagement/mvp-05-readiness-report.md
git commit -m "test(engagement): verify responsible rollout"
```

## Verificação final do MVP-05

- [ ] Run: `pnpm engagement:gates`
  Expected: `APPROVED` para o estágio específico; gates externos não aprovados mantêm suas flags fechadas.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm test`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- engagement`
  Expected: PASS para replay, rebuild, privacidade, correção e guardrails.
- [ ] Run: `pnpm test:e2e:mobile -- engagement && pnpm test:e2e:admin -- engagement-operations.spec.ts`
  Expected: PASS com acessibilidade e autorização.
- [ ] Confirmar 0 PII, alias ou medida corporal em eventos, métricas, push, logs e traces.
- [ ] Confirmar opt-out público dentro de 15 minutos e ranking publicado p95 < 500 ms.
- [ ] Confirmar que frequência consistente só é reportada como ganho quando opt-out, denúncia e sinais adversos não pioram.

## Encerramento

O MVP-05 termina em `PILOT_READY` ou `ROLLOUT_READY` somente com relatório e aprovações. O MVP-06 pode consumir agregados de engagement, mas não recebe autorização implícita para campanhas automáticas de retenção.
