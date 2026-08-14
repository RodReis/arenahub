# MVP-04.2 — Carteirinha, plano e frequência Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir situação, carteirinha e frequência próprias e emitir QR curto consumível sem transferir decisões de acesso para o aplicativo.

**Architecture:** O BFF mobile compõe projeções públicas de membership e attendance por portas. O QR é emitido pelo módulo `student-credentials`, assinado conforme manifesto e consumido atomicamente pela integração de acesso; o app apenas renderiza o payload e sua expiração. Dados possuem `asOf` e estados parciais explícitos.

**Tech Stack:** NestJS, Prisma/PostgreSQL, crypto nativo, Expo/React Native, SVG/QR adapter aprovado, Jest, Testing Library, runner mobile e testes de carga.

---

## Pré-condições

- Slice 4.1 concluída.
- Membership e attendance públicos no OpenAPI de `M4-ENTRY-01`.
- QR real exige `M4-QR-01`; sem ele a capability retorna `DISABLED`.

### Task 1: Definir portas e projeção da Home do aluno

**Files:**
- Create: `apps/api/src/modules/student-mobile/ports/student-membership.port.ts`
- Create: `apps/api/src/modules/student-mobile/ports/student-attendance.port.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/membership.adapter.ts`
- Create: `apps/api/src/modules/student-mobile/infrastructure/attendance.adapter.ts`
- Modify: `apps/api/src/modules/student-mobile/mobile-home.service.ts`
- Modify: `apps/api/src/modules/student-mobile/mobile-home.service.spec.ts`

- [ ] **Step 1: Escrever testes de composição**

```ts
it('renders upstream decisions without recalculation', async () => {
  membership.getSummary.mockResolvedValue({ status: 'PAST_DUE', validUntil: null, asOf });
  expect((await service.getHome(ctx)).membership.status).toBe('PAST_DUE');
});
```

Teste timeout independente, seção indisponível, `asOf`, tenant/aluno do contexto e ausência de cálculo local.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-home.service.spec.ts`
Expected: FAIL porque portas e adapters não existem.

- [ ] **Step 3: Implementar portas estreitas**

```ts
export interface StudentMembershipPort {
  getSummary(ctx: StudentChannelContext): Promise<{ status: string; validUntil: string | null; asOf: string }>;
}
```

Adapters chamam application services públicos; não importam Prisma client dos módulos upstream.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter api test -- mobile-home.service.spec.ts`
Expected: PASS com degradação por seção.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-mobile
git commit -m "feat(mobile): compose membership and attendance home"
```

### Task 2: Implementar domínio e persistência do QR rotativo

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_rotating_qr_tokens/migration.sql`
- Create: `apps/api/src/modules/student-credentials/domain/rotating-qr.ts`
- Create: `apps/api/src/modules/student-credentials/domain/rotating-qr.spec.ts`
- Create: `apps/api/src/modules/student-credentials/application/issue-rotating-qr.use-case.ts`
- Create: `apps/api/src/modules/student-credentials/application/consume-rotating-qr.use-case.ts`
- Create: `apps/api/src/modules/student-credentials/application/rotating-qr.use-cases.spec.ts`

- [ ] **Step 1: Escrever vetores golden**

```ts
it.each(['EXPIRED', 'SIGNATURE_INVALID', 'KEY_UNKNOWN', 'ALREADY_CONSUMED', 'WRONG_TENANT'])('rejects %s', reason => {
  expect(validateQr(fixture(reason), manifest)).toEqual({ outcome: 'DENY', reason });
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- rotating-qr`
Expected: FAIL porque domínio e casos de uso não existem.

- [ ] **Step 3: Adicionar modelo e contrato**

`RotatingQrToken` guarda `tenantId`, `studentId`, `jtiHash`, `keyId`, `purpose`, `expiresAt`, `consumedAt` e `consumedBy`. Payload serializado não contém esses IDs de domínio, apenas `v`, `kid`, `jti`, `exp` e assinatura.

