# MVP-03.1 — Consentimento e avaliação manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute this plan task-by-task.

**Goal:** Registrar consentimento de saúde e permitir que avaliador vinculado crie, valide, publique e corrija avaliações manuais sem sobrescrever histórico.

**Architecture:** `packages/quantities` implementa decimal fixo/conversões a partir do protocol manifest. Assessments ficam DRAFT editáveis por optimistic version e tornam-se imutáveis ao publicar. Medidas guardam original/canônica/proveniência. Correções criam nova avaliação vinculada. Um guard de saúde combina tenant, permissão, titularidade e vínculo.

**Tech Stack:** TypeScript `bigint`, Prisma `Decimal @db.Decimal(18,6)`, NestJS/Serializable transactions, Zod, PostgreSQL triggers, Next.js Server Components/Server Actions, Jest/fast-check e Playwright.

---

## Pré-condições

- [ ] `M3-ENTRY-01` e `M3-CLINICAL-01` aprovados;
- [ ] protocol/access/consent manifests presentes e hashes aprovados;
- [ ] `HEALTH_ASSESSMENTS=false` até migrations/acceptance;
- [ ] fixtures usam alunos e medidas sintéticas.

### Task 1: Construir decimal fixo e validação de protocolo

**Files:**
- Create: `packages/quantities/package.json`
- Create: `packages/quantities/src/fixed-decimal.ts`
- Create: `packages/quantities/src/conversion.ts`
- Create: `packages/quantities/src/protocol.ts`
- Create: `packages/quantities/src/bmi.ts`
- Create: `packages/quantities/test/fixed-decimal.test.ts`
- Create: `packages/quantities/test/conversion.test.ts`
- Create: `packages/quantities/test/protocol.test.ts`
- Create: `packages/quantities/test/bmi.test.ts`
- Create: `scripts/health/validate-protocol.mjs`

- [ ] **Step 1: Write golden/property tests**

Load every vector from approved protocol. Test parse/format scale 6, reject exponent/sign/NaN/extra precision, exact rational conversions, half-up presentation, BMI, zero/missing height, deterministic serialization and no input mutation.

- [ ] **Step 2: Implement fixed decimal contract**

```ts
const SCALE = 1_000_000n;
export interface FixedDecimal { readonly unscaled: bigint; readonly scale: 6 }

export function parseFixed(value: string): FixedDecimal {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw new QuantityError('DECIMAL_INVALID');
  const [whole, fraction = ''] = value.split('.');
  return { unscaled: BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0')), scale: 6 };
}
```

Implement add/subtract, rational conversion, multiply/divide with explicit nonnegative half-up; division by zero throws. Calculations never convert to JS `number`.

- [ ] **Step 3: Implement protocol loader**

Validate committed JSON against its strict schema, calculate SHA-256 and expose immutable measurement definitions by code. Startup fails if configured approved hash differs. Unknown measure/unit/version returns stable error, never generic fallback.

- [ ] **Step 4: Implement BMI derivation**

Use canonical kg and m fixed values; compute kg/(m×m) at scale 6, store derivation code/version plus source measurement IDs. Do not attach classification/diagnosis. Missing/zero inputs return `null` with reason, not zero.

- [ ] **Step 5: Verify and commit**

```bash
pnpm add -DE --filter @arenahub/quantities fast-check@4.9.0
pnpm --filter @arenahub/quantities test
node scripts/health/validate-protocol.mjs
git add packages/quantities scripts/health pnpm-lock.yaml
git commit -m "feat(health): add deterministic quantity protocol"
```

