# SPEC-030 — Preferências e identidade pública

| campo | valor |
|---|---|
| **Fatia** | F30 |
| **MVP** | 5 |
| **Slice do PRD** | **5.1** — `docs/prd/academia/MVP-05-engagement.md` §7 (emendada por **ADR-046**) |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-05-01-preferences-public-identity.md` — **superado em parte pelo ADR-046**: supunha app e `StudentChannelContext`, nenhum dos dois existe. Design vigente: `docs/superpowers/specs/2026-08-26-f30-preferencias-e-identidade-publica-design.md` |
| **Status** | `entregue` — 27/08/2026 |
| **ADRs que bloqueiam** | nenhum — **ADR-046** é o que esta fatia cria, não o que a bloqueia |

> **Esta spec é um ponteiro (ADR-022).** O escopo, os requisitos (`M5-FR/BR/NFR/AC`) e os
> critérios de aceite **moram no PRD**, na Slice 5.1. Este arquivo não os copia — copiar cria
> uma segunda verdade que diverge na primeira mudança.
>
> **Reconciliada em 26–27/08/2026 contra o ADR-046.** O plano de apoio de 14/08 e o texto
> original da Slice 5.1 supunham um app mobile que não existe (`apps/mobile/.gitkeep`). O PI
> tomou três decisões em 26/08/2026 que redesenham a fatia — ver §2.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-05-engagement.md` §7, Slice 5.1 (emendada), e o design vigente:
`docs/superpowers/specs/2026-08-26-f30-preferencias-e-identidade-publica-design.md`.

Resumo do que existe no código, ao final da fatia: domínio puro (`participaDoRanking`,
`resolverExposicao`, `triarAlias`) em `apps/api/src/modules/engagement/domain/`;
`ConsentDocumentType` com quatro finalidades novas; tabela `PublicProfile` com unicidade de alias
em índice parcial sobre `APPROVED`; quatro casos de uso (`ObterPreferencias`,
`AtualizarPreferencia`, `DefinirAliasPublico`, `ModerarAlias`); três rotas no totem
(`apps/kiosk`) e duas no painel (`apps/admin-web`); duas telas no totem e a fila de moderação no
painel.

## 2. Decisões específicas desta fatia

Três decisões do PI, tomadas em 26/08/2026 e registradas em detalhe no **ADR-046**:

1. **A superfície é o totem (`apps/kiosk`), não o app.** A Slice 5.1 dizia "app"; `apps/mobile/`
   tem só um `.gitkeep`. O totem já identifica o aluno por CPF (ADR-045) e já reservava
   `modulos.ranking` no contrato de `KioskConfiguration`, desligado desde a F50. Emenda
   `MVP-05` §7 Slice 5.1 e §1 (dependências).
2. **O gate do MVP 5 não alcança esta fatia.** O gate original — *"eventos confiáveis + app do
   MVP 4"* — descreve o que F31–F35 vão precisar (evento de frequência/pagamento, telas no app),
   não o que a F30 precisa: ela não lê evento nenhum e não abre tela em `apps/mobile`. Emenda
   `MVP-05` §1. **NÃO alcança F31–F35**, que seguem atrás do gate original.
3. **Consentimento de ranking vira opt-out.** Os alunos já estão aceitos e autorizados; o
   critério de aceite da Slice 5.1 — *"aluno não consentido nunca aparece em API, cache,
   exportação ou tela pública"* — deixa de existir como tal, porque não há mais "aluno não
   consentido". Passa a ser: *"aluno que pediu para sair nunca aparece, a partir da próxima
   projeção"*.

**A consequência que a Decisão 3 exige registrar:** a mesma tabela `ConsentRecord` passa a
sustentar **dois regimes opostos** de ausência de linha — biometria/saúde/IA continuam
`BIOMETRIC`/`HEALTH`/`AI_ANALYSIS` = **não autorizado**; as quatro finalidades de engajamento
(`RANKING`, `CHALLENGE`, `ENGAGEMENT_PUSH`, `PHYSICAL_EVOLUTION_RANKING`) = **participa**. Os
predicados vivem separados de propósito — `avaliarConsentimento()` em `modules/privacy` para o
primeiro regime, `participaDoRanking()` em `modules/engagement/domain/participacao.ts` para o
segundo — porque um predicado servindo aos dois regimes passaria verde enquanto nenhum teste
misturasse os casos, e inverteria um dos dois em silêncio.

