# MVP-05.0 — Gates e políticas de engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converter privacidade, segurança comportamental, eventos upstream, moderação, notificações e experimento em manifests verificáveis antes de escrever código do MVP-05.

**Architecture:** JSON Schemas versionam decisões; manifests assinados registram valores aprovados e evidências. Um verificador falha fechado quando falta contrato, consentimento, limite profissional ou provider. Gates documentais não são substituídos por feature flags.

**Tech Stack:** JSON Schema 2020-12, TypeScript, Zod, Ajv, OpenAPI, Pact/contract tests, Jest e scripts do monorepo.

---

## Pré-condições

- PRD `docs/prd/academia/MVP-05-engagement.md` aprovado.
- Planos dos MVPs 0 a 4 disponíveis para comparação.
- Nenhuma constante clínica, frequência saudável ou tamanho mínimo de coorte será inventada durante a implementação.

### Task 1: Verificar o entry gate e os contratos upstream

**Files:**
- Create: `docs/operations/engagement/upstream-contracts.schema.json`
- Create: `docs/operations/engagement/upstream-contracts.json`
- Create: `scripts/engagement/verify-upstream-contracts.ts`
- Create: `scripts/engagement/verify-upstream-contracts.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Escrever o teste que falha sem evidência**

```ts
it('blocks engagement when a consumed event has no contract evidence', async () => {
  await expect(verifyUpstreamContracts(incompleteManifest)).rejects.toThrow('M5_ENTRY_01_BLOCKED');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- verify-upstream-contracts.spec.ts`
Expected: FAIL porque schema e verificador não existem.

- [ ] **Step 3: Definir manifesto fechado**

Exija commit-base, OpenAPI, envelope, `schemaVersion`, producer owner, contract test e fixture para cada evento consumido. `PassageConfirmed` também comprova política de sessão elegível, deduplicação e timezone da unidade.

```ts
export const requiredEvents = [
  'PassageConfirmed',
  'AssessmentPublished',
  'HealthGoalReached',
  'SubscriptionPaused',
  'SubscriptionActivated',
] as const;
```

- [ ] **Step 4: Implementar verificador e comando**

Adicione `engagement:gates:upstream`. O comando valida arquivos referenciados, executa contract tests e recusa `planned`, path inexistente ou versão incompatível.

- [ ] **Step 5: Executar testes**

Run: `pnpm test -- verify-upstream-contracts.spec.ts && pnpm engagement:gates:upstream`
Expected: PASS apenas quando `M5-ENTRY-01` possuir evidência real; enquanto os MVPs não estiverem implementados, saída esperada é `BLOCKED` com itens acionáveis.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/engagement/upstream-contracts.schema.json docs/operations/engagement/upstream-contracts.json scripts/engagement package.json
git commit -m "docs(engagement): define upstream entry gate"
```

### Task 2: Fixar consentimentos e política de identidade pública

**Files:**
- Create: `docs/operations/engagement/privacy-policy.schema.json`
- Create: `docs/operations/engagement/privacy-policy.json`
- Create: `docs/operations/engagement/public-identity-policy.schema.json`
- Create: `docs/operations/engagement/public-identity-policy.json`
- Create: `docs/operations/engagement/privacy-gate.spec.ts`

- [ ] **Step 1: Escrever testes de falha fechada**

```ts
it.each(['rankingOptIn', 'challengeOptIn', 'engagementPushOptIn', 'physicalEvolutionRankingOptIn'])(
  'requires %s to default to false', key => expect(policy.defaults[key]).toBe(false),
);
```

Teste revogação, prazo máximo de 15 minutos, pseudônimo por snapshot, export e ausência de PII.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- privacy-gate.spec.ts`
Expected: FAIL porque políticas não existem.

- [ ] **Step 3: Registrar decisões aprovadas**

O manifesto contém finalidade, base legal avaliada, texto/versionamento do consentimento, retenção, revogação, exclusão da projeção pública, audience de export e responsável. Identidade pública define alias, pseudônimo e proíbe nome real implícito.

- [ ] **Step 4: Validar política**

Run: `pnpm test -- privacy-gate.spec.ts`
Expected: PASS sem consentimento agregado e sem valor default verdadeiro.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/engagement/privacy-policy.schema.json docs/operations/engagement/privacy-policy.json docs/operations/engagement/public-identity-policy.schema.json docs/operations/engagement/public-identity-policy.json docs/operations/engagement/privacy-gate.spec.ts
git commit -m "docs(engagement): gate consent and public identity"
```

### Task 3: Homologar catálogos versionados e limites profissionais

**Files:**
- Create: `docs/operations/engagement/engagement-policy.schema.json`
- Create: `docs/operations/engagement/engagement-policy.json`
- Create: `docs/operations/engagement/achievement-catalog.schema.json`
- Create: `docs/operations/engagement/achievement-catalog.json`
- Create: `docs/operations/engagement/ranking-catalog.schema.json`
- Create: `docs/operations/engagement/ranking-catalog.json`
- Create: `docs/operations/engagement/challenge-template.schema.json`
- Create: `docs/operations/engagement/challenge-template.json`
- Create: `docs/operations/engagement/catalog-gate.spec.ts`

- [ ] **Step 1: Escrever testes dos limites**

```ts
it('rejects a challenge without a signed professional cap', () => {
  expect(() => validateTemplate(unsignedTemplate, policy)).toThrow('PROFESSIONAL_CAP_REQUIRED');
});

it('rejects executable expressions', () => {
  expect(() => validateRule({ expression: 'student.xp += 100' })).toThrow('DECLARATIVE_RULE_REQUIRED');
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- catalog-gate.spec.ts`
Expected: FAIL porque schemas e fixtures ainda não existem.

- [ ] **Step 3: Definir schemas sem valores clínicos fictícios**

Exija `id`, `version`, `status`, `effectiveAt`, critérios declarativos enumerados, timezone, vigência, responsável e hash do conteúdo. Campos numéricos dependentes de decisão profissional ficam ausentes até assinatura; ausência mantém feature fechada.

```ts
export type RuleOperator =
  | 'CONFIRMED_SESSION_IN_LOCAL_DAY'
  | 'ELIGIBLE_SESSIONS_IN_LOCAL_WEEK'
  | 'RELATIVE_CHANGE_FROM_COMPARABLE_BASELINE'
  | 'VERIFIED_GOAL_REACHED';
```

- [ ] **Step 4: Validar incompatibilidades**

Recuse frequência acima do cap, ranking físico absoluto, coorte mínima ausente, desempate não determinístico, recompensa monetária, regra retroativa silenciosa e template sem orçamento de notificação.

- [ ] **Step 5: Executar testes**

Run: `pnpm test -- catalog-gate.spec.ts`
Expected: PASS para fixtures aprovadas e FAIL fechado para decisão pendente.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/engagement/engagement-policy.schema.json docs/operations/engagement/engagement-policy.json docs/operations/engagement/achievement-catalog.schema.json docs/operations/engagement/achievement-catalog.json docs/operations/engagement/ranking-catalog.schema.json docs/operations/engagement/ranking-catalog.json docs/operations/engagement/challenge-template.schema.json docs/operations/engagement/challenge-template.json docs/operations/engagement/catalog-gate.spec.ts
git commit -m "docs(engagement): gate safe rule catalogs"
```

### Task 4: Homologar moderação e permissões operacionais

**Files:**
- Create: `docs/operations/engagement/moderation-policy.schema.json`
- Create: `docs/operations/engagement/moderation-policy.json`
- Create: `docs/operations/engagement/engagement-permissions.json`
- Create: `docs/operations/engagement/moderation-gate.spec.ts`

- [ ] **Step 1: Escrever testes de abuso operacional**

Teste alias ofensivo, dado sensível, homógrafo, ocultação sem motivo, ajuste de XP sem dupla autorização e disputa resolvida sem evidência.

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- moderation-gate.spec.ts`
Expected: FAIL porque políticas não existem.

- [ ] **Step 3: Definir fluxo e RBAC**

Estados de alias: `PENDING`, `APPROVED`, `REJECTED`, `HIDDEN`, `APPEALED`. Disputas: `OPEN`, `UNDER_REVIEW`, `RESOLVED`, `REJECTED`, `APPEALED`. Separe permissões de publicar ranking, criar desafio, moderar alias, revisar disputa e autorizar ajuste.

- [ ] **Step 4: Executar testes**

Run: `pnpm test -- moderation-gate.spec.ts`
Expected: PASS com razão categorizada, audit trail e segregação de função.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/engagement/moderation-policy.schema.json docs/operations/engagement/moderation-policy.json docs/operations/engagement/engagement-permissions.json docs/operations/engagement/moderation-gate.spec.ts
git commit -m "docs(engagement): gate moderation and operator powers"
```

### Task 5: Fechar notificações, baseline e decisão go/no-go

**Files:**
- Create: `docs/operations/engagement/notification-policy.schema.json`
- Create: `docs/operations/engagement/notification-policy.json`
- Create: `docs/operations/engagement/push-capability-evaluation.md`
- Create: `docs/operations/engagement/experiment-baseline.schema.json`
- Create: `docs/operations/engagement/experiment-baseline.json`
- Create: `docs/operations/engagement/gate-decision.schema.json`
- Create: `docs/operations/engagement/gate-decision.json`
- Create: `scripts/engagement/verify-gates.ts`
- Create: `scripts/engagement/verify-gates.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Escrever teste do gate agregado**

```ts
it('keeps external push disabled when MVP-04 deferred the provider', async () => {
  const result = await verifyGates({ pushStatus: 'DEFERRED_TO_MVP_05_SLICE_5_5' });
  expect(result.flags.ENGAGEMENT_PUSH).toBe(false);
});
```

- [ ] **Step 2: Executar e confirmar falha**

Run: `pnpm test -- verify-gates.spec.ts`
Expected: FAIL porque o verificador agregado não existe.

- [ ] **Step 3: Registrar política de contato**

Reutilize `docs/operations/app-totem/push-capabilities.json`. Defina quiet hours, timezone, limite por aluno/tenant/campanha, prioridade, expiração e conteúdo proibido. Token rotacionado substitui o registro anterior; receipt inválido desativa apenas o token correspondente.

- [ ] **Step 4: Congelar baseline e guardrails**

Registre janela, população, métricas de frequência consistente, opt-out, denúncia, suporte e sinais aprovados de sobreuso, com owner, threshold de parada e plano de rollback. Sem baseline válido, `RANKINGS`, `CHALLENGES` e `ENGAGEMENT_PUSH` permanecem falsos.

- [ ] **Step 5: Implementar verificador final**

Adicione `engagement:gates`. `gate-decision.json` recebe `APPROVED` somente com todas as evidências e assinaturas; status possíveis são `BLOCKED`, `CONDITIONAL`, `APPROVED`.

- [ ] **Step 6: Executar gate**

Run: `pnpm test -- verify-gates.spec.ts && pnpm engagement:gates`
Expected: PASS do verificador; decisão `BLOCKED` até as evidências reais existirem, sem gerar manifest aprovado fictício.

- [ ] **Step 7: Commit**

```bash
git add docs/operations/engagement/notification-policy.schema.json docs/operations/engagement/notification-policy.json docs/operations/engagement/push-capability-evaluation.md docs/operations/engagement/experiment-baseline.schema.json docs/operations/engagement/experiment-baseline.json docs/operations/engagement/gate-decision.schema.json docs/operations/engagement/gate-decision.json scripts/engagement/verify-gates.ts scripts/engagement/verify-gates.spec.ts package.json
git commit -m "docs(engagement): add aggregate readiness gate"
```

## Verificação da fase

- [ ] Run: `pnpm engagement:gates`
  Expected: cada gate mostra status, evidência e ação; nenhuma aprovação baseada apenas em texto do plano.
- [ ] Run: `pnpm lint && pnpm typecheck && pnpm test`
  Expected: PASS.
- [ ] Confirmar que nenhum manifesto contém marcador de decisão pendente, valor clínico sem assinatura ou provider presumido.

## Próximo plano

Após `M5-ENTRY-01` e `M5-PRIVACY-01` aprovados, executar `2026-08-14-mvp-05-01-preferences-public-identity.md`.
