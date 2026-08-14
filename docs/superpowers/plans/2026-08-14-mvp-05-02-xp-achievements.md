# MVP-05.2 — XP e conquistas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conceder XP privado e conquistas por fatos verificados, sem duplicação, retroatividade silenciosa ou edição destrutiva.

**Architecture:** Eventos entram por inbox idempotente. Um interpretador declarativo aplica `XpRuleVersion` efetiva na data do fato e grava movimentos append-only; saldo e conquistas são projeções reconstruíveis. Unicidade no PostgreSQL protege contra replay, enquanto BullMQ paraleliza projeções e retries.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/BullMQ, transactional inbox/outbox, Zod, Jest, Testcontainers, OpenAPI e Expo/React Native.

---

## Pré-condições

- Slice 5.1 concluída.
- `M5-RULES-01` aprovado com catálogo sem expressão executável.
- `PassageConfirmed` distingue confirmação, unidade, timestamp e dedup key.
- `ENGAGEMENT_XP_PRIVATE` e `ACHIEVEMENTS` fechadas fora do piloto.

### Task 1: Criar inbox e ledger append-only

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_xp_ledger/migration.sql`
- Create: `packages/engagement-domain/package.json`
- Create: `packages/engagement-domain/tsconfig.json`
- Create: `packages/engagement-domain/src/index.ts`
- Create: `packages/engagement-domain/src/xp/xp-movement.ts`
- Create: `packages/engagement-domain/src/xp/xp-movement.spec.ts`
- Create: `apps/api/src/modules/engagement-xp/infrastructure/engagement-event-inbox.repository.ts`
- Create: `apps/api/src/modules/engagement-xp/infrastructure/xp-ledger.repository.ts`

- [ ] **Step 1: Escrever testes de invariantes**

```ts
it('requires a source and rule version for every grant', () => {
  expect(() => createXpMovement({ type: 'GRANT', points: 10 })).toThrow('XP_PROVENANCE_REQUIRED');
});

