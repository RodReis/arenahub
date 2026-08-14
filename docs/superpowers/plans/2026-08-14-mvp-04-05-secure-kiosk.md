# MVP-04.5 — Kiosk seguro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provisionar um totem por tenant/unidade e executar sessões efêmeras de aluno que terminam e limpam todo estado em até dois segundos.

**Architecture:** A identidade persistente pertence ao dispositivo e não contém PII; a sessão do aluno é separada, curta e vinculada ao device. A API garante TTL e autorização, enquanto a PWA adiciona inatividade, perda de foco, limpeza de memória/cache visual e reload. O service worker mantém apenas shell público e nunca intercepta respostas autenticadas.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Next.js 16 App Router, React 19, Web Crypto/browser kiosk conforme manifesto, Vitest, Playwright e hardware homologado.

---

## Pré-condições

- `M4-ENTRY-01`, `M4-IDENTITY-01` e `M4-KIOSK-01` aprovados.
- `apps/kiosk` executa somente no perfil de dispositivo registrado.
- Feature flag `KIOSK=false` fora da unidade piloto.

### Task 1: Persistir dispositivo, sessão e auditoria mínima

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_kiosk_devices_sessions/migration.sql`
- Create: `apps/api/src/modules/kiosk-devices/domain/kiosk-device.ts`
- Create: `apps/api/src/modules/kiosk-devices/domain/kiosk-device.spec.ts`
- Create: `apps/api/src/modules/kiosk-sessions/domain/kiosk-session.ts`
- Create: `apps/api/src/modules/kiosk-sessions/domain/kiosk-session.spec.ts`

- [ ] **Step 1: Escrever testes de estados**

```ts
expect(startSession(revokedDevice)).toEqual({ outcome: 'DENY', reason: 'DEVICE_REVOKED' });
expect(touchSession(expiredSession, clock)).toEqual({ outcome: 'END', reason: 'IDLE_TIMEOUT' });
```

Cubra `PROVISIONING/ACTIVE/REVOKED`, sessão `PENDING_VERIFICATION/ACTIVE/ENDED`, TTL absoluto menor que mobile e motivos explícitos de fim.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- kiosk-device kiosk-session`
Expected: FAIL porque domínios ainda não existem.

- [ ] **Step 3: Adicionar modelos**

Crie `KioskDevice`, `KioskProvisioningToken`, `KioskSession` e `KioskAuditEvent`. Credenciais/tokens ficam como hash; auditoria registra IDs, ação, resultado, motivo e tempo sem CPF, nome, invoice ou valor.

```ts
export type KioskEndReason = 'USER_ACTION' | 'IDLE_TIMEOUT' | 'ABSOLUTE_TIMEOUT' | 'ERROR' | 'FOCUS_LOST' | 'DEVICE_REVOKED' | 'BROWSER_RESTART';
```

- [ ] **Step 4: Aplicar migration e testar**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name kiosk_devices_sessions`
Expected: migration aplicada sem drift.

Run: `pnpm --filter api test -- kiosk-device kiosk-session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/kiosk-devices/domain apps/api/src/modules/kiosk-sessions/domain
git commit -m "feat(kiosk): add devices and ephemeral sessions"
```

### Task 2: Implementar provisionamento e heartbeat do dispositivo

**Files:**
- Create: `apps/api/src/modules/kiosk-devices/application/provision-kiosk.use-case.ts`
- Create: `apps/api/src/modules/kiosk-devices/application/rotate-kiosk-credential.use-case.ts`
- Create: `apps/api/src/modules/kiosk-devices/application/record-kiosk-heartbeat.use-case.ts`
- Create: `apps/api/src/modules/kiosk-devices/application/kiosk-device.use-cases.spec.ts`
- Create: `apps/api/src/modules/kiosk-devices/kiosk-device.controller.ts`
- Create: `apps/api/src/modules/kiosk-devices/kiosk-operations.controller.ts`
- Create: `apps/api/src/modules/kiosk-devices/kiosk-device.guard.ts`
- Create: `apps/api/src/modules/kiosk-devices/kiosk-device.controller.spec.ts`
- Create: `apps/api/src/modules/kiosk-devices/kiosk-devices.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes do token de provisionamento**

