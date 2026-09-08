# SPEC-063 — Plano SaaS e contrato do tenant

| campo | valor |
|---|---|
| **Fatia** | F63 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-052 §5–§8 |
| **Superfície** | `admin-web` (`/platform`) · `api` (`platform`) · PDF |
| **Card** | — |
| **Status** | rascunho — decisões do PI em 08/09/2026 |

---

## 1. O que esta fatia entrega

O Super Admin cadastra planos SaaS e fecha um contrato com o tenant: modelo por aluno (preço por ativo e por inativo) ou fixo mensal corrigido por índice. O contrato é imutável e gera PDF.

---

## 2. Escopo

- `SaasPlan`: nome, modelo (`PER_STUDENT` | `FIXED_MONTHLY`), `active_student_price_minor`, `inactive_student_price_minor` (padrão 500 e 250), `fixed_price_minor`, `currency`, status.
- `TenantContract`: tenant, plano, valores **copiados** no fechamento, `index_code` (padrão `IPCA`), data-base, aniversário, `grace_days` (padrão 15), dia de emissão, vigência, status. Imutável depois de ativo; alteração = novo contrato ou aditivo que referencia o anterior.
- `IndexValue`: histórico manual do índice (código, competência, valor) — a correção anual lê daqui.
- PDF com dados do tenant, plano e valores acordados, guardado no object storage e ligado ao contrato.
- Dinheiro inteiro em minor units, sempre (regra 6).

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| emitir e cobrar a fatura | F64 |
| assinatura eletrônica | fora (ADR-052 §8) |
| buscar índice em API externa | ADR futuro |

---

## 4. Invariantes

INV-001 a INV-008 (multi-tenant e identidade). Regras de arquitetura 1, 2, 4 e 5 do `CLAUDE.md`.
Detalhe da decisão: ADR-052 §5–§8 em `docs/DECISIONS.md`. Onde esta spec e o ADR divergirem, o ADR vence.
