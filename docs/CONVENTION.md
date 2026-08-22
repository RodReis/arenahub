# CONVENTION.md — contrato de domínio do ArenaHub

> **O que é este documento.** O coração do produto: entidades, estados, invariantes e
> vocabulário. É o lugar onde se responde "o que é o certo?" sem abrir uma spec.
>
> **Precedência (ADR-018):** `ADR aceito > PRD > este documento > Especificação Completa`.
>
> **Como citar.** Invariantes têm ID estável `INV-nnn`. Issue de correção `[FIX]` **cita o
> INV** que o código violou — é isso que distingue bug de fatia disfarçada.
>
> **Estado:** nada aqui está implementado. Campos marcados **`[indefinido]`** não existem em
> documento nenhum e **não podem ser inventados pelo Code** — viram pergunta ao PI.

---

## 1. Vocabulário

Domínio e identificadores **em inglês**; textos de interface **em pt-BR**.

| inglês (código) | português (UI) | inglês (código) | português (UI) |
|---|---|---|---|
| `Tenant` | contratante / academia | `Device` | dispositivo |
| `GymUnit` | unidade | `TURNSTILE` | catraca |
| `Student` | aluno | `FACE_READER` | leitor facial |
| `enrollment` (código) | matrícula | `kiosk` | totem |
| `Lead` | lead | `edge-agent` | agente local / gateway |
| `Role` / `Permission` | perfil / permissão | `external_user_id` | identificador no leitor |
| `Plan` | plano | `BiometricIdentity` | cadastro facial |
| `billing_cycle` | ciclo de cobrança | `AccessEvent` | evento de acesso |
| `Subscription` | assinatura | `Passage` | passagem / giro |
| **`Entitlement`** | **direito de acesso** | `override` | liberação manual |
| `Invoice` | cobrança / mensalidade | `BodyAssessment` | avaliação física |
| `Payment` | pagamento | `segmental measurements` | medidas segmentares |
| `Refund` | estorno | `HealthMeasurement` | medida de saúde |
| `Discount` / `Coupon` | desconto / cupom | `attendance` | frequência |
| `grace_period` | carência | `Goal` | meta |
| `overdue` / `delinquency` | vencido / inadimplência | `Streak` / `XP` | streak / XP (mantidos) |
| `blocking_policy` | política de bloqueio | `Achievement` / `Challenge` | conquista / desafio |
| `Receipt` | recibo (não fiscal) | `churn risk` | risco de cancelamento |
| `Consent` | consentimento | `membership card` | carteirinha |
| `AuditLog` | auditoria | `snapshot` | snapshot (mantido) |

**Termos que não se traduzem em código, nunca:** `Entitlement` não é "assinatura",
`Passage` não é "acesso", `AccessEvent` não é "frequência".

---

## 2. Entidades

Legenda de `tenant_id`: **✔** declarado · **~** coberto só pela regra geral (INV-001) e
**precisa ser adicionado** · **n/a** é o próprio tenant ou é interface.

### 2.1 Core

| entidade | campos declarados | `tenant_id` | origem |
|---|---|---|---|
| `Tenant` | razão social, nome fantasia, CNPJ, endereço, telefone, e-mail, responsável, timezone, logo, identidade visual, status, plano SaaS | n/a | Especificação §9 |
| `GymUnit` | `id`, `tenant_id`, `name`, `code`, `address`, `phone`, `timezone`, `status`, `capacity`, `opening_hours` | ✔ | Especificação §10 |
| `User` | **`[indefinido]`** | ~ | Especificação §8 |
| `Role`, `Permission` | **`[indefinido]`**. Permissões citadas: `student.create/update/delete`, `payment.read/refund`, `device.configure`, `assessment.create`, `access.override` | ~ | Especificação §8 |
| `Session` | **`[indefinido]`** | ~ | `M1` §11 |
| `AuditLog` | `user`, `action`, `entity`, `entity_id`, `before`, `after`, `ip`, `device`, `timestamp` | ~ | Especificação §72 |
| `OutboxEvent` | envelope: `eventId`, `eventType`, `occurredAt`, `tenantId`, `aggregateId`, `schemaVersion` | ✔ | README §6.3 |
| `InboxReceipt` | **`[indefinido]`** — registra a chave idempotente antes do efeito (INV-084) | ~ | `M1` §11 |

### 2.2 Aluno

| entidade | campos declarados | `tenant_id` | origem |
|---|---|---|---|
| `Student` | nome, CPF, RG, data de nascimento, sexo cadastral, telefone, WhatsApp, e-mail, foto, endereço, CEP, cidade, estado, matrícula, unidade, data de cadastro, origem do lead, consultor, status | ~ **(obrigatório — matrícula é única por tenant)** | Especificação §11 |
| `StudentContact` | nome, parentesco, telefone | ~ | Especificação §11 |
| `StudentAddress` | **`[indefinido]`** — endereço aparece embutido em `Student` | ~ | `M1` §11 |
| `Consent` | `student_id`, `type`, `document_version`, `accepted_at`, `revoked_at`, `ip`, `device`. Tipos: `TERMS`, `PRIVACY`, `BIOMETRIC`, `HEALTH_DATA`, `MARKETING`, `RANKING`. **ADR-008 acrescenta consentimento por responsável legal** para menor de 18 — modelagem é escopo obrigatório de F8 | ~ | Especificação §75 + **ADR-008** |
| `BiometricIdentity` | `id`, `tenant_id`, `student_id`, `type` (`FACE`\|`FINGERPRINT`\|`OTHER`), `status`, `external_enroll_id`, `consent_status`, `consent_version`, `consented_at`, `revoked_at` | ✔ | Especificação §13 |

> **Conflito conhecido.** `BiometricIdentity.external_enroll_id` é único e **não tem
> `device_id`** — mas o `enrollid` do Topdata é **por dispositivo** (Especificação §14/§16). Dois
> leitores na mesma unidade não cabem no modelo. **Resolução:** o identificador por dispositivo
> vive em `DeviceUser.external_user_id`; `external_enroll_id` em `BiometricIdentity` é
> redundante e deve ser removido na modelagem de F8.

