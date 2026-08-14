# MVP-04.7 — Piloto e distribuição Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribuir app e kiosk de forma controlada, medir estabilidade/autosserviço, aplicar versão mínima e executar rollback antes do rollout geral.

**Architecture:** Notificações internas existem sempre; push externo fica atrás de `PushProvider` e consentimento. Telemetria usa allowlist e redaction antes de sair do processo. API centraliza version policy e feature flags; app e kiosk aplicam grace/bloqueio sem decidir suas próprias versões mínimas. Builds assinados, rollout e restore seguem runbooks ensaiados.

**Tech Stack:** NestJS, Prisma/PostgreSQL, BullMQ, Expo Notifications/Updates e provider homologado, Next.js kiosk, crash provider homologado, feature flags, Jest, Vitest, Playwright e distribuição assinada.

---

## Pré-condições

- Slices 4.1 a 4.6 aplicáveis ao piloto concluídas.
- `M4-DIST-01` aprovado; push externo exige `M4-PUSH-01`.
- Contas, certificados, secrets, dispositivos e responsáveis não são armazenados no Git.

### Task 1: Implementar inbox de notificações internas

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_student_notifications/migration.sql`
- Create: `apps/api/src/modules/student-notifications/domain/student-notification.ts`
- Create: `apps/api/src/modules/student-notifications/domain/student-notification.spec.ts`
- Create: `apps/api/src/modules/student-notifications/student-notifications.controller.ts`
- Create: `apps/api/src/modules/student-notifications/student-notifications.controller.spec.ts`
- Create: `apps/api/src/modules/student-notifications/student-notifications.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/mobile/app/(protected)/notifications.tsx`
- Create: `apps/mobile/src/features/notifications/notification-inbox.tsx`
- Create: `apps/mobile/src/features/notifications/notification-inbox.test.tsx`

- [ ] **Step 1: Escrever testes de escopo e conteúdo**

```ts
expect(notificationFor(studentA)).toMatchObject({ studentId: studentA.id });
await expect(readNotificationAs(studentB, notificationA.id)).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
```

Conteúdo interno pode ser detalhado conforme autorização, mas não entra em logs. Teste cursor, lida/não lida, expiração e ação por deep link allowlisted.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- student-notification`
Expected: FAIL porque domínio e controller não existem.

- [ ] **Step 3: Implementar modelo e API**

Crie `StudentNotification` com tenant/aluno, tipo, título, corpo, action code, created/expires/read. `StudentNotificationsModule` é importado no `AppModule`. Exponha `GET /api/v1/mobile/notifications` e `POST /notifications/:id/read`.

```ts
export type StudentNotificationAction = 'OPEN_INVOICE' | 'OPEN_ATTENDANCE' | 'OPEN_HEALTH' | 'NONE';
```

- [ ] **Step 4: Aplicar migration e implementar UI**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name student_notifications`
Expected: migration aplicada sem drift.

Inbox usa lista acessível e traduz action code em rota local allowlisted; URL arbitrária nunca vem da API.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- student-notification && pnpm --filter mobile test -- notification-inbox.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/student-notifications apps/api/src/app.module.ts apps/mobile/app/\(protected\)/notifications.tsx apps/mobile/src/features/notifications
git commit -m "feat(mobile): add internal notification inbox"
```

### Task 2: Implementar push opt-in atrás de provider

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_push_subscriptions/migration.sql`
- Create: `apps/api/src/modules/student-notifications/ports/push-provider.port.ts`
- Create: `apps/api/src/modules/student-notifications/application/register-push-subscription.use-case.ts`
- Create: `apps/api/src/modules/student-notifications/application/dispatch-student-push.use-case.ts`
- Create: `apps/api/src/modules/student-notifications/application/push-use-cases.spec.ts`
- Create: `apps/api/src/workers/student-channels-push.processor.ts`
- Modify: `apps/api/src/modules/student-notifications/student-notifications.module.ts`
- Create: `apps/mobile/src/features/notifications/push-consent.tsx`
- Create: `apps/mobile/src/features/notifications/push-consent.test.tsx`

- [ ] **Step 1: Escrever testes de consentimento e minimização**

```ts
it('does not dispatch without active consent', async () => {
  await dispatch(notification, revokedConsent);
  expect(provider.send).not.toHaveBeenCalled();
});

