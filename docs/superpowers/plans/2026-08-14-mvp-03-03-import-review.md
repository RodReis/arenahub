# MVP-03.3 — Importação e revisão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute this plan task-by-task.

**Goal:** Receber laudos e exportações de equipamentos com upload privado, inspeção assíncrona, extração rastreável e confirmação humana obrigatória antes de qualquer publicação.

**Architecture:** O navegador envia o arquivo diretamente ao object storage privado por uma sessão de upload emitida pela API. Um pipeline em fila valida assinatura, hash e malware antes de extrair campos por adapters. Todo campo extraído preserva origem, confiança e localização; a confirmação gera apenas um rascunho de avaliação, que ainda passa pelo fluxo normal de publicação.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, BullMQ, Redis, Next.js App Router, React, S3-compatible object storage, Jest (API/workers), Vitest (pacotes/UI), Playwright.

---

## Pré-condições

- Concluir `2026-08-14-mvp-03-01-manual-assessments.md`.
- Aprovar `M3-IMPORT-01` para conectar qualquer formato ou equipamento real.
- Manter os adapters reais fora desta slice até existir plano aprovado em `2026-08-14-mvp-03-import-adapter.md`.

### Task 1: Modelar o ciclo de vida da importação

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_health_imports/migration.sql`
- Create: `apps/api/src/modules/assessment-imports/import-state-machine.ts`
- Create: `apps/api/src/modules/assessment-imports/import-state-machine.spec.ts`
- Create: `apps/api/src/modules/assessment-imports/ports/malware-scanner.port.ts`
- Create: `apps/api/src/modules/assessment-imports/ports/document-extractor.port.ts`
- Create: `apps/api/src/modules/assessment-imports/ports/canonical-csv-parser.port.ts`

- [ ] **Step 1: Escrever testes da máquina de estados**

Cubra `UPLOADING -> QUARANTINED -> SCANNING -> READY -> EXTRACTING -> REVIEW_REQUIRED -> CONFIRMED` e finais `REJECTED`, `FAILED` e `DELETED`. Bloqueie saltos, reprocessamento sem chave idempotente e confirmação antes da revisão.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- import-state-machine.spec.ts`
Expected: FAIL porque a máquina ainda não existe.

- [ ] **Step 3: Criar modelos e ports**

Adicione `AssessmentImport`, `ImportedField`, `ImportArtifact` e `ImportDeletionReceipt`. Registre tenant, aluno, solicitante, hash SHA-256, MIME declarado, MIME detectado, tamanho, adapter e versão, estados, timestamps e erro sanitizado.

- [ ] **Step 4: Gerar e aplicar migration**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name health_imports`
Expected: migration aplicada sem drift.

- [ ] **Step 5: Implementar transições atômicas e executar testes**

Run: `pnpm --filter @arenahub/api test -- import-state-machine.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/assessment-imports
git commit -m "feat(health): model secure assessment imports"
```

### Task 2: Implementar upload direto e quarentena

**Files:**
- Create: `apps/api/src/modules/assessment-imports/import-upload.controller.ts`
- Create: `apps/api/src/modules/assessment-imports/import-upload.service.ts`
- Create: `apps/api/src/modules/assessment-imports/import-upload.service.spec.ts`
- Create: `apps/api/src/modules/assessment-imports/dto/create-import-upload.dto.ts`
- Create: `apps/api/src/modules/assessment-imports/dto/complete-import-upload.dto.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes de autorização e limites**

Cubra profissional vinculado, vínculo ausente, consentimento revogado, MIME fora de `application/pdf`, `image/jpeg`, `image/png`, `text/csv`, tamanho acima do manifesto e chave de objeto fora do prefixo do tenant.

- [ ] **Step 2: Escrever testes de conclusão segura**

