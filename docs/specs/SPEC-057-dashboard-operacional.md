# SPEC-057 — Dashboard operacional (nova porta de entrada do painel)

| campo | valor |
|---|---|
| **Fatia** | F57 |
| **MVP** | 1 *(posição na fila)* — o núcleo é o painel operacional da Slice 1.6 (`M1-AC-011`); dois blocos leem MVP 5 |
| **Slice do PRD** | não há. Escopo mora nesta spec (regra reaberta em 23/08/2026) |
| **Mockup** | [`docs/design/Dasboard.png`](../design/Dasboard.png) — **referência de estilo, não de layout** (decisão do PI, 01/09/2026) |
| **Superfície** | `admin-web` · `docs/design/DS-PAINEL.md` |
| **Card** | [#242](https://github.com/RodReis/arenahub/issues/242) |
| **Status** | `rascunho` — escrita em 01/09/2026 |
| **Depende de** | **[#241](https://github.com/RodReis/arenahub/issues/241) item 6** (motivo de bloqueio/suspensão) para o bloco 4 |

---

## 1. O que esta fatia entrega

Quem faz login **cai numa tela que responde "a academia está de pé?" em cinco segundos**, sem
clicar em nada. Hoje a raiz manda para `/operations`, que é a tela de investigação: lista de
alertas, detalhe de dispositivo, fila de sync. Investigação continua lá — o dashboard é o
resumo que decide se vale investigar.

---

## 2. Decisões do PI — 01/09/2026

| # | decisão | consequência |
|---|---|---|
| 1 | **Os sete blocos mandam; o mockup é referência de estilo** | o PNG mostra quatro blocos que a lista não tem (*Recusas hoje*, *Fila de sincronização*, lista de dispositivos com IP/heartbeat, *Sincronização de cadastros*). **Não entram** — todos já existem em `/operations`, que continua no menu com os alertas detalhados |
| 2 | **Login passa a cair no dashboard** | `app/page.tsx` deixa de redirecionar para `/operations`. Mudança de uma linha; o redirect já existe desde 24/08/2026 |
| 3 | **`Operação` continua no menu** | o dashboard **não substitui** `/operations`. Resumo e detalhe são telas diferentes |
| 4 | **Motivo de bloqueio/suspensão: lista fechada de quatro** | inadimplência, pedido do aluno, atestado médico, conduta — com observação livre opcional. **Inadimplência se carimba sozinha** pelo fluxo de cobrança que já é automático; as outras três são escolha de quem bloqueia. **Nasce na [#241](https://github.com/RodReis/arenahub/issues/241), não aqui** |
| 5 | **Feriados: biblioteca para nacionais + cadastro dos municipais** | ver §5 — é o item mais caro da fatia, e o único que cria entidade nova |
| 6 | **Placar/XP: criar a rota de leitura** | só existe `POST .../gerar` e `POST .../publicar`. Ver §4 |

---

## 3. Os sete blocos e o que cada um custa

| # | bloco | fonte | o que falta |
|---|---|---|---|
| 1 | Dispositivos online | `GET /operations/overview` → `dispositivos[]` | nada — contar `status` |
| 2 | Acessos hoje | `GET /operations/overview` → `acesso` | **hoje é janela móvel de 24 h** (`operations.repository.ts:100`, `ultimas24h`). Vira **dia civil da unidade** — ver §3.1 |
| 3 | Acessos em tempo real | `GET /access-events` + recarga de 5 s | nada na API. Ver §3.2 |
| 4 | Bloqueados/Suspensos com motivo | **#241 item 6** | a coluna e o enum nascem lá. Aqui é só leitura agregada |
| 5 | Placar e XP mensal | `GET /engagement/rankings/...` | **rota não existe.** Ver §4 |
| 6 | Desafios ativos | `GET /engagement/challenges` | nada — filtrar `status = ACTIVE` |
| 7 | Feriados | **nada existe** | entidade, seed nacional e CRUD municipal. Ver §5 |

### 3.1 "Hoje" é o dia da unidade, não 24 h e não UTC

`GymUnit.timezone` já guarda IANA (`America/Sao_Paulo`) por exigência do **ADR-019** — o dado
existe, só não é usado aqui. Dois lugares mentem hoje:

- `acesso.{allow,deny,override}` conta as **últimas 24 h corridas**. Às 9h da manhã isso inclui
  metade do movimento de ontem: o número da tela nunca bate com o que a recepção contou.
- `sync.totalDoDia` é o **dia corrente em UTC**. Entre 21h e meia-noite no horário de Brasília já
  virou o dia seguinte em UTC, e o contador zera na frente do operador, no pico.

O corte passa a ser meia-noite local da unidade. **Sem unidade selecionada não há "hoje"** — o
seletor do topo (que o mockup já mostra) deixa de ser conveniência e vira pré-condição do bloco.

### 3.2 A recarga de 5 s precisa parar quando ninguém está olhando

Cinco segundos é decisão do PI e não se discute. O que precisa entrar junto é o desligamento:
**a recarga pausa com a aba oculta** (`visibilitychange`) e **retoma ao voltar**. Um painel
esquecido aberto num turno de 12 h faz ~8.600 requisições sozinho; três recepções fazem 26 mil.
A API é a mesma que atende a catraca, e a catraca não pode disputar fila com uma aba minimizada.

`GET /access-events` já limita o período por padrão e pagina por cursor — o bloco pede
`limit=10`, sem cursor, e substitui a lista inteira a cada ciclo. Não acumula.

> WebSocket existe na stack e resolveria isso melhor. **Não entra nesta fatia** — trocar polling
> por push é decisão de arquitetura com custo próprio, e 5 s foi o que o PI pediu.

---

## 4. Placar e XP: a rota de leitura que falta

`engagement-xp.controller.ts` tem **só escrita**: `POST rankings/:gymUnitId/:mes/gerar` e
`POST rankings/:snapshotId/publicar`, ambas com `engagement.moderate`. Nasce:

**`GET /api/v1/engagement/rankings/:gymUnitId/:mes`** — permissão `engagement.read` (ler placar
não é o mesmo que gerar placar), devolve o snapshot e as `entries` por `position`.

Duas coisas que o desenho do banco já decide, e que a tela não pode contrariar:

- **O placar é snapshot mensal, não é ao vivo.** `RankingSnapshot` tem `localMonth`, `status`
  (`DRAFT` | `PUBLISHED`) e `publishedAt`. Entre uma publicação e outra o número **não anda**. O
  bloco mostra o mês corrente e **diz de quando é** — `DataFreshness` do `DS-PAINEL` §8.2. Um
  placar parado sem marca de idade é indistinguível de um job que morreu.
- **`DRAFT` não vaza para o dashboard.** Snapshot gerado e não publicado é rascunho de
  moderação; mostrá-lo no resumo tornaria a publicação decorativa.

> ⚠️ **Pergunta aberta — nome ou alias?** O consentimento `RANKING` é **opt-out** (ADR-046) e
> existe alias público justamente para o totem e o app. O painel é tela interna e o mockup já
> mostra nome real no feed de acessos. **Proposta:** painel mostra nome real; alias continua
> sendo do que é público. Precisa do seu "sim" antes de virar código.

---

## 5. Feriados — o bloco que não é um bloco

Este é o item que muda o tamanho da fatia. Os outros seis leem dado que já existe; este **cria
entidade nova, e ela tem dois consumidores esperando há semanas**:

- `retention/domain/selecao-de-fila.ts:104` — o SLA de **3 dias úteis** da fila de retenção
  (`M6-OPS-01`, F38) diz literalmente: *"Feriado não entra: exigiria calendário por unidade"*.
- `billing/domain/ciclo-de-cobranca.ts:48` e `bloqueio-por-inadimplencia.ts:32` — adiar
  vencimento por feriado está registrado como **política futura**, que entra "como valor novo".

**Decisão desta fatia: o calendário nasce só de leitura.** SLA de retenção e vencimento de fatura
**não mudam**. Fazer o contrário seria uma fatia de dashboard alterando cobrança em silêncio —
e reajustar vencimento é caro de desfazer, o que pede ADR, não PR.

> Isso deixa uma entidade com um consumidor decorativo por um tempo. É o risco que a **F45**
> já pagou com `student_addresses`, criada e nunca escrita. Aqui a diferença é que os dois
> consumidores reais **têm nome e linha de código** — a dívida é rastreável, não órfã.

### 5.1 Nacionais: biblioteca, e offline

Feriado nacional brasileiro é calculável (datas fixas + móveis ancoradas na Páscoa). Se entrar
biblioteca, **ela resolve em processo, nunca por API de terceiro em runtime**: o painel não pode
depender da rede de um serviço externo para desenhar um bloco, e a API roda em rede de academia.

### 5.2 Municipais: falta o município

⛔ **`GymUnit` não tem cidade.** Os campos são `code`, `name`, `timezone`, `openingHours`,
`status` — nada de município nem de código IBGE. Feriado municipal é **por cidade**, e a unidade
não sabe em qual está.

Duas saídas, e é decisão sua:

| saída | custo | efeito |
|---|---|---|
| **A** — cadastro municipal é **por unidade**, lista livre de datas | migração mínima, nenhuma mudança em `GymUnit` | duas unidades na mesma cidade cadastram o mesmo feriado duas vezes, e podem divergir |
| **B** — `GymUnit` ganha município (código IBGE), calendário é **por município** | migração em `GymUnit` + preencher as unidades existentes | uma cidade, um calendário. É o desenho correto, e é mais caro |

**Recomendo A** enquanto houver uma unidade por cidade. B vira necessário no dia em que a Arena
Positiva abrir a segunda unidade no mesmo município — e aí é migração, não redesenho.

---

## 6. Escopo negativo

| não faz | vai para |
|---|---|
| enum e coluna do motivo de bloqueio/suspensão | **#241** item 6 |
| feriado afetando SLA da fila de retenção | fatia própria, com ADR |
| feriado adiando vencimento de fatura | fatia própria, com ADR |
| trocar polling por WebSocket | decisão de arquitetura, fora desta fatia |
| aposentar `/operations` | **não acontece** — decisão 3 |
| os quatro blocos do mockup que não estão na lista | continuam em `/operations` |
| placar ao vivo (XP corrente sem publicação) | conceito novo; não é o ranking do ADR-046 |

---

## 7. Invariantes

- `INV` de tenant — todo bloco lê por `TenantContext`; nenhum recebe `tenantId` da query.
- Escopo de unidade — quem é gerente restrito à unidade A **não vê** o dashboard da unidade B,
  pelo mesmo `exigirEscopoDaUnidade` que o `engagement-xp.controller.ts` já aplica.
- Permissões — `access.read` para os blocos 1–4, `engagement.read` para 5 e 6. **Ver não é
  poder agir**: nenhum bloco do dashboard abre catraca, publica placar ou muda situação.
- `DataFreshness` (`DS-PAINEL` §8.2) — todo bloco cujo dado pode estar velho diz de quando é.

---

## 8. Critérios de aceite

- [ ] AC-1 — login cai no dashboard; `Operação` continua no menu e abre os alertas detalhados
- [ ] AC-2 — *Acessos hoje* zera à meia-noite **da unidade**, não em UTC e não 24 h atrás
- [ ] AC-3 — o feed recarrega a cada 5 s e **para** com a aba oculta; volta ao reabrir
- [ ] AC-4 — bloqueados/suspensos aparecem **com o motivo** da lista de quatro
- [ ] AC-5 — o placar mostra o snapshot **publicado** do mês e a data dele; `DRAFT` não aparece
- [ ] AC-6 — desafios `ACTIVE` aparecem; `DRAFT`, `CLOSED` e `CANCELLED` não
- [ ] AC-7 — feriados do mês aparecem; nacional sem cadastro manual, municipal cadastrável
- [ ] AC-8 — gerente restrito à unidade A não lê número nenhum da unidade B
- [ ] AC-9 — `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e` e `build` verdes

---

## 9. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Placar mostra nome real ou alias? (§4) | | |
| 2 | Feriado municipal: saída A (por unidade) ou B (município em `GymUnit`)? (§5.2) | | |
| 3 | Feriados é fatia própria (F58) ou fica aqui dentro? | | |

---

## 10. Fora de dúvida

- **O mockup não é o layout** — o PI decidiu em 01/09/2026 que a lista de sete blocos manda. O
  PNG entra como direção visual: densidade, cartão de KPI, escala tipográfica, o seletor de
  unidade no topo, o "Atualizado às HH:MM".
- **Não somos plataforma de alerta.** O dashboard resume; quem investiga vai para `/operations`.
- **Nenhum bloco escreve.** Sete leituras e nada mais — a tela que todo mundo deixa aberta é a
  pior lugar para pôr um botão que muda estado.