expect(lockScreenPayload(invoiceNotification)).toEqual({ title: 'ArenaHub', body: 'Você tem uma atualização no aplicativo.', data: { actionToken: expect.any(String) } });
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- push-use-cases.spec.ts`
Expected: FAIL porque porta e casos de uso não existem.

- [ ] **Step 3: Implementar subscription segura**

`PushSubscription` guarda token cifrado, hash idempotente, provider, platform, consent version, device e revogação. Nunca logue token. Receipt inválido desativa subscription.

```ts
export interface PushProvider {
  send(input: { destinationToken: string; title: string; body: string; actionToken: string }): Promise<{ receiptId: string }>;
}
```

O use case decifra o token apenas em memória imediatamente antes da porta; implementações de provider devem marcar `destinationToken` como sensível e nunca serializá-lo em log/erro.

- [ ] **Step 4: Conectar adapter homologado ou manter desabilitado**

Se `push-capabilities.json` estiver `HOMOLOGATED`, execute `2026-08-14-mvp-04-push-provider-adapter.md`. Se estiver `DEFERRED_TO_MVP_05_SLICE_5_5`, `PUSH_NOTIFICATIONS=false` e somente inbox permanece disponível.

- [ ] **Step 5: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name push_subscriptions`
Expected: migration aplicada sem drift.

Run: `pnpm --filter api test -- push-use-cases.spec.ts && pnpm --filter mobile test -- push-consent.test.tsx`
Expected: PASS para opt-in, opt-out, token rotacionado e conteúdo mínimo.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/student-notifications apps/api/src/workers/student-channels-push.processor.ts apps/mobile/src/features/notifications
git commit -m "feat(mobile): add consented push delivery"
```

### Task 3: Instrumentar crash e jornadas com redaction local

**Files:**
- Create: `packages/observability/src/student-channel-telemetry.ts`
- Create: `packages/observability/src/student-channel-telemetry.test.ts`
- Create: `apps/mobile/src/observability/mobile-telemetry.ts`
- Create: `apps/mobile/src/observability/mobile-telemetry.test.ts`
- Create: `apps/kiosk/src/observability/kiosk-telemetry.ts`
- Create: `apps/kiosk/src/observability/kiosk-telemetry.test.ts`
- Create: `apps/api/src/modules/student-mobile/channel-telemetry.controller.ts`
- Create: `apps/api/src/modules/student-mobile/channel-telemetry.controller.spec.ts`
- Modify: `apps/api/src/modules/student-mobile/student-mobile.module.ts`

- [ ] **Step 1: Escrever testes de allowlist**

```ts
expect(sanitizeTelemetry({ event: 'LOGIN_FAILED', email: 'a@b.test', token: 'x', invoiceId: 'i' })).toEqual({ event: 'LOGIN_FAILED' });
expect(() => sanitizeTelemetry({ event: 'UNKNOWN_EVENT' })).toThrow('TELEMETRY_EVENT_NOT_ALLOWED');
```

Teste crash com stack, URL, breadcrumbs e payloads financeiros/saúde. Somente versão, plataforma, evento, resultado, duração bucketizada e trace ID são permitidos.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/observability test -- student-channel-telemetry`
Expected: FAIL porque sanitizer não existe.

- [ ] **Step 3: Implementar redaction antes do provider**

```ts
export interface ChannelTelemetryEvent {
  event: 'APP_OPENED' | 'LOGIN_SUCCEEDED' | 'LOGIN_FAILED' | 'SELF_SERVICE_COMPLETED' | 'KIOSK_SESSION_ENDED' | 'CHANNEL_CRASHED';
  appVersion: string;
  platform: string;
  traceId: string;
  durationBucket?: 'LT_1S' | '1S_3S' | 'GT_3S';
}
```

Provider real só recebe objeto sanitizado; usuário/aluno/device estável não é enviado como identidade direta.

- [ ] **Step 4: Executar plano do crash provider**

