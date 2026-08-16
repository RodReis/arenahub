# SPEC-010 — Operação offline

| campo | valor |
|---|---|
| **Fatia** | F10 |
| **MVP** | 1.5 |
| **Slice do PRD** | **1.5** — `docs/prd/academia/MVP-01-smart-access.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-01-05-offline-operation.md` |
| **Status** | `aprovada-pi` |
| **ADRs que bloqueiam** | nenhum. **ADR-007 fechou em 16/08/2026**; o ADR-011 fechou em 14/08/2026 |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M1-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 1.5. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Aprovada pelo PI em 16/08/2026**, com o fechamento do **ADR-007**. **Sem urgência:** esta
> fatia migrou para o MVP 1.5 por ADR-012 — o gate é o MVP 1 em piloto com incidente de link
> medido.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-01-smart-access.md` §7, Slice 1.5, e o plano de apoio acima.

## 2. Decisões específicas desta fatia

*(preencher quando houver — decisão com efeito além da fatia vira ADR, não fica aqui)*

As quatro decisões de semântica offline viraram **ADR-007**, fechado em 16/08/2026. Não se
repetem aqui. O que a fatia precisa absorver delas:

1. **Idade do snapshot é dado de operação.** A restrição da janela de carência (decisão 1) só não
   vira negativa frequente porque o stream mantém o snapshot fresco (decisão 4). O painel
   operacional precisa mostrar **a idade**, não apenas online/offline — senão falha de rede chega
   ao suporte disfarçada de bug de acesso. O `DataFreshness` de
   [`docs/design/DS-PAINEL.md`](../design/DS-PAINEL.md) §8.2 é o componente.
2. **Denylist de consentimento revogado no snapshot — campo que não existe.** A decisão 3 obriga
   o Edge a bloquear offline quem revogou consentimento biométrico. F8 entregou bloqueio lógico
   **na nuvem**; não há lista que o Edge carregue. Isto altera o contrato de snapshot que F4 já
   implementou, e alteração de contrato Edge é **versionada por ADR-011**.
3. **`ALLOWED_OFFLINE_CONFLICT` registra a passagem, não revalida o direito.** O evento entra como
   fato ocorrido e sinalizado. Não cria entitlement, não reabre janela, não altera cobrança.

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
