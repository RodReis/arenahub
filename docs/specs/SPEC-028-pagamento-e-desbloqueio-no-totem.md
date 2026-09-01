# SPEC-028 — Pagamento e desbloqueio no totem

| campo | valor |
|---|---|
| **Fatia** | F28 |
| **MVP** | 4 |
| **Slice do PRD** | **4.6** — `docs/prd/academia/MVP-04-app-totem.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-04-06-kiosk-payment-entitlement.md` |
| **Status** | 🔒 **número queimado** — executada pela **F52** ([#209](https://github.com/RodReis/arenahub/pull/209), 26/08/2026) |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M4-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 4.6. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> MVP futuro. O PI não pode aprovar hoje o que ainda não foi discutido — e aprovar sem discutir é o que este processo existe para impedir.

---

> ## 🔒 Esta fatia não será executada — a Slice 4.6 já foi entregue pela F52
>
> **Constatado em 01/09/2026.** O [ADR-042](../DECISIONS.md#adr-042) antecipou as Slices **4.5 e 4.6**
> para o MVP 3.5, e elas viraram as fatias **F49** e **F52**. A F52 (`SPEC-052`, issue
> [#153](https://github.com/RodReis/arenahub/issues/153)) aponta para **esta mesma Slice 4.6** e carrega o
> **mesmo aceite, palavra por palavra**: *"aluno paga e tem entitlement restaurado pelo fluxo do MVP 2,
> sem bypass local"*. Entregue em **26/08/2026** pelo PR [#209](https://github.com/RodReis/arenahub/pull/209).
>
> **A emenda do [ADR-043](../DECISIONS.md#adr-043), Decisão 4 — dois QRs, PIX *e* cartão — entrou no mesmo
> PR**, e não ficou como resto para uma fatia futura. Evidência no código:
>
> | o que a Slice 4.6 exige | onde está |
> |---|---|
> | Aluno escolhe PIX ou cartão, ambos QR | `apps/kiosk/components/pagamento.tsx` |
> | Checkout de cartão hospedado no celular | `POST .../payments/card-checkout` — `kiosk.controller.ts`, `billing.controller.ts` |
> | Totem sem teclado de cartão, fora do escopo PCI | teste *"diz que o cartão é digitado no celular, não no totem"* |
> | Confirmação vem do backend, sem bypass local | testes *"NÃO oferece botão de 'já paguei'"* e *"confirma só quando o backend diz"* |
> | Entitlement pelo fluxo do MVP 2 | cadeia inalterada — regra de arquitetura 1, [ADR-003](../DECISIONS.md#adr-003) |
>
> **O número `SPEC-028` fica queimado** e não é reaproveitado — mesma regra da
> [F33](../STATUS.md). A issue [#28](https://github.com/RodReis/arenahub/issues/28) segue aberta
> aguardando **fechamento pelo PI**: só ele fecha card.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-04-app-totem.md` §7, Slice 4.6, e o plano de apoio acima.

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