Execute `2026-08-14-mvp-04-crash-provider-adapter.md` aprovado em `M4-DIST-01`, incluindo teste de payload capturado no ambiente sandbox.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/observability test -- student-channel-telemetry && pnpm --filter mobile test -- mobile-telemetry && pnpm --filter kiosk test -- kiosk-telemetry`
Expected: PASS sem PII nos snapshots.

- [ ] **Step 6: Commit**

```bash
git add packages/observability apps/mobile/src/observability apps/kiosk/src/observability apps/api/src/modules/student-mobile/channel-telemetry.controller.ts apps/api/src/modules/student-mobile/channel-telemetry.controller.spec.ts apps/api/src/modules/student-mobile/student-mobile.module.ts
git commit -m "feat(channels): add privacy-safe journey telemetry"
```

### Task 4: Aplicar versão mínima e kill switches

**Files:**
- Create: `apps/api/src/modules/student-mobile/version-policy.service.ts`
- Create: `apps/api/src/modules/student-mobile/version-policy.service.spec.ts`
- Create: `apps/mobile/src/platform/version-gate.tsx`
- Create: `apps/mobile/src/platform/version-gate.test.tsx`
- Create: `apps/kiosk/src/platform/version-gate.tsx`
- Create: `apps/kiosk/src/platform/version-gate.test.tsx`
- Create: `apps/api/src/modules/student-mobile/student-channel-feature-flags.ts`
- Create: `apps/api/src/modules/student-mobile/student-channel-feature-flags.spec.ts`
- Modify: `apps/api/src/modules/student-mobile/student-mobile.module.ts`

- [ ] **Step 1: Escrever testes de precedência**

```ts
expect(resolveVersion('1.4.0', { minimum: '1.5.0', graceUntil: future })).toEqual({ state: 'GRACE' });
expect(resolveVersion('1.4.0', { minimum: '1.5.0', graceUntil: past })).toEqual({ state: 'BLOCKED' });
expect(resolveFlag({ global: false, tenant: true })).toBe(false);
```

Configuração ausente/inválida fecha feature. Bloqueio de app não impede tela de update/suporte; kiosk bloqueado mantém heartbeat e restore.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- version-policy student-channel-feature-flags`
Expected: FAIL porque services não existem.

- [ ] **Step 3: Implementar política central**

API lê `version-policy.json` publicado por config segura e responde `SUPPORTED/GRACE/BLOCKED`, update URL e deadline. Flags: `STUDENT_MOBILE`, `MOBILE_PAYMENTS`, `KIOSK`, `KIOSK_PAYMENTS`, `PUSH_NOTIFICATIONS`.

- [ ] **Step 4: Implementar gates de UI**