### 2.3 Comercial e financeiro

| entidade | campos declarados | `tenant_id` | origem |
|---|---|---|---|
| `Plan` | `id`, `tenant_id`, `name`, `description`, `billing_cycle`, `duration`, `price`, `currency`, `status` | ✔ | Especificação §32 |
| `Subscription` | `id`, `student_id`, `plan_id`, `status`, `started_at`, `current_period_start`, `current_period_end`, `next_billing_date`, `cancelled_at`, `paused_at`, `provider` | ~ | Especificação §35 |
| `Entitlement` | **sem lista de campos** na origem. Exemplo mostra: student, tipo (`GYM_ACCESS`), starts, expires, status. **ADR-009 acrescenta `source`**, enum extensível: `SUBSCRIPTION`, `COURTESY`, `STAFF`, `TRAINER`, `VISITOR`, `TRIAL`, `DEPENDENT`, `CORPORATE` | ~ | Especificação §19 + **ADR-009** |
| `Invoice` | `id`, `subscription_id`, `amount`, `due_date`, `status`, `paid_at`, `payment_method`, + itens, subtotal, desconto, total, numeração, `billing_period` | ~ **(unicidade `(tenant_id, subscription_id, billing_period)`)** | Especificação §37, `M2` §11 |
| `InvoiceItem` | **`[indefinido]`** | ~ | `M2` §11 |
| `Payment` | **`[indefinido]` — nenhum campo em documento algum** | ~ | **ADR-027** |
| `PaymentAttempt` | **`[indefinido]`** | ~ | `M2` §11 + **ADR-027** |
| `PaymentMethod` | somente token / referência mascarada | ~ | `M2` §11 |
| `ProviderEvent` | `provider_account_id`, `external_event_id`, payload protegido | ~ | `M2` §11 |
| `Refund` | `id`, `tenant_id`, `payment_id`, `invoice_id`, `amount_minor`, `currency`, `status`, `reason`, `requested_by_user_id`, `applied_access_policy`, `idempotency_key`, `external_refund_id`, `failure_code`, `requested_at`, `settled_at` — **F16** | ✔ | `M2` §11 + **F16** |
| `Receipt` | `id`, `tenant_id`, `payment_id` (único), `invoice_id`, `number`, `snapshot`, `verification_hash`, `issued_at` — **F16**. Numeração por `ReceiptSequence`, gêmea de `InvoiceSequence` | ✔ | `M2` §11 + **F16** |
| `ReconciliationRun` | `id`, `tenant_id`, `provider_account_id`, `period_start`, `period_end`, `status`, `movements_imported`, `items_open`, `failure_code`, `started_at`, `finished_at` — **F16** | ✔ | `M2` §11 + **F16** |
| `ExternalMovement` | `id`, `tenant_id`, `run_id`, `external_movement_id`, `external_payment_id`, `external_account_id`, `kind`, `amount_minor`, `currency`, `occurred_at` — **F16**, ampliação do §11 emendada no PRD | ✔ | **F16** |
| `ReconciliationItem` | `id`, `tenant_id`, `run_id`, `status`, `payment_id`, `refund_id`, `external_movement_id`, `internal_amount_minor`, `external_amount_minor`, `recommended_action`, `resolution`, `resolution_reason`, `resolved_by_user_id`, `resolved_at` — **F16** | ✔ | `M2` §11 + **F16** |
| `BillingSettings` | moeda (BRL), `due_date`, `grace_period`, `blocking_policy` + **âncora de bloqueio configurável** (ADR-019), padrão = primeiro instante de `due_date + grace_period` | ✔ por tenant | Especificação §42 + **ADR-019** |

`PaymentProvider` é **porta, não entidade**. Contrato vigente (`MVP-02` §12, vence sobre a Especificação §38): `createPix`, `getPaymentStatus`, `createTokenizedSubscription`, `cancelSubscription`,
`refundPayment`, `verifyAndParseWebhook` — mais **`listMovements`** (extrato por janela fechada) e
**`getRefundStatus`** (consulta ativa do estorno) — sétimo e oitavo métodos acrescentados pela
**F16**, com emenda ao `MVP-02` §12 no mesmo PR. Ver ADR-013 e ADR-032.

### 2.4 Dispositivos e acesso

| entidade | campos declarados | `tenant_id` | origem |
|---|---|---|---|
| `Device` | `id`, `tenant_id`, `gym_unit_id`, `type`, `manufacturer`, `model`, `serial_number`, `ip_address`, `port`, `firmware`, `status`, `last_heartbeat`, `last_sync`, `configuration`. Tipos: `TURNSTILE`, `FACE_READER`, `TOTEM`, `CARD_READER`, `QR_READER` | ✔ | Especificação §28 |
| `DeviceUser` | `id`, `device_id`, `student_id`, `external_user_id`, `sync_status`, `last_sync_at`, `last_error`, `retry_count` | ~ | Especificação §17 |
| `DeviceSyncJob` | **`[indefinido]`** — só estados | ~ | Especificação §16 |
| `Edge` | `device_id`, certificado/segredo | ~ | Especificação §89 |
| `AccessEvent` | `id`, `tenant_id`, `gym_unit_id`, `student_id`, `device_id`, `occurred_at`, `direction` (`ENTRY`\|`EXIT`), `method` (`FACE`\|`CARD`\|`QR`\|`PIN`\|`MANUAL`), `outcome` (`ALLOW`\|`DENY`), `reason`, `offline`, `external_event_id` | ✔ | Especificação §31 + **ADR-005** |
| `AccessPolicy` | **`[indefinido]`**. Precisa carregar versão (`M1-FR-021`) | ~ | `M1` §11 |
| `ManualAccessOverride` | `operator_id`, `student_id`, `device_id`, `reason`, `timestamp`. Razões: `FACIAL_FAILURE`, `VISITOR`, `TECHNICAL_SUPPORT`, `MANAGER_OVERRIDE` | ~ | Especificação §30 |
| `Passage` | **`[indefinido]` — tem estados, não tem tabela** | ~ | `M1` §10 |
| `AccessSnapshot` | integridade, tenant, unidade, versão, expiração; assinado | ✔ por unidade | `M1-FR-025/026` |