it('represents correction as a linked compensating movement', () => {
  expect(reverseMovement(original, reason)).toMatchObject({ type: 'REVERSAL', reversesMovementId: original.id });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/engagement-domain test -- xp-movement`
Expected: FAIL porque pacote e domínio ainda não existem.

- [ ] **Step 3: Modelar persistência**

Crie o pacote puro `@arenahub/engagement-domain` sem dependência de NestJS/Prisma e modele `EngagementEventInbox`, `XpRule`, `XpRuleVersion`, `XpLedgerEntry` e `StudentXpBalance`. A constraint principal impede repetição de `(tenantId, studentId, sourceEventId, ruleVersionId, movementKind)`. Ajustes manuais usam comando idempotente e referência ao movimento afetado.

```ts
export type XpMovement = {
  id: string;
  type: 'GRANT' | 'ADJUSTMENT' | 'REVERSAL';
  points: number;
  ruleVersionId: string;
  sourceEventId: string;
  reversesMovementId: string | null;
};
```

Bloqueie `UPDATE` e `DELETE` do ledger pelo role da aplicação; manutenção emergencial usa runbook e role separado auditado.

- [ ] **Step 4: Aplicar migration e testar concorrência**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_xp_ledger`
Expected: migration aplicada com índices por tenant/aluno/data e constraints de unicidade.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/engagement-domain test -- xp-movement && pnpm --filter api test -- xp-ledger`
Expected: PASS, inclusive dois inserts concorrentes do mesmo grant.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma packages/engagement-domain apps/api/src/modules/engagement-xp/infrastructure
git commit -m "feat(engagement): add append-only xp ledger"
```

### Task 2: Implementar regras versionadas e sessão diária elegível

**Files:**
- Create: `apps/api/src/modules/engagement-rules/domain/declarative-rule.ts`
- Create: `apps/api/src/modules/engagement-rules/domain/declarative-rule.spec.ts`
- Create: `apps/api/src/modules/engagement-rules/application/resolve-effective-rule.use-case.ts`
- Create: `apps/api/src/modules/engagement-rules/application/resolve-effective-rule.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-xp/domain/daily-session-eligibility.ts`
- Create: `apps/api/src/modules/engagement-xp/domain/daily-session-eligibility.spec.ts`
- Create: `apps/api/src/modules/engagement-rules/infrastructure/rule-catalog.loader.ts`

- [ ] **Step 1: Escrever testes de regra e calendário**

```ts
it('awards at most one confirmed session in the unit local day', () => {
  expect(evaluateDay([confirmedAt('08:00'), confirmedAt('19:00')], saoPauloPolicy).eligibleCount).toBe(1);
});

it('keeps old events on the rule effective at occurredAt', () => {
  expect(resolveRule(eventBeforeV2, [v1, v2]).id).toBe(v1.id);
});
```

Cubra DST/timezone, unidade diferente, evento negado, confirmação ausente, atraso de ingestão e versão sobreposta.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- declarative-rule daily-session-eligibility resolve-effective-rule`
Expected: FAIL porque regras ainda não existem.

- [ ] **Step 3: Implementar interpretador allowlist**

Somente operadores do manifesto são aceitos. `effectiveAt` escolhe versão pelo `occurredAt`, não pelo horário do worker. Catálogo é validado por hash e status `APPROVED`; arquivo alterado sem nova versão falha no boot.

- [ ] **Step 4: Implementar janela diária**

Derive `localDate` com timezone da unidade presente no evento/contrato, nunca com timezone do processo. A primeira sessão confirmada elegível fecha a recompensa diária; eventos posteriores permanecem no inbox para auditoria.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- declarative-rule daily-session-eligibility resolve-effective-rule`
Expected: PASS para versões, timezone e múltiplas entradas.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/engagement-rules apps/api/src/modules/engagement-xp/domain
git commit -m "feat(engagement): evaluate versioned xp rules"
```

### Task 3: Consumir eventos com idempotência transacional

**Files:**
- Create: `apps/api/src/modules/engagement-xp/application/process-engagement-event.use-case.ts`
- Create: `apps/api/src/modules/engagement-xp/application/process-engagement-event.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-xp/application/grant-xp.use-case.ts`
- Create: `apps/api/src/modules/engagement-xp/application/grant-xp.use-case.spec.ts`
- Create: `apps/api/src/workers/engagement-xp.processor.ts`
- Create: `apps/api/src/workers/engagement-xp.processor.spec.ts`
- Create: `packages/contracts/src/engagement/xp-granted.event.ts`

- [ ] **Step 1: Escrever teste de replay 100 vezes**

```ts
it('creates one movement when the same event is replayed 100 times', async () => {
  await Promise.all(Array.from({ length: 100 }, () => process(event)));
  expect(await ledger.countFor(event.id)).toBe(1);
  expect(await balance.forStudent(event.studentId)).toBe(rule.points);
});
```

Teste crash após inbox, após ledger e antes do outbox; cada retry converge ao mesmo resultado.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- process-engagement-event grant-xp engagement-xp.processor`
Expected: FAIL porque processor e casos de uso não existem.

- [ ] **Step 3: Implementar transação única**

Reserve inbox, resolva regra, verifique elegibilidade, insira ledger, atualize saldo por projeção versionada e grave `XPGranted` no outbox. Violação de unicidade vira sucesso idempotente, não erro/retry infinito.

Use `jobId`/deduplication ID de BullMQ para reduzir trabalho, mas mantenha as constraints como garantia final.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- process-engagement-event grant-xp engagement-xp.processor`
Expected: PASS para replay, concorrência e falhas injetadas.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-xp/application apps/api/src/workers/engagement-xp.processor.ts apps/api/src/workers/engagement-xp.processor.spec.ts packages/contracts/src/engagement/xp-granted.event.ts
git commit -m "feat(engagement): grant xp idempotently"
```

### Task 4: Implementar conquistas verificadas e reversão

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_achievements/migration.sql`
- Create: `apps/api/src/modules/engagement-achievements/domain/achievement-definition.ts`
- Create: `apps/api/src/modules/engagement-achievements/domain/achievement-definition.spec.ts`
- Create: `apps/api/src/modules/engagement-achievements/application/evaluate-achievements.use-case.ts`
- Create: `apps/api/src/modules/engagement-achievements/application/evaluate-achievements.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-achievements/application/reverse-achievement.use-case.ts`
- Create: `apps/api/src/workers/engagement-achievements.processor.ts`
- Create: `packages/contracts/src/engagement/achievement-unlocked.event.ts`

- [ ] **Step 1: Escrever testes de critérios e correção**

```ts
it('unlocks only from verified ledger evidence', async () => {
  await expect(evaluate(unverifiedClientClaim)).resolves.toEqual([]);
});

it('reverses without deleting the original unlock', async () => {
  const result = await reverse(unlock, disputeResolution);
  expect(result).toMatchObject({ originalStatus: 'REVERSED', auditLinked: true });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- achievement-definition evaluate-achievements`
Expected: FAIL porque modelos e serviços não existem.

- [ ] **Step 3: Modelar e implementar**

Crie `AchievementDefinition`, `AchievementDefinitionVersion` e `StudentAchievement`. Unicidade por aluno/versão/qualifyingWindow. Critérios usam ledger ou eventos verificados; cliente nunca envia “conquista concluída”. Reversão mantém unlock e adiciona estado/correção com motivo.

- [ ] **Step 4: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_achievements && pnpm --filter api test -- achievement-definition evaluate-achievements`
Expected: PASS para replay, versão nova e reversão.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/engagement-achievements apps/api/src/workers/engagement-achievements.processor.ts packages/contracts/src/engagement/achievement-unlocked.event.ts
git commit -m "feat(engagement): unlock verified achievements"
```

### Task 5: Expor XP e conquistas privadas no app

**Files:**
- Create: `apps/api/src/modules/engagement-xp/mobile-xp.controller.ts`
- Create: `apps/api/src/modules/engagement-achievements/mobile-achievements.controller.ts`
- Create: `apps/api/src/modules/engagement-xp/engagement-xp.module.ts`
- Create: `apps/api/src/modules/engagement-achievements/engagement-achievements.module.ts`
- Create: `apps/api/src/modules/engagement-xp/mobile-xp.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-engagement-xp.ts`
- Create: `apps/mobile/app/(protected)/engagement/index.tsx`
- Create: `apps/mobile/app/(protected)/engagement/achievements.tsx`
- Create: `apps/mobile/src/features/engagement/xp/EngagementHomeScreen.tsx`
- Create: `apps/mobile/src/features/engagement/xp/EngagementHomeScreen.test.tsx`

- [ ] **Step 1: Escrever testes de privacidade e explicabilidade**

Teste `GET /api/v1/mobile/engagement/xp` e `/achievements`, aluno atual apenas, regra/razão/data legíveis, nenhuma posição pública e nenhum valor monetário.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-xp.controller.spec.ts && pnpm --filter mobile test -- EngagementHomeScreen.test.tsx`
Expected: FAIL porque endpoints e telas não existem.

- [ ] **Step 3: Implementar API e UI**

Retorne saldo projetado, `asOf`, movimentos paginados, regra pública explicável e conquistas ativas/revertidas. A tela explica de onde veio o XP e não usa linguagem financeira ou comparação social.

- [ ] **Step 4: Gerar contrato e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- mobile-xp.controller.spec.ts && pnpm --filter mobile test -- EngagementHomeScreen.test.tsx`
Expected: PASS com acessibilidade equivalente ao MVP-04.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-xp apps/api/src/modules/engagement-achievements apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-engagement-xp.ts apps/mobile/app/(protected)/engagement apps/mobile/src/features/engagement/xp
git commit -m "feat(engagement): show private xp and achievements"
```

### Task 6: Provar reconstrução e ajustes auditados

**Files:**
- Create: `apps/api/src/modules/engagement-xp/application/rebuild-xp-projection.use-case.ts`
- Create: `apps/api/src/modules/engagement-xp/application/rebuild-xp-projection.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-xp/application/adjust-xp.use-case.ts`
- Create: `apps/api/src/modules/engagement-xp/application/adjust-xp.use-case.spec.ts`
- Create: `apps/api/src/workers/engagement-xp-rebuild.processor.ts`
- Create: `apps/api/src/workers/engagement-xp-rebuild.processor.spec.ts`
- Create: `docs/operations/engagement/xp-rebuild-runbook.md`
- Create: `tests/integration/engagement/xp-ledger-replay.spec.ts`

- [ ] **Step 1: Escrever teste de rebuild paralelo**

Crie projeção sombra a partir do ledger, compare hash e high-water mark, injete novos eventos durante rebuild e só troque ponteiro quando o diff for zero.

```ts
expect(await hashProjection(rebuilt)).toBe(await hashProjection(live));
expect(await countDestructiveLedgerMutations()).toBe(0);
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test:integration -- xp-ledger-replay.spec.ts`
Expected: FAIL porque rebuild sombra não existe.

- [ ] **Step 3: Implementar rebuild e ajuste**

Rebuild é resumível por checkpoint, isolado por tenant e não bloqueia o consumo normal. Ajuste exige permissão, motivo, caso/disputa, idempotency key e movimento compensatório; valor original permanece intacto.

- [ ] **Step 4: Executar integração**

Run: `pnpm test:integration -- xp-ledger-replay.spec.ts`
Expected: PASS com hash idêntico, replay 100× e swap atômico.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-xp/application apps/api/src/workers/engagement-xp-rebuild.processor.ts apps/api/src/workers/engagement-xp-rebuild.processor.spec.ts docs/operations/engagement/xp-rebuild-runbook.md tests/integration/engagement/xp-ledger-replay.spec.ts
git commit -m "feat(engagement): rebuild and adjust xp safely"
```

## Verificação da slice

- [ ] Run: `pnpm --filter api test -- engagement-xp engagement-achievements engagement-rules`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- xp-ledger-replay.spec.ts`
  Expected: PASS; um único grant após 100 replays.
- [ ] Run: `pnpm --filter mobile test -- EngagementHomeScreen.test.tsx`
  Expected: PASS.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com ledger e conquistas reconstruíveis, executar `2026-08-14-mvp-05-03-consistency-streak.md`.
