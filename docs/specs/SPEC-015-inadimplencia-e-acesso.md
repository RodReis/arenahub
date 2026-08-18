# SPEC-015 — Inadimplência e acesso

| campo | valor |
|---|---|
| **Fatia** | F15 |
| **MVP** | 2 |
| **Slice do PRD** | **2.4** — `docs/prd/academia/MVP-02-smart-billing.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-02-04-delinquency-access.md` |
| **Status** | `aprovada-pi` *(18/08/2026 — ver ADR-030)* |
| **ADRs que bloqueiam** | ADR-013 (provedor) e o campo de âncora do ADR-019 |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M2-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 2.4. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> ⚠️ **`aprovada-pi` por decisão do PI em 18/08/2026, com o ADR-013 ainda `aberto`** — ver
> **ADR-030**, que registra a decisão e a divergência do Cowork. O checklist §6 abaixo
> **continua com `Os ADRs listados acima estão resolvidos` desmarcado**, e nenhum PR desta fatia
> abre enquanto ele estiver assim. As §2 a §5 seguem vazias: são dívida a pagar **antes do PR**,
> não antes do rótulo. **O card não sai do Backlog por causa desta aprovação** — quem segura é a
> entrada do MVP 2 (MVP 1 estável + provedor homologado).

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-02-smart-billing.md` §7, Slice 2.4, e o plano de apoio acima.

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
