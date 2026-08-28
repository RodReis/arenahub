# SPEC-034 — Desafios e notificações

| campo | valor |
|---|---|
| **Fatia** | F34 |
| **MVP** | 5 |
| **Slice do PRD** | **5.5** — `docs/prd/academia/MVP-05-engagement.md` §7 |
| **Plano de apoio** | `docs/superpowers/plans/2026-08-14-mvp-05-05-challenges-notifications.md` |
| **Status** | ✅ **entregue** em 28/08/2026 |
| **ADRs que bloqueiam** | nenhum — **ADR-048** autoriza a fatia antes do gate do MVP 5 |

> **Esta spec é um ponteiro (ADR-022).** O escopo e os requisitos (`M5-FR/BR/NFR/AC`) moram no
> PRD, na Slice 5.5. O que este arquivo acrescenta é o que **divergiu** do PRD e do plano, com o
> ADR que autorizou cada divergência.

---

## 1. O que esta fatia entrega

Ver `docs/prd/academia/MVP-05-engagement.md` §7, Slice 5.5.

**Superfícies:** painel (`admin-web`, a secretaria cria e opera) e totem (`kiosk`, o aluno vê e
adere, mais o bloco na tela pública).

---

## 2. Decisões específicas desta fatia

Todas em **ADR-048** e suas duas emendas, decididas pelo PI em 28/08/2026.

| # | decisão | por quê |
|---|---|---|
| 1 | A fatia **roda antes do gate** do MVP 5, com o totem como superfície | o app do MVP 4 não existe; os eventos confiáveis existem desde a F24 |
| 2 | ~~Desafio é opt-in~~ → **inscrição automática** | *(emenda 1)* desafio que nasce vazio não engaja; entra todo aluno `ACTIVE` com entitlement `ACTIVE` |
| 3 | Notificação é **aviso no totem**, sem canal externo | não há canal no produto; sem envio não há quiet hours nem orçamento de contato |
| 4 | Template fixa o **teto profissional**, versionado | `M5-BR-011` verificável; o desafio copia a versão e editar o template não altera desafio em curso |
| 5 | Bloco na tela pública é o **sexto tipo do carrossel** | *(emenda 2)* a grade do hero tem 6 composições fechadas numa tela de 1080×1920 que não rola |

### Três decisões do PI que fecham a inscrição automática

| pergunta | decisão |
|---|---|
| quem entra | aluno `ACTIVE` **e** entitlement `ACTIVE` — a mesma cadeia da catraca |
| e se ficar inadimplente no meio | **continua** — desafio é engajamento, não cobrança |
| pode sair | **sim, pelo totem**; e quem saiu **não é reinscrito** |

### Editar, excluir e cancelar

Pedido do PI em 28/08/2026. As guardas não são preferência:

| ação | rascunho ou aberto **vazio** | **com participante** | encerrado |
|---|---|---|---|
| Editar | ✅ | ❌ | ❌ |
| Excluir | ✅ | ❌ | ❌ |
| Cancelar | ✅ | **✅** | ❌ |

- **Participante trava editar:** mudar a meta depois do aceite altera o combinado — o aluno entrou
  para bater 8 e acordaria tendo de bater outro número. Mesmo princípio do `M5-BR-009`.
- **Participante trava excluir:** as FKs são `onDelete: Cascade`, então excluir apagaria a adesão e
  o aviso junto, contra o `M5-FR-014`. Para esse caso existe **cancelar**, que preserva tudo.
- A tela **esconde** editar/excluir quando há inscrito, em vez de mostrar botão que sempre falha.
- **Confirmação obrigatória** nas duas ações destrutivas (relatado pelo PI: *"está excluindo direto
  sem msg de confirmação, não pode"*). Inline, com verbo real (`DS-PAINEL.md` §6), foco inicial em
  *Voltar* e Esc para desistir.

---

## 3. Escopo negativo

O que esta fatia **deliberadamente não faz**, e para onde foi:

| não entregue | por quê | para onde |
|---|---|---|
| **Canal externo** (push, e-mail, SMS, WhatsApp) | não existe canal nenhum no produto, e push exigiria o app do MVP 4 | fatia que trouxer um canal |
| **Quiet hours** e **orçamento de contato** | não existe "hora errada" quando é o aluno que chega ao totem | idem — só fazem sentido com envio |
| **Fronteira transacional × marketing** | pergunta que só se coloca quando houver canal; `ENGAGEMENT_PUSH` segue dormente | idem |
| **Fila de contestação, moderação, recálculo** | é a Slice 5.6 | F35, atrás do gate do MVP 5 |
| **Ranking do desafio** (quem está na frente) | exigiria `resolverExposicao()` como o placar; `M3.5-BR-001` proíbe dado de aluno na parede | decisão futura do PI |
| **Rodízio entre desafios** no bloco público | rodízio dentro de rodízio; ninguém acompanha | — |
| **Tabela de progresso** | `StudentAttendanceSession` (F24) já é a projeção; materializar criaria segunda fonte de verdade | — |

---

## 4. Invariantes que esta fatia preserva

| invariante / regra | como |
|---|---|
| **Regra de arquitetura 2** (tenant da identidade) | toda operação da porta recebe `TenantContext`; `deleteMany`/`updateMany` filtram por tenant no `WHERE` |
| **Regra de arquitetura 9** (módulo não lê tabela de outro) | `KioskModule` consome `EngagementChallengesService`; nunca `Challenge`/`ChallengeParticipant` direto |
| **`M5-BR-011`** (teto profissional) | validado na criação **e revalidado na edição** — senão editar seria caminho lateral para meta que a criação recusa |
| **`M5-BR-009`** (regra que muda não reescreve o passado) | o desafio guarda `templateVersionId`, não o código; o modelo não é editável |
| **`M5-FR-014`** (histórico preservado) | sair vira `LEFT`, nunca apaga a linha; excluir é recusado com participante |
| **`M3.5-BR-001`** (sem dado de aluno na tela pública) | o bloco não mostra nome nem contagem; teste prova que o schema descarta `studentId` e `inscritos` |
| **Idempotência** | avisos na unique `(desafio, aluno, tipo)`; adesão na unique `(desafio, aluno)`; `encerrar()` reprocessável |

---

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | A fatia pode rodar antes do gate do MVP 5? | **sim** → ADR-048 | 28/08/2026 |
| 2 | Notificação com canal externo ou aviso no totem? | **aviso no totem** (opção A) | 28/08/2026 |
| 3 | Quem cria o desafio? | **a secretaria**, pelo painel | 28/08/2026 |
| 4 | Aluno adere ou entra automático? | **automático**, se ativo e em dia → emenda 1 | 28/08/2026 |
| 5 | E quem fica inadimplente no meio? | **continua no desafio** | 28/08/2026 |
| 6 | Pode sair de um desafio automático? | **sim, pelo totem** | 28/08/2026 |
| 7 | Editar/excluir/cancelar, ou só editar/excluir? | **os três** (opção 1) | 28/08/2026 |
| 8 | Bloco de desafio na tela pública agora? | **sim** (opção 1) → emenda 2 | 28/08/2026 |

---

## 6. Antes de codificar, confirme

- [x] ADR que autoriza a fatia antes do gate — **ADR-048**
- [x] As decisões de produto respondidas pelo PI (tabela §5)
- [x] O escopo negativo registrado, para a F35 não presumir o que esta fatia decidiu
