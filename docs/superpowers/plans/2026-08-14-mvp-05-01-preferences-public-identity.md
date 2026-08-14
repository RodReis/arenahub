# MVP-05.1 — Preferências e identidade pública Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir opt-in e opt-out independentes, registrar prova de consentimento e oferecer identidade pública moderável sem expor quem não participa.

**Architecture:** Alterações de preferência são recibos append-only com uma projeção atual. `PublicProfile` é separado do cadastro civil e nunca é preenchido implicitamente. Um `EngagementExposurePolicy` é chamado tanto na materialização quanto na leitura; opt-out cria tombstone, invalida cache e publica evento no mesmo commit lógico.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Zod, outbox transacional, Redis, OpenAPI, Expo/React Native, Jest, Testing Library e Testcontainers.

---

## Pré-condições

- `M5-ENTRY-01` e `M5-PRIVACY-01` aprovados.
- `ENGAGEMENT_XP_PRIVATE=false`, `RANKINGS=false`, `CHALLENGES=false` e `ENGAGEMENT_PUSH=false` por padrão.
- Política pública possui versão ativa e prazo de propagação aprovado.

### Task 1: Modelar recibos, projeção atual e perfil público

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_engagement_preferences/migration.sql`
- Create: `apps/api/src/modules/engagement-preferences/domain/engagement-preferences.ts`
- Create: `apps/api/src/modules/engagement-preferences/domain/engagement-preferences.spec.ts`
- Create: `apps/api/src/modules/engagement-preferences/domain/public-profile.ts`
- Create: `apps/api/src/modules/engagement-preferences/domain/public-profile.spec.ts`

- [ ] **Step 1: Escrever testes de defaults e transições**

```ts
it('starts every public purpose opted out', () => {
  expect(createDefaultPreferences()).toEqual({
    rankingOptIn: false,
    challengeOptIn: false,
    engagementPushOptIn: false,
    physicalEvolutionRankingOptIn: false,
  });
});