### Task 2: Adicionar consentimento, vínculo e schema de avaliação

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260814_health_assessments/migration.sql`
- Create: `apps/api/src/modules/health-consents/health-consents.controller.ts`
- Create: `apps/api/src/modules/health-consents/health-consents.service.ts`
- Create: `apps/api/src/modules/health-consents/health-consents.service.spec.ts`
- Create: `apps/api/src/modules/health-access/health-access.guard.ts`
- Create: `apps/api/src/modules/health-access/health-access.guard.spec.ts`
- Create: `apps/api/src/modules/health-access/health-access-context.ts`
- Test: `apps/api/test/integration/health-schema-access.integration.test.ts`

- [ ] **Step 1: Write schema/isolation tests**

Consent version/accept/revoke, same student across tenants, linked/unlinked professional, own-student access, import operator publish denial, manager detail denial, published update/delete rejection and audit without measurement values.

- [ ] **Step 2: Add models**

`HealthConsent`, `ProfessionalStudentLink`, `HealthProtocolVersion`, `BodyAssessment`, `AssessmentRevision`, `BodyMeasurement`, `SegmentalMeasurement` and `HealthMeasurement`. Numeric values use `@db.Decimal(18,6)` strings at boundary. Assessment fields match PRD plus protocol/source/evaluator/version/published/supersedes.

- [ ] **Step 3: Add provenance constraints**

Official measurement requires type, original/canonical value/unit, source, source reference, responsible actor, measuredAt and protocol version. Segment is nullable only when measure is nonsegmental; unknown segments rejected. Unique assessment+measure+segment prevents duplicates.

- [ ] **Step 4: Enforce published immutability**

Migration trigger rejects UPDATE/DELETE of published assessment and child measurements/revisions. Application DB role cannot bypass. Corrections insert new rows only. Consent records are append-only decisions.

- [ ] **Step 5: Implement consent/access guards and commit**

Endpoints grant/revoke/list versioned health consent. Revocation immediately blocks new assessment/import/AI processing but preserves existing records under retention policy. `HealthAccessGuard` evaluates tenant+permission+student ownership/link validity/action and audits allowed sensitive reads separately.

```bash
git add packages/database apps/api/src/modules/health-consents apps/api/src/modules/health-access apps/api/test
git commit -m "feat(health): add consent linkage and immutable schema"
```

### Task 3: Criar e validar rascunhos de avaliação manual

**Files:**
- Create: `apps/api/src/modules/assessments/domain/assessment.ts`
- Create: `apps/api/src/modules/assessments/domain/assessment-errors.ts`
- Create: `apps/api/src/modules/assessments/domain/measurement.ts`
- Create: `apps/api/src/modules/assessments/application/create-draft.use-case.ts`
- Create: `apps/api/src/modules/assessments/application/update-draft.use-case.ts`
- Create: `apps/api/src/modules/assessments/transport/assessments.controller.ts`
- Test: `apps/api/test/integration/assessment-draft.integration.test.ts`

- [ ] **Step 1: Write draft validation tests**

Valid weight/height, derived BMI, optional segmental fields, unknown unit/type, out-of-entry-bound value, missing provenance, absent optional, explicit zero invalid where protocol says, wrong vínculo, revoked consent and optimistic version conflict.

- [ ] **Step 2: Implement typed measurement command**

DTO accepts measure code, original decimal string/unit, optional segment/device/source reference and measuredAt. Service resolves protocol definition, validates entry bounds as data-quality errors, converts exact canonical value and stores both. Client cannot send canonical/BMI value.

- [ ] **Step 3: Implement draft lifecycle**

`POST /students/:id/assessments` creates DRAFT with evaluator/source/protocol. `PATCH /assessments/:id/draft` requires expected version and replaces draft measurement set transactionally after validation. Published assessment returns `ASSESSMENT_IMMUTABLE`.

- [ ] **Step 4: Derive BMI and preserve absence**

After validated weight/height, recalculate BMI row with source IDs. Removing an input removes derived draft BMI; absent segment/measure creates no row. Audit command codes/IDs only, not values.

- [ ] **Step 5: Verify and commit**

Run unit/integration/property tests. Expected: deterministic DB strings and conflicts with no partial child updates.

```bash
git add apps/api/src/modules/assessments apps/api/test packages/contracts/src/health
git commit -m "feat(health): create validated manual assessment drafts"
```

### Task 4: Publicar de forma imutável e corrigir por revisão vinculada

**Files:**
- Create: `apps/api/src/modules/assessments/application/publish-assessment.use-case.ts`
- Create: `apps/api/src/modules/assessments/application/correct-assessment.use-case.ts`
- Test: `apps/api/test/integration/assessment-publication.integration.test.ts`

- [ ] **Step 1: Write publication concurrency tests**

Publish same draft 20 times, concurrent draft edit, consent revoked before lock, invalid protocol hash, missing required protocol fields, direct published PATCH, correction chain and two corrections racing current version.

- [ ] **Step 2: Publish under Serializable transaction**

Lock assessment/student/consent/link, revalidate protocol/current version/all provenance and derived rows, set PUBLISHED once, append audit/outbox `AssessmentPublished`. Identical retry returns same result; changed expected version conflicts. Retry only P2034 up to three.

- [ ] **Step 3: Implement correction creation**

`POST /assessments/:id/corrections` requires `health_assessment.correct`, reason and link. It copies published values/provenance into new DRAFT, sets `supersedesAssessmentId`, new evaluator/time/version and `AssessmentRevision` reason. Original is untouched.

- [ ] **Step 4: Publish correction and resolve current**

Publishing correction appends `AssessmentCorrected`; a query resolves current leaf deterministically. Competing correction based on stale leaf is rejected, not merged silently. All versions remain addressable.

- [ ] **Step 5: Verify and commit**

Direct SQL/application repository mutation after publish must fail. Commit:

```bash
git add apps/api/src/modules/assessments apps/api/test packages/contracts
git commit -m "feat(health): publish assessments with linked corrections"
```

### Task 5: Construir jornada acessível do avaliador

**Files:**
- Create: `apps/admin-web/app/(protected)/health/students/[id]/assessments/page.tsx`
- Create: `apps/admin-web/app/(protected)/health/students/[id]/assessments/new/page.tsx`
- Create: `apps/admin-web/app/(protected)/health/students/[id]/assessments/[assessmentId]/page.tsx`
- Create: `apps/admin-web/app/(protected)/health/students/[id]/assessments/[assessmentId]/correct/page.tsx`
- Create: `apps/admin-web/components/health/measurement-field.tsx`
- Test: `apps/admin-web/tests/e2e/manual-assessment.spec.ts`

- [ ] **Step 1: Write full E2E journey**

Grant consent, link evaluator, create draft, enter weight/height/optional composition, see BMI, publish, attempt edit and create correction. Unlinked professional/import operator denied. Test keyboard, 390 px, zoom 200% and axe.

- [ ] **Step 2: Implement Server Component shell**

Fetch student consent/link/protocol/drafts server-side no-store. Do not expose private storage or unrelated health data. Permission denial and revoked consent show exact next action.

- [ ] **Step 3: Implement protocol-driven form boundary**

Client form displays measure label, original unit, validation-only limits explanation and missing option. It sends decimal strings and expected version. Never prefill absent with zero or let client send canonical/BMI.

- [ ] **Step 4: Implement publish/correction confirmation**

Publish dialog lists provenance/protocol/responsible/time and warns immutability. Correction explains new linked version and requires reason. Preserve non-sensitive draft after recoverable error.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter admin-web test:e2e -- manual-assessment.spec.ts
pnpm --filter admin-web lint && pnpm --filter admin-web typecheck && pnpm --filter admin-web build
git add apps/admin-web
git commit -m "feat(admin): add manual health assessment workflow"
```