`AccessDecision` é **valor de retorno**, não tabela:
`{ outcome, studentId, reason, validUntil, policyVersion }` (ADR-005).

### 2.5 Saúde

| entidade | campos declarados | `tenant_id` | origem |
|---|---|---|---|
| `BodyAssessment` | **metadados** (`M3` §10): `id`, `tenant_id`, `student_id`, `status`, `assessed_at`, `published_at`, `source`, `source_reference`, `evaluator_user_id`, `supersedes_assessment_id`, `device_report` (JSON, ver INV-151). **medidas** (Especificação §47, ampliadas em 21/08 — ADR-038): 34 tipos em `BodyMeasurement.type`, não mais colunas soltas — lista dos 19 novos logo abaixo. `source`: `MANUAL`\|`DEVICE`\|`IMPORT`\|`IMAGE_AI`\|`API` | ✔ | Especificação §47/§49, `M3` §10, ADR-038 |
| `SegmentalMeasurement` | **superada por ADR-038**: os 10 tipos segmentares (braço/perna esquerdo-direito, tronco; massa gorda e muscular) entraram no enum `BodyMeasurement.type`, não numa tabela própria — mesma razão do item acima | ~ | ADR-038 |
| `HealthMeasurement` | `student_id`, `measurement_type`, `value`, `unit`, `measured_at`, `source`, `device`. Tipos: `HEART_RATE`, `RESTING_HEART_RATE`, `BLOOD_PRESSURE`, `OXYGEN_SATURATION` | ~ | Especificação §53 |
| `HealthGoal` | baseline, alvo, unidade, prazo, responsável | ~ | `M3-FR-012` |
| `AssessmentImport`, `ImportedField` | confiança e localização de origem por campo. Desde ADR-038, **N importações apontam para 1 avaliação** (`assessmentId` deixou de ser `@unique`) via `reviewSessionId` compartilhado — ver §4.19 | ~ | `M3-FR-010`, ADR-038 |
| `AIAnalysis` | `id`, `student_id`, `type`, `source_period`, `model`, `prompt_version`, `input_snapshot`, `output`, `created_at`, + custo e latência | ~ | Especificação §54/§56 |

> **Unificação obrigatória.** `assessment_date` (Especificação §47) e `assessed_at` (`M3` §10) são o
> mesmo campo. Vence **`assessed_at`**.

> **Os 19 tipos que a ADR-038 acrescentou a `BodyMeasurement.type`** (o enum tinha 15; passou a 34
> — fonte: `medida.ts`):
> - **10 segmentares** (alimentam o boneco do aluno por região — braço esq./dir., perna esq./dir.,
>   tronco; massa gorda e massa muscular de cada um): `SEGMENTAL_FAT_MASS_ARM_LEFT`,
>   `SEGMENTAL_FAT_MASS_ARM_RIGHT`, `SEGMENTAL_FAT_MASS_TRUNK`, `SEGMENTAL_FAT_MASS_LEG_LEFT`,
>   `SEGMENTAL_FAT_MASS_LEG_RIGHT`, `SEGMENTAL_MUSCLE_MASS_ARM_LEFT`,
>   `SEGMENTAL_MUSCLE_MASS_ARM_RIGHT`, `SEGMENTAL_MUSCLE_MASS_TRUNK`,
>   `SEGMENTAL_MUSCLE_MASS_LEG_LEFT`, `SEGMENTAL_MUSCLE_MASS_LEG_RIGHT`.
> - **8 de composição** que os laudos já traziam e o enum não guardava: `BONE_MASS`,
>   `BODY_CELL_MASS`, `SUBCUTANEOUS_FAT_MASS`, `SUBCUTANEOUS_FAT_PERCENT`,
>   `SKELETAL_MUSCLE_PERCENT`, `MUSCLE_MASS`, `PROTEIN_PERCENT`, `WAIST_HIP_RATIO`.
> - **1 cardíaco:** `HEART_RATE` — nunca interpretado (ADR-035, INV-152).

### 2.6 Engajamento e retenção

Definidas nos PRDs dos MVPs 4 a 6, **não** na Especificação (que só dá exemplos de valores).
Não são contrato vigente até a fatia correspondente: `xp_rules`, `xp_ledger`,
`streak_policies`, `student_streaks`, `achievement_definitions`, `student_achievements`,
`challenge_templates`, `challenges`, `challenge_participants`, `ranking_definitions`,
`ranking_snapshots`, `ranking_entries`, `notification_preferences`, `notifications`,
`notification_deliveries`, `retention_scores`, `score_explanations`,
`retention_rule_versions`, `student_feature_snapshots`, `retention_tasks`,
`retention_interactions`, `retention_suppressions`, `student_accounts`, `student_sessions`,
`rotating_qr_tokens`, `kiosk_sessions`.

---

## 3. Máquinas de estado

**Regra transversal:** transição inválida retorna **erro de domínio** e **não produz efeito
parcial** (`M1` §10). Toda máquina é implementada como máquina testada (`M2` §10).

### 3.1 `Student`
`LEAD | TRIAL | ACTIVE | SUSPENDED | BLOCKED | CANCELLED | ARCHIVED`
**Transições: `[indefinido]` em todos os documentos.** Só se sabe que `BLOCKED`, `CANCELLED` e
`ARCHIVED` não recebem acesso normal, e que exclusão administrativa vira arquivamento quando
há histórico. Definir na spec de F7.

### 3.2 `Subscription`
`PENDING | ACTIVE | PAST_DUE | PAUSED | CANCELLED | EXPIRED`
No MVP 1 (sem cobrança automática) `PAST_DUE` não é alcançável.
Transições declaradas: `Invoice PAID → ACTIVE`; `invoice vencida + carência → PAST_DUE`; pausar
/ retomar / cancelar manualmente com auditoria.
**`[indefinido]`:** o que entra e sai de `PENDING`; gatilho de `EXPIRED`; destino de "retomar".

