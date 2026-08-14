# MVP-04.1 — Identidade e shell mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o aluno ative a própria conta, autentique, renove/revogue sessões e abra um shell mobile útil sem persistir tokens ou dados sensíveis indevidamente.

**Architecture:** O módulo `student-identity` vincula conta e aluno, persiste somente hashes de tokens e aplica rotação por família. O app mantém access token em memória e refresh token no SecureStore, usa Expo Router para rotas protegidas e descarta toda sessão ao detectar revogação/replay. A Home mínima vem de um BFF orientado por portas, sem duplicar decisões upstream.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Zod, Expo/React Native/Expo Router conforme `mobile-platform.json`, Expo SecureStore, Jest, Testing Library e runner mobile homologado.

---

## Pré-condições

- `M4-ENTRY-01`, `M4-IDENTITY-01` e `M4-MOBILE-01` aprovados.
- OpenAPI real dos MVPs 1 a 3 disponível no commit-base.
- Feature flag `STUDENT_MOBILE=false` fora dos tenants piloto.

### Task 1: Persistir contas, tokens e sessões do aluno

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_student_channel_identity/migration.sql`
- Create: `apps/api/src/modules/student-identity/domain/student-session.ts`
- Create: `apps/api/src/modules/student-identity/domain/student-session.spec.ts`
- Create: `apps/api/src/modules/student-identity/domain/one-time-token.ts`
- Create: `apps/api/src/modules/student-identity/domain/one-time-token.spec.ts`

- [ ] **Step 1: Escrever testes dos estados**

```ts
it('rejects a consumed activation token', () => {
  expect(() => consumeOneTimeToken({ status: 'CONSUMED', expiresAt: future })).toThrow('TOKEN_ALREADY_USED');
});