### Task 6: Fechar a slice 3.1

**Files:**
- Create: `docs/operations/health/manual-assessment-evidence.md`
- Modify: `docs/prd/academia/MVP-03-health-intelligence.md` only after evidence

- [ ] **Step 1: Run complete gate**

Run root commands, protocol validator, direct DB immutability, tenant/vínculo abuse, consent revocation and 20-way publish. Expected all pass.

- [ ] **Step 2: Record requirement mapping**

Map `M3-FR-001`–`006`, mapped BR/NFR and `M3-AC-001/002/004/009` to commands, tests, manifest hash and professional approval.

- [ ] **Step 3: Commit sanitized evidence**

```bash
git add docs/operations/health/manual-assessment-evidence.md docs/prd/academia/MVP-03-health-intelligence.md packages/contracts/openapi
git commit -m "docs(health): record manual assessment evidence"
```

## Definition of done

- [ ] consent/vínculo guard every health action;
- [ ] quantities/conversions/BMI deterministic without float;
- [ ] every official measure has complete provenance;
- [ ] missing values never become zero;
- [ ] published rows reject update/delete;
- [ ] correction is a linked new version;
- [ ] `M3-AC-001/002/004/009` pass.

## Opções de execução

1. **Subagent-Driven (recomendado):** quantities, schema/access, draft, publication, UI and evidence separated.
2. **Inline:** sequential execution with professional protocol gate before code.

Depois, seguir para `2026-08-14-mvp-03-02-history-comparisons.md`.