Exija verificação por `HEAD`, tamanho exato, SHA-256, assinatura mágica compatível e objeto ainda em quarentena. MIME informado pelo navegador não é prova suficiente.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- import-upload.service.spec.ts`
Expected: FAIL porque o serviço ainda não existe.

- [ ] **Step 4: Implementar as rotas de sessão e conclusão**

Crie `POST /v1/health/students/:studentId/imports/uploads` e `POST /v1/health/imports/:importId/complete`. Emita URL assinada curta para bucket privado e responda `202 Accepted` após enfileirar a inspeção; não carregue o arquivo na memória da API.

- [ ] **Step 5: Executar os testes**

Run: `pnpm --filter @arenahub/api test -- import-upload.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/assessment-imports apps/api/src/app.module.ts
git commit -m "feat(health): add quarantined direct uploads"
```

### Task 3: Inspecionar arquivos e interpretar o CSV canônico

**Files:**
- Create: `apps/api/src/workers/health-import/health-import.worker.ts`
- Create: `apps/api/src/workers/health-import/health-import.worker.spec.ts`
- Create: `apps/api/src/workers/health-import/adapters/fail-closed-malware-scanner.ts`
- Create: `packages/health-import/src/canonical-csv-parser.ts`
- Create: `packages/health-import/src/canonical-csv-parser.test.ts`
- Create: `packages/health-import/src/index.ts`
- Create: `packages/health-import/package.json`

- [ ] **Step 1: Escrever testes do scanner fail-closed**

O worker deve rejeitar assinatura perigosa, falha ou timeout do scanner e divergência de hash. Nenhum extractor pode receber o arquivo antes de estado `READY`.

- [ ] **Step 2: Escrever testes do CSV canônico**

Defina UTF-8 com BOM opcional, vírgula como delimitador, aspas RFC 4180, cabeçalho versionado obrigatório, decimais como strings, unidades explícitas e uma linha por medição. Rejeite coluna desconhecida, fórmula executável, encoding inválido e duplicata conflitante.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/health-import test`
Expected: FAIL porque o parser ainda não existe.

Run: `pnpm --filter @arenahub/api test -- health-import.worker.spec.ts`
Expected: FAIL porque o worker ainda não existe.

- [ ] **Step 4: Implementar parser e worker mínimo**

O scanner local de desenvolvimento deve falhar fechado e ser identificado como simulado; não o reporte como integração antimalware real. Use hash + chave idempotente para impedir criação duplicada em retry.

- [ ] **Step 5: Executar os testes**

Run: `pnpm --filter @arenahub/health-import test`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- health-import.worker.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/health-import apps/api/src/workers/health-import
git commit -m "feat(health): inspect imports and parse canonical csv"
```

### Task 4: Extrair campos com proveniência verificável

**Files:**
- Create: `apps/api/src/workers/health-import/adapters/canonical-csv-extractor.ts`
- Create: `apps/api/src/workers/health-import/adapters/unavailable-document-extractor.ts`
- Create: `apps/api/src/workers/health-import/field-mapping.service.ts`
- Create: `apps/api/src/workers/health-import/field-mapping.service.spec.ts`
- Create: `apps/api/src/modules/assessment-imports/import-review.controller.ts`
- Create: `apps/api/src/modules/assessment-imports/import-review.controller.spec.ts`

- [ ] **Step 1: Escrever testes de mapeamento**

Exija código de métrica, valor original, unidade original, valor canônico, confiança, página/linha/célula de origem, adapter e versão. Campos desconhecidos ficam `UNMAPPED`; nunca são descartados silenciosamente.

- [ ] **Step 2: Escrever teste do adapter indisponível**

PDF e imagem devem terminar com erro operacional explícito enquanto não houver adapter real aprovado; não invente OCR nem retorne campos vazios como sucesso.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- field-mapping.service.spec.ts`
Expected: FAIL porque o mapeador ainda não existe.

- [ ] **Step 4: Implementar extração do CSV e consulta de revisão**

Exponha `GET /v1/health/imports/:importId/review` apenas ao solicitante autorizado ou papel de revisão. Nunca devolva URL permanente do original.

- [ ] **Step 5: Executar testes do worker e API**

Run: `pnpm --filter @arenahub/api test -- health-import`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- import-review.controller.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/health-import apps/api/src/modules/assessment-imports
git commit -m "feat(health): extract imported fields with provenance"
```

### Task 5: Implementar revisão humana e confirmação em rascunho

**Files:**
- Create: `apps/api/src/modules/assessment-imports/import-confirmation.service.ts`
- Create: `apps/api/src/modules/assessment-imports/import-confirmation.service.spec.ts`
- Create: `apps/admin-web/app/(protected)/health/imports/[importId]/page.tsx`
- Create: `apps/admin-web/components/health/imports/import-review-form.client.tsx`
- Create: `apps/admin-web/components/health/imports/import-review-form.test.tsx`
- Create: `apps/admin-web/tests/e2e/health-import-review.spec.ts`

- [ ] **Step 1: Escrever testes da confirmação**

Exija aceite, correção ou rejeição campo a campo, justificativa para correção, chave idempotente e criação de `BodyAssessment` em `DRAFT`. Confirmação não pode publicar avaliação.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- import-confirmation.service.spec.ts`
Expected: FAIL porque o serviço ainda não existe.

