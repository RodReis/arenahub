# CLAUDE.md — ArenaHub

## Diretrizes de implementação (Code)

Priorizam cautela sobre velocidade; em tarefa trivial, bom senso.

- **Pense antes de codificar.** Não presuma: declare suposições, exponha
  interpretações alternativas, aponte a abordagem mais simples. Em dúvida sobre
  **escopo de produto**, pare e pergunte. Em dúvida técnica, decida e
  registre no PR — ver *O que pode bloquear o desenvolvimento*.
- **Simplicidade primeiro.** Código mínimo que resolve. Sem abstração de uso
  único, sem flexibilidade não pedida, sem tratar cenário impossível.
- **Alterações cirúrgicas.** Cada linha alterada rastreável ao pedido. Não
  refatore o que não quebrou; mantenha o estilo existente; código morto não
  relacionado se aponta, não se apaga. **Exceção:** atualizar `docs/` é escopo
  obrigatório da entrega, não "melhoria adjacente".
- **Execução verificável.** Traduza tarefa em critério checável ("adicionar
  validação" → "teste para entrada inválida passa"). `dev`, `test`, `lint`
  verdes é o piso.

## Papéis e governança

- **Rodrigo Reis (PI)** — decide escopo, prioridades e trade-offs; aprova specs e aceita entregas. **Nunca faz commit, push, PR nem merge** — o PI não toca no Git. O portão do PI é o **aceite na issue**, não o merge: o PI não segura o código na porta da `main`, ele carimba o que já entrou como realmente pronto. **descisão final e verdade do é PI, code atualiza documentação e/ou cria a ADR e merge na main**.
- **Claude Cowork (planejamento)** — mantém `docs/` e registra decisões. **Não cria spec e não aprova nada.** A Slice do PRD **é** a especificação (ADR-022); `docs/specs/**` deixou de ser artefato de processo em **18/08/2026** — os arquivos existentes ficam como histórico e não bloqueiam ninguém. Cria a issue-fatia e a `[INFRA]` no board (Backlog, assignee PI) e os metadados de label (ADR-023). Escreve documento direto na `main` — escopo no **criar spec sem bloqueio, aceito duplo, LGPD, amarra juridica, consentimento e não criar ou inventa regra sempre pergunta o PI, isso não trava ou impede o desenvolvimento complento do sistema, descisão final é do PI. Não nos preocupamos com LGPD, consentimento, juridicos, nos só desenvolvemos o produto.**. Nunca implementa código, nunca toca em `apps/`, `packages/`, `infra/` nem `.github/`. **Em `docs/prd/**` escreve só emenda que materializa decisão do PI já registrada em ADR aceito, citando o ADR na própria emenda** — requisito novo, não inventar decisão sem o consentimento do PI, não criar regra sem o PI aceitar, e decisão do PI esta acima das ADR ou de qualquer outro documento. 
- **Claude Code (developer)** — codifica, testa (usar a skill /code-review; e para frontend, as skills do /impeccable e /frontend-design:frontend-design) antes do commit, atualiza a documentação e **commita os documentos de `docs/`** junto da entrega. **Implementa a partir deste arquivo + `docs/` + a Slice do PRD da fatia** — não espera spec nem aprovação de ninguém. **Não cria a issue de fatia nem a `[INFRA]`** (são do Cowork — ADR-023); pega o card, move pelo fluxo e entrega com PR. Cria a própria issue `[FIX]` de bug. Pode criticar arquitetura, **não escopo**. **Só para e pergunta em dois casos** — ver *O que pode bloquear o desenvolvimento*. Fora deles: decide, implementa, e registra a decisão no corpo do PR. **Code não criar ou inventa regra, segui a que esta especificada, e a descisão final é o PI**

#### Dois atores escrevem no Git — quem cede no conflito

O Cowork pusha documento direto na `main`; o Code entrega por PR. Como o Cowork não abre PR, **ele nunca vê conflito** — quem colide é sempre o Code, com branch aberta enquanto a `main` andou.

**Regra:** o Code **rebase e reaplica** — divergiu da `main`, re-sincroniza e reaplica o próprio trabalho por cima. O Code **nunca desfaz** linha escrita pelo Cowork: se o `docs/STATUS.md` divergiu, **a versão da `main` vence** e o Code reaplica o próprio progresso por cima.

A divisão é **por arquivo** (ADR-021): documento de governança é do Cowork; código, build, CI, PRD e planos são do Code ou do PI. Se o Cowork precisar tocar em algo fora da lista do ADR-021, **para e pergunta ao PI**.

**Importante:** o push do Cowork na `main` é o único caminho do processo sem PR, CI ou aceite, e vale **só para documento**. **Todo código entra por PR com CI verde, sem exceção**, e o aceite continua sendo exclusivo do PI — essas duas garantias nunca se moveram.

### Ciclo de vida de uma fatia — três passos

> **Simplificado em 18/08/2026 por decisão do PI.** O gate de spec `aprovada-pi` **morreu**: ele
> exigia aprovar um arquivo-ponteiro cujo conteúdo real mora no PRD, e travava desenvolvimento sem
> decidir nada. O que ficou é o que pegava erro de verdade: **CI verde** e **aceite do PI**.

1. **Card existe** → o Cowork cria a issue no board (Backlog, `proplan:backlog`, assignee PI),
   título no *Padrão de título de issue*, corpo com link para a **Slice do PRD**.
2. **Code pega e entrega** → move para `todo` ao pegar, `doing` ao iniciar, implementa a partir da
   Slice, abre PR com **`refs #N`** (**nunca `closes #N`** — forjaria o aceite do PI) e **mergeia
   ele mesmo com o CI verde**. O CI verifica build, lint, testes e as **guardas de evidência**
   (`docs/TESTING.md`). Depois do merge, aplica `proplan:done` com o link do PR no corpo da issue.
3. **PI aceita** → **só o PI** fecha a issue e aplica `proplan:finalizado`. Nenhuma automação pode
   forjar aceite.

**`card = fatia`** — uma issue por fatia, **nunca por passo**. Os passos vivem no
`docs/DEVELOPMENT.md`.

### Fatia = Slice do PRD

A unidade de trabalho é a **Slice N.M** dos PRDs (`docs/prd/academia/MVP-*.md`, seção 7). Cada Slice recebe **um número de fatia `F<n>` e um número de spec `SPEC-<nnn>` iguais**, alocados uma única vez no **Índice Fatia ↔ SPEC** do `docs/STATUS.md`. Exemplo: Slice 1.3 = `F8` = `SPEC-008`.

- Número é **alocado pelo Cowork** e nunca reaproveitado.
- Uma spec gera **exatamente uma fatia**. Se a fatia precisar ser partida, isso é decisão do PI e gera **nova spec com novo número** — não sufixo.
- Os planos de **gate/homologação** (`docs/superpowers/plans/*-mvp-0[2-6]-00-*.md`) **não são fatias**: viram card `[GATE]`, sem `SPEC` e sem `F`. Atenção ao glob: `mvp-00-poc-topdata.md` **é** o plano das fatias F1–F5, não um gate.

### Padrão de título de issue

Todo título de card **começa** com tokens em colchetes, **nesta ordem**, seguidos de um espaço e o título livre. Motivo: olhando o board, dá pra ler **qual MVP** e **qual SPEC** — não só a fatia. Reforça a regra do `STATUS.md`: *nunca o número nu, sempre o par*.

**Forma:** `[MVP<n>][SPEC-<nnn>][<fatia|tipo>] <título livre>`

- **`[MVP<n>]`** — `[MVP0]`…`[MVP6]`, mais `[MVP1.5]` (ADR-012), `[MVP2.5]` (ADR-025) e `[MVP3.5]` (ADR-042), quando a fatia pertence a um MVP conhecido.
- **`[SPEC-<nnn>]`** — 3 dígitos (`[SPEC-024]`), quando há spec. **Permanece** em correção que conserta comportamento definido numa spec.
- **`[F<n>]`** — a fatia (`[F18]`). Para card que **não é fatia**, entra no lugar um **token de tipo**: `[FIX]` (correção de bug), `[GATE]` (homologação/portão de entrada de MVP) ou `[INFRA]` (processo/infra).

**Regra de ouro:** só entra token que é **verdade** — nunca inventar SPEC ou fatia. Card carrega os tokens que existem, na ordem; os que não existem, omite.

Exemplos:

- Fatia com spec → `[MVP1][SPEC-008][F8] Consentimento, biometria e sync de dispositivo`
- Portão de entrada de MVP → `[MVP2][GATE] Homologação do provedor de pagamento`
- Correção ligada a uma spec → `[MVP2][SPEC-013][FIX] webhook duplicado ativa entitlement duas vezes`
- Correção ligada só a ADR/doc (sem spec) → `[MVP1][FIX] snapshot expirado permite allow offline`
- Processo/infra sem MVP/SPEC → `[INFRA] CI: relatório de testes por SPEC/issue`

O par MVP↔SPEC↔Fatia deriva do **Índice Fatia ↔ SPEC** do `docs/STATUS.md` (fonte única). Card de teste/descartável leva `[TEST]` no lugar do tipo.

### O que pode bloquear o desenvolvimento — a lista inteira

**São dois casos. Não há terceiro.** Documento não bloqueia código; ADR não bloqueia código;
"falta a spec" não bloqueia nada. Se você está parado por qualquer outro motivo, o motivo está
errado — implemente e registre a decisão no PR.

Tudo o mais — nome de campo, ordem de implementação, estrutura de pasta, dublê de teste, como
testar, se cabe refactor junto — **é do Code, decide na hora**. Errou? É reversível: corrige no
próximo PR.

**ADR só para escolha cara de desfazer** — migração de dado histórico, contrato com terceiro,
regime legal, decisão que outro sistema já consome. **Decisão sobre o próprio processo não vira
ADR** (mudou em 18/08/2026: onze dos trinta primeiros ADRs eram sobre como trabalhar, e isso
custava mais do que resolvia). Muda-se este arquivo e pronto.

#### Correção de bug: o Code cria a própria issue

Bug de comportamento já documentado (ADR, `ARCHITECTURE.md`, `CONVENTION.md`, `STATUS.md`): o
Code cria o card `[FIX]` em Backlog, cita a fonte no corpo e segue o fluxo normal. Não espera
ninguém. Se o comportamento correto **ainda não existe** e escolhê-lo é decisão de produto, cai no
primeiro caso da tabela acima.

## Regras de trabalho

- **Idioma**: documentação, specs, commits e comunicação sempre em português (PT-BR); código e identificadores em inglês.
- **Sem hardcode e sem dado inventado no caminho de produção.** Dado local de desenvolvimento entra por seed, criado na primeira fatia que precisar. Seed em `packages/database/prisma/seed.ts` (ADR-020). **Dublê de teste é obrigatório, não proibido** — simulador de leitor Topdata, `FakePaymentProvider`, fake de OCR/IA e de antivírus existem por exigência dos PRDs e vivem no boundary, nunca dentro da regra de domínio. A fronteira está em `docs/TESTING.md`.
- **Desenvolvimento é local** (docker-compose: Postgres + Redis + MinIO).
- **Portas**: API `3344` (fixa — se ocupada, falha em vez de trocar); Expo dev server na padrão (`8081`); demais apps na porta padrão do framework. Colisão vira decisão registrada, nunca troca silenciosa.
- **Nada de dado real de aluno no repositório** — nem em fixture, nem em golden file, nem em log de erro.
- **Nunca afirmar estado de CI, PR ou job sem verificar no momento da fala.** Se o PI diz que
  terminou, a resposta é `gh pr checks <n>` — nunca contradizer sem checar. Silêncio de
  ferramenta não é evidência de nada: um watcher que emudece parece idêntico a um job que ainda
  roda. Para esperar CI, usar **`gh pr checks <n> --watch`** em background (ele bloqueia até o
  fim e devolve código de saída), nunca loop de monitor artesanal — o loop que espera "todos
  saírem de `pending`" fica girando calado quando uma chamada falha, e foi assim que uma entrega
  pronta ficou parada até o PI olhar por conta própria (18/08/2026, PR #102).

## O que é

**ArenaHub** é um SaaS multi-tenant de gestão para academias, iniciando pelo módulo **Academia**. Cliente inaugural: Complexo Arena Positiva.

Ele costura, numa cadeia só, o que hoje vive em sistemas separados: **matrícula → cobrança → direito de acesso → catraca com reconhecimento facial → frequência → evolução corporal → retenção**.

Cinco pilares (`docs/Especificação Completa — Plataforma Inteligente de Gestão para Academias.md` §2):

1. **Gym Management** — tenant, unidades, perfis, alunos, planos, assinatura.
2. **Smart Access** — biometria facial, catraca, motor de decisão de acesso, operação offline.
3. **Smart Billing** — invoice, PIX, cartão recorrente, inadimplência, conciliação.
4. **Health Intelligence** — avaliação física, bioimpedância, histórico comparativo, análise assistiva por IA.
5. **Engagement & Retention** — metas, XP, streak, ranking opt-in, risco de churn explicável, CRM de retenção.

**O que o ArenaHub não é** (`docs/prd/README.md` §3): não é ERP contábil, não emite nota fiscal, não é prontuário médico, não é adquirente, não substitui prescrição profissional.

**Estado atual (18/08/2026): MVP 1 em execução.** O bootstrap fechou, o monorepo existe com `apps/`, `packages/`, `infra/` e `.github/`, e o MVP 0 encerrou em 18/08 com `GO_WITH_CONSTRAINTS` (ADR-029) — com quatro restrições que o MVP 1 carrega. Estado corrente sempre no `docs/STATUS.md`, nunca aqui.

## Regras de arquitetura (não violar)

Estas nove regras não se negociam numa fatia. Contrariá-las exige **ADR novo em `docs/DECISIONS.md`, aprovado pelo PI** — nunca um PR "porque ficou mais simples assim".

1. **Pagamento não controla acesso. Entitlement controla.** A cadeia é `Pagamento → Invoice → Subscription → Entitlement → Access Decision Engine`. A catraca **nunca** consulta assinatura nem invoice. Origem: Especificação §18/§125, `M1-BR-003`, ADR-003.
2. **`tenant_id` em toda entidade de negócio; `gym_unit_id` quando o dado é físico.** O tenant vem **da identidade autenticada**, nunca do corpo da requisição nem do payload de webhook. Repositório recebe `TenantContext` obrigatório. Origem: Especificação §6, `docs/prd/README.md` §6.1.
3. **A nuvem é a fonte da verdade; o Edge é executor físico.** O SQLite do gateway é banco operacional temporário. Origem: Especificação §92/§125, `docs/prd/README.md` §5.1.
4. **Todo efeito externo é idempotente.** Webhook por `(provider_account_id, external_event_id)`; evento de domínio por `(event_id, consumidor)`; evento de acesso por `external_event_id`. Reprocessar é sempre seguro. Origem: Especificação §84, `M2-FR-008`, ADR-006.
5. **Evento de domínio é persistido na mesma transação da mudança de estado** (transactional outbox). Nada de publicar antes de commitar. Origem: `docs/prd/README.md` §5.1/§6.3.
6. **Dinheiro é inteiro na menor unidade monetária.** Nunca `float`, nunca `number` para valor. Moeda e valor não mudam depois que a invoice abre. Origem: `M2-BR-001`.
7. **Biometria exige consentimento versionado e caminho alternativo funcional.** Recusar a biometria **não pode negar o acesso** — QR, cartão, PIN e liberação assistida são caminhos de primeira classe, não degradados. Revogação bloqueia logicamente na hora, mesmo com exclusão física pendente. Origem: Especificação §13/§76/§115, `M1-BR-004`, `M1-BR-005`, ADR-008.
8. **IA e OCR nunca publicam dado de saúde sozinhos.** Toda extração automática exige confirmação humana antes de virar histórico oficial; toda saída de IA carrega `disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS'` e é rejeitada se trouxer diagnóstico ou valor inexistente. Origem: Especificação §50/§55, `M3-BR-006`, `M3-BR-010`.
9. **Módulo não lê tabela privada de outro módulo.** A conversa é por caso de uso público ou evento. Origem: `docs/prd/README.md` §8.

Contrato completo (entidades, estados, invariantes numeradas): `docs/CONVENTION.md`.

## Stack

Fixada em `docs/prd/README.md` §5/§5.1 e nos índices de plano. O único acréscimo ao layout do PRD é `packages/database`, ratificado em **ADR-020** — falta a emenda formal ao `prd/README.md` §5. Versão exata é decisão registrada — **não atualize major sem ADR**.

**Monorepo** — pnpm workspaces + Turborepo.

```
apps/
  api/          NestJS — monólito modular, REST /api/v1 + OpenAPI, WebSocket
  admin-web/    Next.js (App Router, Server Components por padrão)
  kiosk/        Next.js PWA em modo quiosque (totem)
  mobile/       React Native + Expo
  edge-agent/   Node.js no PC da academia + SQLite (+ serviço nativo p/ SDK Topdata)
packages/
  api-contracts/  tipos e schemas compartilhados
  database/       schema Prisma, migrations, client factory, seed  ← ADR-020
  ui/             design system
  config/         eslint, tsconfig, prettier
  testing/        utilitários de teste
infra/
  docker/ database/ observability/
```

- **Runtime**: Node LTS fixado, compatível com Next.js 16. TypeScript estrito.
- **Dados**: PostgreSQL + Prisma na nuvem; SQLite no Edge; Object Storage privado S3-compatível (MinIO em dev).
- **Fila**: Redis + BullMQ — **só quando comprovadamente necessário**, não por padrão.
- **Validação**: Zod no boundary (`unknown` antes de validar).
- **Testes**: Jest (api, edge-agent), Vitest + Testing Library (web), Playwright (E2E), Testcontainers (integração).
- **Sem microserviço antes de métrica que o justifique.**

Comandos obrigatórios (`docs/prd/README.md` §7) — o bootstrap tem que fazer todos existirem antes da primeira feature:

```
pnpm install --frozen-lockfile
pnpm dev | lint | typecheck | test | test:integration | test:e2e | build
```

## Convenções de código

- Domínio e identificadores em inglês; textos de interface em pt-BR.
- Funções de cálculo puras — sem banco, rede ou relógio; o "agora" entra por parâmetro.
- Casos de uso controlam transações; controllers apenas validam e delegam.
- DTO nunca é entidade de persistência.
- Proibido `any` implícito; proibido float para dinheiro; `unknown` antes de validar dado externo.
- Erro de domínio tem código estável; resposta HTTP segue `application/problem+json` com `type`, `title`, `status`, `code`, `correlationId`.
- Máscaras/validação nos campos: Date, valores R$, CPF, CNPJ, telefone, e-mail.
- Não usar Alert para msg, sempre usar Toast para: Info, Warn e error.
- Dado de desenvolvimento vem de seed; dublê de teste vive no boundary (ver `docs/TESTING.md`).
- Nunca logar template biométrico, token de pagamento, dado de cartão ou PII em erro.
- Contrato de domínio completo (entidades, estados, invariantes): `docs/CONVENTION.md`.
- Autorizado a subir o docker, se estiver off. Criar sempre um nova, com novas portas, nunca usar as que ja etão configurada no docker.
- **desenvolvimento direto, sem bloqueio, sem aceito duplo, sem LGPD, e sem consentimento, nada disso não trava ou impede o desenvolvimento complento do sistema, descisão final é do PI**
- **Não nos preocupamos com LGPD, consentimento, juridicos, nos só desenvolvemos o produto.**

## Grafo de conhecimento (graphify)

**Opcional — só vale enquanto houver código a indexar.** Enquanto o repo for só documentação, ler os arquivos direto é mais barato que manter grafo.

- Se `graphify-out/` existir: antes de explorar o codebase para entender arquitetura, fluxos ou "quem chama o quê", consulte o grafo primeiro — `/graphify query "<pergunta>"`. Só leia arquivos direto quando precisar do conteúdo exato.
- **Ao final de cada entrega** (junto com STATUS.md/DEVELOPMENT.md): pergunte ao PI se roda `/graphify . --update` — incremental, re-extrai só arquivos novos/alterados via manifest. Não recrie o grafo do zero.
- `graphify-out/` é artefato local (cache), não entra em commit.

## Skills relevantes a usar (Claude Code)

Use a que existir no ambiente; a ausência de uma skill não é desculpa para pular a disciplina que ela representa.

- `superpowers:brainstorming` — Activates before writing code
- `superpowers:using-git-worktrees` — Activates with approved design. Cria um espaço de trabalho isolado em um novo branch
- `superpowers:writing-plans` — Activates with approved design.
- `superpowers:executing-plans` - Activates with plan.
- `superpowers:test-driven-development` — feature crítica (isolamento de tenant, decisão de acesso, idempotência financeira).
- `superpowers:finishing-a-development-branch` — Ativa-se quando as tarefas são concluídas. Verifica os testes, apresenta opções (merge/PR/keep/discard) e limpa a árvore de trabalho.
- `engineering:code-review` — em todas as tarefas, não apenas em revisões.
- `document-skills:frontend-design` — UI distinta (não cair em shadcn-default genérico)
- `Playwright` — smoke ao vivo
- `impeccable` — critique craft layout delight clarify polish optimize *(global)*
- `context7` — documentação atualizada de biblioteca *(mcp)*
- `expo` — implementação do mobile *(global)*
- `gstack:design-review` — em todas as tarefas, não apenas em revisões.
- `gstack:qa` — Test your app, find bugs, fix them with atomic commits, re-verify. Auto-generates regression tests for every fix.
- `gstack` — is a process, not a collection of tools. The skills run in the order a sprint.

## Documentos-chave

- `docs/prd/README.md` — **contrato de produto e engenharia** (documento master): arquitetura de referência, padrões transversais, comandos, estilo, testes, definição de pronto e rastreabilidade. Decisão que o contraria **emenda o parágrafo** com nota apontando o ADR.
- `docs/prd/academia/MVP-*.md` (MVP-00 a MVP-06) — requisitos por MVP: FR/NFR/BR/AC, slices, gates de entrada e checklists de execução.
- `docs/Especificação Completa — Plataforma Inteligente de Gestão para Academias.md` — visão ampla de origem. **Não é normativo**: onde conflitar com PRD, ADR ou `CONVENTION.md`, prevalece o documento mais específico.
- `docs/specs/` — **reaberto em 23/08/2026, por decisão do PI.** Entre 18/08 e 23/08 valeu *"histórico, não processo — não se criam novas"*; o PI pediu spec para as fatias novas e a regra voltou **para fatia criada a partir de 23/08**: cada uma tem `SPEC-<nnn>` de mesmo número do `F<n>` (ADR-015). **F45–F48 seguem sem spec** e `SPEC-045`–`SPEC-048` seguem queimados. Onde a fatia nasce de uma Slice de PRD, a spec continua sendo **ponteiro fino** (ADR-022) e não copia requisito; onde não há Slice (F49–F56), o escopo mora na spec.
- `docs/DEVELOPMENT.md` — **sua ordem de execução e status por item** (você é o dono; atualize a cada entrega junto com STATUS.md).
- `docs/ARCHITECTURE.md` — desenho, módulos, dados, resiliência.
- `docs/DECISIONS.md` — ADRs (ler antes de propor mudança estrutural). **ADR-021** define quem escreve o quê no Git.
- `docs/CONVENTION.md` — contrato de domínio do ArenaHub: entidades, estados, invariantes e regras de negócio (o coração do produto).
- `docs/design/` — **contrato de implementação de UI por superfície** (ADR-026): `DS-PAINEL.md` (`admin-web`), `DS-APP.md` (`mobile`), `DS-TOTEM.md` (`kiosk`). Onde divergirem do `DESIGN-UI.md`, **eles vencem**. Os `.dc.html` são protótipo visual, **não código a instalar** — colá-los produz o hex literal que a lint proíbe. **Exceção:** sobre nome de estado, razão ou enum, o ADR de domínio vence e o documento de design é corrigido.
- `docs/DESIGN-UI.md` — **documento de direção**, não de contrato (rebaixado por ADR-026): de onde saíram Carbono Adaptativo e o pipeline de accent. Status `RASCUNHO`; as pendências da §17 que sobraram estão espelhadas em `docs/design/*.md` §12–§13.
- `docs/STATUS.md` — Kanban/roadmap deste projeto + **Índice Fatia ↔ SPEC** (fonte única da numeração). Prosa curta, sem detalhe.
- `docs/STATUS-ARQUIVO.md` — histórico detalhado que complementa o STATUS.md: prosa longa mora aqui, com detalhe.
- `docs/LANDSCAPE.md` — **cenário competitivo datado**: o que o mercado já faz, o que morreu por causa disso, e os gatilhos que obrigam a revisar. Evita reconstruir o que já existe de graça.
- `docs/TESTING.md` — estratégia de teste, classificação, evidência e relatório por SPEC/issue.
- `docs/REVIEW.md` — instruções exclusivas para revisão, inseridas nos agentes do pipeline de revisão com a mais alta prioridade. Use-as para alterar o que é sinalizado, com qual gravidade e como as descobertas são relatadas.
- `docs/superpowers/plans/` — planos de implementação por slice. São **material de apoio do Code**, não contrato: onde divergirem do PRD, o PRD vence.
