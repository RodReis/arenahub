# SPEC-066 — RLS fase 1 — role de runtime, contexto por transação e primeiras políticas

| campo | valor |
|---|---|
| **Fatia** | F66 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-054 §1–§4 e §6 |
| **Superfície** | `packages/database` · `api` · `infra/` · Railway |
| **Card** | [#289](https://github.com/RodReis/arenahub/issues/289) |
| **Status** | aprovada-pi — 08/09/2026 |

---

## 1. O que esta fatia entrega

O banco passa a recusar, sozinho, leitura ou escrita fora do tenant da transação em `students` e `audit_logs` — mesmo que a aplicação esqueça o `where`.

---

## 2. Escopo

- Role `arenahub_app` sem ownership e sem `BYPASSRLS`; segunda `DATABASE_URL` de runtime na Railway e no docker-compose (**subir docker novo com portas novas**, nunca reaproveitar as configuradas).
- Extensão do Prisma Client: toda operação com tenant roda em transação com `SET LOCAL app.tenant_id`; operação sem contexto **falha**.
- Contextos `system` e `platform` explícitos (worker, outbox, edge-sync, seed, elevação).
- Políticas + `FORCE ROW LEVEL SECURITY` em `students` e `audit_logs`.
- Teste de integração (Testcontainers) sob o role restrito: tenant A tenta ler B e recebe zero linhas / erro — INV-006 no banco.

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| coluna `tenant_id` nas doze tabelas e políticas restantes | F67 |
| remover `TenantContext` da aplicação | nunca (ADR-054 §1) |

---

## 4. Invariantes

INV-001 a INV-008 (multi-tenant e identidade). Regras de arquitetura 1, 2, 4 e 5 do `CLAUDE.md`.
Detalhe da decisão: ADR-054 §1–§4 e §6 em `docs/DECISIONS.md`. Onde esta spec e o ADR divergirem, o ADR vence.
