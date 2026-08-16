# CLAUDE.md — ArenaHub

## Diretrizes de implementação (Code)

Priorizam cautela sobre velocidade; em tarefa trivial, bom senso.

- **Pense antes de codificar.** Não presuma: declare suposições, exponha
  interpretações alternativas, aponte a abordagem mais simples. Em dúvida, pare
  e pergunte ao PI (já é regra: sem spec → perguntar).
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

- **Rodrigo Reis (PI)** — decide escopo, prioridades e trade-offs; aprova specs e aceita entregas. **Nunca faz commit, push, PR nem merge** — o PI não toca no Git. O portão do PI é o **aceite na issue**, não o merge: o PI não segura o código na porta da `main`, ele carimba o que já entrou como realmente pronto.
- **Claude Cowork (planejamento)** — especifica e mantém `docs/` e as specs em `docs/specs/`. Antes de finalizar qualquer spec, apresenta as perguntas abertas e dúvidas ao PI — spec só vira `aprovada-pi` com todas resolvidas (evitar retrabalho). Quando a spec vira `aprovada-pi`: **commita e pusha a spec direto na `main`** (sem branch, sem PR), registra a fatia no **Índice Fatia ↔ SPEC** do `docs/STATUS.md` e **cria a issue-fatia no board** (coluna Backlog, assignee PI). Escreve **documento** direto na `main` — o escopo exato está em **ADR-021**. Por **ADR-023**, também **cria a issue `[INFRA]`** (processo e infraestrutura, sem `F` e sem `SPEC`) e os **metadados do board** — labels `proplan:*`, cor, descrição, milestone. Card `[INFRA]` nasce sempre em **Backlog** com assignee **PI**, nunca em `todo`, e o Cowork **nunca move card para frente**. **Nunca implementa código, nunca toca em `apps/`, `packages/`, `infra/`, `.github/`, `docs/prd/**` nem `docs/superpowers/**`** — implementação é exclusiva do Claude Code, e PRD só muda por emenda aprovada pelo PI. Criar o card `[INFRA]` do CI **não é** escrever o `ci.yml`.
- **Claude Code (você)** — planeja, codifica, testa (código usar a skill /code-review e para frontend(UX e UI) — pode usar as skills do /impeccable critique layout clarify polish optimize) antes do commit, atualiza a documentação e **sempre commita todos os documentos de `docs/`** junto da entrega — **exceto a spec da fatia e o Índice Fatia ↔ SPEC**, que o Cowork já pôs na `main`. Implementa a partir deste arquivo + `docs/` + spec da feature em `docs/specs/`. **Não cria a issue de fatia nem a `[INFRA]`** (são do Cowork — ADR-023) — pega o card, move pelo fluxo e entrega com PR. **Exceção: cria a própria issue `[FIX]`** de bug com comportamento correto já documentado (ADR/`ARCHITECTURE.md`/spec existente/`STATUS.md`), citando a fonte no corpo — ver *Correção: o Code cria a própria issue* abaixo. Reclassificar fatia como `[FIX]` para pular spec e aval é proibido. Pode criticar arquitetura, **não escopo**. Sem spec para a tarefa, ou spec ambígua → perguntar ao PI antes de codificar, nunca assumir. Deve apontar problemas técnicos da spec — a correção passa pelo PI.

#### Dois atores escrevem no Git — quem cede no conflito

O Cowork pusha direto na `main` (spec + Índice Fatia ↔ SPEC); o Code entrega por PR. Como o Cowork não abre PR, **ele nunca vê conflito** — quem colide é sempre o Code, com branch aberta enquanto a `main` andou.

**Regra:** o Code **rebase e reaplica** — divergiu da `main`, re-sincroniza e reaplica o próprio trabalho por cima. O Code **nunca desfaz** linha escrita pelo Cowork: se o `docs/STATUS.md` divergiu, **a versão da `main` vence** e o Code reaplica o próprio progresso por cima.

A divisão é **por arquivo** (ADR-021): documento de governança é do Cowork; código, build, CI, PRD e planos são do Code ou do PI. Se o Cowork precisar tocar em algo fora da lista do ADR-021, **para e pergunta ao PI**.

**Importante:** o push do Cowork na `main` é o único caminho do processo sem PR, CI ou aceite, e vale **só para documento**. **Todo código entra por PR com CI verde, sem exceção**, e o aceite continua sendo exclusivo do PI — essas duas garantias nunca se moveram.

### Ciclo de vida de uma fatia (processo do trio — **não é feature do produto**)

Isto é convenção **nossa**, executada à mão via GitHub MCP: o **Cowork cria** a issue de fatia, o **Code move e entrega** (e cria a própria issue de correção — ver *Correção: o Code cria a própria issue*). **Nada disso vira código do ArenaHub** — é processo do trio, não feature do produto.

