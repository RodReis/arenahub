# SPEC-008 — Consentimento, biometria e sync de dispositivo

| campo | valor |
|---|---|
| **Fatia** | F8 |
| **MVP** | 1 |
| **Slice do PRD** | **1.3** — `docs/prd/academia/MVP-01-smart-access.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-01-03-biometrics-device-sync.md` |
| **Status** | `aprovada-pi` *(14/08/2026, segunda rodada)* |
| **Issue** | [#8](https://github.com/RodReis/arenahub/issues/8) |
| **ADRs que bloqueiam** | nenhum — **ADR-008 resolvido em 14/08/2026** (consentimento art. 11, I; academia controladora e ArenaHub operador; RIPD por template nosso). O ponto que resta no ADR-008 é transferência internacional de IA de saúde, que é **F21**, não esta fatia |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M1-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 1.3. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Bloqueio removido em 14/08/2026.** O ADR-008 fechou base legal (consentimento art. 11, I), papéis (academia controladora, ArenaHub operador) e RIPD (template nosso, assinatura dela). **Falta o ato de aprovação do PI.**
>
> **Escopo que estas decisões acrescentam a esta fatia:** contrato de tratamento do art. 39 com instruções documentadas, e as decisões de retenção/log expostas como **parâmetro do cliente** — é o que sustenta a posição de operador contra reclassificação pela ANPD.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-01-smart-access.md` §7, Slice 1.3, e o plano de apoio acima.

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