Mobile e kiosk usam resposta backend; não codificam versão mínima. Em `BLOCKED`, limpam sessão sensível antes de mostrar atualização.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- version-policy student-channel-feature-flags && pnpm --filter mobile test -- version-gate && pnpm --filter kiosk test -- version-gate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/student-mobile apps/mobile/src/platform apps/kiosk/src/platform
git commit -m "feat(channels): enforce minimum version and kill switches"
```

### Task 5: Configurar builds assinados e release controlado

**Files:**
- Create: `apps/mobile/eas.json`
- Create: `apps/mobile/scripts/verify-release-config.mjs`
- Create: `apps/mobile/scripts/verify-release-config.test.mjs`
- Create: `apps/kiosk/scripts/build-kiosk-release.mjs`
- Create: `apps/kiosk/scripts/verify-kiosk-release.test.mjs`
- Create: `docs/operations/app-totem/runbooks/mobile-release.md`
- Create: `docs/operations/app-totem/runbooks/mobile-rollback.md`
- Create: `docs/operations/app-totem/runbooks/kiosk-update.md`
- Modify: `docs/operations/app-totem/runbooks/kiosk-restore.md`

- [ ] **Step 1: Escrever testes de configuração de release**

Verifique application IDs, runtime/version policy, channel, update URL, build number monotônico, assinatura externa e ausência de secret em config gerada.

```js
assert.equal(release.channel, 'internal');
assert.equal(findSecrets(release).length, 0);
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test:release-config && pnpm --filter kiosk test:release-config`
Expected: FAIL porque scripts/configs não existem.

- [ ] **Step 3: Implementar perfis e artefatos**

Crie perfis development, internal e production conforme `distribution-policy.md`. Kiosk gera artefato versionado e checksum; nenhuma credencial entra no pacote ou log.

- [ ] **Step 4: Ensaiar build e rollback**

Run: `pnpm --filter mobile build:internal && pnpm --filter kiosk build:release`
Expected: artefatos assinados/checksummed no storage de release aprovado.

Outro operador executa rollback mobile e restore kiosk usando runbooks; registre tempos e evidências.

- [ ] **Step 5: Commit somente configuração sanitizada**

```bash
git add apps/mobile/eas.json apps/mobile/scripts apps/kiosk/scripts docs/operations/app-totem/runbooks
git commit -m "ops(channels): add signed release workflows"
```

### Task 6: Executar piloto e medir metas

**Files:**
- Create: `docs/operations/app-totem/pilot-plan.md`
- Create: `docs/operations/app-totem/pilot-checklist.md`
- Create: `docs/operations/app-totem/support-playbook.md`
- Create: `docs/operations/app-totem/rollback-plan.md`
- Create: `docs/operations/app-totem/evidence/mvp-04-pilot.md`
- Create: `tests/performance/mobile-home-pilot.js`
- Create: `tests/performance/kiosk-session-cleanup.js`

- [ ] **Step 1: Definir coortes e stop conditions**

Ondas: equipe interna, alunos consentidos sem pagamento, um kiosk assistido, financeiro mobile, financeiro kiosk, rollout percentual. Stop conditions incluem PII em telemetria, refresh replay não contido, pagamento duplicado, resíduo A→B, QR replay, crash-free abaixo da meta e rollback inviável.

- [ ] **Step 2: Medir métricas sem reidentificação**

Login concluído mede tentativa→sessão sem registrar identificador. Autosserviço mede jornadas elegíveis concluídas sem atendimento. Crash-free usa provider homologado; coortes pequenas não geram dashboard individual.

- [ ] **Step 3: Executar performance e estabilidade**

Run: `pnpm exec k6 run tests/performance/mobile-home-pilot.js && pnpm exec k6 run tests/performance/kiosk-session-cleanup.js`
Expected: Home p95 menor que 2,5 s e cleanup menor ou igual a 2 s.

Run: `pnpm --filter mobile test:e2e && pnpm --filter kiosk test:e2e:hardware`
Expected: PASS nos devices e kiosk de referência.

- [ ] **Step 4: Avaliar metas do piloto**

Exija login sem suporte ≥70%, autosserviço de situação/segunda via ≥80%, crash-free ≥99,5%, zero vazamento A→B e zero duplicação lógica de pagamento.

- [ ] **Step 5: Registrar decisão go/no-go**

Produto, Operação, Segurança, Privacidade e Engenharia assinam. Resultado parcial não autoriza rollout geral.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/app-totem/pilot-plan.md docs/operations/app-totem/pilot-checklist.md docs/operations/app-totem/support-playbook.md docs/operations/app-totem/rollback-plan.md docs/operations/app-totem/evidence/mvp-04-pilot.md tests/performance
git commit -m "ops(channels): complete app and kiosk pilot"
```

### Task 7: Fechar rastreabilidade do MVP-04

**Files:**
- Create: `docs/operations/app-totem/evidence/mvp-04-final-traceability.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md`
- Modify: `docs/superpowers/plans/2026-08-14-mvp-04-app-totem-index.md`

- [ ] **Step 1: Consolidar requisito por requisito**

Liste individualmente todos os 22 requisitos funcionais, 9 regras de negócio, 8 requisitos não funcionais e 11 critérios de aceite, com teste, ambiente, device, versão, evidência e status. Use os IDs completos da matriz do índice, sem intervalos abreviados.

- [ ] **Step 2: Confirmar bloqueadores**

Não feche o MVP se houver token fora do SecureStore, refresh replay renovável, QR sem replay controlado, cálculo de regra no cliente, retorno visual confirmando pagamento, CPF-only, resíduo kiosk A→B, telemetria com PII ou rollback não ensaiado.

- [ ] **Step 3: Executar regressão final**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`
Expected: PASS.

Run: `pnpm test:e2e && pnpm --filter mobile test:e2e && pnpm --filter kiosk test:e2e:hardware`
Expected: PASS.

Run: `pnpm build && pnpm observability:validate`
Expected: PASS.

- [ ] **Step 4: Registrar push transferido quando aplicável**

Se `M4-PUSH-01` foi diferido, marque `M4-FR-014` como transferido para a Slice 5.5, mantenha inbox interna comprovada e não marque push externo como concluído.

- [ ] **Step 5: Atualizar PRD e índice somente com evidência**

Mantenha feature/gate fechado descrito como pendente; piloto limitado não equivale a publicação ampla.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/app-totem/evidence/mvp-04-final-traceability.md docs/prd/academia/MVP-04-app-totem.md docs/superpowers/plans/2026-08-14-mvp-04-app-totem-index.md
git commit -m "docs(channels): close MVP 04 traceability"
```
