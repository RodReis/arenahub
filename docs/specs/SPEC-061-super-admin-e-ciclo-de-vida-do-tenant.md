# SPEC-061 — Super Admin e ciclo de vida do tenant

| campo | valor |
|---|---|
| **Fatia** | F61 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-052 §1–§4 |
| **Superfície** | `admin-web` (`/platform`) · `api` (`platform`) |
| **Card** | — |
| **Status** | rascunho — decisões do PI em 08/09/2026 |

---

## 1. O que esta fatia entrega

O dono do ArenaHub cria, edita, lista, ativa e inativa tenants e suas unidades pelo painel, sem script nem acesso ao banco. Entra num tenant só por sessão elevada com justificativa e prazo, tudo auditado.

---

## 2. Escopo

- Papel de plataforma sem `tenant_id` sobre o `User` global; MFA obrigatório (INV-007).
- Rota `/platform` no `admin-web`: lista de tenants, cadastro (razão social, nome fantasia, CNPJ, slug, timezone, responsável), unidades do tenant, status `ACTIVE` | `INACTIVE` | `SUSPENDED`.
- Criação de tenant gera o `OWNER` inicial por convite (`Invitation` já existe) — substitui `bootstrap-tenant.ts`.
- Elevação: caso de uso que abre sessão com `tenant_id` alvo, justificativa obrigatória, expiração curta, `AuditLog` com `actorType = SUPPORT` na entrada e na saída (INV-005, INV-008). O painel mostra faixa visível "você está operando como suporte em <tenant>".

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| identidade visual e login por slug | F62 |
| plano, contrato, fatura | F63, F64 |
| efeito de `SUSPENDED` na catraca | F65 (ADR-053) |
| feature flag por plano | fora — flag continua coluna (ADR-049) |

---

## 4. Invariantes

INV-001 a INV-008 (multi-tenant e identidade). Regras de arquitetura 1, 2, 4 e 5 do `CLAUDE.md`.
Detalhe da decisão: ADR-052 §1–§4 em `docs/DECISIONS.md`. Onde esta spec e o ADR divergirem, o ADR vence.
