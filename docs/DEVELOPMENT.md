# DEVELOPMENT.md — ordem de execução do ArenaHub

> **Dono deste arquivo: Claude Code.** Atualize a cada entrega, junto com `docs/STATUS.md`.
>
> `STATUS.md` responde *"em que pé está?"*. **Este arquivo responde *"o que faço agora, e em
> que ordem?"***. Os passos de uma fatia moram aqui — **nunca** viram issue separada
> (`card = fatia`).

**Estado em 14/08/2026:** nada implementado. O bootstrap `[INFRA]` ainda não tem card.

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

| # | passo | evidência de pronto |
|---|---|---|
| 1 | Monorepo pnpm + Turborepo com o layout de `apps/`, `packages/`, `infra/` | `pnpm install --frozen-lockfile` passa |
| 2 | TypeScript estrito + ESLint + Prettier em `packages/config` | `pnpm lint` e `pnpm typecheck` verdes num repo vazio |
| 3 | Os 8 comandos obrigatórios existem e falham com mensagem clara quando não há o que rodar | `pnpm test`, `test:integration`, `test:e2e`, `build`, `dev` |
| 4 | `docker-compose` com Postgres + Redis + MinIO | `docker compose up` sobe os três |
| 5 | `packages/database` (ADR-020) com Prisma, migration inicial vazia e `seed.ts` | `pnpm --filter database migrate dev` |
| 6 | `.github/workflows/ci.yml` — build, lint, typecheck, testes, guardas de evidência | CI verde no primeiro PR |
| 7 | Board no GitHub: 5 colunas, 5 labels `proplan:*` | board existe |
| 8 | Versionar os arquivos hoje *untracked* | `git status` limpo |

**Não faça no bootstrap:** módulo de domínio, entidade, endpoint. Bootstrap é encanamento.

---

### MVP 0 — POC Topdata · F1 a F5

> **Este MVP é portão, não aquecimento.** Ele existe para responder se a arquitetura do Smart
> Access se sustenta. `NO_GO` é resultado válido e útil.

| F | slice | o que precisa provar | bloqueado por |
|---|---|---|---|
| F1 | 0.1 Bancada reproduzível | qualquer pessoa reproduz o ambiente e o simulador roda em CI **sem hardware** (`M0-NFR-006`) | `HW-GATE-01` (entrada de bancada: máquina Windows, rede isolada, inventário, consentimento) |
| F2 | 0.2 Ciclo de vida facial | cadastrar, atualizar e remover identidade no leitor, com confirmação | hardware |
| F3 | 0.3 Catraca e passagem | abrir catraca e **confirmar giro**; medir latência ponta a ponta | hardware |
| F4 | 0.4 Offline e reconciliação | comportamento com link derrubado; eventos não se perdem | hardware, **ADR-011** |
| F5 | 0.5 Relatório e decisão | decisão de saída do MVP 0 (`MVP-00` §15) com evidência: `GO`, `GO_WITH_CONSTRAINTS` ou `NO_GO` | F1–F4 |

**A pergunta que F2 tem de responder e ninguém pode adivinhar:** o SDK do leitor facial exige
Windows e processo nativo? A resposta muda a stack do `edge-agent` (ADR-010).

**A medida que F3 tem de produzir:** latência real p95. Ela decide o ADR-004.

---

### MVP 1 — Smart Access · F6 a F11

Entrada: decisão de saída do MVP 0 (`MVP-00` §15, `MVP-01` §1) = `GO` ou `GO_WITH_CONSTRAINTS`.

| F | slice | núcleo | bloqueado por |
|---|---|---|---|
| F6 | 1.1 Core seguro e unidade | tenant, `TenantContext`, RBAC, MFA administrativo, auditoria de login | **ADR-002** |
| F7 | 1.2 Aluno, plano e entitlement manual | `Student`, `Plan`, `Subscription` manual, **`Entitlement` como derivação explícita** | **ADR-009** |
| F8 | 1.3 Consentimento, biometria e sync | `Consent`, `BiometricIdentity`, `DeviceUser`, fila individual por usuário×dispositivo | **ADR-008**; etapa física depende de hardware disponível (`HW-GATE-01`) |
| F9 | 1.4 Decisão online e passagem | Access Decision Engine, `AccessEvent`, `Passage`, tela pública | **ADR-004**, **ADR-005**, lista de razões (`DESIGN-UI` §17.2) |
| F10 | 1.5 Operação offline | snapshot assinado, cache, fila, reconciliação | **ADR-004, ADR-007, ADR-011, ADR-012** |
| F11 | 1.6 Painel e prontidão | dashboard operacional, saúde de dispositivo, modo degradado visível | F6–F10 |

**Ordem não negociável:** F6 → F7 → F8 → F9. O motor de acesso (F9) **não pode** vir antes de
aluno, plano e entitlement — a Especificação §127 sugere o contrário e está errada; F9 sem F7
só se sustenta com stub, e stub em caminho crítico vira produção.

**Invariantes que F9 tem de provar com teste, não com revisão:** INV-029, INV-030, INV-035.

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
| — | — | — | — | nenhuma entrega até 14/08/2026 |
