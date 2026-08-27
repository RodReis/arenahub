# SPEC-033 — Rankings privados por padrão

| campo | valor |
|---|---|
| **Fatia** | F33 |
| **MVP** | 5 |
| **Slice do PRD** | **5.4** — `docs/prd/academia/MVP-05-engagement.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-05-04-private-rankings.md` |
| **Status** | 🔒 **absorvida pela F31** em 27/08/2026 — número queimado |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M5-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 5.4. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> MVP futuro. O PI não pode aprovar hoje o que ainda não foi discutido — e aprovar sem discutir é o que este processo existe para impedir.

---

> ## ⚠️ Esta fatia não existe mais
>
> **A `SPEC-033` foi absorvida pela `SPEC-031` (fatia F31) em 27/08/2026**, por decisão do PI
> registrada em **[ADR-047](../DECISIONS.md#adr-047), Decisão 2**.
>
> Motivo: XP privado sem placar não entrega o que a academia quer ver, e partir em duas fatias
> adiaria metade do valor sem reduzir risco — o placar ordena exatamente o saldo que a F31 produz,
> e o portão de exposição já existia desde a F30.
>
> **`F33` e `SPEC-033` estão queimadas e não voltam à fila** (regra da numeração no `STATUS.md`).
> O ranking entregue vive em [`SPEC-031-xp-e-conquistas.md`](SPEC-031-xp-e-conquistas.md).
>
> **O que a Slice 5.4 previa e a F31 NÃO entregou:** ranking de **evolução física relativa**. Ele
> exige o consentimento `PHYSICAL_EVOLUTION_RANKING`, dormente desde a F30, e carrega o `INV-121`
> (não criar "quem perdeu mais peso" como ranking principal). Volta na fatia que o acender.
>
> O texto abaixo fica como histórico.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-05-engagement.md` §7, Slice 5.4, e o plano de apoio acima.

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
