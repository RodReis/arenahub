# SPEC-086 — Diária avulsa no balcão

| campo | valor |
|---|---|
| **Fatia** | F86 |
| **Slice do PRD** | não há. Nasce de pedido do PI em 07/10/2026 |
| **MVP** | 2 *(financeiro)* — decisão do PI, não Slice de PRD |
| **Superfície** | `apps/api` (`membership`, `billing`), `packages/database` e `apps/admin-web` (ficha do aluno) |
| **Plano de apoio** | [`2026-10-07-diaria-avulsa-balcao.md`](../superpowers/plans/2026-10-07-diaria-avulsa-balcao.md) |
| **Status** | `aprovada-pi` |
| **Criada em** | 2026-10-07 |
| **Aprovada pelo PI em** | 07/10/2026 (desenho aprovado em chat) |
| **Card** | [#616](https://github.com/RodReis/arenahub/issues/616) |

---

## 1. Objetivo em uma frase

A recepção vende, num clique, uma diária de R$ 30,00 a um aluno sem plano vigente; o acesso só existe
depois do pagamento registrado e vale até 23:59 do dia.

## 2. Onde mora o desenho

Esta spec é **ponteiro fino**: o escopo, as decisões do PI e os critérios estão em
[`docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md`](../superpowers/specs/2026-10-07-diaria-avulsa-design.md).
Nada é copiado para cá. A fatia seguinte, do totem, é a **F87 / SPEC-087** (§9 do mesmo documento) e
fica **sem spec própria** até a F55 liberar o PIX real.
