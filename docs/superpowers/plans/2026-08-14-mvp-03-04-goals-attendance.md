# MVP-03.4 — Metas, medições e frequência Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute this plan task-by-task.

**Goal:** Relacionar metas e medições de saúde ao histórico de frequência confirmado, sem inferir presença, duração de treino ou causalidade clínica.

**Architecture:** Metas referenciam uma medição basal imutável e seguem a direção configurada pelo protocolo. Sessões de frequência são projeções reconstruíveis sobre passagens confirmadas do MVP-01, preservando os eventos brutos e a versão da política de agrupamento. Uma timeline de leitura combina avaliações, medições, metas e sessões sem misturar seus modelos de escrita.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, BullMQ, Next.js App Router, React, Jest (API/workers), Vitest (pacotes/UI), Playwright.

---

## Pré-condições

- Concluir `2026-08-14-mvp-03-01-manual-assessments.md` e `2026-08-14-mvp-03-02-history-comparisons.md`.
- Consumir apenas o contrato estável de passagem confirmada entregue pelo MVP-01.
- Não inferir frequência quando a fonte de acesso estiver degradada ou incompleta.

### Task 1: Modelar metas mensuráveis e auditáveis

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_health_goals/migration.sql`
- Create: `packages/health-domain/src/goals.ts`
- Create: `packages/health-domain/src/goals.test.ts`
- Modify: `packages/health-domain/src/index.ts`

- [ ] **Step 1: Escrever testes de criação e progresso**

Exija código de métrica, medição basal publicada, valor-alvo, unidade canônica, direção do protocolo, prazo, responsável e status. Calcule progresso com `FixedDecimal`; retorne `null` quando base, atual ou direção não permitirem cálculo seguro.

- [ ] **Step 2: Escrever testes de invariantes**

Bloqueie baseline de outro aluno/tenant, unidade incompatível, prazo anterior à criação, alteração da baseline e mais de uma meta ativa para o mesmo código quando o protocolo proibir.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/health-domain test -- goals.test.ts`
Expected: FAIL porque o domínio ainda não existe.

- [ ] **Step 4: Implementar domínio e persistência**

Adicione `HealthGoal` e `HealthGoalRevision`; metas publicadas são revisadas por nova versão, nunca sobrescritas. Não associe rótulos como saudável, inadequado ou risco.

- [ ] **Step 5: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name health_goals`
Expected: migration aplicada sem drift.

Run: `pnpm --filter @arenahub/health-domain test -- goals.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/health-domain packages/database/prisma
git commit -m "feat(health): add measurable health goals"
```

### Task 2: Criar API e interface de metas

**Files:**
- Create: `apps/api/src/modules/health-goals/health-goals.service.ts`
- Create: `apps/api/src/modules/health-goals/health-goals.service.spec.ts`
- Create: `apps/api/src/modules/health-goals/health-goals.controller.ts`
- Create: `apps/api/src/modules/health-goals/dto/create-health-goal.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/admin-web/components/health/goals/health-goal-form.client.tsx`
- Create: `apps/admin-web/components/health/goals/health-goal-progress.tsx`
- Create: `apps/admin-web/components/health/goals/health-goals.test.tsx`

- [ ] **Step 1: Escrever testes de autorização e consistência**

Somente profissional vinculado e autorizado cria ou revisa; aluno consulta as próprias metas. O backend deriva baseline e unidade do registro publicado, não confia nesses valores enviados pelo cliente.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-goals.service.spec.ts`
Expected: FAIL porque serviço e controller não existem.

- [ ] **Step 3: Implementar API**

Crie rotas sob `/v1/health/students/:studentId/goals`, passe `HealthAccessContext`, use decimal string e registre criação, revisão, conclusão e cancelamento em auditoria.

- [ ] **Step 4: Implementar formulário dirigido pelo protocolo**

