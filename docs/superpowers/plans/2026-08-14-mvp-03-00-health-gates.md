# MVP-03.0 — Gates clínicos, de importação e de IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute this plan task-by-task.

**Goal:** Fixar protocolo, acesso, privacidade, formatos/scanner e provedor/modelo de IA com evidência suficiente para impedir código clínico ou adapters inventados.

**Architecture:** Manifests JSON validados separam regras aprovadas de código. Formatos/equipamentos e IA usam critérios eliminatórios, golden evidence e planos de adapter fixos. Aprovações humanas são gates explícitos; simuladores não liberam processamento real.

**Tech Stack:** Markdown/JSON Schema, documentação oficial de equipamento/OCR/IA, arquivos anonimizados, sandbox, Context7 quando houver SDK e writing-plans para adapters.

---

### Task 1: Aprovar consentimento, retenção e matriz de acesso

**Files:**
- Create: `docs/operations/health/privacy-policy.md`
- Create: `docs/operations/health/access-matrix.md`
- Create: `docs/operations/health/consent-document.md`
- Modify: `.gitignore`

- [ ] **Step 1: Define purposes and data categories**

List assessment/manual/import/attendance/goal/AI/export purposes, required fields, lawful basis owner, retention, deletion/anonymization outcome and who can initiate each processing. Separate operational fitness tracking from medical diagnosis explicitly.

- [ ] **Step 2: Version the consent text**

Consent states purpose, categories, optional AI processing/provedor class, revocation effect, retained legal records, export/contact channel and nonmedical scope. Assign immutable version/content SHA-256/effective date; AI consent is separately checkable.

- [ ] **Step 3: Build action-level access matrix**

Rows cover draft/read/publish/correct/import/review/goal/AI/export/aggregate; columns Owner student, linked evaluator, linked personal, unlinked professional, import operator, manager, Super Admin. Each cell is ALLOW/DENY plus required vínculo/consent/audit/step-up.

- [ ] **Step 4: Protect evidence**

Ignore real health files, exports, OCR/AI payloads and private approvals under `docs/operations/health/private/` and `.env.health*`. Commit only synthetic/anonimized golden files and sanitized hashes.

- [ ] **Step 5: Approve and commit**

Privacy/Legal, qualified professional, Product and Technical sign. Missing signature blocks `M3-CLINICAL-01`.

```bash
git add .gitignore docs/operations/health/privacy-policy.md docs/operations/health/access-matrix.md docs/operations/health/consent-document.md
git commit -m "docs(health): approve privacy and access boundaries"
```

### Task 2: Criar o manifesto versionado do protocolo de saúde

**Files:**
- Create: `docs/operations/health/health-protocol.schema.json`
- Create: `docs/operations/health/health-protocol.json`
- Create: `docs/adr/0006-health-quantities-and-protocol.md`

- [ ] **Step 1: Define a strict JSON Schema**

Require protocol code/version/effective date/approver, measurement code/label/kind, original allowed units, canonical unit, rational conversion numerator/denominator, storage scale 6, input validation bounds, display scale, derivation inputs/formula code, segmented flag and goal direction. `additionalProperties:false` throughout.

- [ ] **Step 2: Enter only professionally approved measures**

At minimum the PRD-required types are entered only with signed definitions: weight, height, BMI, supported body-composition fields and approved segmental/additional measurements. Validation bounds detect data-entry error; they are not diagnostic ranges and UI must not label healthy/unhealthy.

- [ ] **Step 3: Freeze conversion and rounding policy**

Factors are rational integers; canonical decimal uses scale 6; calculations do not round intermediate values; presentation uses nonnegative half-up at the protocol display scale. BMI formula references weight kg and height m IDs and returns value only when both valid/nonzero.

- [ ] **Step 4: Validate manifest and golden vectors**

Create vectors for every conversion, exact boundary, absent value, height zero rejection and BMI. A small validation script is planned in Slice 3.1 and must compare manifest SHA-256 at startup/migration.

- [ ] **Step 5: Approve and commit**

```bash
git add docs/operations/health/health-protocol.schema.json docs/operations/health/health-protocol.json docs/adr/0006-health-quantities-and-protocol.md
git commit -m "docs(health): define versioned assessment protocol"
```

### Task 3: Inventariar formatos de importação e controles antimalware

**Files:**
- Create: `docs/operations/health/import-inventory.md`
- Create: `docs/operations/health/import-capabilities.schema.json`
- Create: `docs/operations/health/import-capabilities.json`
- Create: `docs/operations/health/import-golden/README.md`

- [ ] **Step 1: Inventory exact sources**

Record manufacturer/equipment/model/firmware/export software/version, format, delimiter/encoding, field/unit mapping, sample availability, licensing and direct-vs-file path. `CSV_CANONICAL_V1` is the only ArenaHub-owned format; all vendor formats start unproven.

- [ ] **Step 2: Define eliminatory import checks**

