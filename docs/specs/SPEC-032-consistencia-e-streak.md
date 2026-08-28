# SPEC-032 — Consistência e streak

| campo | valor |
|---|---|
| **Fatia** | F32 |
| **MVP** | 5 |
| **Slice do PRD** | **5.3** — `docs/prd/academia/MVP-05-engagement.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-05-03-consistency-streak.md` |
| **Status** | `entregue` — 28/08/2026, PR [#214](https://github.com/RodReis/arenahub/pull/214) |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M5-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 5.3. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Destravada em 28/08/2026 por decisão do PI**, no mesmo padrão de ADR-046 (F30) e ADR-047 (F31):
> o gate original do MVP 5 exigia *"eventos confiáveis + app do MVP 4"*, e o app segue como
> `apps/mobile/.gitkeep`. A superfície é o **totem** (`apps/kiosk`), não o app.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-05-engagement.md` §7, Slice 5.3, e o plano de apoio acima.

## 2. Decisões específicas desta fatia

Três decisões do PI em 28/08/2026, e uma do Code:

| # | decisão | de quem |
|---|---|---|
| 1 | **F32 roda antes do gate do MVP 5** — mesma exceção de ADR-046/047 | PI |
| 2 | **Superfície é o totem** (`apps/kiosk`), no card *Meus pontos* já existente | PI |
| 3 | **Meta: 3 sessões/semana, semana de segunda a domingo** — versionada em `semana-civil-local@1` | PI |
| 4 | **Sem tabela de projeção** — o streak é derivado de `StudentAttendanceSession` (F24) | Code |

### Por que não há tabela de streak

O plano de apoio previa `StreakPolicy`, `StreakPolicyVersion`, `StudentStreak`,
`StudentStreakWeek` e `StreakProjectionVersion`. Nenhuma foi criada.

`StudentAttendanceSession` **já é** a projeção de dias treinados, deduplicada por
`(tenant, aluno, dia local, unidade, política)` num índice único desde a F24. O streak é uma
**função** dela. Materializar numa segunda tabela criaria uma fonte de verdade paralela que
precisa de rebuild e pode divergir da primeira — e a F31 já resolveu o mesmo problema pelo mesmo
caminho, com `posicaoAoVivoDoAluno` calculando o placar do mês corrente ao vivo em vez de
snapshot.

Consequência direta: a *"prevenção de múltipla pontuação diária"* da Slice 5.3 **não é um `if`
nesta fatia** — é o índice único da F24, no banco. Guarda que lê antes de escrever perde a corrida
por construção (F14, F17, F18).

### Pausa: reconstruída da timeline, não de `Subscription.status`

`M5-FR-009` precisa saber que houve pausa **em agosto**, mesmo com a assinatura ativa hoje.
`Subscription.status` guarda o estado corrente e não serve. O repositório reconstrói os intervalos
a partir de `StudentTimelineEvent` (`SUBSCRIPTION_PAUSED` / `SUBSCRIPTION_RESUMED`), que
`membership.repository.ts` já grava. Pausa sem retomada fica em aberto (`fim: null`).

**A pausa isenta a semana INTEIRA ou nada.** Pausa parcial deixa dias treináveis de fora, e isentar
a semana toda daria isenção de graça a quem pausou um dia.

**A meta vence a pausa:** quem bateu os 3 dias durante a pausa ganha a semana. Pausar não proíbe
treinar, e a ordem inversa esconderia a semana qualificada de quem treinou.

## 3. Escopo negativo

| não faz | por quê / para onde foi |
|---|---|
| **Nenhuma tabela nova** | o streak é derivado — ver §2 |
| **Não emite `StreakExtended` / `StreakBroken`** | o PRD §evento os lista, mas não há consumidor nesta fatia. Outbox sem consumidor é código morto — entra quando a F34 (notificações) precisar |
| **Não expõe `GET /api/v1/mobile/streak`** | não há app (`apps/mobile/.gitkeep`). A consistência viaja no endpoint de XP do totem, que a tela já chama |
| **Não configura a meta por tenant** | a política é constante versionada (`semana-civil-local@1`). Tabela de política só quando houver segunda academia querendo meta diferente |
| **Não exibe streak no painel nem no ranking** | Slice 5.3 fala do aluno. Ranking por consistência é F34/F35 |

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde o teste prova |
|---|---|
| **INV-003** — `TenantContext` obrigatório em todo método de repositório | `diasTreinados` e `pausasAprovadas` recebem contexto; integração: *"não devolve a consistência de aluno de outra sessão"* |
| **Dedup diária da F24** (índice único de `StudentAttendanceSession`) | integração: *"conta DIAS, não passagens"* — 4 passagens em 2 dias contam 2 |
| **`M5-BR-005`** — semanas consistentes, nunca dias ilimitados | unidade: *"sete dias valem o mesmo que três"*; tela: *"NÃO fala em dias seguidos"* |
| **`M5-FR-009`** — pausa aprovada não rompe streak | unidade + integração (pela timeline) + o par *"SEM a pausa, o mesmo histórico rompe"* |
| **§13 do PRD** — sem linguagem de culpa | tela: o texto da semana abaixo da meta não casa `/perdeu\|falhou\|você não\|quebrou/` |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | F32 roda antes do gate do MVP 5? | **Sim** | 28/08/2026 |
| 2 | Superfície: totem, API+painel, ou esperar o app? | **Totem**, como F30/F31 | 28/08/2026 |
| 3 | Pausa: ler o `PAUSED` existente, stub, ou modelar tabela nova? | **Ler o que existe** (reconstruído da timeline) | 28/08/2026 |
| 4 | Meta semanal e início da semana? | **3 sessões, segunda a domingo** | 28/08/2026 |

## 6. Evidência

`pnpm test:report --issue 32 --spec SPEC-032`, em 28/08/2026 — ver `reports/TESTS.md`.

- **Unitário**: 2240/2240, 0 falhas — 25 casos novos em `semana-de-consistencia.spec.ts`, 10 no
  service, 11 na tela do totem.
- **Integração**: 698/698 em `apps/api` + 60/60 em `packages/database`, 0 falhas, medidos suíte a
  suíte (o crash conhecido do Jest no Windows, exit `3221226505`, impede o resumo agregado —
  `docs/TESTING.md` §5).
- **Contrato**: o snapshot OpenAPI (`packages/api-contracts/openapi/arenahub-v1.json`) foi
  regenerado — a guarda pegou a mudança de schema, que é legítima.

**A guarda de contrato foi a única a falhar, e pegou o que devia.** A execução isolada da suíte de
XP passava; só a suíte completa acusou o snapshot desatualizado.
