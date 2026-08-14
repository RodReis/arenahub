# MVP-03.2 — Histórico e comparações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute this plan task-by-task.

**Goal:** Entregar histórico corporal longitudinal, comparações determinísticas e exportação dos próprios dados sem transformar ausência de medição em zero nem introduzir interpretação clínica.

**Architecture:** Um serviço de domínio calcula séries e variações com `FixedDecimal`, enquanto projeções de leitura indexadas mantêm consultas rápidas. A aplicação web renderiza dados no servidor e isola filtros e gráficos SVG acessíveis em pequenos componentes cliente. Exportações são assíncronas, privadas e reproduzíveis a partir de um snapshot.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, Next.js App Router, React, Jest (API), Vitest (pacotes/UI), Playwright, S3-compatible object storage.

---

## Pré-condições

- Concluir `2026-08-14-mvp-03-01-manual-assessments.md`.
- Manter `M3-ENTRY-01` e `M3-CLINICAL-01` aprovados.
- Não usar faixas clínicas nem gerar diagnóstico, prescrição ou classificação de risco.

### Task 1: Implementar o domínio determinístico de comparação

**Files:**
- Create: `packages/health-domain/src/comparisons.ts`
- Create: `packages/health-domain/src/comparisons.test.ts`
- Modify: `packages/health-domain/src/index.ts`

- [ ] **Step 1: Escrever testes para seleção dos pontos de referência**

Cubra primeiro, anterior, atual e meta ativa; medições corrigidas devem substituir apenas a folha corrigida, preservando a cadeia de auditoria.

- [ ] **Step 2: Executar o teste e confirmar falha**

Run: `pnpm --filter @arenahub/health-domain test -- comparisons.test.ts`
Expected: FAIL porque `buildMeasurementComparison` ainda não existe.

- [ ] **Step 3: Escrever testes para ausência, zero e unidades**

Exija `null` com `reason: "MISSING_BASELINE"` quando faltar base e `null` com `reason: "BASELINE_ZERO"` quando a variação percentual dividiria por zero. Exija rejeição de códigos ou unidades canônicas incompatíveis.

- [ ] **Step 4: Implementar o contrato mínimo**

Use `FixedDecimal` para variação absoluta e percentual. Mantenha arredondamento de apresentação fora do domínio e retorne IDs das avaliações e medições que sustentam cada valor.

- [ ] **Step 5: Executar os testes focados**

Run: `pnpm --filter @arenahub/health-domain test -- comparisons.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/health-domain/src/comparisons.ts packages/health-domain/src/comparisons.test.ts packages/health-domain/src/index.ts
git commit -m "feat(health): add deterministic measurement comparisons"
```

### Task 2: Criar a projeção longitudinal e os índices de leitura

**Files:**
- Create: `apps/api/src/modules/health-progress/assessment-history.repository.ts`
- Create: `apps/api/src/modules/health-progress/assessment-history.repository.spec.ts`
- Create: `apps/api/src/modules/health-progress/assessment-history.service.ts`
- Create: `apps/api/src/modules/health-progress/assessment-history.service.spec.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_health_history_indexes/migration.sql`

- [ ] **Step 1: Escrever testes de isolamento e ordenação**

Exija escopo por `tenantId` e `studentId`, ordem por `assessedAt` e desempate por ID, exclusão de rascunhos e resolução da revisão publicada mais recente.

- [ ] **Step 2: Escrever testes dos períodos suportados**

Cubra `30D`, `90D`, `6M`, `1Y` e `ALL`. Converta a meia-noite do fuso IANA do tenant para UTC antes da consulta e injete `Clock`; não use o relógio global nos testes.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- assessment-history`
Expected: FAIL por ausência do repositório e do serviço.

- [ ] **Step 4: Implementar consulta e índices**

Adicione índices para `(tenantId, studentId, assessedAt)` e `(assessmentId, measurementCode)`. Leia apenas avaliações publicadas e retorne pontos com valor original, unidade original, valor canônico, unidade canônica e proveniência.

- [ ] **Step 5: Gerar e aplicar a migration no banco de teste**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name health_history_indexes`
Expected: migration aplicada sem drift.

- [ ] **Step 6: Executar testes de integração**

Run: `pnpm --filter @arenahub/api test:integration -- assessment-history`
Expected: PASS, inclusive tentativa de leitura entre tenants retornando nenhum dado.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/health-progress packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260814_health_history_indexes/migration.sql
git commit -m "feat(health): add longitudinal assessment history"
```

### Task 3: Expor a API de histórico e comparação

**Files:**
- Create: `apps/api/src/modules/health-progress/assessment-history.controller.ts`
- Create: `apps/api/src/modules/health-progress/dto/get-assessment-history.query.ts`
- Create: `apps/api/src/modules/health-progress/assessment-history.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes HTTP do contrato**

