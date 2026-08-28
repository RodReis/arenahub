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
| F19 | 3.3 Upload e publicação | **Emendada três vezes em 21/08.** **ADR-038:** um arquivo = uma importação, mas N arquivos da mesma medição = **uma sessão** = uma avaliação. **ADR-039:** o OCR **passa a publicar sozinho** — INV-103 revogado para extração (segue valendo para a análise de IA). **ADR-041:** divergência entre laudos resolve por precedência de origem (a balança vence; o ECG vence o bpm), e dois laudos do mesmo tipo discordando **não** se resolvem |
| F20 | 3.4 Metas e frequência | **`Goal` deixou de ser buraco: `health_goals` entrou na F18** (decisão do PI, 21/08 — `M3-FR-007` compara "atual, anterior, primeira e **meta**", e o comparativo sem meta ficaria incompleto). Resta a esta fatia o **progresso calculado** e a **frequência** (`student_attendance_sessions`) |
| F21 | 3.5 Análise assistiva por IA | schema fechado, `NOT_MEDICAL_DIAGNOSIS`, snapshot auditável |
| F22 | 3.6 Operação e qualidade | custo, latência, circuit breaker |

---

### Fatias fora da numeração de MVP · F42 a F48 e F53 a F56

Nascidas depois do roadmap original, por ADR ou por decisão direta do PI. Não são um MVP: são
fatias que se encaixam na fila do MVP indicado na coluna. Fonte da numeração: o **Índice
Fatia ↔ SPEC** do `docs/STATUS.md`.

| F | MVP | núcleo | estado |
|---|---|---|---|
| F42 | 2.5 | Design system da superfície `admin-web` — tokens, 15 componentes, `state-labels.ts` (ADR-025) | ✅ entregue |
| F43 | 2.5 | Design system da superfície `mobile` | gate: MVP 4 |
| F44 | 2.5 | Design system da superfície `kiosk` | **o gate mudou** — o totem vem no MVP 3.5, não no 4 (ADR-042); a F49 já traz os tokens do totem para `packages/ui` |
| F45 | 1 | Cadastro completo de aluno — retrabalho da Slice 1.2 (a F7 entregou 4 dos 18 campos) | ✅ entregue |
| F46 | 2.5 | Design system **aplicado** ao `admin-web` — execução do que a F42 contratou | ✅ entregue |
| F47 | 1 | Importação da base legada Pacto: 1.926 alunos entram como `CANCELLED` (ADR-033) | ✅ entregue |
| F48 | 1 | Ativação da base corrente do Pacto (~340 ativos) | ✅ entregue |
| F53 | 3 | Pagamentos e cobrança no balcão (`admin-web`) | ✅ entregue |
| F54 | 3 | Painel financeiro gerencial (KPIs) | ✅ entregue |
| F55 | 3 | Adapters reais (Sicoob e Getnet) e Configuração → Pagamento | **bloqueada** — faltam `client_id`/`client_secret`/`seller_id` da Getnet e o mTLS do Sicoob; e a verificação de autenticidade do webhook segue sem resposta (ADR-044) |
| F56 | 3 | Plano com assinatura mensal como modalidade de plano (ADR-043) | ✅ entregue |

---

### MVP 3.5 — Totem · F49 a F52

**A fila mudou aqui.** O **ADR-042** criou o MVP 3.5 e o colocou **antes** do MVP 4, e atribui
explicitamente **à F49** a tarefa de reordenar esta seção. A ordem canônica passa a ser:

```
MVP 1 → MVP 2 → MVP 3 → MVP 3.5 (totem, F49–F52) → MVP 4 (app mobile, F23–F29) → MVP 5 → MVP 6
```

**Por que o totem antes do app.** O MVP 4 amarrava app mobile *e* totem no mesmo gate. O totem
não precisa do app: precisa de identidade, entitlement e PIX — que existem. Manter os dois
juntos adiava a superfície que a academia usa o dia inteiro por causa de uma que o aluno usa no
celular. Detalhe e razão completa: ADR-042, Decisão 1.

Entrada: MVP 1 estável (identidade e decisão de acesso) + MVP 2 com PIX operando (F13 ✅).

Ordem interna fixada pelo ADR-042: **F49 → F50 → F51/F52**. Quem carrega o peso da configuração
é a F49 (que **lê** `KioskConfiguration`), não a F50 (que **escreve**) — inverter deixaria a F50
sem aceite verificável.

| F | slice | núcleo |
|---|---|---|
| F49 | 3.5.1 Kiosk seguro, provisionamento e sessão efêmera | ✅ **entregue** — ver abaixo |
| F50 | 3.5.2 Contrato de configuração, painel e publicação versionada | ✅ **entregue** — ver abaixo |
| F51 | 3.5.3 Tela pública (hero): blocos, mídia e patrocínio | ✅ **entregue** — ver abaixo |
| F52 | 3.5.4 Área do aluno: identificação, pagamento e evolução | ✅ **entregue** — ver abaixo |

**A Decisão 0 do ADR-042 vale para as quatro:** nenhuma tela do `kiosk` nasce com valor fixo
naquilo que a Decisão 6 não trava — marca, accent, tempo de sessão, blocos, módulos e textos são
**lidos da configuração desde o primeiro commit**, mesmo quando o único valor existente é o
padrão do seed. Ler de um objeto de config custa quase nada enquanto a tela está sendo escrita;
custa uma fatia inteira depois que ela existe (foi o que aconteceu com o `admin-web` — F42
contratou, F46 reaplicou).

#### F49 — o que a fatia cumpriu

