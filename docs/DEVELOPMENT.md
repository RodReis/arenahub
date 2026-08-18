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
| 18/08/2026 | **F12** | SPEC-012 | [#97](https://github.com/RodReis/arenahub/pull/97) | **Ledger operacional e invoice, Slice 2.1.** Quatro módulos de domínio puro (48 testes): `dinheiro` (INV-065 — inteiro em centavos, float rejeitado em runtime, soma sem divisão), `catalogo-de-planos` (benefício estruturado), `grupo-familiar` (limite de 3, um titular) e `invoice` (totais, transições, pagamento). Dez tabelas novas: `plan_prices`, `plan_benefits`, `family_groups`, `family_members`, `billing_settings`, `invoices`, `invoice_items`, `payments`, `payment_attempts`, `account_credits` — campos conforme **ADR-027**, sem `gym_unit_id` em nenhuma (pagamento não é dado físico). **Preço com vigência** e **benefício como tabela** por decisão do PI a partir dos encartes impressos da Arena Positiva: bioimpedância a cada **30** dias no programa de adultos e **60** na clínica é regra que o MVP 3 vai ler, não prosa; "Teste de ECG — em avaliação" motivou `status` de três valores em vez de booleano. **Plano família não exigiu tocar no motor de acesso** — `Entitlement` já tinha `student_id` próprio e `subscription_id` nulável, então a derivação só mudou de 1:1 para 1:N. Seed com o catálogo real: R$ 150 (dois programas), R$ 200 (família/3), R$ 30 (diária). **Dinheiro no balcão é caminho de primeira classe:** `POST /api/v1/invoices/:id/manual-payment` registra dinheiro ou transferência reconhecidos na recepção, sem provedor — é o que faz a Slice 2.1 fechar sem adapter. Permissão **própria** `billing.payment.manual`, separada de `billing.manage` (403 comprovado em teste): reconhecer dinheiro é ato excepcional, mesmo critério do `access.override` da F9. Abertura de invoice **idempotente** por INV-066, com a checagem antes de consumir número — senão a numeração ficaria com buraco. Numeração por tenant com `ON CONFLICT` + `FOR UPDATE`; outbox na mesma transação (INV-084). **14 testes de integração** contra Postgres real. **Bug achado pelo teste:** `audit_logs.actor_id` tem FK para `users`, e operador com UUID solto quebrava o registro manual — justamente a mitigação detectiva do ADR-027. **A guarda de OpenAPI pegou o snapshot desatualizado** na suíte completa, passando isolado. Fecha dois `[indefinido]` do `CONVENTION.md` §3.4 e o §3.5 inteiro |