1. **Fatia ganha spec** → o **Cowork** pusha o arquivo de spec na `main` (ponteiro para a Slice do PRD — **ADR-022**), registra a fatia no **Índice Fatia ↔ SPEC** do `docs/STATUS.md` e cria a issue no board: coluna **Backlog** (`proplan:backlog`), título no **Padrão de título de issue** (ver abaixo), corpo com link para o arquivo da spec, assignee = **PI**.
2. **Code começa** → **só se a spec estiver `aprovada-pi` e os ADRs que ela lista estiverem resolvidos.** Move da Backlog para **A Fazer** (`proplan:todo`) ao pegar e para **Em Andamento** (`proplan:doing`) ao iniciar; se atribui. Card em Backlog com spec `em-revisao` ou `planejada` **não se pega**.
3. **Code entrega** → abre PR com **`refs #N`** no corpo. **NUNCA `closes #N`** — fecharia a issue no merge e **forjaria o aceite do PI**. **O merge é do próprio Code**, com o CI verde — o PI não mergeia. O CI verifica **build, lint, testes e as guardas de evidência** (`docs/TESTING.md`). Rodar `pnpm build` e `pnpm lint` antes de abrir o PR continua valendo, mas agora por economia de ciclo, não porque o CI deixaria passar. Só **depois do merge**, o Code aplica `proplan:done` → card vai para **Feito**, com o **link do PR** no corpo da issue. Declarar "terminei" **sem PR mergeado** é "fechamento frágil" — este processo existe para impedi-lo; não o produza aqui dentro.
4. **PI aceita** → **só o PI** fecha a issue e aplica `proplan:finalizado`. **A issue só fecha quando o trabalho realmente acabou.** Nenhuma automação pode forjar aceite. O Code **nunca** fecha issue nem move card para Finalizado.

**`card = fatia`** — uma issue por fatia, **nunca por passo da spec**. Os passos vivem no `docs/DEVELOPMENT.md`.

### Fatia = Slice do PRD

A unidade de trabalho é a **Slice N.M** dos PRDs (`docs/prd/academia/MVP-*.md`, seção 7). Cada Slice recebe **um número de fatia `F<n>` e um número de spec `SPEC-<nnn>` iguais**, alocados uma única vez no **Índice Fatia ↔ SPEC** do `docs/STATUS.md`. Exemplo: Slice 1.3 = `F8` = `SPEC-008`.

- Número é **alocado pelo Cowork** e nunca reaproveitado.
- Uma spec gera **exatamente uma fatia**. Se a fatia precisar ser partida, isso é decisão do PI e gera **nova spec com novo número** — não sufixo.
- Os planos de **gate/homologação** (`docs/superpowers/plans/*-mvp-0[2-6]-00-*.md`) **não são fatias**: viram card `[GATE]`, sem `SPEC` e sem `F`. Atenção ao glob: `mvp-00-poc-topdata.md` **é** o plano das fatias F1–F5, não um gate.

### Padrão de título de issue

Todo título de card **começa** com tokens em colchetes, **nesta ordem**, seguidos de um espaço e o título livre. Motivo: olhando o board, dá pra ler **qual MVP** e **qual SPEC** — não só a fatia. Reforça a regra do `STATUS.md`: *nunca o número nu, sempre o par*.

**Forma:** `[MVP<n>][SPEC-<nnn>][<fatia|tipo>] <título livre>`

- **`[MVP<n>]`** — `[MVP0]`…`[MVP6]`, mais `[MVP1.5]` (ADR-012) e `[MVP2.5]` (ADR-025), quando a fatia pertence a um MVP conhecido.
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

### Fatia exige spec. Correção de bug documentado, não.

A regra *"sem spec `aprovada-pi` → não codificar"* existe para impedir **escopo assumido** — o Code inventando o que fazer. Ela **não se aplica** quando não há escopo a assumir:

| tipo | precisa de spec? | por quê |
|---|---|---|
| **Fatia** (escopo novo, comportamento novo) | **Sim** | há decisões de produto a tomar — são do PI |
| **Correção de bug já documentado** (o comportamento correto está escrito num ADR, no `ARCHITECTURE.md`, no `CONVENTION.md` ou numa spec existente) | **Não** | não há o que decidir: o certo já está definido. Basta o item no `STATUS.md` + a regra escrita |
| **Bug sem comportamento correto definido** | **Sim** — ou pelo menos perguntar ao PI | se o certo ainda não foi decidido, decidir é do PI |

Exemplo: webhook de pagamento processado duas vezes — não tem spec e **não precisa**: o comportamento correto (idempotência por `provider_account_id + external_event_id`) já está escrito neste arquivo → *Regras de arquitetura* item 4, no `ARCHITECTURE.md` §9 e no `CONVENTION.md` INV-076. Implementar direto.

#### Correção: o Code cria a própria issue

Para bug de comportamento documentado, **o próprio Code cria o card `[FIX]`** (Backlog) e segue o fluxo normal — não espera o Cowork criar nem o PI pegar. **Motivo:** criar issue ≠ fechar issue. O aceite continua sendo só do PI, então nada da garantia se perde; o Code só ganha o ato de abrir o trabalho.

**Duas condições, ambas obrigatórias:**

