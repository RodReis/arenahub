# MVP-03.6 — Operação, privacidade e qualidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute this plan task-by-task.

**Goal:** Colocar o módulo de saúde em operação controlada com observabilidade, gestão de privacidade, indicadores agregados e um piloto que prove segurança e qualidade antes da expansão.

**Architecture:** Eventos operacionais estruturados alimentam métricas e alertas sem carregar conteúdo clínico. Workflows assíncronos executam exportação, revogação e exclusão conforme política, com auditoria e recibos. Visões gerenciais usam agregação com limiar mínimo, enquanto feature flags separam captura, importação, IA interna e visualização do aluno.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, BullMQ, Redis, OpenTelemetry, métricas compatíveis com Prometheus, Next.js App Router, Jest (API/workers), Vitest (pacotes/UI), Playwright, k6.

---

## Pré-condições

- Concluir as slices 3.1 a 3.5 aplicáveis ao piloto.
- Manter fechada qualquer integração cujo gate específico não esteja aprovado.
- Definir responsáveis de produto, privacidade, operação e profissionais revisores antes de habilitar dados reais.

### Task 1: Instrumentar métricas sem vazar dados de saúde

**Files:**
- Create: `apps/api/src/modules/health-operations/observability/health-metrics.service.ts`
- Create: `apps/api/src/modules/health-operations/observability/health-metrics.service.spec.ts`
- Create: `apps/api/src/workers/health-observability/health-worker-metrics.ts`
- Create: `packages/observability/src/health-telemetry.ts`
- Create: `packages/observability/src/health-telemetry.test.ts`

- [ ] **Step 1: Escrever testes de cardinalidade e privacidade**

Bloqueie nome, e-mail, documento, aluno, avaliação, importação, prompt, resposta e valor corporal em label/log. Permita apenas tenant pseudonimizado controlado, operação, status, tipo de adapter e versão em conjuntos limitados.

- [ ] **Step 2: Escrever testes dos indicadores técnicos**

Cubra latência e erro de avaliação, fila de importação, scanner, extração, confirmação, projeção de frequência, geração de IA, validação, revisão, custo e expiração de artefato.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/observability test -- health-telemetry.test.ts`
Expected: FAIL porque a instrumentação ainda não existe.

- [ ] **Step 4: Implementar métricas e logs estruturados**

Propague trace ID técnico, não identificador clínico. Use buckets de latência aprovados, enum de erro sanitizado e medidores separados por API/worker.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/observability test -- health-telemetry.test.ts`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- health-metrics.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/observability apps/api/src/modules/health-operations/observability apps/api/src/workers/health-observability
git commit -m "feat(health): add privacy-safe health telemetry"
```

### Task 2: Criar indicadores de qualidade e proveniência

**Files:**
- Create: `packages/health-domain/src/data-quality.ts`
- Create: `packages/health-domain/src/data-quality.test.ts`
- Create: `apps/api/src/modules/health-operations/quality/health-quality.service.ts`
- Create: `apps/api/src/modules/health-operations/quality/health-quality.service.spec.ts`
- Create: `apps/api/src/modules/health-operations/quality/health-quality.controller.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes das definições**

Calcule completude por campo aplicável, cobertura de proveniência, taxa de correção de importação, falha de scanner/extractor, gaps de frequência, invalidação/rejeição de IA, custo e latência. Denominadores devem ser explícitos e períodos sem amostra retornam `null`, não zero.

- [ ] **Step 2: Escrever testes de agregação gerencial**

Exija limiar mínimo `k=5` por célula, supressão de subconjuntos complementares e ausência de drill-down para indivíduo. Não publique percentil ou combinação que permita reidentificação indireta.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/health-domain test -- data-quality.test.ts`
Expected: FAIL porque os cálculos ainda não existem.

- [ ] **Step 4: Implementar domínio e endpoint operacional**

Crie rota administrativa sob `/v1/operations/health/quality`, protegida por papel e propósito, com dados agregados. Metas iniciais vêm do documento de operação aprovado, não de constantes inventadas.

- [ ] **Step 5: Executar testes**

Run: `pnpm --filter @arenahub/health-domain test -- data-quality.test.ts`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- health-quality.service.spec.ts`
Expected: PASS, inclusive supressão em amostra pequena.

