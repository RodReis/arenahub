# SPEC-064 — Fatura da plataforma sobre o tenant

| campo | valor |
|---|---|
| **Fatia** | F64 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-052 (Fatura da plataforma) e pendências 1–2 |
| **Superfície** | `admin-web` (`/platform` e aviso ao `OWNER`) · `api` (`platform`) · job |
| **Card** | [#287](https://github.com/RodReis/arenahub/issues/287) |
| **Status** | aprovada-pi — 08/09/2026 |

---

## 1. O que esta fatia entrega

No dia de emissão o ArenaHub conta os alunos do tenant por status (ou aplica o fixo corrigido) e emite a fatura da plataforma; o tenant vê a prévia antes e o valor depois; o Super Admin registra o pagamento.

---

## 2. Escopo

- `PlatformInvoice`: tenant, contrato, competência, contagem por status congelada (`active_count`, `inactive_count`), valores em minor units, vencimento, status (`OPEN` | `PAID` | `OVERDUE`), `paid_at`.
- Contagem no dia de emissão (padrão **dia 1**, configurável no contrato): ativo = `Student.status = ACTIVE`; inativo = **todos os demais** — `LEAD`, `TRIAL`, `SUSPENDED`, `BLOCKED`, `CANCELLED`, `ARCHIVED` (ADR-052 §6, fechado em 08/09/2026). Preço do inativo vem do contrato e pode ser zero.
- Prévia da fatura visível ao `OWNER` do tenant a partir de X dias antes da emissão.
- Pagamento registrado manualmente pelo Super Admin; `OVERDUE` no vencimento dispara a contagem de carência da F65.
- Job idempotente por `(tenant_id, competência)` (regra 4).

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| gateway de pagamento para a plataforma | ADR futuro |
| fechar a catraca | F65 |

---

## 4. Invariantes

INV-001 a INV-008 (multi-tenant e identidade). Regras de arquitetura 1, 2, 4 e 5 do `CLAUDE.md`.
Detalhe da decisão: ADR-052 (Fatura da plataforma) e pendências 1–2 em `docs/DECISIONS.md`. Onde esta spec e o ADR divergirem, o ADR vence.
