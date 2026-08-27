# SPEC-031 — XP e conquistas

| campo | valor |
|---|---|
| **Fatia** | F31 |
| **MVP** | 5 |
| **Slice do PRD** | **5.2 e 5.4** — `docs/prd/academia/MVP-05-engagement.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-05-02-xp-achievements.md` |
| **Status** | ✅ `entregue` em 27/08/2026 |
| **ADRs que bloqueiam** | nenhum · **ADR-047** destrava a fatia e absorve a `SPEC-033` |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M5-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 5.2. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> MVP futuro. O PI não pode aprovar hoje o que ainda não foi discutido — e aprovar sem discutir é o que este processo existe para impedir.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-05-engagement.md` §7, Slice 5.2, e o plano de apoio acima.

## 2. Decisões específicas desta fatia

Todas com efeito além da fatia, portanto em **ADR-047** e suas duas emendas de 27/08/2026:

1. A fatia roda **antes do gate do MVP 5**, com o totem como superfície — o app do MVP 4 não existe, mas a frequência (F24) e o totem (F49–F52) existem.
2. **Absorve a `SPEC-033`** (Slice 5.4). `F33`/`SPEC-033` ficam queimadas.
3. O `M5-RULES-01` **não bloqueia**: o Code propôs o catálogo v1 (10 XP por sessão; conquistas em 1, 10, 50 e 100).
4. Identidade no placar segue `resolverExposicao()` (F30), com **nome abreviado** (`DS-TOTEM.md` §3.4c); coorte mínima **5**, configurável por tenant; período **mensal**.
5. O hero **lê ao vivo** o mês corrente; o snapshot guarda o **mês fechado**, publicado por job. Publicar o parcial todo dia colidiria com o `M5-AC-007`.
6. Sem BullMQ, worker ou despachante de outbox — projeção sob demanda, como a F24.
7. A tela pública passa para a **grade densa** do `DS-TOTEM.md` v2.1: o código citava uma regra do DS que a v2.1 já não tinha.

## 3. Escopo negativo

| fora | para onde foi |
|---|---|
| desafios e notificações | F34 |
| disputa, moderação de XP e recurso | F35 |
| ranking de evolução física relativa | exige `PHYSICAL_EVOLUTION_RANKING`, dormente desde a F30 (ver **INV-121**) |
| tela em `apps/mobile` | não existe; entra quando o MVP 4 existir |
| BullMQ, worker, despachante de outbox | o primeiro consumidor que precisar |
| streak semanal | F32 |
| exibir o snapshot do mês fechado numa tela | **decisão aberta ao PI** — hoje ele é artefato de auditoria, sem superfície de leitura |

## 4. Invariantes que esta fatia precisa preservar

**Novas** — `docs/CONVENTION.md` §4.21, cada uma com o teste que a prova citado:

`INV-156` (ledger append-only no banco) · `INV-157` (mesmo fato não concede XP duas vezes) ·
`INV-158` (regra resolvida pela data do fato) · `INV-159` (conquista sai de evidência, e sessão
revertida não conta) · `INV-160` (snapshot publicado nunca é reescrito) · `INV-161` (quem aparece
no placar é decidido na leitura).

**Preservadas de fatias anteriores:** `INV-003` (contexto de tenant no repositório), `INV-121`
(nada de ranking de "quem perdeu mais peso"), `INV-153` a `INV-155` (exposição pública — F30).

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| — | — | — | — |

## 6. Antes de codificar, confirme

- [x] O gate foi tratado por **ADR-047** (decisão do PI em 27/08/2026)
- [x] O `M5-RULES-01` foi resolvido como catálogo v1 proposto pelo Code
- [x] `lint`, `typecheck`, `test`, `test:integration` e `build` verdes antes do PR