it('does not derive public identity from legal name', () => {
  expect(createPublicProfile({ alias: null }).displayIdentity).toBe('PRIVATE');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-preferences public-profile`
Expected: FAIL porque os domínios não existem.

- [ ] **Step 3: Adicionar modelos aditivos**

Crie `EngagementPreference`, `EngagementPreferenceReceipt`, `PublicProfile` e `EngagementExposureTombstone`. Recibo contém finalidade, valor anterior/novo, versão da política, canal, ator, `occurredAt` e trace ID. Perfil contém alias normalizado, status de moderação e versão.

```ts
export type EngagementPurpose =
  | 'RANKING'
  | 'CHALLENGE'
  | 'ENGAGEMENT_PUSH'
  | 'PHYSICAL_EVOLUTION_RANKING';

export type PublicProfileStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HIDDEN' | 'APPEALED';
```

Use unicidade por tenant/aluno na projeção e por tenant/aluno/finalidade/receipt ID no histórico.

- [ ] **Step 4: Aplicar migration**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name engagement_preferences`
Expected: migration aplicada sem drop ou backfill com opt-in verdadeiro.

- [ ] **Step 5: Implementar domínio e executar testes**

Run: `pnpm --filter api test -- engagement-preferences public-profile`
Expected: PASS para defaults, consentimento específico, alias vazio e transições inválidas.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/engagement-preferences/domain
git commit -m "feat(engagement): model preferences and public profiles"
```

### Task 2: Implementar alteração transacional e opt-out fail-safe

**Files:**
- Create: `apps/api/src/modules/engagement-preferences/application/get-engagement-preferences.use-case.ts`
- Create: `apps/api/src/modules/engagement-preferences/application/update-engagement-preferences.use-case.ts`
- Create: `apps/api/src/modules/engagement-preferences/application/engagement-preferences.use-cases.spec.ts`
- Create: `apps/api/src/modules/engagement-preferences/infrastructure/engagement-preferences.repository.ts`
- Create: `apps/api/src/modules/engagement-preferences/ports/engagement-exposure-cache.port.ts`
- Create: `packages/contracts/src/engagement/engagement-opted-out.event.ts`

- [ ] **Step 1: Escrever testes transacionais**

```ts
it('writes receipt, tombstone and outbox atomically on opt-out', async () => {
  const result = await update.execute(command);
  expect(result.effects).toEqual(expect.arrayContaining(['RECEIPT', 'TOMBSTONE', 'OUTBOX', 'CACHE_INVALIDATION']));
});
```

Cubra policy version ausente, atualização concorrente, retry com mesma idempotency key e opt-out repetido.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- engagement-preferences.use-cases.spec.ts`
Expected: FAIL porque casos de uso e repository não existem.

- [ ] **Step 3: Implementar compare-and-swap**

`PATCH` recebe versão observada e `Idempotency-Key`. Em uma transação, atualize projeção, adicione recibos, crie tombstones para finalidades desativadas e grave `EngagementOptedOut` no outbox. A invalidação Redis ocorre após commit e pode ser refeita pelo worker.

```ts
export interface EngagementExposureCachePort {
  invalidateStudent(input: { tenantId: string; studentId: string; purposes: EngagementPurpose[] }): Promise<void>;
}
```

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- engagement-preferences.use-cases.spec.ts`
Expected: PASS; retry não cria recibo duplicado e conflito retorna `PREFERENCE_VERSION_CONFLICT`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-preferences/application apps/api/src/modules/engagement-preferences/infrastructure apps/api/src/modules/engagement-preferences/ports packages/contracts/src/engagement/engagement-opted-out.event.ts
git commit -m "feat(engagement): persist consent changes atomically"
```

### Task 3: Implementar identidade pública e triagem segura

**Files:**
- Create: `apps/api/src/modules/engagement-preferences/application/update-public-profile.use-case.ts`
- Create: `apps/api/src/modules/engagement-preferences/application/get-public-profile.use-case.ts`
- Create: `apps/api/src/modules/engagement-preferences/application/public-profile.use-cases.spec.ts`
- Create: `apps/api/src/modules/engagement-preferences/domain/alias-screening.ts`
- Create: `apps/api/src/modules/engagement-preferences/domain/alias-screening.spec.ts`
- Create: `apps/api/src/modules/engagement-preferences/ports/alias-screening.port.ts`

- [ ] **Step 1: Escrever testes de alias**

Teste normalização Unicode, espaços invisíveis, homógrafos, e-mail/telefone/CPF, palavra bloqueada, alias duplicado no tenant e alteração após aprovação.

```ts
it('routes suspicious aliases to human review without auto-punishment', async () => {
  await expect(update.execute(suspiciousAlias)).resolves.toMatchObject({ status: 'PENDING' });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- alias-screening public-profile.use-cases.spec.ts`
Expected: FAIL porque triagem e casos de uso não existem.

- [ ] **Step 3: Implementar fluxo moderável**

Alias novo ou alterado fica `PENDING`; somente `APPROVED` pode aparecer publicamente. O screening registra códigos de sinal, não o conteúdo em analytics. Rejeição e ocultação exigem razão categorizada; aluno continua privado durante revisão.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- alias-screening public-profile.use-cases.spec.ts`
Expected: PASS para Unicode, PII, duplicidade e estado privado.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/engagement-preferences
git commit -m "feat(engagement): add moderated public identity"
```

### Task 4: Expor API mobile e contrato de exposição

**Files:**
- Create: `apps/api/src/modules/engagement-preferences/mobile-engagement-preferences.controller.ts`
- Create: `apps/api/src/modules/engagement-preferences/mobile-public-profile.controller.ts`
- Create: `apps/api/src/modules/engagement-preferences/dto/engagement-preferences.dto.ts`
- Create: `apps/api/src/modules/engagement-preferences/engagement-preferences.module.ts`
- Create: `apps/api/src/modules/engagement-preferences/mobile-engagement-preferences.controller.spec.ts`
- Create: `apps/api/src/modules/engagement-preferences/application/engagement-exposure.policy.ts`
- Create: `apps/api/src/modules/engagement-preferences/application/engagement-exposure.policy.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-engagement-preferences.ts`

- [ ] **Step 1: Escrever testes HTTP e de autorização**

Cubra `GET/PATCH /api/v1/mobile/engagement/preferences` e `GET/PATCH /api/v1/mobile/engagement/public-profile`. Derive tenant/aluno exclusivamente de `StudentChannelContext` e recuse referência a outro aluno.

```ts
await request(app)
  .patch('/api/v1/mobile/engagement/preferences')
  .set('Idempotency-Key', key)
  .send({ rankingOptIn: false, observedVersion: 3, policyVersion: 'privacy-v1' })
  .expect(200);
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-engagement-preferences.controller.spec.ts engagement-exposure.policy.spec.ts`
Expected: FAIL porque API e policy não existem.

- [ ] **Step 3: Implementar controllers finos e policy comum**

`EngagementExposurePolicy.canExpose()` exige finalidade ativa, ausência de tombstone, perfil aprovado quando público e consentimento físico específico quando aplicável. Ranking, challenge, export e analytics deverão chamar a mesma porta.

- [ ] **Step 4: Gerar e validar OpenAPI**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS com cliente gerado, sem edição manual.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- mobile-engagement-preferences.controller.spec.ts engagement-exposure.policy.spec.ts`
Expected: PASS; default é privado e tombstone vence cache/snapshot.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/engagement-preferences apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-engagement-preferences.ts
git commit -m "feat(api): expose engagement preferences"
```

### Task 5: Criar telas mobile acessíveis

**Files:**
- Create: `apps/mobile/app/(protected)/engagement/preferences.tsx`
- Create: `apps/mobile/app/(protected)/engagement/public-profile.tsx`
- Create: `apps/mobile/src/features/engagement/preferences/EngagementPreferencesScreen.tsx`
- Create: `apps/mobile/src/features/engagement/preferences/PublicProfileScreen.tsx`
- Create: `apps/mobile/src/features/engagement/preferences/engagementPreferencesApi.ts`
- Create: `apps/mobile/src/features/engagement/preferences/EngagementPreferencesScreen.test.tsx`
- Modify: `apps/mobile/app/(protected)/_layout.tsx`

- [ ] **Step 1: Escrever testes de UX**

Teste toggles desligados, texto por finalidade, confirmação de opt-out, conflito de versão, alias pendente/rejeitado e uso completo por leitor de tela.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- EngagementPreferencesScreen.test.tsx`
Expected: FAIL porque telas não existem.

- [ ] **Step 3: Implementar telas**

Não use toggle mestre. Explique que XP privado permanece disponível ao recusar ranking. Opt-out fica no mesmo nível de navegação do opt-in, sem dark pattern. Mostre status e motivo categorizado do alias sem expor regra de detecção.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter mobile test -- EngagementPreferencesScreen.test.tsx`
Expected: PASS em estados loading, erro, conflito, offline sem persistência sensível e sucesso.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/(protected)/engagement apps/mobile/src/features/engagement/preferences apps/mobile/app/(protected)/_layout.tsx
git commit -m "feat(mobile): add engagement privacy controls"
```

### Task 6: Provar o SLO de opt-out

**Files:**
- Create: `apps/api/src/workers/engagement-opt-out.processor.ts`
- Create: `apps/api/src/workers/engagement-opt-out.processor.spec.ts`
- Create: `tests/integration/engagement/opt-out-propagation.spec.ts`
- Create: `docs/operations/engagement/opt-out-runbook.md`
- Create: `docs/operations/engagement/opt-out-slo-evidence.json`

- [ ] **Step 1: Escrever teste de integração com snapshot e cache antigos**

```ts
it('hides the student immediately and rebuilds public projection within 15 minutes', async () => {
  await optOut(student);
  await expect(readPublishedRanking()).resolves.not.toContainEqual(expect.objectContaining({ studentId: student.id }));
  await advanceWorkerClock('15m');
  expect(await projectionContains(student.id)).toBe(false);
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test:integration -- opt-out-propagation.spec.ts`
Expected: FAIL porque worker e tombstone overlay não estão conectados.

- [ ] **Step 3: Implementar worker idempotente**

Use job ID derivado de tenant/aluno/receipt. Worker invalida todos os caches de exposure, cancela entregas pendentes, solicita nova revisão de ranking/challenge e marca conclusão. O banco continua sendo a garantia; fila pode repetir.

- [ ] **Step 4: Executar teste e registrar evidência**

Run: `pnpm test:integration -- opt-out-propagation.spec.ts`
Expected: PASS para worker parado, retry, cache antigo e duas mensagens iguais; p95 de propagação inferior a 15 minutos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/engagement-opt-out.processor.ts apps/api/src/workers/engagement-opt-out.processor.spec.ts tests/integration/engagement/opt-out-propagation.spec.ts docs/operations/engagement/opt-out-runbook.md docs/operations/engagement/opt-out-slo-evidence.json
git commit -m "test(engagement): prove opt-out propagation"
```

## Verificação da slice

- [ ] Run: `pnpm --filter api test -- engagement-preferences public-profile engagement-exposure`
  Expected: PASS.
- [ ] Run: `pnpm --filter mobile test -- EngagementPreferencesScreen.test.tsx`
  Expected: PASS.
- [ ] Run: `pnpm test:integration -- opt-out-propagation.spec.ts`
  Expected: PASS e nenhuma identidade pública de não participante.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm openapi:check`
  Expected: PASS.

## Próximo plano

Com preferências e exposure policy estáveis, executar `2026-08-14-mvp-05-02-xp-achievements.md`.