- [ ] **Step 6: Commit**

```bash
git add packages/health-domain apps/api/src/modules/health-operations/quality apps/api/src/app.module.ts
git commit -m "feat(health): expose aggregated data quality indicators"
```

### Task 3: Implementar revogação, exportação e exclusão LGPD

**Files:**
- Create: `apps/api/src/modules/health-operations/privacy/health-privacy.service.ts`
- Create: `apps/api/src/modules/health-operations/privacy/health-privacy.service.spec.ts`
- Create: `apps/api/src/modules/health-operations/privacy/health-privacy.controller.ts`
- Create: `apps/api/src/workers/health-privacy/health-data-erasure.worker.ts`
- Create: `apps/api/src/workers/health-privacy/health-data-erasure.worker.spec.ts`
- Create: `apps/api/src/workers/health-privacy/health-data-export.worker.ts`
- Create: `apps/api/src/workers/health-privacy/health-data-export.worker.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Escrever testes de revogação imediata**

Após revogar, bloqueie nova avaliação, importação, análise e compartilhamento. Cancele jobs ainda não enviados ao provedor, invalide URLs assinadas quando suportado e registre o que permaneceu por obrigação legal.

- [ ] **Step 2: Escrever testes de exportação completa**

Inclua dados, consentimentos, proveniência, revisões, decisões automatizadas assistidas e auditoria que o titular pode receber, omitindo segredos internos e dados de terceiros.

- [ ] **Step 3: Escrever testes de exclusão/anonymização**

O workflow deve classificar cada conjunto como apagar, anonimizar, reter legalmente ou aguardar disputa, executar idempotentemente e produzir recibo verificável sem replicar conteúdo sensível.

- [ ] **Step 4: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-privacy.service.spec.ts`
Expected: FAIL porque o workflow ainda não existe.

Run: `pnpm --filter @arenahub/api test -- health-privacy`
Expected: FAIL porque os workers ainda não existem.

- [ ] **Step 5: Implementar workflow assíncrono**

Use a política versionada de retenção e bases legais aprovadas em `M3-CLINICAL-01`. Não prometa deleção física quando houver retenção obrigatória; reporte status e fundamento ao solicitante.

- [ ] **Step 6: Executar testes**

Run: `pnpm --filter @arenahub/api test -- health-privacy.service.spec.ts`
Expected: PASS.

Run: `pnpm --filter @arenahub/api test -- health-privacy`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/health-operations/privacy apps/api/src/app.module.ts apps/api/src/workers/health-privacy
git commit -m "feat(health): enforce health data privacy workflows"
```

### Task 4: Criar painel operacional e alertas acionáveis

**Files:**
- Create: `apps/admin-web/app/(protected)/operations/health/page.tsx`
- Create: `apps/admin-web/components/operations/health/health-operations-dashboard.tsx`
- Create: `apps/admin-web/components/operations/health/health-operations-dashboard.test.tsx`
- Create: `docs/operations/health/alerts.md`
- Create: `infra/observability/health-alerts.yaml`
- Create: `infra/observability/health-dashboard.json`

- [ ] **Step 1: Escrever testes da visão operacional**

Mostre backlog e idade de revisão, falhas de upload/scan/extract, artefatos vencidos, gaps de frequência, IA inválida, circuito aberto e consumo. Não mostre valores corporais, texto da análise ou identificador do aluno.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm --filter admin-web test -- health-operations-dashboard.test.tsx`
Expected: FAIL porque o painel ainda não existe.

- [ ] **Step 3: Implementar painel e permissões**

Renderize dados agregados no servidor, com filtros de período e tenant permitidos. Links de investigação apontam para logs por trace técnico e exigem nova autorização.

- [ ] **Step 4: Definir alertas com owner e ação**

Cada alerta deve conter expressão, janela, severidade, owner, runbook, silêncio e critério de resolução. Inclua scanner indisponível, fila envelhecida, exclusão vencida, alta de correções e circuito de IA aberto.

