# SPEC-089 — Configuração > Pagamento: dia de gerar, vencimento e bloqueio configuráveis

| campo | valor |
|---|---|
| **Fatia** | F89 |
| **Slice do PRD** | não há. Nasce de pedido do PI em 07/10/2026 |
| **MVP** | 2 *(financeiro)* — decisão do PI, não Slice de PRD |
| **Superfície** | `apps/api` (`billing`), `packages/database` e `apps/admin-web` (menu Configuração, aba Pagamento) |
| **Status** | `aprovada-pi` |
| **Criada em** | 2026-10-07 |
| **Aprovada pelo PI em** | 07/10/2026 (desenho aprovado em chat) |
| **Card** | [#624](https://github.com/RodReis/arenahub/issues/624) |

---

## 1. Objetivo em uma frase

O dono da academia define, em Configuração > Pagamento, o dia de gerar as parcelas, o dia de vencimento e quantos
dias depois do vencimento a catraca bloqueia, e a mudança vale para as próximas parcelas.

## 2. Onde mora o desenho

Esta spec é **ponteiro fino**: o escopo, as decisões do PI e os critérios estão em
[`docs/superpowers/specs/2026-10-07-configuracao-de-pagamento-design.md`](../superpowers/specs/2026-10-07-configuracao-de-pagamento-design.md).
Nada é copiado para cá.
