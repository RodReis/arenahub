# SPEC-012 — Ledger operacional e invoice

| campo | valor |
|---|---|
| **Fatia** | F12 |
| **MVP** | 2 |
| **Slice do PRD** | **2.1** — `docs/prd/academia/MVP-02-smart-billing.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-02-01-ledger-invoice.md` |
| **Status** | `aprovada-pi` *(18/08/2026 — ver ADR-030)* |
| **ADRs que bloqueiam** | **nenhum** — ADR-027 fechado em 18/08/2026; o ADR-013 nunca a bloqueou |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M2-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 2.1. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Nenhum ADR bloqueia esta fatia desde 18/08/2026.** O ADR-027 (modelo de `Payment` e
> `PaymentAttempt`) foi aceito e o `MVP-02` emendado; o ADR-013 nunca a alcançou — a Slice 2.1 não
> chama um único método de `PaymentProvider`, e o `MVP-02` §5 põe o gate de homologação antes da
> **Slice 2.2**.
>
> ⚠️ **`aprovada-pi` por decisão do PI em 18/08/2026, com as §2 a §5 ainda vazias** — ver
> **ADR-030**. Diferente das F13–F16, aqui **nenhum ADR está pendente**: o §6 fica satisfeito
> assim que as seções forem preenchidas, o que é dívida do Cowork **antes do PR**. **O card não
> sai do Backlog por causa desta aprovação** — quem segura é a entrada do MVP 2 (MVP 1 estável).

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-02-smart-billing.md` §7, Slice 2.1, e o plano de apoio acima.

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
