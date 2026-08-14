# SPEC-004 — Offline e reconciliação

| campo | valor |
|---|---|
| **Fatia** | F4 |
| **MVP** | 0 |
| **Slice do PRD** | **0.4** — `docs/prd/academia/MVP-00-poc-topdata.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-00-poc-topdata.md` |
| **Status** | `em-revisao` |
| **ADRs que bloqueiam** | nenhum — **ADR-011 resolvido em 14/08/2026** (pareamento de uso único, segredo por dispositivo, rotação automática) |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M0-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 0.4. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Bloqueio removido em 14/08/2026.** O ADR-011 fechou: pareamento por código de uso único, segredo por dispositivo no mecanismo seguro do Windows, rotação automática e revogação no painel. **Falta o ato de aprovação do PI** para o status virar `aprovada-pi` — o portão agora é ele, não o ADR.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-00-poc-topdata.md` §7, Slice 0.4, e o plano de apoio acima.

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