- [ ] **Step 5: Validar regras e testes**

Run: `pnpm observability:validate`
Expected: PASS para dashboard e alertas.

Run: `pnpm --filter admin-web test -- health-operations-dashboard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/app/\(protected\)/operations/health apps/admin-web/components/operations/health docs/operations/health/alerts.md infra/observability
git commit -m "feat(health): add health operations dashboard"
```

### Task 5: Escrever e ensaiar runbooks operacionais

**Files:**
- Create: `docs/operations/health/runbooks/assessment-correction.md`
- Create: `docs/operations/health/runbooks/import-provider-outage.md`
- Create: `docs/operations/health/runbooks/malware-scanner-outage.md`
- Create: `docs/operations/health/runbooks/ai-provider-outage.md`
- Create: `docs/operations/health/runbooks/consent-revocation.md`
- Create: `docs/operations/health/runbooks/privacy-request.md`
- Create: `docs/operations/health/runbooks/attendance-rebuild.md`
- Create: `docs/operations/health/runbooks/security-incident.md`
- Create: `docs/operations/health/evidence/runbook-rehearsals.md`

- [ ] **Step 1: Escrever critérios completos por runbook**

Inclua gatilho, impacto, papéis, diagnóstico, contenção, recuperação, validação, comunicação, rollback e evidências. Proíba correção direta no banco e inclusão de dados sensíveis em ticket/chat.

- [ ] **Step 2: Executar tabletop com outra pessoa**

O executor não pode ser o autor principal. Simule scanner fora, provider de IA lento, revogação durante job e rebuild de frequência; registre tempos, passos ambíguos e comandos inseguros.

- [ ] **Step 3: Corrigir runbooks e repetir cenários falhos**

Expected: cada cenário termina em estado verificável, sem perda de auditoria e sem publicação indevida.

- [ ] **Step 4: Commit**

```bash
git add docs/operations/health/runbooks docs/operations/health/evidence/runbook-rehearsals.md
git commit -m "docs(health): add rehearsed operations runbooks"
```

### Task 6: Executar gates de segurança, acessibilidade e desempenho

**Files:**
- Create: `apps/api/test/security/health-access.e2e-spec.ts`
- Create: `apps/api/test/security/health-uploads.e2e-spec.ts`
- Create: `apps/admin-web/tests/e2e/health-accessibility.spec.ts`
- Create: `tests/performance/health-history.js`
- Create: `tests/performance/health-upload.js`
- Create: `docs/operations/health/evidence/non-functional-gates.md`

- [ ] **Step 1: Testar autorização horizontal e vertical**

Cubra aluno, profissional sem vínculo, recepção, gestor e outro tenant em avaliações, histórico, importações, metas, IA, exportações e painel. Nenhuma rota pode depender só de ocultação da interface.

- [ ] **Step 2: Testar upload hostil**

Cubra polyglot, extensão/MIME divergentes, path traversal, arquivo grande, zip bomb quando aplicável, CSV malformado, fórmula e scanner indisponível.

- [ ] **Step 3: Testar acessibilidade**

Execute fluxos por teclado e leitor semântico para avaliação, histórico, import review, metas, análise e operações. Gráficos devem manter tabela equivalente e não depender apenas de cor.

- [ ] **Step 4: Testar desempenho com volume representativo**

Gere dados sintéticos para cinco anos de avaliações e passagens. Verifique o SLO aprovado para histórico e que upload/extract permanece assíncrono sem degradar cadastro manual.

- [ ] **Step 5: Executar gates**

Run: `pnpm --filter @arenahub/api test:e2e -- health-access health-uploads`
Expected: PASS.

Run: `pnpm --filter admin-web e2e -- health-accessibility.spec.ts`
Expected: PASS sem violações críticas ou sérias.

Run: `pnpm perf:health`
Expected: PASS nos limites aprovados em `M3-CLINICAL-01` e no PRD.

- [ ] **Step 6: Registrar evidência e commit**

```bash
git add apps/api/test/security apps/admin-web/tests/e2e/health-accessibility.spec.ts tests/performance docs/operations/health/evidence/non-functional-gates.md
git commit -m "test(health): verify security accessibility and performance"
```

