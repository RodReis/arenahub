# MVP-05.5 — Desafios e notificações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir desafios opt-in a partir de templates seguros e comunicar progresso sem ultrapassar limites profissionais, consentimento, quiet hours ou orçamento de contato.

**Architecture:** Templates versionados são a única origem de desafios. Adesão é uma máquina de estados independente; progresso deriva da mesma sessão/evento elegível e usa unicidade no banco. Engagement cria intenções de notificação, mas `student-notifications` continua dono da inbox e entrega. BullMQ agenda `notBefore`/expiração; consentimento é revalidado no envio.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/BullMQ, Expo Notifications conforme gate do MVP-04, outbox, Zod, OpenAPI, Expo/React Native, Next.js admin, Jest e Testcontainers.

---

## Pré-condições

- Slices 5.1 a 5.4 concluídas.
- `M5-RULES-01` e `M5-NOTIFY-01` aprovados.
- Templates possuem cap profissional, duração, população, métrica e orçamento assinados.
- Inbox interna do MVP-04 está estável.
- `CHALLENGES=false`; `ENGAGEMENT_PUSH=false` até provider e distribuição estarem aprovados.

### Task 1: Modelar templates, desafios e participação

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_challenges/migration.sql`
- Create: `packages/engagement-domain/src/challenges/challenge-template.ts`
- Create: `packages/engagement-domain/src/challenges/challenge-template.spec.ts`
- Create: `packages/engagement-domain/src/challenges/challenge-participation.ts`
- Create: `packages/engagement-domain/src/challenges/challenge-participation.spec.ts`

- [ ] **Step 1: Escrever testes de segurança e estados**

```ts
it('rejects a requested target above the signed professional cap', () => {
  expect(() => instantiateChallenge(template, { target: template.professionalCap + 1 })).toThrow('UNSAFE_CHALLENGE_TARGET');
});