Liste apenas métricas elegíveis, mostre unidade e baseline fixas e exiba progresso descritivo. Use texto além de barra/cor para comunicar estado.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/api test -- health-goals.service.spec.ts`
Expected: PASS.

Run: `pnpm --filter admin-web test -- health-goals.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/health-goals apps/api/src/app.module.ts apps/admin-web/components/health/goals
git commit -m "feat(health): manage protocol-driven goals"
```

### Task 3: Projetar sessões a partir de passagens confirmadas

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_attendance_sessions/migration.sql`
- Create: `apps/api/src/workers/health-attendance/attendance-session.projector.ts`
- Create: `apps/api/src/workers/health-attendance/attendance-session.projector.spec.ts`
- Create: `apps/api/src/workers/health-attendance/attendance-policy.ts`
- Create: `apps/api/src/workers/health-attendance/attendance-policy.spec.ts`

- [ ] **Step 1: Escrever testes de elegibilidade**

Aceite somente passagem confirmada e vinculada ao aluno. Ignore tentativa negada, evento incompleto, credencial de terceiro, ambiente degradado sem confirmação e duplicata do mesmo evento.

- [ ] **Step 2: Escrever testes de agrupamento**

Agrupe múltiplas passagens na janela aprovada do manifesto, mantendo todos os IDs brutos e `policyVersion`. Não calcule tempo de permanência nem apague eventos do MVP-01.

- [ ] **Step 3: Escrever testes de rebuild**

Projete por high-water mark, aceite replay fora de ordem e reconstrua o mesmo resultado com idempotência. Alteração de política cria nova versão da projeção.

- [ ] **Step 4: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-attendance`
Expected: FAIL porque projector e política ainda não existem.

- [ ] **Step 5: Implementar `AttendanceSessionProjection`**

Persista tenant, aluno, primeiro/último evento confirmado, contagem, IDs brutos, fonte, confiabilidade e versão da política. Marque gaps conhecidos para que agregados não simulem completude.

- [ ] **Step 6: Aplicar migration e executar testes**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name attendance_sessions`
Expected: migration aplicada sem drift.

Run: `pnpm --filter @arenahub/api test -- health-attendance`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma apps/api/src/workers/health-attendance
git commit -m "feat(health): project confirmed attendance sessions"
```

### Task 4: Calcular agregados de frequência sem falsa precisão

**Files:**
- Create: `packages/health-domain/src/attendance.ts`
- Create: `packages/health-domain/src/attendance.test.ts`
- Modify: `packages/health-domain/src/index.ts`
- Create: `apps/api/src/modules/attendance/health-attendance.service.ts`
- Create: `apps/api/src/modules/attendance/health-attendance.service.spec.ts`
- Create: `apps/api/src/modules/attendance/health-attendance.controller.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes dos períodos**

Cubra semanal, mensal e anual no fuso IANA do tenant, fronteiras de horário de verão, período sem sessões e período com gap de origem. Retorne contagem e `dataQuality`; não retorne duração.

- [ ] **Step 2: Escrever testes de consistência**

Defina consistência como proporção de semanas elegíveis com ao menos uma sessão, identificando semanas sem fonte confiável. Não conclua aderência, disciplina ou efeito sobre saúde.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/health-domain test -- attendance.test.ts`
Expected: FAIL porque os agregados ainda não existem.

- [ ] **Step 4: Implementar domínio e API**

Crie `GET /v1/health/students/:studentId/attendance`, sempre autorizando com `HealthAccessContext` e retornando a versão da política que formou os números.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/health-domain test -- attendance.test.ts`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- health-attendance.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/health-domain apps/api/src/modules/attendance apps/api/src/app.module.ts
git commit -m "feat(health): expose reliable attendance aggregates"
```

### Task 5: Registrar medições adicionais com proveniência

**Files:**
- Create: `apps/api/src/modules/assessments/additional-measurements/additional-measurements.service.ts`
- Create: `apps/api/src/modules/assessments/additional-measurements/additional-measurements.service.spec.ts`
- Create: `apps/api/src/modules/assessments/additional-measurements/additional-measurements.controller.ts`
- Create: `apps/admin-web/components/health/measurements/additional-measurement-form.client.tsx`
- Create: `apps/admin-web/components/health/measurements/additional-measurement-form.test.tsx`

- [ ] **Step 1: Escrever testes de origem e protocolo**

Exija origem `MANUAL`, `IMPORT` ou `DEVICE`, identificador externo idempotente quando aplicável, timestamp, unidade original e protocolo. Bloqueie origem equipamento se o adapter não estiver aprovado em `import-capabilities.md`.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- additional-measurements.service.spec.ts`
Expected: FAIL porque o serviço ainda não existe.