1. O comportamento correto **já está escrito** num ADR, no `ARCHITECTURE.md`, no `CONVENTION.md`, numa spec existente ou como item no `STATUS.md`.
2. O corpo da issue **cita essa fonte** (link/âncora do doc que define o certo).

Se o Code precisa **decidir** qual é o comportamento correto, não é correção — é **fatia**: volta pro Cowork + PI (a decisão é de produto). O risco que estas condições fecham não é *quem cria*, é a **reclassificação**: rotular de `[FIX]` uma fatia para escapar da spec e do aval. A citação obrigatória é o que mantém honesto — é o mesmo *"só entra token que é verdade"* do Padrão de título: sem parágrafo que define o certo, não é bug.

Fluxo do FIX auto-criado: Code cria em **Backlog** → `todo`/`doing` → PR com **`refs #N`** (nunca `closes`) → `proplan:done` após o merge. **Só o PI** fecha e aplica `proplan:finalizado`.

## Regras de trabalho

- **Idioma**: documentação, specs, commits e comunicação sempre em português (PT-BR); código e identificadores em inglês.
- **Sem hardcode e sem dado inventado no caminho de produção.** Dado local de desenvolvimento entra por seed, criado na primeira fatia que precisar. Seed em `packages/database/prisma/seed.ts` (ADR-020). **Dublê de teste é obrigatório, não proibido** — simulador de leitor Topdata, `FakePaymentProvider`, fake de OCR/IA e de antivírus existem por exigência dos PRDs e vivem no boundary, nunca dentro da regra de domínio. A fronteira está em `docs/TESTING.md`.
- **Desenvolvimento é local** (docker-compose: Postgres + Redis + MinIO).
- **Portas**: API `3344` (fixa — se ocupada, falha em vez de trocar); Expo dev server na padrão (`8081`); demais apps na porta padrão do framework. Colisão vira decisão registrada, nunca troca silenciosa.
- **Nada de dado real de aluno no repositório** — nem em fixture, nem em golden file, nem em log de erro.

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

**Estado atual: documentação e planos. Zero linha de código.** O repositório não tem `package.json`, `apps/`, `packages/`, `infra/` nem `.github/`. O bootstrap do monorepo é trabalho **`[INFRA]`**, anterior a qualquer fatia — ver `docs/DEVELOPMENT.md` §4 e a *exceção de arranque* da §2.

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

## Grafo de conhecimento (graphify)

**Opcional — só vale enquanto houver código a indexar.** Enquanto o repo for só documentação, ler os arquivos direto é mais barato que manter grafo.

- Se `graphify-out/` existir: antes de explorar o codebase para entender arquitetura, fluxos ou "quem chama o quê", consulte o grafo primeiro — `/graphify query "<pergunta>"`. Só leia arquivos direto quando precisar do conteúdo exato.
- **Ao final de cada entrega** (junto com STATUS.md/DEVELOPMENT.md): pergunte ao PI se roda `/graphify . --update` — incremental, re-extrai só arquivos novos/alterados via manifest. Não recrie o grafo do zero.
- `graphify-out/` é artefato local (cache), não entra em commit.

## Skills relevantes a usar (Claude Code)

Use a que existir no ambiente; a ausência de uma skill não é desculpa para pular a disciplina que ela representa.

- `superpowers:brainstorming` — antes de implementar feature não-trivial
- `superpowers:writing-plans` — pra task com mais de 1 etapa de DB/API
- `superpowers:test-driven-development` — feature crítica (LGPD, isolamento de tenant, decisão de acesso, idempotência financeira)
- `superpowers:systematic-debugging` — bugs reportados
- `superpowers:verification-before-completion` — antes de declarar "pronto"
- `engineering:code-review` — em todas as tarefas, não apenas em revisões
- `document-skills:frontend-design` — UI distinta (não cair em shadcn-default genérico)
- `superpowers-chrome:browsing` / Playwright — smoke ao vivo
- `impeccable` — critique craft layout delight clarify polish optimize *(se instalado)*
- `context7` — documentação atualizada de biblioteca *(se instalado)*
- `expo` — implementação do mobile *(se instalado)*

## Documentos-chave

- `docs/prd/README.md` — **contrato de produto e engenharia** (documento master): arquitetura de referência, padrões transversais, comandos, estilo, testes, definição de pronto e rastreabilidade. Decisão que o contraria **emenda o parágrafo** com nota apontando o ADR.
- `docs/prd/academia/MVP-*.md` (MVP-00 a MVP-06) — requisitos por MVP: FR/NFR/BR/AC, slices, gates de entrada e checklists de execução.
- `docs/Especificação Completa — Plataforma Inteligente de Gestão para Academias.md` — visão ampla de origem. **Não é normativo**: onde conflitar com PRD, ADR ou `CONVENTION.md`, prevalece o documento mais específico.
- `docs/specs/` — spec por fatia (`SPEC-<nnn>-<slug>.md`), **ponteiro para a Slice do PRD** (ADR-022). Só o Cowork escreve. O escopo mora no PRD; a spec acrescenta decisões da fatia, escopo negativo, invariantes tocadas e perguntas ao PI.
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