### 3.3 `Entitlement`
`SCHEDULED | ACTIVE | SUSPENDED | REVOKED | EXPIRED`
Transições declaradas: `Subscription ACTIVE → ACTIVE`; inadimplência → suspende; compensação →
restaura + sync imediato ao Edge.
**Conflito a resolver na spec de F15:** a Especificação §95 diz "revoked" e o `M2-FR-015` diz
"suspender" **para o mesmo fluxo**. `SUSPENDED` é reversível por compensação; `REVOKED` é
terminal. Inadimplência usa **`SUSPENDED`**.

### 3.4 `Invoice`
`DRAFT | OPEN | PAID | OVERDUE | CANCELLED | REFUNDED`
`OPEN → OVERDUE` por job idempotente; `→ PAID` por confirmação do provedor.
**`PAID` nunca volta a `OPEN`** (INV-069).

**Fechado na F12** (18/08/2026), decisão do Code registrada no PR — ambos reversíveis, então não
viraram ADR:

- **`DRAFT → OPEN`** acontece quando a invoice tem **ao menos um item e um vencimento**. Invoice
  sem item não tem o que cobrar, e abrir uma vazia produziria cobrança de zero que ninguém sabe
  interpretar.
- **`CANCELLED`** só a partir de `DRAFT` ou `OPEN`. Invoice **paga** que precisa voltar atrás é
  **estorno**, com estado próprio: cancelar uma paga apagaria o fato de que o dinheiro entrou
  (INV-069, INV-073).

### 3.5 `Payment` / `PaymentAttempt`
`Payment`: `PENDING | CONFIRMED | FAILED | CANCELLED | REFUND_PENDING | REFUNDED`
`PaymentAttempt`: `CREATED | REQUIRES_ACTION | PROCESSING | SUCCEEDED | FAILED`

**Fechado pelo ADR-027 e implementado na F12** (18/08/2026). São dois
grafos de entidades diferentes, não duas versões do mesmo: a tentativa responde *o que eu tentei*,
o pagamento responde *que dinheiro foi reconhecido*. `CONFIRMED` não volta atrás — é o par de
INV-069 do lado do pagamento. Invoice paga em duas tentativas (PIX falho + cartão) tem **duas**
linhas em `payment_attempts` e **uma** em `payments`; a falha continua no histórico. A **autorização revogada pelo pagador**
(Pix Automático) é estado do *mandato*: vive no `PaymentMethod`, não no `Payment` — ver ADR-027.

### 3.5.1 `Refund` / `ReconciliationItem`

`Refund`: `REQUESTED | PROCESSING | CONFIRMED | FAILED`
`ReconciliationItem`: `MATCHED | MISSING_INTERNAL | MISSING_EXTERNAL | AMOUNT_MISMATCH | RESOLVED`

**Definidos pela F16** (19/08/2026) — eram `[indefinido]`. O grafo do estorno é próprio, e não uma
extensão do `Payment`: `REQUESTED` existe porque a chave de idempotência precisa estar **gravada
antes** do efeito externo (INV-084), e sem esse estado uma falha de rede depois da chamada deixaria
dinheiro estornado sem registro nosso. `CONFIRMED` e `FAILED` são **terminais**: confirmação
atrasada do provedor não reescreve resultado já aplicado (INV-079).

Os cinco estados do item vêm do `MVP-02` §10, literais. `RESOLVED` é de mão única — desfazer
resolução apagaria a decisão de alguém.

**Estorno parcial não move a invoice:** ela só vira `REFUNDED` quando a soma dos estornos
confirmados fecha o pagamento. Dizer `REFUNDED` sobre invoice que reteve 60% mentiria para a
conciliação, que soma pelos estados.

### 3.6 `Device`
`PROVISIONING | ONLINE | DEGRADED | OFFLINE | RETIRED`
**Transições `[indefinido]`.** Não há limiar de heartbeat definido nem critério de `DEGRADED`.
Sinais disponíveis: `last_heartbeat`, eventos `DeviceOnline`/`DeviceOffline`, alerta de
"offline há 5 minutos".

### 3.7 `DeviceSyncJob`
`PENDING | PROCESSING | SYNCED | FAILED | RETRYING | REMOVED`
**`[indefinido]`:** número de tentativas, base do backoff, quando vai para DLQ, e o que
`REMOVED` significa (remoção no leitor × descarte do job). Definir na spec de F8.

### 3.8 `BiometricIdentity`
`PENDING_CONSENT | ACTIVE | REVOKED | DELETION_PENDING | DELETED`
`REVOKED` = bloqueio lógico imediato (INV-018). `DELETED` = removido dos leitores com
evidência.
**Atenção:** a Especificação §13 tem `status` **e** `consent_status`. Manter os dois é convite a
divergirem. **Resolução:** `status` é derivado; a fonte é `Consent` + confirmação de exclusão.

### 3.9 `Passage`
`NOT_APPLICABLE | PENDING | CONFIRMED | TIMED_OUT`
**`[indefinido]`:** onde persiste e qual timeout produz `TIMED_OUT`. Isso importa: frequência,
streak e ranking dependem de `CONFIRMED` (INV-114).

### 3.10 `BodyAssessment`
Estados citados em prosa, **nomes nunca enumerados**: rascunho → publicada.
Publicada é **imutável**; correção cria nova versão vinculada por `supersedes_assessment_id`.
Desde ADR-038, uma avaliação nascida de importação pode ter **N `AssessmentImport`** apontando
para ela (§4.19) — a imutabilidade e a correção não mudam: o vínculo N:1 é só a origem do dado.

### 3.11 `Consent`
Sem enumeração — estado derivado de `accepted_at` / `revoked_at`.

---

## 4. Invariantes

Regras verificáveis. **Cada uma deve ter teste.** Citadas por ID em issue `[FIX]`.

### 4.1 Multi-tenant e identidade (INV-001 a INV-008)

- **INV-001** Toda entidade de negócio aplicável tem `tenant_id`; quando física, também `gym_unit_id`.
- **INV-002** O tenant vem da identidade autenticada — nunca do corpo da requisição.
- **INV-003** Repositório recebe `TenantContext` obrigatório.
- **INV-004** Unicidade é dentro do tenant quando o dado não é global.
- **INV-005** Super Admin opera por contexto elevado auditado, com justificativa e expiração — nunca bypass silencioso.
- **INV-006** Tenant A não lê, altera nem sincroniza dado de tenant B. Todo caso de uso crítico tem teste que tenta e falha.
- **INV-007** MFA obrigatório para Proprietário, Super Admin e Operador técnico em produção.
- **INV-008** Login, falha de login, troca de função e elevação de suporte são auditados.