```ts
export type QrValidationResult =
  | { outcome: 'ALLOW'; credentialId: string }
  | { outcome: 'DENY'; reason: 'EXPIRED' | 'SIGNATURE_INVALID' | 'KEY_UNKNOWN' | 'ALREADY_CONSUMED' | 'WRONG_TENANT' };
```

- [ ] **Step 4: Implementar consumo atômico**

Use update condicional `consumedAt IS NULL AND expiresAt > now`; apenas uma concorrência recebe `ALLOW`. Emissão falha com `QR_CAPABILITY_DISABLED` se tenant/unidade não estiver homologado.

- [ ] **Step 5: Aplicar migration e testar**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name rotating_qr_tokens`
Expected: migration aplicada sem drift.

Run: `pnpm --filter api test -- rotating-qr`
Expected: PASS, inclusive 20 consumos concorrentes com um único sucesso.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/student-credentials
git commit -m "feat(access): add consumable rotating qr credentials"
```

### Task 3: Expor carteirinha, QR e frequência mobile

**Files:**
- Create: `apps/api/src/modules/student-mobile/mobile-membership-card.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-attendance.controller.ts`
- Create: `apps/api/src/modules/student-mobile/mobile-channel.controller.spec.ts`
- Create: `apps/api/src/modules/student-mobile/dto/mobile-membership.dto.ts`
- Create: `apps/api/src/modules/student-credentials/student-credentials.module.ts`
- Modify: `apps/api/src/modules/student-mobile/student-mobile.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/openapi/openapi.yaml`
- Create: `packages/api-contracts/src/mobile-membership.ts`

- [ ] **Step 1: Escrever testes HTTP por recurso**

```ts
await request(app).get('/api/v1/mobile/membership-card').set(studentAAuth).expect(200).expect(({ body }) => {
  expect(body.studentId).toBeUndefined();
  expect(body.tenantId).toBeUndefined();
});
```

Cubra sessão de outro aluno, revogada, períodos inválidos, QR desabilitado, expirado e rate limit de emissão.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter api test -- mobile-channel.controller.spec.ts`
Expected: FAIL porque as rotas não existem.

- [ ] **Step 3: Implementar rotas do PRD**

`GET /membership-card`, `POST /membership-card/qr` e `GET /attendance` usam somente o aluno do contexto. `StudentCredentialsModule` encapsula emissão/consumo e `StudentMobileModule` expõe os controllers; ambos são importados no `AppModule`. Respostas carregam `asOf`, `status`, validade e capability de QR.

- [ ] **Step 4: Gerar contrato e testar**

Run: `pnpm openapi:generate && pnpm openapi:check`
Expected: PASS.

Run: `pnpm --filter api test -- mobile-channel.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/student-mobile apps/api/src/modules/student-credentials apps/api/src/app.module.ts packages/contracts/openapi/openapi.yaml packages/api-contracts/src/mobile-membership.ts
git commit -m "feat(api): expose mobile card and attendance"
```

### Task 4: Construir Home, situação e carteirinha acessíveis

**Files:**
- Modify: `apps/mobile/app/(protected)/home.tsx`
- Create: `apps/mobile/app/(protected)/card.tsx`
- Create: `apps/mobile/src/features/membership/membership-summary.tsx`
- Create: `apps/mobile/src/features/membership/membership-card.tsx`
- Create: `apps/mobile/src/features/membership/rotating-qr.tsx`
- Create: `apps/mobile/src/features/membership/membership.test.tsx`

- [ ] **Step 1: Escrever testes de apresentação**

```ts
expect(renderCard({ qr: { status: 'DISABLED' } })).toHaveTextContent('QR indisponível nesta unidade');
expect(renderCard({ membership: { status: 'PAST_DUE' } })).toHaveTextContent(apiDescription);
```

Teste fonte ampliada, leitor de tela, QR com contagem regressiva textual, blur em background e ausência de inferência financeira.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- membership.test.tsx`
Expected: FAIL porque os componentes não existem.

