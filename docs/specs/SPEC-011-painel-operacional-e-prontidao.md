# SPEC-011 — Painel operacional e prontidão

| campo | valor |
|---|---|
| **Fatia** | F11 |
| **MVP** | 1 |
| **Slice do PRD** | **1.6** — `docs/prd/academia/MVP-01-smart-access.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-01-06-operational-dashboard.md` |
| **Status** | `aprovada-pi` |
| **ADRs que bloqueiam** | nenhum. **Escopo acrescentado por ADR-011 (14/08/2026):** o alerta de heartbeat tem duas causas distintas — Edge ausente e falha de renovação de credencial |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M1-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 1.6. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Aprovada pelo PI em 14/08/2026** — via ADR-022, a Slice do PRD é a spec.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-01-smart-access.md` §7, Slice 1.6, e o plano de apoio acima.

## 2. Decisões específicas desta fatia

*(preencher quando houver — decisão com efeito além da fatia vira ADR, não fica aqui)*

Nenhuma até 14/08/2026.

## 3. Escopo negativo

*(o que esta fatia deliberadamente não faz, e para onde foi)*

## 4. Invariantes que esta fatia precisa preservar

*(listar os `INV-nnn` de `docs/CONVENTION.md` §4 que o código desta fatia toca — cada um precisa
de teste, conforme `docs/REVIEW.md` §3)*

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| — | — | — | — |

## 6. Antes de codificar, confirme

- [ ] Status desta spec é `aprovada-pi`
- [ ] Os ADRs listados acima estão resolvidos
- [ ] O gate de entrada do MVP tem evidência registrada