### 4.2 Aluno e matrícula (INV-009 a INV-015)

- **INV-009** Todo aluno tem matrícula; a matrícula **nunca** depende do CPF.
- **INV-010** A matrícula é única e imutável dentro do tenant.
- **INV-011** CPF ajuda a detectar duplicidade, mas não é matrícula.
- **INV-012** **CPF nunca é identificador técnico de dispositivo.**
- **INV-013** Exclusão administrativa vira arquivamento quando há histórico legal ou operacional; arquivar preserva histórico e bloqueia novos acessos.
- **INV-014** Cadastro detecta possível duplicidade dentro do tenant.
- **INV-015** Soft delete não libera unicidade sem regra explícita.

### 4.3 Biometria e consentimento (INV-016 a INV-022)

- **INV-016** Identidade biométrica é entidade separada do cadastro administrativo.
- **INV-017** Ausência de consentimento impede o cadastro biométrico, **não** a matrícula.
- **INV-018** Revogação produz **bloqueio lógico imediato**, mesmo com exclusão física pendente.
- **INV-019** Revogar dispara, nesta ordem: desativar `BiometricIdentity` → `DeviceSyncJob DELETE` → remover dos leitores → auditar.
- **INV-020** Não armazenar template bruto quando o dispositivo não exigir.
- **INV-021** Consentimento é versionado e revogável, com versão, finalidade, ator, IP e dispositivo.
- **INV-022** Template biométrico, token e cartão **nunca** aparecem em log.
- **INV-022b** *(ADR-008)* **Existe caminho de acesso alternativo funcional para quem recusa a biometria.** Recusar não pode negar acesso.

### 4.4 Sincronização com dispositivos (INV-023 a INV-028)

- **INV-023** O protocolo facial não tem operação em lote — a arquitetura exige fila individual.
- **INV-024** Uma operação de sync por usuário **e** por dispositivo.
- **INV-025** `external_user_id` é único **por dispositivo**.
- **INV-026** O mapeamento é `Student.id → DeviceUser → enrollid`.
- **INV-027** A identidade só está entregue quando chegou a **todos** os dispositivos-alvo.
- **INV-028** Heartbeat, firmware, status e última sincronização são registrados para dispositivo e Edge.

### 4.5 Motor de decisão de acesso (INV-029 a INV-038)

- **INV-029** **O acesso não depende de pagamento.** A cadeia é `Pagamento → Invoice → Subscription → Entitlement → Access Engine`.
- **INV-030** **A assinatura não é consultada na catraca.**
- **INV-031** O motor devolve `ALLOW`/`DENY` + razão estável + validade + versão da política.
- **INV-032** Regras implementadas no MVP 1: entitlement, status do aluno, unidade, janela de horário, bloqueio administrativo. As demais da Especificação §20 (limite de acessos, antifraude, acesso duplicado, regra especial) **não têm campo nem fonte de configuração** — `[indefinido]`, não implementar por conta própria.
- **INV-033** Aluno `BLOCKED`, `CANCELLED` ou `ARCHIVED` não recebe acesso normal.
- **INV-034** Regras sobrepostas: **a mais restritiva prevalece**.
- **INV-035** **Entitlement expirado nunca retorna `ALLOW`.** *(propriedade de teste obrigatória)*
- **INV-036** A identidade externa resolve para o aluno dentro do tenant e da unidade corretos.
- **INV-037** Reconhecimento, decisão, comando e passagem são correlacionáveis.
- **INV-038** Razões de decisão vêm de lista fechada e estável (lista canônica ainda em fechamento — `DESIGN-UI.md` §17 item 2).

### 4.6 Liberação manual (INV-039 a INV-042)

- **INV-039** Override exige permissão, alvo, dispositivo e **motivo obrigatório**.
- **INV-040** **Override nunca altera silenciosamente assinatura ou entitlement.**
- **INV-041** Todo override aparece na auditoria.
- **INV-042** Ordem de fallback: facial → QR → cartão → PIN → liberação pela recepção.

### 4.7 Eventos de acesso (INV-043 a INV-048)

- **INV-043** **Evento de passagem é imutável.** Correção é registro novo vinculado.
- **INV-044** Toda decisão física gera `AccessEvent` correlacionável (meta 100%).
- **INV-045** `idempotency_key` é única por origem; um processamento lógico por `event_id` e consumidor.
- **INV-046** Índice por `(tenant_id, gym_unit_id, occurred_at)`.
- **INV-047** Evento local é persistido **antes** de confirmar o efeito físico.
- **INV-048** Backlog é reconciliado com idempotência **mantendo o horário original**.

### 4.8 Offline (INV-049 a INV-058) — **vigente a partir do MVP 1.5**

> **ADR-012 tirou a operação offline do MVP 1.** Até o MVP 1.5 existir, vale a INV-145: a nuvem
> decide, e queda de link ou Edge ausente caem em liberação manual registrada — nunca em allow
> local. Este bloco descreve o alvo, não o comportamento do MVP 1.

- **INV-049** A academia não para se a internet cair; o Edge mantém snapshot local.
- **INV-050** Online: `Gateway → Cloud → Engine`. Offline: `Gateway → cache local`. Retorno: `eventos locais → sincronização → nuvem`.
- **INV-051** Política offline é por academia: `offline_access_enabled`, `offline_cache_validity`, `offline_grace_period`.
- **INV-052** Decidir offline **apenas** dentro da validade e carência aprovadas.
- **INV-053** **Dado offline vencido resulta em negação ou fallback operacional explícito — nunca em allow ilimitado.**
- **INV-054** Snapshot tem integridade, tenant, unidade, versão e expiração validados; expirado não é aceito.
- **INV-055** Snapshot é assinado ou autenticado.
- **INV-056** Modo degradado e idade do cache ficam **visíveis para a operação**.
- **INV-057** A nuvem é fonte de verdade; o SQLite do Edge é operacional e descartável.
- **INV-058** Nenhum evento persistido se perde no reinício do Edge.

