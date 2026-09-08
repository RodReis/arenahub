# SPEC-065 — Gate de tenant no motor de decisão (carência e suspensão)

| campo | valor |
|---|---|
| **Fatia** | F65 |
| **MVP** | 7 — Plataforma (ADR-052) |
| **Slice do PRD** | não há. Escopo mora nesta spec e no ADR-053 |
| **Superfície** | `api` (`access`, `device-sync`) · `edge-agent` · `admin-web` (aviso ao `OWNER`) |
| **Card** | [#288](https://github.com/RodReis/arenahub/issues/288) |
| **Status** | aprovada-pi — 08/09/2026 |

---

## 1. O que esta fatia entrega

Fatura da plataforma vencida e carência esgotada: o tenant vai para `SUSPENDED` e a catraca nega todo mundo com razão `TENANT_SUSPENDED`, sem tocar em nenhum Entitlement. Regularizou, abre na hora.

---

## 2. Escopo

- Verificação de tenant **antes** das regras de aluno no motor: `DENY` com razão `TENANT_SUSPENDED` (enum de razão — ADR de domínio vence o design).
- Carência lida do contrato (`grace_days`, padrão 15); sem fatura automática, suspensão manual pelo Super Admin com data informada.
- Snapshot do Edge ganha `tenantGateAt`; edge offline fecha na expiração do snapshot (ADR-053 §4).
- Painel: contagem regressiva e valor em aberto para o `OWNER` desde o vencimento.
- Testes: motor nega com gate ativo e volta a permitir ao levantar; Entitlements inalterados antes e depois; snapshot com e sem gate.

---

## 3. Escopo negativo

| não faz | vai para |
|---|---|
| bloquear login do painel | fora (ADR-053, escopo negativo) |
| revogar Entitlement | nunca (ADR-053 §2) |

---

## 4. Invariantes

INV-001 a INV-008 (multi-tenant e identidade). Regras de arquitetura 1, 2, 4 e 5 do `CLAUDE.md`.
Detalhe da decisão: ADR-053 em `docs/DECISIONS.md`. Onde esta spec e o ADR divergirem, o ADR vence.