Require stable version identification, anonymized golden file, documented field/unit mapping, missing-field semantics, malformed-file behavior, checksum, repeatable export and qualified-professional review. Unsupported/proprietary encrypted format is rejected, not reverse-engineered silently.

- [ ] **Step 3: Homologate malware scanner path**

Record engine/version/signature update, supported stream/size, timeout, fail-closed behavior, quarantine, health check, false-positive escalation and private network. Test clean EICAR-safe procedure per security policy, malicious fixture, scanner offline and signature stale without committing malware.

- [ ] **Step 4: Create strict capability manifest**

For each format set code/version/MIME/magic/size/parser kind/measurement mappings/provenance/golden hashes and evidence. Only reviewed formats get `status:HOMOLOGATED`; unknown version remains unsupported.

- [ ] **Step 5: Decide adapter requirement**

If only `CSV_CANONICAL_V1`, Slice 3.3 parser suffices. Any vendor CSV/PDF/image/OCR creates fixed plan `docs/superpowers/plans/2026-08-14-mvp-03-import-adapter.md` naming exact parser/OCR endpoints, layouts, units and golden files before real implementation.

### Task 4: Avaliar privacidade e capacidades do provider/modelo de IA

**Files:**
- Create: `docs/operations/health/ai-provider-scorecard.md`
- Create: `docs/operations/health/ai-capabilities.schema.json`
- Create: `docs/operations/health/ai-capabilities.json`
- Create: `docs/adr/0007-health-ai-provider.md`

- [ ] **Step 1: Apply privacy eliminators**

Reject provider/model without acceptable no-training contract, retention/deletion terms, region/subprocessors, encryption, incident process, DPA and ability to avoid direct identifiers. Commercial page alone is insufficient.

- [ ] **Step 2: Apply technical eliminators**

Require versionable model identifier, structured JSON/schema mode or enforceable equivalent, timeout/cancellation, usage/cost metadata, stable auth/idempotency semantics, rate limits and sandbox/test route. Record official documentation date/version.

- [ ] **Step 3: Run synthetic evaluation set**

Use only synthetic snapshots covering progress, stability, missing metrics, conflicting goals, zero baseline, prompt-injection-like strings and explicit requests for diagnosis/prescription. Score schema validity, invented values, unsupported metric, diagnostic language, latency and cost.

- [ ] **Step 4: Create approved manifest and ADR**

Manifest fixes provider/model, API/SDK version, region, retention, timeout, token/output/cost budgets, concurrency, circuit threshold, structured schema and evidence hashes. ADR records rejected alternatives, risks and why no training/proprietary model is used.

- [ ] **Step 5: Obtain approvals**

Privacy/Legal, qualified professional, Product and Technical sign. Missing approval or any diagnostic/grounding critical failure blocks `M3-AI-01`.

### Task 5: Gerar planos exatos dos adapters de importação e IA

**Files:**
- Create when vendor import is selected: `docs/superpowers/plans/2026-08-14-mvp-03-import-adapter.md`
- Create when AI is selected: `docs/superpowers/plans/2026-08-14-mvp-03-ai-provider-adapter.md`

- [ ] **Step 1: Resolve current official documentation**

Use Context7 for available SDKs; otherwise versioned official vendor references only. Record exact version/release date/endpoints/symbols and sandbox differences.

- [ ] **Step 2: Map import adapter exactly**

Name input signatures, layout/encoding/locale, every field/unit conversion, confidence/location metadata, error codes, version detection and golden expected output. Unknown mapping is a rejected field/format, not inferred.

- [ ] **Step 3: Map AI adapter exactly**

Name client/package/API, structured-output call, model ID, timeout/cancel, usage/cost fields, error/rate-limit mapping, no-log/redaction, retry/circuit rules and response schema. Include sanitized contract fixtures.

- [ ] **Step 4: Write TDD/contract/sandbox tasks**

Each fixed plan uses exact paths under `apps/api/src/modules/assessment-imports/adapters/homologated/` or `apps/api/src/modules/health-ai/adapters/homologated/`, shares unchanged port tests and includes failure/retention/privacy evidence.

- [ ] **Step 5: Validate gates**

`M3-IMPORT-01` or `M3-AI-01` passes only with approved manifests, golden/synthetic suite and corresponding adapter plan without variable paths/placeholders. Record plan hashes in this gate evidence.

## Definition of done

- [ ] consent/retention/access matrix approved;
- [ ] protocol manifest validates and has professional signature;
- [ ] every real format is homologated with golden files;
- [ ] malware scanner failure is fail-closed;
- [ ] AI privacy and synthetic antidiagnosis suite pass;
- [ ] fixed adapter plans name real symbols/versions;
- [ ] no real health data, credential or private contract is committed.

## Opções de execução

1. **Subagent-Driven (recomendado):** privacy/access, protocol, imports and AI evaluation separated; approvals remain human.
2. **Inline:** execute sequentially and stop whenever evidence/approval is missing.

This plan does not authorize clinical definitions or provider contracts without their named approvers.