### 4.9 Planos, assinatura e entitlement (INV-059 a INV-064)

- **INV-059** As regras de plano da Especificação §34 (unidades, dias, horários, limite semanal, aulas inclusas, convidados, pausa, fidelidade, multa, multiunidade) **não têm campo em `Plan`** — `[indefinido]`. Só unidades, dias, horários e validade estão cobertos por `M1-FR-009`.
- **INV-060** Plano é criado com unidades, dias, horários e validade.
- **INV-061** Assinatura é criada, pausada, retomada e cancelada manualmente **com auditoria**.
- **INV-062** O entitlement é **derivado explicitamente** da assinatura e das regras do plano.
- **INV-063** Entitlement de cortesia exige razão, responsável e validade.
- **INV-064** O modelo de entitlement suporta: assinatura, cortesia, funcionário, personal, visitante, aula experimental, dependente, parceiro e **convênio corporativo** (ADR-009).

### 4.10 Financeiro (INV-065 a INV-075)

- **INV-065** **Valores são inteiros na menor unidade monetária. Nunca `float`.**
- **INV-066** Uma invoice por assinatura e período: único `(tenant_id, subscription_id, billing_period)`.
- **INV-067** Itens, subtotal, desconto e total são imutáveis após o pagamento.
- **INV-068** Moeda e valor não mudam após a abertura da invoice.
- **INV-069** **Invoice paga não volta a aberta.** Estorno cria estado e movimento próprios.
- **INV-070** Desconto não altera retroativamente invoice paga.
- **INV-071** Pagamento parcial não ativa plano integral.
- **INV-072** Pagamento manual registra ator, evidência, razão e respeita limite de aprovação.
- **INV-073** **Ação manual nunca apaga o evento externo original.**
- **INV-074** Estorno e pagamento manual exigem step-up authentication conforme valor.
- **INV-075** Recibo é **não fiscal**, com identificadores verificáveis.
- **INV-147** **Pagamento manual não é estornado pelo sistema** (ADR-027): não há provedor que o
  devolva. A devolução física acontece fora e entra como contra-lançamento auditado. — *F16*
- **INV-148** **Um estorno em voo por pagamento**, garantido por índice parcial no banco
  (`refunds_payment_id_em_voo_key`), nunca por `if` no código. Estornos parciais somados nunca
  excedem o pagamento. — *F16*
- **INV-149** **Conciliação casa por `(pagamento externo, tipo)`**, nunca por valor ou proximidade
  de data: um pagamento e seu estorno de mesmo valor casariam entre si, e a conciliação fecharia em
  zero com o dinheiro tendo ido e voltado sem nenhuma ponta registrada. — *F16*
- **INV-150** **Janela de conciliação é fechada** (`ate` exclusivo, no passado): conciliar período
  em curso produz `MISSING_EXTERNAL` de pagamento que o provedor ainda não publicou. — *F16*
- **INV-151** **Divergência resolve por comando de lista fechada**, com razão e ator — nunca por
  edição direta de valor (`M2-AC-010`). — *F16*

### 4.11 Webhooks e idempotência (INV-076 a INV-087)

- **INV-076** **O webhook é idempotente:** único por `(provider_account_id, external_event_id)`; uma transição lógica por evento externo.
- **INV-077** Assinatura e origem são verificadas **antes** de qualquer processamento.
- **INV-078** **O webhook não confia no tenant do payload** — a conta do provedor resolve o tenant.
- **INV-079** Evento fora de ordem é aceito **sem regredir estado terminal válido**.
- **INV-080** Evento externo desconhecido é armazenado com segurança **sem efeito de negócio**.
- **INV-081** Confirmação do provedor prevalece sobre retorno visual do checkout.
- **INV-082** Pagamento confirmado durante backlog ativa entitlement mesmo com webhook atrasado.
- **INV-083** Há consulta ativa de status quando o webhook atrasa ou é inconclusivo.
- **INV-084** Evento de domínio é persistido **na mesma transação** da mudança de estado; consumidor registra chave idempotente **antes** do efeito externo.
- **INV-085** Nunca processar o mesmo evento duas vezes logicamente.
- **INV-086** Reprocessar qualquer evento é seguro.
- **INV-087** Operação idempotente aceita `Idempotency-Key` ou identificador externo estável.

### 4.12 Inadimplência e liberação (INV-088 a INV-097)

- **INV-088** Configuração: `due_date`, `grace_period`, `blocking_policy`. **A aritmética do exemplo da Especificação §42 está errada** — ver ADR-019.
- **INV-089** Bloqueio no primeiro instante após vencimento + carência, **no timezone da `GymUnit`**, sem fallback para o tenant (ADR-019). O instante é configurável — ver INV-144.
- **INV-090** Cadeia de bloqueio: `invoice vencida → carência → Subscription PAST_DUE → Entitlement suspenso → sync → acesso bloqueado`.
- **INV-091** Cadeia de liberação: `pago → webhook → Payment CONFIRMED → Invoice PAID → Subscription ACTIVE → Entitlement ACTIVE → sync → aluno liberado`.
- **INV-092** Após compensação, gerar `EntitlementActivated` e **sincronizar imediatamente** com o Edge.
- **INV-093** Suspender entitlement **sem apagar histórico**.
- **INV-094** **Estorno não revoga acesso retroativamente** — aplica a política vigente a partir da confirmação.
- **INV-095** Job de vencimento é idempotente e reexecutável.
- **INV-096** Override financeiro excepcional é auditado e **tem expiração**.
- **INV-097** SLO: p95 entre webhook válido e entitlement ativo **< 30 s**.

### 4.13 Cartão / PCI (INV-098 a INV-100)

- **INV-098** Tokenização é **hospedada pelo provedor**. PAN, CVV e trilha **nunca** passam pelo backend.
- **INV-099** Zero dado completo de cartão armazenado ou registrado.
- **INV-100** Token do provedor é cifrado quando persistido.

### 4.14 Saúde e IA (INV-101 a INV-119)

