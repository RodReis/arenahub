# SPEC-085 — Cancelar pagamento manual lançado errado

| campo | valor |
|---|---|
| **Fatia** | F85 |
| **Slice do PRD** | não há. Nasce de pedido do PI em 05/10/2026 |
| **MVP** | 2 *(financeiro)* — decisão do PI, não Slice de PRD |
| **Superfície** | `apps/api` (`billing`), `packages/database` e `apps/admin-web` (ficha do aluno → Financeiro) |
| **Plano de apoio** | [`2026-10-05-cancelar-pagamento-manual.md`](../superpowers/plans/2026-10-05-cancelar-pagamento-manual.md) |
| **Status** | `aprovada-pi` |
| **Criada em** | 2026-10-05 |
| **Aprovada pelo PI em** | 05/10/2026 (desenho e plano aprovados em chat) |
| **Card** | [#571](https://github.com/RodReis/arenahub/issues/571) |

---

## 1. Objetivo em uma frase

A recepção cancela, pela tela e com motivo, um pagamento manual lançado por engano; a cobrança volta a
ficar em aberto e o lançamento some da grade, com a trilha na auditoria.

---

## 2. Onde mora o desenho

Esta spec é **ponteiro fino** (ADR-022): o escopo, as decisões e os critérios estão em
[`docs/superpowers/specs/2026-10-05-cancelar-pagamento-manual-design.md`](../superpowers/specs/2026-10-05-cancelar-pagamento-manual-design.md)
e a decisão do PI está registrada no **ADR-065**. Nada é copiado para cá.

Decisões do PI em 05/10/2026: a fatura **volta a aberta**; **a própria recepção cancela**
(`billing.payment.manual`); cancelar é emenda do INV-069 **só para pagamento manual**.