```ts
it('consumes one provisioning token and binds tenant/unit', async () => {
  const result = await provision({ token, fingerprint });
  expect(result.device.tenantId).toBe(expectedTenant);
  await expect(provision({ token, fingerprint })).rejects.toMatchObject({ code: 'PROVISIONING_TOKEN_USED' });
});
```

Cubra expirado, outro fingerprint, device revogado, credencial rotacionada e heartbeat sem sessão de aluno.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- kiosk-device.use-cases kiosk-device.controller`
Expected: FAIL porque casos de uso e controller não existem.

- [ ] **Step 3: Implementar cookie de dispositivo**

Emita segredo aleatório uma vez e persista hash. Resposta define cookie `kiosk_device` com `HttpOnly`, `Secure`, `SameSite=Strict`, path `/api/v1/kiosk` e expiração do manifesto; rotação invalida imediatamente o anterior. `KioskDevicesModule` é importado no `AppModule`.

- [ ] **Step 4: Implementar heartbeat**

`POST /api/v1/kiosk/heartbeat` aceita versão, conectividade e capabilities permitidas. Responde estado do device, version policy e comandos não sensíveis; não abre sessão de aluno. `GET /api/v1/operations/kiosks/:id/health` permite ao operador autorizado consultar versão, último heartbeat e conectividade sem criar sessão de aluno ou acessar seu conteúdo.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- kiosk-device.use-cases kiosk-device.controller`
Expected: PASS com atributos de cookie verificados.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/kiosk-devices apps/api/src/app.module.ts
git commit -m "feat(kiosk): provision and monitor kiosk devices"
```

### Task 3: Implementar identificação com segundo fator e TTL

**Files:**
- Create: `apps/api/src/modules/kiosk-sessions/ports/kiosk-second-factor.port.ts`
- Create: `apps/api/src/modules/kiosk-sessions/ports/kiosk-qr-verifier.port.ts`
- Create: `apps/api/src/modules/kiosk-sessions/application/start-kiosk-session.use-case.ts`
- Create: `apps/api/src/modules/kiosk-sessions/application/verify-kiosk-session.use-case.ts`
- Create: `apps/api/src/modules/kiosk-sessions/application/end-kiosk-session.use-case.ts`
- Create: `apps/api/src/modules/kiosk-sessions/application/kiosk-session.use-cases.spec.ts`
- Create: `apps/api/src/modules/kiosk-sessions/kiosk-session.controller.ts`
- Create: `apps/api/src/modules/kiosk-sessions/kiosk-session.guard.ts`
- Create: `apps/api/src/modules/kiosk-sessions/kiosk-student-context.ts`
- Create: `apps/api/src/modules/kiosk-sessions/kiosk-sessions.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes dos métodos**

```ts
it('never activates a session from CPF alone', async () => {
  const result = await start({ method: 'CPF_LOCATOR', value: validCpf });
  expect(result.status).toBe('PENDING_VERIFICATION');
  expect(result.studentId).toBeUndefined();
});
```

Cubra QR aprovado, CPF+segundo fator, resposta genérica para CPF desconhecido, tentativas, sessão/device divergentes, idle/absolute timeout e end idempotente.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- kiosk-session.use-cases.spec.ts`
Expected: FAIL porque portas e casos de uso não existem.

- [ ] **Step 3: Implementar estado pendente e ativo**

```ts
export type KioskVerification =
  | { method: 'ROTATING_QR'; credential: string }
  | { method: 'SECOND_FACTOR'; challengeId: string; code: string };

export interface KioskStudentContext {
  tenantId: string;
  studentId: string;
  sessionId: string;
  channel: 'KIOSK';
  deviceId: string;
  expiresAt: string;
  privacyMode: 'PUBLIC_SCREEN';
}
```

Somente verificação aprovada associa `studentId`. Cookie `kiosk_session` é `HttpOnly`, curto, vinculado ao `kiosk_device` e removido em todo fim.

- [ ] **Step 4: Implementar rotas do PRD**

`POST /session/start`, `/session/verify` e `/session/end` usam device guard. `KioskSessionsModule` é importado no `AppModule`. Respostas nunca revelam se CPF desconhecido existe.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- kiosk-session.use-cases.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/kiosk-sessions apps/api/src/app.module.ts
git commit -m "feat(kiosk): add verified ephemeral sessions"
```

### Task 4: Expor resumo mínimo do aluno no kiosk