- **INV-101** Toda medida oficial tem tipo, valor decimal, unidade canônica, origem, responsável e instante.
- **INV-102** **Avaliação publicada é imutável.** Correção cria nova versão vinculada.
- **INV-103** **OCR/IA nunca publica automaticamente** — exige confirmação humana.
- **INV-104** **Ausência de dado não é zero.**
- **INV-105** Unidade original é preservada; conversão usa regra testada.
- **INV-106** **Arredondamento é só de apresentação**; cálculo usa a precisão armazenada.
- **INV-107** IMC é calculado de peso e altura válidos, preservando as entradas.
- **INV-108** Medidas segmentares não exigem campo ausente no equipamento.
- **INV-109** Revogação de consentimento impede novo processamento, respeitada a retenção legal.
- **INV-110** IA usa **apenas dados consentidos e necessários**, minimizados e pseudonimizados.
- **INV-111** **Saída de IA fora do schema, com diagnóstico ou valor inexistente é rejeitada.**
- **INV-112** IA é *análise de acompanhamento*, nunca diagnóstico. Toda saída carrega `disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS'`.
- **INV-113** Toda análise é auditável por snapshot imutável, modelo, versão de prompt, custo e latência.
- **INV-114** **Acesso concedido sem passagem confirmada não conta como treino** quando o hardware confirma.
- **INV-115** Entradas dentro da janela configurada contam como **uma sessão**, sem apagar os eventos brutos.
- **INV-116** Não inferir duração de treino sem saída confiável.
- **INV-117** Autorização de dado de saúde considera tenant, papel **e vínculo profissional-aluno**.
- **INV-118** Agregado executivo aplica limiar mínimo contra reidentificação.
- **INV-119** **Nenhuma decisão automática de acesso baseada em dado de saúde.**

### 4.15 Ranking, privacidade e telas públicas (INV-120 a INV-125)

- **INV-120** Ranking é **opt-in**; o aluno escolhe participar, como o nome aparece e se oculta o valor absoluto.
- **INV-121** Não criar "quem perdeu mais peso" como ranking principal. *(A Especificação §57 abre com "maior redução percentual de gordura" — contradiz a própria §60. Resolver na spec de F33.)*
- **INV-122** Evitar streak que premie treino excessivo diário.
- **INV-123** **A tela pública da catraca não exibe dívida, valor, CPF ou dado sensível.** Bloqueio mostra "Plano pendente. Procure a recepção."
- **INV-124** Status é apresentado como resultado + razão, nunca inferido só por cor.
- **INV-125** Cor não é o único indicador em gráfico de saúde.

### 4.16 Auditoria, LGPD e segurança (INV-126 a INV-134)

- **INV-126** Ações auditáveis: alteração/exclusão/arquivamento de aluno, cancelamento, desconto, pagamento manual, estorno, liberação manual, alteração de avaliação, cadastro e exclusão de biometria, função, assinatura manual, cortesia, bloqueio, dispositivo, override.
- **INV-127** Auditoria financeira é **imutável para usuários do tenant**.
- **INV-152** **Resolução de divergência de conciliação é ação auditável.** Não constava do
  INV-126, mas `M2-FR-020` exige auditoria nela — e fechar pendência financeira sem trilha é o
  buraco que o resto do módulo evita. Lacuna do INV-126 registrada pela F16 para emenda. — *F16*
- **INV-128** Privacidade por design: sempre o *mínimo dado necessário*.
- **INV-129** Foto e documento em storage privado com URL temporária.
- **INV-130** Arquivo temporário de OCR tem retenção curta e **deleção verificável**.
- **INV-131** Exportação e exclusão LGPD são assíncronas, auditadas e **testadas**.
- **INV-132** Segredo do Edge é rotacionável e guardado com mecanismo seguro do SO; nunca credencial de usuário comum.
- **INV-133** Erro segue `application/problem+json`; sem detalhe interno, PII, biometria, token ou cartão.
- **INV-134** Datas em **UTC ISO 8601**; apresentação no timezone da unidade.

### 4.17 Desempenho e resiliência (INV-135 a INV-141)

- **INV-135** Decisão de acesso: objetivo **p95 < 300 ms** (ver ADR-004).
- **INV-136** APIs administrativas: **p95 < 500 ms**, excluídas integrações externas.
- **INV-137** Resiliência: retry, backoff exponencial, idempotência, circuit breaker, DLQ.
- **INV-138** Backoff **só para falha recuperável**; falha permanente vai para DLQ **com painel**.
- **INV-139** Provedor financeiro fora não degrada leitura de invoices já armazenadas.
- **INV-140** OCR/IA fora não impede avaliação manual.
- **INV-141** Análise de IA tem timeout, orçamento e circuit breaker.

### 4.18 Decisões do PI de 14/08/2026 (INV-142 a INV-146)

- **INV-142** *(ADR-008)* **O template biométrico é expurgado em 30 dias após o encerramento do vínculo**, do banco **e** dos leitores, com evidência auditável. O prazo é parâmetro; 30 dias é o padrão e mudá-lo é decisão registrada.
- **INV-143** *(ADR-008)* **Aluno menor de 18 só tem cadastro biométrico com consentimento de responsável legal**, vinculado e comprovável. Na virada dos 18, o consentimento é revalidado com o próprio aluno.
- **INV-144** *(ADR-019)* **O instante de bloqueio por inadimplência é configurável em `BillingSettings`**, com padrão no primeiro instante de `due_date + grace_period`, **no timezone da unidade**, sem fallback para o tenant e sem adiamento por feriado.
- **INV-145** *(ADR-004)* **A decisão de acesso acontece na nuvem.** O Edge executa e reporta; não julga. Enquanto o MVP 1.5 não existir, queda de link ou Edge ausente caem em liberação manual registrada — nunca em allow local.
- **INV-146** *(ADR-011)* **A ausência do Edge é alerta operacional obrigatório**, não linha de log. Sem operação offline, Edge fora significa catraca parada, e a operação precisa saber no minuto em que acontece.

### 4.19 Avaliação multiarquivo (INV-147 a INV-152) — *(ADR-038, 21/08/2026)*