- [ ] **Step 3: Implementar confirmação transacional**

Copie apenas campos aprovados para o rascunho, mantenha `sourceType`, `sourceImportId`, valor extraído e valor corrigido. Um retry com a mesma chave deve retornar o mesmo rascunho.

- [ ] **Step 4: Implementar a interface de revisão**

Mostre lado a lado valor extraído, origem, confiança, unidade e campo editável. Destaque baixa confiança sem usar somente cor; exija confirmação explícita antes de enviar.

- [ ] **Step 5: Executar testes unitários e E2E**

Run: `pnpm --filter @arenahub/api test -- import-confirmation.service.spec.ts`
Expected: PASS.

Run: `pnpm --filter admin-web test -- import-review-form.test.tsx`
Expected: PASS.

Run: `pnpm --filter admin-web e2e -- health-import-review.spec.ts`
Expected: PASS e avaliação permanecendo em rascunho.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/assessment-imports apps/admin-web/app/\(protected\)/health/imports apps/admin-web/components/health/imports apps/admin-web/tests/e2e/health-import-review.spec.ts
git commit -m "feat(health): add human import review"
```

### Task 6: Implementar retenção e exclusão de temporários

**Files:**
- Create: `apps/api/src/workers/health-import/import-retention.worker.ts`
- Create: `apps/api/src/workers/health-import/import-retention.worker.spec.ts`
- Create: `apps/api/src/modules/assessment-imports/import-retention.service.ts`
- Create: `apps/api/src/modules/assessment-imports/import-retention.service.spec.ts`

- [ ] **Step 1: Escrever testes da política de retenção**

Cubra original temporário vencido, importação em disputa, consentimento revogado, deleção idempotente e falha do storage. Preserve recibo sem conteúdo clínico após exclusão.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- import-retention.worker.spec.ts`
Expected: FAIL porque o worker ainda não existe.

- [ ] **Step 3: Implementar exclusão e recibo**

Use prazo do manifesto aprovado; não codifique número arbitrário. Remova objeto, derivados e URLs, registre hash, motivo e horário, e alerte se a exclusão não concluir.

- [ ] **Step 4: Executar testes**

Run: `pnpm --filter @arenahub/api test -- import-retention.worker.spec.ts`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- import-retention.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/health-import apps/api/src/modules/assessment-imports
git commit -m "feat(health): enforce import artifact retention"
```

### Task 7: Validar o primeiro formato real e fechar evidências

**Files:**
- Create: `docs/operations/health/evidence/mvp-03-03-import-review.md`
- Modify: `docs/operations/health/import-capabilities.md`
- Modify: `docs/prd/academia/MVP-03-health-intelligence.md`

- [ ] **Step 1: Executar o plano fixo do adapter aprovado**

Execute `2026-08-14-mvp-03-import-adapter.md` somente após `M3-IMPORT-01`. O adapter deve passar pelos arquivos golden anonimizados, scanner real e critérios de proveniência; simulador não fecha integração real.

- [ ] **Step 2: Executar regressão do pipeline**

Run: `pnpm --filter @arenahub/health-import test && pnpm --filter @arenahub/api test -- health-import`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test:integration -- health-import`
Expected: PASS, incluindo malware, retry e isolamento entre tenants.

Run: `pnpm --filter admin-web e2e -- health-import-review.spec.ts`
Expected: PASS.

- [ ] **Step 3: Registrar evidências**

Documente `M3-FR-009`, `M3-FR-010`, `M3-FR-011`, `M3-FR-014`, `M3-BR-002`, `M3-BR-004`, `M3-BR-005`, `M3-BR-006`, `M3-NFR-003`, `M3-NFR-004`, `M3-NFR-006`, `M3-NFR-008`, `M3-AC-004` e `M3-AC-005`, distinguindo claramente CSV canônico, formato real validado e adapters indisponíveis.

- [ ] **Step 4: Atualizar checkboxes comprovados e commit**

```bash
git add docs/operations/health/evidence/mvp-03-03-import-review.md docs/operations/health/import-capabilities.md docs/prd/academia/MVP-03-health-intelligence.md
git commit -m "docs(health): record secure import evidence"
```