- [ ] **Step 3: Implementar API e formulário**

O fluxo manual valida e normaliza com `FixedDecimal`. Importação e equipamento entram pelos adapters, nunca por payload que apenas declara uma origem privilegiada.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter @arenahub/api test -- additional-measurements.service.spec.ts`
Expected: PASS.

Run: `pnpm --filter admin-web test -- additional-measurement-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/assessments/additional-measurements apps/admin-web/components/health/measurements
git commit -m "feat(health): add provenance-aware measurements"
```

### Task 6: Unificar a timeline de saúde e frequência

**Files:**
- Create: `apps/api/src/modules/health-progress/timeline/health-timeline.service.ts`
- Create: `apps/api/src/modules/health-progress/timeline/health-timeline.service.spec.ts`
- Create: `apps/api/src/modules/health-progress/timeline/health-timeline.controller.ts`
- Create: `apps/admin-web/components/health/timeline/health-timeline.tsx`
- Create: `apps/admin-web/components/health/timeline/health-timeline.test.tsx`
- Create: `apps/admin-web/tests/e2e/health-goals-attendance.spec.ts`

- [ ] **Step 1: Escrever testes da timeline**

Combine avaliação publicada, medição adicional, revisão de meta e sessão de frequência por instante e cursor estável. Preserve tipo, origem e qualidade; não faça join que duplique eventos.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-timeline.service.spec.ts`
Expected: FAIL porque o serviço ainda não existe.

- [ ] **Step 3: Implementar endpoint paginado**

Crie `GET /v1/health/students/:studentId/timeline` com cursor opaco, filtros de tipo e limite máximo. A política de acesso é aplicada antes de cada projeção.

- [ ] **Step 4: Implementar timeline acessível**

Mostre rótulos claros de avaliação, meta, medição e frequência, com proveniência e avisos de qualidade. Não sugira relação causal entre proximidade temporal e resultado corporal.

- [ ] **Step 5: Executar testes e E2E**

Run: `pnpm --filter @arenahub/api test -- health-timeline.service.spec.ts`
Expected: PASS.

Run: `pnpm --filter admin-web test -- health-timeline.test.tsx`
Expected: PASS.

Run: `pnpm --filter admin-web e2e -- health-goals-attendance.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/health-progress/timeline apps/admin-web/components/health/timeline apps/admin-web/tests/e2e/health-goals-attendance.spec.ts
git commit -m "feat(health): unify goals and attendance timeline"
```

### Task 7: Fechar evidências da slice

**Files:**
- Create: `docs/operations/health/evidence/mvp-03-04-goals-attendance.md`
- Modify: `docs/prd/academia/MVP-03-health-intelligence.md`

- [ ] **Step 1: Executar regressão**

Run: `pnpm --filter @arenahub/health-domain test && pnpm --filter @arenahub/api test -- health-attendance`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test:integration -- health-goals-attendance`
Expected: PASS, incluindo isolamento e replay.

Run: `pnpm --filter admin-web e2e -- health-goals-attendance.spec.ts`
Expected: PASS.

- [ ] **Step 2: Registrar evidências**

Documente `M3-FR-012`, `M3-FR-013`, `M3-FR-014`, `M3-BR-007`, `M3-BR-008`, `M3-NFR-001`, `M3-NFR-002`, `M3-NFR-006`, `M3-AC-006` e limitações de qualidade da fonte de acesso.

- [ ] **Step 3: Atualizar somente checkboxes comprovados e commit**

```bash
git add docs/operations/health/evidence/mvp-03-04-goals-attendance.md docs/prd/academia/MVP-03-health-intelligence.md
git commit -m "docs(health): record goals and attendance evidence"
```
