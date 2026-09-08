# SPEC-067 — RLS fase 2 — `tenant_id` nas tabelas restantes e políticas em todas

| campo | valor |
|---|---|
| **Fatia** | F67 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-054 §5–§6 |
| **Superfície** | `packages/database` (migration de dado) · `api` |
| **Card** | [#290](https://github.com/RodReis/arenahub/issues/290) |
| **Status** | rascunho — decisões do PI em 08/09/2026 |

---

## 1. O que esta fatia entrega

Todas as tabelas de negócio têm `tenant_id` e política RLS; nenhuma depende de `JOIN` para saber de quem é a linha.

---

## 2. Escopo

- Migration em duas etapas (coluna nula → backfill pelo pai → `NOT NULL`) em `AccessPassage`, `PlanUnit`, `PlanAccessWindow`, `EntitlementUnitWindow`, `RankingEntry`, `InboxReceipt`, `ReplayNonce`, `KioskReplayNonce`, `AiPromptVersion` e as demais que o Code confirmar no schema; rodada em local **e em produção**, idempotente.
- Repositórios dessas tabelas passam a gravar `tenant_id`.
- Política + `FORCE` em toda tabela com `tenant_id`. Globais (`Tenant`, `User`, `Permission`, `RolePermission`) ficam fora.
- Teste cruzado por tabela.

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| mudar estratégia para schema por tenant | fora — ADR-002 e ADR-054 |

---

## 4. Invariantes

INV-001 a INV-008 (multi-tenant e identidade). Regras de arquitetura 1, 2, 4 e 5 do `CLAUDE.md`.
Detalhe da decisão: ADR-054 §5–§6 em `docs/DECISIONS.md`. Onde esta spec e o ADR divergirem, o ADR vence.
