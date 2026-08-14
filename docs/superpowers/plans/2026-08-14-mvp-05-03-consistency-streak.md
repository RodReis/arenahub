# MVP-05.3 — Consistência semanal e streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calcular consistência por semanas locais e pausas aprovadas, sem incentivar entradas diárias ilimitadas ou culpabilizar interrupções.

**Architecture:** `StudentStreak` é uma projeção de semanas qualificadas derivada do mesmo inbox e elegibilidade diária do XP. `StreakPolicyVersion` define calendário, quantidade semanal, pausas e vigência. Rebuild sombra compara a projeção atual antes de swap; o app recebe estado explicável, não decide continuidade.

**Tech Stack:** NestJS, Prisma/PostgreSQL, BullMQ, Zod, helper de timezone IANA com tzdata fixada pelo runtime, Jest, Testcontainers, OpenAPI e Expo/React Native.

---

## Pré-condições

- Slice 5.2 concluída e sessão diária elegível estabilizada.
- Política profissional de consistência assinada em `engagement-policy.json`.
- Semanas, timezone source, pausa e grace rules possuem versões efetivas.
- `STREAKS=false` fora do piloto.

### Task 1: Modelar política e projeção semanal

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_streaks/migration.sql`
- Create: `packages/engagement-domain/src/streaks/streak-policy.ts`
- Create: `packages/engagement-domain/src/streaks/streak-policy.spec.ts`
- Create: `packages/engagement-domain/src/streaks/student-streak.ts`
- Create: `packages/engagement-domain/src/streaks/student-streak.spec.ts`

- [ ] **Step 1: Escrever testes dos estados**

```ts
it('qualifies a week by eligible local days, not raw passages', () => {
  expect(evaluateWeek({ eligibleLocalDays: 3, rawPassages: 8 }, policy)).toMatchObject({ qualified: true, creditedSessions: 3 });
});