Cubra profissional vinculado, aluno lendo a própria conta, vínculo ausente, consentimento revogado, período inválido e resposta com primeiro, anterior, atual e meta quando existente.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- assessment-history.controller.spec.ts`
Expected: FAIL porque a rota ainda não existe.

- [ ] **Step 3: Implementar `GET /v1/health/students/:studentId/history`**

Passe `HealthAccessContext` ao serviço, valide período por enum, devolva decimais como strings e mantenha `null` para dados ausentes. Não exponha observações profissionais fora das permissões aprovadas.

- [ ] **Step 4: Executar os testes HTTP**

Run: `pnpm --filter @arenahub/api test -- assessment-history.controller.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/health-progress apps/api/src/app.module.ts
git commit -m "feat(health): expose assessment history api"
```

### Task 4: Construir a visualização acessível do histórico

**Files:**
- Create: `apps/admin-web/app/(protected)/health/students/[id]/history/page.tsx`
- Create: `apps/admin-web/app/(protected)/health/students/[id]/history/loading.tsx`
- Create: `apps/admin-web/app/(protected)/my-health/page.tsx`
- Create: `apps/admin-web/components/health/history/measurement-history.tsx`
- Create: `apps/admin-web/components/health/history/measurement-chart.client.tsx`
- Create: `apps/admin-web/components/health/history/measurement-table.tsx`
- Create: `apps/admin-web/components/health/history/measurement-history.test.tsx`
- Create: `apps/admin-web/tests/e2e/health-history.spec.ts`

- [ ] **Step 1: Escrever testes de renderização e acessibilidade**

Exija resumo textual, tabela equivalente ao gráfico, cabeçalhos associados, foco visível e identificação por texto/forma além de cor. Séries com ausência devem mostrar lacunas, nunca pontos em zero.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter admin-web test -- measurement-history.test.tsx`
Expected: FAIL porque os componentes não existem.

- [ ] **Step 3: Implementar a página como Server Component**

Busque o histórico no servidor. Restrinja o Client Component ao filtro de período, seleção de métrica e interação do SVG; não envie segredos nem o payload completo para código cliente desnecessário.

- [ ] **Step 4: Implementar gráfico SVG e tabela equivalente**

Inclua título e descrição acessíveis, pontos focáveis, rótulos de unidade e indicação de correção. A tabela deve apresentar exatamente os valores usados no gráfico.

- [ ] **Step 5: Executar testes unitários e E2E**

Run: `pnpm --filter admin-web test -- measurement-history.test.tsx`
Expected: PASS.

Run: `pnpm --filter admin-web e2e -- health-history.spec.ts`
Expected: PASS para profissional autorizado e aluno consultando a própria evolução.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/app/\(protected\)/health apps/admin-web/app/\(protected\)/my-health apps/admin-web/components/health/history apps/admin-web/tests/e2e/health-history.spec.ts
git commit -m "feat(web): add accessible health history"
```

### Task 5: Entregar exportação segura dos próprios dados

**Files:**
- Create: `apps/api/src/modules/health-progress/exports/health-export.service.ts`
- Create: `apps/api/src/modules/health-progress/exports/health-export.worker.ts`
- Create: `apps/api/src/modules/health-progress/exports/health-export.controller.ts`
- Create: `apps/api/src/modules/health-progress/exports/health-export.service.spec.ts`
- Create: `apps/api/src/modules/health-progress/exports/health-export.worker.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/admin-web/components/health/history/export-health-data.client.tsx`

- [ ] **Step 1: Escrever testes do snapshot de exportação**

Exija JSON e CSV com avaliação, medição, unidade original, unidade canônica, proveniência e cadeia de correção. Neutralize células CSV iniciadas por `=`, `+`, `-` ou `@` e preserve decimais como texto.

- [ ] **Step 2: Escrever testes de autorização e privacidade**

Somente o titular ou papel explicitamente autorizado pode solicitar. Consentimento analítico revogado não elimina o direito de exportar dados ainda retidos pela política; a decisão deve ser auditada.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-export`
Expected: FAIL porque serviço e worker ainda não existem.

- [ ] **Step 4: Implementar solicitação assíncrona e worker**

Crie snapshot transacional, gere os dois formatos fora da requisição HTTP, armazene em bucket privado e devolva URL assinada curta. Use chave idempotente por solicitação e remova o artefato na expiração definida pela política.

- [ ] **Step 5: Implementar controles web**

Mostre estado solicitado, processando, pronto, expirado ou falhou; não exponha caminho interno do objeto.

- [ ] **Step 6: Executar testes**

Run: `pnpm --filter @arenahub/api test -- health-export`
Expected: PASS.

Run: `pnpm --filter admin-web test -- export-health-data.client.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/health-progress/exports apps/api/src/app.module.ts apps/admin-web/components/health/history/export-health-data.client.tsx
git commit -m "feat(health): add private health data export"
```

### Task 6: Fechar evidências da slice

**Files:**
- Create: `docs/operations/health/evidence/mvp-03-02-history-comparisons.md`
- Modify: `docs/prd/academia/MVP-03-health-intelligence.md`

- [ ] **Step 1: Executar a suíte da slice**

Run: `pnpm --filter @arenahub/health-domain test`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test && pnpm --filter @arenahub/api test:integration`
Expected: PASS.

Run: `pnpm --filter admin-web test && pnpm --filter admin-web e2e -- health-history.spec.ts`
Expected: PASS.

- [ ] **Step 2: Registrar evidências**

Documente `M3-FR-007`, `M3-FR-008`, `M3-FR-017`, `M3-BR-002`, `M3-BR-003`, `M3-BR-005`, `M3-NFR-001`, `M3-NFR-002`, `M3-NFR-006`, `M3-NFR-007`, `M3-NFR-008`, `M3-AC-003`, `M3-AC-004` e `M3-AC-010` com comandos, resultados, screenshots sem dados reais e limitações conhecidas.

- [ ] **Step 3: Atualizar somente os checkboxes comprovados no PRD**

Não marque requisito com teste pendente ou ambiente simulado quando ele exige integração real.

- [ ] **Step 4: Commit**

```bash
git add docs/operations/health/evidence/mvp-03-02-history-comparisons.md docs/prd/academia/MVP-03-health-intelligence.md
git commit -m "docs(health): record history and comparison evidence"
```