- **INV-147** **Uma medição pode ter N arquivos importados, mas nunca mais de uma avaliação.** `AssessmentImport.assessmentId` deixou de ser `@unique`; `BodyAssessment.import` é `imports AssessmentImport[]`. A garantia de unicidade mora em `BodyAssessment.source_reference` — índice único parcial `(source_reference) WHERE source = 'IMPORT'` —, não em `assessment_imports`: uma sessão de três arquivos produz três linhas de importação apontando para a mesma linha de avaliação, e é a avaliação, não a importação, que precisa ser única por origem.
- **INV-148** **A sessão de revisão confirma uma vez só, e a confirmação cria a avaliação com as medidas de todos os arquivos da sessão.** Não há confirmação parcial por arquivo depois que a sessão existe.
- **INV-149** **Bioimpedância é obrigatória; ECG é opcional.** Um conjunto de arquivos sem nenhum laudo de composição corporal não pode virar avaliação — seria um ponto vazio na série de evolução (INV-104). Classificação do laudo: `BIOIMPEDANCE` é **qualquer medida diferente de `HEART_RATE`**; laudo só com `HEART_RATE` classifica `ECG`.
- **INV-150** **Campo concordante entre arquivos deduplica; campo divergente nunca funde automaticamente — exige escolha humana explícita, sem pré-seleção.** A sessão não pode ser confirmada enquanto **qualquer** campo divergente estiver com pelo menos um lado `PENDING`. A tolerância de equivalência deriva da precisão impressa no laudo (não de estimativa) e é assimétrica de propósito: mostrar divergência que era só arredondamento custa um clique ao avaliador; fundir valores que realmente divergem grava um número errado como confirmado por duas fontes.
- **INV-151** **Índice, classificação e sugestão proprietários do fabricante nunca viram medida.** Idade corporal, pontuação de saúde, tipo de corpo, peso ideal sugerido e classificações do aparelho vão para `BodyAssessment.deviceReport` (JSON opaco), fora do gráfico de evolução. Critério: vira medida o que é medido e comparável entre aparelhos; vira atributo o que é índice ou fórmula proprietária do fabricante, que pode mudar num firmware novo e produziria tendência falsa se comparado mês a mês.
- **INV-152** **O ECG nunca é interpretado, mesmo dentro da avaliação multiarquivo (ADR-035, sem exceção).** `HEART_RATE` é medida oficial; achado do aparelho, tags e observações do ECG são texto atribuído ao aparelho em `deviceReport`, e nenhuma regra lê esse texto para decidir, alertar, bloquear ou encaminhar.

---

## 5. Buracos conhecidos do modelo

Conceitos usados em telas, menus e regras **sem entidade nem campo**. O Code **não os inventa**
— cada um vira pergunta ao PI antes da fatia que precisar.

| conceito | onde é citado | o que falta |
|---|---|---|
| **Meta / `Goal`** | totem §44, mobile §46, comparativo §51, ranking §57, menu §116 | Quem define, qual métrica, qual prazo, quem altera. Único traço: `M3-FR-012` (baseline, alvo, unidade, prazo, responsável) |
| **`Lead`** | §11 "origem do lead", menu Comercial §116 | Hoje é atributo textual + status de `Student`. Sem entidade, funil ou origem enumerada |
| **`Contract`** | fluxo de matrícula §93, menu §116 | Nada. Não se sabe se é documento assinado, PDF ou a própria `Subscription` |
| **`Discount`, `Coupon`, bolsa, negociação** | §36, `M2` §4 (`discount.apply/approve`) | Sem entidade, sem campo, sem limite de aprovação |
| **Feriado / horário especial** | §10 | Sem entidade — mas as regras 6, 8 e 15 do motor de acesso dependem disso |
| **`FeatureFlag`** | §100, §101, PRDs §19 | Escopo (global/tenant/unidade), quem alterna, auditoria, conflito com plano SaaS |
| **`SaasPlan`** (Starter/Pro/Enterprise) | §9, §100, §102 | Campo existe no tenant sem tipo; billing da plataforma está **fora de escopo** dos MVPs 1 e 2 |
| **Aulas / `Class`** | §34 "aulas inclusas" | Sem entidade, agenda, professor ou reserva |
| **Antifraude, limite de acessos, acesso duplicado** | §20 regras 11-14 | Sem parâmetro, campo ou fonte de configuração |
| ~~**Nível "Academia"**~~ | §6 | **Resolvido:** dois níveis (ADR-002). A Especificação §6 precisa de nota de emenda |
| **`Payment`** | §90, `M2` §11 | Nenhum campo. Ver **ADR-027** |
| **`Passage`** | `M1` §10/§13 | Tem estados, não tem tabela |
| **Wearable / origem de `HEART_RATE`** | §53, §106 | Nenhuma integração na stack ou nos módulos |

---

## 6. Conflitos entre documentos e como se resolvem

| conflito | resolução | onde |
|---|---|---|
| `GRANTED/DENIED` × `ALLOW/DENY` | `ALLOW`/`DENY` | ADR-005 |
| `timestamp` × `occurred_at` | `occurred_at` | ADR-005 |
| `unit_id` × `gym_unit_id` | `gym_unit_id` | ADR-005 |
| `access_rules` × `access_policies` | `access_policies` | ADR-005 |
| `Subscription` com/sem `PAST_DUE` | com; inalcançável no MVP 1 | §3.2 |
| `Invoice` com/sem `DRAFT` | com | §3.4 |
| entitlement "revoked" × "suspender" | `SUSPENDED` na inadimplência | §3.3 |
| `PaymentProvider` 7 × 6 × 10 métodos | vence o PRD (6) | ADR-013 |
| `assessment_date` × `assessed_at` | `assessed_at` | §2.5 |
| `Consent.HEALTH_DATA` × `health_consents` | tabela única `Consent` com `type` | §2.2 |
| entitlement × assinatura no motor | entitlement, sempre | ADR-003 |
| hierarquia de 2 × 3 níveis | **dois níveis** | ADR-002 |
| carência 3 dias → 13/08 × 14/08 | **13/08**, configurável | ADR-019 |