## 3. Escopo negativo

| fora | motivo | onde entra |
|---|---|---|
| `HIDDEN` sem caminho de escrita | o estado existe no `PublicProfileStatus` e no filtro de listagem, mas nenhuma rota o grava — só se alcança por SQL manual. `HIDDEN` é "ocultar depois de aprovado", que nasce de denúncia, e não há canal de denúncia nesta fatia | F35 (moderação reativa) |
| Outbox de engajamento | nenhum consumidor existe hoje; a Regra de arquitetura 5 obriga o evento a ser persistido na mesma transação da mudança de estado, não a inventar evento sem consumidor | F33, quando existir consumidor |
| Cache de exposição e invalidação | não há ranking para cachear — a F30 decide quem pode aparecer, a F33 calcula posição | F33, quando existir snapshot |
| Cálculo de ranking, snapshots, desempate | fora do escopo da Slice 5.1 | F33 (Slice 5.4) |
| XP, ledger, conquistas | fora do escopo da Slice 5.1 | F31/F32 (Slices 5.2/5.3) |
| Desafios | fora do escopo da Slice 5.1 | F34 (Slice 5.5) |
| Push e notificação | não há app | MVP 4 |
| Qualquer tela em `apps/mobile` | não existe superfície | MVP 4 |
| Screening de alias por IA | não foi pedido; há humano na fila de moderação por decisão do PI | — |

## 4. Invariantes que esta fatia precisa preservar

- **INV-153** *(nova)* Apelido não aprovado nunca é exibido — `resolverExposicao()` só mostra
  `alias` quando `PublicProfile.status = APPROVED`. Provado por
  `apps/api/src/modules/engagement/domain/exposicao.spec.ts` e pelo teste de índice parcial em
  `apps/api/test/integration/engagement.int-spec.ts`.
- **INV-154** *(nova)* Ausência de `ConsentRecord` de engajamento significa que o aluno participa
  — o oposto do regime de biometria/saúde/IA. Provado por
  `apps/api/src/modules/engagement/domain/participacao.spec.ts`, com teste dedicado que falha se
  o default for invertido.
- **INV-155** *(nova)* Aluno com `Student.status` diferente de `ACTIVE` nunca aparece em
  exposição pública, mesmo participando e com apelido aprovado. Provado por `exposicao.spec.ts`
  (`motivo: 'ALUNO_INATIVO'`), inclusive o caso em que `ALUNO_INATIVO` precisa vencer `OPT_OUT`
  na ordem de checagem.
- **INV-021** Consentimento é versionado e revogável, com versão, finalidade, ator, IP e
  dispositivo — `AtualizarPreferencia` grava `ConsentRecord` com `supersededAt` na linha
  anterior, na mesma transação.
- Regra de arquitetura 2 (`tenant_id` em toda entidade de negócio, vindo do `TenantContext`
  autenticado) — `PublicProfile` e o repositório de engajamento.

As três novas ficam numeradas em `docs/CONVENTION.md` §4.20, e INV-120 (§4.15, "ranking é
opt-in") foi emendado pelo ADR-046 para refletir o opt-out.

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | A Slice 5.1 fala em "app" — o canal do aluno para esta fatia é o app do MVP 4 ou o totem que já existe? | O totem (`apps/kiosk`). Vira **ADR-046**, Decisão 1 | 26/08/2026 |
| 2 | O gate do MVP 5 (*"eventos confiáveis + app do MVP 4"*) bloqueia a F30? | Não — a F30 não lê evento nem depende do app. Gate segue valendo para F31–F35. **ADR-046**, Decisão 2 | 26/08/2026 |
| 3 | O consentimento de ranking continua opt-in, como a Slice 5.1 escreveu? | Não — os alunos já estão aceitos e autorizados. Vira **opt-out**: participa por padrão, sai quem pedir. **ADR-046**, Decisão 3 | 26/08/2026 |

## 6. Antes de codificar, confirme

- [x] Status desta spec é `aprovada-pi` — nasceu **direto entregue**: as três decisões do PI em
      26/08/2026 aprovaram escopo e execução na mesma conversa (ADR-046)
- [x] Os ADRs listados acima estão resolvidos — nenhum bloqueia; o ADR-046 é o que esta fatia cria
- [x] O gate de entrada do MVP tem evidência registrada — **não se aplica a esta fatia**
      (ADR-046, Decisão 2)