**Files:**
- Create: `apps/api/src/modules/kiosk-bff/ports/kiosk-membership.port.ts`
- Create: `apps/api/src/modules/kiosk-bff/ports/kiosk-attendance.port.ts`
- Create: `apps/api/src/modules/kiosk-bff/ports/kiosk-health.port.ts`
- Create: `apps/api/src/modules/kiosk-bff/kiosk-summary.service.ts`
- Create: `apps/api/src/modules/kiosk-bff/kiosk-summary.service.spec.ts`
- Create: `apps/api/src/modules/kiosk-bff/kiosk-summary.controller.ts`
- Create: `apps/api/src/modules/kiosk-bff/kiosk-summary.controller.spec.ts`
- Create: `apps/api/src/modules/kiosk-bff/kiosk-bff.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/kiosk.ts`

- [ ] **Step 1: Escrever testes de minimização**

```ts
expect(await service.getSummary(kioskCtx)).toEqual(expect.objectContaining({ privacyMode: 'PUBLIC_SCREEN' }));
expect(JSON.stringify(await service.getSummary(kioskCtx))).not.toContain(studentCpf);
```

Teste sessão pendente/expirada, device diferente, outro aluno, seções indisponíveis e descrições discretas.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- kiosk-summary`
Expected: FAIL porque BFF não existe.

- [ ] **Step 3: Implementar `GET /api/v1/kiosk/session/summary`**

```ts
export interface KioskSummaryResponse {
  expiresAt: string;
  privacyMode: 'PUBLIC_SCREEN';
  membership: { status: string; description: string; asOf: string };
  attendance: { count: number | null; period: string; asOf: string };
  assessment: { assessedAt: string; summary: string } | null;
}
```

Use portas upstream e nenhum acesso direto a tabelas. `KioskBffModule` é importado no `AppModule`.

- [ ] **Step 4: Gerar OpenAPI e testar**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS.

Run: `pnpm --filter api test -- kiosk-summary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk-bff apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/kiosk.ts
git commit -m "feat(kiosk): expose minimal student summary"
```

### Task 5: Criar PWA kiosk sem cache autenticado

**Files:**
- Create: `apps/kiosk/package.json`
- Create: `apps/kiosk/next.config.ts`
- Create: `apps/kiosk/tsconfig.json`
- Create: `apps/kiosk/app/layout.tsx`
- Create: `apps/kiosk/app/page.tsx`
- Create: `apps/kiosk/app/offline/page.tsx`
- Create: `apps/kiosk/app/manifest.ts`
- Create: `apps/kiosk/public/sw.js`
- Create: `apps/kiosk/src/platform/service-worker-policy.ts`
- Create: `apps/kiosk/src/platform/service-worker-policy.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `turbo.json`

- [ ] **Step 1: Escrever testes do service worker**

```ts
expect(shouldCache(new Request('/api/v1/kiosk/session/summary'))).toBe(false);
expect(shouldCache(new Request('/offline'))).toBe(true);
expect(shouldCache(new Request('/session'))).toBe(false);
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter kiosk test -- service-worker-policy.test.ts`
Expected: FAIL porque app e policy não existem.

- [ ] **Step 3: Criar app e headers**

`next.config.ts` adiciona `Cache-Control: no-store, private` a `/session/:path*` e headers CSP/frame/permissions do manifesto. Server Components são padrão; interatividade fica no session controller cliente.

- [ ] **Step 4: Implementar service worker público**

O worker usa cache versionado apenas para `/offline` e assets públicos listados no build. Requests `/api`, `/session`, com `Authorization` ou cookies de sessão passam direto à rede e nunca entram no cache.

- [ ] **Step 5: Executar checks**

Run: `pnpm --filter kiosk test && pnpm --filter kiosk typecheck && pnpm --filter kiosk build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk pnpm-workspace.yaml turbo.json pnpm-lock.yaml
git commit -m "feat(kiosk): bootstrap no-store kiosk pwa"
```

### Task 6: Construir identificação, sessão e limpeza visual

**Files:**
- Create: `apps/kiosk/app/session/page.tsx`
- Create: `apps/kiosk/src/features/session/kiosk-session-controller.client.tsx`
- Create: `apps/kiosk/src/features/session/kiosk-session-machine.ts`
- Create: `apps/kiosk/src/features/session/kiosk-session-machine.test.ts`
- Create: `apps/kiosk/src/features/session/student-identification.client.tsx`
- Create: `apps/kiosk/src/features/session/student-summary.tsx`
- Create: `apps/kiosk/src/platform/kiosk-cleanup.ts`
- Create: `apps/kiosk/src/platform/kiosk-cleanup.test.ts`

