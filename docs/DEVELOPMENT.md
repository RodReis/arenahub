# DEVELOPMENT.md — ordem de execução do ArenaHub

> **Dono deste arquivo: Claude Code.** Atualize a cada entrega, junto com `docs/STATUS.md`.
>
> `STATUS.md` responde *"em que pé está?"*. **Este arquivo responde *"o que faço agora, e em
> que ordem?"***. Os passos de uma fatia moram aqui — **nunca** viram issue separada
> (`card = fatia`).

**Estado em 17/08/2026:** bootstrap fechado ([#42](https://github.com/RodReis/arenahub/issues/42)–[#47](https://github.com/RodReis/arenahub/issues/47))
e a *exceção de arranque* morreu — o CI decide o merge. Entregues: **F1, F4, F6, F7, F8, F9 e F11**,
mais a ponte EasyInner ([#61](https://github.com/RodReis/arenahub/issues/61)) e o **pipeline de
tokens** ([#79](https://github.com/RodReis/arenahub/issues/79)). **F2 e F3 não
travam em código** — dependem de consentimento, cutover da catraca e janela combinada com o PI.
Registro linha a linha na §5. O board (Projects) em si continua pendente — ver §4.

✅ **O código das janelas físicas de 17/08 entrou na `main`** — PR
[#90](https://github.com/RodReis/arenahub/pull/90) (F3, relatório da catraca) e
[#91](https://github.com/RodReis/arenahub/pull/91) (F2: `senduser` v2.16, `conectar`, `lab:run`).
O *fechamento frágil* registrado no `STATUS.md` — código de 17/08 vivo só no remoto, sem PR —
**acabou**. Nenhuma das duas fatias avança de coluna: falta `M0-AC-002` (remoção exercitada) e o
modo bloqueado da catraca, que são **bancada**, não código.

> ⚠️ **No board, `proplan:doing` são F2 e F10** — não F2 e F3. A F10 destravou com o fecho do
> ADR-007, mas o **ADR-012 mantém o MVP 1.5 fechado** até o piloto produzir incidente medido de
> queda de link: ela está tecnicamente pegável e processualmente parada.

---

## 1. Antes de escrever a primeira linha

Checklist obrigatório a cada fatia. Falhou um item, **pare e pergunte ao PI** — não contorne.

- [ ] A fatia tem **spec `aprovada-pi`** em `docs/specs/`?
- [ ] Os **ADRs que a bloqueiam** (coluna do `STATUS.md` §3) estão resolvidos?
- [ ] O **gate de entrada do MVP** tem evidência registrada?
- [ ] Existe **card no board** com o título no padrão `[MVP<n>][SPEC-<nnn>][F<n>]`?
- [ ] Li a spec, a slice correspondente do PRD e o plano em `docs/superpowers/plans/`?
- [ ] Sei quais **invariantes** (`docs/CONVENTION.md` §4) esta fatia precisa preservar?

> Onde o plano divergir do PRD, **o PRD vence** e a divergência vira pergunta — não escolha
> silenciosa. Já há uma conhecida: o índice do MVP 2 ampliou o contrato `PaymentProvider` de 6
> para 10 métodos sem emendar o PRD (ADR-013).

---

## 2. Ciclo de uma fatia

```
1. pegar card         → proplan:todo, se atribuir
2. iniciar            → proplan:doing
3. branch             → f<n>-<slug>            ex.: f8-biometria-sync
4. teste primeiro     → o teste que descreve o comportamento da spec
5. menor implementação que faz o teste passar
6. verificar          → pnpm lint && pnpm typecheck && pnpm test && pnpm build
7. atualizar docs     → STATUS.md, DEVELOPMENT.md, checklist do PRD,
                        OpenAPI, contratos de evento, migrações, ADR se houve decisão
8. PR                 → corpo com "refs #N"    ⚠ NUNCA "closes #N"
9. CI verde           → merge (o merge é seu)
10. proplan:done      → com o link do PR no corpo da issue
11. parar             → só o PI fecha a issue e aplica proplan:finalizado
```

**Commit em PT-BR.** Mensagem descreve o efeito, não o arquivo: `adiciona bloqueio lógico
imediato na revogação de biometria`, não `atualiza service`.

> ⚠️ **Depois de clonar, rode `pnpm --filter @arenahub/database generate` antes do primeiro
> `lint`.** O client do Prisma é gerado, não versionado. Sem ele, `lint` e `typecheck` falham com
> erro que parece de código (`no-unsafe-call`) mas é de arquivo ausente. **Foi o primeiro defeito
> que o CI pegou:** passava na máquina de quem já tinha rodado `generate` e falhava no runner
> limpo — verde local, vermelho remoto.

### Exceção de arranque — ✅ encerrada em 14/08/2026

**O ciclo acima vale inteiro.** A exceção morreu quando o CI passou a existir
([#47](https://github.com/RodReis/arenahub/issues/47), PR
[#54](https://github.com/RodReis/arenahub/pull/54)). O que segue é histórico.

Enquanto o bootstrap não fechava, quatro exigências ficaram suspensas: card no board antes de
começar, CI verde antes do merge, cobertura ≥ 80% e OpenAPI atualizado. As duas primeiras porque
não há como criar um card para criar o board, nem exigir CI verde do PR que cria o CI; as duas
últimas porque encanamento não tem regra de domínio. Em lugar do CI, os PRs de bootstrap colaram
a **execução local** no corpo.

**O que nunca esteve sob exceção, e continua:** PR com `refs #N`, nunca `closes`; merge do próprio
Code; aceite exclusivo do PI; commit em PT-BR; nenhum segredo versionado.

> ⚠️ **Uma coisa que a exceção cobria segue pendente: o board (Projects) não existe.** Só as
> labels `proplan:*`. Enquanto não existir, "mover o card" é aplicar label, não arrastar cartão —
> o passo 1 do ciclo acima se cumpre pela label. Isso **não** reabre a exceção: o portão de merge,
> que era o que realmente faltava, está de pé.

#### O que mudou na prática

| exigência | antes | agora |
|---|---|---|
| CI verde antes do merge | execução local colada no PR | **o CI decide** — 8 passos, `docs/TESTING.md` §6 |
| guarda de evidência | não existia | `pnpm test:report --check` **barra o merge** |
| cobertura ≥ 80% em regra de domínio | `n/a` — não havia regra | vale na primeira fatia com regra |
| OpenAPI e contratos de evento | `n/a` pelo mesmo motivo | valem quando houver endpoint e evento |

**Quatro dos oito passos do CI ainda falham de propósito** — `test`, `test:integration`, `build`
e `test:e2e`, porque nenhum workspace os declara. Estão marcados `continue-on-error` no workflow,
e **cada um perde essa marca na fatia que criar o workspace correspondente**. Ver §4.

---

## 3. Definição de pronto

Herdada de `docs/prd/README.md` §11, com o que o processo do trio acrescenta:

- [ ] Requisitos e critérios de aceite da fatia atendidos
- [ ] Migrações aplicadas, **rollback documentado**
- [ ] Testes verdes; regras de domínio com **cobertura ≥ 80%**
- [ ] `lint`, `typecheck`, `build` verdes
- [ ] OpenAPI e contratos de evento atualizados
- [ ] Telemetria e mensagens operacionais existem
- [ ] Isolamento de tenant, autorização e auditoria verificados **com teste**
- [ ] Evidência registrada no checklist do PRD **e** no `docs/TESTING.md`
- [ ] Nenhuma decisão bloqueante pendente
- [ ] **PR mergeado.** Declarar "terminei" sem PR mergeado é fechamento frágil

---

## 4. Ordem de execução

### Bootstrap — cards `[INFRA]` · sem fatia, sem SPEC, sem MVP

**Não tem número `F`.** Não é fatia: não há escopo de produto a assumir, só a infraestrutura que
o PRD já fixou em `docs/prd/README.md` §5/§7. Por isso não entra no Índice Fatia ↔ SPEC — o que
seria violar ADR-015, que reserva o Índice para Slices do PRD.

> **Divergência registrada, pergunta ao PI:** o PRD coloca *"bootstrap do monorepo e ambientes
> locais"* dentro da **Slice 1.1** (`MVP-01` §7 = F6), enquanto a Task 1 do plano do MVP 0 já
> cria `package.json` e `tsconfig` — ou seja, o bootstrap **precisa acontecer antes de F1** para
> a bancada existir. Estes cards `[INFRA]` resolvem a ordem prática; o PI decide se a Slice 1.1
> perde esse item ou se ele é repetido lá como verificação.

**O `#` é identidade permanente, não ordem.** Ele é citado de fora — ADR-023 (`DECISIONS.md`), o
`STATUS.md` §1/§6 e a *exceção de arranque* da §2 apontam para "item 7", "itens 1–6", "itens 1–8".
Renumerar tornaria essas frases falsas em arquivo que não é do Code. Quem manda na execução é a
coluna **ordem**.

| # | ordem | passo | card | evidência de pronto |
|---|---|---|---|---|
| 7 | **1º** | Board no GitHub: 5 colunas, 5 labels `proplan:*` | — *(exceção de arranque)* | board existe |
| 1 | 2º | Monorepo pnpm + Turborepo com o layout de `apps/`, `packages/`, `infra/` | [#42](https://github.com/RodReis/arenahub/issues/42) | `pnpm install --frozen-lockfile` passa |
| 2 | 3º | TypeScript estrito + ESLint + Prettier em `packages/config` | [#43](https://github.com/RodReis/arenahub/issues/43) | `pnpm lint` e `pnpm typecheck` verdes num repo vazio |
| 4 | 4º | `docker-compose` com Postgres + Redis + MinIO | [#45](https://github.com/RodReis/arenahub/issues/45) | `docker compose up` sobe os três |
| 3 | 5º | Os 8 comandos obrigatórios existem e falham com mensagem clara quando não há o que rodar | [#44](https://github.com/RodReis/arenahub/issues/44) | `pnpm test`, `test:integration`, `test:e2e`, `build`, `dev` |
| 5 | 6º | `packages/database` (ADR-020) com Prisma, migration inicial vazia e `seed.ts` | [#46](https://github.com/RodReis/arenahub/issues/46) | `pnpm --filter database migrate dev` |
| 6 | 7º | `.github/workflows/ci.yml` — build, lint, typecheck, testes, guardas de evidência | [#47](https://github.com/RodReis/arenahub/issues/47) | CI verde no primeiro PR |
| 8 | ✅ feito | Versionar os arquivos hoje *untracked* | — | `git status --untracked-files=all` vazio, 113 arquivos rastreados |

**Por que o board é o 1º e não o 7º:** é ele que faz o resto virar processo normal. Na ordem
antiga os itens 1–6 rodavam sob regime reduzido e o item 8 caía depois da exceção já morta.
A **ordem** corrigiu isso; o **número** ficou onde estava, para não quebrar as citações externas.

**O #4 (docker-compose) subiu na frente do #3.** Os 8 comandos incluem `test:integration`, que
pressupõe Postgres de pé (Testcontainers). Fixar a mensagem de falha do #3 antes do banco existir
é fixar duas vezes.

**Item 6 (#47, CI) era o marco — e fechou em 14/08/2026.** A *exceção de arranque* da §2 morreu; o
ciclo normal vale inteiro. **Resta o board**, que é ação no GitHub, fora do repositório: Projects
com 5 colunas, cores e descrições das labels, e as labels `proplan:*` que ainda não existem.

#### Os quatro passos do CI que ainda falham de propósito

`test`, `test:integration`, `build` e `test:e2e` estão marcados `continue-on-error` no
`.github/workflows/ci.yml`. Não é tolerância a falha — é o oposto: o guarda de
`scripts/run-task.mjs` faz cada um **falhar em vez de sair 0 mentindo**, e a marca só evita que o
pipeline inteiro pare por algo que ainda não pode existir.

**Cada um perde a marca na fatia que criar o workspace correspondente**, e isso é escopo dessa
fatia, não dívida solta:

| passo | vira passo próprio em |
|---|---|
| ✅ `test` e `build` | **F1** — `apps/edge-agent` nasceu e passou a declará-las |
| ✅ `test:integration` | **F6** — `apps/api` e `packages/database` nasceram e passaram a declará-la |
| ✅ `test:e2e` | **F6** — o Playwright nasceu no `apps/admin-web` (Task 6 da fatia) |

Deixar na lista depois que o workspace existir transforma verde em decoração. **Quem criar o
workspace promove a task no mesmo PR** — foi o que a F1 fez, e o que a F6 repetiu duas vezes.

🏁 **A lista acabou na F6.** Os oito comandos têm workspace, e o passo `pendentes` do `ci.yml`
foi desmontado. Não há mais task que "falha com mensagem" por desenho — daqui em diante,
vermelho é vermelho.

> ⚠️ **Não use task real como exemplo em teste de guarda.** O `scripts/guardas.test.mjs` usava
> `test` como "task que ninguém declara" — e quebrou o CI da F1, uma fatia que não tinha nada a
> ver com isso, no dia em que o `edge-agent` passou a declará-la. Para isso existe
> **`guarda:sentinela`** no `turbo.json`: task válida que **nenhum workspace implementa, e nenhum
> deve implementar**. Task ausente do `turbo.json` também não serve — nesse caso o próprio Turbo
> recusa antes de o guarda agir, e o teste passaria a testar outra coisa.

**Não faça no bootstrap:** módulo de domínio, entidade, endpoint. Bootstrap é encanamento.

#### Versões fixadas — não atualizar major sem ADR

Decisão do PI em 14/08/2026, no card [#42](https://github.com/RodReis/arenahub/issues/42). Não
estavam escritas em documento nenhum: o `CLAUDE.md` dizia *"Node LTS fixado, compatível com
Next.js 16"* sem o número, e a issue proibia deduzir. Ficam aqui porque é onde se procura.

| o quê | versão | onde vive |
|---|---|---|
| Node | **22 LTS** (`>=22 <23`) | `engines.node` + `.nvmrc` |
| pnpm | **10** (`pnpm@10.33.2`) | `packageManager` — trava o formato do lockfile |
| Turborepo | **2** (`2.10.10`) | `devDependencies` — v2 usa `tasks`, não `pipeline` |
| TypeScript | **5.9** (`5.9.3`) | `packages/config` |
| ESLint | **9** (`9.39.5`) | `packages/config` — flat config |
| typescript-eslint | **8** (`8.67.0`) | `packages/config` |
| Prettier | **3** (`3.9.6`) | `packages/config` |
| Prisma | **7** (`7.9.1`) | `packages/database` — client TS puro, sem engine nativo |
| PostgreSQL | **17** (`17-alpine`) | `infra/docker/docker-compose.yml` |
| Redis | **8** (`8-alpine`) | idem — provisionado, **não adotado** |
| MinIO | `RELEASE.2025-09-07T16-13-09Z` | idem — tag datada, nunca `latest` |
| Prisma | **7** (`7.9.1`) | `packages/database` — client TS puro, sem engine nativo |

⚠️ **A ponta foi recusada três vezes, pelo mesmo motivo.** Node 24, TypeScript 7 (reescrita
nativa em Go) e ESLint 10 já existiam quando estas versões foram fixadas. Todos recusados: a
stack do PRD — NestJS 11, Next.js 16, Prisma, Expo — tem compatibilidade **comprovada** com os
majors anteriores, e o custo de um major novo demais não aparece no card que o adota, aparece
nos seguintes. Prender o `edge-agent` (serviço Windows com SDK nativo, ADR-010) a um LTS
recém-saído troca risco conhecido por risco desconhecido.

✅ **O Prisma 7 é a exceção, e a exceção tem critério.** Também é major recém-saído, mas foi
**aceito** porque a novidade **remove** complexidade em vez de adicionar: o client virou
TypeScript puro, sem engine binário nativo por plataforma — o que simplifica container e CI. O
critério não é *"novo é ruim"*, é *"o custo do novo aparece nos cards seguintes"*. Quando o novo
**reduz** esse custo, ele entra.

Duas consequências do Prisma 7 que aparecem no código e valem saber antes de mexer:

- **driver adapter é obrigatório** — `datasources` deixou de existir. É efeito direto de não haver
  mais engine nativo: a conexão passa a ser de um driver do ecossistema Node (`@prisma/adapter-pg`);
- **`prisma.config.ts` substitui** a configuração que morava no schema, e precisa apontar o
  `dotenv` para a **raiz do monorepo** — o `.env` vive lá, junto do que o `docker-compose` usa.

---

### MVP 0 — POC Topdata · F1 a F5

> **Este MVP é portão, não aquecimento.** Ele existe para responder se a arquitetura do Smart
> Access se sustenta. `NO_GO` é resultado válido e útil.

| F | slice | o que precisa provar | bloqueado por |
|---|---|---|---|
| ✅ F1 | 0.1 Bancada reproduzível | qualquer pessoa reproduz o ambiente e o simulador roda em CI **sem hardware** (`M0-NFR-006`) | — *(entregue; o gate não a bloqueava)* |
| 🟡 F2 | 0.2 Ciclo de vida facial | cadastrar, atualizar e remover identidade no leitor, com confirmação | **17/08: cadastro + reconhecimento provados AO VIVO** — leitor conecta, `setuserinfo` confirmado, `sendlog` recebido (field-note 17/08). Fix `senduser` (firmware v2.16) **na `main`, PR [#91](https://github.com/RodReis/arenahub/pull/91)**. Fallback de relógio implausível **na `main`** (ordena por `recebidoEm` preservando o `ocorridoEm`, decisão 3 da spec). Falta: **`M0-AC-002` — remover as três identidades e confirmar a ausência (provou criar e reconhecer, não remover; exige bancada)**, **acertar o relógio do leitor no menu (bancada)** e assinatura do PI |
| 🟡 F3 | 0.3 Catraca e passagem | abrir catraca e **confirmar giro**; medir latência ponta a ponta | **17/08: giro real confirmado** (`origem:6`), 30+ comandos sem dupla (`M0-AC-003`), entrada e saída. Cutover feito e devolvido. Fix `conectar` (init online). Relatório da janela **na `main`, PR [#90](https://github.com/RodReis/arenahub/pull/90)**. **🔴 falta: catraca em `acionamento1:8` deixa entrar sem reconhecimento — modo bloqueado pendente**; latência real (nuvem, F9) |
| ✅ F4 | 0.4 Offline e reconciliação | comportamento com link derrubado; eventos não se perdem | — *(regra pura; fechou sem hardware — PR #60)* |
| 🟡 F5 | 0.5 Relatório e decisão | decisão de saída do MVP 0 (`MVP-00` §15) com evidência: `GO`, `GO_WITH_CONSTRAINTS` ou `NO_GO` | **17/08: `lab:run` construído e cadeia física ponta a ponta provada** (rosto → decisão local → giro). Relatório §9 atualizado. Latência do ArenaHub 0–1 ms; a real (nuvem) é F9. Gate §15 não fecha sem bloqueio da catraca + assinatura |

**A pergunta que F2 tem de responder e ninguém pode adivinhar:** o SDK do leitor facial exige
Windows e processo nativo? A resposta muda a stack do `edge-agent` (ADR-010).

> ✅ **A F1 estreitou essa pergunta.** A topologia da bancada é **TCP/IP puro** — não há serial,
> RS-485 nem porta COM entre o PC e o equipamento. Logo **o transporte não é refém do Windows**:
> socket TCP é socket TCP em qualquer runtime. A dúvida do ADR-010 sobrevive **só** para o SDK de
> captura biométrica, se ele existir como DLL. Fechar o ADR continua sendo do PI, com o SDK em
> mãos.

#### O que a bancada é de verdade — e o que isso muda em F2 e F3

A bancada **não é laboratório montado para a POC**: é a catraca **instalada na unidade, em
teste**, rodando o software que veio de fábrica. Inventário completo em
`infra/bancada/README.md`; o resumo que muda decisão:

| fato | consequência |
|---|---|
| Topdata **Inner Fit**, leitor facial `AYTI11108174` em `192.168.2.188` | alvo conhecido, alcançável só de dentro da rede da unidade |
| rede `192.168.2.0/24`, **não isolada** | o PRD §4 pede isolada — divergência aberta, decisão do PI |
| software de fábrica com 48 pessoas cadastradas | **o ArenaHub usa base própria**; importação é fatia futura, fora do MVP 0 |
| **comandar a catraca tem efeito físico imediato** | F3 precisa de janela combinada, não roda a qualquer hora |

**Os 7 itens do gate seguem em aberto** — o diagnóstico os imprime a cada execução. F1 não
dependia deles; **F2 e F3 dependem**, em especial do consentimento dos participantes, que é
pré-requisito de qualquer captura facial.

#### ✅ F4 fechou sozinha — ela nunca dependeu de hardware

A Slice 0.4 é **quase toda regra pura**: fila, idempotência, snapshot, métricas. Nenhuma das cinco
entregas exige o equipamento, e é por isso que ela passou na frente de F2 e F3 no aceite.

| entrega | onde vive |
|---|---|
| fila SQLite de eventos | `persistence/fila-de-eventos.ts` |
| reenvio idempotente | `application/reconciliar.ts` |
| simulação de queda cloud | `adapters/coletor-simulado.ts` — **o dublê deduplica**, senão o teste não prova nada |
| cache local de permissões | `persistence/cache-de-permissoes.ts` |
| métricas de latência e backlog | `application/relatorio-operacional.ts` |

**Duas decisões que valem registro:**

**`synchronous = FULL`, não o `NORMAL` padrão do WAL.** `NORMAL` devolve *"gravei"* antes de o SO
escrever no disco — sobrevive a crash de processo, **não a queda de energia**. Numa academia,
queda de energia é o cenário esperado. O custo é um `fsync` por commit; perder a passagem de quem
já girou a catraca custa mais.

**O cache de permissões tem prazo, e isso não é opcional.** Snapshot sem validade vira **permissão
eterna**: um agente desconectado há uma semana continua liberando quem a nuvem já bloqueou.
`estaValido()` responde o fato — **o que fazer quando vence é decisão do PI**, porque negar tudo
trava a academia e permitir tudo abre a porta.

> As **limitações por equipamento** do `M0-AC-008` já estão registradas em
> `LIMITACOES_CONHECIDAS`, com **fonte citada** para cada uma. Limitação sem fonte é opinião, e é
> este relatório que decide se o MVP 0 vira MVP 1.

> 🟡 **F5 parcial entregue em 15/08/2026** — [`docs/reports/MVP-00-relatorio-poc-topdata.md`](reports/MVP-00-relatorio-poc-topdata.md).
> A parte que **não** depende de hardware está completa: matriz de compatibilidade (com série/firmware/
> protocolo verificados em campo), limitações por equipamento, estado das falhas obrigatórias, e a
> recomendação **`GO_WITH_CONSTRAINTS`**. As células de **latência real** estão `PENDENTE-POC` — só
> `lab:run` na catraca real as preenche. O gate §15 **não** fecha até isso rodar e o PI assinar.

**A medida que F3 tem de produzir:** latência real p95. O ADR-004 já está decidido (a nuvem
decide); esta medição **pode reabri-lo** se o p95 passar de 300 ms.

#### ✅ F2 destravada em 14/08/2026 — os manuais chegaram

O PI entregou o *Manual de Comandos do Leitor Facial* (Rev. 03) e o *Manual SDK Leitor de
Biometria Facial* (Rev. 05). Resumo verificável em
[`docs/vendor/topdata/PROTOCOLO-FACIAL.md`](vendor/topdata/PROTOCOLO-FACIAL.md); o adapter real
saiu no mesmo dia, PR [#58](https://github.com/RodReis/arenahub/pull/58).

**Três descobertas que mudaram decisões já tomadas:**

**1. Nós somos o servidor, não o cliente.** *"O aplicativo atua como um servidor WebSocket,
enquanto o leitor facial atua como um cliente WebSocket."* O `edge-agent` escuta em `/pub/chat`,
porta `7792`; o leitor conecta nele.

> ✅ **Isso responde a parte principal do ADR-010:** não há DLL no caminho de dados do leitor, logo
> **o transporte não é refém do Windows**. Fechar o ADR continua sendo do PI — e o EasyInner ainda
> pode reabri-lo, ver abaixo.

**2. O `externalEnrollId` estava errado.** O manual fixa *"entre 1 e 999.999.999.999"* — numérico,
12 dígitos. A F2 tinha nascido com UUID hexadecimal de 32 caracteres, escrito antes de a
documentação existir. **Não cabia**, e o erro só apareceria na bancada, com o leitor recusando
todo cadastro.

> ⚠️ **Efeito colateral que ficou pior:** 11 dígitos de CPF cabem folgados nos 12 do `enrollid`. A
> regra de não derivar de CPF continua, mas o formato numérico não denuncia mais nada sozinho — a
> rede de segurança virou a única barreira.

**3. O leitor envia foto, e ela é desligada no handshake.** O `sendlog` traz `image` em Base64,
inclusive de **desconhecidos**. O adapter manda `setdevinfo` com `use_logphoto:0` e
`stranger_photo:0` logo após responder o `reg`, e descarta foto que chegue mesmo assim. Foto de
quem não consentiu é tratamento de dado biométrico sem base legal (regra nº 7, ADR-008).

#### ⚠️ Configuração de bancada obrigatória, antes de qualquer cadastro

O leitor precisa estar em **"18 dígitos"** no menu — `Usuários → Op. de inscrição → Formato de ID
de usuário`. É o que permite `enrollid` de 12 dígitos. **Em 9 dígitos, todo cadastro falha.**

> ⚠️ **O stub falha alto, nunca silenciosamente.** `TopdataFacialAdapter` lança
> `TopdataAdapterNaoImplementadoError` em toda operação, em vez de devolver
> `{ confirmado: false }`. Erro de programação não pode se disfarçar de erro de operação — o
> chamador trataria "não há adapter" como "o dispositivo recusou" e seguiria adiante.

#### F3 entregue pela metade — e aqui o pendente pesa mais

Mesma divisão da F2, com um agravante: **este código comanda hardware**. Entregue no PR
[#57](https://github.com/RodReis/arenahub/pull/57):

| entregue | pendente |
|---|---|
| decisão local determinística (`M0-FR-005`) | **`TopdataInnerAdapter`** |
| razões de `DENY` como **código estável** | aceite: comportamento físico real |
| prevenção de dupla liberação (`M0-AC-003`) | |
| `DENY` não aciona a catraca (`M0-AC-004`) | |
| medição p50/p95/máx (`M0-NFR-001`) | |
| simulador que **conta acionamentos físicos** | |

**O `M0-AC-004` virou estrutura, não disciplina:** o único `liberar()` do orquestrador está
**depois do `return`** do caminho de negativa. Não há como decidir `DENY` e acionar — não por
convenção, por topologia do código.

**A dupla liberação é barrada em duas camadas independentes**, porque são causas diferentes:

- **janela anti-repique** — o leitor dispara vários reconhecimentos com a pessoa parada na frente;
- **`comandoId` derivado do `correlationId`** — reprocessamento: reinício, fila, retry.

> ⚠️ **F3 exige uma coisa que F2 não exigia: janela combinada com a operação.** Testar o adapter
> real significa **girar a catraca de verdade**, numa unidade em uso. O item 7 do gate
> (procedimento de parada de emergência) existe exatamente para esse momento.

#### 🔴 O que o teste de giro de 15/08/2026 descobriu — e o bloqueio mudou de natureza

Com o PI presente e a catraca liberada, a ponte foi exercitada de verdade. **Ela funciona:**
compila x86, carrega a `EasyInner.dll` sem GPF, o protocolo stdio responde e a ponte fica em
`LISTEN` na 3570. **O giro não ocorreu**, e o motivo não é código:

> A catraca tem `ipServer: 192.168.2.106` — ela disca para o **servidor legado**, não para a
> ponte. Nunca chegou a conectar no `edge-agent`. Lido pela API do equipamento, não deduzido.

**Isso troca o bloqueio de F3 de técnico por operacional.** Não falta implementar nada: falta
apontar a catraca para o `edge-agent` — o **cutover**. É ação sobre equipamento em uso, com o
legado ativo do outro lado, e por isso é **decisão do PI**, não do Code.

**Consequência para o gate:** as pré-condições de F3 passaram de três para quatro — consentimento,
rede/legado, janela com parada de emergência **e o cutover**. Ele não estava na lista de 14/08
porque ninguém sabia para onde a catraca apontava.

> 📋 **O roteiro de execução da janela está em**
> [`docs/runbooks/POC-MVP-00-roteiro-de-execucao.md`](runbooks/POC-MVP-00-roteiro-de-execucao.md)
> — sequência de cutover, coleta de `M0-AC-003`/`004`/`005` e encerramento.

#### 🔴 `lab:run` não existe, e o `main.ts` não liga nos equipamentos

O gate do PRD e o field-note §8 mandam rodar `pnpm --filter edge-agent lab:run`. **Esse script não
existe** — o `package.json` do `edge-agent` tem `dev`, `start`, `build`, `lint`, `typecheck`,
`test`, `diagnostico` e `bridge:build`, mais nada.

E a causa é mais funda que um script faltando: **o `main.ts` sobe, valida config e emite
heartbeat — só.** Os adapters (`TopdataFacialAdapter`, `TopdataInnerAdapter`, ponte) existem,
estão testados e corretos, mas **ninguém os instancia**. `grep` por `TopdataFacialAdapter` fora da
própria pasta e dos testes retorna zero usos. O próprio arquivo avisa: *"Adapter de dispositivo,
fila e reconciliação são das fatias seguintes"*.

| o que a POC mede hoje | como |
|---|---|
| ✅ giro, dupla liberação, latência **da ponte** | `driver-teste.mjs` fala direto com o `EasyInnerBridge.exe` |
| ❌ ciclo facial (`M0-AC-001`/`002`) | ninguém sobe o servidor WebSocket na 7792 |
| ❌ latência **ponta a ponta** (`M0-NFR-001`) | exige os dois lados ligados no orquestrador |

**Isto não é dívida solta — é escopo que ninguém alocou.** Ligar os adapters ao `main.ts` é fatia
nova, decisão do PI: tem escopo de produto (o que o agente faz ao subir), e reclassificar como
correção para pular a spec é o que o `CLAUDE.md` proíbe. Detalhe na §6 do roteiro.

> ✅ **Encaminhado em 15/08/2026.** O PI decidiu que **o Cowork escreve a spec**, pelo fluxo normal
> do ADR-023. O insumo técnico está em
> [`docs/notes/composicao-do-edge-agent.md`](notes/composicao-do-edge-agent.md): o que já existe
> pronto, o que falta compor, e as cinco perguntas que a spec precisa fechar.
>
> **Três decisões o PI já tomou:** falha alto quando um dispositivo não responde; **um flag por
> dispositivo** (`FACIAL_MODE` / `CATRACA_MODE`) no lugar do `USE_SIMULATOR` único; e o `lab:run`
> **grava arquivo de evidência**, em vez de depender de transcrição à mão.
>
> ⚠️ **Uma pergunta ficou aberta e é a que mais pesa:** o ADR-011 põe o agente no PC compartilhado
> da recepção com **início automático**. "Falha alto" é correto na invocação manual, mas no
> arranque automático transforma catraca lenta no boot em serviço morto que ninguém religa — o
> alerta de heartbeat só nasce em F11. Ver §5.1 do insumo.

#### 🔴 O ADR-010 fechou — e a resposta é diferente para cada dispositivo

O *Manual de Integração SDK Inner Acesso* (Rev. 00) chegou em 14/08/2026. Resumo em
[`docs/vendor/topdata/PROTOCOLO-CATRACA.md`](vendor/topdata/PROTOCOLO-CATRACA.md).

| dispositivo | transporte | roda em Node? |
|---|---|---|
| **leitor facial** | WebSocket + JSON, porta 7792 | **sim** |
| **catraca** | `EasyInner.dll` — binário proprietário, porta 3570 | **não** |

Três restrições da DLL, todas citadas no manual:

- *"biblioteca de vínculo dinâmico (DLL) para o ambiente **Windows**"*;
- *"ela é uma biblioteca de **32 bits (x86)**"* — mesmo em SO de 64;
- exige **.NET Framework 3.5+**.

E o protocolo binário **não é público**: o manual §6.7 diz que a integração direta por TCP/IP
existe *"conforme documentação de baixo nível e **solicitação de NDA**"*.

> **Conclusão:** a catraca exige um **processo Windows x86 com .NET** falando com a DLL. O plano
> de apoio já previa — *"serviço nativo p/ SDK Topdata"*. O `edge-agent` conversa com esse
> processo por uma **ponte**, cujo contrato está em
> `apps/edge-agent/src/adapters/topdata/easyinner-ponte.ts`.
>
> ✅ **A forma da ponte foi decidida em 15/08/2026** — card
> [#61](https://github.com/RodReis/arenahub/issues/61), PR
> [#62](https://github.com/RodReis/arenahub/pull/62): **stdio**, runtime **.NET Framework 4.x
> x86**. O `EasyInnerBridge.exe` vive em `apps/edge-agent/native/easyinner-bridge/`; o lado Node
> é `PonteEasyInnerProcesso`. A `EasyInner.dll` é binário licenciado e **não entra no
> repositório**.

#### Duas características da DLL que mandam na arquitetura

> *"a EasyInner.dll é uma biblioteca **bloqueante** e **não thread-safe**"* · *"A arquitetura
> recomendada é criar uma **única thread dedicada**"*

Isso não muda o `edge-agent` — muda a **ponte**, que precisa serializar tudo numa thread só. Está
registrado no contrato para quem for implementá-la.

#### O que o manual mudou no desenho da F3

| descoberta | efeito |
|---|---|
| **giro vem por polling**, não callback — `Origem 6` girou, `Origem 5` tempo esgotou | o adapter faz polling de `ReceberDadosOnLine` após liberar |
| **o equipamento não tem idempotência** — `LiberarCatracaEntrada(int Inner)`, sem id | a garantia do `M0-AC-003` é **inteiramente nossa** |
| **quem controla o prazo é a catraca** (`ConfigurarAcionamento`, 0–50 s) | o nosso `timeoutMs` é teto do **nosso** polling, e precisa ser maior |
| **sem `PingOnline` a catraca cai para offline** | o adapter pinga enquanto espera o giro |
| **há funções invertidas por sentido** | vira configuração — *"depende da orientação física"*, se descobre testando |

> ⚠️ **`ConfigurarAcionamento1/2` não gira a catraca.** O manual: *"Estes comandos **não devem** ser
> utilizados em catracas se a intenção for acionar o mecanismo de giro"*. Para girar, é
> `LiberarCatraca...()`.

**O que roda aqui não é o Access Decision Engine.** É o mínimo local para a POC medir latência e
passagem. O motor real vive na nuvem (ADR-004, regra de arquitetura nº 1: a catraca nunca consulta
assinatura nem invoice) e nasce em **F9**.

---

### MVP 1 — Smart Access · F6 a F9 e F11

Entrada: decisão de saída do MVP 0 (`MVP-00` §15, `MVP-01` §1) = `GO` ou `GO_WITH_CONSTRAINTS`.

| F | slice | núcleo | bloqueado por |
|---|---|---|---|
| ✅ F6 | 1.1 Core seguro e unidade | tenant, `TenantContext`, RBAC, MFA administrativo, auditoria de login. **Multiunidade desde o dia 1** (ADR-002): teste de isolamento por `gym_unit_id` junto com o de `tenant_id` | — |
| 🟢 F7 | 1.2 Aluno, plano e entitlement manual | `Student`, `Plan`, `Subscription` manual, **`Entitlement` como derivação explícita**, com `source` como enum extensível (ADR-009) | — *(código completo: backend + interface; aguarda só o aceite do PI)* |
| 🟡 F8 | 1.3 Consentimento, biometria e sync | `Consent`, `BiometricIdentity`, `DeviceUser`, fila individual por usuário×dispositivo, **expurgo em 30 dias** e **consentimento por responsável legal** (ADR-008) | etapa física depende de hardware |
| 🟡 F9 | 1.4 Decisão online e passagem | Access Decision Engine **na nuvem** (ADR-004) como função pura versionada, `AccessEvent` imutável, `AccessPassage`, override auditado | medição em hardware pendente; **tela pública** depende do `DESIGN-UI` §12.4 |
| 🟡 F11 | 1.6 Painel e prontidão | dashboard operacional, saúde de dispositivo e **alerta obrigatório quando o Edge some** (ADR-011), consulta e exportação de eventos | piloto e ensaio de runbook pendentes |

✅ **F6 entregue em 15/08/2026.** `apps/api` (NestJS) e `apps/admin-web` (Next.js) nasceram, com
schema core, autenticação com rotação de sessão, `TenantContext` obrigatório em repositório
(INV-003), MFA por TOTP e a jornada E2E do `M1-AC-001`. **123 testes.** Evidência completa,
incluindo os limites conhecidos, em
[`docs/operations/smart-access/core-security-evidence.md`](operations/smart-access/core-security-evidence.md).

Com ela **os oito comandos raiz ficaram verdes** — `test:integration` na Task 1 e `test:e2e` na
Task 6. A lista de pendentes do CI acabou.

🟢 **F7 — backend em 15/08/2026, interface da recepção em 16/08/2026. Código completo; falta o
aceite do PI.**

**Backend.** `Student` com matrícula gerada por contador travado (`SELECT ... FOR UPDATE`,
provado com 20 criações concorrentes), ciclo de vida, `Plan` com janelas em tabela normalizada,
assinatura manual e **`Entitlement` derivado com snapshot imutável de política**. **106 testes
novos**, entre eles **6 propriedades** com fast-check — INV-035 (*entitlement expirado nunca é
efetivo*) passou a ter prova sobre 500 combinações geradas, não sobre os casos que eu lembrei de
escrever.

**Interface.** Cinco telas em `apps/admin-web`: busca, cadastro, ficha, histórico e planos.
**`M1-AC-002` e `M1-AC-003` fecharam** — o aceite da Slice 1.2 diz *"a recepção cadastra aluno,
atribui plano e visualiza exatamente quando e onde o acesso é válido"*, e até este PR isso só
acontecia por `curl`. A ficha responde *"entra agora?"* na primeira linha e mostra a janela como
`Segunda, 06:00–22:00` com a unidade **pelo nome** — não `startMinute: 360` e um UUID. **43
testes unitários e 17 E2E novos**, os E2E contra API e banco reais.

De quebra, `students/[id]/biometrics` (F8) deixou de ser rota órfã: agora se chega nela pela
ficha.

**Duas decisões desta entrega, ambas registradas na evidência:** o **Toast exigido pelo
`CLAUDE.md` não foi implementado** — o `admin-web` não tem uma linha de CSS e o `DESIGN-UI.md`
segue `RASCUNHO` com 8 decisões abertas; as telas seguem o `role="alert"`/`role="status"` de F6,
F9 e F11, e o débito virou sugestão de card `[INFRA]`. E o cliente passou a **espelhar a tabela
de transições do domínio** para o select não oferecer o que a API recusa — com teste que compara
as duas tabelas linha a linha, porque o espelho já divergiu uma vez dentro desta própria fatia.

Evidência, escopo negativo e limites em
[`docs/operations/smart-access/students-entitlements-evidence.md`](operations/smart-access/students-entitlements-evidence.md)
— §12 cobre a interface.

🟡 **F8 — Tasks 1 a 6 entregues em 16/08/2026, em `SIMULATOR_READY`. A Task 7 não rodou.**

A cadeia fecha ponta a ponta em simulador: consentimento → identidade → job → comando durável →
execução no adapter → resultado → reconciliação → `DELETED`. **497 testes** no repositório.

Consentimento versionado com base legal do art. 11, I; `BiometricIdentity` **sem coluna de
template ou imagem** (INV-020, com dois testes varrendo `information_schema` e caçando `bytea`);
assinatura HMAC do Edge com anti-replay por constraint; fila durável no Postgres com lease,
backoff 1/2/3/5/8 e dead letter visível; worker no Edge Agent que delega ao adapter da F2; e
revogação com bloqueio lógico imediato (INV-018) que só vira `DELETED` quando **todos** os
dispositivos confirmam (INV-027).

O delta do ADR-008 entrou no modelo e na regra: consentimento por responsável legal com vínculo
comprovável e **revalidação na virada dos 18** (INV-143 — a prova continua válida, a autorização
caduca), log de acesso a dado biométrico, e retenção como parâmetro do cliente (art. 39).

**O que continua em aberto:** `M1-AC-004` e `M1-AC-007` **não estão atendidos fisicamente** —
nada rodou em hardware homologado, porque o gate `M1-HW-01` não foi atravessado. O expurgo dos 30
dias está modelado mas sem job agendado, e a lista de hardware homologado segue provisória no
código até `supported-hardware.md` existir. **BullMQ e WebSocket não entraram**: a entrega durável
não precisou deles, e `CLAUDE.md` manda usar fila só quando comprovadamente necessário.

Evidência, limites e decisões técnicas em
[`docs/operations/smart-access/biometric-consent-evidence.md`](operations/smart-access/biometric-consent-evidence.md).

> ⚠️ **A fatia ainda não está pronta.** A Task 6 do plano — telas de busca, cadastro, plano e
> cartão de entitlement — **não entrou neste PR**, por decisão do PI em 15/08/2026 (backend
> primeiro, PR menor e revisável). Enquanto ela não existir, **`M1-AC-002` e `M1-AC-003` não
> fecham**: o aceite da Slice 1.2 fala em *"a recepção cadastra e visualiza"*, e hoje isso só
> acontece por `curl`. A issue [#7](https://github.com/RodReis/arenahub/issues/7) permanece
> aberta.

> 📌 **Pendência entregue ao Cowork:** o `CONVENTION.md` §3.1 declara as transições de `Student`
> como `[indefinido]` e manda defini-las *"na spec de F7"* — e a SPEC-007 §2 saiu vazia. A
> tabela foi adotada do plano de apoio com aval do PI e vive em
> `apps/api/src/modules/students/domain/student.ts`. O `CONVENTION.md` precisa da emenda; o
> arquivo é do Cowork (ADR-021), então **não o corrigi daqui**.

🟡 **F9 — Tasks 1 a 6 entregues em 16/08/2026. A medição em hardware não rodou.**

O Access Decision Engine existe, e é **função pura versionada** em `packages/access-policy`: sem
banco, sem rede, sem relógio, sem locale. O "agora" entra por parâmetro e o fuso chega resolvido
em dia/minuto local. Isso não é preferência de estilo — é o que vai permitir a Slice 1.5 rodar
**este mesmo código** no Edge, offline, e obter bit a bit a mesma decisão da nuvem. Motor que lê
relógio global decide diferente em duas máquinas com NTP desalinhado, e a reconciliação vira
ficção.

**618 testes** no repositório (403 unitários, 215 de integração).

A cadeia fecha na nuvem: HMAC autentica → identidade resolve por `(Edge, device, externalUserId)`
com tenant e unidade em cada elo → projeção carrega → motor decide → `AccessEvent` e outbox
gravam **na mesma transação**, antes de a resposta sair. No Edge, máquina de estado persistida em
SQLite com `synchronous = FULL` grava toda transição **antes do efeito que ela autoriza**.

**Decisões que valem além da fatia:**

- **ADR-024** fechou a lista canônica de razões (pendência do `DESIGN-UI` §17 item 2, que
  bloqueava o acabamento). Três documentos davam três listas em conflito e nenhuma nomeava
  "unidade errada". Ficaram 7 rótulos, com `WRONG_UNIT` separado de `NO_ENTITLEMENT` porque as
  duas negativas pedem ações opostas na recepção.
- **ADR-024, emenda:** `MANUAL_OVERRIDE` como oitavo rótulo. Override gravando
  `ACTIVE_ENTITLEMENT` seria mentira num fato imutável — a recepção abre a catraca justamente
  para quem o motor negou. O motor **não consegue** produzir o valor novo: o tipo
  `EngineAllowReason` o exclui, e um `evaluateAccess` que tentasse devolvê-lo não compila.

**Dois bugs encontrados e corrigidos dentro da própria fatia:**

1. `@@unique([edgeNodeId, idempotencyKey])` **não protegia o override manual**, que nasce com
   `edgeNodeId` nulo — em Postgres `NULL ≠ NULL`, então duas linhas com a mesma chave conviviam.
   Na prática: clique duplo da recepção girando a catraca duas vezes. Fechado por índice parcial
   escrito à mão, com aviso no schema (o Prisma não modela índice parcial e vai propor apagá-lo).
2. A projeção passava **todas** as janelas do entitlement ao motor, sem filtrar por unidade. Como
   `AccessWindow` deliberadamente não carrega unidade, o horário de sábado da unidade B abriria a
   catraca da unidade A no sábado. Passa em teste unitário; só aparece com duas unidades.

**Carga medida e aprovada** (`M1-NFR-003`): 50 req/s sustentados, zero não-2xx, p99 141 ms.
A baseline é declarada, não inventada — a unidade piloto não opera, então não existe pico medido.

**O que continua em aberto:** `M1-NFR-002` e `M1-AC-006` **não estão atendidos fisicamente** — a
bancada estava indisponível. A matriz negativa de 10 casos, o resumo de percentis e o **veredito**
já rodam no CI; falta a coleta contra o equipamento, que precisa da bancada na frente para ser
escrita (contra o simulador sairia um script que roda bonito e falha na primeira medição real).
A tela de override entrou; a **tela pública da catraca não** — ela depende da §12.4 do
`DESIGN-UI`, que segue `RASCUNHO` aguardando o PI.

Evidência, limites e o que falta medir em
[`docs/operations/smart-access/online-access-evidence.md`](operations/smart-access/online-access-evidence.md).

> 📌 **Pendência entregue ao Cowork:** o `STATUS.md` §3 ainda lista a **lista canônica de razões
> de `DENY`** entre as decisões abertas do `DESIGN-UI` §17, dizendo que *"F9 precisa"*. Ela foi
> **fechada pelo PI em 16/08/2026** e virou o **ADR-024** (com emenda no mesmo dia). Restam
> **7** das 8 decisões da §17, não 8 — e a que sobra e importa para esta fatia é a **tela pública
> da catraca** (item 1). O `STATUS.md` é do Cowork por ADR-021, então **não o corrigi daqui**.

🟡 **F11 — Tasks 1 a 6 entregues em 16/08/2026. O piloto (Task 7) não rodou.**

O painel responde à pergunta que o `psql` respondia: *"a catraca está funcionando?"*. A primeira
linha da tela diz, em uma frase, se há problema crítico — quem passa entre dois atendimentos lê
isso e nada mais.

**INV-146 implementado com duas causas, não uma.** O corpo da issue #11 registra o ADR-011
(segunda rodada) exigindo que o alerta de Edge distinga **ausência** de **falha de renovação de
credencial** — e o plano de apoio não tinha isso. São códigos separados porque têm a mesma
consequência (catraca parada) e **ações opostas**: um manda olhar o PC da academia, o outro diz
explicitamente que *não* é necessário ir até lá.

**Descompasso ADR × schema corrigido:** o ADR-011 diz que a credencial do Edge é "de vida curta e
o agente a renova sozinho", mas F8 a criou **sem prazo**. Não havia renovação a acompanhar.
`expiresAt` entrou nulável — nulo significa "sem prazo", não "vencida", senão o primeiro deploy
derrubaria a catraca de quem já está instalado. E o guard passou a recusar credencial vencida: a
coluna não é decorativa.

**`fingerprint` único** é o que impede o painel de virar ilegível: sem ele, um Edge fora do ar por
uma noite geraria ~960 linhas. Condição que persiste atualiza; condição que volta reabre e
descarta o reconhecimento antigo.

**CSV injection fechada** na exportação. O ataque tem roteiro: cadastra-se aluno chamado
`=HYPERLINK(...)`, a academia exporta, a recepção abre no Excel e a planilha faz a requisição.

**Fora de escopo, com teste que trava:** `SNAPSHOT_STALE` e `BACKLOG_HIGH` do plano dependem de
snapshot assinado e fila offline — que são F10 (ADR-012). Alarme que nunca dispara ensina a
operação a confiar num sensor cego.

**Sem BullMQ**, decisão do PI: o `upsert` idempotente por fingerprint já entrega o que a fila
distribuída daria. Há teste com dois ciclos simultâneos.

**O que continua em aberto:** o **piloto operacional** (Task 7) não rodou — é turno real, com
alunos e equipe, e não é código. Os runbooks de instalação, upgrade e rollback estão escritos mas
**não ensaiados**; a Task 6 exige execução por pessoa diferente do autor, e isso não aconteceu.
Enquanto o ensaio de rollback com outbox pendente não existir, `M1-NFR-005` e `M1-NFR-006` estão
**declarados, não verificados**.

**Ordem não negociável:** F6 → F7 → F8 → F9. O motor de acesso (F9) **não pode** vir antes de
aluno, plano e entitlement — a Especificação §127 sugere o contrário e está errada; F9 sem F7
só se sustenta com stub, e stub em caminho crítico vira produção.

**F10 saiu deste MVP** (ADR-012) e compõe o **MVP 1.5**, abaixo. O número não muda.

**Invariantes que F9 tem de provar com teste, não com revisão:** INV-029, INV-030, INV-035.

---

### MVP 1.5 — Operação offline · F10

Adiado do MVP 1 por **ADR-012**. Entra quando o piloto produzir **incidente medido** de queda de
link — não por calendário.

| F | slice | núcleo | bloqueado por |
|---|---|---|---|
| F10 | 1.5 Operação offline | snapshot assinado, cache local, fila, reconciliação com idempotência | **ADR-007** (semântica de validade × carência, conflito) |

**Enquanto isto não existir, o combinado é:** a nuvem decide sempre (ADR-004); queda de link ou
PC desligado caem na **liberação manual pela recepção** com registro (`M1-FR-023`), e o alerta de
Edge ausente (F11) é o que avisa a operação. Improvisar cache no meio do MVP 1 é violar ADR-012.

---

### MVP 2 — Smart Billing · F12 a F16

Entrada: MVP 1 estável **+ provedor homologado** (card `[GATE]`). Tudo bloqueado por **ADR-013**.

| F | slice | núcleo |
|---|---|---|
| F12 | 2.1 Ledger operacional e invoice | dinheiro em inteiro, invoice única por período, pagamento manual auditado |
| F13 | 2.2 PIX e webhook idempotente | assinatura verificada, `(provider_account_id, external_event_id)`, fora de ordem |
| F14 | 2.3 Cartão e recorrência | tokenização hospedada; **zero dado de cartão no backend** |
| F15 | 2.4 Inadimplência e acesso | suspensão de entitlement, liberação após compensação (p95 < 30 s) — **ADR-019** |
| F16 | 2.5 Estorno, conciliação e operação | estorno não revoga retroativamente; conciliação com trilha |

**A flag `AUTOMATIC_DELINQUENCY_BLOCK` fica desligada** até um ciclo conciliado rodar em
paralelo (`M2-BLOCKING-01`). Bloquear aluno por engano custa mais caro que bloquear tarde.

---

### MVP 3 — Health Intelligence · F17 a F22

Entrada: identidade e frequência estáveis + `M3-CLINICAL-01` (manifest de protocolo com
assinatura profissional — **ainda não existe**). Pode andar em paralelo ao MVP 2.

| F | slice | núcleo |
|---|---|---|
| F17 | 3.1 Consentimento e avaliação manual | avaliação publicada é **imutável** (INV-102) |
| F18 | 3.2 Histórico e comparativos | ausência de dado **não é zero** (INV-104) |
| F19 | 3.3 Upload e revisão | **OCR nunca publica sozinho** (INV-103) |
| F20 | 3.4 Metas e frequência | **`Goal` deixou de ser buraco: `health_goals` entrou na F18** (decisão do PI, 21/08 — `M3-FR-007` compara "atual, anterior, primeira e **meta**", e o comparativo sem meta ficaria incompleto). Resta a esta fatia o **progresso calculado** e a **frequência** (`student_attendance_sessions`) |
| F21 | 3.5 Análise assistiva por IA | schema fechado, `NOT_MEDICAL_DIAGNOSIS`, snapshot auditável |
| F22 | 3.6 Operação e qualidade | custo, latência, circuit breaker |

---

### MVP 4 a 6 · F23 a F41

Detalhamento quando o MVP anterior fechar. Pontos que já se sabe que vão doer:

- **F28** (pagamento no totem) é o app do aluno inteiro, com dinheiro, numa tela pública — e
  depende de regra de proração que **não existe** para upgrade/downgrade.
- **F29** depende de `M4-DIST-01` (política de publicação em lojas), indefinida.
- **F33** carrega a contradição interna da Especificação sobre ranking de perda de peso
  (INV-121).
- **F40** provavelmente **não acontece**: exige ≥ 200 churns positivos e ≥ 1.000 snapshots por
  tenant. Sem isso, o produto fica na baseline de regras — e tudo bem.

---

## 5. Registro de entregas

*(preencher a cada merge — uma linha, sem prosa)*

| data | F | SPEC | PR | resumo |
|---|---|---|---|---|
| 14/08/2026 | — | — | [#48](https://github.com/RodReis/arenahub/pull/48) | ordem do bootstrap separada do número do item; 3 bloqueios mortos removidos |
| 14/08/2026 | — *(#42)* | — | [#49](https://github.com/RodReis/arenahub/pull/49) | esqueleto do monorepo: pnpm workspaces, Turborepo, layout do PRD §5. Node 22 / pnpm 10 / Turbo 2 fixados |
| 14/08/2026 | — *(#43)* | — | [#50](https://github.com/RodReis/arenahub/pull/50) | `packages/config`: TS estrito, ESLint 9 flat config, Prettier. `any`, promise solta, `console` e literal decimal viram erro |
| 14/08/2026 | — *(#45)* | — | [#51](https://github.com/RodReis/arenahub/pull/51) | ambiente local: Postgres 17, Redis 8 e MinIO em docker-compose, com healthcheck e tag fixa. Scripts `docker:*` |
| 14/08/2026 | — *(#44)* | — | [#52](https://github.com/RodReis/arenahub/pull/52) | os 8 comandos falham com mensagem em vez de sair 0 sem rodar nada; guarda da porta 3344 |
| 14/08/2026 | — *(#46)* | — | [#53](https://github.com/RodReis/arenahub/pull/53) | `packages/database`: Prisma 7, migration inicial **vazia**, client factory e seed vazio |
| 14/08/2026 | — *(#47)* | — | [#54](https://github.com/RodReis/arenahub/pull/54) | **CI** com os 8 passos e a guarda de evidência. **A exceção de arranque morreu** |
| 14/08/2026 | **F1** | SPEC-001 | [#55](https://github.com/RodReis/arenahub/pull/55) | bancada reproduzível: `edge-agent` com config, health check, logs e diagnóstico somente-leitura; inventário real da catraca |
| 14/08/2026 | **F2** *(parcial)* | SPEC-002 | [#56](https://github.com/RodReis/arenahub/pull/56) | ciclo de vida facial sem hardware: porta, simulador contratual, mapeamento em SQLite, `externalEnrollId` sem CPF. **Adapter Topdata aguarda o SDK** |
| 14/08/2026 | **F3** *(parcial)* | SPEC-003 | [#57](https://github.com/RodReis/arenahub/pull/57) | decisão local, anti-repique, idempotência de comando e medição de latência. **`DENY` não aciona a catraca — estrutural.** Adapter aguarda SDK e janela |
| 14/08/2026 | **F2** *(fecha)* | SPEC-002 | [#58](https://github.com/RodReis/arenahub/pull/58) | adapter real do leitor facial: servidor WebSocket, protocolo dos manuais, foto desligada no handshake. `externalEnrollId` corrigido para o formato do equipamento |
| 14/08/2026 | **F3** *(adapter)* | SPEC-003 | [#59](https://github.com/RodReis/arenahub/pull/59) | adapter da catraca sobre ponte EasyInner. **ADR-010 fechado:** catraca exige processo Windows x86; leitor facial não. Contrato da ponte definido |
| 14/08/2026 | **F4** | SPEC-004 | [#60](https://github.com/RodReis/arenahub/pull/60) | offline e reconciliação: fila SQLite durável, reenvio idempotente, cache de permissões com prazo, relatório com limitações citadas |
| 15/08/2026 | — *(#61)* | — | [#62](https://github.com/RodReis/arenahub/pull/62) | ponte EasyInner nativa: processo .NET 4.x x86 por stdio + lado Node. **Fecha a forma da ponte do ADR-010.** Ponte carrega a DLL e escuta na 3570; **giro real aguarda cutover** — a catraca aponta para o legado `.106` |
| 15/08/2026 | **F6** | SPEC-006 | [#69](https://github.com/RodReis/arenahub/pull/69) | core seguro e unidade: `apps/api` e `apps/admin-web` nasceram, tenant, `TenantContext`, RBAC, MFA administrativo, auditoria de login |
| 15/08/2026 | **F7** *(backend)* | SPEC-007 | [#70](https://github.com/RodReis/arenahub/pull/70) | aluno com matrícula colisão-segura, planos com janelas, assinatura manual, **entitlement derivado com snapshot imutável**, cortesia e timeline. 9 rotas, 106 testes novos |
| 16/08/2026 | **F8** | SPEC-008 | [#71](https://github.com/RodReis/arenahub/pull/71) | consentimento versionado, `BiometricIdentity` sem coluna de template, fila durável com lease e dead letter, revogação com bloqueio lógico imediato |
| 16/08/2026 | **F9** | SPEC-009 | [#74](https://github.com/RodReis/arenahub/pull/74) | decisão online na nuvem como função pura versionada, `AccessEvent` imutável, `AccessPassage`, override auditado |
| 16/08/2026 | **F11** | SPEC-011 | [#75](https://github.com/RodReis/arenahub/pull/75) | painel operacional, saúde de dispositivo, alerta quando o Edge some, consulta e exportação de eventos |
| 16/08/2026 | **F7** *(interface, fecha)* | SPEC-007 | [#76](https://github.com/RodReis/arenahub/pull/76) | interface da recepção: busca, cadastro, ficha com direitos, histórico e planos. **`M1-AC-002` e `M1-AC-003` fecham** — o aceite deixou de depender de `curl`. 43 unitários + 17 E2E novos. **Toast do `CLAUDE.md` não implementado** — débito anterior à fatia, sugerido card `[INFRA]` |
| 16/08/2026 | — *(#79)* | — | [#80](https://github.com/RodReis/arenahub/pull/80) | pipeline de tokens e esqueleto de `packages/ui`: três camadas de token, resolvedor de accent OKLCH por contraste calculado, 5 regras de lint e `globals.css` no `admin-web`. **Guardas testadas falhando, não só passando.** Metade sem decisão de produto do ADR-025 — **desbloqueia F42**. Componentes e `state-labels.ts` ficam para a fatia |
| 17/08/2026 | — *(#85)* | — | *(PR desta entrega)* | `[FIX]`: o `eslint.config.js` do painel importava só o config base, nunca o `design-system` — `pnpm lint` saía **exit 0 com violações vivas** da regra 5 do DS §11. Eram 2, não as 4 do card: a F42 já migrara as duas páginas `.tsx`. `instanteLegivel` já era **código morto** (zero callers) e saiu; `dataLegivel` tinha um caller vivo e migrou para `TenantDateTime`. **Nenhum `eslint-disable` foi preciso** — o caminho 1 do card saiu limpo. Fuso segue `FUSO_PROVISORIO`: ler o da unidade é fatia (escopo negativo do card) |
| 17/08/2026 | **F42** | SPEC-042 | [#86](https://github.com/RodReis/arenahub/pull/86) | design system do painel: `state-labels.ts` com as 8 razões do ADR-024, 15 componentes, contrato dos 6 de MVP futuro, **as 11 telas de F6/F7/F11 mais o login estilizadas**, axe-core nos fluxos essenciais. Fatia de **extração**: matou 5 dicionários duplicados, 2 cópias de `formatarInstante`, 11 blocos de erro e 12 tabelas soltas. **Fecha o Toast do `CLAUDE.md`.** Dois bugs reais achados: contraste 3.16 do "Sair" sobre o chrome (pego pelo axe) e `aria-label` do revelar-senha tornando o campo ambíguo. 200 unitários + 46 E2E |
| 17/08/2026 | **F3** *(janela física)* | SPEC-003 | [#90](https://github.com/RodReis/arenahub/pull/90) | relatório da **primeira janela física**: 30/30 `liberar` aceitos, **28 giros confirmados por sensor** (`origem:6`), 2 timeouts `origem:5`, **0 duplas** (`M0-AC-003`), entrada e saída. Cutover `.106` → `.190` → `.106` com legado religado. **Não fecha `M0-AC-004`:** catraca em `acionamento1:8` gira livre, então os giros teriam acontecido sem o comando. Latência de máquina (~74 ms) registrada **separada** da de tempo humano (p95 3552 ms) — juntá-las seria o número inventado que a guarda existe para barrar |
| 17/08/2026 | **F2** *(ciclo ao vivo)* | SPEC-002 | [#91](https://github.com/RodReis/arenahub/pull/91) | **cadeia física ponta a ponta**: `senduser` do firmware v2.16 (sem ele o leitor derrubava a conexão), `conectar` na ponte (sem ela `liberar` voltava `retorno 1`), **`lab:run`** ligando facial → decisão local → catraca, sentido em `orquestrar-passagem`. Latência do ArenaHub **0–1 ms** — o gargalo é o leitor processando o rosto. §9 do relatório reorganizada nas **duas janelas** do dia. **Corrigida contradição interna:** a §9.4 dava `M0-AC-004` como provado, contra a §9.6 e a própria spec — vale o segundo, critério de aceite é observável, não interno (ADR-016). **A guarda de evidência barrou o primeiro push** (`TESTS.md` dizia 63, execução produz 64) — funcionou como projetado |
| 17/08/2026 | — *(#68)* | — | *(PR desta entrega)* | `[INFRA]`: 8 planos mandavam criar ADR em `docs/adr/NNNN-*.md` — diretório inexistente que abriria **segunda numeração** paralela à de `docs/DECISIONS.md` (ADR-021). 26 ocorrências corrigidas em três tratamentos: `Create:` vira `Modify: docs/DECISIONS.md` com a redação do `CLAUDE.md`; path em `git add` vira o arquivo único; mapa de diretórios do index ganha nota do ADR-021. O conteúdo do ADR-0001 no plano do MVP 0 foi **preservado**, só o destino e o cabeçalho mudaram (`## ADR-NNN`). Zero linha de código tocada |
| 18/08/2026 | **F2** *(fallback de relógio)* | SPEC-002 | [#93](https://github.com/RodReis/arenahub/pull/93) | **metade de código do item 3 da §7**: `plausibilidade-de-relogio.ts` detecta relógio implausível por dispositivo (repetição, futuro, anterior ao último visto), `EventoReconhecimento` ganha `recebidoEm`, a fila do edge-agent ganha a coluna `ordenar_por` com migration idempotente e passa a ordenar por `COALESCE(ordenarPor, ocorridoEm)`. Preserva `M0-BR-004`. 199 testes em 19 suítes. **Não fecha a fatia:** ordena certo com o relógio errado, mas **não conserta o relógio** — enquanto o leitor mandar `ocorridoEm` congelado, a evidência de campo continua vindo pelo caminho degradado. Restam os dois itens de bancada (`M0-AC-002` e acertar o relógio no menu do leitor) |
| 18/08/2026 | — *(#94)* | — | [#95](https://github.com/RodReis/arenahub/pull/95) | `[INFRA]`: `apt-get` do runner pendurava no passo de dependências do Chromium e derrubava o job `integração e E2E` no `timeout-minutes: 20` — **20 min gastos sem produzir sinal**, e de fora o PR aparecia como falha de código. Terceira ocorrência do mirror `azure.archive.ubuntu.com` fora do ar (run `32086557672`). Os dois passos que chamam apt ganham `timeout-minutes: 8` e **uma** tentativa extra: o timeout faz a queda aparecer no passo certo e devolve o resto do orçamento; a repetição cobre o mirror que volta em segundos. Opções 1+2 da issue, aprovadas pelo PI — **container do Playwright (opção 3) ficou de fora**, só se voltar a cair. Escopo negativo: não toca no cache do navegador nem no timeout do job. Sem teste novo — o comportamento é do runner, não do produto; a evidência é o próprio CI deste PR |
| 18/08/2026 | **F12** | SPEC-012 | [#97](https://github.com/RodReis/arenahub/pull/97) | **Ledger operacional e invoice, Slice 2.1.** Quatro módulos de domínio puro (48 testes): `dinheiro` (INV-065 — inteiro em centavos, float rejeitado em runtime, soma sem divisão), `catalogo-de-planos` (benefício estruturado), `grupo-familiar` (limite de 3, um titular) e `invoice` (totais, transições, pagamento). Dez tabelas novas: `plan_prices`, `plan_benefits`, `family_groups`, `family_members`, `billing_settings`, `invoices`, `invoice_items`, `payments`, `payment_attempts`, `account_credits` — campos conforme **ADR-027**, sem `gym_unit_id` em nenhuma (pagamento não é dado físico). **Preço com vigência** e **benefício como tabela** por decisão do PI a partir dos encartes impressos da Arena Positiva: bioimpedância a cada **30** dias no programa de adultos e **60** na clínica é regra que o MVP 3 vai ler, não prosa; "Teste de ECG — em avaliação" motivou `status` de três valores em vez de booleano. **Plano família não exigiu tocar no motor de acesso** — `Entitlement` já tinha `student_id` próprio e `subscription_id` nulável, então a derivação só mudou de 1:1 para 1:N. Seed com o catálogo real: R$ 150 (dois programas), R$ 200 (família/3), R$ 30 (diária). **Dinheiro no balcão é caminho de primeira classe:** `POST /api/v1/invoices/:id/manual-payment` registra dinheiro ou transferência reconhecidos na recepção, sem provedor — é o que faz a Slice 2.1 fechar sem adapter. Permissão **própria** `billing.payment.manual`, separada de `billing.manage` (403 comprovado em teste): reconhecer dinheiro é ato excepcional, mesmo critério do `access.override` da F9. Abertura de invoice **idempotente** por INV-066, com a checagem antes de consumir número — senão a numeração ficaria com buraco. Numeração por tenant com `ON CONFLICT` + `FOR UPDATE`; outbox na mesma transação (INV-084). **14 testes de integração** contra Postgres real. **Bug achado pelo teste:** `audit_logs.actor_id` tem FK para `users`, e operador com UUID solto quebrava o registro manual — justamente a mitigação detectiva do ADR-027. **A guarda de OpenAPI pegou o snapshot desatualizado** na suíte completa, passando isolado. **Tela sob a ficha do aluno** (`/students/:id/billing`), não área de faturamento solta: é assim que a recepção trabalha — primeiro acha a pessoa, depois cobra. Gerar cobrança não pede confirmação (repetir é seguro, e a tela **diz isso** para ninguém evitar o clique com medo de duplicar); receber dinheiro passa por `SensitiveAction` com motivo obrigatório, porque é o ato que a auditoria vai ler. Reusa `Money`, `StateBadge` (`machine="invoice"`) e `TenantDateTime` do design system — nada de componente novo. Conversão "150,00" → `15000` isolada em `src/billing/dinheiro.ts` com **10 testes**, somando em inteiros porque `Number('1.15') * 100` dá `114.99999999999999`. **4 E2E** no navegador real. Fecha dois `[indefinido]` do `CONVENTION.md` §3.4 e o §3.5 inteiro |
| 18/08/2026 | **F13** | SPEC-013 | [#102](https://github.com/RodReis/arenahub/pull/102) | **PIX e webhook idempotente, Slice 2.2.** Duas tabelas: `provider_accounts` (resolve o tenant pela conta do provedor — INV-078 — e guarda o segredo do HMAC) e `provider_events` (inbox do webhook). **A unicidade `(provider_account_id, external_event_id)` É a idempotência** — não o `if (jaProcessei)`, que perde a corrida entre duas entregas simultâneas do mesmo evento; teste com três `POST` concorrentes comprova um pagamento só. **A fatia não esperou o gate do provedor:** o ADR-013 escolhe *marca*, e todo o código vive atrás de `PaymentProvider` (os 6 métodos do `MVP-02` §12 — o ADR já mandara o PRD vencer as outras duas versões do contrato) com `FakePaymentProvider` no boundary, previsto na tabela de dublês do `docs/TESTING.md` §3. **O HMAC do dublê é de verdade** (`createHmac` + `timingSafeEqual`): fake que aceitasse qualquer assinatura faria o teste de INV-077 passar com a verificação deletada — um caso prova que corpo adulterado depois de assinado é recusado. Corpo cru sobre bytes exatos, reusando o `raw-body.middleware` do Edge com o prefixo estendido. Domínio puro `evento-do-provedor.ts` (15 testes) decide aplicar/ignorar: duplicata, fora de ordem (INV-079 — **empate de instante conta como fora de ordem**, porque aplicar o segundo elegeria vencedor por acaso de chegada de rede) e estado terminal (INV-069). **Duplicata, fora de ordem e tipo desconhecido devolvem 200** — são processamento correto, e 4xx faria o provedor reenviar para sempre; o descarte fica gravado com `skipped_reason`, senão "por que este evento não fez nada?" não teria resposta seis meses depois. **A cadeia vai até o último elo:** pagamento → invoice → assinatura → **entitlement `ACTIVE`**, tudo numa transação com outbox dentro — parar em "invoice paga" deixaria o aluno pagando e batendo na porta fechada, e o teste passaria (regra de arquitetura nº 1). **Entitlement `REVOKED` não ressuscita por pagamento** (revogação tem motivo próprio — inelegibilidade, LGPD) e o caso de uso **não cria** entitlement: criar exigiria montar snapshot de política dentro do financeiro, contra a regra nº 9. Invoice já paga por outro caminho registra o pagamento e vira **crédito do aluno** — INV-069, `PAID` não volta atrás. Consulta ativa `GET /payments/:id/status` **só lê e devolve `divergente: true`**: confirmar por ali criaria um segundo caminho de escrita para a mesma transição, que é o que INV-076 existe para impedir; `:id` é o da **tentativa**, porque no PIX o `Payment` só nasce quando a confirmação chega. Tentativa gravada **antes** da chamada ao provedor: morrer no meio deixa tentativa rastreável em vez de cobrança viva sem registro nosso. PIX vale **30 min** (constante nomeada — o PRD cita expiração sem número) e pedir de novo com cobrança viva devolve a mesma. **31 unitários + 15 de integração** contra Postgres real. **Falha achada pelo próprio teste:** competência compartilhada entre casos fazia a segunda invoice vir já paga — isolamento por mês próprio, não ajuste de asserção |
| 18/08/2026 | — *(#101, item 1 de 3)* | — | [#103](https://github.com/RodReis/arenahub/pull/103) | `[INFRA]`: a suíte E2E escrevia no **banco de desenvolvimento**. Ela cria aluno, plano e dispositivo e **não limpa** — os testes de integração limpam com `deleteMany`; estes, não —, então cada execução deixava resíduo com epoch no nome (`Caminho Biometria 1787060177858`) e a tela de Alunos exibia o rastro da própria suíte em vez do produto. O banco acumulou **1016 tenants** assim. Agora a suíte usa `E2E_DATABASE_URL`: mesmo Postgres, banco separado, recriado do zero pelo `pretest:e2e` antes de cada execução. **Recriar antes, e não limpar depois, é o ponto** — limpeza no fim não roda quando a suíte quebra no meio, e foi por isso que o resíduo se acumulou apesar de ninguém querer que acumulasse. **Sem fallback para `DATABASE_URL` e sem valor padrão:** cair no banco de dev em silêncio é o defeito que isto existe para impedir, e um default embutido carregaria a porta da máquina de quem o escreveu (aqui o Postgres do projeto atende em 5442; a 5432 é de outro projeto na mesma máquina). Guarda por sufixo `_e2e` porque o script apaga o banco alvo — um `E2E_DATABASE_URL` mal copiado destruiria o ambiente de quem rodou; testada apontando para `arenahub`, recusa antes de tocar em qualquer coisa. **`prisma migrate reset` no lugar de `docker exec ... psql`:** o CI não tem container `arenahub-postgres` (lá o Postgres é service container), e o SQL por linha de comando chegava repartido no Windows — o psql recebia só `DROP` e morria com `syntax error at end of input`. **`reuseExistingServer: false`** porque reaproveitar uma API já de pé reaproveita o `DATABASE_URL` dela, e a suíte voltaria a escrever no banco de dev com a configuração parecendo correta. Evidência: 50/50 E2E verdes e a contagem de tenants do banco de dev **não se move** (1016 antes e depois). **Não fecha o card:** faltam o expurgo do resíduo já acumulado e o seed de demonstração |
| 18/08/2026 | — *(#101, itens 2 e 3, fecha)* | — | [#104](https://github.com/RodReis/arenahub/pull/104) | `[INFRA]`: **o card culpava o E2E; a maior fonte era a integração.** Dos 1086 tenants no banco de desenvolvimento, **nenhum** tinha epoch no nome — eram `f7-rede-a-a6b8b550`, `academia-2d849fb4`, sufixo hex de suíte de integração, das quais **17 de 20 não apagam o tenant no fim**. O E2E deixou 143 alunos dentro do tenant real; a integração, 1085 tenants inteiros e 802 usuários `@exemplo.test`. Junto caiu uma afirmação falsa do `docs/TESTING.md`: dizia Testcontainers na integração; **não há** — é o mesmo Postgres local, pelo mesmo `DATABASE_URL`. Expurgar sem tratar isso seria limpar o chão com a torneira aberta, então a integração ganhou `INTEGRATION_DATABASE_URL`, redirecionado em **uma linha** nos dois `setup-env.ts` — sem tocar em nenhuma das 20 suítes. Banco próprio e **não o mesmo do E2E**: as duas rodam no mesmo job, e o `migrate reset` de uma derrubaria o banco sob os pés da outra. **Assimetria deliberada:** sem a variável a integração cai no `DATABASE_URL`, enquanto o E2E para — ela limpa em parte e nunca recria banco, então cair no de dev **suja**; no E2E, que roda `migrate reset`, **apagaria**. **Expurgo com três guardas** (recusa banco de suíte, conta antes de apagar, exige `--confirmar`) e **duas correções achadas conferindo o resultado**: a primeira versão listava tabela a mão e declarou vitória com 37 planos com epoch ainda no banco — agora varre o catálogo do Postgres, e tabela nova entra sozinha; varrer todo texto pegava `sessions.token_hash`, onde os dígitos são coincidência de hash, então ficou restrito a coluna que **nomeia** algo. Usuários precisaram de critério próprio (`@exemplo.test`, RFC 2606) porque `users` não pendura em tenant e o CASCADE não os alcança. De 1086 tenants, 3895 alunos e 803 usuários para **1, 0 e 1**. **Seed de demonstração** em `pnpm db:demo` — 12 alunos, leitor facial, Edge e uma semana de passagens —, separado do base por decisão do PI: o base roda antes das suítes, e dado de demonstração faria as que afirmam `toHaveLength(0)` falhar ou, pior, passar por acaso. **Bug próprio achado no navegador:** o laço parava em ontem e a tela abre nas últimas 24 h (`PERIODO_PADRAO_HORAS`) — 38 eventos no banco e a tela ainda dizia "Nenhum evento no período", o sintoma que o seed existe para resolver. **Falha de cobertura pega pelo CI:** dois pacotes rodam `test:integration` e o `pretest` estava só em um — a preparação subiu para a raiz, porque pôr nos dois faria o segundo derrubar o banco enquanto o primeiro escreve. Evidência: 282 de integração, 50/50 E2E, e a contagem do banco de dev não se move |
| 18/08/2026 | — *(#105)* | — | [#106](https://github.com/RodReis/arenahub/pull/106) | `[INFRA][FIX]`: o `apt-get` do Chromium caiu **quatro vezes no mesmo dia** — as duas primeiras derrubando o job aos 20 min, as outras duas no timeout de 8 min criado pelo #94. A mitigação de lá (timeout curto + uma tentativa) faz a queda aparecer no passo certo, mas **não cobre mirror fora por minutos**: as duas tentativas caem na mesma janela. O job passou a rodar dentro de `mcr.microsoft.com/playwright:v1.62.1-noble`, que já traz navegador e bibliotecas — **zero passos de `apt-get`**. Saíram junto os dois passos de instalação, o cache de `~/.cache/ms-playwright` (a imagem aponta para `/ms-playwright`, então o cache seria restaurado onde ninguém lê) e o passo que resolvia a versão só para chavear esse cache: de **23 passos para 14**. **Custo medido: ~50s por execução** (4m30s contra 3m39s) — o pull da imagem não é grátis, e o PI aceitou o trade-off com o número na mão. **Três armadilhas, e só a terceira estava prevista:** (1) a env var `PLAYWRIGHT_BROWSERS_PATH` da imagem **não chega ao job**, porque o runner troca o `HOME` e monta ambiente próprio — verifiquei com `docker run` antes do primeiro push e tomei como prova, quando `docker run` não reproduz o ambiente do Actions; (2) declarada no job, **o Turbo a descarta**, e o `turbo.json` avisa disso em letra maiúscula — a mesma sanitização em que eu havia esbarrado horas antes ao adicionar as variáveis de banco, sem ligar os pontos; (3) o Postgres **muda de endereço** ao entrar num container (`localhost` vira o label do serviço), e essa acertou de primeira: a integração passou 282/282 já no run em que o E2E ainda quebrava. Corrigido de passagem o comentário do `ci.yml` que afirmava Testcontainers na integração — mesma correção feita no `docs/TESTING.md` durante a #101, que havia ficado para trás |
| 18/08/2026 | **F46** | — | [#107](https://github.com/RodReis/arenahub/pull/107) | **Design system aplicado ao `admin-web`.** Precedida de crítica `/impeccable` com dois assessments isolados, e o veredito contraria o diagnóstico da manhã: **não era AI slop** — o código tem argumento onde slop tem preenchimento. O design system foi construído e as telas não o vestiram. O número que resume: `<h2>` do navegador a **24px** contra o `<h1>` do painel a **20px** — hierarquia invertida em pixels, em 13 telas. **Quatro defeitos que não eram estética:** (1) o **gate de contraste media o par errado** — o comentário dizia "sobre o fundo do card" e o código media contra branco, então `success` passava com 5.08 e entregava **4.44 sobre o próprio tint**; consertei o gate primeiro, ele acusou o defeito na primeira execução, e só então escureci o token; (2) a **suíte de acessibilidade passava 7/7 num falso verde**, porque o banco de E2E nasce vazio e sem aluno `ACTIVE` não existe o badge que reprovava — consequência direta do isolamento feito horas antes no #101; (3) **183px de rolagem horizontal a 200% de zoom**, em duas causas encadeadas: a `<nav>` do shell não encolhia (`min-width: auto` no grid) e depois a tabela de 7 colunas, que agora rola dentro de si com `tabIndex={0}` — região rolável sem foco é inalcançável por teclado; (4) **`NavLink.current` nunca foi passado** — o componente aceitava a prop, o CSS de item ativo existia, e só o teste unitário usava. **Duas jornadas quebradas:** a sidebar não dizia onde a recepção está, e a ficha do aluno tinha `aluno.id` em mãos, usava em três links, e não oferecia o caminho para a liberação manual — a recepcionista pescava o UUID da URL com fila no balcão; ao percorrer a correção, o seed de demonstração se revelou sem catraca, e a tela nem renderizava o formulário. **Login em duas colunas**, com três defeitos que só a tela revelou (headline em cinco linhas porque `max-width` em `ch` conta caracteres e a conta muda com o tamanho da fonte; ponto da marca a 3.17 sobre carbono escuro; apoio estrangulado) — e duas coisas da referência que **não** entraram: "Esqueci minha senha" (não há rota nem endpoint) e "MFA obrigatório para administradores" (afirmaria política que o código não aplica). **Tailwind e shadcn entraram por decisão do PI (ADR-031)**, contrariando o `PRODUCT.md` e o `DESIGN-UI.md` §3.4, que foram corrigidos em vez de ignorados; nenhum componente do shadcn está em uso, porque o `Select` dele é `<div role="combobox">` sem `<option>` e derrubaria os oito `selectOption` da suíte. O **Preflight do Tailwind causou regressão real** — controles não migrados ficaram com borda 0px e 20px de altura —, o que transformou a migração dos seis formulários de melhoria em conserto obrigatório: altura de controle **19–24px → 36px**. Evidência: 282 de integração, 51/51 E2E, conferido no navegador a 1440, 1280, 1024 e 640px |
| 18/08/2026 | **F45** | — | *(PR desta entrega)* | **Cadastro completo de aluno, retrabalho da Slice 1.2.** A F7 entregou quatro campos onde a Especificação §11 lista dezoito, e `student_addresses` nasceu órfã — criada na F7, nunca escrita por endpoint, seed ou tela. **A falha era de especificação, não de implementação:** a Slice 1.2 diz só "cadastro e busca de aluno", e o que o PRD não repete não vira critério de aceite (ADR-018). Modelo: `rg`, `registered_sex`, `lead_source`, `advisor_user_id` e `gym_unit_id` em `students`; `label` e `relationship` mais `EMERGENCY` em `student_contacts` — **reaproveitar a tabela de contatos** em vez de criar a quarta tabela para guardar três strings. `LeadSource` com seis valores decididos pelo PI. **Migration em três arquivos, nunca um:** coluna anulável → backfill → `NOT NULL`. O backfill escolhe a unidade **ATIVA mais antiga do próprio tenant**, com `ORDER BY (created_at, id)` para ser determinístico e `WHERE gym_unit_id IS NULL` para ser idempotente; provado contra base populada com dois tenants e uma unidade `INACTIVE` mais antiga como distrator — pulou a inativa, cada tenant ficou na própria unidade, **zero vazamento cross-tenant**, 3/3 alunos com unidade e nenhum criado ou perdido. O `SET NOT NULL` do passo 3 é a guarda: tenant sem unidade ativa faz a migration **parar**, em vez de deixar aluno quebrado. API: `POST` estendido com blocos opcionais (`.strict()` mantido — `tenantId` e `membershipNumber` seguem recusados), **`PATCH /students/:id` novo** com trava otimista, `GET /:id` com endereço e contatos, `GET ?gymUnitId=` filtrando por unidade de origem. **Não existia edição de dado cadastral** até aqui — só `PATCH /:id/status` —, e um formulário de vinte e dois campos sem edição torna todo CEP digitado errado permanente. `undefined` não mexe, `null` apaga: sem a distinção não haveria como limpar um RG errado. **`gym_unit_id` é unidade de ORIGEM, nunca controle de acesso** — quem decide onde o aluno entra continua sendo o plano, por `PlanUnit` e `EntitlementUnitWindow`. A prova é **estrutural** (`gym-unit-nao-decide-acesso.spec.ts`, lendo o código-fonte do módulo de acesso), e não comportamental: o defeito a prevenir não é "a decisão saiu errada", é "alguém acrescentou `gymUnitId` ao `select`" — teste de comportamento só pegaria isso com um cenário que ninguém lembra de escrever. **Verificado por mutação:** injetei `gymUnitId` no `select` do `identity-resolver` e o teste falhou; restaurado, passa. **Divergência registrada contra a issue:** ela pede que a listagem filtre "pela unidade do cabeçalho", mas o cabeçalho **não tem seletor** — só um indicador estático, e criar o seletor é decisão de produto adiada (`DS-PAINEL.md` §5); o filtro existe no backend, pronto, e a listagem segue mostrando o tenant inteiro. UI: **wizard de quatro passos**, todo em shadcn/ui por decisão do PI. Os componentes vieram com a **paleta neutra do shadcn** (`oklch(0.205 0 0)`) e altura `h-8`; ficariam com o visual default que o ADR-026 e o ADR-031 mandam não acontecer, então `globals.css` passou a **mapear cada token do shadcn para o `--ah-*` correspondente** e a altura foi para `--ah-control-height` (36px — abaixo disso reprova no alvo de toque, o defeito que a F46 corrigiu tela por tela). **Os quatro passos ficam montados e escondidos por `hidden`, nunca desmontados:** React que desmonta um `<input>` descarta o valor, e quem voltasse ao passo 1 para conferir o nome perderia o endereço inteiro. Máscaras de CPF, CEP e telefone formatam **na digitação**, com corte de hífen distinto para fixo e celular. **Correções ao mockup, todas por decisão registrada do PI:** CPF, telefone, e-mail e os campos de endereço eram marcados obrigatórios e caíram para opcionais — nome, nascimento e unidade são os **únicos** três. O passo 4 **não duplica F7 nem F8**: plano e consentimento têm regras próprias (assinatura, entitlement, termo versionado, responsável legal de menor), e refazê-los ali criaria um segundo caminho com metade das regras. **19 fixtures de teste quebraram no typecheck** ao tornar a coluna obrigatória — o compilador cobrando a FK, exatamente o efeito desejado. Os E2E ganharam `cadastro-de-aluno.ts`: a navegação entre passos num lugar só, senão a próxima mudança de fluxo quebraria seis testes de uma vez. **Falso negativo de 19 testes E2E investigado até a raiz:** todos falhavam em `campo-fullName` inexistente, e o snapshot da página mostrava o formulário **antigo** — o Playwright reusara (`reuseExistingServer`) um servidor Next.js já de pé servindo build anterior. Não era o wizard. **A revisão de código achou dois defeitos, os dois confirmados por medição antes de serem corrigidos.** (1) **`advisorUserId` aceitava usuário de outro tenant** — `gymUnitId` era validado contra o tenant do chamador, `advisorUserId` só quanto ao formato UUID. `User` é entidade **global** de propósito (a mesma pessoa atende duas academias, e o vínculo mora em `TenantMembership`), então a FK aceita qualquer usuário do sistema; o banco não reclama, a regra nº 2 sim. Teste escrito antes da correção falhou, provando o furo. `MembershipRepository` novo em `iam`, exportado como caso de uso público (regra nº 9), checando vínculo `ACTIVE` — funcionário desligado não vira consultor de aluno novo. (2) **O formulário vazio morria em silêncio:** clicar em "Cadastrar aluno" sem preencher nada não produzia POST, nem mensagem, nem movimento na tela. **Duas hipóteses erradas antes da certa** — `form.checkValidity()` devolvia `true` com os 22 campos vazios (medição feita antes da hidratação), e mover a checagem para `onSubmit` não resolveu porque, com `action`, o React roda o envio em Transition e `preventDefault` não a cancela. A resposta estava no console: *"An invalid form control with name='fullName' is not focusable"* — o navegador **valida**, barra o envio, tenta focar o campo para apontar o erro, falha porque ele está dentro de contêiner `hidden`, e desiste sem dizer nada. `required` nativo saiu; `aria-required` ficou; quem barra é uma checagem em JS que **leva a pessoa ao passo onde o campo mora** — avisar "informe a unidade" a quem está no passo 4 manda procurar em quatro telas. Evidência final: 325 unitários + 56 web, **301 de integração**, **55/55 E2E**, build 7/7 |
| 18/08/2026 | **F45** *(defeitos visuais)* | — | [#109](https://github.com/RodReis/arenahub/pull/109) | **Três defeitos que 55 E2E verdes não pegaram**, achados abrindo o painel no navegador depois do merge. (1) **A grade abria com até quatro colunas** — o comentário ao lado dizia "duas" e a implementação usava `auto-fit`, que vira três a 1440px e quatro a 1920px; a dica longa do CPF esticava a linha inteira e abria um buraco sob os vizinhos. (2) **O botão primário saía sem texto visível** na tela de sucesso: o texto estava no DOM, o problema era cor — a regra `a { color }` do `globals.css` mora **fora de `@layer`** e por isso vence as classes utilitárias do Tailwind, que vivem em layer. Medido `rgb(0,112,123)` sobre `rgb(0,112,123)`: **contraste 1:1**. **Três tentativas erradas antes da certa, todas medidas:** `color: inherit` puxa a cor do pai e dá 2.28 (reprova AA); `revert-layer` não faz nada porque a regra ofensora não está em layer; e `a:not([data-slot='button'])` **aumentou a especificidade de `a`**, que passou a vencer o CSS module da navegação e derrubou os links do menu de 8.24 para 3.17 — regressão numa tela que a fatia nem toca, pega comparando com o código sem as mudanças em vez de confiar na medição nova. O que ficou: cor nomeada por variante, sem tocar na especificidade de `a`. (3) **Dois avisos do Base UI, ambos legítimos** — `Select` nascia não-controlado e virava controlado na primeira seleção (duas fontes de verdade para o mesmo valor), e `Button render={<a>}` exige `nativeButton={false}`. **A lição não é "faltou teste":** contraste 1:1 e grade de quatro colunas passam em qualquer asserção de DOM, e o E2E não olha pixel. Evidência: nav 8.24 (restaurada), primário 5.83, link-botão 13.29, os três medidos no navegador. **O backfill de `gym_unit_id` rodou com dados reais** ao religar o ambiente: 12 alunos, todos para a MATRIZ, zero vazamento cross-tenant, nenhum perdido |
| 18/08/2026 | **F45** *(combos, Toast e filtros)* | — | *(PR desta entrega)* | **Quatro defeitos e um filtro que faltava, issue [#110](https://github.com/RodReis/arenahub/issues/110).** (1) **As combos mostravam o valor cru:** `Sexo cadastral` exibia `FEMALE` e `Unidade`, o UUID `c89a3ee6-f2e5-...`. A causa nao era da tela — o `Select.Value` do Base UI renderiza o proprio `value` quando o `Select.Root` nao recebe `items`, e o menu mostrava o rotulo certo o tempo todo: so o **gatilho** mentia. Corrigido na origem, no helper `selecao` que monta toda combo do wizard, e a lista de `items` sai das MESMAS opcoes que montam o menu — um so lugar define rotulo, entao gatilho e menu nao podem divergir. (2) **Erro nao virava Toast**, contra a regra explicita do `CLAUDE.md`: havia **onze `<p role="alert">`** em oito telas, e o `Toast` — pronto desde a F42 — era usado em **um** lugar. O conserto nao foi repetir `show()` oito vezes: **erro de `useActionState` nao e evento**, chega como valor novo no estado no meio de um render, sem `onError` onde chamar nada. Dai o hook `useToastDeErro`, que compara a MENSAGEM e nao a presenca — reenviar e receber o mesmo erro tem de avisar de novo, senao a tela muda parece botao quebrado. **O `ToastProvider` subiu para o layout raiz:** o login mora fora de `(protected)`, e com o provider so la o `useToast` derrubaria a tela de entrada ao errar a senha. **Tres avisos ficaram de fora, de proposito:** `sem-unidade`, `sem-catraca` e `aviso-de-inelegibilidade` nao sao notificacao efemera, sao **impedimento permanente** — toast some, o impedimento nao sumiu. (3) **A lista de alunos fora do mockup:** ganhou breadcrumb, acao primaria como botao solido, matricula em mono com `tabular-nums` e nome + CPF empilhados numa celula so — sao a mesma pergunta ("e esta pessoa?"), e em colunas separadas o olho atravessa a linha inteira entre uma metade e outra da resposta. **O `—` de "sem CPF" saiu da lista** depois de ver a tela: 13 de 16 alunos nao tem documento, e um travessao por linha virava uma coluna de ausencia chamando atencao para o que **nao** e problema; a marca continua na ficha, onde a pessoa foi procurar o documento. (4) **Filtro por situacao e unidade**, que faltava para responder "quem esta bloqueado?" sem varrer a lista. `gymUnitId` **ja existia** no backend desde a F45 — so faltava a UI; `status` e novo. **Situacao invalida na querystring degrada para "sem filtro", nunca 400:** o parametro vem da URL que a recepcao edita, colega manda por chat e navegador restaura de sessao antiga, e trocar a lista inteira por pagina de erro por causa de um `?status=ATIVO` datilografado e pior que ignorar. Os filtros **vao junto da paginacao**, senao "Proximos" com "Bloqueado" ligado devolveria a base inteira. O de unidade **so aparece com mais de uma**: numa academia de endereco unico ele seria um controle com uma opcao so, que ocupa espaco e ainda esconde um modo de errar. **`Button` ganhou `href`** e passou a renderizar `<a>` de verdade — botao que navega tem de ser link, e tres telas resolviam isso de tres jeitos diferentes. **Fora de escopo, por decisao do PI:** as colunas Plano, Ultima visita e Risco de saida do mockup — a API nao devolve nenhuma das tres, risco de saida e MVP 5, e coluna vazia por varios MVPs mente sobre o que o sistema sabe. Evidencia: **166 unitarios de UI** (5 novos do hook, 3 do `Button href`), **304 de integracao** (3 novos do filtro, incluindo o valor invalido), **55/55 E2E**, lint 9/9, typecheck 13/13, build 7/7. Verificado no navegador, que e onde os defeitos apareceram: combo mostra "Feminino" e "Unidade Matriz", filtro devolve so os 9 Ativos, toast aparece e **leva ao passo onde o campo mora** |
| 19/08/2026 | **F45** *(hierarquia e trilha)* | — | [#115](https://github.com/RodReis/arenahub/pull/115) | **Passe de craft, medido antes e depois.** O defeito nao era contraste — todo par passava AA, o pior em 5.83. Era **hierarquia achatada**: `"sem acesso a catraca"`, que e a resposta a pergunta que traz a recepcao a esta tela (*por que ele nao passou?*), saia com `#565E69`, 12 px, peso 400 — **os mesmos tres valores** da legenda "Alunos, do cadastro mais recente" e do aviso sobre busca por CPF. Contraste diz se da para **ler**, nao se da para **achar**. Agora carrega `--ah-state-danger` e peso 500: e ESTADO, e accent em maquina de estado e erro de lint (regra 3). **Hover de linha no `DataTable`**, que serve as 10 telas que o consomem: a 1280 px a ultima coluna fica a mais de mil pixels da primeira e o olho perde a linha no meio; `background-color` sozinho porque e a unica propriedade que o compositor resolve sem refluxo, e a promessa de p95 < 300 ms nao sobrevive a uma tabela que recalcula layout a cada movimento do mouse. Os **sete** pares de texto sobre `--ah-surface-sunken` foram medidos: menor 4.68, todos passam AA. **A trilha do wizard mentia.** "Concluido" era `indice < passo` — POSICAO, nao preenchimento: quem pulasse do passo 1 ao 4 via 1, 2 e 3 carimbados sem ter digitado nada. Pior, `numeroAtual` e `numeroConcluido` compartilhavam o mesmo estilo (medido: `background: #00707B` identico nos dois), entao **nem a posicao chegava a ser legivel**. Agora sao quatro estados honestos — `pronto` (obrigatorios preenchidos), `pendente` (falta, e o envio ja foi tentado), `aberto` (sem obrigatorio, ou ainda nao cobrado) e o eixo separado `atual`. **Os dois eixos sao independentes, e junta-los criou um ponto cego visto na tela:** com a unidade em falta e a pessoa parada no passo 3, `atual` vencia `pendente` e a trilha ficava calada enquanto o toast pedia a unidade — por isso `data-estado` e `data-atual` viraram atributos distintos. Cor nunca vem sozinha (DS-PAINEL §10): o numero vira `✓` ou `!`, e o leitor de tela recebe "— preenchido" / "— falta preencher" num recorte de 1 px, verificado na arvore de acessibilidade (`display: block`, `visibility: visible`). A regra saiu do componente e virou funcao **pura** em `src/students/trilha.ts`: dentro do wizard ela fechava sobre tres estados do React e so era testavel montando a tela inteira. Evidencia: **62 unitarios de web** (6 novos, incluindo *espaco nao preenche campo* e *a pendencia limpa sozinha depois da correcao*), 166 de UI, **304 de integracao**, **55/55 E2E**, lint 9/9, typecheck 13/13, build 7/7. **Nota de ambiente:** `pnpm test:integration` aborta com `3221226505` (`0xC0000409`, stack buffer overrun do Node) quando roda logo apos o E2E nesta maquina — **reproduzido igual na `main` sem o diff**, e as 21 suites passam em lotes. O projeto fixa Node 22; a maquina roda 24, e o `WARN` de engine aparece em toda execucao |
| 19/08/2026 | — *(#111, #112)* | — | [#116](https://github.com/RodReis/arenahub/pull/116) | **`[INFRA]`: as duas guardas de CI que passavam verde sem verificar o que prometiam.** Ambas achadas na revisão da #110 e deixadas fora daquele diff de propósito — guarda alterada dentro de correção de UI é diff que ninguém revisa. (1) **O relatório de evidência subcontava.** `"Button.spec.tsx".endsWith(".spec.ts")` é `false` — termina em `x` —, então os **17 `.spec.tsx`** de `packages/ui` não entravam em nível nenhum: o `reports/TESTS.md` que **barra merge** afirmava 79 arquivos onde havia **96** (unitários 50 → 67). O gerador **tinha** self-check, e ele passava: garantia que o gerador conta o que ele acha, **não que ele ache tudo** — ponto cego de qualquer teste que só exercita o caminho que o autor imaginou. Cada nível passou a ter **lista** de sufixos; a precedência continua vindo do **ponto literal**, não da ordem do array (`.int-spec.ts` não casa `.spec.ts` porque antes de `spec` vem `-`), e afrouxar para `-spec.ts` faria integração vazar para unitário — coberto por caso novo. O `TESTING.md` §2 mandava usar `*.test.tsx` para web, **sufixo que não existe em nenhum arquivo do repositório**. (2) **O lint não carregava `react-hooks` nem `jsx-a11y`** — nenhuma das quatro configs os referenciava, e o `admin-web` usa `useActionState` e `useFormStatus` em oito telas: sem `rules-of-hooks`, hook fora de ordem e dep faltante só apareciam em **runtime**, e a F45 já provara que defeito de runtime nesta app sobrevive a 55 E2E verdes. Config novo (`packages/config/eslint/react.js`) em vez de acréscimo ao `base.js` — `api` e `edge-agent` não têm JSX e não devem carregar plugin de React. **O verde foi verificado com canário, não aceito de cara:** violação plantada com hook condicional, dep faltante, `<img>` sem alt, label solto e `role="checkbox"` sem `aria-checked` — as 7 classes dispararam; lint verde sem canário não distingue *"nada errado"* de *"plugin não carregou"*, e o segundo era o estado anterior. **Duas decisões registradas:** o `react-hooks` **v7** traz o React Compiler inteiro (16 regras no `recommended`, com `immutability` e `purity`) e **ficou de fora** — adotar o compiler é decisão de arquitetura, não efeito colateral de issue de lint; e o `jsx-a11y` entrou como **subconjunto nominal** de 11 regras, cada uma correspondendo a uma linha do `DS-PAINEL.md` §10, porque preset completo traz regra sobre elemento que não usamos e o ruído faz desligar o plugin. **A adoção acusou violação real, como a issue previu:** `Button` passava `children` por spread e a `anchor-has-content` não conseguia provar conteúdo no `<a>`; `children` virou prop **obrigatória** — `ButtonHTMLAttributes` a traz opcional, e botão sem conteúdo é anunciado como alvo sem nome. Nenhum chamador quebrou. **A revisão de código acrescentou dois LOW, ambos corrigidos no PR:** o nível **`segurança`** (`.sec-spec.ts`) estava no `TESTING.md` §2 desde o bootstrap e **nunca esteve no classificador** — não era regressão, mas deixar de fora o único nível restante seria consertar metade do defeito, e a linha zerada de hoje passa a contar no dia do primeiro teste de isolamento de tenant; e a citação `DS-PAINEL.md` §11 (regras de lint) onde cabia §10 (WCAG 2.2 AA). **O `--watch` mentiu de um jeito novo:** `gh pr checks 116 --watch` saiu **0** enquanto `gh pr checks` dizia *"no checks reported on the branch"* — rollup ainda não populado lido como *"nada falhou"*, variante do que o #102 ensinou. O verde real veio de `gh run watch --exit-status` mais conferência job a job. Evidência: lint 9/9, typecheck 13/13, build 7/7, **837 testes em 10/10 tasks**, self-check do gerador 9/9 |
| 19/08/2026 | **F14** | SPEC-014 | [#117](https://github.com/RodReis/arenahub/pull/117) | **Cartão e recorrência, Slice 2.3.** Destravada pelo **ADR-032**, que fechou o ADR-013: o card `[GATE]` **nunca chegou a ser criado no board**, e o que faltava não era matriz — era o fato, ausente de todo documento, de que **a academia já recebe pela Sicoob**. Como o Sicoob é banco e não adquirente (sem cartão tokenizado, cofre nem assinatura), provedor único é impossível: **Sicoob PIX + Getnet cartão**, com emenda ao `MVP-02` §5. 🔴 **A fatia produziu um defeito crítico, achado sondando antes do PR:** a chave de idempotência era `card:<invoice>:<tentativas feitas>`, **derivada de uma contagem** — e contagem muda entre a leitura e a escrita, que é a janela exata que a idempotência existe para fechar. Duas requisições concorrentes leem `0` e `1`, montam `:0` e `:1`, e a constraint `(tenant_id, idempotency_key)` **nunca dispara**. **Medido, não deduzido:** `Promise.allSettled` contra Postgres real devolveu **2 sucessos, 2 tentativas gravadas, duas chamadas ao provedor** — aluno cobrado em dobro, sem erro e sem log. A lição não é "faltou teste de concorrência": é que **a constraint existente protegia contra o caso errado** (reenvio da *mesma* chave), e o caso real gera duas diferentes — guarda presente, verde, defendendo outra coisa. Conserto **no banco**: índice parcial `UNIQUE (tenant_id, invoice_id) WHERE method = 'CARD' AND status = 'PROCESSING'`; um `if (jaExiste)` perderia a mesma corrida (tese do inbox da F13, INV-076), e `P2002` vira **409 de domínio** porque 500 faria a recepção clicar de novo. A revisão de código chegou ao mesmo diagnóstico de forma independente (BLOCK). **Segundo bug, latente, criado pela decisão dos dois provedores:** `criar-cobranca-pix` resolvia a conta com `findFirst({ tenantId, active: true })` — **qualquer** conta ativa —, e com os dois cadastrados a cobrança PIX sairia pela conta de **cartão** metade das vezes, conforme a ordem de inserção. Corrigido com `ProviderAccount.capability` + resolvedor que **pergunta pela capacidade, nunca pela marca**: nenhum caso de uso menciona `sicoob` ou `getnet`, e trocar de PSP é um adapter e uma linha na tabela — nem migration, porque `provider` segue `String`. **Não virou registry**, por decisão registrada: sem config declarativa, fallback ou descoberta em runtime — a extensibilidade já mora na interface, e o terceiro provedor trará exigência que ninguém previu (a Getnet exige tokenização no cliente, o Sicoob exige certificado ICP-Brasil; nenhum "gateway genérico" prevê certificado digital). **INV-098 é a regra dura:** a Getnet expõe **dois** caminhos de tokenização e só um serve — `POST /v1/tokens/card` chamado pelo backend recebe `card_number` cru e joga o `apps/api` para dentro do escopo PCI DSS. O caminho errado é **mais fácil**, então não se chega nele por descuido, chega-se por atalho; daí a guarda ser **estrutural** (lê o código-fonte) e não comportamental. **Verificada por mutação:** plantei o adapter chamando o endpoint cru e 3 regras acusaram — mas ela também reprovava o próprio `payment-provider.port.ts`, cujo **comentário** diz *"PAN e CVV nunca chegam aqui"*, ou seja, acusava a documentação da regra, e a saída mais barata seria apagar a frase que ensina a próxima pessoa. **Política de retry do PI** (D+0/D+3/D+7 contados do **vencimento**, nunca encadeados; recusa permanente para na hora; offsets em `BillingSettings` por tenant, e o tamanho da lista **é** o máximo de tentativas): duas de três mutações pegas — encadear (D+10) quebra 3 casos, ignorar a recusa permanente quebra 1. **A terceira passou limpo e corrigiu um erro meu:** eu afirmava que `setUTCDate` protege contra horário de verão; **não protege** — em UTC não há DST, e a soma em milissegundos é equivalente por construção, então o teste passava dos dois jeitos e não provava nada. **Cancelar recorrência ≠ cancelar assinatura:** confundi-las tiraria o acesso de quem pagou — o aluno que cancela hoje um plano pago até o dia 30 continua entrando até o dia 30, porque quem decide acesso é o entitlement (regra nº 1). **Fora de escopo, registrado:** os adapters reais **não foram escritos** — dependem de credencial e sandbox, e a matriz do gate marcou como não verificado exatamente o que eles teriam de honrar (assinatura de webhook, estorno parcial, chave estável de evento); adapter contra documentação não confirmada parece pronto e falha na primeira chamada real. A UI de cartão é do provedor (Get Checkout); job de vencimento é **F15**; estorno é **F16**, que ainda espera as duas políticas do `M2-COMPLIANCE-01`. **A guarda de contrato OpenAPI pegou as rotas novas — e ao corrigi-la vi que a lista PAROU NA F11:** F12 e F13 entregaram sete rotas sem declarar nenhuma; o snapshot pegava a mudança, a lista não, e é ela que diz em prosa o que a fatia prometeu publicar. Declaradas as sete atrasadas junto das três desta fatia. Evidência: lint 9/9, typecheck 13/13, build 7/7, **348 unitários**, **319 de integração em 23 suítes** — 9 novos contra Postgres real, e todas as migrations provadas contra banco real com distratores antes do commit |
| 19/08/2026 | **F15** | SPEC-015 | [#119](https://github.com/RodReis/arenahub/pull/119) | **Inadimplência e acesso, Slice 2.4.** É aqui que a **regra nº 1** deixa de ser texto: a cadeia `Invoice vencida → Subscription PAST_DUE → Entitlement SUSPENDED → DENY` existe, e a catraca continua sem saber o que é uma invoice. Descoberto ao mapear: **o desbloqueio já existia** — a F13 construiu a volta (`PAST_DUE → ACTIVE`, `SUSPENDED → ACTIVE`, com `REVOKED` que não ressuscita) antes de existir quem suspendesse; a F15 construiu só a ida. **`PAYMENT_OVERDUE` é razão nova e não reuso:** "não tem plano" manda a recepção vender um, "está devendo" manda cobrar, e colapsadas a tela dizia a mesma coisa. Distinção que só apareceu escrevendo o teste: suspenso com período **já vencido** volta a `NO_ENTITLEMENT` — é plano vencido, não inadimplência, e dizer "pague para liberar" a quem não tem mais plano manda cobrar dívida que não existe. **`POLICY_VERSION` 1.0.0 → 1.1.0**, porque o próprio arquivo exige número novo em mudança observável: ninguém passou a entrar nem deixou de entrar, mas o `reason` gravado mudou, e ele responde "por que este aluno não passou?". Ao acrescentar a razão o compilador acusou uma **terceira cópia** da lista de razões, uma união literal escrita à mão — trocada pelo tipo derivado da fonte. **Job de vencimento (ADR-019):** a Especificação §42 dizia "vencimento 10/08, carência 3, bloqueio 14/08" e 10+3=13; há caso afirmando que **não** é 14/08. Fuso da **unidade**, sem fallback — testado o caso que o fallback esconderia: 22h em São Paulo no dia 10 já é dia 11 em UTC, e contar sobre o dia de UTC adiantaria o bloqueio em 24h. **O que o ADR-019 deixou aberto foi decidido aqui:** o instante é **congelado** em `Invoice.blockAt` (coluna que existia desde a F12 e nunca fora escrita) — recalcular sempre faria mudança de configuração alterar **retroativamente** a situação de alunos. Sem `BillingSettings` **não bloqueia ninguém**, e **suspende em vez de revogar** (`REVOKED` não ressuscita, e usá-lo tornaria um atraso de três dias irreversível). **Liberação financeira** com modelo próprio, não reuso do override da F9: aquele é por **passagem** (amarrado a um `accessEventId`), este é por **período** — reusar obrigaria a recepção a repetir a liberação a cada entrada durante três dias. Aplicada **depois** do motor e **só** sobre `PAYMENT_OVERDUE`: aplicá-la a qualquer `DENY` viraria chave-mestra, contra o `M1-BR-006`. Expira por comparação de data, sem job. Regra nº 9 respeitada: o acesso importa o **caso de uso público**, nunca a tabela. **A revisão de código voltou BLOQUEIO + GRAVE, os dois reais e reproduzidos antes de corrigir.** (1) **A corrida com o webhook:** os `subscriptionIds` vinham da leitura pré-transação, e interceptando-a para simular o commit do pagamento na janela o resultado foi `direitosSuspensos: 1` — o entitlement de quem **acabou de pagar** era suspenso de volta, com `suspendedAt` gravado depois do pagamento. Corrigido relendo dentro da transação quais invoices continuam `OVERDUE`. (2) **Faltava provar isolamento de tenant** nos três casos de uso (`TESTING.md` §5): três casos novos, e mutação removendo o filtro quebra um. **A atenção do DST: o revisor errou o fuso e acertou o problema.** Varri 3360 combinações e Lord Howe/Chatham convergem — mas a varredura achou **06/09/2026 em `America/Santiago`**, onde o horário de verão começa à meia-noite e **as 00:00 daquele dia não existem**: não há ponto fixo, o laço oscila entre 03:00Z e 04:00Z, e o código devolveria um ou outro conforme a **paridade** do número de passadas. Bloqueio uma hora deslocado, sem erro, uma vez por ano. Passou a devolver o primeiro instante que existe. **A tela foi redesenhada a pedido do PI**, com crítica antes: ela respondia a pergunta errada (ordenada por vencimento, cronológica) quando o gestor pergunta onde está o dinheiro e a recepção pergunta quem ligar. Dois blocos — resumo com valor em peso próprio e **gráfico de composição da dívida por idade** (Recharts, escolha do PI); fila ordenada por **urgência** (valor × dias, com quem está em carência no fim, porque ainda entra). Chips de motivo no padrão do mockup de retenção, e **telefone visível** na linha (a recepção liga do fixo tanto quanto manda mensagem). **Não há evolução mensal, e é deliberado:** existe **um mês** de invoice no banco, e uma linha com um ponto não informa — desenhá-la com meses vazios antes faria a curva subir do zero, sugerindo uma piora que não aconteceu. **Quatro defeitos que só a execução mostrou:** a **migration da tabela de liberação financeira não existia** (modelo no schema, tabela não — typecheck, lint e build passavam porque o client Prisma vem do schema; a tela deu 500); **loop infinito de render** no hook de tokens (`[tokens]` compara por identidade e o array chega novo a cada render — `Maximum update depth exceeded`, e o **gráfico ficou sem barras**); faixas zeradas com rótulos flutuando; e **bloqueado com zero dia de atraso sumia do gráfico** — parece impossível até lembrar que `graceDays = 0` bloqueia na meia-noite do vencimento, então uma fatura das 14h já está bloqueada às 20h com zero dia inteiro, contando no total sem aparecer em barra alguma. **E um que o teste achou:** `+1 415 555 0000` saía formatado como `(14) 15555-0000`, telefone brasileiro que não existe — contar dígitos não distingue origem, o `+` distingue. **A guarda de evidência subcontava de novo:** o `admin-web` usa `.test.ts` e os 6 arquivos de lá nunca entraram no relatório; a #111 consertou o `.spec.tsx` de manhã e passou por cima deste — segunda dose de *guarda conserta o que alguém lembrou de olhar*. Evidência: lint 9/9, typecheck 13/13, build 7/7, 10/10 tasks, **334 de integração em 24 suítes**, 24 casos na função de bloqueio, 83 de web. Verificado no navegador a 1440 e 1024px, com e sem telefone cadastrado |
| 19/08/2026 | **F16** | SPEC-016 | [#120](https://github.com/RodReis/arenahub/pull/120) | **Estorno, conciliação e operação, Slice 2.5 — última do MVP 2.** **Destravada pelo PI**, que decidiu as duas políticas do `M2-COMPLIANCE-01` que bloqueavam a fatia desde o ADR-013: `KEEP_UNTIL_PERIOD_END` para o acesso no estorno, e teto configurável por tenant que **recusa** em vez de aprovar (não existe papel de aprovador no MVP 2, e uma fila de aprovação que ninguém opera produziria estorno travado para sempre). **As quatro entidades eram `[indefinido]` no `CONVENTION.md` §2.3** — `Refund`, `ReconciliationRun`, `ReconciliationItem`, `Receipt` — e agora têm campos e máquina de estado. **A porta ganhou o sétimo método:** `listMovements`, com emenda ao `MVP-02` §12 no mesmo PR (precedente do ADR-027, que emendou a §11 ao criar `account_credits`). Sem extrato a conciliação só compararia o nosso registro com a **nossa cópia** do registro do provedor, e `MISSING_EXTERNAL` — o caso que ela existe para achar — ficaria invisível. **A lição da F14 foi aplicada antes de o bug existir:** a chave de idempotência do estorno deriva do **valor e do que já saiu**, nunca de uma contagem, e a exclusão mútua mora em índice parcial (`refunds_payment_id_em_voo_key`), provado contra Postgres real com quatro distratores e um teste de `Promise.allSettled` — dois estornos simultâneos, **um só passa**. Aqui o erro seria devolver o dinheiro duas vezes. **O casamento da conciliação foi provado por mutação:** trocando a chave `(pagamento, tipo)` por só o pagamento, **2 testes caem** — um pagamento de R$ 120 estornado em R$ 120 produz dois movimentos idênticos, e casar só pelo pagamento faria os dois baterem entre si, a conciliação fechar em zero, com o dinheiro tendo ido e voltado sem nenhuma ponta registrada. **Achado pelo teste, não deduzido:** a unicidade de `ExternalMovement` era `(tenant, movimento)` e fazia a **segunda** conciliação da mesma conta falhar — o mesmo movimento aparece legitimamente em janelas que se sobrepõem. Passou a incluir a run. **A lista de comandos de resolução é fechada, e o que ficou de fora é a decisão:** `CREATE_COMPENSATING_MOVEMENT` cria lançamento financeiro fora da cadeia `Pagamento → Invoice → Entitlement`, e `LINK_EXISTING` reintroduz por decisão humana o casamento frouxo que a matriz determinística recusa. Ambos do plano de apoio, ambos recusados. **Pagamento manual não é estornável** (ADR-027): não há provedor que devolva, e um estorno gravado ficaria `REQUESTED` para sempre esperando confirmação que nenhum webhook traz. **Saúde de webhook não virou tela nova:** `OperationalAlert` já tinha `resource` extensível e a tela já mostrava impacto e ação — três regras em `alert-rules.ts`, zero código de UI. `WEBHOOK_BACKLOG` e `WEBHOOK_SILENCIOSO` são **separados** pelo mesmo critério que separou `EDGE_OFFLINE` de `EDGE_CREDENTIAL_EXPIRING` (ADR-011): ações opostas. E o silêncio é a falha **pior**, porque não produz erro nenhum — tudo parece calmo enquanto nenhum pagamento é reconhecido. Coleta é **por conta**, não por tenant: com dois provedores (ADR-032) o PIX pode estar mudo com o cartão funcionando. **Fora de escopo, registrado:** adapters reais seguem sem existir (dependem de credencial e sandbox), o ciclo-piloto com dinheiro real e o restore de backup das Tasks 6–7 do plano de apoio não são código, e o `AuditLog` continua sem `reason`/`evidence`/`approver` — razão e evidência foram para as entidades, e a lacuna do INV-126 (que não lista resolução de divergência) virou **INV-152**, registrada para o Cowork emendar. Evidência: lint 9/9, typecheck 13/13, build 7/7, **440 unitários**, **360 de integração em 25 suítes** — 23 novos contra Postgres real, migration aplicada e índice parcial provado com distratores antes do commit |
| 20/08/2026 | **F17** | SPEC-017 | *(PR desta entrega)* | **Avaliação física manual e contexto de saúde, Slice 3.1 — primeira do MVP 3.** **A fatia entrou sem trava de consentimento**, aplicando a retificação do PI de 20/08: peso, gordura e medidas a Arena Positiva já coleta há anos com aparelho próprio, como parte do serviço contratado — e o plano **vende** bioimpedância a cada 30/60 dias. Trocar o caderno pelo ArenaHub é mudança de **meio de registro**, não início de tratamento; é o mesmo raciocínio do **ADR-034 decisão 10** para os 1.618 CPFs do Pacto. O que exige aceite é enviar os números a um terceiro fora do Brasil, e isso é **F21**. `HEALTH` entrou como tipo em `ConsentDocumentType`: o Code recomendou e **o PI decidiu**, reusando `ConsentDocument`/`ConsentRecord` em vez de criar `health_consents`: a imutabilidade e a revogação da F8 já são testadas, e duas trilhas de consentimento em paralelo duplicariam as duas regras. O registro existe e **não bloqueia nada**. **A imutabilidade (INV-102) é o coração da fatia, e ela mora em três camadas, não em um `if`:** a regra pura recusa a transição, o repositório relê o status **dentro** da transação, e o `UPDATE` traz `status: 'DRAFT'` no `WHERE` — duas requisições concorrentes, uma publicando e outra editando, deixariam a edição passar **depois** da publicação se a checagem vivesse só antes da transação, e a avaliação oficial mudaria de valor sem virar correção. **Correção é linha nova e a original continua publicada**: apagar destruiria a prova de que o número errado circulou, e o aluno que recebeu o laudo errado não teria como mostrar o que viu. A **segunda** correção do mesmo original é recusada por `@unique` em `supersedes_assessment_id` — a checagem em código dá a mensagem, o índice dá a garantia; sem ele haveria dois "valores certos" para a mesma medição sem critério de desempate. **Medida é LINHA, nunca coluna por tipo (INV-104):** campo que o aparelho não reporta simplesmente não gera linha. Coluna anulável por tipo convidaria alguém a preencher com `0`, e zero num gráfico de composição corporal é uma queda que não aconteceu. **O par original sobrevive à conversão (INV-105)** — provado no banco, não no cálculo: 154 lb gravam `original_unit = LB` ao lado de `canonical_value = 69,853 kg`, e é o que permitirá descobrir, meses depois, que a balança de uma unidade reportava em libras. `Decimal(10,4)` e não `Float`, porque comparativo subtrai números próximos, que é exatamente onde o erro binário aparece. **O contexto de saúde do ADR-037 é a parte que decide se o MVP 3 será usado ou abandonado.** Cada fator **suprime** um aviso de forma determinística, e o teste `cobertura do ADR-037` percorre o enum inteiro exigindo efeito declarado — fator novo sem supressão nem bloqueio **reprova**, que é como o *"sem teste, não entra"* do PRD passa a valer sozinho em vez de depender de alguém lembrar. `COMPOSICAO_ATIPICA` suprime compartimento **absoluto** e mantém **razão**, porque pessoa grande tem água, proteína e mineral grandes e é a proporção entre eles que ainda diz algo — o caso do laudo real de 03/08, com 69,7 kg de massa livre de gordura contra a faixa de 52,0–64,8 do aparelho, onde **seis campos saem "acima" numa única medição**. `GESTANTE_OU_POS_PARTO` **não suprime nada de propósito**: bloqueia a análise inteira, e suprimir avisos ali seria afirmar que o resto foi interpretado. Bloquear a análise **não bloqueia a avaliação** — há teste para isso. Lista **fechada, sem texto livre**: fator individual é dado do art. 11, e campo aberto no balcão vira depósito de informação médica com finalidade impossível de enumerar. Desativar carimba `deactivated_at` em vez de apagar, porque o snapshot da F21 precisa saber o que valia **na data da análise**. 🔴 **Três defeitos achados na revisão da própria fatia, dois deles críticos e medidos.** **(1) O INV-102 dependia de um `if` que não serializava nada.** A checagem de `status` em `substituirMedidasDoRascunho` era um `if` sobre um `SELECT`, e **as medidas moram em outra tabela**: o `deleteMany`/`createMany` em `body_measurements` não colide com o `UPDATE` de `body_assessments`, então em **READ COMMITTED** — o padrão do Postgres — publicar commitava no meio da edição e a avaliação **já publicada** terminava carregando o valor do rascunho. Número oficial alterado sem virar correção, exatamente o que o invariante existe para impedir. A sonda inicial com `Promise.allSettled` marcou 25/25, e **esse número estava inflado** — a investigação seguinte mostrou que a maior parte dele era ordem *legítima* (edição commitando enquanto ainda era rascunho), não vazamento. O que sobra e é real: **em READ COMMITTED nada serializa as duas transações**, e a janela existe. Os 19 testes que eu já tinha passavam porque nenhum exercitava concorrência. Conserto com `SELECT ... FOR UPDATE` na linha da avaliação nos **três** caminhos de escrita (editar, publicar, corrigir), que é o que serializa as transações; a contagem de medidas passou a ser lida **depois** da trava, porque contar antes lê um número que a edição concorrente ainda muda. Depois: **0/25**. **E aqui a fatia produziu a lição mais cara, que é sobre o teste e não sobre o código.** Escrevi **três** versões da guarda de concorrência e as três estavam erradas — duas reprovadas pelo próprio CI, com a terceira reprovada por mutação. **(a)** A primeira reprovava toda avaliação publicada carregando o valor da edição; mas existe ordem **legítima** que produz exatamente isso — a edição commita *enquanto ainda é rascunho* e publicar congela o valor dela depois. A máquina do CI, mais lenta, produzia essa ordem (1/10) e a minha não (0/25): **falso positivo**. **(b)** A segunda tentou separar as ordens comparando `medida.createdAt` com `publishedAt` — irrecuperável, porque um vem de `now()` do **Postgres** e o outro de `new Date()` do **Node**, e o skew entre containers do CI inverte a comparação. **(c)** A terceira deduzia a ordem do par de status HTTP, passou local, e **passou também na mutação** — guarda decorativa, que é pior que teste nenhum porque afirma cobertura que não tem: sem a trava, a edição também responde 200 com o valor reescrito, indistinguível do caso legítimo. **A raiz das três: as duas ordens produzem estado final idêntico visto de fora**, e forçar a ordem proibida com uma transação segurando `FOR UPDATE` apenas reproduz, com encenação, o teste sequencial que já existe. **Decisão do PI: a trava fica, documentada como sem teste.** Removê-la não quebra nenhum dos 22 — e é justamente isso que está escrito, em voz alta, no docblock de `travarAvaliacao`, junto das três tentativas e do porquê de cada uma falhar, para que quem for removê-la algum dia saiba o que está removendo: a janela é real, só não é observável pela API. O que **continua provado**, por teste sequencial e determinístico, é o essencial do invariante — *publicada, nada muda*: a edição que chega depois recebe 409 e o número permanece. **A lição que vale além desta fatia:** teste de concorrência escrito na máquina rápida codifica a ordem que **aquela** máquina produz, e comparar carimbos de relógios diferentes (app e banco) é falso positivo esperando acontecer. **(2) `ativarFator` repetia a idempotência derivada de leitura da F14.** `findFirst` + `if (jaAtivo) return` perde a corrida por construção: duas requisições — dois cliques, ou o retry do navegador — leem as duas `null` e as duas criam. O teste que existia só cobria o caso **sequencial**, onde a segunda leitura já enxerga o commit da primeira. Fechado onde tinha de ser fechado, **no banco**: índice parcial `student_health_context_um_fator_ativo_por_aluno` sobre `(tenant_id, student_id, factor) WHERE deactivated_at IS NULL`, e `P2002` passa a ser **sucesso idempotente** — o fator ficou ativo, que é o que o chamador pediu. **Parcial de propósito:** `@@unique` cheio cobriria as linhas desativadas e impediria **reativar** um fator que o aluno já teve — gestante que engravida de novo, atleta que volta a competir; há teste para os dois. Prisma não modela índice parcial, então ele está documentado no schema com o aviso de não aceitar o `migrate dev` que propuser apagá-lo, na convenção que o `access_events` já usava. **Verificado por mutação:** `DROP INDEX` no banco derruba o teste com 2 linhas onde deveria haver 1. **(3) O defeito de semântica, achado por desconfiar de um teste que já estava verde:** "a academia B não corrige avaliação da academia A" passava com **409 `HEALTH_ASSESSMENT_IMMUTABLE`** — e o 409 estava **errado por dois motivos**. Avaliação inexistente não é conflito de estado; e responder conflito para id de **outro tenant** vaza que aquele id existe em algum lugar, oráculo de existência entre academias (INV-006). O caminho "não encontrada" reusava o erro de imutabilidade em **quatro** pontos do repositório. Virou `AvaliacaoNaoEncontradaError` (404, `HEALTH_ASSESSMENT_NOT_FOUND`), e o teste passou a exigir o código, não só o status — **status igual com causa diferente é a forma mais barata de um teste passar sem provar nada**. **Fora de escopo, registrado e deliberado:** o **INV-117** pede que autorização de dado de saúde considere **vínculo profissional-aluno**, e o que existe é tenant + permissão (`health.read`/`health.assess`, separadas de `student.*` pelo mesmo critério de `biometric.*`: quem atende a recepção não precisa ver o percentual de gordura de ninguém). O vínculo **não existe como modelo** — `students.advisor_user_id` é consultor comercial, não avaliador — e o `M3-AC-009` diz *"quando essa restrição se aplica"*: com um avaliador na Arena Positiva, não se aplica hoje. Modelar vínculo que ninguém preenche produziria tabela vazia barrando acesso legítimo. **Colisão de nome herdada, não resolvida:** já existe `apps/api/src/health/` (health check da API) e `test/integration/health.int-spec.ts`; o módulo novo é `src/modules/health/` e a suíte, `avaliacao-fisica.int-spec.ts`. Caminhos distintos, leitura confusa — renomear um dos dois é fatia própria. Histórico, comparativos e gráficos são **F18**; upload e OCR, **F19**; IA, **F21**. Não há tela: a fatia é backend, e o painel de avaliação entra com a F18, quando houver histórico a desenhar. Evidência: lint 9/9, typecheck 13/13, build 7/7, 11/11 tasks, **478 unitários na API** (38 novos, de domínio) e **390 de integração em 26 suítes** — 22 novos contra Postgres real, o do índice parcial provado por mutação (`DROP INDEX` faz o fator duplicar); a trava de `FOR UPDATE` fica **sem teste**, por decisão do PI, documentada no próprio código — imutabilidade, correção vinculada, isolamento entre tenants e a unidade original conferida **no banco**, não no retorno da rota |
| 20/08/2026 | **F48** | — | *(PR desta entrega)* | **Ativação da base corrente do Pacto (~340 ativos).** Companheira da F47: aquela trouxe os 1.926 históricos como `CANCELLED`, sem direito de acesso; esta traz quem treina hoje — casa por CPF (ou nome único quando o CPF falta), atualiza endereço/telefone, grava credencial de equipamento (`StudentCredential` com cartão e identificador facial do leitor Topdata) e concede acesso: aluno por `Subscription` no plano *Programa Adultos e Idosos* + `Entitlement`; funcionário/professor/administrador por vínculo (`EMPLOYEE`/`PERSONAL_TRAINER`), sem assinatura e sem cobrança. **Nunca cria aluno novo** — quem não casa vira pendência no relatório, nunca um cadastro adivinhado; **não cria `BiometricIdentity`** (só a credencial do leitor) nem `ConsentRecord` (o vínculo de consentimento nasce no fluxo da recepção, F8/F17). Seed separado do `seed.ts` (`ARENAHUB_PESSOAS_ATIVAS=/caminho/arquivo.json pnpm --filter @arenahub/database seed:ativos`), roda manualmente uma vez contra a `DATABASE_URL` de quem chama; sem a variável **não falha** — avisa e sai com 0, para não quebrar pipeline de quem não tem o arquivo. **Idempotente por registro** (transação + `try/catch` individuais, ver I1/I2 abaixo) e emite relatório de preenchimento por campo mais lista de pendências. 🔴 **Bug crítico achado na revisão da Task 6, antes de qualquer execução real:** o caminho de **plano** gravava `janelas: []` com comentário afirmando ser equivalente a "sem restrição de horário" — meia-verdade cara, porque janela vazia dispensa só a restrição de *horário* (passo 6 do motor de decisão); as *unidades* do direito saem exclusivamente das linhas de `EntitlementUnitWindow`, e `evaluate-access.ts` nega com `WRONG_UNIT` quando a unidade da catraca não está nessa lista. **Os ~340 alunos importados por plano seriam negados na catraca**, com a razão mais confusa possível numa academia de unidade única. Corrigido unificando plano e vínculo no mesmo construtor de snapshot — a única diferença real entre os dois é a identidade do plano, e dois construtores foi o que permitiu um sair sem janela. Verificado avaliando **decisão de acesso real** com `evaluateAccess` (não contando linha de janela, que foi o que deixou o defeito passar da primeira vez): aluno por plano vai a `ALLOW`/`ACTIVE_ENTITLEMENT`; removendo as janelas (comportamento antigo), o mesmo aluno volta a `DENY`/`WRONG_UNIT`. Mais quatro achados da mesma revisão: contadores do relatório mediam quem *passou pelo ramo*, não direito *criado* — repetiam o número da primeira execução na segunda, e combinados com o bug de janela teriam escondido o defeito atrás de "331 direitos" quando ninguém ganhara acesso; **I1** — transação por registro (idempotência só ajuda se houver próxima execução; morrer no meio deixava cadastro `ACTIVE` com credencial gravada e nenhum direito, porta fechada que não virava pendência); **I2** — `try/catch` por registro, para erro de banco na pessoa 200 não apagar pendências e contadores das 199 anteriores; **I3** — `BLOCKED`/`ARCHIVED` não são reativados em silêncio (decisão de quem está no balcão, tomada depois da exportação do Pacto), viram pendência para a recepção decidir. Evidência: lint 9/9, typecheck 13/13, **44 unitários no `@arenahub/database`** (30 novos desta fatia — 23 do de/para e casamento, 7 do importador) e **14 de integração contra Postgres real** (`import-ativos.int-spec.ts`), incluindo o cenário de casamento por plano/vínculo que teria escondido o `WRONG_UNIT` |
| 21/08/2026 | **F18** | SPEC-018 | [#138](https://github.com/RodReis/arenahub/pull/138) | **Histórico e comparativos, Slice 3.2.** **A fatia entrou com `health_goals` junto, por decisão do PI**: o `M3-FR-007` manda comparar "atual, anterior, primeira e **meta**", e a meta era da Slice 3.4 — comparativo sem ela nasceria incompleto e o `M3-AC-003` não fecharia. O que sobrou para a F20 é o progresso calculado e a frequência (`student_attendance_sessions`), que dependem de dado que ainda não existe. **A regra que decide se este gráfico mente é o INV-102, e ela não está no `WHERE` da consulta:** correção **substitui** a original na série, mas as duas continuam publicadas no banco — a original é a prova de que o número errado circulou. Se o filtro morasse no SQL, o domínio nunca saberia que houve correção; `listarPublicadasDoAluno` traz `supersededBy` junto e quem descarta é `selecionarFolhas`, no domínio puro. Sem isso, o laudo errado e o corrigido apareceriam **como duas medições do mesmo dia**, que é a leitura mais perigosa possível num gráfico de composição corporal. **`INV-104` é a segunda regra, e ela aparece em três lugares diferentes:** avaliação que não mediu o tipo **não vira ponto** (o dia sem balança some da série de peso, em vez de despencar para zero); variação sem baseline devolve `null` com **razão** (`SEM_BASELINE`, `BASELINE_ZERO`, `SEM_META`), não `0` — "não mudou" e "não há com o que comparar" são coisas diferentes e ambas cairiam em "0,0 kg"; e o gráfico usa `connectNulls={false}`, porque ligar os pontos por cima de uma lacuna de três meses desenharia uma evolução que ninguém mediu. **O aceite da fatia é literal — "os mesmos dados sempre geram o mesmo comparativo" — e ele quase falhou por ordenação:** duas medições no mesmo instante saíam em ordem indefinida, e a mesma entrada produzia comparativos diferentes entre chamadas. Desempate por `id` resolve; há teste que compara o resultado da série com o da série invertida. **O corte de período (`M3-FR-008`) cai na meia-noite LOCAL da unidade, não no instante da consulta** — senão a avaliação da manhã do trigésimo dia entra ou sai conforme a hora em que o aluno abriu a tela, e o gráfico muda de conteúdo sozinho ao longo do dia. `Intl` com base IANA, nunca aritmética de offset (erraria em todo país com horário de verão); meses são de **calendário** com trava de transbordo, porque 31 de agosto menos 6 meses é 28 de fevereiro e não um "31 de fevereiro" que vazaria para março encurtando o período; fuso inválido **lança** em vez de cair em UTC (ADR-019 exige fuso da unidade sem *fallback*). Os 13 testes disso passaram de primeira, o que é motivo de desconfiança e não de conforto: **verifiquei por mutação** — removida a trava de transbordo caem 2, ignorado o offset do fuso caem 8. 🔴 **Um defeito crítico, achado pelo teste de tenant e não por revisão:** `criarMeta` e `listarMetas` aceitavam `studentId` **cru da URL**. O `tenant_id` vinha do contexto e o `student_id` do caminho, então a academia B criava meta apontando para aluno da academia A — linha órfã, com tenant de um e aluno do outro, invisível para os dois lados (INV-006). Passou no typecheck, no lint e na minha própria leitura; só o teste que **tentou o ataque** pegou, com um 201 onde esperava 4xx. Corrigido com `exigirAluno` em toda rota que recebe `studentId`, respondendo **404 e não 403** também para aluno de outra academia — 403 vazaria que aquele id existe em algum lugar. 🔴 **Segundo defeito crítico, achado na REVISÃO ADVERSARIAL da própria fatia, e do pior tipo: o dado não aparecia errado, ele DESAPARECIA.** `POST /assessments/:id/corrections` aceita `assessedAt` **livre do corpo** — o caso real é perceber o erro meses depois e **remedir** o aluno, carimbando a data da nova medição. O corte de período filtrava **linha a linha**: bastava a original cair dentro da janela e a correção fora para a consulta trazer a original já marcada como corrigida, **sem a folha**. `selecionarFolhas` descartava a original — corretamente, ela foi corrigida — e o tipo sumia **inteiro** da tela, com `SEM_BASELINE` como se o aluno nunca tivesse sido medido. Os dois testes de correção que eu já tinha usavam a **mesma** data nos dois lados e consultavam com `ALL`; a combinação correção + período com datas divergentes é justamente o que esta fatia criou, e nenhum teste a exercitava. Corrigido com `OR` que mantém a **cadeia junta**: a avaliação entra se **ela ou a correção dela** cai no período. Reproduzido primeiro (o teste falhou com `current: null`), corrigido depois, e **verificado por mutação** — removida a cláusula `supersedes`, o teste volta a falhar. **Uma meta ativa por tipo e por aluno mora em ÍNDICE PARCIAL** (`WHERE closed_at IS NULL`), não em `findFirst` + `if`: guarda que lê antes de escrever perde a corrida por construção, e esta é a terceira vez que o mesmo padrão aparece (F14, F17, agora F18). Parcial de propósito, porque meta encerrada não disputa nada — exigir unicidade sobre ela impediria o aluno de ter meta nova de peso depois de bater a anterior, que é o caso comum. **Provado no banco antes de existir código que dependesse dele:** a segunda meta ativa do mesmo tipo é recusada com `duplicate key`, e uma meta nova após encerrar a anterior passa, com as duas linhas coexistindo. **`baseline_value` fica CONGELADO junto do alvo** porque a avaliação de partida pode ser corrigida depois (INV-102), e uma meta que recalculasse o próprio ponto de partida mudaria de significado sozinha, sem ninguém ter combinado nada. **Duas correções de rota vieram da lint do design system, e ambas eram erro meu:** inventei o token `--ah-text-primary` (o correto é `--ah-text-strong`), e tentei formatar data no eixo do gráfico com `Intl` — a **regra 5** reserva isso ao `TenantDateTime`, com exceção **nominal** de dois arquivos. O eixo do Recharts precisa de string dentro do SVG, onde `<time>` não cabe; abrir uma terceira exceção seria decisão de design system, não desta fatia. Resolvido **pela raiz**: o servidor passou a entregar `assessedAtLocal` (`AAAA-MM-DD` já no fuso da unidade) e o painel só recorta dia e mês — o que a regra protege continua valendo, sem `eslint-disable`. O número migrou para `Intl.NumberFormat`, que a regra não alcança porque não é data. **A exportação (`M3-FR-017`, `M3-AC-010`) reusa o `csv.ts` da F11** — mesmo `formatarCelula`, não uma segunda implementação, porque regra de escape duplicada é regra que diverge na primeira correção — e a mesma tabela `data_export_jobs` (que já nasceu com `type` e `filters` genéricos). O que **não** reusa é o `processar` da F11, soldado a evento de acesso; torná-lo genérico mexeria em fatia entregue e testada. **É síncrono, ao contrário da F11, e a diferença é de ordem de grandeza:** aquela exporta até 100 mil eventos, esta exporta dezenas de linhas de um aluno — *polling* e segunda chamada para o link custariam mais ao operador do que a espera. O arquivo leva valor **original e canônico** com as duas unidades (INV-105), a **cadeia de correção** com a original marcada como `superseded` (some do gráfico, não da auditoria), e decimal como **string** direto do `Decimal` (INV-106 — converter para `number` introduziria erro binário justamente no arquivo que serve de prova). **O que ele NÃO leva é testado, não declarado:** CPF, telefone, foto, biometria e **fator de contexto de saúde** — fator é dado do art. 11 (ADR-037) e não entra numa planilha que a academia manda por e-mail; nem o nome do aluno vai no nome do arquivo, que aparece na pasta de downloads e em anexo. `health.read` e não permissão própria: quem pode **ver** o histórico pode levá-lo embora, e exigir permissão extra para exportar o que já está na tela seria teatro. **Fora de escopo, registrado:** a **timeline combinando avaliação e frequência** que a Slice 3.2 cita depende de `student_attendance_sessions`, que é da 3.4 — a tela entrega o histórico corporal, e a frequência entra quando a tabela existir. Evidência: build 7/7, 11/11 tasks, lint e typecheck limpos, **1120 unitários** (67 novos: 18 do comparativo, 17 do período incluindo `dataLocalIso`, 12 do CSV de saúde e 20 dos formatadores do painel) e **472 de integração** (22 novos contra Postgres real) — o índice parcial provado por mutação no banco, a LGPD da exportação provada pela ausência dos campos no arquivo gerado, e o isolamento entre tenants provado por tentativa de vazamento em cada rota nova |
| 21/08/2026 | **#129** *(FIX)* | — | *(PR desta entrega)* | **O eixo de `dayOfWeek` passou a ser um só: `0 = domingo ... 6 = sábado`, o do motor de decisão.** Quem gravava (`plan.ts`, o Zod do `membership.controller`, o Zod da action do painel, o comentário do `schema.prisma`, o `<select>` do formulário de plano) usava **ISO-8601 `1..7`**; quem **decide se a porta abre** (`packages/access-policy`, via `Date.getDay()` em `resolverHoraLocal`) lê **`0..6`**. De segunda a sábado os dois eixos coincidem — `1..6` existe nos dois — então a semana inteira funcionava **por coincidência**, e a suíte inteira passava. No **domingo** o motor calcula `0`, a linha gravada dizia `7`, nenhuma janela casava e **todo aluno cadastrado pelo caminho normal da API era negado**, com `OUTSIDE_SCHEDULE` — razão que agrava o diagnóstico, porque sugere "fora do horário" quando o horário está certo e o problema é o dia. **`0..6` ganhou, e não por estética:** o eixo do motor não é escolha nossa, vem de `Date.getDay()` e do `Intl`; mudar o motor para ISO significaria converter **em toda decisão de catraca**, no caminho mais quente e menos perdoável do produto. 🔴 **Uma segunda fonte do mesmo defeito, que a issue não mencionava:** `momentoLocal`, em `plan.ts`, é um **terceiro** conversor de fuso — duplica `resolverHoraLocal` — e mapeava `Sun: 7`. Pior que o eixo: o `?? 0` do retorno fazia **fuso sem tzdata virar "domingo" em silêncio**, e a janela de domingo abriria a catraca em qualquer dia da semana. Agora lança `RangeError`, como o `resolverHoraLocal` já fazia. **Nenhuma migração de dado foi necessária, e isso foi MEDIDO antes de escrever a migration, não deduzido:** a issue supunha "os dois eixos convivendo", mas o banco diz o contrário — `plan_access_windows` está **vazia** (nenhum plano cadastrado pela API ainda) e as **2.219** linhas de `entitlement_unit_windows` já estavam em `0..6`, todas vindas da F48, que seguiu o motor de propósito. O defeito era **latente, não materializado**. Por isso **não houve ADR**: sem dado histórico a converter, nada aqui é caro de desfazer. A própria aplicação da migration virou a segunda prova — ela rodou sobre as linhas existentes (e sobre as 1.782 do banco de integração) **sem violar o `CHECK`**; se houvesse uma única linha em `7`, teria falhado ali em vez de negar alguém num domingo. **A trava é o ponto principal da entrega, e ela está no banco:** `CHECK (day_of_week BETWEEN 0 AND 6)` nas duas tabelas. Comentário de schema não impede ninguém de gravar `7` — o comentário, aliás, **apontava para o eixo errado, e foi assim que o defeito nasceu**. Prisma não modela `CHECK`, então ele vive na migration e está documentado no schema com o aviso de que não sobrevive a um `db push` que recrie a tabela. **Provado por canário nos dois sentidos:** `INSERT` de `7` recusado pela constraint, `INSERT` de `0` aceito. **O teste que faltava é o que a issue apontou como causa raiz — "o teste que só cobre dias úteis é exatamente o que deixou isso passar":** os sete dias, ponta a ponta, rodando `resolverHoraLocal` **de verdade** em vez de fixar `localDayOfWeek` na mão — fixar o número testaria o motor contra a suposição do autor do teste, que é precisamente onde o eixo errado se esconde. Mais a **regressão exata**, escrita como o defeito acontecia: janela de domingo gravada em ISO (`7`), avaliada num domingo real, exigindo `DENY`. **Verificado por mutação, e o resultado é o argumento da fatia inteira:** replantado `Sun: 7` no motor, **só os testes novos falham** — os 70 anteriores passam com o bug de pé, que é exatamente por que ele sobreviveu até aqui; replantada a faixa `1..7` na validação, caem os dois testes novos do `plan.spec`. **Um bloco de comentário virou mentira e foi atualizado:** o aviso em `montarSnapshot` (F48) descrevia a divergência como viva e mandava *"não unifique por conta própria"* — ele agora registra que a #129 unificou, e permanece como aviso porque ISO `1..7` é a convenção mais comum em outros sistemas e "consertar" para ela reintroduz o defeito. **Achado colateral, não regressão:** o `build` já estava quebrado na `main` — cliente Prisma não regenerado após a F18 (`HealthGoal` ausente em `generated/client.js`); `prisma generate` resolveu. Evidência: lint 9/9, typecheck 13/13, build 7/7, 11/11 tasks, **1129 unitários** (9 novos: 7 dos dias da semana, 1 da regressão do domingo, 1 do eixo aceito na validação) e **472 de integração** — 27 suítes/412 testes na API (incluindo `students-membership`, que **grava** pela API, e `online-decision`, onde o motor **decide**: os dois lados do bug) mais 60 no `@arenahub/database` |
