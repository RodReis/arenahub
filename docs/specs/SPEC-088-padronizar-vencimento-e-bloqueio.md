# SPEC-088 — Padronizar vencimento, cobrança mensal automática e bloqueio por inadimplência

| campo | valor |
|---|---|
| **Fatia** | F88 |
| **Slice do PRD** | não há. Nasce de pedido do PI em 07/10/2026 |
| **MVP** | 2 *(financeiro)* — decisão do PI, não Slice de PRD |
| **Superfície** | `apps/api` (`billing`), `packages/database` e `apps/admin-web` (ficha do aluno, aba Cobrança) |
| **Status** | `aprovada-pi` |
| **Criada em** | 2026-10-07 |
| **Aprovada pelo PI em** | 07/10/2026 (desenho aprovado em chat) |
| **Card** | [#621](https://github.com/RodReis/arenahub/issues/621) |

---

## 1. Objetivo em uma frase

Toda fatura vence no dia 10 da competência, nasce sozinha no dia 01, a paga mostra até quando cobre
(pagamento + 30 dias), e a catraca bloqueia quem não pagou 5 dias depois do vencimento.

## 2. Onde mora o desenho

Esta spec é **ponteiro fino**: o escopo, as decisões do PI e os critérios estão em
[`docs/superpowers/specs/2026-10-07-padronizar-vencimento-design.md`](../superpowers/specs/2026-10-07-padronizar-vencimento-design.md).
Nada é copiado para cá.
