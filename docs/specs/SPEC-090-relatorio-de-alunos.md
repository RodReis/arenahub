# SPEC-090 — Relatórios > Alunos: filtros e exportação em PDF e CSV

| campo | valor |
|---|---|
| **Fatia** | F90 |
| **Slice do PRD** | não há. Nasce de pedido do PI em 10/10/2026 |
| **MVP** | — *(o PI não indicou)* |
| **Superfície** | `apps/api` (`reports`, `billing/domain`, `exports/domain`) e `apps/admin-web` (menu Relatórios, `/reports/students`) |
| **Status** | `aprovada-pi` |
| **Criada em** | 2026-10-10 |
| **Aprovada pelo PI em** | 10/10/2026 (desenho aprovado em chat) |
| **Card** | [#631](https://github.com/RodReis/arenahub/issues/631) |

---

## 1. Objetivo em uma frase

O usuário que lê alunos abre o menu **Relatórios**, filtra os alunos por unidade, situação, perfil, plano e situação financeira
(inadimplentes ou pagantes), confere na tela no padrão da Lista de Alunos e exporta o mesmo recorte em PDF e CSV
formatados, com a logo e os dados da academia.

## 2. Onde mora o desenho

Esta spec é **ponteiro fino**: o escopo, as decisões do PI e os critérios estão em
[`docs/superpowers/specs/2026-10-10-relatorio-de-alunos-design.md`](../superpowers/specs/2026-10-10-relatorio-de-alunos-design.md);
o passo a passo da implementação, em
[`docs/superpowers/plans/2026-10-10-relatorio-de-alunos.md`](../superpowers/plans/2026-10-10-relatorio-de-alunos.md).
Nada é copiado para cá.
