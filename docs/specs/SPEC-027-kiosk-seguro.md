# SPEC-027 — Kiosk seguro

| campo | valor |
|---|---|
| **Fatia** | F27 |
| **MVP** | 4 |
| **Slice do PRD** | **4.5** — `docs/prd/academia/MVP-04-app-totem.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-04-05-secure-kiosk.md` |
| **Status** | 🔒 **número queimado** — executada pela **F49** ([#150](https://github.com/RodReis/arenahub/issues/150), 25/08/2026) |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M4-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 4.5. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> MVP futuro. O PI não pode aprovar hoje o que ainda não foi discutido — e aprovar sem discutir é o que este processo existe para impedir.

---

> ## 🔒 Esta fatia não será executada — a Slice 4.5 já foi entregue pela F49
>
> **Constatado em 01/09/2026.** O [ADR-042](../DECISIONS.md#adr-042) antecipou as Slices **4.5 e 4.6**
> para o MVP 3.5, e elas viraram as fatias **F49** e **F52**. A F49 (`SPEC-049`, issue
> [#150](https://github.com/RodReis/arenahub/issues/150)) tem o **mesmo título** desta — *Kiosk seguro* —,
> aponta para **esta mesma Slice 4.5** e carrega o **mesmo aceite, palavra por palavra**: *"bateria
> automatizada e manual comprova que dado do aluno A não aparece para o aluno B"*. Entregue em **25/08/2026**.
>
> **Cinco dos seis itens da Slice 4.5 estão na F49.** O sexto — *plano, invoices e PIX* — foi para a **F52**,
> no mesmo MVP 3.5, junto com o resto da Slice 4.6. Nada da 4.5 ficou sem dono.
>
> | item da Slice 4.5 | onde está |
> |---|---|
> | Provisionamento com identidade de dispositivo | `KioskDevice` no schema · `kiosk-auth.int-spec.ts` (chave, nonce, revogação, janela de relógio) |
> | Sessão efêmera e escopo `/api/v1/kiosk` | `KioskSession` (guarda **hash**, não o token) · `apps/kiosk/lib/use-sessao.ts` |
> | Identificação segura | `identificacao-cpf.tsx` — CPF sozinho, regime fixado pelo [ADR-045](../DECISIONS.md#adr-045) |
> | Timeout, limpeza de cache e retorno à tela inicial | `use-sessao.ts:15-22` — `sessionStorage`, `localStorage`, clipboard e `autocomplete="off"` |
> | Remote health e atualização | `POST /api/v1/kiosk/heartbeat` · `apps/kiosk/lib/reinicio.ts` |
> | *Plano, invoices e PIX* | **F52** — `kiosk-pagamento.service.ts`, `pagamento.tsx` |
>
> **Aceite provado por teste**, não por leitura: `kiosk-session.int-spec.ts` traz o caso marcado
> *"ACEITE DA FATIA — o aluno do tenant B não existe para o totem do tenant A"*, mais CPF inexistente e aluno
> de outro tenant devolvendo **a mesma resposta**, encerramento invalidando o token no ato, e sessão de um
> totem que não pode ser encerrada por outro — nem de outro tenant, nem do mesmo.
>
> ### As duas pendências de UI do card [#27](https://github.com/RodReis/arenahub/issues/27)
>
> | pendência (`DESIGN-UI.md` §17) | estado |
> |---|---|
> | item 3 — timeout de inatividade em segundos | ✅ **resolvido**: sessão de 60 s, `duracaoSegundos` lido da `KioskConfiguration` — nenhum valor fixo na tela ([ADR-042](../DECISIONS.md#adr-042), Decisão 0) |
> | item 6 — o que o totem imprime | ⚠️ **nunca foi requisito de código.** `M4-FR-020` manda **limpar** a fila de impressão, e isso está feito; *o que* imprimir segue pergunta aberta no `DESIGN-UI.md` §17, sem nada pendente no repositório |
>
> **O número `SPEC-027` fica queimado** e não é reaproveitado — mesma regra da [F33](../STATUS.md) e da
> [F28](SPEC-028-pagamento-e-desbloqueio-no-totem.md). A issue [#27](https://github.com/RodReis/arenahub/issues/27)
> segue aberta aguardando **fechamento pelo PI**: só ele fecha card.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-04-app-totem.md` §7, Slice 4.5, e o plano de apoio acima.

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