- [ ] **Step 3: Implementar componentes**

QR é reemitido pelo backend ao expirar; o cliente nunca prolonga `expiresAt`. Ao perder foco, remova o SVG imediatamente e exija novo fetch ao voltar.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter mobile test -- membership.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(protected\) apps/mobile/src/features/membership
git commit -m "feat(mobile): add accessible membership card"
```

### Task 5: Construir frequência por períodos e estados de qualidade

**Files:**
- Create: `apps/mobile/app/(protected)/attendance.tsx`
- Create: `apps/mobile/src/features/attendance/attendance-summary.tsx`
- Create: `apps/mobile/src/features/attendance/attendance-list.tsx`
- Create: `apps/mobile/src/features/attendance/attendance.test.tsx`
- Create: `apps/mobile/e2e/card-attendance.e2e.ts`

- [ ] **Step 1: Escrever testes de ausência e qualidade**

```ts
expect(renderAttendance({ sessions: [], dataQuality: 'COMPLETE' })).toHaveTextContent('Nenhuma frequência no período');
expect(renderAttendance({ sessions: [], dataQuality: 'SOURCE_GAP' })).toHaveTextContent('Dados de acesso incompletos');
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter mobile test -- attendance.test.tsx`
Expected: FAIL porque a jornada não existe.

- [ ] **Step 3: Implementar períodos e lista**

Use períodos aceitos pelo backend, datas no timezone da unidade, paginação por cursor e refresh explícito. Não derive duração nem consistência no cliente.

- [ ] **Step 4: Executar unitários e E2E**

Run: `pnpm --filter mobile test -- attendance.test.tsx`
Expected: PASS.

Run: `pnpm --filter mobile test:e2e -- card-attendance.e2e.ts`
Expected: PASS para situação, QR válido/expirado e frequência própria.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(protected\)/attendance.tsx apps/mobile/src/features/attendance apps/mobile/e2e/card-attendance.e2e.ts
git commit -m "feat(mobile): add attendance history"
```

### Task 6: Validar pico, autorização e fechar evidências

**Files:**
- Create: `tests/performance/mobile-home.js`
- Create: `tests/performance/rotating-qr.js`
- Create: `apps/api/test/security/mobile-channel-authorization.e2e-spec.ts`
- Create: `docs/operations/app-totem/evidence/mvp-04-02-card-membership-attendance.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md`

- [ ] **Step 1: Testar autorização e replay**

Run: `pnpm --filter api test:e2e -- mobile-channel-authorization`
Expected: PASS para outro aluno, tenant, sessão revogada, QR adulterado/consumido e capability fechada.

- [ ] **Step 2: Executar carga**

Run: `pnpm exec k6 run tests/performance/mobile-home.js && pnpm exec k6 run tests/performance/rotating-qr.js`
Expected: Home p95 abaixo de 2,5 s e QR dentro do SLO aprovado em `qr-credential.json`.

- [ ] **Step 3: Executar regressão mobile**

Run: `pnpm --filter mobile test && pnpm --filter mobile test:e2e -- card-attendance.e2e.ts`
Expected: PASS nos devices de referência.

- [ ] **Step 4: Registrar evidências**

Mapeie `M4-FR-006`–`M4-FR-008`, `M4-BR-002`, `M4-BR-003`, `M4-BR-008`, `M4-NFR-001`, `M4-NFR-002`, `M4-NFR-005`, `M4-NFR-006`, `M4-NFR-007`, `M4-AC-003` e `M4-AC-004`.

- [ ] **Step 5: Atualizar checkboxes comprovados e commit**

```bash
git add tests/performance apps/api/test/security/mobile-channel-authorization.e2e-spec.ts docs/operations/app-totem/evidence/mvp-04-02-card-membership-attendance.md docs/prd/academia/MVP-04-app-totem.md
git commit -m "docs(mobile): record card and attendance evidence"
```
