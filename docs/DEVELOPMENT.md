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

### Exceção de arranque

O ciclo acima pressupõe board, CI e comandos `pnpm` — **e nenhum dos três existe ainda**. Não
há como criar um card para criar o board, nem exigir CI verde do PR que cria o CI. Enquanto o
bootstrap (§4) não fechar, vale este regime reduzido, **e só ele**:

| exigência normal | durante o arranque |
|---|---|
| card no board antes de começar | dispensado **até o board existir**; o primeiro card criado é o do próprio board |
| CI verde antes do merge | substituído por execução local dos comandos que já existem, colada no corpo do PR |
| cobertura ≥ 80% em regras de domínio | **n/a** — bootstrap não tem regra de domínio |
| OpenAPI e contratos de evento atualizados | **n/a** pelo mesmo motivo |
| spec `aprovada-pi` | **n/a** — bootstrap é `[INFRA]`, não fatia, e não tem escopo de produto a assumir |

**O que continua valendo sem exceção:** PR com `refs #N` quando houver issue, nunca `closes`;
merge do próprio Code; aceite exclusivo do PI; commit em PT-BR; nenhum segredo versionado.

A exceção **morre no item 7 do bootstrap (§4)**. A partir do primeiro card real, o ciclo normal vale
inteiro — e este bloco vira histórico.

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

**Item 6 (#47, CI) é o marco:** quando ele fecha, a *exceção de arranque* da §2 morre e o ciclo
normal vale inteiro.

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
| PostgreSQL | **17** (`17-alpine`) | `infra/docker/docker-compose.yml` |
| Redis | **8** (`8-alpine`) | idem — provisionado, **não adotado** |
| MinIO | `RELEASE.2025-09-07T16-13-09Z` | idem — tag datada, nunca `latest` |

⚠️ **A ponta foi recusada três vezes, pelo mesmo motivo.** Node 24, TypeScript 7 (reescrita
nativa em Go) e ESLint 10 já existiam quando estas versões foram fixadas. Todos recusados: a
stack do PRD — NestJS 11, Next.js 16, Prisma, Expo — tem compatibilidade **comprovada** com os
majors anteriores, e o custo de um major novo demais não aparece no card que o adota, aparece
nos seguintes. Prender o `edge-agent` (serviço Windows com SDK nativo, ADR-010) a um LTS
recém-saído troca risco conhecido por risco desconhecido.

---

### MVP 0 — POC Topdata · F1 a F5

> **Este MVP é portão, não aquecimento.** Ele existe para responder se a arquitetura do Smart
> Access se sustenta. `NO_GO` é resultado válido e útil.

| F | slice | o que precisa provar | bloqueado por |
|---|---|---|---|
| F1 | 0.1 Bancada reproduzível | qualquer pessoa reproduz o ambiente e o simulador roda em CI **sem hardware** (`M0-NFR-006`) | `HW-GATE-01` (entrada de bancada: máquina Windows, rede isolada, inventário, consentimento) |
| F2 | 0.2 Ciclo de vida facial | cadastrar, atualizar e remover identidade no leitor, com confirmação | hardware |
| F3 | 0.3 Catraca e passagem | abrir catraca e **confirmar giro**; medir latência ponta a ponta | hardware |
| F4 | 0.4 Offline e reconciliação | comportamento com link derrubado; eventos não se perdem | hardware |
| F5 | 0.5 Relatório e decisão | decisão de saída do MVP 0 (`MVP-00` §15) com evidência: `GO`, `GO_WITH_CONSTRAINTS` ou `NO_GO` | F1–F4 |

**A pergunta que F2 tem de responder e ninguém pode adivinhar:** o SDK do leitor facial exige
Windows e processo nativo? A resposta muda a stack do `edge-agent` (ADR-010).

**A medida que F3 tem de produzir:** latência real p95. O ADR-004 já está decidido (a nuvem
decide); esta medição **pode reabri-lo** se o p95 passar de 300 ms.

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
