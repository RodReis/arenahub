# DEVELOPMENT.md — ordem de execução do ArenaHub

> **Dono deste arquivo: Claude Code.** Atualize a cada entrega, junto com `docs/STATUS.md`.
>
> `STATUS.md` responde *"em que pé está?"*. **Este arquivo responde *"o que faço agora, e em
> que ordem?"***. Os passos de uma fatia moram aqui — **nunca** viram issue separada
> (`card = fatia`).

**Estado em 14/08/2026:** nada implementado. Os seis cards `[INFRA]` de bootstrap existem
([#42](https://github.com/RodReis/arenahub/issues/42)–[#47](https://github.com/RodReis/arenahub/issues/47),
ADR-023), todos em Backlog. O board em si continua pendente — ver §4.

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
| `test:integration` | a primeira fatia com repositório e Testcontainers — **F6** |
| `test:e2e` | a primeira fatia com tela navegável ponta a ponta — **F9** ou **F11** |

Deixar na lista depois que o workspace existir transforma verde em decoração. **Quem criar o
workspace promove a task no mesmo PR** — foi o que a F1 fez.

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
| ✅ F2 | 0.2 Ciclo de vida facial | cadastrar, atualizar e remover identidade no leitor, com confirmação | — *(adapter real entregue; falta só o aceite na bancada)* |
| 🟡 F3 | 0.3 Catraca e passagem | abrir catraca e **confirmar giro**; medir latência ponta a ponta | **adapter entregue**; falta a **ponte Windows** e a janela combinada |
| F4 | 0.4 Offline e reconciliação | comportamento com link derrubado; eventos não se perdem | hardware |
| F5 | 0.5 Relatório e decisão | decisão de saída do MVP 0 (`MVP-00` §15) com evidência: `GO`, `GO_WITH_CONSTRAINTS` ou `NO_GO` | F1–F4 |

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
> **A forma da ponte é decisão do PI** (serviço .NET com stdio? socket local? fila?) — o manual
> fecha o *se*, não o *como*.

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
| F6 | 1.1 Core seguro e unidade | tenant, `TenantContext`, RBAC, MFA administrativo, auditoria de login. **Multiunidade desde o dia 1** (ADR-002): teste de isolamento por `gym_unit_id` junto com o de `tenant_id` | — |
| F7 | 1.2 Aluno, plano e entitlement manual | `Student`, `Plan`, `Subscription` manual, **`Entitlement` como derivação explícita**, com `source` como enum extensível (ADR-009) | — |
| F8 | 1.3 Consentimento, biometria e sync | `Consent`, `BiometricIdentity`, `DeviceUser`, fila individual por usuário×dispositivo, **expurgo em 30 dias** e **consentimento por responsável legal** (ADR-008) | etapa física depende de hardware |
| F9 | 1.4 Decisão online e passagem | Access Decision Engine **na nuvem** (ADR-004), `AccessEvent`, `Passage`, tela pública | lista canônica de razões de `DENY` (`DESIGN-UI` §17 item 2) |
| F11 | 1.6 Painel e prontidão | dashboard operacional, saúde de dispositivo e **alerta obrigatório quando o Edge some** (ADR-011) | F6–F9 |

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
| F20 | 3.4 Metas e frequência | `Goal` precisa ser modelada — hoje é buraco (`CONVENTION` §5) |
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