it('revokes the refresh family on replay', () => {
  expect(rotateRefreshFamily(usedRefresh)).toEqual({ outcome: 'REVOKE_FAMILY', reason: 'REFRESH_REPLAY' });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- student-session one-time-token`
Expected: FAIL porque os domínios ainda não existem.

- [ ] **Step 3: Adicionar modelos aditivos**

Crie `StudentAccount`, `StudentSession`, `AccountActivationToken`, `PasswordResetToken` e `MobileDevice`. Token possui `tokenHash`, finalidade, aluno, validade, consumo e emissor; sessão possui canal, família, refresh hash, device, última rotação, revogação e motivo.

```ts
export type StudentSessionStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type SessionRevocationReason = 'LOGOUT' | 'REMOTE_REVOKE' | 'REFRESH_REPLAY' | 'PASSWORD_CHANGED';
```

- [ ] **Step 4: Aplicar migration**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name student_channel_identity`
Expected: migration aplicada sem drift.

- [ ] **Step 5: Implementar estados e executar testes**

Run: `pnpm --filter api test -- student-session one-time-token`
Expected: PASS para expirado, consumido, outro aluno, rotação e replay.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/student-identity/domain
git commit -m "feat(identity): add student accounts and sessions"
```

### Task 2: Implementar ativação, login e recuperação antienumeração

**Files:**
- Create: `apps/api/src/modules/student-identity/application/activate-student-account.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/login-student.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/request-password-reset.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/confirm-password-reset.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/student-auth.use-cases.spec.ts`
- Create: `apps/api/src/modules/student-identity/infrastructure/student-identity.repository.ts`
- Create: `apps/api/src/modules/student-identity/ports/identity-message.port.ts`

- [ ] **Step 1: Escrever testes de abuso**

```ts
it.each(['unknown@example.test', 'known@example.test'])('returns the same reset response for %s', async identifier => {
  await expect(useCase.execute({ identifier })).resolves.toEqual({ accepted: true });
});

it('atomically consumes the activation token once', async () => {
  await expect(runTwiceSameToken()).resolves.toEqual({ activated: 1, rejected: 1 });
});
```

Cubra token interceptado, outro aluno, hash incorreto, senha fora da política, tentativas excedidas e conta desativada.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- student-auth.use-cases.spec.ts`
Expected: FAIL porque os casos de uso não existem.

- [ ] **Step 3: Implementar transações e mensagens**

Ativação valida hash sob transação, vincula conta ao aluno no tenant, define password hash e consome token. Recuperação sempre responde `accepted: true`; o adapter envia somente quando elegível.

```ts
export interface IdentityMessagePort {
  sendActivation(input: { destinationId: string; oneTimeToken: string; expiresAt: string }): Promise<void>;
  sendPasswordReset(input: { destinationId: string; oneTimeToken: string; expiresAt: string }): Promise<void>;
}
```

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- student-auth.use-cases.spec.ts`
Expected: PASS sem diferença observável entre identificador conhecido e desconhecido.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-identity/application apps/api/src/modules/student-identity/infrastructure apps/api/src/modules/student-identity/ports
git commit -m "feat(identity): add secure student activation and recovery"
```

### Task 3: Implementar refresh rotativo, step-up e revogação

**Files:**
- Create: `apps/api/src/modules/student-identity/application/create-student-session.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/refresh-student-session.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/revoke-student-session.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/reauthenticate-student.use-case.ts`
- Create: `apps/api/src/modules/student-identity/application/student-session.use-cases.spec.ts`
- Create: `apps/api/src/modules/student-identity/student-session.guard.ts`
- Create: `apps/api/src/modules/student-identity/student-channel-context.ts`

- [ ] **Step 1: Escrever testes de rotação concorrente**

```ts
it('allows one refresh and revokes the family when the old token is replayed', async () => {
  const first = await refresh(oldToken);
  expect(first.outcome).toBe('ROTATED');
  await expect(refresh(oldToken)).rejects.toMatchObject({ code: 'REFRESH_REPLAY' });
  await expect(refresh(first.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
});
```

Cubra logout idempotente, revogação remota, mudança de senha, device diferente e step-up vencido.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- student-session.use-cases.spec.ts`
Expected: FAIL porque os casos de uso ainda não existem.

- [ ] **Step 3: Implementar sessão e contexto**

```ts
export interface StudentChannelContext {
  tenantId: string;
  studentId: string;
  sessionId: string;
  channel: 'MOBILE' | 'KIOSK';
  deviceId: string;
  reauthenticatedAt: string | null;
}
```

Use hash independente por rotação e transação Serializable. Access token contém IDs opacos e versão da sessão; não contém PII.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- student-session.use-cases.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-identity
git commit -m "feat(identity): rotate and revoke student sessions"
```

### Task 4: Expor API mobile e OpenAPI gerada

**Files:**
- Create: `apps/api/src/modules/student-identity/mobile-auth.controller.ts`
- Create: `apps/api/src/modules/student-identity/mobile-sessions.controller.ts`
- Create: `apps/api/src/modules/student-identity/student-identity.module.ts`
- Create: `apps/api/src/modules/student-identity/dto/mobile-auth.dto.ts`
- Create: `apps/api/src/modules/student-identity/mobile-auth.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-auth.ts`

- [ ] **Step 1: Escrever testes HTTP**

Teste as rotas do PRD mais `/api/v1/mobile/auth/recovery/request`, `/confirm` e `/reauthenticate`. Exija `application/problem+json`, rate limit, resposta constante e `StudentChannelContext` derivado.

```ts
await request(app).post('/api/v1/mobile/auth/login').send(unknownLogin).expect(401).expect(({ body }) => {
  expect(body.code).toBe('AUTHENTICATION_FAILED');
  expect(body).not.toHaveProperty('identifierExists');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-auth.controller.spec.ts`
Expected: FAIL porque controllers e DTOs não existem.

- [ ] **Step 3: Implementar controllers finos**

Controllers validam transporte e delegam aos casos de uso. `StudentIdentityModule` registra controllers/providers e é importado no `AppModule`. `GET /sessions` retorna device, canal, criação, última atividade e sessão atual; `DELETE /sessions/:id` só aceita sessão do próprio aluno.

- [ ] **Step 4: Gerar e validar contrato**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS e `packages/api-contracts/src/mobile-auth.ts` sem edição manual.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter api test -- mobile-auth.controller.spec.ts`
Expected: PASS, inclusive autorização por objeto.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/student-identity apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-auth.ts
git commit -m "feat(api): expose student mobile identity endpoints"
```

### Task 5: Criar shell Expo e armazenamento seguro

**Files:**
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.config.ts`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/metro.config.js`
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/(public)/index.tsx`
- Create: `apps/mobile/app/(protected)/_layout.tsx`
- Create: `apps/mobile/src/auth/secure-session-store.ts`
- Create: `apps/mobile/src/auth/secure-session-store.test.ts`
- Create: `apps/mobile/src/auth/session-provider.tsx`
- Create: `apps/mobile/src/api/mobile-api-client.ts`
- Create: `scripts/mobile/bootstrap-from-manifest.mjs`
- Create: `scripts/mobile/bootstrap-from-manifest.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `turbo.json`

- [ ] **Step 1: Escrever teste do storage**

```ts
it('stores only the refresh token in SecureStore', async () => {
  await store.save({ accessToken: 'access', refreshToken: 'refresh' });
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('arenahub.refresh.v1', 'refresh');
  expect(JSON.stringify(SecureStore.setItemAsync.mock.calls)).not.toContain('access');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- secure-session-store.test.ts`
Expected: FAIL porque o app e o storage ainda não existem.

- [ ] **Step 3: Implementar bootstrap dirigido por manifesto**

O script valida `mobile-platform.json`, cria a lista exata de pacotes/versões e chama pnpm sem usar `latest`. Registre `mobile:bootstrap` no `package.json`. Teste que versão ausente, faixa sem pin e pacote fora da allowlist encerram com erro.

```js
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (Object.values(manifest.packages).some(version => !/^\d+\.\d+\.\d+/.test(version))) throw new Error('MOBILE_VERSION_NOT_PINNED');
```

- [ ] **Step 4: Instalar versões aprovadas pelo manifesto**

Run: `node --test scripts/mobile/bootstrap-from-manifest.test.mjs`
Expected: PASS.

Run: `pnpm mobile:bootstrap --manifest docs/operations/app-totem/mobile-platform.json`
Expected: `apps/mobile/package.json` coincide com todas as versões e checksums do manifesto.

- [ ] **Step 5: Implementar storage e cliente**

```ts
const REFRESH_KEY = 'arenahub.refresh.v1';
export const secureSessionStore = {
  loadRefresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  saveRefresh: (token: string) => SecureStore.setItemAsync(REFRESH_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(REFRESH_KEY),
};
```

O cliente mantém access token somente no provider em memória, faz uma única tentativa de refresh sincronizada e limpa storage em `SESSION_REVOKED` ou `REFRESH_REPLAY`.

- [ ] **Step 6: Executar testes e checks**

Run: `pnpm --filter mobile test && pnpm --filter mobile typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile scripts/mobile package.json pnpm-workspace.yaml turbo.json pnpm-lock.yaml
git commit -m "feat(mobile): bootstrap secure student app shell"
```

### Task 6: Implementar ativação, login, recuperação e sessões no app

**Files:**
- Create: `apps/mobile/app/(public)/activate.tsx`
- Create: `apps/mobile/app/(public)/login.tsx`
- Create: `apps/mobile/app/(public)/recover.tsx`
- Create: `apps/mobile/app/(protected)/profile/sessions.tsx`
- Create: `apps/mobile/src/auth/deep-link-policy.ts`
- Create: `apps/mobile/src/auth/deep-link-policy.test.ts`
- Create: `apps/mobile/src/features/auth/activation-form.tsx`
- Create: `apps/mobile/src/features/auth/login-form.tsx`
- Create: `apps/mobile/src/features/auth/recovery-form.tsx`
- Create: `apps/mobile/src/features/auth/auth-forms.test.tsx`
- Create: `apps/mobile/e2e/auth-flow.e2e.ts`

- [ ] **Step 1: Escrever testes de deep link e formulários**

```ts
expect(parseAuthLink('arenahub://activate?token=x')).toEqual({ kind: 'ACTIVATION', token: 'x' });
expect(() => parseAuthLink('https://evil.test/activate?token=x')).toThrow('DEEP_LINK_NOT_ALLOWED');
```

Cubra leitor de tela, fonte ampliada, submit duplo, mensagem antienumeração e revogação da sessão atual.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- deep-link-policy auth-forms`
Expected: FAIL porque telas e policy ainda não existem.

- [ ] **Step 3: Implementar rotas e acessibilidade**

Use labels, hints, live regions e foco no primeiro erro. Não registre valores de senha/token. Deep link só navega após validação local e confirmação do backend.

- [ ] **Step 4: Executar unitários e E2E**

Run: `pnpm --filter mobile test -- deep-link-policy auth-forms`
Expected: PASS.

Run: `pnpm --filter mobile test:e2e -- auth-flow.e2e.ts`
Expected: PASS para ativação, retorno, refresh, logout e revogação remota nos devices aprovados.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app apps/mobile/src apps/mobile/e2e/auth-flow.e2e.ts
git commit -m "feat(mobile): add student authentication journeys"
```

### Task 7: Entregar Home mínima, version policy e evidências

**Files:**
- Create: `apps/api/src/modules/student-mobile/mobile-home.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-home.service.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-home.service.spec.ts`
- Create: `apps/api/src/modules/student-mobile/student-mobile.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/mobile/app/(protected)/home.tsx`
- Create: `apps/mobile/src/features/home/mobile-home.tsx`
- Create: `apps/mobile/src/features/home/mobile-home.test.tsx`
- Create: `apps/mobile/src/platform/app-state-privacy.ts`
- Create: `apps/mobile/src/platform/app-state-privacy.test.ts`
- Create: `apps/mobile/src/platform/device-risk-signal.ts`
- Create: `apps/mobile/src/platform/device-risk-signal.test.ts`
- Create: `docs/operations/app-totem/evidence/mvp-04-01-mobile-identity-shell.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md`

- [ ] **Step 1: Escrever testes do shell útil**

```ts
expect(renderHome({ status: 'UNAVAILABLE' })).toHaveTextContent('Não foi possível atualizar agora');
expect(renderHome({ status: 'UNAVAILABLE' })).not.toHaveTextContent(previousStudentName);
```

Teste `versionPolicy` compatível, grace e bloqueado; AppState oculta conteúdo no background e refaz autenticação ao voltar. Root/jailbreak gera sinal de risco sanitizado e possível step-up, nunca bloqueio cego.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-home.service.spec.ts`
Expected: FAIL porque o BFF ainda não existe.

Run: `pnpm --filter mobile test -- mobile-home app-state-privacy device-risk-signal`
Expected: FAIL porque Home e privacy guard ainda não existem.

- [ ] **Step 3: Implementar contrato mínimo**

```ts
export interface MobileHomeResponse {
  asOf: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  versionPolicy: { state: 'SUPPORTED' | 'GRACE' | 'BLOCKED'; updateUrl: string | null };
}
```

`StudentMobileModule` registra Home e será ampliado nas slices seguintes. Não inclua dados de negócio nesta etapa. Em falha, mostre shell e suporte sem cache sensível.

- [ ] **Step 4: Executar regressão**

Run: `pnpm --filter api test -- student-identity mobile-home`
Expected: PASS.

Run: `pnpm --filter mobile test && pnpm --filter mobile test:e2e -- auth-flow.e2e.ts`
Expected: PASS.

- [ ] **Step 5: Registrar evidências**

Mapeie `M4-FR-001`–`M4-FR-005`, `M4-NFR-002`, `M4-NFR-006`, `M4-NFR-007`, `M4-NFR-008`, `M4-AC-001` e `M4-AC-002` a testes, devices, versões e resultados sanitizados.

- [ ] **Step 6: Atualizar checkboxes comprovados e commit**

```bash
git add apps/api/src/modules/student-mobile apps/api/src/app.module.ts apps/mobile docs/operations/app-totem/evidence/mvp-04-01-mobile-identity-shell.md docs/prd/academia/MVP-04-app-totem.md
git commit -m "docs(mobile): record identity shell evidence"
```