Slice 3.5.1 · `SPEC-049` · issue [#150](https://github.com/RodReis/arenahub/issues/150) ·
PR [#206](https://github.com/RodReis/arenahub/pull/206) (mergeado em 26/08/2026, CI verde) ·
spec de design [`2026-08-25-f49-kiosk-seguro-design.md`](superpowers/specs/2026-08-25-f49-kiosk-seguro-design.md)

| passo | entrega |
|---|---|
| 1 | Quatro modelos Prisma: `KioskDevice`, `KioskCredential`, `KioskConfiguration`, `KioskSession`. Os dois primeiros são cópia estrutural de `EdgeNode`/`EdgeCredential` — não se inventa provisionamento novo. `KioskSession` guarda **`tokenHash`, não o token**: sessão de 60 s que precisa morrer na hora não combina com JWT auto-contido |
| 2 | Contrato inteiro de `KioskConfiguration`, cobrindo o `DS-TOTEM.md` §7.2 — incluindo o que só a F50 vai escrever. Três camadas (tenant → unidade → dispositivo) resolvidas pela nulabilidade; a mais específica vence. `version` e `publishedAt` já nascem na tabela para a F50 não precisar migrar dado publicado |
| 3 | Autenticação HMAC do **dispositivo**, idêntica ao `edge-auth`: janela de relógio, credencial ativa, assinatura, nonce por último dentro de transação. `tenantId` e `gymUnitId` saem **da credencial, nunca do corpo** (Regra de arquitetura 2) |
| 4 | `POST /heartbeat` (já devolvendo `configVersion`, exigência da F50) e `GET /config` |
| 5 | Sessão efêmera do aluno: `POST /sessions` por CPF, `extend` (+30 s, teto 99 s), `DELETE` que **mata a linha no servidor**. Módulo desligado responde **404 para aquele dispositivo** — desligar é no servidor, e nesta fatia todos estão desligados |
| 6 | Tokens do totem em `packages/ui`, com o alvo de contraste **7:1** do `DS-TOTEM.md` §11.3 (o resolvedor mirava `AA_TEXT` 4.5, que serve o painel). Nenhum hex colado do `Totem.dc.html` — ADR-026 |
| 7 | Superfície `apps/kiosk` (o diretório estava vazio): atrator, CPF e "Minha área", 1080×1920 retrato |
| 8 | E2E Playwright provando o aceite: jornada completa e **asserção de limpeza** — `sessionStorage` e `localStorage` vazios e nenhum dado do aluno no DOM depois de encerrar |
| 9 | **ADR-045** — regime de identificação: CPF sozinho sem segundo fator, mensagem neutra sem limite de tentativas, facial em backlog, QR desta superfície é PIX. Emenda `M4-BR-004` |
| 10 | Esta reordenação, `STATUS.md` e a evidência da `SPEC-049` |

**O que a F49 entrega de propósito vazio.** A área interna sai com **zero dos seis módulos** do
`DS-TOTEM.md` §5.2, e isso é o desenho, não uma lacuna: o aceite da fatia é **isolamento de
tenant e limpeza de sessão**, não funcionalidade. Sem facial (ADR-045, Decisão 1) não existe
autenticação forte, então saúde e ranking ficam inalcançáveis; pagamento e histórico são a F52.

**O isolamento sai por construção, não por checagem.** O lookup é
`calcularHashDeCpf(tenantId, cpf)` com o `tenantId` vindo da credencial do dispositivo — o totem
do tenant X não consegue nem *formular a pergunta* sobre o aluno do tenant Y.

🔴 **O que a implementação descobriu.** A ponte Node que assina as chamadas (o segredo HMAC não
pode ir ao navegador) escutava em `0.0.0.0`, o padrão do Next. Com a rede da academia **não
isolada**, qualquer host da LAN enumerava a base inteira do tenant sem tocar no totem — e a
mensagem neutra não protege nada, porque o status HTTP cru distingue 404 de 201. Corrigido:
`--hostname 127.0.0.1` em `dev` e em `start`, com o motivo escrito ao lado do script. O ADR-045
registra que a Decisão 4 do PI **só se sustenta enquanto a ponte ficar em loopback**.

#### F50 — o que a fatia cumpriu

Slice 3.5.2 · `SPEC-050` · issue [#151](https://github.com/RodReis/arenahub/issues/151) ·
spec de design [`2026-08-26-f50-configuracao-do-totem-design.md`](superpowers/specs/2026-08-26-f50-configuracao-do-totem-design.md)

| passo | entrega |
|---|---|
| 1 | Índice parcial garantindo **rascunho único por camada** (tenant, unidade ou dispositivo) — não é possível existir duas linhas de `KioskConfiguration` com `publishedAt IS NULL` para a mesma chave, então "salvar rascunho" nunca duplica |
| 2 | Serviço de promoção rascunho → versão publicada **imutável**: publicar cria uma linha nova com `version` incrementada e `publishedAt` preenchido; a versão anterior nunca é reescrita |
| 3 | Cinco rotas administrativas (`GET /admin/kiosk-devices`, `GET`/`PUT /:id/config`, `POST /:id/config/publish`, `DELETE /:id/config/draft`) num módulo **`kiosk-admin` separado** do `kiosk-auth` da F49 — sessão de gerente (cookie + permissão), nunca HMAC de dispositivo |
| 4 | Totem reinicia **fora de sessão** comparando `configVersion` do heartbeat contra a versão carregada no boot — é a mecânica registrada em `DS-TOTEM.md` §7.2 |
| 5 | Painel `/operations/kiosks` no `admin-web`: lista de totens e formulário de configuração em três abas (Marca, Aparência, Sessão), com barra de estado e os três botões Salvar rascunho / Publicar / Descartar rascunho |
| 6 | E2E do aceite (`personalizacao-do-totem.e2e-spec.ts`): altera marca/cor/sessão → salva rascunho → publica → estado volta a "sem alterações"; e descartar restaura o valor publicado, não o descartado |
| 7 | Esta seção do `DEVELOPMENT.md`, a linha da F50 no `STATUS.md` e a evidência da `SPEC-050` no `TESTING.md` |

**Nenhuma migração de tabela nova.** A F49 já criou `KioskConfiguration` com `version` e
`publishedAt` justamente para a F50 não precisar migrar dado publicado — só o índice parcial do
passo 1 é schema novo.

**Discrepância registrada, não corrigida.** O `docs/DECISIONS.md` (ADR-042) referencia seções do
`DS-TOTEM.md` que o arquivo não tem (§9.1, §11.x, §12) — decisão do PI foi registrar a mecânica da
Decisão 3 em **§7.2**, a seção real de configuração, e não inventar as seções que o ADR cita. Nota
completa em `docs/STATUS.md`.


#### F51 — o que a fatia cumpriu

Slice 3.5.3 · `SPEC-051` · issue [#152](https://github.com/RodReis/arenahub/issues/152) ·
spec de design [`2026-08-26-f51-tela-publica-do-totem-design.md`](superpowers/specs/2026-08-26-f51-tela-publica-do-totem-design.md)

| passo | entrega |
|---|---|
| 1 | `KioskConfig` ganha `blocos` (cinco tipos, ordem, tempo por bloco) e `patrocinio`. **A ordem do array É a ordem do rodízio** — sem campo `ordem` separado, que permitiria dois blocos com o mesmo número e desempate pela ordem física |
| 2 | Upload de MP4 até 40 MB em `POST /admin/kiosk-devices/:id/media`, com a ordem de defesa da F19: **formato → antivírus → storage**. Chave gerada pelo servidor, escopada por tenant **e** unidade |
| 3 | A porta do antivírus saiu de `modules/health/provider/` para `common/antivirus/` como `@Global` — o totem também envia arquivo, e `kiosk-admin` importar de dentro de `health` seria módulo alcançando o interior de outro (regra de arquitetura nº 9). **Mudança de lugar, não de comportamento** |
| 4 | Indicadores da unidade (check-ins de hoje, treinando agora) no heartbeat que já existia — não em rota nova. Vêm de `AccessQueryRepository.contarEntradasDaUnidade`, **caso de uso público**, nunca leitura direta de `access_events` |
| 5 | Aba **Blocos públicos** no painel: acrescentar (um de cada tipo), ligar, reordenar, editar os cinco tipos, enviar MP4 e configurar a faixa de patrocinadores |
| 6 | Rodízio na hero do `apps/kiosk`: um bloco por vez, na ordem publicada, no tempo configurado; faixa de patrocinadores fixa no rodapé, fora do rodízio |
| 7 | E2E do aceite (`tela-publica-do-totem.e2e-spec.ts`), esta seção, a linha da F51 no `STATUS.md` e a evidência da `SPEC-051` no `TESTING.md` |

**Nenhuma tabela nova.** Blocos e patrocínio entram no `payload` de `kiosk_configurations`, que já é
`Json`. O design da F50 previu `kiosk_config_blocks`, `kiosk_sponsors` e `kiosk_media_assets` para
cá; **nenhuma das três se justifica** depois de olhar o que armazenariam — uma lista ordenada com no
máximo 5 itens e outra com no máximo 6. Bloco em tabela relacional separada tornaria "publicar a
versão 7" um problema de cópia de N linhas e "voltar para a 6" um problema de restauração; no
`payload`, ambos são a linha versionada que já existe.

**Duas decisões do PI em 26/08/2026 mudaram o escopo da issue:**

1. **O Instagram entra como porta, não como adapter.** A Decisão 7 do ADR-042 manda extrair reel com
   `yt-dlp`, binário que não existe na imagem da API nem no CI. O campo `linkExterno` existe no
   contrato **desde este commit** e o painel o mostra **desabilitado com o motivo em tela** — quando
   o adapter chegar, nenhuma tabela, nenhum contrato e nenhuma tela mudam. Vira fatia `[INFRA]`.
2. **Os indicadores ao vivo entram com número real, e isso pede leitura do `M3.5-FR-005`.** O
   requisito diz *"servir toda **mídia** do cache local, sem rede"* — e continua literal: vídeo,
   logotipo e imagem nunca são buscados em runtime. O que se acrescenta é **um número de texto**,
   que pega carona no heartbeat de 30 s e fica **em cache na memória**: sem rede, a tela mostra o
   último valor conhecido em vez de piscar para vazio. A tela pública nunca depende da rede para
   renderizar, que é a garantia que o requisito protege.

**"Treinando agora" é estimativa, e a tela diz isso.** A catraca do MVP 0/1 registra entrada e não
saída; o número é "quem entrou nas últimas 3 horas". Prometer contagem exata na recepção, ao lado de
patrocinador, seria prometer o que o dado não sustenta.

**Três defeitos que a tela real pegou e o CI não pegaria:** a faixa de patrocinadores encostava nos
botões de acrescentar bloco e parecia mais um item do rodízio (ganhou cartão próprio); o cartão do
bloco flutuava solto no meio de muito ar, porque os dois `flex` do atrator continuavam empurrando
mesmo com bloco na tela (o vão de baixo agora cede); e o cartão sem `flex: 1 1 auto` ficava pequeno
demais para o vão disponível.

**Uma correção que a revisão obrigou a descrever com honestidade.** O `try` do antivírus envolvia
também a decisão sobre o veredito, e o código foi reescrito para envolver só a chamada. **Medido por
mutação em 26/08/2026: as duas formas são observacionalmente idênticas hoje** — com o `throw` de
"infectado" dentro do `try`, ele cai no próprio `catch`, não é `ErroDoScanner`, e sai relançado
intacto; **nenhum teste da suíte distingue as duas**, e plantar a mutação deixa os 7 testes verdes.
O que a separação compra é o *próximo* `catch`: no dia em que o bloco tratar mais um tipo de erro,
"infectado" (422) passaria a responder como "scanner fora do ar" (503). É disciplina contra o
futuro, **não correção de defeito presente** — e o comentário no código foi reescrito para dizer
isso, em vez de prometer uma proteção que a suíte não sustenta.


#### F52 — o que a fatia cumpriu

Slice 3.5.4 · `SPEC-052` · issue [#153](https://github.com/RodReis/arenahub/issues/153) ·
PR [#209](https://github.com/RodReis/arenahub/pull/209) (mergeado em 26/08/2026, CI verde)

| passo | entrega |
|---|---|
| 1 | Aba **Módulos** no painel (quinta aba), com os cinco módulos de fatia entregue. `ranking` fica **fora**: a F33 (MVP 5) não entregou, e módulo sem fatia **não aparece** — nem cinza, nem desabilitado (ADR-042, Decisão 5, trava 2) |
| 2 | `KioskConfigService.exigirModulo()` — endpoint de módulo desligado responde **404** para aquele dispositivo (trava 1, `M3.5-FR-007`). Um kiosk com devtools aberto não reabilita nada |
| 3 | Grade de card-módulo na área interna (`DS-TOTEM.md` §3.10/§5.2), que a F49 entregou vazia de propósito. A ordem vive em lista própria, **não** derivada das chaves do schema Zod |
| 4 | Sete endpoints sob `/api/v1/kiosk/sessions/:id/*`, todos atrás de `KioskAreaDoAlunoService.resolver()` |
| 5 | Pagamento com **dois QRs** (ADR-043, Decisão 4): PIX e checkout hospedado de cartão, reusando `CriarCobrancaPixUseCase` e `CriarCheckoutDeCartaoUseCase` |
| 6 | Histórico de pagamentos (§5.7) e as três telas de saúde (§5.3–§5.5), reusando `BodyEvolutionService` — que foi escrito para o totem e até aqui **não tinha consumidor** |
| 7 | Sete padrões novos na allowlist da ponte, um por endpoint; esta seção, a linha da F52 no `STATUS.md` e a evidência da `SPEC-052` no `TESTING.md` |

**As três decisões de segurança que sustentam a fatia.** Elas ficam registradas porque são o
aceite: *"dado do aluno A não aparece para o aluno B"* passou a valer sobre **dado de saúde e
financeiro**, não só sobre a saudação.

1. **`resolver()` faz numa chamada o que nenhum handler pode esquecer** — módulo ligado, sessão
   viva, e o `studentId` **da sessão**. Três checagens espalhadas por sete handlers seriam sete
   chances de esquecer uma; aqui quem esquecer não tem `studentId` para prosseguir.
2. **Nenhum endpoint aceita id de aluno nem de fatura.** O aluno sai de `KioskSession`; a fatura a
   cobrar é a **mais antiga em aberto dele**. Com id na URL, uma sessão válida leria a fatura de
   qualquer aluno do tenant trocando um UUID — e o pagador seria o errado.
3. **O módulo é checado ANTES da sessão**, para que desligado e sessão inválida devolvam o **mesmo
   404**. Fosse a sessão primeiro, o par de status (401 vs 404) diria a quem sonda de fora qual dos
   dois falhou.

**Um vazamento achado ao cruzar o balcão com o totem.** `ConsultarTentativaUseCase` escopa por
tenant e **não** por aluno — correto no balcão, onde o operador é autorizado sobre qualquer aluno.
No totem seria vazamento: uma sessão válida saberia se a fatura de **qualquer** aluno foi paga, e
quando, chutando UUID. Nasceu `BillingRepository.buscarTentativaDoAluno`, e a amarra é **pela
invoice, não pelo pagamento**: `Payment` só existe depois que o webhook confirma, e amarrar nele
deixaria sem checagem justamente a janela em que o QR está aberto.

**Quatro decisões do PI em 26/08/2026:**

1. **As três telas de saúde do DS**, e não o *"resumo apenas"* que o ADR-042 e a issue pediam.
2. **O bloco de composição corporal fica como moldura e selo, sem imagem.** O asset não existe no
   repositório — nem imagem, nem gerador, nem dependência 3D — e a tela diz que virá. Desenhar um
   corpo genérico seria pior que o vazio: o aluno leria como sendo o corpo **dele**, medido.
3. **Pontuação e achado de ECG saem crus, atribuídos ao aparelho.** A RDC 657/2022 da ANVISA isenta
   software que só exibe; classificar, colorir por gravidade ou recomendar conduta enquadra como
   dispositivo médico (ADR-035). Mesmo precedente de `achado-do-ecg.tsx` no painel.
4. **Cartão entra agora, contra o `FakePaymentProvider`.** Trocar pelo adapter real da F55 é um
   `useClass` no módulo, não reescrita de tela.

**`ranking` continua no contrato, e some só da UI.** A trava 2 diz *"não existe"*; removê-lo do
schema Zod invalidaria toda configuração já publicada em `KioskConfiguration.payload`. A trava é
sobre o que o gerente **vê**, não sobre o shape persistido — e o teste que prova a ausência foi
verificado com **canário plantado**: acrescentar a linha do ranking deixa o teste vermelho.

**Navegação por estado, nunca por rota.** O totem roda em quiosque e o histórico do navegador
sobrevive ao encerramento da sessão: com rota, o botão *"voltar"* reabriria a tela do aluno
**anterior**. Mesmo motivo que a máquina de etapas de `page.tsx` já documentava.

**Dois defeitos que os testes pegaram, e o CI sozinho não pegaria:**

1. **A faixa de pendência exibia o valor da fatura** logo depois do login — `DS-TOTEM.md` §9.1 e a
   issue exigem que valor e detalhe só apareçam na etapa de pagamento, depois de ação deliberada. A
   recepção tem fila atrás, e quem está na fila lê a tela de quem está na frente.
2. **"O aluno não tem avaliação" e "a rede caiu" chegavam ambos como `null`**, e a tela dizia a
   mensagem errada num dos dois casos. Um aluno que **tem** avaliação leria *"você ainda não tem
   avaliação registrada"* toda vez que a rede da academia oscilasse. Agora são três estados.

**O wiring só apareceu na integração.** `BillingModule` e `HealthModule` não exportavam os casos de
uso que o totem consome, e **typecheck e unitários passam verdes** porque não montam o container de
DI do Nest. `ConsultarStatusDePagamentoUseCase` ficou de fora dos exports de propósito: exportá-la
convidaria alguém a usá-la no laço de polling do totem — ~20 chamadas externas por minuto de QR
aberto, por caixa —, que é o erro que o próprio arquivo dela documenta.

---

#### F44 — o que a fatia cumpriu

Slice 2.5.3 · `SPEC-044` · issue [#83](https://github.com/RodReis/arenahub/issues/83) ·
PR [#210](https://github.com/RodReis/arenahub/pull/210) (mergeado em 26/08/2026, CI verde)

**Esta fatia inverteu a própria premissa, e o registro importa.** O ADR-025 criou a F44 com um
gate — *"o PI priorizar o MVP 4"* — e um risco escrito: *"componente sem consumidor erra em
silêncio"*. O **ADR-042** antecipou o totem e as **F49–F52 construíram `apps/kiosk` inteiro**
antes desta fatia rodar. O risco **não se materializou**: veio consumidor primeiro, e o design
system nasceu destilado das telas que o usam. Sobrou para a F44 **o que ficou de fora**.

| passo | entrega |
|---|---|
| 1 | **`avisoSonoroNaRecusa` ganha consumidor.** A flag existia no contrato desde a F50 com default `true`, o painel tinha o checkbox, e **nenhuma linha do `apps/kiosk` lia o campo** |
| 2 | Moldura do totem (`DS-TOTEM.md` §3.1) — borda metálica, raios concêntricos 48/46, glow azul |
| 3 | Forma angular diagonal e ponto pulsante no hero (§3.3), os únicos elementos decorativos que o §4 permite na tela pública |
| 4 | Anel de pontuação SVG (§3.12), com degradação para texto |
| 5 | `@keyframes ah-pulse` e `ah-spin` (§2.6) — as duas animações que o DS define e que **não existiam** |
| 6 | `SPEC-044` reescrita contra o `DS-TOTEM.md` **v2.0**; esta seção, a linha da F44 no `STATUS.md` e a evidência da `SPEC-044` no `TESTING.md` |

🔴 **O defeito que motiva a fatia: uma flag que não fazia nada.** `sessao.avisoSonoroNaRecusa`
nasceu na F50 **ligada por padrão**, com checkbox no painel — e o totem seguia mudo. A academia
marcava a caixa e acreditava que o equipamento avisava. É o **mesmo padrão** que a F51 encontrou
na análise de IA e no OCR de ECG: contrato e tela existem, e o recurso nunca executou. Aqui o
custo era menor, mas a forma é idêntica — e é por isso que fica registrado.

**Som sintetizado, sem asset.** `AudioContext` com dois tons descendentes (440 → 330 Hz) a volume
0.08. Um `<audio src>` exigiria arquivo (mais um 404 possível no modo quiosque) e esbarraria na
política de autoplay — a recusa nasce de uma **resposta de rede**, não de um gesto. O volume e a
queda grave são operação, não estética: o totem fica na recepção **com fila atrás**, e um bipe
agudo anunciaria a recusa para a fila. **Nunca lança** — aparelho sem saída de áudio degrada para
recusa muda, e o Toast continua sendo o canal de verdade (o §3.4 já fixa que esta superfície nunca
*depende* de áudio).

🔴 **O defeito que a sondagem pegou antes do commit, e que a revisão considerou aceitável.**
`fracaoDaPontuacao` usava `Number()`, que entende **notação de literal de JavaScript**: `"0x10"`
virava 16 e desenhava um anel de 16% **sobre dado de saúde**; `"0b11"` virava 3; `"1e3"` saturava
o anel no cheio. O campo é **texto livre reportado pelo aparelho**, não código. A revisão
adversarial julgou improvável no formato real do equipamento e não bloqueou; a guarda entrou assim
mesmo — custou uma regex, e a regra de arquitetura 8 existe justamente para o caso em que o
aparelho manda o que não esperávamos. **Provado por canário:** removida a guarda, 6 testes caem.

**O anel recusa desenhar o que não sabe ler.** O §3.12 pede arco *"proporcional"* e o DS desenha
`80 PONTOS` **sem nunca dizer 80 de quanto**. Escala assumida: **100**, isolada em
`ESCALA_DA_PONTUACAO` para que trocar seja uma linha. Quando o texto não for número dentro dela,
**não há anel** — a tela cai no número em texto, que já funcionava. ⚠️ **Pergunta 5 da spec: a
escala real é decisão do PI.**

**A moldura só existe onde o equipamento não está.** Acima de 1080 px de viewport ela aparece;
na tela real do totem (1080 × 1920) vira `display: contents` e some do layout. No equipamento a
moldura roubaria 2 px úteis e arredondaria o canto do conteúdo contra a moldura **física** do
gabinete, que já existe em metal. Verificado no navegador: a 1080 px a `.tela` mede **1080 px
inteiros**.

⚠️ **Dois defeitos que só a tela revelou — suíte verde não os pegaria.** A forma angular saiu
errada **duas vezes**, e as duas versões passavam em 155 testes:

1. Com `inset: 0`, a caixa do hero é **baixa e larga**, e a diagonal virou uma **tarja horizontal
   cortando a headline** — parecia corrupção de render.
2. Alargada, virou um **bloco retangular** flutuando ao lado do texto e **invadindo o card** de
   baixo.

Só na terceira, alta e estreita, a diagonal se lê como diagonal. O registro é a lição: **defeito
visual é invisível para teste de comportamento**, e o jeito de pegá-lo é abrir a tela.

**`data-decorativo` já esperava por esta fatia.** A regra
`[data-contraste='alto'] [data-decorativo] { display: none }` foi escrita na F51 e **nenhum
elemento a acionava** — hook pronto, implementação ausente. Verificado no navegador com o alto
contraste ligado: forma, ponto, animação, glow e gradiente metálico todos em `none`, cumprindo o
§2.6.

**Duas correções de vocabulário na spec.** O mínimo tipográfico é **19 px** (DS §2.2 e checklist
§8, e é o que `--tt-minimo` implementa) — a spec dizia 20. E **`carbon-950` não existe**: o token
é `totem.bg.base` (`#0A0B0D`). A spec anterior descrevia um vocabulário que o repositório não usa.

**O que ficou fora, e por quê.** A **tela pública da catraca** era `DS-TOTEM.md §8` na spec
original; a **v2.0 apagou essa seção** (o §8 atual é o *Checklist de revisão*). Sem contrato de
design vigente, escrevê-la é decisão de produto — pergunta 1 da spec. Também ficaram fora o
**render 3D** (§5.3/§5.4) e os **assets** do §7.3, que não existem no repositório, e o **ranking**
(§5.8), que depende da F33.

---

### MVP 4 a 6 · F23 a F41

Vem **depois** do MVP 3.5 (ADR-042). Detalhamento quando o MVP anterior fechar. Pontos que já se
sabe que vão doer:

- **F27 e F28** são as Slices 4.5 e 4.6 do `MVP-04`, cuja **execução o MVP 3.5 antecipou** nas
  F49–F52. Quando o MVP 4 for detalhado, verificar o que sobrou delas em vez de reimplementar.
- **F28** (pagamento no totem) é o app do aluno inteiro, com dinheiro, numa tela pública — e
  depende de regra de proração que **não existe** para upgrade/downgrade.
- **F29** depende de `M4-DIST-01` (política de publicação em lojas), indefinida.
- **F33** carrega a contradição interna da Especificação sobre ranking de perda de peso
  (INV-121). É ela que destrava o módulo *Ranking* do totem — pela trava 2 da Decisão 5 do
  ADR-042, módulo sem fatia entregue **não aparece**.
- **F40** provavelmente **não acontece**: exige ≥ 200 churns positivos e ≥ 1.000 snapshots por
  tenant. Sem isso, o produto fica na baseline de regras — e tudo bem.

### MVP 5 — Engajamento opt-out · F30 a F35

**O gate mudou para a F30, e de novo para a F32.** O `docs/STATUS.md` §4 lista *"eventos confiáveis + app do MVP 4"*
como gate de entrada do MVP 5 inteiro — mas o **ADR-046** (26/08/2026) emenda o `MVP-05` §1 para
que esse gate **não alcance a F30**: ela não lê evento de domínio nem depende do app, que segue
com `apps/mobile/.gitkeep`. A **F32** foi destravada em 28/08 pela mesma razão, em decisão direta
do PI (sem ADR: repete a exceção já registrada em ADR-046 e ADR-047, não cria regime novo).
A **F34** foi destravada em 28/08 pelo **ADR-048**, com o mesmo argumento. **Só a F35 continua
atrás do gate original.**

**A superfície também mudou.** A Slice 5.1 previa "app"; o canal que existe é o `apps/kiosk`
(ADR-046, Decisão 1) — o mesmo totem que a F49/F50 (ADR-042, ADR-045) já identifica por CPF e já
reservava `modulos.ranking` no contrato de `KioskConfiguration`, desligado por padrão desde a F50.

| F | slice | núcleo |
|---|---|---|
| F30 | 5.1 Preferências e identidade pública | ✅ **entregue** — ver abaixo |
| F31 | 5.2 XP e conquistas + 5.4 ranking | ✅ **entregue** em 27/08/2026 ([#213](https://github.com/RodReis/arenahub/pull/213)) — ADR-047 destravou a fatia (totem como superfície) e absorveu a F33 |
| F32 | 5.3 Consistência e streak | ✅ **entregue** em 28/08/2026 — destravada por decisão do PI, superfície no totem |
| ~~F33~~ | 5.4 Rankings privados por padrão | **absorvida pela F31** (ADR-047, Decisão 2) — número queimado. INV-121 passou para a F31. Card fechado em 28/08/2026 — ver a ponta solta abaixo |
| F34 | 5.5 Desafios e notificações | ✅ **entregue** em 28/08/2026 (ADR-048) — inscrição automática, não opt-in |
| F35 | 5.6 Operação, moderação e experimento | bloqueada — gate do MVP 5 original; traz o canal de denúncia que grava `PublicProfileStatus.HIDDEN` |

#### A ponta solta da Slice 5.4 — rankings por categoria

Ao fechar a issue [#33](https://github.com/RodReis/arenahub/issues/33) em 28/08/2026, a conferência
item a item da Slice 5.4 contra o que a F31 entregou mostrou **cinco dos seis itens cumpridos**:

| item da Slice 5.4 | onde ficou |
|---|---|
| snapshots por **período** | `RankingSnapshot.localMonth`, `@@unique([tenantId, gymUnitId, localMonth])` |
| snapshots por **categoria** | ❌ **não entregue** — ver abaixo |
| métricas relativas e critérios de elegibilidade | coorte mínima 5 → `WITHHELD` (`M5-BR-007`) |
| desempate determinístico | `classificacao.ts`: pontos → `lastEntryAt` → `studentId` |
| identidade pública conforme preferência | `resolverExposicao()` da F30 |
| publicação e retirada | `DRAFT`/`PUBLISHED`/`WITHHELD`, imutável após publicar (`M5-AC-007`) |

**O que falta:** o PRD §7 pede *"rankings por frequência, consistência e evolução relativa"*. A F31
entregou **um** placar — XP por mês —, e o ADR-047 **não declarou as demais categorias como escopo
negativo**. A lacuna não estava registrada em documento nenhum até esta data.

**Decisão do PI em 28/08/2026:** as categorias ficam para **F34/F35**, dentro do MVP 5. A #33 é
fechada (o número segue queimado, não se reaproveita) e a ponta passa a viver aqui e no
`STATUS.md`, em vez de sumir junto com o card.

Vale notar que a **F32 tornou uma das três viável**: `avaliarSemanas`/`resumirStreak` já produzem a
métrica de consistência por aluno. Um ranking de consistência precisaria só de snapshot e ordenação
sobre o que já existe — não de cálculo novo.

#### `[INFRA]` — ingestão de reel do Instagram (28/08/2026)

Issue [#215](https://github.com/RodReis/arenahub/issues/215) · fecha a ponta aberta pelo
**ADR-042, Decisão 7** · PR [#216](https://github.com/RodReis/arenahub/pull/216) (mergeado em 28/08/2026, CI verde)

O painel já gravava `linkExterno` desde a F51, mas nada trazia a mídia para o object storage — e o
totem só sabe servir `midiaKey`. O gerente colava o link, salvava, e a tela pública mostrava um
`<video>` vazio. Pedido do PI: *"cadastrar vários vídeos que já estão no Insta e tocar no totem
automático"*.

**Viabilidade testada ANTES de abrir o card**, não depois: `yt-dlp` extraiu o reel real de
`@clinicadamusculacao` (`DbtoWkFR6l6`) sem autenticação — MP4 de 24,6 MB, dentro do teto de 40 MB
que `TAMANHO_MAXIMO_DE_MIDIA_BYTES` já impunha.

| peça | onde |
|---|---|
| `MediaFetcher` (porta) + `ErroDoExtrator` | `common/media-fetcher/media-fetcher.port.ts` |
| `YtDlpMediaFetcherAdapter` (real) e `FakeMediaFetcherAdapter` (dublê) | mesmo diretório |
| `aceitarLinkDeReel` — fronteira de segurança, pura | `kiosk-admin/domain/link-de-reel.ts` |
| `ingerirDeLink`, desaguando em `enviar` | `kiosk-admin/kiosk-media.service.ts` |
| `POST :id/media/from-link` | `kiosk-admin/kiosk-admin.controller.ts` |
| Campo habilitado + botão *Copiar/Atualizar vídeo* | `operations/kiosks/[id]/aba-de-blocos.tsx` |

**A ingestão desagua no `KioskMediaService`, e essa é a decisão inteira.** Formato, antivírus e
storage acontecem uma vez, no mesmo lugar do upload de MP4. Um caminho paralelo teria de repetir as
três travas, e a primeira esquecida viraria o buraco — mídia de **terceiro** entrando no bucket sem
escaneamento é pior que arquivo que o gerente escolheu.

**`aceitarLinkDeReel` é fronteira de segurança, não validação de formulário.** O que ela aprova
vira argumento de um processo que baixa o que a URL apontar: host livre é **SSRF** (rede interna,
metadados de nuvem, `file://`). Por isso o host é comparado **inteiro** contra lista fechada —
`includes`/`endsWith` aceitariam `evil-instagram.com` — e o shortcode é restrito a
`[A-Za-z0-9_-]`. `execFile` (nunca `exec`) é a segunda camada, independente da primeira.

**Vários reels sem contrato novo:** decisão do PI — N blocos `VIDEO` no rodízio que já existe
(`kiosk/lib/rodizio.ts`), em vez de lista dentro de um bloco. Zero mudança de schema, de tabela e
de tela.

🔧 **Três defeitos, e nenhum apareceu em teste de unidade.**

1. **`Nest can't resolve dependencies (String at index [0])`** — o construtor de
   `YtDlpMediaFetcherAdapter` recebe o nome do binário com valor padrão, e registrar a **classe**
   como provider fez o Nest tentar injetar esse primitivo. Derrubou a suíte **inteira** de
   integração. `useFactory` resolveu.
2. **`variant="secondary"` não existe** no design system (`solid | outline | ghost | destructive`),
   e antes disso o botão apontava para classes CSS inexistentes. Typecheck passava nos dois casos.
3. ⚠️ **A tradução de erro estava errada, com os testes verdes.** Um reel inexistente respondia
   **503 "a ferramenta falhou"** em vez de **422 "confira se o post é público"** — a lista tinha
   oito frases plausíveis do `yt-dlp` e **nenhuma era a real** (`empty media response`). O dublê
   escolhia a mensagem, então o teste concordava consigo mesmo. Só a chamada contra o Instagram de
   verdade mostrou. Isso importa porque o ADR exige a distinção por escrito: *"a ferramenta
   quebrou"* o gerente não resolve pela tela; *"troque o link"*, sim.

**O CI usa o dublê (`MEDIA_FETCHER_FAKE=1`), deliberadamente.** Instalar `yt-dlp` traria de volta o
`apt-get` que a #105 tirou do caminho crítico e faria uma mudança da Meta pintar o CI de vermelho
sem defeito nosso. O CI prova a **fiação**; a extração é verificada à mão.

**Percurso real, 28/08/2026.** Pela API, com o extrator de verdade: o reel baixou em **4,2s**,
passou pelo antivírus, foi para o MinIO, e a resposta trouxe a URL canônica (query de rastreamento
removida). Publicada a configuração, o totem tocou o vídeo — `paused: false`, 112,1s, 720×1280, com
`src` apontando para o **object storage**, nunca para o Instagram (trava 2 do ADR). Os dois
caminhos de erro conferidos ao vivo: host falso → 400, reel inexistente → 422.

#### F32 — o que a fatia cumpriu

Slice 5.3 · `SPEC-032` · issue [#32](https://github.com/RodReis/arenahub/issues/32) · PR [#214](https://github.com/RodReis/arenahub/pull/214) (mergeado em 28/08/2026, CI verde)

**A fatia inteira cabe em uma função pura e dois métodos de repositório.** Não há tabela nova,
migration nem módulo Nest — o plano de apoio previa cinco tabelas (`StreakPolicy`,
`StreakPolicyVersion`, `StudentStreak`, `StudentStreakWeek`, `StreakProjectionVersion`) e nenhuma
foi criada.

| passo | o que entrou |
|---|---|
| 1 | `domain/semana-de-consistencia.ts` — puro: `inicioDaSemanaLocal`, `avaliarSemanas`, `resumirStreak`, `POLITICA_DE_STREAK` |
| 2 | `PortaDeXp.diasTreinados` e `PortaDeXp.pausasAprovadas` — Prisma + dublê |
| 3 | `EngagementXpService.obterConsistencia` — leitura pura, derivada |
| 4 | `KioskXpService` devolve `consistencia` no extrato que a tela já buscava |
| 5 | Bloco de consistência em `apps/kiosk/components/xp.tsx` + CSS |
| 6 | Snapshot OpenAPI regenerado — a guarda de contrato pegou a mudança |

**Por que derivar em vez de materializar.** `StudentAttendanceSession` (F24) já é a projeção de
dias treinados, deduplicada por `(tenant, aluno, dia local, unidade, política)` num índice único.
Uma segunda tabela seria fonte de verdade paralela com rebuild próprio, capaz de divergir da
primeira — e a F31 já resolvera o mesmo problema derivando (`posicaoAoVivoDoAluno`). Consequência
que vale registrar: a *"prevenção de múltipla pontuação diária"* da Slice 5.3 **não virou código
nesta fatia**; ela é o índice único da F24, no banco, onde guarda que lê antes de escrever não
perde corrida.

**As três decisões de regra, e por que a ordem importa.**

1. **A meta vence a pausa.** Quem bateu os 3 dias durante a pausa ganha a semana — pausar não
   proíbe treinar. Invertida, a cadeia esconderia a semana qualificada de quem treinou pausado,
   punindo o comportamento que a fatia quer premiar.
2. **A pausa isenta a semana inteira ou nada.** Pausa parcial deixa dias treináveis de fora;
   isentar a semana toda daria isenção de graça a quem pausou um dia.
3. **A semana corrente nunca é "perdida".** Ela é `EM_ANDAMENTO` e o resumo a pula: sem isso, toda
   segunda-feira de manhã zeraria o streak de todo mundo por algumas horas.

**A pausa vem da timeline, não de `Subscription.status`.** O status guarda o estado de hoje;
`M5-FR-009` precisa saber que houve pausa em agosto mesmo com a assinatura ativa agora. O
repositório reconstrói os intervalos de `StudentTimelineEvent`
(`SUBSCRIPTION_PAUSED` / `SUBSCRIPTION_RESUMED`), que `membership.repository.ts` já grava, e ignora
um segundo `PAUSED` enquanto há intervalo aberto — retry de rede não fabrica isenção extra.

🔧 **Duas armadilhas do ambiente, ambas já registradas e ambas repetidas.**

A primeira: o **servidor da API servia build de 25/08**, três dias defasado, sem a F31 nem a F32.
`/health` respondia 404 e a tela teria mentido sobre a fatia. Conferir a data do `dist/`, não a do
processo.

A segunda: **a guarda de evidência herdou o número da execução anterior.** `pnpm test:report`
avisa e mantém o último valor bom quando `apps/api#test:integration` morre com o crash conhecido do
Jest no Windows (`3221226505`). A integração foi então medida **suíte a suíte** — 698/698 em
`apps/api`, 60/60 em `packages/database`, zero falhas. Sem essa medição manual, a linha do relatório
seria prova que ninguém produziu.

⚠️ **A única falha real da entrega só apareceu na suíte completa.** Rodando `xp-e-ranking`
isolada, 25/25 passavam; a suíte inteira acusou o snapshot OpenAPI desatualizado — mudança
legítima, regenerada com `ATUALIZAR_OPENAPI=1` (a variável **não** está no `globalEnv` do Turbo,
então precisa ir direto ao Jest, senão some calada).

**Percurso na tela, 28/08/2026, ambiente local completo.** Aluno real do seed, com 3 sessões em 3
semanas distintas: a tela mostrou streak **0** — nenhuma semana bate a meta de 3 —, a semana
corrente como *"Semana em andamento"* e as fechadas como *"Abaixo da meta"*, sem palavra de culpa.
Injetando `SUBSCRIPTION_PAUSED`/`RESUMED` reais na timeline, a semana de 17–23/08 virou
*"Assinatura pausada · não conta contra você"*. Dado de teste removido do banco depois.

#### F30 — o que a fatia cumpriu

Slice 5.1 · `SPEC-030` · issue [#30](https://github.com/RodReis/arenahub/issues/30) ·
PR [#211](https://github.com/RodReis/arenahub/pull/211) (mergeado em 27/08/2026, CI verde) ·
spec de design [`2026-08-26-f30-preferencias-e-identidade-publica-design.md`](superpowers/specs/2026-08-26-f30-preferencias-e-identidade-publica-design.md)

| passo | entrega |
|---|---|
| 1 | `ConsentDocumentType` ganha `RANKING`, `CHALLENGE`, `ENGAGEMENT_PUSH` e `PHYSICAL_EVOLUTION_RANKING` — as três últimas dormentes, sem documento publicado e sem consumidor. Sem tabela paralela: a preferência do aluno **é** um `ConsentRecord`, reusando o append-only que já existe em `modules/privacy` |
| 2 | `participaDoRanking()` (`modules/engagement/domain/participacao.ts`) — o predicado do regime opt-out, deliberadamente **separado** de `avaliarConsentimento()` (biometria), com o aviso do ADR-046 escrito no próprio código |
| 3 | `resolverExposicao()` (`modules/engagement/domain/exposicao.ts`) — o **ponto único** que decide se um aluno aparece publicamente e com que nome: `ALUNO_INATIVO` vence `OPT_OUT`, que vence a escolha de identidade |
| 4 | `triarAlias()` (`modules/engagement/domain/triagem-de-alias.ts`) — normalização NFKC, corte de invisível/controle, sinalização de PII; classifica, não pune — tudo vira `PENDING` |
| 5 | Tabela `PublicProfile` (uma linha por `(tenantId, studentId)`), com unicidade de `aliasNormalized` em **índice parcial sobre `status = APPROVED`** — dois `PENDING` com o mesmo alias coexistem |
| 6 | Casos de uso (`ObterPreferencias`, `AtualizarPreferencia`, `DefinirAliasPublico`, `ModerarAlias`) com idempotência por `Idempotency-Key` em `AtualizarPreferencia` |
| 7 | Três rotas no totem (`apps/kiosk`, sob `KioskAreaDoAlunoService.resolver()`) e duas no painel (`apps/admin-web`, `engagement.read`/`engagement.moderate`) — fila de moderação de alias |
| 8 | Duas telas no totem — *Minhas preferências* (interruptor ligado por padrão, a inversão visível ao aluno) e *Meu nome no ranking* — e a fila de moderação no painel |
| 9 | ADR-046, esta seção, a linha da F30 no `STATUS.md`, a evidência da `SPEC-030` no `TESTING.md` e os §2–§5 da própria `SPEC-030` |

**O documento de engajamento vem do seed, com `tenantId` real e hash calculado** — sem ele a API
responde `DOCUMENTO_DE_ENGAJAMENTO_AUSENTE`; nenhum dado inventado no caminho de produção.

**Dois cortes deliberados, registrados no design (`SPEC-030` §3):** `HIDDEN` nasce **sem caminho
de escrita** — o estado existe no enum e no filtro de listagem, mas nenhuma rota grava; ele é
para denúncia, que só chega na F35. E **sem outbox nem cache de exposição**: nenhum consumidor
existe hoje — a F33 é quem vai pedir os dois, quando existir.

🔴 **O defeito que a geração de evidência pegou, e que seis revisões de código não pegaram.**
`EngagementModule` não declarava `TenantContextService` nos próprios `providers`, embora o
`EngagementController` o injete. O Nest não resolvia o controller e **derrubava o boot da
aplicação inteira**: 46 suítes de integração, 671 de 673 testes, incluindo suítes sem relação
nenhuma com engajamento — `listar-invoices` entre elas.

**Corrigido em `dd43ce0`** (uma linha e o import, no padrão de `PrivacyModule` e
`KioskAdminModule`). Verificado depois: `listar-invoices` 8/8, `engagement` 5/5, unitário 943/943
no pacote, lint verde.

**Por que escapou.** O teste unitário do controller declara `TenantContextService` na mão dentro
do `Test.createTestingModule` — verde no teste, quebrado no `AppModule` real. É a **segunda** vez
nesta fatia que fiação ausente atravessa a revisão: a primeira foi o próprio `EngagementModule`
esquecido no `AppModule`, achado quando a F30 escreveu o teste de integração. As duas têm a mesma
forma — **revisão de diff não enxerga o que não está lá.** Quem criar módulo Nest novo daqui em
diante: a fiação só se prova subindo o `AppModule` de verdade.

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
| 21/08/2026 | **#129** *(FIX)* | — | [#140](https://github.com/RodReis/arenahub/pull/140) | **O eixo de `dayOfWeek` passou a ser um só: `0 = domingo ... 6 = sábado`, o do motor de decisão.** Quem gravava (`plan.ts`, o Zod do `membership.controller`, o Zod da action do painel, o comentário do `schema.prisma`, o `<select>` do formulário de plano) usava **ISO-8601 `1..7`**; quem **decide se a porta abre** (`packages/access-policy`, via `Date.getDay()` em `resolverHoraLocal`) lê **`0..6`**. De segunda a sábado os dois eixos coincidem — `1..6` existe nos dois — então a semana inteira funcionava **por coincidência**, e a suíte inteira passava. No **domingo** o motor calcula `0`, a linha gravada dizia `7`, nenhuma janela casava e **todo aluno cadastrado pelo caminho normal da API era negado**, com `OUTSIDE_SCHEDULE` — razão que agrava o diagnóstico, porque sugere "fora do horário" quando o horário está certo e o problema é o dia. **`0..6` ganhou, e não por estética:** o eixo do motor não é escolha nossa, vem de `Date.getDay()` e do `Intl`; mudar o motor para ISO significaria converter **em toda decisão de catraca**, no caminho mais quente e menos perdoável do produto. 🔴 **Uma segunda fonte do mesmo defeito, que a issue não mencionava:** `momentoLocal`, em `plan.ts`, é um **terceiro** conversor de fuso — duplica `resolverHoraLocal` — e mapeava `Sun: 7`. Pior que o eixo: o `?? 0` do retorno fazia **fuso sem tzdata virar "domingo" em silêncio**, e a janela de domingo abriria a catraca em qualquer dia da semana. Agora lança `RangeError`, como o `resolverHoraLocal` já fazia. **Nenhuma migração de dado foi necessária, e isso foi MEDIDO antes de escrever a migration, não deduzido:** a issue supunha "os dois eixos convivendo", mas o banco diz o contrário — `plan_access_windows` está **vazia** (nenhum plano cadastrado pela API ainda) e as **2.219** linhas de `entitlement_unit_windows` já estavam em `0..6`, todas vindas da F48, que seguiu o motor de propósito. O defeito era **latente, não materializado**. Por isso **não houve ADR**: sem dado histórico a converter, nada aqui é caro de desfazer. A própria aplicação da migration virou a segunda prova — ela rodou sobre as linhas existentes (e sobre as 1.782 do banco de integração) **sem violar o `CHECK`**; se houvesse uma única linha em `7`, teria falhado ali em vez de negar alguém num domingo. **A trava é o ponto principal da entrega, e ela está no banco:** `CHECK (day_of_week BETWEEN 0 AND 6)` nas duas tabelas. Comentário de schema não impede ninguém de gravar `7` — o comentário, aliás, **apontava para o eixo errado, e foi assim que o defeito nasceu**. Prisma não modela `CHECK`, então ele vive na migration e está documentado no schema com o aviso de que não sobrevive a um `db push` que recrie a tabela. **Provado por canário nos dois sentidos:** `INSERT` de `7` recusado pela constraint, `INSERT` de `0` aceito. **O teste que faltava é o que a issue apontou como causa raiz — "o teste que só cobre dias úteis é exatamente o que deixou isso passar":** os sete dias, ponta a ponta, rodando `resolverHoraLocal` **de verdade** em vez de fixar `localDayOfWeek` na mão — fixar o número testaria o motor contra a suposição do autor do teste, que é precisamente onde o eixo errado se esconde. Mais a **regressão exata**, escrita como o defeito acontecia: janela de domingo gravada em ISO (`7`), avaliada num domingo real, exigindo `DENY`. **Verificado por mutação, e o resultado é o argumento da fatia inteira:** replantado `Sun: 7` no motor, **só os testes novos falham** — os 70 anteriores passam com o bug de pé, que é exatamente por que ele sobreviveu até aqui; replantada a faixa `1..7` na validação, caem os dois testes novos do `plan.spec`. **Um bloco de comentário virou mentira e foi atualizado:** o aviso em `montarSnapshot` (F48) descrevia a divergência como viva e mandava *"não unifique por conta própria"* — ele agora registra que a #129 unificou, e permanece como aviso porque ISO `1..7` é a convenção mais comum em outros sistemas e "consertar" para ela reintroduz o defeito. **Achado colateral, não regressão:** o `build` já estava quebrado na `main` — cliente Prisma não regenerado após a F18 (`HealthGoal` ausente em `generated/client.js`); `prisma generate` resolveu. Evidência: lint 9/9, typecheck 13/13, build 7/7, 11/11 tasks, **1129 unitários** (9 novos: 7 dos dias da semana, 1 da regressão do domingo, 1 do eixo aceito na validação) e **472 de integração** — 27 suítes/412 testes na API (incluindo `students-membership`, que **grava** pela API, e `online-decision`, onde o motor **decide**: os dois lados do bug) mais 60 no `@arenahub/database` |
| 21/08/2026 | **F20** | SPEC-020 | [#141](https://github.com/RodReis/arenahub/pull/141) | **Metas e frequência, Slice 3.4.** A fatia entrega o que a F18 deixou explicitamente para trás: **progresso calculado** e **frequência**. **A decisão de produto foi do PI: a janela de agrupamento é o DIA CIVIL local.** O `M3-BR-008` manda agrupar "múltiplas entradas na janela configurada" mas não fixa o tamanho, e escolher era decisão de escopo. O PI decidiu dia civil por duas razões: sem saída confiável qualquer janela por horas seria arbitrária — ela existiria para separar treinos cuja duração ninguém mede —, e frequência semanal conta **dias treinados**, que é como a recepção e o aluno já pensam. A política vai gravada em cada linha (`dia-civil-local@1`) e entra na **chave única**, então trocar de política é **reprojetar numa versão nova** (as duas coexistem enquanto se comparam), nunca migrar número já calculado. **O QUE ESTA FATIA DELIBERADAMENTE NÃO CALCULA É DURAÇÃO DE TREINO, e a ausência é o ponto:** a Slice 3.4 proíbe inferir duração "quando não houver saída confiável", e hoje não há — a catraca opera liberada nos dois sentidos (ADR-029) e ninguém registra saída. Subtrair a primeira passagem da última produziria um número com cara de medida ("treinou 2h14") que na verdade é a distância entre duas **entradas**. `first_passage_at`/`last_passage_at` existem para AUDITAR o agrupamento; não há campo onde guardar um total, e há teste que exige a ausência de `duration`/`durationMinutes`/`averageDuration` na resposta. Número inventado com aparência de dado é pior que campo vazio, porque o vazio se pergunta e o inventado se acredita — é o INV-104 da F18 aplicado a tempo em vez de medida. 🔴 **A garantia central é a idempotência da reprojeção, e ela mora no BANCO:** consultar a frequência **projeta**, e consultar duas vezes não pode dobrar o número do aluno. Chave única `(tenant, aluno, dia, unidade, política)` — a quarta vez que este projeto usa índice para fechar uma corrida que um `if` não fecha (F14 cobrança em dobro, F17 dois fatores ativos, F18 duas metas ativas). **Provado por mutação no banco:** `DROP INDEX` derruba **8 dos 20** testes de integração de uma vez; sem ele o `upsert` não encontra a linha e cria outra. Três `CHECK` acompanham: contagem ≥ 1 (linha com zero passagem seria um dia treinado que ninguém treinou), contagem **igual** a `cardinality(passage_ids)` (sem isso um bug gravaria "3 passagens" com um id só, e o número deixaria de ser auditável justamente pela lista que existe para auditá-lo) e extremos coerentes. Os três provados por canário antes de existir código que dependesse deles. **A elegibilidade é um `WHERE`, e cada cláusula fecha uma porta:** `passage.state = CONFIRMED` (`M3-BR-007` — quem recebeu ALLOW e desistiu na porta não esteve na academia), `outcome = ALLOW`, e `studentId` não nulo (evento de identidade desconhecida não pertence a ninguém, e atribuí-lo seria inventar presença). **Verificado por mutação:** remover o filtro de `CONFIRMED` derruba exatamente o teste do `M3-BR-007`. O filtro de **correção** ficou deliberadamente de fora e está registrado no código: `access_event_corrections` marca evento errado, mas um evento corrigido continua sendo um fato físico ocorrido — tratar correção como exclusão apagaria a passagem real. **O dia é o LOCAL da unidade (ADR-019, sem fallback):** 02:00Z ainda é 23:00 do dia anterior em São Paulo, e agrupar por dia UTC quebraria a sessão em duas — inflando a frequência de quem treina à noite, que é a maioria. **Mutação confirma:** projetar em UTC derruba só o teste do fuso. **Determinismo com desempate por id:** dois leitores podem gravar o mesmo milissegundo, e sem desempate a ordem viria do banco (que não promete nenhuma), fazendo `passageIds` mudar entre execuções e quebrando a reprojeção idempotente. **Semana ISO-8601** e não "domingo a sábado" porque só o ISO tem regra fechada para a virada de ano — 01/01/2027 pertence à W53 de 2026, e conta caseira produziria `W00` ou `W53` conforme o mês. **Consistência é contagem, não julgamento:** semanas com sessão sobre semanas elegíveis, e o denominador vem de FORA do domínio — contar as semanas em que houve sessão e dividir por si mesmo devolveria 100% para quem treinou uma vez. Sem semana elegível devolve `null`, não `0`: período vazio não é "consistência zero", e dividir por zero daria `NaN` na tela. O nome do campo é a única defesa contra alguém ler o número como aderência ou disciplina do aluno. **`dataQuality` existe porque frequência zero tem DUAS causas que pedem ações opostas:** o aluno não veio, ou o sistema não viu. Sem o campo a recepção cobraria presença de quem esteve lá. Hoje ele responde `SEM_FONTE_CONFIRMADA` para todo mundo, e isso é verdade: **o banco tem zero passagem confirmada** enquanto a catraca estiver destravada. **O progresso da meta acrescenta o que o `ateAMeta` da F18 não consegue dizer:** aquele responde "quanto falta" (`alvo - atual`), e faltar 3 kg é ótimo para quem partiu de 10 e péssimo para quem partiu de 3,5. A fração do caminho só existe com a **baseline congelada** que a F18 gravou. **Ela NUNCA é recalculada:** se o progresso relesse a medição original, uma correção (INV-102) de três meses atrás mudaria o percentual de hoje e a meta passaria a significar outra coisa retroativamente — há teste de integração que corrige a avaliação de partida e exige a baseline intacta. A fração **passa de 1** quando o aluno supera o alvo e fica **negativa** quando ele se afasta: truncar em [0,1] esconderia os dois casos que o avaliador precisa ver, e "não saiu do lugar" é mais confortável que o fato. **Não há campo de direção** — o plano de apoio de 14/08 previa um, mas `alvo < baseline` já diz que a meta é reduzir, e um campo separado poderia **contradizer** os números, criando duas verdades sobre a mesma linha. Alvo igual à baseline devolve `null`, não 100%: dividir por zero daria `Infinity`, e chamar de "atingida" afirmaria um esforço que ninguém fez. **O plano de apoio `2026-08-14-mvp-03-04` está obsoleto e não foi seguido** — ele nomeia `packages/health-domain`, que não existe, e manda criar metas que a F18 já entregou de outra forma. O PRD vence (`CLAUDE.md`: plano é material de apoio, não contrato). ⚠️ **A limitação honesta desta entrega, e ela é grande:** o banco tem **zero evento de acesso e zero passagem confirmada**. A frequência é um motor sem combustível até a academia travar a catraca — o `M3-AC-006` está provado com dado de teste contra Postgres real, mas o **número real só existirá após o cutover**. Registrado aqui e no PR para não virar surpresa. **Fora de escopo, registrado:** a timeline combinando avaliação e frequência é da Slice 3.2/3.4 e depende de desenho de tela; não há UI nesta fatia — o painel entra quando houver dado real a desenhar. Evidência: lint 9/9, typecheck 13/13, build 7/7, 11/11 tasks, **1170 unitários** (41 novos: 25 de frequência e 16 de progresso) e **492 de integração** — 20 novos contra Postgres real, com as três mutações acima e o snapshot do contrato OpenAPI regenerado (a guarda pegou as duas rotas novas antes de mim) |
| 21/08/2026 | **F21** | SPEC-021 | [#142](https://github.com/RodReis/arenahub/pull/142) | **Analise assistiva por IA, Slice 3.5 — a fatia onde a LGPD deixa de ser declaracao e vira teste.** **A decisao de produto foi do PI em 21/08: o aceite e DUPLO — aluno e professor.** Sao atos diferentes e o modelo os separa: o **aluno** e o titular, e consentimento de dado sensivel e dele por forca do art. 11 (lista fechada; a academia nao pode consentir por ele); o **professor** da endosso profissional, que e o *humano no circuito* que a regra de arquitetura no 8 exige. Tratar os dois como um registro so apagaria a distincao no exato lugar onde ela e cobrada — numa fiscalizacao, *quem consentiu* e *quem operou* sao perguntas separadas. **A ordem e sempre aluno primeiro:** endosso sobre quem ainda nao consentiu seria autorizacao construida de tras para frente. **Revogar exige uma so**, e a assimetria e deliberada: o titular retira o consentimento a qualquer tempo (art. 18, IX) sem depender de ninguem. 🔴 **O defeito que este desenho existe para impedir, e que quase entrou por reuso:** `ConsentRepository.registrarDecisao` (F8) marca como substituida **toda** decisao viva do documento. Reusa-lo aqui faria o endosso do professor **apagar o consentimento do aluno** — e a autorizacao ficaria de pe com uma assinatura so, que e o oposto do combinado. Fechado com o eixo novo `ConsentSignerRole` no `where` do `updateMany`. **Provado por mutacao:** remover o filtro de papel derruba os dois testes que existem para isso. **`AI_ANALYSIS` e tipo proprio de documento e nao versao do `HEALTH`, e a distincao e o produto:** (retificacao de 20/08) decidiu que recusar a IA deixa o aluno com avaliacao, historico, comparativos e metas — tudo, menos o texto gerado. Fosse versao do `HEALTH`, revogar a IA revogaria junto o registro da avaliacao. **O snapshot e a fronteira de privacidade do produto, e e montado por LISTA BRANCA — campo a campo, sem um unico spread.** Espalhar a entidade e omitir o que incomoda continuaria carregando todo campo que alguem adicionasse amanha ao objeto de origem, e o vazamento apareceria numa fatia futura sem ninguem ter tocado neste arquivo. O que **nao** viaja, cada um por uma razao diferente: identificador direto (`M3-NFR-009`); **o `studentId`**, que seria rotulo estavel entre chamadas e reidentificaria por correlacao mesmo sem nome; e **qualquer campo de origem ECG** (ADR-035 decisao 4) — vai so o booleano de pendencia, porque sem ele a analise diria *esta tudo otimo* com pendencia cardiaca aberta, e **com** o texto do achado a IA viraria a interprete e o produto viraria dispositivo medico sob a RDC 657/2022. A idade viaja em **faixa de decada**: 34 e quase um identificador quando somado a sexo e a uma serie de pesagens datadas; a analise nao perde nada, porque faixa de referencia de composicao corporal e definida por decada. **Duas mutacoes confirmam:** plantar `studentId` derruba dois testes, plantar o achado do ECG derruba outros dois — um textual, outro estrutural. 🔴 **A guarda de PII tinha um falso positivo de 8%, e ele so apareceu porque a suite de integracao ficou instavel.** O regex de telefone brasileiro casa com hex suficientemente numerico, e a `analysisRef` e `randomBytes(16)` em hexadecimal: **uma analise legitima a cada doze seria recusada em producao**, de forma aleatoria e sem causa aparente para quem opera. Medido em 10.000 sorteios: 7,9%. Corrigido excluindo da varredura a referencia opaca — que e gerada por nos e nao deriva de dado do aluno — e movendo os testes de PII para um campo de **conteudo**, que e o que a guarda precisa varrer. Cinco execucoes consecutivas depois: 18/18 estaveis. **Teste instavel e defeito ate prova em contrario, e aqui a prova era a favor do defeito.** **O validador e onde a regra no 8 vira codigo.** Rejeita — nunca *limpa*: um texto que diagnostica nao fica seguro depois de apagar a frase ofensiva, porque o raciocinio que a produziu contaminou o resto, e editar a saida do modelo e assumir a autoria dela. Cobre esquema (o `disclaimerCode` e literal, nao *alguma string*), linguagem de diagnostico, prescricao, **tranquilizacao clinica** (*nao ha risco* e tao perigoso quanto o alarme), achado que o ADR-037 ja suprimiu, e analise escrita apesar do bloqueio por gestacao. **E a metade que costuma ser esquecida: valor inexistente.** Modelo inventa numero com a mesma fluencia com que acerta, e citar 21,8% quando o snapshot tem 22,3 e **mais perigoso que um diagnostico** — o diagnostico o avaliador percebe, o numero errado ele repassa ao aluno. Todo numero da prosa e conferido contra o snapshot. 🔴 **Dois defeitos reais no proprio validador, achados ao escrever os testes e invisiveis em revisao de leitura.** **(1)** O regex de prescricao **nunca casava**: a fronteira de palavra depois de um digito exige nao-digito colado, e em *4 series de 12 repeticoes* vem um espaco — uma prescricao de treino passava direto pela guarda. **(2)** A checagem de metrica suprimida procurava o termo em **ingles** numa prosa que sai em **portugues**; guarda que nunca casa e indistinguivel de guarda ausente, a mesma armadilha do lint sem canario. Resolvido com tabela de rotulos em pt-BR, mapeada a mao — derivar do enum produziria termo que nunca casa. **(3) Ordem:** numero e conferido por ultimo, porque prescricao carrega numero inexistente e conferir primeiro registraria uma prescricao como *valor inventado*, perdendo na auditoria do `M3-AC-008` o motivo que de fato importa. **Quatro `CHECK` no banco, todos provados por canario.** A principal: `output` so existe em analise `PUBLISHED` — **texto recusado pela regra no 8 nao consegue ser gravado**, nem *para consulta*. Ela pegou um defeito meu na hora: `Prisma.JsonNull` grava o valor JSON `null`, que **nao** e `NULL` de coluna, e a constraint recusou corretamente; a correcao e omitir o campo (spread condicional, porque `exactOptionalPropertyTypes` tambem recusa `: undefined`). Mais: rejeitada sempre tem motivo, e custo/latencia/tokens nao sao negativos. **O fake e o adapter que responde, e isso NAO e provisorio por descuido:** o ADR-036 decisao 3 exige contrato com clausula de nao-treinamento firmado **antes da primeira chamada com dado real**, e ele nao esta firmado — e ato de terceiro. Ate la a fatia funciona ponta a ponta **sem que um unico numero de aluno atravesse a fronteira do pais**. Trocar e `useClass`, mas so depois do contrato, que o codigo nao sabe conferir. O fake e **deterministico** (o aceite da Slice exige reprodutibilidade) e sua saida **passa pela propria validacao** — um fake que produzisse saida invalida faria o caminho feliz nunca ser exercitado. **Fora de escopo, registrado:** `M3-STUDENT-AI-01` (mostrar analise ao aluno) nasceu no plano, nao no PRD — a rota de leitura existe e e o que totem e app consomem, mas a **superficie** e decisao do PI; a pendencia medica fica `false` ate a **F19** entregar o parser de ECG, e o campo ja existe porque ligar isso depois nao pode mexer no formato do snapshot ja gravado. **Nao ha UI.** Evidencia: lint 9/9, typecheck 13/13, build 7/7, 11/11 tasks, **1231 unitarios** (61 novos: 15 do snapshot, 29 do validador, 17 do aceite direto e automatico, ficando disponivel para o aluno no mobile e totem) e **18 de integracao novos** contra Postgres real, com quatro mutacoes — aceite removido derruba 4 testes, filtro de papel derruba 2, `studentId` vazado derruba 2, achado de ECG vazado derruba 2 |
| 21/08/2026 | **F19** | SPEC-019 | [#143](https://github.com/RodReis/arenahub/pull/143) | **Upload e revisao, Slice 3.3 — entregue ANTES da F22 por decisao do PI**, porque metade do escopo da 3.6 (painel de importacoes) depende das tabelas que nascem aqui. **A importacao NAO e uma avaliacao; ela vira uma, depois de revisada.** Tabela separada de `body_assessments` porque `M3-BR-006` e INV-103 exigem confirmacao humana ANTES de o dado existir como historico. Gravar direto na avaliacao com um flag *revisada* faria o valor do OCR ja estar no grafico esperando alguem desmarcar — e um esquecimento viraria dado oficial. **O estado de revisao mora em CADA CAMPO, e nao na importacao.** Um estado unico forcaria o avaliador a aceitar tudo ou rejeitar tudo, e o caso comum e o meio: nove campos certos e um que o OCR leu como 3,15 quando era 31,5. Quatro estados: `PENDING` (nao vira medida), `CONFIRMED`, `CORRECTED` (o valor do OCR fica guardado — proveniencia, que o aceite da Slice exige) e `DISCARDED` (nao vira zero; ausencia e ausencia, INV-104). **A confianca do OCR nao decide nada — ela ORDENA A FILA.** `M3-FR-010` manda registra-la, e ela serve para o avaliador olhar primeiro o que provavelmente esta errado. Auto-confirmar campo de alta confianca seria a regra no 8 contornada por um limiar. Campo sem confianca declarada (`null`) vai para o FIM e nao para o inicio: parser de CSV nao erra em silencio — ou le, ou falha —, e trata-lo como suspeito enterraria os campos de OCR que pedem atencao. **O tipo do arquivo vem do CONTEUDO, nao da extensao nem do `content-type`** — os dois sao controlados por quem envia. A assinatura nos primeiros bytes e o unico sinal que vem do arquivo em si; ha teste com executavel (`MZ`) renomeado para `.pdf`. CSV e o caso sem magic number, e por isso `detectarTipo` devolve `null` em vez de fingir: aceita-se o declarado, mas assinatura que casa com OUTRO tipo e mentira declarada e cai. **O antivirus roda ANTES de o arquivo tocar o storage, e as duas checagens respondem perguntas diferentes:** a assinatura prova o FORMATO, o antivirus prova que o conteudo nao e hostil — um PDF valido pode carregar JavaScript malicioso. `INFECTED` nao guarda o arquivo, e a constraint do banco impede que alguem *conserte* isso para analisar depois. **Scanner fora do ar e diferente de arquivo infectado:** ali nao sabemos se o arquivo e seguro, e na duvida ele NAO entra. O fake reconhece **EICAR**, o padrao que a industria criou exatamente para isto — teste escrito contra o fake continua valendo quando o antivirus real entrar. **O parser de CSV e PRODUCAO, nao dublê** — deterministico, sem terceiro; dubla-lo testaria o dublê. Mesmo assim o resultado passa por revisao humana, e a razao e sutil: o que ele nao erra e a LEITURA. Se a balanca exportou coluna trocada, ele reproduz o erro com total fidelidade. A confirmacao protege contra o dado errado, nao contra o parser errado. **O fake de OCR erra de proposito**, plantando o `3,15` no lugar de `31,5` com confianca baixa — um fake que devolvesse dado perfeito faria o fluxo de CORRECAO nunca ser exercitado. 🔴 **Dois defeitos reais da mesma classe: converter caixa cegamente entre camadas.** **(1)** A unidade de volume e **`L` MAIUSCULO** no dominio (minusculo se confunde com o algarismo 1 e com a letra i); `toLowerCase()` produzia `l`, que nao existe na tabela de fatores, e a conversao estourava com `Cannot read properties of undefined` longe da causa. **(2)** `TipoDeMedida` **ja e maiusculo** e identico ao enum do Prisma; baixar a caixa produzia `body_fat_percent`, e o erro so aparecia na CONFIRMACAO como *unidade percent nao se aplica a body_fat_percent* — seis testes de integracao vermelhos apontando para lugares diferentes do real. Resolvido com mapa EXPLICITO nos dois sentidos, em vez de transformacao de string. **Sete `CHECK` no banco, todos provados por canario.** O principal e o INV-103: `CONFIRMED` exige revisor e instante — sem ele, *o OCR publicou sozinho* seria um estado gravavel, e um bug de servico produziria dado oficial sem dono. Mais: avaliacao so existe em importacao confirmada (a metade que pega o bug silencioso — importacao em revisao apontando para avaliacao significa que o dado entrou no grafico antes de alguem decidir), falha sempre diz por que, infectada nao guarda arquivo, campo `CORRECTED` tem valor novo e os outros estados NAO tem, e confianca e proporcao. **Uma duplicacao eliminada de passagem:** `TIPOS_DE_MEDIDA` e `UNIDADES_DE_MEDIDA` viviam copiadas no controller. Copia de lista fechada diverge na primeira adicao, com o sintoma aparecendo longe da causa — um tipo aceito pela API e recusado pelo import. Agora moram no dominio, com tres consumidores. **Uma decisao de contrato registrada:** o `application/problem+json` do projeto tem campos FIXOS e nao carrega extras — deliberado, porque em rotas de auth distinguir *e-mail invalido* de *senha invalida* ja vaza estado. Entao o campo pendente viaja no `title`, que e o canal que existe: sem ele a tela diria so *nao pode confirmar* e o avaliador procuraria a mao qual dos dez campos falta. **Fora de escopo, registrado:** **nao ha OCR de verdade** — imagem e PDF passam pelo fake ate existir extrator real, e o ADR-035 decisao 8 ja decidiu que o PDF do OmronConnect usa `pdftotext` na camada de texto, nao OCR (mandar para OCR seria pagar para introduzir erro num arquivo que ja traz o texto). **Nao ha UI.** O parser de ECG que alimenta a pendencia medica da F21 continua pendente. Evidencia: lint 9/9, typecheck 13/13, build 7/7, 11/11 tasks, **1265 unitarios** (34 novos: 20 da revisao, 14 da aceitacao de arquivo) e **21 de integracao novos** contra Postgres real, com tres mutacoes — guarda do INV-103 removida derruba 3 testes, storage antes do antivirus derruba 2 |
| 21/08/2026 | **F19** *(emenda — avaliação multiarquivo)* | SPEC-019 | — | **ADR-038: uma medição, três arquivos, N:1 com a avaliação — a Arena Positiva não gera um laudo por medição, gera três (balança `CF610_G`, análise Unique Health da mesma balança, ECG do OMRON), e o modelo da F19 forçava três avaliações no mesmo instante.** Decisão do PI em 21/08, aceita e commitada. **`@unique` sai de `AssessmentImport.assessmentId`; `BodyAssessment.import` vira `imports AssessmentImport[]`.** Nasce a **sessão de revisão** (`reviewSessionId`): os arquivos sobem apontando para a mesma sessão, o avaliador confirma **uma vez**, e é esse commit que cria a avaliação com as medidas de todos. **Campo concordante deduplica; divergente, nunca — e a tolerância é assimétrica de propósito** (`toleranciaDe`, `consolidacao-de-laudos.ts`): errar mostrando custa um clique, esconder diverência publica número errado como confirmado por dois arquivos. **Bioimpedância é obrigatória, ECG é opcional** (`sessaoPodeConfirmar`): conjunto só com ECG não confirma — seria ponto vazio no gráfico da F18. **Classificação do laudo é "qualquer medida diferente de `HEART_RATE`"**, não "tem segmentar": a regra do próprio plano estava errada e um laudo real (`Unique Health` sintético) não tem nenhum tipo segmentar nem `SKELETAL_MUSCLE_MASS` — classificaria `UNKNOWN` e a sessão recusaria bioimpedância legítima. **Enum de medida cresce de 15 para 34** (`medida.ts`): 10 segmentares (alimentam o boneco por região, `RegiaoCorporal`), 8 de composição que os laudos já traziam sem campo (`BONE_MASS`, `BODY_CELL_MASS`, `WAIST_HIP_RATIO` etc.) e `HEART_RATE` — nunca interpretado (ADR-035), guardado como medida e o achado do ECG como atributo opaco. **Índice, classificação e sugestão do fabricante NÃO viram medida** — vão para `BodyAssessment.deviceReport` (JSON), fora do gráfico de evolução: comparar mês a mês um número cuja fórmula muda num firmware novo produziria tendência falsa. 🔴 **O índice de idempotência do plano estava estruturalmente errado, e só a execução contra Postgres real revelou** (Docker tinha ficado parado nos rounds anteriores). `UNIQUE(review_session_id) WHERE assessment_id IS NOT NULL` significa "no máximo uma LINHA de `assessment_imports` por sessão confirmada" — mas uma sessão de três arquivos tem três linhas que precisam, todas, apontar para a mesma avaliação; o segundo `UPDATE` colidia contra o primeiro da própria transação, e a sessão legítima era recusada com 409 pelo motivo errado. **A garantia certa mora em `BodyAssessment.source_reference`:** índice único parcial `body_assessments_import_source_reference_uq` sobre `(source_reference) WHERE source = 'IMPORT'` — uma linha de avaliação por confirmação, que é a forma estrutural do invariante (migration `20260821250000`). 🔴 **Revisão adversarial em Opus achou 3 Critical antes do merge, nenhum coberto por teste até então.** **(1) Corrupção cross-paciente:** `reviewSessionId` vinha do corpo da requisição sem conferir de quem é a sessão — upload no aluno B citando a sessão do aluno A gravaria as medidas de B no histórico de A. Fechado com guarda antes de persistir, mais teste do ataque. **(2) Avaliação órfã publicada:** os dois confirmadores concorrentes publicavam ANTES do índice disparar; o perdedor recebia 409 limpo mas deixava uma `BodyAssessment` `PUBLISHED` sem vínculo, aparecendo na F18 como segunda medição do mês. Corrigido invertendo a ordem — rascunho → vincula → publica —, com `excluirRascunho` no catch. **(3) Campo não revisado sumindo calado:** `confirmarSessao` nunca chamava a revisão completa; campo `PENDING` presente num só arquivo passava o gate e era expurgado depois, valor irrecuperável. Corrigido chamando a revisão sobre os campos de TODOS os imports antes de criar a avaliação. Divergência bloqueia a confirmação enquanto **qualquer** lado do campo estiver `PENDING` (`some`, não `every` — o plano usava `every`, e uma linha com um lado `CONFIRMED` e outro `PENDING` seria tratada como resolvida sem decisão humana). **Riscos residuais registrados, não bloqueiam:** a guarda cross-paciente é TOCTOU (exige UUID adivinhado + simultaneidade); `excluirRascunho` roda em transação própria após o rollback — processo morto entre o throw e o delete deixa `DRAFT` órfão visível em `listarDoAluno`. **`GET /students/:id/body-evolution` é o contrato que o app e o totem vão consumir (F26–F28) — nada os consome ainda, e a forma tem que estar certa por conta própria.** A leitura de faixa (cor) é resolvida no servidor, nunca no cliente, para o mesmo braço não aparecer verde no app e amarelo no totem no dia em que o fabricante mudar uma faixa. **`DocumentExtractorRouterAdapter` passa a rotear CSV/PDF para o extrator real e só PNG/JPEG para o dublê** — produção deixa de depender de fake para o caminho que já tem extrator determinístico, lacuna que nenhuma task do plano tinha assumido. **Bug pré-existente achado e corrigido de passagem:** lista de tipos duplicada no `assessment.controller` bloqueava toda medida segmentar — mesma classe de defeito que o `medida.ts` documenta (cópia de lista fechada diverge na primeira adição). **Nada rodou contra Postgres real até o fix round 2** (Docker parado); a migration do índice parcial foi escrita à mão e só provada depois, com o índice antigo derrubado pelo próprio teste de sessão de 3 arquivos. **Fora de escopo, registrado:** telas de app e totem que consomem o contrato (MVP 4, F26–F28) — só a rota existe. Evidência: lint 9/9, typecheck 13/13, build 7/7, admin-web 118/118, api 707/710 (as 3 falhas são `aceite-da-analise.spec.ts` da F21, pré-existentes na `main`, confirmadas sem qualquer alteração desta fatia) |
| 21/08/2026 | **F22** | SPEC-022 | [#144](https://github.com/RodReis/arenahub/pull/144) | **Operacao e qualidade, Slice 3.6 — a ultima fatia de codigo do MVP 3.** Entregue logo apos a F19 porque metade do escopo (painel de importacoes) dependia das tabelas dela. **A operacao de saude entra no MESMO painel da catraca, e a decisao e sobre quem age:** quem olha laudo parado e a mesma pessoa que olha catraca parada. Uma segunda tela so para saude seria uma tela que ninguem abre — o mesmo raciocinio que a F16 usou para colocar o financeiro ali. **NENHUM alerta desta fatia e `CRITICAL`, e isso e deliberado.** `CRITICAL` significa *a catraca nao esta funcionando agora*. Laudo esperando revisao e analise recusada sao problemas reais e nenhum impede alguem de treinar; dar a eles o mesmo peso faria a operacao aprender a ignorar o vermelho — que e como um painel morre. **Quatro alertas, cada um com uma armadilha propria.** **(1) `HEALTH_IMPORT_PENDING_REVIEW`** nao e erro: a importacao esta funcionando exatamente como o INV-103 manda, e o alerta existe porque *a fila que ninguem abre e a fila que nao existe* — e aqui a espera custa caro, o aluno mediu, pagou pela bioimpedancia e nao ve o resultado. Limite de 48 h cobre fim de semana sem alertar a academia toda segunda de manha. **(2) `HEALTH_IMPORT_FAILED`** junta extracao falha e antivirus recusado de proposito: quem opera age igual nas duas — fala com o aluno e digita a mao —, e separar dobraria a tela sem dobrar a acao. A acao recomendada diz *a mao* em voz alta, porque sem isso a recepcao fica esperando o OCR voltar (INV-140). **(3) `HEALTH_AI_REJECTION_RATE_HIGH` vigia a TAXA, nunca a rejeicao isolada.** Uma analise recusada e a regra de arquitetura no 8 FUNCIONANDO — a saida trazia diagnostico ou numero inexistente e caiu inteira. O que vira problema e um terco delas caindo: ai deixou de ser o modelo tropecando e passou a ser prompt, snapshot ou versao de modelo. **O piso de amostra e o detalhe que salva o painel:** sem ele, UMA rejeicao na PRIMEIRA analise da academia viraria *100% de rejeicao* e alarme no dia em que o recurso foi ligado — a forma mais rapida de a operacao desconfiar do painel inteiro. Taxa sobre amostra minuscula nao e taxa. **Provado por mutacao:** remover o piso derruba o teste. **(4) `HEALTH_AI_BUDGET_NEAR_LIMIT` avisa em 80%, ANTES de estourar.** Estourado o teto a analise degrada para modo manual (`M3-NFR-004`) e a academia descobre pelo aluno reclamando que o resumo sumiu; avisar antes da tempo de decidir entre aumentar o teto e aceitar a degradacao. **Teto `null` DESLIGA o alerta em vez de assumir um numero** — o ADR-036 decisao 4 diz que o teto e parametro do cliente, e inventar um valor cortaria a analise de uma academia que nunca combinou limite nenhum. **Provado por mutacao:** fazer `null` virar um padrao derruba dois testes. **O painel de importacoes lista pendentes e falhas na MESMA fila**, com a contagem de campos que faltam revisar — e importacao confirmada SAI dela, porque fila que nao esvazia e fila que a operacao aprende a ignorar. A rota `pending` e registrada ANTES de `:id` no controller: depois, o Nest casaria `pending` como um id e a fila responderia 404. **O runbook (`docs/runbooks/MVP-03-saude.md`) comeca pelo que o operador VE, nao pelo nome interno do erro**, e a secao 3 e a que responde ao aceite literal da Slice — *equipe corrige falhas sem alterar banco ou apagar avaliacao publicada*. Ela lista cinco situacoes com o procedimento de cada uma (correcao vinculada, editar rascunho, corrigir campo em revisao, descartar importacao, gerar analise nova) e termina dizendo que **se nenhuma resolve, o problema sobe** — alterar banco a mao nao e opcao deste documento. Traz tambem a tabela de causas do `IMPORT_FAILED` e o aviso explicito de NAO desligar a validacao da IA para *destravar*, porque desliga-la transforma o produto em dispositivo medico sob a RDC 657/2022. **Fora de escopo, e a maior parte disto NAO e codigo:** o **piloto com profissionais e alunos consentidos** que a Slice 3.6 pede e turno real com gente — nao ha o que implementar, e esta registrado como pendente no runbook §4. **Metricas de completude e origem** ficaram parciais: origem de importacao existe desde a F19, mas o painel de completude por tipo de medida nao entrou, porque sem avaliacao real em volume ele mediria o vazio. **Nao ha UI** — os alertas entram no `OperationalAlert` que o painel da F11 ja consome, e a fila tem rota; a tela e decisao de superficie. **O teto de gasto nao tem tela de configuracao**, entao o alerta de orcamento nao dispara hoje. Evidencia: lint 9/9, typecheck 13/13, build 7/7, 11/11 tasks, **1281 unitarios** (16 novos, todos do avaliador de saude) e **4 de integracao novos** do painel, com duas mutacoes — piso de amostra removido derruba 1 teste, teto `null` assumindo padrao derruba 2 |
| 22/08/2026 | **F18/F19/F21** *(correções e uma tela só)* | SPEC-018/019/021 | *(PR desta entrega)* | **A avaliação e o histórico viraram UMA tela, e três defeitos que nenhum teste pegava vieram junto.** Pedido do PI ao ver a tela: as quatro abas (`Valores`/`Segmentos`/`Histórico`/`ECG`) não existem na referência de design e escondiam três quartos da avaliação atrás de um clique; a análise de IA ficava espremida ao lado de uma aba só, e o histórico do aluno era outra tela sem análise nenhuma. `AvaliacaoCompleta` passou a ser o componente que as duas rotas renderizam — não são duas telas parecidas mantidas em paralelo. `/students/:id/health` abre a medição mais recente com seletor de data; envio de laudos e gráficos por período (F18) descem para baixo, nada da F18 se perdeu. **Três defeitos que só apareceram com dado e arquivo de verdade, todos com o mesmo padrão — o dublê devolvia o formato certo por construção e a suíte provava a metade que existia:** (1) **nenhuma análise de IA jamais publicou.** O prompt `@1` dizia "responda com o JSON do schema pedido" sem nunca mostrar o schema; o modelo inventava a estrutura, devolvia `improvementPoints` (campo que não existe no contrato) e omitia sete obrigatórios, e `validarSaida` rejeitava tudo com `SCHEMA_INVALID`. `@2` declara o JSON campo a campo; `@3` proíbe vocabulário clínico até para NOMEAR medida, porque "Frequência cardíaca" — rótulo de um campo do laudo — batia na guarda `DIAGNOSTIC_LANGUAGE` que mira "fibrilação cardíaca". **A guarda não foi afrouxada:** ela é a regra de arquitetura 8 e existe por RDC 657/2022. (2) **o ECG em PDF nunca foi lido** — ver a correção de 22/08 no ADR-041: `extrairEcg` decodificava os bytes comprimidos do PDF como UTF-8. `unpdf` extrai a camada de texto, e o ADR-035 §8 (que sempre disse que o PDF tem texto) foi vindicado. (3) **`consent_documents` estava vazia**, então nenhum aluno podia aceitar a análise e nenhuma rodava; o seed cria o documento `AI_ANALYSIS` e o aceite para todos os alunos ativos. **Metas e controle** (peso padrão, três controles, ingestão) entrou como atributo em `BodyAssessment.deviceReport` — o PI pediu inicialmente captura como medida, e a **INV-151**, o ADR-038 e o design da própria fatia multiarquivo já determinavam `deviceReport`; apresentado ao PI, que optou por seguir a invariante. Sem migration de enum, sem ADR revogando invariante numerada. **Alinhamento ao design system:** a tela escrevia `<table>` cru enquanto o painel tem `DataTable` com papel de coluna (§5.1) usado por doze telas, e três telas escreviam o mesmo botão de ícone à mão — `Button` ganhou a variante `icon` (§6), com `aria-label` exigido pelo TIPO e `prefers-reduced-motion` que vivia espalhado nas telas. |
| 24/08/2026 | **F53** | SPEC-053 | *(PR desta entrega)* | **Pagamento no balcão: dinheiro, PIX e cartão numa tela só.** A rota `/students/[id]/billing` já existia desde a F12 — **não há rota nova nem ícone novo**; o que muda é que ela passa a perguntar a FORMA antes do valor. O caminho do dinheiro fica intocado. **Quatro decisões do PI em 23/08:** `GET /api/v1/invoices` implementado (a spec propunha cortar, o PI recusou o corte); o fuso passa a vir da unidade do aluno; a confirmação é polling de leitura barata, não WebSocket; e o CPF obrigatório do ADR-043 entra nesta fatia. 🔴 **O defeito que a fatia produziu e mediu antes de existir em produção:** o índice parcial da F14 (`method='CARD' AND status='PROCESSING'`) **não cobria o checkout hospedado**, que nasce em `CREATED` — sonda com `Promise.allSettled` contra Postgres real devolveu **`sucessos: 2, gravadas: 2`**, ou seja, duas cobranças simultâneas de cartão para a mesma fatura. Corrigido com segundo índice parcial cobrindo `CREATED|REQUIRES_ACTION|PROCESSING`; os terminais ficam de fora **de propósito**, porque aluno com cartão recusado tem de poder tentar de novo. O índice da F14 continua intacto — cobre a recorrente, caminho diferente. Provado por mutação (`DROP INDEX` derruba 4 testes). 🔴 **Segundo defeito, achado pela revisão e confirmado por medição minha: o teste de concorrência não media o índice.** As duas chamadas usavam o mesmo `agora`, logo a mesma `idempotencyKey`, e quem rejeitava a segunda era o unique de idempotência — com o índice derrubado o teste **passava verde**. Consertado com instantes distintos e asserção do TIPO do erro da perdedora; `sucessos: 1` sozinho é satisfeito por qualquer falha, inclusive FK quebrada. 🔴 **Terceiro: tentativa presa em `CREATED` trancava a fatura contra cartão para sempre** — nada tirava do estado, ele está no predicado do índice, e o checkout expira em 30 min sem que nada expirasse a tentativa. Decisão do PI: consertar por **expiração**, não pelo reuso que o PIX faz (devolver link de checkout vencido é pior que gerar outro). Coluna `expires_at` nova, e a tentativa vencida é marcada terminal ao ser encontrada, destravando a fatura sozinha. **`FUSO_PROVISORIO` morreu** (INV-144): o fuso vem da unidade de origem do aluno, sem migration — `gym_units.timezone` existe desde o ADR-019. O teste usa `America/Manaus` de propósito: com o fuso da academia real, o valor certo e o fixo coincidem e o teste ficaria verde com a constante no lugar. **A leitura do polling é rota nova e barata** (`GET /payment-attempts/:id`, só o nosso banco): a rota que já existia bate no provedor a cada chamada — num laço de 3 s seriam ~20 chamadas externas por minuto por caixa, e o provedor falso não tem limite, então o desenho errado passaria verde em dev e quebraria em produção. Ela vira o botão *"Conferir com o banco"*. **`method: 'PIX'` estava fixo no webhook** em três lugares (o `Payment`, o evento `InvoicePaid` e a ação de auditoria): pagamento de cartão entraria registrado como PIX, e recibo e conciliação mentiriam sobre o meio. Corrigido propagando o método da tentativa; `canal()` **falha alto** em `MANUAL` em vez de mapeá-lo para `pix`, porque pagamento manual tem convenção própria (`billing.payment.manual`) que o mapa não sabe produzir. **CPF obrigatório (ADR-043)** é validação de **aplicação, nunca de coluna** — os 308 alunos legados sem CPF continuam existindo, treinando e passando na catraca; só não pagam no cartão. Isso quebrou **12 suítes de integração e 18 testes E2E** que cadastram aluno, todos consertados; o teste que **afirmava a decisão revogada** (*"documento não é requisito de matrícula"*) foi **invertido e renomeado** citando o ADR, não apagado. **Correção adjacente deliberada:** varrendo o `apps/api` atrás do mesmo padrão de `orderBy` com boolean solto, achei **mais um** — a listagem de alunos escolhia o telefone com `orderBy: { isPrimary: 'desc' }` e `take: 1`, então o empate não embaralhava a ordem, **trocava qual telefone a recepção vê**. Corrigido e coberto por teste que não existia: o campo `phone` nasceu na F50 sem nenhum teste de integração que o lesse. **Guarda estrutural nova no `admin-web`:** nenhum campo de cartão no painel (INV-098), lendo o código-fonte, porque o defeito a prevenir não é "a tela se comportou errado" e sim "alguém acrescentou um input de cartão porque era mais rápido". **O wizard de cadastro ganhou os primeiros testes da sua vida** — a task do CPF mexeu justamente nele, e a mutação foi a mais instrutiva da fatia: plantar `required` num campo **reproduziu a armadilha ao vivo**, com o campo escondido travando o avanço de passo. **Fora de escopo, registrado:** a rota HTTP do checkout **não existia** (a F53 criou o caso de uso e o plano esqueceu a porta — corrigido aqui); `POST /payments/:id/receipt` exige `Payment.id`, que nenhuma rota do polling devolve, contornado com uma consulta a mais; e **plano criado pela interface nasce sem preço** e nunca gera cobrança, porque `plan_prices` só é escrito pelo seed. Evidência: lint 9/9, typecheck 13/13, **1440 unitários**, integração medida em blocos (billing **99**, students **55**) porque o Jest crasha no Windows ao encerrar — pré-existente, verificado no commit base —, **E2E 56/56** |
| 24/08/2026 | — *(#164)* | SPEC-014 | [#166](https://github.com/RodReis/arenahub/pull/166) | `[FIX]`: **cobranca de cartao gravava o id INTERNO da conta em `PaymentAttempt.providerAccountId`**, em vez do id EXTERNO que o resto do sistema usa (PIX, webhook, checkout de cartao todos gravam `conta.externalAccountId`). A coluna existe para casar `(providerAccountId, externalPaymentId)` com o que o provedor devolve -- achado registrado como lacuna aberta na propria F53 (#160). Revisao mostrou que o dano era menor do que a issue supunha: conciliacao e estorno leem `Payment`, nao `PaymentAttempt`, e `Payment` nasce certo no webhook -- o bug ficava numa coluna que nenhum consumidor le hoje, mas era bomba armada para o primeiro que a lesse. Canario: teste asserta o valor exato (nao `toBeDefined()`); reintroduzindo `conta.id` o teste mostra `Expected: "ACC-CARD-..."` vs `Received: UUID`. Evidencia: 9/9 em `billing-cartao-e-recorrencia.int-spec.ts`. **Pendencia ao PI:** verificar se ha linha com UUID interno gravada em homologacao/producao -- banco local zerado, sem acesso as outras bases |
| 24/08/2026 | — *(#168)* | SPEC-053 | [#169](https://github.com/RodReis/arenahub/pull/169) | `[FIX]`: **reajuste de preco recusava a data de hoje.** Achado pelo PI usando a tela real: `reajustarPreco` comparava **instante contra instante** -- `validFrom` vem do `<input type="date">` como meia-noite, e contra o instante corrente (ex. 15h) a meia-noite de hoje ja e "passado". So dava para reajustar a partir de amanha; plano ficava com `currentPrice` nulo mesmo com vigencia gravada certa. Corrigido comparando **inicio do dia**, nao o instante -- `agora` continua entrando por parametro, nunca `new Date()` interno. O teste antigo nunca cobria essa fronteira: usava `2020-01-01`, passado distante que as duas versoes da regra recusam igual. Canario (bug reintroduzido): 1 falha isolada (422 em vez de 201), resto segue verde. Evidencia: integracao students-membership 40/40, unit admin-web 195/195, lint 9/9, typecheck 13/13. Achado colateral registrado como issue separada: #167, `chamarApi` asserta tipo em vez de validar |
| 24/08/2026 | — *(#170)* | SPEC-045 | [#171](https://github.com/RodReis/arenahub/pull/171) | `[FIX]`: **nao dava para editar informacao basica do aluno.** Mesmo padrao de lacuna do F53/F45: `PATCH /students/:id` ja existia completo (trava otimista, timeline, auditoria, outbox) desde a F45, e nada no frontend chamava. Server Action `editarAluno` liga o formulario ao endpoint. **Decisao do PI: formulario embutido na propria ficha**, fechado por padrao -- ficha e tela de consulta, 18 campos abertos empurrariam "Acesso agora" para fora da dobra em 1280px. Ficha passou a exibir `contacts`/`address`, que a API sempre devolveu e a UI ignorava. **Guarda deliberada:** como `contacts` e substituido por inteiro no PATCH e a tela edita um telefone por vez, aluno com dois telefones perderia o segundo silenciosamente ao salvar -- por isso a edicao de contato fica **indisponivel com explicacao** em vez de meio-implementada. Canario: guarda afrouxada -- 1 teste isolado cai. Fora de escopo por decisao implicita: `gymUnitId`/`leadSource`/`advisorUserId` mudam a origem do aluno, nao sao correcao de digitacao. Evidencia: unit admin-web 201/201, lint 9/9, typecheck 13/13. Sem migration, sem mudanca de API |
| 24/08/2026 | — *(#172)* | SPEC-008 | [#173](https://github.com/RodReis/arenahub/pull/173) | `[FIX]`: **"Atribuir plano" acumulava assinatura em vez de trocar.** O botao chamava `POST /subscriptions`, que cria, nao substitui -- aluno ficava com duas assinaturas ativas, a listagem mostrava o plano novo e a catraca continuava honrando o antigo pela uniao das janelas: bug silencioso no caminho de acesso. Trocar de verdade = `CANCEL` da assinatura anterior **antes** do `POST` da nova -- se o `POST` falhar depois, o aluno fica sem plano (erro visivel, corrigivel); a ordem inversa deixaria as duas ativas se o `POST` falhasse. O `CANCEL` exige `version`, que `EntitlementDto` nao carregava -- bloqueio conhecido, destravado por decisao do PI em 24/08 com `subscriptionVersion` novo no DTO (`null` para cortesia, que nao nasce de assinatura). Dois canarios: falha do cancelamento deixando de bloquear a criacao -- 1 teste cai; cancelamento removido por completo -- 2 caem, incluindo o que descreve o bug original. **Achado colateral:** `vitest.config.ts` so coletava `app/**/*.test.tsx` -- o primeiro teste de Server Action (`.ts`, sem JSX) nunca era coletado, e `vitest run` saia verde com o arquivo inteiro fora da suite; descoberto porque a contagem de testes nao subiu ao escrever cinco novos. Evidencia: unit admin-web 206/206, integracao students-membership 40/40, lint 9/9, typecheck 13/13 |
| 24/08/2026 | — *(#174)* | — | [#175](https://github.com/RodReis/arenahub/pull/175) | `[FIX]`: **ficha do aluno era a unica tela sem CSS proprio** -- 551 linhas em estilo default de navegador, e as quatro portas do sistema (historico, biometria, financeiro, evolucao) eram links de texto num rodape, o destino mais usado da tela era o elemento menos visivel. `ficha.module.css` novo; portas viraram cards com separador (nao sombra -- `PRODUCT.md` proibe); icones em carbono, nao accent (DS-PAINEL §2.3: accent e acao, portas navegam); hover em dois canais; sem `transform` na transicao para nao contradizer a promessa de p95 <300ms da catraca. Alvo de clique manteve 32px (densidade e funcionalidade); o glifo cresceu 18->20px nesta entrega -- medida revista no PR seguinte porque o PI nao viu diferenca. **Achado ao tentar quebrar a logica de cortesia:** o teste continuava passando porque `subscriptionId` era checado **duas vezes** (no `find` e no ternario) -- derrubar a primeira nao mudava o resultado. Corrigido para checagem unica, que tambem estreita o tipo e dispensa `?? 0` mascarando versao ausente; so entao o canario passou a derrubar o teste. Evidencia: canario (protecao de cortesia removida) -- 1 teste cai; unit admin-web 210/210; lint 9/9; typecheck 13/13. **E2E nao rodou localmente** -- exigiria recriar o banco `arenahub_e2e`, decisao do PI de deixar o CI provar em vez disso; os `data-testid` percorridos pelo E2E foram preservados na troca de markup |
| 24/08/2026 | — *(#176)* | — | [#177](https://github.com/RodReis/arenahub/pull/177) | `[FIX]`: **data de nascimento andava um dia** -- bug de dado, nao estetica. Coluna `@db.Date`, API ja devolvia `"1999-07-16"` puro, mas `TenantDateTime` reinterpretava como meia-noite UTC e convertia para o fuso da unidade: um dia para tras. Salvar pelo formulario gravava o dia **exibido**, errado -- corrigir um telefone moveria o nascimento do aluno; em 01/01 viraria 31/12 do ano anterior. Correcao na raiz, no componente: `YYYY-MM-DD` sem `T` e data pura -> formata em UTC; qualquer outra coisa (sempre com `T...Z`) e instante -> segue convertendo fuso. Guarda no componente, nao em prop nova, porque prop exigiria que cada call site lembrasse de passa-la. Achado colateral: `Invoice.billingPeriod` (tambem `@db.Date`) tinha o mesmo problema, corrigido junto. **Segunda mudanca:** edicao virou modal com abas (Identificacao/Contato/Endereco) via `<dialog>` nativo -- 18 campos empilhados empurravam "Acesso agora" para baixo da dobra. Campos das abas inativas ficam **montados, so escondidos**: um `<input>` desmontado nao entra no `FormData`, e salvar da aba errada apagaria as outras silenciosamente -- ha teste travando isso. **Terceira:** glifo 18->24px, revisando a medida do PR anterior (+78% de area contra +11% de antes, dentro do alvo de 32px). `react-icons/fc` sugerido pelo PI foi descartado -- Flat Color multicolorido colide com DS-PAINEL §2.3 (accent e acao) e com "cor nunca e canal unico". Canario: guarda de data pura desligada -- 2 testes caem; teste de instante segue verde, provando que a guarda nao vaza para `dueAt`/`startsAt`. Evidencia: unit ui 178/178, unit admin-web 212/212, lint 9/9, typecheck 13/13. **Tambem neste PR:** removidos `DESIGN.md` e todo `docs/design/` (rebaixados/substituidos, ~2200 linhas) e dois worktrees orfaos |
| 24/08/2026 | — *(#178)* | — | [#179](https://github.com/RodReis/arenahub/pull/179) | `[FIX]`: **nao havia como cadastrar unidade nem dispositivo.** Mesmo padrao de lacuna: `POST /units` (fuso IANA/ADR-019, auditoria) e `POST /devices` (homologacao de hardware, auditoria) completos na API, zero chamada no frontend -- `EmptyState` de unidades pedia para "cadastrar a primeira" sem oferecer caminho. Caso de dispositivo era mais grave: sem seed e sem auto-registro do edge-agent, a tela ficaria vazia para sempre sem esta entrega. Telas novas de cadastro para as duas. **Duas decisoes:** `openingHours` nasce vazio (`{}`) -- quem controla acesso e a janela do plano/entitlement, nao o horario declarado, e `PATCH /units/:id` permite preencher depois; modelo de dispositivo e **lista fechada**, nao campo livre -- so Topdata Inner Fit homologado, campo livre deixaria a recepcao digitar a marca errada e falhar so depois de preencher tudo. Canario: firmware vazio virando `''` -- 1 teste cai, protegendo "nao informado" vs "valor vazio" sob schema `.strict()`. Evidencia: unit admin-web 219/219, lint 9/9, typecheck 13/13. Sem migration, sem mudanca de API. **Pendencia ao PI:** confirmar se homologacao de hardware sera cadastro manual pela recepcao ou provisionamento na instalacao fisica |
| 24/08/2026 | — *(#180)* | — | [#181](https://github.com/RodReis/arenahub/pull/181) | `[FIX]`: **catraca Topdata Inner nao podia ser cadastrada** -- evidencia de bancada ja existia (`docs/field-notes/2026-08-15-hardware-arena-positiva.md` §2.1: serial `247000797`, firmware `7.05.00`, porta SDK `3570`/`EasyInner.dll`, mesma catraca do ciclo facial ao vivo de 17/08, 28 giros confirmados por sensor), so faltava codificar. `kind` do dispositivo passou a **derivar do modelo** em vez de valor fixo -- com dois modelos na lista (leitor + catraca) o select virou controlado para nao permitir par trocado. Testes novos de homologacao que nao existiam antes: os dois modelos aceitos, os dois pares trocados recusados, modelo desconhecido recusado, e comparacao travada por **igualdade**, nao prefixo -- "Inner" e prefixo de "Inner Fit", um `startsWith` faria o leitor casar com a entrada da catraca. Canario: catraca fora da lista -- 3 de 8 testes caem. Evidencia: unit api 779/779, unit admin-web 225/225, lint 9/9, typecheck 13/13. **Continua provisorio:** quando o gate `M1-HW-01` passar, a lista sai do codigo e vem do documento de homologacao formal |
| 24/08/2026 | — *(sem issue -- ver nota)* | — | [#182](https://github.com/RodReis/arenahub/pull/182) | `[FIX]`: tres achados no mesmo PR. **(1) Bug visto tres vezes pelo PI enquanto o dev insistia que era cache:** a tela de unidades tem **dois** `PageHeader` -- um dentro do `if (!resposta.ok)` de erro, outro na tela normal -- e o botao "Nova unidade" foi parar no de erro, so visivel para quem **nao tem** permissao de listar; na tela real da recepcao nao havia botao nenhum. Lint, typecheck, testes e CI todos verdes porque nada verificava em qual dos dois cabecalhos o botao estava; so a inspecao visual do PI achou. Teste novo separa os caminhos: acao presente no sucesso, ausente no erro, presente no vazio. **(2) Edicao de unidade:** `PATCH /units/:id` ja existia sem chamador; modal de dois campos em vez de rota inteira. `openingHours` nao viaja no corpo (ausente = nao mexer; presente-vazio apagaria horario sem ninguem perceber, pois nenhuma tela hoje exibe horario); `code` fica de fora, API recusa altera-lo sob `.strict()` com mensagem explicando o motivo. **(3) Abas na tela de planos** (listagem x criar), componente de abas extraido e reaproveitado pela ficha do aluno. Canario: botao fora do header de sucesso -- 1 teste cai; `openingHours` no corpo do PATCH -- 1 teste cai. Evidencia: unit admin-web 233/233, lint 9/9, typecheck 13/13. **Nota de rastreabilidade:** este PR nao referencia `refs #N` no corpo, diferente do padrao dos demais -- nenhuma issue aberta foi encontrada correspondendo ao achado; registrado aqui para nao perder o rastro |
| 24/08/2026 | — *(#183)* | SPEC-008 | [#184](https://github.com/RodReis/arenahub/pull/184) | `[FIX]`: **nao havia como desativar plano.** Diferente das lacunas de unidade/dispositivo, aqui faltavam os **dois lados**: campo `isActive` ja existia no schema, era lido pelo DTO e ate exibido na tela, mas nada nunca o gravava -- nem rota na API, nem botao no painel; plano cadastrado era permanente na lista de escolha. **Decisao do PI: desativar, nao excluir** -- apagar deixaria invoice e timeline antigas citando plano inexistente, e historico financeiro e auditado. **Regra de "em uso":** bloqueia desativacao com assinatura em `PENDING`/`ACTIVE`/`PAST_DUE`/`PAUSED`; nao bloqueia com so `CANCELLED`/`EXPIRED` no historico. `PAUSED` bloqueia por ser reversivel (aluno retoma) -- exigir zero assinatura historica tornaria indesativavel justamente os planos mais usados. Reativacao **nunca e recusada** -- devolver a lista nao tira acesso de ninguem, so o desligamento tem guarda e usa variante destrutiva. **Guarda de uso nao replicada no cliente:** contar assinatura ali exigiria segunda chamada fora de transacao, abrindo janela para assinatura nova entre a contagem e o clique -- a guarda vive so no backend, onde a decisao e atomica. Dois canarios: guarda de uso desligada -- 1 teste de integracao cai; valor do formulario invertido -- 2 testes de componente caem (o erro mais perigoso: mandar o estado atual em vez do destino faria "Desativar" reativar, a tela responde algo mas o dado fica errado). Evidencia: integracao students-membership 49/49, unit admin-web 247/247, lint 9/9, typecheck 13/13. Sem migration |
| 24/08/2026 | — *(#185)* | — | [#186](https://github.com/RodReis/arenahub/pull/186) | `[FIX]`: **plano nao podia ser editado depois de criado.** Nem API nem tela: `POST /plans` criava e `PATCH /plans/:id/prices` reajustava o preco -- entre os dois, nada. Nome com erro de digitacao ficava; **unidade faltando ficava**, e plano sem unidade nao libera acesso em lugar nenhum (ADR-003), entao a unica saida era criar outro plano e migrar aluno na mao. `PATCH /plans/:id` substitui unidades e janelas **na mesma transacao** (`deleteMany` -> `create`), valida que toda unidade e do tenant, recusa **janela orfa** (janela apontando para unidade fora do plano) e grava `plan.updated` na auditoria. **Preco fica de fora de proposito** -- tem rota propria com historico de vigencia (INV-068), e edita-lo aqui apagaria a linha do tempo. **Assinatura existente nao muda, e a tela avisa em vez de bloquear:** o entitlement guarda um snapshot da politica copiado quando nasce, entao bloquear a edicao puniria o caso comum (corrigir plano novo) pelo caso raro; decisao do PI. **Dois canarios rodados e restaurados:** remover `tx.planAccessWindow.deleteMany` derruba 2 testes de integracao -- sem ele as janelas **acumulam** e a catraca libera nos dias que a operadora acabou de tirar; trocar `horaDoMinuto(360)` por `String(360)` derruba 1 de componente -- seria o campo de hora abrindo **vazio** e, ao salvar, apagando janela que ninguem tocou. Evidencia: lint 9/9, typecheck 13/13, **252 unitarios no admin-web**, integracao de membership **54/54**, OpenAPI regenerado (a rota declara `@ApiOkResponse`, nao entra na lista de debito do guard) |
| 25/08/2026 | — *(#188)* | — | *(PR pendente)* | `[FIX]`: **plano sem janela gerava direito de acesso que a catraca nega.** Quatro dos cinco planos da bancada tinham **zero unidade e zero janela**; atribui-los criava entitlement `ACTIVE` com `policySnapshot.janelas` vazio -- a ficha dizia que o aluno tinha acesso e a catraca negava, divergencia que so aparece com o aluno parado no totem. **Causa raiz no seed:** `prisma/seed.ts` criava plano com `name` e `description` apenas, escrevendo direto pelo client e **contornando o `min(1)` de unidade e janela que `POST /plans` exige** -- o unico plano criado pela tela (`Teste`, 24/08) tinha as cinco janelas. Tres frentes: (1) seed passa a gravar unidade e janela (seg-sex 06:00-22:00, o mesmo horario dos planos criados pela tela), com `deleteMany`+recria como ja fazem os beneficios; (2) guarda nova `PLAN_HAS_NO_ACCESS_WINDOW` (422) em `ativarAssinatura`, **antes da transacao** -- a API recusa criar plano assim, mas quem emite o direito e quem responde por ele; (3) script `fix:188` reemite os direitos ja quebrados. **Reemitir, nao dar `UPDATE` no snapshot:** o snapshot congela a politica do instante da concessao e e o que o motor replica ao explicar um acesso passado -- reescrever o campo faria a explicacao de ontem citar a regra de hoje; o script revoga e concede na mesma transacao, com motivo proprio, e os dois ficam visiveis na ficha. Idempotente e **simulacao por padrao** (`--aplicar` para valer); recusa reemitir se o plano continuar sem janela, para nao trocar um registro vazio por outro. **Achado ao rodar a suite inteira:** o teste novo criava plano direto no Prisma sem preco, e `devolve o preco vigente na listagem GET /plans` -- que exige preco em **todo** plano listado -- passou a falhar; contaminacao entre testes, corrigida dando preco ao plano do teste (so a janela deve faltar). RED confirmado antes do fix: a rota devolvia **201** e criava o entitlement inerte. Aplicado na bancada: 2 direitos reemitidos (Kamila Neves, Abigail Arruda), 0 restantes com snapshot vazio, e a ficha passou a mostrar 'Area Positiva -- Segunda a Sexta, 06:00-22:00'. Evidencia: unit 1524/1524, integracao 617/617, lint 9/9, typecheck 13/13, build 7/7, selfcheck 12/12. Sem migration -- o schema ja permitia o estado certo, quem o violava era o seed |
| 25/08/2026 | — *(#187)* | — | *(PR pendente)* | `[FIX]`: **sessao expirava em 10 minutos e o painel nunca renovava** -- toda Server Action falhava calada. `POST /auth/refresh` existia na API desde sempre e o admin-web nao o chamava em lugar nenhum; passados 10 min com a aba aberta, a API respondia `401 AUTH_REQUIRED` e a tela dizia "nao foi possivel atribuir o plano (AUTH_REQUIRED)" -- a recepcao lia como falha do plano. Foi o que originou o relato de "plano nao salva" (#188 era outro bug, achado na mesma investigacao). **Renovacao no `proxy.ts`, nao no `chamarApi`, por dois bloqueios reais:** (1) Server Component **nao grava cookie** -- o Next barra mutacao no render, entao renovar dentro de `chamarApi` valeria para uma requisicao e se perderia; (2) o refresh **rotaciona e detecta reuso**, e reapresentar um token ja rotacionado derruba a **familia inteira** de sessoes -- a ficha do aluno dispara cinco `chamarApi` em `Promise.all`, e cada uma reagindo ao proprio 401 faria quatro chegarem com token velho e **deslogariam o usuario**, trocando falha calada por expulsao. No proxy a decisao e uma so por requisicao, antes de qualquer chamada sair. **Renova ANTES de expirar** (margem de 1 min): esperar o vencimento deixaria uma janela em que a requisicao ja saiu com token morto. **Token ilegivel pede renovacao** -- nao da para saber quando expira, e o refresh decide; assumir "ainda vale" manteria a sessao quebrada em silencio, que e o proprio bug. Assinatura **nao** e conferida no proxy: so se decide QUANDO renovar, quem valida credencial e a API a cada chamada. A regra pura vive em `src/auth/sessao.ts` e nao ao lado do proxy porque o `include` do Vitest cobre so `src/**` e `app/**` -- teste na raiz seria coletado zero vezes e sairia verde sem rodar (ja aconteceu com o primeiro teste de Server Action). **Segunda frente:** `AUTH_REQUIRED` nao era traduzido por nenhum dos **nove** mapas `MENSAGEM` locais; a frase entrou em `src/auth/mensagem-de-sessao.ts`, espalhada nos nove por `...MENSAGEM_DE_SESSAO` no topo -- as frases especificas de cada action continuam vencendo, e o proximo mapa nao nasce sem a traducao. **Confirmado nos docs do Next instalado:** Server Action nao e rota propria, e um POST para a rota onde e usada, entao o proxy a cobre -- mas excluir um caminho do `matcher` tira a renovacao das actions dele junto. **Provado ao vivo com o mesmo estado de cookie:** API direto com access expirado = 401; painel com proxy = 200, ficha da Kamila renderizada e `Set-Cookie` dos dois tokens; refresh invalido = 307 para `/login` com cookies limpos; token valido = 200 sem rotacao desnecessaria. Overhead do proxy: 3-4ms sem renovar, 16-20ms renovando. Dois canarios: `AUTH_REQUIRED` removido do mapa -- 1 teste cai; renovar so no vencimento em vez da margem -- 1 teste cai. Evidencia: unit 1538/1538, integracao 617/617, lint 9/9, typecheck 13/13, build 7/7. **Fora de escopo, registrado:** o layout protegido continua sendo quem manda ao login -- o proxy nao duplica essa regra, para as duas nao divergirem |
| 25/08/2026 | — *(#191)* | — | *(PR pendente)* | `[FIX]`: **coluna PLANO em branco para quem TEM acesso.** A listagem mostrava `—` e a ficha do MESMO aluno exibia o direito ativo -- duas telas lendo fontes diferentes para a mesma pergunta: a lista lia assinatura, a ficha lia entitlements. `paraDtoDaLista` calculava `planName: assinatura?.plan.name ?? null`, e direito que nasce de **vinculo** (`COURTESY`, `EMPLOYEE`, `PERSONAL_TRAINER`, `DEPENDENT`, `PARTNER`, `CORPORATE`) **nao tem assinatura nenhuma** -- `subscription_id` nulo, `planName` nulo, celula vazia. Relatado pelo PI com uma personal trainer; o banco mostrou que eram **33 alunos** (24 funcionarios, 9 personal trainers). Importa porque a recepcao olha a LISTA para decidir se libera, e "sem plano" ali e resposta errada com cara de definitiva. **Campo proprio (`accessSource`), nao a origem enfiada em `planName`:** aquele promete NOME DE PLANO, e devolver `COURTESY` ali obrigaria a tela a adivinhar se a string e nome de um plano chamado assim ou enum a traduzir -- e as duas coisas se formatam diferente. A query ganhou `entitlements` no MESMO include (`take: 1`, `subscriptionId: null`, vigente agora), sem consulta por aluno -- o N+1 que `docs/REVIEW.md` §3.4 barra; o `agora` entra por parametro, como manda a convencao. No front, `planoDaListagem` reusa o `ROTULO_DE_ORIGEM` que a ficha ja usa, entao as duas telas passam a falar a mesma lingua. **Assinatura continua vencendo** -- quem tem plano ve o NOME ("Mensal Fit"), nao a palavra "Assinatura"; trocar isso pioraria o caso comum para consertar o raro, e ha teste travando. Origem desconhecida cai no proprio codigo, nunca em branco: enum novo na API viraria celula vazia, indistinguivel de "sem acesso". RED confirmado antes do fix (recebeu `null`). Tres canarios: `SUBSCRIPTION` sem nome deixando de virar `null` -- 1 teste cai; assinatura deixando de vencer -- 2 caem. **Verificado na tela** apos rebuild da API: a aluna passou a exibir "Personal trainer", 25 alunos da primeira pagina que mostravam `—` passaram a exibir a origem, e os 47 sem acesso seguem com `—`. Evidencia: unit 1544/1544, integracao de membership 53/53, lint 9/9, typecheck 13/13. **A suite de integracao COMPLETA nao foi medida localmente** -- crash nativo do Windows (3221226505) DEPOIS dos testes passarem, pre-existente e nao regressao; o CI (Linux) mede. Sem migration |
| 25/08/2026 | **F54** | SPEC-054 | *(PR desta entrega)* | **Painel financeiro gerencial: quanto entrou, quanto falta entrar, quanto esta vencido.** Rota `GET /api/v1/billing/summary?de&ate` agregando NO BANCO (`groupBy`/`aggregate`), e tela `/billing` -- a raiz estava vaga, `delinquency` e `reconciliation` ja moravam abaixo dela. **Duas decisoes do PI:** permissao **`billing.dashboard` NOVA** (§8, pergunta 3), porque `billing.read` e o que a recepcao usa para achar a fatura de UM aluno e o painel consolida o tenant inteiro -- mesmo criterio que ja separou `access.override`, `billing.payment.manual` e `billing.refund`; e receita esperada vinda do **plano matriculado**, nao da soma das invoices emitidas (no dia 1 do mes, antes do faturamento, a soma das invoices seria ZERO e o painel diria que a academia nao espera receber nada). 🔴 **O defeito que a fatia produziu e a revisao adversarial achou antes do PR: estorno parcial nao era descontado do recebido.** `EstornarPagamentoUseCase` so move o `Payment` para `REFUNDED` quando o estorno e TOTAL -- parcial deixa `CONFIRMED` com o `amountMinor` INTEIRO, de proposito, porque parte do dinheiro entrou mesmo. Somar `CONFIRMED` sem descontar fazia um pagamento de R$ 150 estornado em R$ 90 continuar contando **R$ 150**: o dono leria que entraram 150 quando entraram 60. E o **terceiro defeito de dinheiro do projeto com a mesma assinatura** -- o estado do registro nao conta a historia inteira (os dois anteriores: idempotencia derivada de contagem cobrando em dobro, e `createTokenizedSubscription` a cada invoice). Corrigido com `refund.aggregate` na janela, e o recebido virou LIQUIDO com `estornadoMinor` declarado ao lado -- devolver dinheiro nao e o mesmo que nao te-lo recebido. **Provado por mutacao:** restaurando `recebido._sum` sem o desconto, 1 teste cai. O abate usa `settledAt` do estorno e nao `paidAt` do pagamento: atribui-lo ao periodo do pagamento faria um mes JA FECHADO mudar de valor semanas depois, que e o que a janela fechada existe para impedir. **Janela `[de, ate)` com fim exclusivo e fechada**, pelo mesmo motivo da conciliacao da F16; default e o ultimo mes fechado, e vai ECOADA na resposta porque sem dizer qual periodo somou o gestor leria os numeros como "agora". **Nomes em portugues (`de`/`ate`) e nao `from`/`to` como a spec escreveu** -- as rotas vizinhas do mesmo controller usam `vencendoDe`/`pagina`/`tamanho`, e quebrar a convencao da API inteira nao paga o que custa. **Vencido NAO e recortado pela janela**, e a excecao e deliberada: divida de junho continua faltando em agosto, e recorta-la faria o numero ENCOLHER quando o gestor olhasse um mes mais recente -- o unico jeito de um painel de inadimplencia mentir para melhor. **Os tres riscos da §5 tratados:** serie com menos de tres pontos nao vira linha (`suficienteParaLinha`; com dois pontos a reta sempre parece tendencia, e a terceira e a primeira que pode CONTRARIA-la) -- e a base real nasce nesse estado, com um mes de dado; ausencia nunca e zero (`ticketMedio` e `taxaDeInadimplencia` devolvem `null`, a tela desenha `—`); e a base de calculo vai DECLARADA na tela, porque os ~340 ativados e os 1.926 importados como `CANCELLED` (ADR-033) distorcem qualquer percentual e uma taxa lida sem o denominador afirma sobre a ACADEMIA o que e verdade sobre a IMPORTACAO. **Agregacao no banco e nao em memoria como a F15**, e a diferenca tem motivo: la a fila de inadimplentes tem teto natural (academia com mil inadimplentes fechou), aqui o resumo olha todo o historico, que cresce um lote por mes para sempre -- carregar para somar no Node funcionaria por um ano e degradaria calado depois. **`/auth/me` passou a devolver as permissoes** (§7 exige esconder o item de menu de quem nao alcanca a rota) -- **sem consulta nova**: o `AuthGuard` ja monta o conjunto a partir do BANCO em toda requisicao, e o endpoint so le o que ja esta em memoria. Nao e controle de acesso: quem digitar a URL chega igual e o `PermissionsGuard` barra; esconder o item so evita oferecer tela que vai recusar. `permissions` ausente ESCONDE o item protegido -- errar para o lado de esconder e o unico erro barato ali. **Achado de fixture, e a regra que o causou e boa:** a primeira versao do teste de integracao criava duas invoices da mesma competencia na mesma assinatura e quebrava na unique `(tenant_id, subscription_id, billing_period)` -- **INV-066, a regra que impede cobrar o aluno duas vezes pelo mesmo mes**. O teste pedia o impossivel. **Fora de escopo, registrado:** a spec cita `docs/design/DS-PAINEL.md` como contrato da superficie e **esse arquivo nao existe** (`docs/design/` so tem PNGs) -- segui o padrao real da tela de inadimplencia, que e codigo vivo e mais confiavel que um doc ausente. **Revisao adversarial: 0 criticos, 0 altos, 1 baixo** (um comentario meu justificava a uniao das chaves da serie com um cenario IMPOSSIVEL pela maquina de estados -- `PAID` nunca vai para `CANCELLED`; codigo certo, justificativa ficticia, corrigida). Evidencia: lint 9/9, typecheck 13/13, unit 1400+ (24 no dominio novo, 13 na tela), **integracao 580/580 em 36 suites** com isolamento entre tenants e prova de que a consulta nao escreve, build 7/7. Sem migration |
| 25/08/2026 | — *(#196)* | SPEC-054 | [#197](https://github.com/RodReis/arenahub/pull/197) | `[FIX]`: **dois defeitos da F54 que só apareceram ABRINDO A TELA** com 858 invoices e 727 pagamentos de bancada — nenhum quebrava lint, typecheck, teste ou build. **(1) A série por competência nunca poderia comparar períodos.** Ela era recortada pela MESMA janela dos KPIs; como a janela é de um mês, a série tinha sempre EXATAMENTE UM ponto, e o aviso *"dado insuficiente para comparar períodos"* — escrito para proteger o usuário — ficava **permanente**. Um bloco que promete evolução (`SPEC-054` §3.2) e é estruturalmente incapaz de mostrá-la. O mesmo raciocínio já aplicado ao VENCIDO vale aqui: a série responde *"como os meses se comparam"*, não *"o que houve neste mês"*. Passa a olhar **12 meses para trás** a partir do fim da janela; competência POSTERIOR continua fora, porque incluir faturamento que o período escolhido não explica misturaria as duas leituras. Provado por mutação: restaurando o recorte, 1 teste cai. **(2) Escolher período não funcionava.** A página nunca lia `searchParams` — chamava `/billing/summary` sem parâmetro nenhum, caindo sempre no default do backend. O backend aceitava `de`/`ate` desde o início **com teste cobrindo**, e nada na tela os fornecia; a §7 da spec diz *"o gestor abre o painel, ESCOLHE O PERÍODO"*. A janela passou a vir da **URL**: período apurado é a primeira coisa que se manda ao contador ou ao sócio, e painel que só existe na sessão de quem abriu não se compartilha nem se recarrega. Sem parâmetro, quem decide continua sendo o backend — dois lugares decidindo a mesma janela é como elas divergem. **(3)** Concordância: `há uma competência apurada(s)`. 🔴 **Por que os testes não pegaram, e a lição:** eu os escrevi **afirmando o comportamento errado** — o teste da série usava fixtures dentro da janela, então passava com o recorte errado. Mesmo padrão dos defeitos anteriores do projeto: a fixture devolvia o formato certo por construção. **CI verde prova que o código compila e os testes passam; não prova que a tela existe para quem vai usá-la.** Duas causas de operação no caminho, ambas conhecidas e ambas repetidas: o servidor web servia código 49 min mais velho que o merge, e `billing.dashboard` estava no `seed.ts` mas **não no banco** — o seed nunca fora rodado, então o menu escondia o item e o filtro fazia o certo com o dado errado. Evidência: lint 9/9, typecheck 13/13, unit 11/11 tasks (15 na tela), integração **582/582 em 36 suítes**, build 7/7, e verificação na tela com as três competências e o período de agosto aplicado pela URL. Sem migration |
| 25/08/2026 | — *(sem issue — pedido direto do PI)* | — | [#198](https://github.com/RodReis/arenahub/pull/198) | `[INFRA]`: **o seed de demonstração passa a faturar três competências.** O painel financeiro da F54 abria **zerado** na bancada — `seed-demo.ts` criava alunos, dispositivos e eventos de acesso, mas nenhuma invoice e nenhum pagamento. Mesmo motivo pelo qual o arquivo existe: banco vazio não é bug, mas quem olha a tela não tem como saber a diferença, e painel zerado não deixa avaliar hierarquia, faixa de atraso nem quebra por forma de pagamento. **Estende o script que já existe em vez de criar um segundo ao lado:** um `seed-demo` e um `popular-financeiro` seriam dois lugares decidindo o que é "dado de demonstração", e divergiriam na primeira mudança de schema. **Decisões:** *três* competências, porque o bloco de evolução só desenha tendência com 3 pontos — com duas ele mostra "dado insuficiente", estado correto que não deixa julgar o bloco; **meses relativos a hoje**, nunca datas cravadas, porque script com data fixa envelhece e passa a produzir competência que o painel considera antiga; **determinístico por hash (djb2)** e não `Math.random()`, porque semente que muda a cada execução faz a tela mudar embaixo de quem avalia layout e dois desenvolvedores veriam números diferentes no "mesmo" banco; **todas as assinaturas ativas** e não só os 12 alunos `DEMO-`, porque os ~286 ativados do Pacto são o volume real que o painel soma; e proporção de pagas **decrescente** (92/88/74) com mix PIX > cartão > espécie (ADR-032), porque proporção constante faria as três barras iguais e a série viraria uma reta. **Idempotente pela unique `(tenant, subscription, billing_period)`** — INV-066, a regra que impede cobrar o aluno duas vezes pelo mesmo mês; medido: 1ª execução 885 invoices e 723 pagamentos, **2ª execução 0/0** com o total inalterado. **Origem:** nasceu de um SQL de bancada que rodei para o PI ver o painel com movimento; ele pediu que virasse script do repo, e a convenção daqui (`fix-188`, `seed-ativos`, `import-pacto`) é TypeScript com Prisma, não SQL cru — sobrevive a mudança de schema. Evidência: `pnpm db:demo` conferido no banco (mai 263/295, jun 260/295, jul 200/295 pagas; PIX 416, cartão 210, espécie 97) e **na tela**, com as três competências e sem o aviso de dado insuficiente. lint 9/9, typecheck 13/13, unit 11/11 tasks. Sem migration; não toca no `seed.ts` base, que roda no `pretest` das suítes |
| 25/08/2026 | **F54** *(UX/UI)* | SPEC-054 | [#199](https://github.com/RodReis/arenahub/pull/199) | **Painel financeiro: gráficos, filtro de mês e metade do scroll.** Pedido do PI, medido antes e depois. **O scroll caiu de 2,1 para 1,17 telas a 1280px** — o monitor que o `PRODUCT.md` nomeia como real, e onde o mesmo documento trata densidade como funcionalidade (*"cada pixel de respiro decorativo custa uma linha a menos na tela e um scroll a mais com o aluno esperando"*). 🔴 **A versão anterior era literalmente a anti-referência que o documento lista** — *"sidebar + grid de cards uniformes + KPI gigante"*. Três cortes medidos: faixa única de KPI (404px → **117px**), duas colunas para "onde parou"/"por onde entrou" (~380px empilhados → lado a lado) e tabela recolhida em `<details>` (~300px). A tabela recolhida **não perde acessibilidade**: o `SerieFinanceira` publica tabela invisível própria, então a regra *"todo gráfico tem tabela equivalente no DOM"* continua cumprida — o que sai é a repetição visível. Piso da grade de KPI em **155px** porque a área a 1280px tem 974px e são seis indicadores; com 190px cabiam cinco e o sexto descia sozinho, deixando um vão de quatro colunas (medido no navegador, não escolhido). **Filtro de mês, que não existia:** o período só era alcançável digitando ISO 8601 na URL. Chips derivados da **série que o backend já devolve**, nunca de calendário inventado — oferecer mês sem movimento levaria a uma tela vazia que parece defeito. Cada chip é `<a>` e não `<button>`: período apurado é a primeira coisa que se manda ao contador, e estado em memória não se compartilha nem se recarrega. ⚖️ **DECISÃO DO PI SOBRE COR, registrada como emenda ao `PRODUCT.md`:** o documento restringe cor a papel (accent=ação, carbono=estrutura, semântico=estado) e o PI pediu a tela viva **ignorando a restrição**. Implementado com o **semântico em peso** — superfície tingida por estado via `color-mix`, que o próprio `semantic.json` já previa (`bgAlpha: 0.10`) e o `StateBadge` já usava; **nenhum token novo**. **Dois limites mantidos, e não por gosto:** superfície tingida com o accent do TENANT faria "ativo" e "erro" virarem a mesma cor num tenant de accent vermelho (Princípio 5), e cor como único canal é proibição de PRD. O teste de contraste **falha o build** (`M1-NFR-008` + 3 NFRs), então paleta reprovada não chegaria a ser entregue. 🔴 **Três defeitos achados olhando a tela, nenhum pego por lint/typecheck/teste:** (1) o eixo do gráfico **mentia** — `Math.round` em 44.400 dava `45k`, afirmando R$ 45 mil onde há R$ 44,4 mil, que num gráfico de dinheiro é o que faz alguém conferir e desconfiar da tela inteira; (2) "Não entrou" aparecia na legenda com marcador de LINHA, prometendo uma curva que não existe — é a área entre as duas já listadas; (3) rótulo com valor+percentual+contagem estourava a barra e quebrava em duas linhas. **Componentes novos no DS:** `SerieFinanceira` (duas séries, com a área entre as curvas sendo a inadimplência do mês — **não** estende o `SerieDeMedidas`, que plota uma medida, serve a F18 e discorda no eixo Y: lá o zero é desperdício, aqui é obrigatório porque a área comunica), `Sparkline` (`aria-hidden` sem alternativa textual, e é correto — a série que ele ilustra já está publicada na tabela da mesma página) e `formatarDinheiro`/`percentualDoTotal`, que nasceram de um bug meu: a tela formatava com `toFixed(2).replace('.', ',')` e desenhava `R$ 12000,00` sem separador de milhar. Evidência: lint 9/9, typecheck 13/13, unit 11/11 tasks (**32 na página**, 10 novos), build 7/7, integração 26/26 nas suítes afetadas e **CI verde nos dois jobs**. Sem migration; backend intocado |
| 25/08/2026 | — *(#200)* | SPEC-054 | [#201](https://github.com/RodReis/arenahub/pull/201) | `[FIX]`: **o filtro de mês perdia os outros meses ao apurar o mais antigo.** Visto pelo PI na tela: clicar em `mai/2026` deixava UM chip só, sem caminho de volta para junho. 🔴 **A causa é um erro de projeto, não um descuido:** o filtro derivava de `serie.pontos`, e a série é recortada em 12 meses PARA TRÁS a partir do fim da janela — o que está correto **para ela**. Apurando maio, `ate` vira 01/06 e jun/jul ficam fora. Medido na API antes de corrigir: `julho → serie: 05,06,07` mas `maio → serie: 05`. **Uma fonte servindo duas perguntas diferentes:** *"como chegamos até aqui"* (a série) DEPENDE da janela; *"que períodos existem para escolher"* (o filtro) NÃO depende. Amarrar a segunda à primeira fazia o filtro encolher junto com a leitura — e um filtro que some conforme você o usa é um beco. **Correção:** campo `competenciasDisponiveis` no `GET /billing/summary`, sem recorte de janela (`groupBy` sem `where` de data — o conjunto é uma linha por mês de faturamento do tenant, algumas dezenas na vida do produto). A série NÃO muda. **Provado por mutação:** religando `competenciasDisponiveis` à série, 1 teste de integração cai. Verificado na tela: mai → jun → jul navegável nos dois sentidos, três chips presentes em todas as janelas. **A lição repete a do FIX #197:** os dois defeitos desta fatia foram achados abrindo a tela, nenhum quebrava lint/typecheck/teste/build — e nos dois casos o teste que eu tinha escrito passava porque afirmava o comportamento errado. Testes: 24 de integração (3 novos — o caso do PI, isolamento entre tenants, exclusão de DRAFT/CANCELLED) e 33 na página (1 novo, que cai se alguém religar o filtro à série). Evidência: lint 9/9, typecheck 13/13, unit 11/11 tasks, build 7/7, **CI verde nos dois jobs**. Sem migration |
| 25/08/2026 | — *(#167)* | — | [#202](https://github.com/RodReis/arenahub/pull/202) | `[FIX]`: **o boundary do painel assertava o tipo da resposta em vez de validar.** O genérico de `chamarApi` é asserção, não validação: divergência de contrato passava calada pelo compilador e explodia dentro da árvore de render — `prices` ausente virou `Cannot read properties of undefined (reading 'length')` em `/plans`. O padrão estava em **59 chamadas, 24 arquivos**. `validarResposta` (função pura em `src/api/`) recebe schema Zod e devolve `ProblemDetails` com código estável `RESPONSE_CONTRACT_MISMATCH`, com o **caminho do campo** que divergiu no título e **nunca o valor recebido** (pode ser PII). O parâmetro `esquema` é **opcional de propósito**: sem ele o comportamento é o de hoje, e a migração das telas é incremental — `/plans` migra aqui e serve de prova. A tela deixou de sobrescrever o título quando o código é de contrato: *"sem permissão"* mentia sobre a causa e jogava fora a frase útil. 🔴 **Duas armadilhas de verificação no caminho.** (1) O `include` do vitest **não coleta `lib/**`** — o teste natural, ao lado do `server-client`, sairia **verde ignorado**; por isso a lógica é função pura em `src/api/`. (2) O teste existente da página **mocka `chamarApi` inteiro**, então o schema nunca executa e ele **não distingue "validou" de "não valida nada"** — o teste novo roda `chamarApi` de verdade, com dublê só em `fetch` e `next/headers`. Provado por mutação: neutralizar o `safeParse` derruba 3 de 4 unitários, e remover o `esquema` da chamada **reproduz o TypeError exato da issue**. 📌 **Achado colateral:** o `Estado atual` do `TESTS.md` estava defasado em **77 testes unitários e 28 de integração** — as entregas #199 e #201 não regeraram o relatório. A baseline real da `main` hoje é 1621/645; esta entrega leva a 1627/645. |
| 25/08/2026 | — *(#204)* | — | [#205](https://github.com/RodReis/arenahub/pull/205) | `[INFRA]`: **menu ganha o grupo Financeiro e rótulos de seção diferenciados.** Pedido do PI. Cobrança, Conciliação e Painel financeiro estavam soltos no meio da lista, e a leitura de relance não dizia que eram a mesma família. A ordem dentro do grupo segue a **frequência**, não o organograma: Cobrança é diária, Conciliação é mensal, Painel é gerencial. O rótulo se separou do link por **tracking** (0.04 → 0.08em), respiro (16 → 24px), marcador de accent de 2px na calha e régua de 1px fechando o grupo anterior — **sem `opacity`**, que já foi tentado e reprovou o axe em todas as telas (3.70 contra o mínimo de 4.5). O `NavLink` ganhou marcador de posição e transição de 120ms: fundo a 14% sobre chrome é sutil demais com brilho baixo no balcão. 🔴 **O defeito latente que apareceu ao escrever:** o rótulo mora no item que ABRE o grupo, e "Financeiro" **já contém** um item com `exigePermissao`. Bastava reordenar para o rótulo morar num item que some — e os irmãos ficariam órfãos **só para quem não tem a permissão**, invisível para quem revisa o PR. `reancorarGrupos` devolve o rótulo ao primeiro sobrevivente; mora no layout, não no `Navegacao`, porque só lá a lista completa existe. 📏 **Medido na tela, não estimado:** o marcador do rótulo preenchia 87% da sua caixa contra 67% do item ativo — o secundário gritava mais que o "você está aqui"; aos 4px de recuo cai para 50%. E o modo faixa (abaixo de 1280px) precisou de bloco próprio: a régua girada caía a 8px do marcador, dois traços colados dizendo coisas diferentes. ⚠️ **Pré-existente, medido na `main` e NÃO corrigido aqui:** no modo faixa "Eventos de acesso" quebra em três linhas e leva o link a 193px. Não é o agrupamento que causa. **Provado por mutação:** o teste exercita `reancorarGrupos` no arranjo perigoso (rótulo no item COM permissão) — pelo menu de hoje ele passaria verde com a função removida. 8/8 no E2E de axe, incluindo zoom 200%. |
| 25/08/2026 | **F56** | SPEC-056 | [#203](https://github.com/RodReis/arenahub/pull/203) | **Plano com assinatura mensal.** Assinatura vira **modalidade de plano** (`Plan.billingMode`), não motor de cobrança terceirizado — ADR-043, Decisão 2. O calendário, o valor, a carência e o bloqueio continuam do ArenaHub; o que muda é existir método salvo e autorização para cobrar sem o aluno agir. **`Subscription.externalSubscriptionId` nasce aqui** — a fonte que o `CancelarRecorrenciaUseCase` esperava desde 25/08 (Decisão 5): ele deixa de devolver zero fixo e passa a cancelar de verdade, aqui e no provedor. A adesão é o **único** lugar que chama `createTokenizedSubscription`, e valida na ordem em que o operador consegue agir — modalidade, status, preço vigente, **CPF** (Decisão 3), cartão, aceite —, porque quem está no balcão age pela PRIMEIRA recusa. O ciclo (`RodarCicloDeAssinaturasUseCase`) gera a invoice do período e cobra sozinho, **sem calendário novo**: reusa `ciclo-de-cobranca`, `BillingRepository` e o retry da F14. 🔑 **Três decisões do PI em 25/08:** ciclo completo (gerar **e** cobrar, não só cobrar); avisos **visíveis no painel** em vez de canal externo — não existe infra de notificação no sistema, e criá-la é decisão própria; e construção contra o `FakePaymentProvider`, já que a F55 espera credencial (trocar é um `useClass`). 🔴 **O defeito que o compilador pegou e um `string` não pegaria:** `OVERDUE` é o nome do vencido no `InvoiceStatus` — **não** `PAST_DUE`, que é do lado da ASSINATURA. Os dois vocabulários convivem, e trocar um pelo outro pularia calada justamente a invoice vencida, que é a que mais precisa ser cobrada. 🔴 **O achado da revisão adversarial do próprio PR:** a adesão chama o provedor **antes** de gravar — ordem oposta à da cobrança —, e morrer no meio deixaria recorrência viva sem nada apontando para ela (a Decisão 5 por outra porta). O código já estava certo, mas **dizer não é provar**: o que fecha a janela é a chave `sub:<id>` derivar da assinatura, e agora há teste. **Provado por mutação, não por leitura:** filtrar o ciclo por MODALIDADE em vez de por CONSENTIMENTO passa em 4 dos 5 testes e falha exatamente no que importa — cobraria cartão de quem nunca autorizou; instabilizar a chave de idempotência derruba concorrência **e** recuperação. 📌 **Fora de escopo, dito:** canal de aviso de reajuste e de cartão vencendo. `cartaoVenceEm` responde a pergunta e a ficha mostra; quem avisa o aluno é a recepção. |
| 25/08/2026 | **F49** | SPEC-049 | *(preencher após o merge)* | **Kiosk seguro, provisionamento e sessão efêmera.** A superfície `apps/kiosk` nasceu (o diretório estava vazio): quatro modelos Prisma, HMAC de dispositivo copiado do `edge-auth`, contrato inteiro de `KioskConfiguration` em três camadas, sessão efêmera de 60 s com `tokenHash` no banco, tokens do totem em 7:1, três telas e o E2E que prova a limpeza. **A área interna sai com zero dos seis módulos do DS §5.2, de propósito** — o aceite é isolamento e limpeza, não funcionalidade. **ADR-045** registra o regime de identificação (CPF sozinho, facial em backlog) e os dois riscos que o PI aceitou. 🔴 **Achado da implementação:** a ponte Node que assina as chamadas escutava em `0.0.0.0` e, com a rede da academia não isolada, permitia enumerar a base inteira do tenant sem tocar no totem — corrigido para loopback, e o ADR-045 condiciona a decisão do PI a ele. **Este é o primeiro PR a reordenar a fila do §4:** MVP 3.5 antes do MVP 4, tarefa que o ADR-042 atribui a esta fatia |
| 26/08/2026 | **F44** | SPEC-044 | [#210](https://github.com/RodReis/arenahub/pull/210) | **Design system da superfície `kiosk`.** A fatia **inverteu a própria premissa**: o ADR-025 a criou com gate (*"o PI priorizar o MVP 4"*) e o risco escrito de *"componente sem consumidor"*, mas o ADR-042 antecipou o totem e as **F49–F52 construíram `apps/kiosk` inteiro antes**. O DS nasceu destilado das telas; sobrou para a F44 **o que ficou de fora**. 🔴 **O defeito que motiva a fatia:** `avisoSonoroNaRecusa` existia no contrato desde a F50 **ligada por padrão**, com checkbox no painel, e **nenhuma linha do kiosk lia o campo** — a academia marcava a caixa e o totem seguia mudo. Mesmo padrão da análise de IA e do OCR de ECG na F51: contrato e tela existem, recurso nunca executou. Som **sintetizado** (`AudioContext`, 440→330 Hz, volume 0.08), sem asset: `<audio src>` exigiria arquivo e esbarraria no autoplay, porque a recusa nasce de **resposta de rede**, não de gesto; grave e baixo porque a recepção tem **fila atrás**. 🔴 **Defeito pego na sondagem, que a revisão não bloqueou:** `Number()` entende notação de literal JS — `"0x10"` desenhava anel de **16% sobre dado de saúde**, `"1e3"` saturava no cheio. O campo é texto livre do **aparelho**, não código; guarda por regex entrou assim mesmo (regra de arquitetura 8), **provada por canário** — sem ela, 6 testes caem. ⚠️ **Dois defeitos que só a tela revelou, com 155 testes verdes:** a forma angular §3.3 saiu como **tarja cortando a headline** (`inset: 0` numa caixa baixa e larga) e depois como **bloco invadindo o card** — só alta e estreita a diagonal se lê como diagonal. **Defeito visual é invisível para teste de comportamento.** A **moldura §3.1 só existe onde o equipamento não está**: acima de 1080px aparece, na tela real vira `display: contents` — no gabinete ela roubaria 2px úteis e duplicaria a moldura **física** de metal; verificado no navegador (a 1080px a `.tela` mede 1080 inteiros). O anel §3.12 **recusa desenhar o que não sabe ler**: o DS mostra `80 PONTOS` e **nunca diz de quanto** — escala 100 assumida em `ESCALA_DA_PONTUACAO`, degradando para texto. `data-decorativo` **já esperava**: a regra de alto contraste foi escrita na F51 sem nenhum elemento que a acionasse. 📌 **Fora, e dito:** tela pública da catraca — era o `§8` na spec antiga e a **v2.0 apagou a seção**; sem contrato vigente, é decisão de produto |
| 27/08/2026 | **F30** | SPEC-030 | [#211](https://github.com/RodReis/arenahub/pull/211) | **Preferências e identidade pública, no totem — ADR-046.** A Slice 5.1 previa "app" e o gate do MVP 5 exigia *"eventos confiáveis + app do MVP 4"*; nenhum dos dois existe. Três decisões do PI em 26/08: a superfície é o `apps/kiosk`, o gate do MVP 5 **não alcança** esta fatia (F31–F35 continuam atrás dele) e o consentimento de ranking vira **opt-out** — alunos já aceitos e autorizados participam por padrão, quem não quiser pede para sair. **O ponto perigoso da fatia:** a mesma tabela `ConsentRecord` passa a guardar dois regimes opostos de ausência de linha — biometria/saúde/IA continuam **não autorizado**, engajamento vira **participa** — e os predicados vivem separados de propósito (`participacao.ts` × `consentimento.ts`) para que unificá-los não inverta um dos dois em silêncio. `resolverExposicao()` é o ponto único que decide quem aparece e com que nome: aluno inativo vence opt-out, que vence a escolha de identidade, e apelido fora de `APPROVED` nunca vaza (INV-153 a INV-155). Unicidade de apelido em **índice parcial sobre `APPROVED`** — dois `PENDING` com o mesmo alias coexistem, só um chega a aparecer. **Dois cortes deliberados:** `HIDDEN` nasce sem caminho de escrita (espera a F35, canal de denúncia) e não há outbox nem cache de exposição (espera a F33, primeiro consumidor). 🔧 **Cinco falhas de fiação, e nenhuma achada por revisão de diff.** `EngagementModule` fora do `AppModule` e sem declarar `TenantContextService` (esta derrubava as 46 suítes de integração no boot); a ponte do totem sem exportar `PATCH` — **o opt-out não funcionava**; a fila lendo campo que a API não enviava (TypeError no SSR); e o painel sem listar `ranking`, que só ligava por SQL. Todas corrigidas antes do merge. Duas vieram de teste de integração, uma da geração de evidência e duas só apareceram **abrindo a tela** — atravessam processo (navegador → Next → Nest, e Nest → Next SSR), onde `fetch` e `chamarApi<T>` são casts que nenhum compilador confere |
| 28/08/2026 | **F32** | SPEC-032 | [#214](https://github.com/RodReis/arenahub/pull/214) | **Consistência e streak, derivados — nenhuma tabela nova.** O plano previa cinco tabelas de projeção; nenhuma foi criada. `StudentAttendanceSession` (F24) **já é** a projeção de dias treinados, deduplicada por `(tenant, aluno, dia local, unidade, política)` num índice único, e o streak é função dela — materializar criaria fonte de verdade paralela com rebuild próprio, capaz de divergir, exatamente o que a F31 evitou derivando o placar ao vivo. Consequência: a *"prevenção de múltipla pontuação diária"* da Slice 5.3 **não virou código** aqui — é o índice da F24, no banco. **Três decisões de regra, e a ordem é o desenho:** a meta vence a pausa (quem treinou pausado ganha a semana — a ordem inversa puniria quem a fatia quer premiar); a pausa isenta a semana inteira ou nada (parcial daria isenção de graça); e a semana corrente é `EM_ANDAMENTO`, nunca perdida — senão toda segunda de manhã zeraria o streak de todo mundo. A pausa vem da **timeline**, não de `Subscription.status`: o status é o estado de hoje, e `M5-FR-009` precisa da pausa de agosto com a assinatura ativa agora. 🔧 **Duas armadilhas do ambiente, ambas já registradas e ambas repetidas:** a API servia **build de 25/08** (`/health` em 404, a tela teria mentido sobre a fatia); e o gerador de evidência **herdou o número anterior** quando o crash do Jest no Windows matou a saída — a integração foi medida suíte a suíte (698/698 + 60/60). ⚠️ **A única falha real só apareceu na suíte completa:** isolada, `xp-e-ranking` dava 25/25; a suíte inteira acusou o snapshot OpenAPI desatualizado. `ATUALIZAR_OPENAPI=1` **não** está no `globalEnv` do Turbo — tem de ir direto ao Jest, senão some calada |
| 28/08/2026 | — *(#212)* | — | [#217](https://github.com/RodReis/arenahub/pull/217) | `[INFRA][FIX]`: **o totem nao abria em desenvolvimento, e as duas superficies web brigavam pela 3000.** Dois defeitos de ambiente, ambos pre-existentes, ambos invisiveis ao CI. **(1) `apps/kiosk` nao carregava o `.env` da raiz:** `GET /config` e `POST /heartbeat` respondiam **500** com `KIOSK_KEY_ID e KIOSK_SECRET sao obrigatorios`. O `pretest:e2e` do MESMO pacote ja carregava a raiz (`--env-file-if-exists`) e o `dev` nao -- e foi essa **assimetria** que deixou o defeito passar: a suite E2E injeta as `KIOSK_*` pelo `webServer.env`, entao o CI ficava verde com a tela quebrada. Tres implementadores esbarraram nisso ao abrir a tela. **A correcao foi para o `next.config.ts`, nao para o script `dev`:** a flag `--env-file-if-exists` e do **Node**, e `next dev` e um bin proprio -- passa-la exigiria invocar o entrypoint do Next por caminho hardcoded (`node --env-file-if-exists=... ./node_modules/next/dist/bin/next dev`), que quebra na primeira mudanca de layout do pacote. O `next.config.ts` roda antes do servidor subir e ja e o padrao daqui (`admin-web/playwright.config.ts` usa o mesmo `process.loadEnvFile`). `loadEnvFile` **nao sobrescreve** o que ja veio do ambiente, entao E2E, CI e producao seguem mandando. **(2) Colisao na 3000:** nenhum dos dois apps fixava porta, os dois caiam no padrao do Next, e o segundo a subir ia para **3001 calado** -- e ai a ponte assinada do totem passa a apontar para o lugar errado. O `CLAUDE.md` manda *"colisao vira decisao registrada, nunca troca silenciosa"*, mas a mesma linha dizia *"demais apps na porta padrao do framework"*: **era a regra que causava a colisao**, e ela foi corrigida junto. Painel fixa **3000** (o que a `playwright.config.ts` dele e o `setup.mjs` ja assumiam sem ninguem garantir); totem fixa **3210**, a **mesma do E2E** -- o totem tem uma porta so, em vez de uma em dev e outra em teste. O `--hostname 127.0.0.1` do totem foi preservado: e decisao de seguranca (a rede da academia nao e isolada; sem loopback qualquer host da LAN enumera a base do tenant pelo `POST /api/kiosk/sessions`). O `setup.mjs` tambem mentia por omissao -- anunciava que `pnpm dev` sobe *"API e admin-web"* quando sobe tres apps. 🔴 **Nenhum teste cobre isto, e nao ha teste a escrever:** o defeito vive no script `dev`, e **teste nao sobe o `dev`** -- foi exatamente por isso que ele sobreviveu. A verificacao e a execucao real, e foi feita: os **tres processos de pe ao mesmo tempo** (`netstat`: 3000, 3210 loopback, 3344), **sem 3001**; `GET /api/kiosk/config` saiu de **500** para **200** devolvendo a configuracao publicada (versao 6); e a tela do totem aberta no navegador -- hero, reel do Instagram e o botao da area do aluno, console limpo exceto `favicon.ico` 404, pre-existente e fora de escopo. **Como se sabe que o fix e o que resolveu, e nao a API ter subido junto:** com a API ainda fora, o erro do totem **mudou** de `KIOSK_KEY_ID e KIOSK_SECRET sao obrigatorios` para `ECONNREFUSED` -- as variaveis ja tinham chegado, faltava so o destino. Evidencia: lint 10/10, typecheck 14/14, unit 12/12 tasks. Sem migration. Toca so `package.json` das duas superficies, `next.config.ts` do kiosk, `scripts/setup.mjs` e a linha de portas do `CLAUDE.md` |
| 28/08/2026 | — *(#212)* | — | [#218](https://github.com/RodReis/arenahub/pull/218) | `[INFRA]`: **a guarda de porta passa a valer para as duas superficies web.** Complemento do #217, achado ao revisar o proprio fix: `scripts/check-port.mjs` existe desde o bootstrap e implementa exatamente a regra do `CLAUDE.md` -- *"se ocupada, falha em vez de trocar"*, porque *"framework que cai na porta seguinte sozinho produz o pior cenario: dois processos servindo, o operador falando com o errado e o log saindo no outro"* -- mas **so a API a chamava**. O #217 deu porta fixa ao painel (3000) e ao totem (3210); sem a guarda, `-p` numa porta ocupada faz o Next **trocar sozinho** e o sintoma volta pela porta dos fundos, agora com a agravante de parecer resolvido. Uma linha em cada `dev`, o mesmo padrao que a API ja usa. **Provado nos dois estados, com a porta de verdade:** 3210 ocupada por um socket em `0.0.0.0` -> `pnpm dev` do totem falha com **exit 1** e a mensagem que manda encerrar o processo ou registrar a colisao com o PI; 3210 livre -> exit 0. A guarda testa as **duas interfaces** de proposito (comentario no proprio script): bind em `127.0.0.1` tem sucesso mesmo com a porta ocupada em `0.0.0.0`, que e como Docker e a maioria dos servicos bindam -- guarda que so olhasse o loopback passaria verde no caso comum. Evidencia: lint 10/10, typecheck 14/14, unit 12/12 tasks. Sem migration; toca so os dois `package.json` |
| 28/08/2026 | **F34** | SPEC-034 | *(PR desta entrega)* | **Desafios e notificacoes -- e o dia em que o opt-in do PRD caiu.** A fatia rodou antes do gate pelo **ADR-048** (mesmo argumento do ADR-047: app nao existe, eventos confiaveis existem), e **duas emendas do mesmo dia mudaram o desenho enquanto ela era construida**. 🔁 **A emenda 1 inverteu a Slice 5.5.** Escrevi o dominio inteiro em opt-in, com canario provando que ausencia de linha significa NAO INSCRITO -- o oposto de `participaDoRanking()`. Ai o PI viu a tela com `0 inscrito(s)` num desafio recem-aberto e decidiu o contrario do PRD: ao abrir, **todo aluno `ACTIVE` com entitlement `ACTIVE` entra**. Emenda a Slice 5.5 e o `M5-BR-001` **so para desafio**. Elegibilidade le a **mesma cadeia da catraca**, nao um segundo conceito de "aluno em dia" que possa divergir. Tres pontas fechadas pelo PI: inadimplente **continua** (desafio e engajamento, nao cobranca), o aluno **pode sair**, e **quem saiu nao e reinscrito** -- a linha `LEFT` existe para isso. Medido ao vivo: 293 inscritos e 293 avisos, batendo com a contagem independente. 📺 **A emenda 2 levou o desafio para a tela publica** como *sexto tipo de bloco do carrossel*, nao slot novo: a grade do hero tem **seis composicoes fechadas** numa tela de 1080x1920 que nao rola, e um setimo slot dobraria a tabela para doze. O bloco **nao carrega o desafio** -- so o titulo do cartao, como o de INFORMACOES; congelar a campanha numa versao publicada obrigaria a republicar a config a cada desafio novo. Sem nome de aluno e **sem contagem de inscritos**: com inscricao automatica o numero e a base inteira da academia, e ha teste provando que o schema DESCARTA `studentId` e `inscritos` se escaparem do servidor. ⚠️ **Tres defeitos de fatias ANTERIORES achados no caminho, nenhum visivel ao CI.** (1) O modulo `xp` (F31) **nunca entrou na lista de modulos configuraveis do painel** -- a tela *Meus pontos* e o **placar publico no hero** existiam desde a F31 e so podiam ser ligados por escrita direta no banco. Era esta a causa de *"nem o ranque"*, e eu havia concluido errado que o bloco de ranking nao existia: ele estava la, faltava o modulo. (2) A **allowlist da ponte do totem** (`rotas-da-ponte.ts`) recusava as rotas novas **antes de assinar**, com 404 generico -- a rota existia na API, o modulo estava ligado, a tela renderizava. Nenhum teste da API pega a falta de uma linha ali, e o comentario novo diz isso com todas as letras. (3) O botao usava `botaoPrimario`, classe que **nao existe** no `globals.css` do totem -- classe inexistente e HTML valido, entao o botao renderizava sem estilo, parecendo campo de texto. 🔴 **E um defeito meu, relatado pelo PI:** a tela listava **so o desafio criado na sessao** (`estadoCriar.sucesso`), entao um refresh o fazia sumir e o rascunho ficava **inalcancavel para abrir** -- o dado sempre esteve no banco. Eu havia cortado a listagem alegando Slice 5.6; sem ela a tela mente sobre o proprio efeito. 🗂️ **Menu e telas reorganizados a pedido do PI:** grupo **Totem** (Personalizacao, Engajamento, Moderacao de apelido) na ordem da DEPENDENCIA, e `Placar e XP` + `Desafios` viraram **abas** de `/engagement` -- eram dois itens de menu para um trabalho so. 🛡️ **Editar, excluir e cancelar, com as guardas que a regra exige** (opcao 1 do PI): participante trava editar (mudar a meta altera o combinado depois do aceite, `M5-BR-009`) e trava excluir (FK `onDelete: Cascade` apagaria a adesao e o aviso, contra `M5-FR-014`); para esse caso existe **cancelar**, que preserva tudo. A tela **esconde** os botoes impossiveis em vez de mostra-los falhando. **Confirmacao inline obrigatoria** nas duas destrutivas -- relatado pelo PI (*"esta excluindo direto sem msg de confirmacao"*), com verbo real (`DS-PAINEL.md` §6), foco em *Voltar* e Esc para desistir. 🧪 **Migration sem reset:** o `prisma migrate dev` exigiu resetar o banco (migration da F21 alterada apos aplicada) -- gerei por diff contra um shadow temporario e removi **a mao** a divida pre-existente que o diff arrastava (`DROP DEFAULT` em 6 tabelas, FKs de `public_profiles`, rename de indice). Uma migration chamada "F34" nao deve mexer em perfil publico. **Canarios (11):** opt-in virando opt-out derruba 3 no dominio e 3 no totem; voltar a listar so o da sessao, 4; excluir no primeiro clique, 6; mostrar editar com inscrito, 1; remover a linha da allowlist, 1; e mais borda de janela, teto por semana, ordem do desfecho e aviso ja lido. **Evidencia:** lint 10/10, typecheck 14/14, unit 12/12 tasks (1182 API, 411 painel, 234 totem, 63 contracts). Verificado na tela nas duas superficies e na resolucao real do totem (1080x1920, sem rolagem) |