it('does not enroll an eligible student automatically', () => {
  expect(createParticipant({ explicitJoin: false })).toMatchObject({ status: 'NOT_JOINED' });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/engagement-domain test -- challenge`
Expected: FAIL porque domínio não existe.

- [ ] **Step 3: Adicionar modelos**

Crie `ChallengeTemplate`, `ChallengeTemplateVersion`, `Challenge`, `ChallengeParticipant`, `ChallengeProgressEntry` e `ChallengeProjectionVersion`.

```ts
export type ChallengeStatus = 'DRAFT' | 'VALIDATED' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type ChallengeParticipantStatus = 'NOT_JOINED' | 'JOINED' | 'LEFT' | 'COMPLETED';
```

Template fixa operador permitido, unidade, janela, timezone, cap, elegibilidade, audience mínima, conteúdo permitido e orçamento de notificação. Challenge copia a versão; edição posterior do template não altera instâncias.

- [ ] **Step 4: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_challenges && pnpm --filter @arenahub/engagement-domain test -- challenge`
Expected: PASS para target, datas, transições, join explícito e leave idempotente.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma packages/engagement-domain/src/challenges
git commit -m "feat(engagement): model safe challenge templates"
```

### Task 2: Criar e publicar desafios somente por template

**Files:**
- Create: `apps/api/src/modules/engagement-challenges/application/create-challenge.use-case.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/create-challenge.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/activate-challenge.use-case.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/activate-challenge.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-challenges/infrastructure/challenge.repository.ts`
- Create: `apps/api/src/modules/engagement-challenges/ports/challenge-safety-policy.port.ts`

- [ ] **Step 1: Escrever testes de publicação**

Cubra template inexistente/inativo, alteração de métrica, unidade errada, cap ausente, duração excessiva, audience insuficiente e operador sem permissão.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- create-challenge activate-challenge`
Expected: FAIL porque casos de uso não existem.

- [ ] **Step 3: Implementar validação em duas fases**

Criação produz `DRAFT`; validação persiste hash e evidências; ativação revalida política, coorte e feature flag em uma transação. Não aceite payload livre de regra ou target acima do template.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- create-challenge activate-challenge`
Expected: PASS; qualquer cenário inseguro falha antes de `ACTIVE`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-challenges
git commit -m "feat(engagement): publish challenges from approved templates"
```

### Task 3: Implementar adesão e progresso idempotentes

**Files:**
- Create: `apps/api/src/modules/engagement-challenges/application/join-challenge.use-case.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/leave-challenge.use-case.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/challenge-participation.use-cases.spec.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/project-challenge-progress.use-case.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/project-challenge-progress.use-case.spec.ts`
- Create: `apps/api/src/workers/engagement-challenge-progress.processor.ts`
- Create: `apps/api/src/workers/engagement-challenge-progress.processor.spec.ts`
- Create: `packages/contracts/src/engagement/challenge-joined.event.ts`
- Create: `packages/contracts/src/engagement/challenge-completed.event.ts`

- [ ] **Step 1: Escrever testes de independência e replay**

```ts
it('allows leaving a challenge without disabling private XP', async () => {
  await leave.execute(command);
  expect(await preferences.privateXpEnabled(student.id)).toBe(true);
});

it('credits one progress entry for 100 event replays', async () => {
  await Promise.all(Array.from({ length: 100 }, () => project(event)));
  expect(await progress.countBySource(event.id)).toBe(1);
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- challenge-participation project-challenge-progress engagement-challenge-progress.processor`
Expected: FAIL porque casos de uso e worker não existem.

- [ ] **Step 3: Implementar participação explícita**

Join exige `challengeOptIn`, challenge ativo, elegibilidade atual e idempotency key. Leave interrompe progresso/notificações futuras e mantém histórico restrito. Progresso usa o operador/template versionado e source event único.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- challenge-participation project-challenge-progress engagement-challenge-progress.processor`
Expected: PASS para replay, leave concorrente, evento atrasado e conclusão única.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-challenges/application apps/api/src/workers/engagement-challenge-progress.processor.ts apps/api/src/workers/engagement-challenge-progress.processor.spec.ts packages/contracts/src/engagement/challenge-joined.event.ts packages/contracts/src/engagement/challenge-completed.event.ts
git commit -m "feat(engagement): track opt-in challenge progress"
```

### Task 4: Integrar intenções com inbox e push do MVP-04

**Files:**
- Create: `apps/api/src/modules/engagement-challenges/application/create-challenge-notification.use-case.ts`
- Create: `apps/api/src/modules/engagement-challenges/application/create-challenge-notification.use-case.spec.ts`
- Create: `apps/api/src/modules/engagement-challenges/ports/student-notification.port.ts`
- Create: `apps/api/src/modules/student-notifications/domain/engagement-notification-budget.ts`
- Create: `apps/api/src/modules/student-notifications/domain/engagement-notification-budget.spec.ts`
- Create: `apps/api/src/workers/engagement-notifications.processor.ts`
- Create: `apps/api/src/workers/engagement-notifications.processor.spec.ts`
- Modify: `apps/api/src/workers/student-channels-push.processor.ts`
- Modify: `apps/api/src/workers/student-channels-push.processor.spec.ts`

- [ ] **Step 1: Escrever testes de consentimento, quiet hours e orçamento**

```ts
it('expires a stale nudge instead of bursting after quiet hours', async () => {
  const result = await schedule(messagePastExpiry, quietHours);
  expect(result.status).toBe('EXPIRED');
});

it('revalidates consent at delivery time', async () => {
  await preferences.optOut(student.id, 'ENGAGEMENT_PUSH');
  expect(await deliver(pendingPush)).toMatchObject({ status: 'CANCELLED_BY_CONSENT' });
});
```

Teste limite por aluno, tenant e challenge; conteúdo corporal/posição; token rotacionado; receipt inválido; provider indisponível.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-notification-budget create-challenge-notification engagement-notifications student-channels-push`
Expected: FAIL porque orçamento e integração não existem.

- [ ] **Step 3: Implementar intenção mínima**

`StudentNotificationPort` recebe template ID, deep link opaco, prioridade, `notBefore`, `expiresAt`, campaign/challenge ID e budget key. Inbox interna respeita opt-in de challenge. Push exige também `engagementPushOptIn` e `ENGAGEMENT_PUSH=true`.

```ts
export interface StudentNotificationPort {
  enqueue(input: {
    tenantId: string;
    studentId: string;
    templateId: string;
    campaignId: string;
    notBefore: string;
    expiresAt: string;
    deepLinkToken: string;
  }): Promise<{ notificationId: string; status: string }>;
}
```

- [ ] **Step 4: Tratar rotação e falha de token**

Reutilize `MobileDevice` do MVP-04. O listener Expo atualiza o backend quando o token muda. Entrega associa ticket/receipt ao hash do token; `DeviceNotRegistered` desativa aquele token, sem revogar conta. Se o provider continuou deferido no MVP-04, mantenha push fechado e entregue somente inbox interna.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- engagement-notification-budget create-challenge-notification engagement-notifications student-channels-push`
Expected: PASS sem rajada, PII em lock screen ou bypass do consentimento.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/engagement-challenges apps/api/src/modules/student-notifications apps/api/src/workers/engagement-notifications.processor.ts apps/api/src/workers/engagement-notifications.processor.spec.ts apps/api/src/workers/student-channels-push.processor.ts apps/api/src/workers/student-channels-push.processor.spec.ts
git commit -m "feat(engagement): deliver bounded challenge notifications"
```

### Task 5: Expor APIs e jornadas mobile/admin

**Files:**
- Create: `apps/api/src/modules/engagement-challenges/mobile-challenges.controller.ts`
- Create: `apps/api/src/modules/engagement-challenges/admin-challenges.controller.ts`
- Create: `apps/api/src/modules/engagement-challenges/challenges.controllers.spec.ts`
- Create: `apps/api/src/modules/engagement-challenges/engagement-challenges.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-engagement-challenges.ts`
- Create: `apps/mobile/app/(protected)/engagement/challenges.tsx`
- Create: `apps/mobile/app/(protected)/engagement/challenges/[challengeId].tsx`
- Create: `apps/mobile/src/features/engagement/challenges/ChallengesScreen.tsx`
- Create: `apps/mobile/src/features/engagement/challenges/ChallengesScreen.test.tsx`
- Create: `apps/admin-web/app/(protected)/engagement/challenges/page.tsx`
- Create: `apps/admin-web/components/engagement/ChallengeBuilder.tsx`
- Create: `apps/admin-web/components/engagement/ChallengeBuilder.test.tsx`

- [ ] **Step 1: Escrever testes HTTP e UI**

Cubra `GET /api/v1/mobile/engagement/challenges`, detalhe, `POST .../:id/join`, `DELETE .../:id/join` e `POST /api/v1/admin/engagement/challenges`. Teste adesão explícita, saída acessível, regras/datas e erro de template inseguro.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- challenges.controllers.spec.ts && pnpm --filter mobile test -- ChallengesScreen.test.tsx && pnpm --filter admin-web test -- ChallengeBuilder.test.tsx`
Expected: FAIL porque controllers e telas não existem.

- [ ] **Step 3: Implementar controllers e telas**

Admin seleciona template e parâmetros permitidos; não edita regra livre. Mobile mostra alvo seguro, progresso, período, fontes elegíveis, orçamento de contato e botão sair. Linguagem não pressiona por pausa/lesão.

- [ ] **Step 4: Gerar contrato e executar testes**

Run: `pnpm openapi:generate && pnpm openapi:check && pnpm --filter api test -- challenges.controllers.spec.ts && pnpm --filter mobile test -- ChallengesScreen.test.tsx && pnpm --filter admin-web test -- ChallengeBuilder.test.tsx`
Expected: PASS com autorização por tenant/unidade e acessibilidade.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-challenges apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-engagement-challenges.ts apps/mobile/app/(protected)/engagement/challenges.tsx apps/mobile/app/(protected)/engagement/challenges/[challengeId].tsx apps/mobile/src/features/engagement/challenges apps/admin-web/app/(protected)/engagement/challenges apps/admin-web/components/engagement
git commit -m "feat(engagement): expose safe challenge journeys"
```

### Task 6: Provar rejeição, opt-out e entrega controlada

**Files:**
- Create: `tests/integration/engagement/challenge-safety-notifications.spec.ts`
- Create: `tests/e2e/mobile/engagement-challenge.spec.ts`
- Create: `docs/operations/engagement/challenge-runbook.md`
- Create: `docs/operations/engagement/notification-delivery-runbook.md`
- Create: `docs/operations/engagement/challenge-pilot-evidence.json`

- [ ] **Step 1: Montar cenários adversos**

Inclua challenge acima do cap, aluno fora da coorte, 100 replays, opt-out após enqueue, quiet hours, mensagem expirada, token rotacionado e provider fora.

- [ ] **Step 2: Executar integração e E2E**

Run: `pnpm test:integration -- challenge-safety-notifications.spec.ts && pnpm test:e2e:mobile -- engagement-challenge.spec.ts`
Expected: PASS; challenge inseguro nunca ativa e opt-out cancela exposição/entrega.

- [ ] **Step 3: Documentar operação**

Runbooks cobrem pause/cancel, projeção, fila, dead-letter, reprocessamento, rotação de token, fallback para inbox interna e rollback das flags.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/engagement/challenge-safety-notifications.spec.ts tests/e2e/mobile/engagement-challenge.spec.ts docs/operations/engagement/challenge-runbook.md docs/operations/engagement/notification-delivery-runbook.md docs/operations/engagement/challenge-pilot-evidence.json
git commit -m "test(engagement): prove challenge safety and delivery"
```

## Verificação da slice

- [ ] Run: `pnpm --filter @arenahub/engagement-domain test -- challenge`
  Expected: PASS.
- [ ] Run: `pnpm --filter api test -- engagement-challenges engagement-notification student-channels-push`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- challenge-safety-notifications.spec.ts`
  Expected: PASS.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com desafios e entrega controlada, executar `2026-08-14-mvp-05-06-operations-experiment.md`.