### Task 7: Conduzir piloto por feature flags

**Files:**
- Create: `apps/api/src/modules/health-operations/config/health-feature-flags.ts`
- Create: `apps/api/src/modules/health-operations/config/health-feature-flags.spec.ts`
- Create: `docs/operations/health/pilot-plan.md`
- Create: `docs/operations/health/pilot-checklist.md`
- Create: `docs/operations/health/rollback-plan.md`
- Create: `docs/operations/health/evidence/mvp-03-pilot.md`

- [ ] **Step 1: Definir flags independentes**

Separe captura manual, histórico do profissional, histórico do aluno, importação, metas, frequência, IA interna e IA para aluno. Default deve ser fechado para tenant fora do piloto.

- [ ] **Step 2: Escrever testes de precedência e fail-safe**

Flag global fechada deve vencer tenant aberta; configuração ausente ou inválida deve fechar. Gate documental continua obrigatório mesmo se uma flag for alterada por engano.

- [ ] **Step 3: Executar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- health-feature-flags.spec.ts`
Expected: FAIL porque flags ainda não existem.

- [ ] **Step 4: Implementar flags e kill switches**

Registre alterações em auditoria e permita desligar importação/IA sem interromper avaliação manual e histórico já publicado.

- [ ] **Step 5: Executar piloto em ondas**

Ordem: equipe interna sintética, profissionais com dados anonimizados, captura manual real consentida, importação validada, metas/frequência, IA apenas interna e, por último, visualizações do aluno conforme gates. Defina amostra, duração, owner, métricas e stop conditions em `pilot-plan.md`.

- [ ] **Step 6: Auditar amostra e decisão go/no-go**

Revise proveniência, correções, acessos, revogações, falhas, outputs de IA e ausência de diagnóstico. Qualquer vazamento, publicação automática, erro sistemático de unidade ou impossibilidade de revogação é stop condition.

- [ ] **Step 7: Executar testes e registrar evidência**

Run: `pnpm --filter @arenahub/api test -- health-feature-flags.spec.ts`
Expected: PASS.

Documente decisão assinada pelos responsáveis; resultado parcial não equivale a liberação geral.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/health-operations/config docs/operations/health/pilot-plan.md docs/operations/health/pilot-checklist.md docs/operations/health/rollback-plan.md docs/operations/health/evidence/mvp-03-pilot.md
git commit -m "ops(health): complete controlled health pilot"
```

### Task 8: Fechar rastreabilidade do MVP-03

**Files:**
- Create: `docs/operations/health/evidence/mvp-03-final-traceability.md`
- Modify: `docs/prd/academia/MVP-03-health-intelligence.md`
- Modify: `docs/superpowers/plans/2026-08-14-mvp-03-health-intelligence-index.md`

- [ ] **Step 1: Consolidar requisitos e provas**

Liste individualmente `M3-FR-001` a `M3-FR-017`, `M3-BR-001` a `M3-BR-010`, `M3-NFR-001` a `M3-NFR-008` e `M3-AC-001` a `M3-AC-010`, com teste, evidência, ambiente e status.

- [ ] **Step 2: Confirmar critérios de bloqueio**

Não feche o MVP se houver consentimento contornável, acesso cruzado, perda de proveniência, correção destrutiva, importação sem scanner/revisão, dado ausente tratado como zero, IA diagnóstica ou análise publicada sem profissional.

- [ ] **Step 3: Executar regressão final**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

Run: `pnpm test:integration && pnpm test:e2e`
Expected: PASS.

Run: `pnpm perf:health && pnpm observability:validate`
Expected: PASS.

- [ ] **Step 4: Atualizar PRD e índice apenas com evidência**

Mantenha gates fechados descritos como pendentes; não confunda capacidade fake com integração real nem piloto limitado com rollout geral.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/health/evidence/mvp-03-final-traceability.md docs/prd/academia/MVP-03-health-intelligence.md docs/superpowers/plans/2026-08-14-mvp-03-health-intelligence-index.md
git commit -m "docs(health): close MVP 03 traceability"
```