- [ ] **Step 1: Escrever testes da máquina e cleanup**

```ts
expect(reduce(active, { type: 'VISIBILITY_HIDDEN' })).toEqual(expect.objectContaining({ state: 'ENDING', reason: 'FOCUS_LOST' }));
await cleanup();
expect(sessionStorage.length).toBe(0);
expect(localStorage.length).toBe(0);
expect(await caches.keys()).toEqual(['kiosk-public-shell-v1']);
```

Teste timeout, erro, perda de rede, browser restart, back/forward, CPF sem fator e QR inválido.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter kiosk test -- kiosk-session-machine kiosk-cleanup`
Expected: FAIL porque máquina e cleanup não existem.

- [ ] **Step 3: Implementar sessão em memória**

Nenhum payload do aluno entra em storage. Timers usam deadline do backend; `visibilitychange`, erro não recuperável e timeout chamam `/session/end`, encerram tracks de câmera, limpam canvas/object URLs/DOM/clipboard/cache visual e executam `location.replace('/')`. Impressão permanece desabilitada, salvo capability homologada cujo cleanup também prove spool vazio.

- [ ] **Step 4: Implementar acessibilidade kiosk**

Inclua alto contraste, foco visível, teclado/touch, leitor de tela, alvo de toque, contador anunciado e ação “Preciso de mais tempo” limitada pelo TTL absoluto do backend.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter kiosk test -- kiosk-session-machine kiosk-cleanup`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/app apps/kiosk/src
git commit -m "feat(kiosk): add verified self-service session"
```

### Task 7: Executar bateria A→B, health e evidências

**Files:**
- Create: `apps/kiosk/e2e/kiosk-session-isolation.spec.ts`
- Create: `apps/kiosk/e2e/kiosk-accessibility.spec.ts`
- Create: `apps/api/test/security/kiosk-authorization.e2e-spec.ts`
- Create: `docs/operations/app-totem/runbooks/kiosk-provision.md`
- Create: `docs/operations/app-totem/runbooks/kiosk-restore.md`
- Create: `docs/operations/app-totem/runbooks/kiosk-device-revoke.md`
- Create: `docs/operations/app-totem/evidence/mvp-04-05-secure-kiosk.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md`

- [ ] **Step 1: Executar autorização API**

Run: `pnpm --filter api test:e2e -- kiosk-authorization`
Expected: PASS para device/sessão/tenant/aluno divergentes, CPF sem fator e sessão expirada.

- [ ] **Step 2: Executar bateria A→B automatizada**

Run: `pnpm --filter kiosk test:e2e -- kiosk-session-isolation.spec.ts`
Expected: PASS com zero resíduo em DOM, history, storage, cache, autofill, print e screenshot após até 2 s.

- [ ] **Step 3: Executar hardware e acessibilidade**

Run: `pnpm --filter kiosk test:e2e:hardware -- kiosk-accessibility.spec.ts`
Expected: PASS no totem inventariado, inclusive rede perdida e reinício.

- [ ] **Step 4: Ensaiar runbooks**

Outro operador provisiona, restaura e revoga um device usando somente os runbooks. Expected: health retorna sem sessão de aluno e device revogado não reinicia sessão.

- [ ] **Step 5: Registrar evidências**

Mapeie `M4-FR-015`–`M4-FR-020`, `M4-FR-022`, `M4-BR-004`–`M4-BR-007`, `M4-NFR-004`, `M4-NFR-006`, `M4-NFR-007`, `M4-NFR-008`, `M4-AC-007`, `M4-AC-008` e `M4-AC-010`.

- [ ] **Step 6: Atualizar checkboxes comprovados e commit**

```bash
git add apps/kiosk/e2e apps/api/test/security/kiosk-authorization.e2e-spec.ts docs/operations/app-totem/runbooks docs/operations/app-totem/evidence/mvp-04-05-secure-kiosk.md docs/prd/academia/MVP-04-app-totem.md
git commit -m "docs(kiosk): record secure kiosk evidence"
```