it('never creates an unlimited daily streak', () => {
  expect(policy.cadence).toBe('WEEKLY');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/engagement-domain test -- streak`
Expected: FAIL porque política e projeção não existem.

- [ ] **Step 3: Adicionar modelos**

Crie `StreakPolicy`, `StreakPolicyVersion`, `StudentStreak`, `StudentStreakWeek` e `StreakProjectionVersion`. Semana registra início/fim local, sessões elegíveis, qualificação, pausa aplicada, versão da política e evidências.

```ts
export type StreakWeekStatus = 'OPEN' | 'QUALIFIED' | 'MISSED' | 'PAUSED' | 'EXEMPT';
```

Proíba sobreposição de versões e mais de uma linha por aluno/política/início de semana.

- [ ] **Step 4: Aplicar migration e implementar domínio**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_streaks && pnpm --filter @arenahub/engagement-domain test -- streak`
Expected: PASS para semana qualificada, perdida, aberta e versão inválida.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma packages/engagement-domain/src/streaks
git commit -m "feat(engagement): model weekly consistency streaks"
```

### Task 2: Calcular calendário local e fronteiras de semana

**Files:**
- Create: `packages/engagement-domain/src/streaks/local-week.ts`
- Create: `packages/engagement-domain/src/streaks/local-week.spec.ts`
- Create: `apps/api/src/modules/engagement-streaks/application/evaluate-streak-week.use-case.ts`
- Create: `apps/api/src/modules/engagement-streaks/application/evaluate-streak-week.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-streaks/infrastructure/streak-policy.repository.ts`

- [ ] **Step 1: Escrever tabela de datas críticas**

Cubra domingo/segunda conforme política, virada de ano ISO, timezone da unidade, aluno mudando de unidade, evento atrasado e horário de verão onde aplicável.

```ts
it.each(calendarCases)('$label', ({ instant, timezone, expectedWeekKey }) => {
  expect(toLocalWeekKey(instant, timezone, policy)).toBe(expectedWeekKey);
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/engagement-domain test -- local-week && pnpm --filter api test -- evaluate-streak-week`
Expected: FAIL porque calendário ainda não existe.

- [ ] **Step 3: Implementar cálculo determinístico**

Use biblioteca de data homologada, timezone IANA e clock injetável. Evento guarda o timezone resolvido na ocorrência para que mudança futura da unidade não reescreva passado.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter @arenahub/engagement-domain test -- local-week && pnpm --filter api test -- evaluate-streak-week`
Expected: PASS para toda a tabela de fronteiras.

- [ ] **Step 5: Commit**

```bash
git add packages/engagement-domain/src/streaks apps/api/src/modules/engagement-streaks
git commit -m "feat(engagement): calculate local consistency weeks"
```

### Task 3: Aplicar pausas aprovadas sem inferência médica

**Files:**
- Create: `apps/api/src/modules/engagement-streaks/application/apply-approved-pause.use-case.ts`
- Create: `apps/api/src/modules/engagement-streaks/application/apply-approved-pause.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-streaks/domain/approved-pause.ts`
- Create: `apps/api/src/modules/engagement-streaks/domain/approved-pause.spec.ts`
- Create: `apps/api/src/modules/engagement-streaks/ports/subscription-pause-reader.port.ts`

- [ ] **Step 1: Escrever testes de pausa**

```ts
it('uses only an approved pause event', async () => {
  expect(await applyPause({ lowAttendance: true, pauseEvent: null })).toMatchObject({ inferredMedicalPause: false, changed: false });
});
```

Teste pausa parcial, retroativa autorizada, ativação, eventos fora do tenant e política que suspende versus isenta semana.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- approved-pause apply-approved-pause`
Expected: FAIL porque domínio e porta não existem.

- [ ] **Step 3: Implementar política versionada**

Somente `SubscriptionPaused`/`SubscriptionActivated` ou outra evidência explicitamente aprovada pode alterar semanas. Frequência baixa, avaliação de saúde ou texto livre nunca gera pausa automática.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- approved-pause apply-approved-pause`
Expected: PASS e nenhuma inferência de lesão/condição.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-streaks
git commit -m "feat(engagement): preserve streaks for approved pauses"
```

### Task 4: Processar eventos e reconstruir a projeção

**Files:**
- Create: `apps/api/src/modules/engagement-streaks/application/project-streak-event.use-case.ts`
- Create: `apps/api/src/modules/engagement-streaks/application/project-streak-event.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-streaks/application/rebuild-streaks.use-case.ts`
- Create: `apps/api/src/modules/engagement-streaks/application/rebuild-streaks.use-case.spec.ts`
- Create: `apps/api/src/workers/engagement-streaks.processor.ts`
- Create: `apps/api/src/workers/engagement-streaks.processor.spec.ts`
- Create: `packages/contracts/src/engagement/streak-extended.event.ts`
- Create: `packages/contracts/src/engagement/streak-broken.event.ts`

- [ ] **Step 1: Escrever testes de replay e evento atrasado**

Processe 100 vezes o mesmo `PassageConfirmed`, depois insira um evento válido atrasado. O primeiro não duplica contagem; o segundo recalcula apenas a janela afetada e emite evento uma vez.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- project-streak-event rebuild-streaks engagement-streaks.processor`
Expected: FAIL porque projeção e worker não existem.

- [ ] **Step 3: Implementar checkpoint e janela afetada**

Cada processamento registra source event, policy version e week key. Rebuild cria versão sombra por tenant/aluno, compara hash e faz swap atômico. Evento externo só é emitido quando o estado publicado muda.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- project-streak-event rebuild-streaks engagement-streaks.processor`
Expected: PASS para replay, reorder, crash e rebuild.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-streaks apps/api/src/workers/engagement-streaks.processor.ts apps/api/src/workers/engagement-streaks.processor.spec.ts packages/contracts/src/engagement/streak-extended.event.ts packages/contracts/src/engagement/streak-broken.event.ts
git commit -m "feat(engagement): project weekly streaks idempotently"
```

### Task 5: Expor streak explicável no mobile

**Files:**
- Create: `apps/api/src/modules/engagement-streaks/mobile-streak.controller.ts`
- Create: `apps/api/src/modules/engagement-streaks/mobile-streak.controller.spec.ts`
- Create: `apps/api/src/modules/engagement-streaks/engagement-streaks.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Modify: `packages/api-contracts/src/mobile-engagement-xp.ts`
- Create: `apps/mobile/app/(protected)/engagement/streak.tsx`
- Create: `apps/mobile/src/features/engagement/streak/StreakScreen.tsx`
- Create: `apps/mobile/src/features/engagement/streak/StreakScreen.test.tsx`

- [ ] **Step 1: Escrever testes de contrato e linguagem**

Teste `GET /api/v1/mobile/engagement/streak`, semana atual, histórico, política pública, pausa e estado interrompido. UI não usa culpa, ameaça de perda ou incentivo acima do limite.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-streak.controller.spec.ts && pnpm --filter mobile test -- StreakScreen.test.tsx`
Expected: FAIL porque endpoint e tela não existem.

- [ ] **Step 3: Implementar API e tela**

Retorne `currentWeeks`, `bestWeeks`, `currentWeekProgress`, `policySummary`, `asOf` e explicações. Semana perdida usa mensagem neutra e próxima ação opcional; pausa não pede detalhe médico.

- [ ] **Step 4: Gerar contrato e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- mobile-streak.controller.spec.ts && pnpm --filter mobile test -- StreakScreen.test.tsx`
Expected: PASS com leitor de tela, fonte ampliada e reduced motion.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-streaks apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-engagement-xp.ts apps/mobile/app/(protected)/engagement/streak.tsx apps/mobile/src/features/engagement/streak
git commit -m "feat(engagement): show weekly consistency"
```

### Task 6: Validar calendário e rebuild ponta a ponta

**Files:**
- Create: `tests/integration/engagement/streak-calendar-rebuild.spec.ts`
- Create: `docs/operations/engagement/streak-rebuild-runbook.md`
- Create: `docs/operations/engagement/streak-policy-evidence.json`

- [ ] **Step 1: Criar bateria determinística**

Use fixtures com múltiplas unidades/timezones, duas passagens no dia, pausa aprovada, evento atrasado, virada anual e versão nova de política.

- [ ] **Step 2: Executar integração**

Run: `pnpm test:integration -- streak-calendar-rebuild.spec.ts`
Expected: PASS; projeção reconstruída possui mesmo hash e histórico antigo permanece na versão original.

- [ ] **Step 3: Documentar operação e rollback**

Runbook inclui dry-run, escopo por tenant, checkpoint, diff, swap, rollback de ponteiro e alerta de divergência.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/engagement/streak-calendar-rebuild.spec.ts docs/operations/engagement/streak-rebuild-runbook.md docs/operations/engagement/streak-policy-evidence.json
git commit -m "test(engagement): prove streak calendar rebuild"
```

## Verificação da slice

- [ ] Run: `pnpm --filter @arenahub/engagement-domain test -- streak local-week`
  Expected: PASS.
- [ ] Run: `pnpm --filter api test -- engagement-streaks`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- streak-calendar-rebuild.spec.ts`
  Expected: PASS para timezone, pausa e replay.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com consistência estável, executar `2026-08-14-mvp-05-04-private-rankings.md`.
