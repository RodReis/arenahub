# Evidência — SPEC-007 / F7 · Aluno, plano e entitlement manual

> **Documento de evidência da fatia**, exigido pela Task 7 do plano de apoio
> (`docs/superpowers/plans/2026-08-14-mvp-01-02-students-entitlements.md`).
>
> Os números abaixo vieram de **execução**, não de prosa (`docs/TESTING.md` §5). Data e SHA
> ficam no log do CI e no histórico do Git — gravá-los aqui tornaria o arquivo impossível de
> manter conferido.

## 1. Ambiente de verificação

| item | valor |
|---|---|
| PostgreSQL | 17.10 (`postgres:17-alpine`, `infra/docker/docker-compose.yml`) |
| Node local | v24.15.0 — **acima do pin do repositório** (`.nvmrc` = 22) |
| Node no CI | 22, via `.nvmrc` |
| Prisma | 7.9.1, driver adapter `@prisma/adapter-pg` |
| NestJS | 11.2.0 · Zod 4.4.3 · Jest 29.7.0 · **fast-check 4.9.0** (novo nesta fatia) |

> ⚠️ A divergência de runtime local × CI continua valendo, com a mesma decisão do PI de
> 15/08/2026: **o CI é o árbitro** antes do merge.

## 2. Suítes e contagem

| suíte | comando | antes de F7 | após o backend | **após a interface** |
|---|---|---|---|---|
| unitário — API | `pnpm --filter @arenahub/api test` | 42 | **119** | 119 |
| unitário — painel | `pnpm --filter @arenahub/admin-web test` | 2 | 2 | **45** |
| integração — API | `pnpm --filter @arenahub/api test:integration` | 58 | **87** | 87 |
| integração — banco | `pnpm --filter @arenahub/database test:integration` | 11 | 11 | 11 |
| E2E — painel | `pnpm --filter @arenahub/admin-web test:e2e` | 10 | 22 | **39** |
| | **total** | 123 | **241** | **301** |

**106 testes no backend:** 77 unitários (dos quais **6 são propriedades** do fast-check, com
2.800 casos gerados) e 29 de integração.

**60 testes na interface:** 43 unitários sobre as funções puras de `src/students/formatar.ts`
(a única camada que o vitest cobre neste app — `app/` e `lib/` ficam para o E2E, por desenho) e
**17 E2E** percorrendo a jornada da recepção. Os 22 testes E2E anteriores (F6, F9, F11)
continuam verdes: a suíte completa fecha em 39.

## 3. Gate completo

Os oito comandos raiz, na ordem do `docs/TESTING.md` §6:

| comando | resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ 5 tasks |
| `pnpm typecheck` | ✅ 6 tasks |
| `pnpm test` | ✅ 238 testes (API 119 + edge-agent 119) |
| `pnpm test:integration` | ✅ 87 testes, 7 suítes |
| `pnpm build` | ✅ 4 tasks |
| `pnpm test:e2e` | ✅ 10 testes |
| `pnpm test:report --check` | ✅ relatório confere com a execução |

## 4. Rastreabilidade de requisitos

| requisito | como é verificado |
|---|---|
| `M1-FR-006` cadastrar aluno com validação e detecção de duplicidade | `students-membership.int-spec.ts` → *"aponta duplicata por CPF sem impedir o cadastro"*, *"recusa CPF com digito verificador invalido"* |
| `M1-FR-007` matrícula única e imutável no tenant | `students-membership.int-spec.ts` → *"gera matricula unica e sequencial sob 20 criacoes concorrentes"*, *"mantem contadores independentes por tenant"* |
| `M1-FR-008` arquivar preservando histórico e bloqueando acesso | `students-membership.int-spec.ts` → *"arquiva suspendendo entitlements e preservando a timeline"*, *"recusa nova assinatura para aluno arquivado"* |
| `M1-FR-009` plano com unidades, dias, horários e validade | `plan.spec.ts` (31 testes) + `students-membership.int-spec.ts` → *"recusa janelas sobrepostas"*, *"recusa janela apontando para unidade fora do plano"* |
| `M1-FR-010` criar, pausar, retomar e cancelar com auditoria | `students-membership.int-spec.ts` → *"pausa e retoma propagando ao entitlement"*, *"cancela revogando o entitlement"*, *"exige razao em toda alteracao de assinatura"* |
| `M1-FR-011` derivar entitlement explícito da assinatura e do plano | `students-membership.int-spec.ts` → *"deriva entitlement da assinatura na mesma transacao, com snapshot"* |
| `M1-FR-012` cortesia com razão, responsável e validade | `students-membership.int-spec.ts` → *"concede cortesia com razao e responsavel, sem assinatura"*, *"recusa cortesia sem razao"* |
| `M1-BR-001` CPF não é matrícula nem ID técnico | `identificacao.spec.ts` → *"nao contem nenhum trecho do CPF"* · `students-membership.int-spec.ts` → *"nao usa o CPF na matricula"* |
| `M1-BR-002` aluno `BLOCKED`/`CANCELLED`/`ARCHIVED` sem acesso normal | `entitlement.spec.ts` → *"nega para aluno BLOCKED, CANCELLED ou ARCHIVED..."* · propriedade *"aluno BLOCKED, CANCELLED ou ARCHIVED nunca e efetivo"* |
| `M1-BR-003` acesso depende de entitlement, não de assinatura | **Verificado por ausência de dependência**: `entitlement.ts` não importa `Subscription`. Ver §6 |
| `M1-BR-006` a política mais restritiva prevalece | `plan.spec.ts` → bloco *"interseccaoDeJanelas"* · propriedade *"interseccao de janelas nunca permite o que uma das partes nega"* |
| `M1-BR-010` exclusão administrativa é arquivamento | `student.spec.ts` → *"trata ARCHIVED como terminal"* · integração → *"arquiva suspendendo entitlements e preservando a timeline"* |

### `M1-AC-002` e `M1-AC-003`

> **Atualizado em 16/08/2026, com a entrega da interface.** O texto abaixo descrevia o estado
> após o PR #70 (backend). A Task 6 — interface de recepção — foi entregue no PR seguinte,
> mesma issue #7, e os dois AC passaram a ter cobertura de ponta a ponta.

O plano de apoio (Task 7 passo 3) manda mapear `M1-AC-002` e `M1-AC-003`. Depois do PR #70 eles
estavam cobertos **pela API** — a resposta de `POST /api/v1/subscriptions` devolve o entitlement
com unidades e janelas — e **não pela tela**; declará-los fechados naquele momento teria sido
fechamento frágil, e é por isso que a issue #7 continuou aberta.

Com a interface entregue, o aceite da Slice 1.2 (*"recepção cadastra aluno, atribui plano e
visualiza exatamente quando e onde o acesso é válido"*) fecha pelo caminho que o texto descreve
— pela recepção, sem `curl`:

| aceite | teste E2E que o prova |
|---|---|
| `M1-AC-002` recepção cadastra e encontra o aluno | *"a recepção cadastra um aluno e recebe a matrícula na hora"*, *"cadastra sem CPF — documento não é requisito de matrícula"*, *"encontra pelo nome e leva à ficha"* |
| `M1-AC-003` atribui plano e vê **quando e onde** o acesso vale | *"atribuir plano cria o direito e a ficha passa a mostrar onde e quando vale"* — asserta a unidade **pelo nome** e a janela como `Segunda, 06:00–22:00`, não `gymUnitId` em UUID e `startMinute: 360` |

A distinção do segundo teste não é cosmética: o aceite diz *"exatamente quando e onde"*. Uma
tela que imprimisse o UUID da unidade e o minuto do dia responderia a pergunta no papel e não
na recepção.

## 5. Invariantes tocados

Conforme `docs/REVIEW.md` §3, cada invariante tocado precisa de teste.

| invariante | teste |
|---|---|
| **INV-003** repositório recebe `TenantContext` obrigatório | Estrutural: todo método de `StudentRepository` e `MembershipRepository` tem `TenantContext` como primeiro parâmetro — não compila sem |
| **INV-006** tenant A não lê nem altera dado de B | `students-membership.int-spec.ts` → bloco *"isolamento entre tenants"* (4 testes) |
| **INV-009 / INV-011** matrícula nunca depende do CPF | `identificacao.spec.ts` → *"nao contem nenhum trecho do CPF"* |
| **INV-010** matrícula única e imutável no tenant | `@@unique([tenantId, membershipNumber])` + teste de 20 criações concorrentes |
| **INV-013** arquivar preserva histórico e bloqueia acesso | integração → *"arquiva suspendendo entitlements e preservando a timeline"* |
| **INV-014** cadastro detecta possível duplicidade | integração → *"aponta duplicata por CPF sem impedir o cadastro"* |
| **INV-015** soft delete não libera unicidade | A linha permanece; a constraint continua valendo. Coberto por INV-010 |
| **INV-033** `BLOCKED`/`CANCELLED`/`ARCHIVED` sem acesso normal | `entitlement.spec.ts` + propriedade dedicada |
| **INV-034** regra mais restritiva prevalece | `plan.spec.ts` + propriedade *"interseccao de janelas..."* |
| **INV-035** **entitlement expirado nunca retorna `ALLOW`** | `entitlement.spec.ts` → *"nega direito vencido mesmo com status ACTIVE (job de expiracao atrasado)"* · **propriedade** *"direito vencido nunca e efetivo, seja qual for o status gravado"* (500 casos) |
| **INV-059** regras `[indefinido]` do plano não são inventadas | Estrutural: `Plan` só tem unidades, dias, horários e validade. Sem campo para limite semanal, fidelidade ou multa |
| **INV-060** plano com unidades, dias, horários e validade | `plan.spec.ts` (31 testes) |
| **INV-061** assinatura manual com auditoria | integração → *"exige razao em toda alteracao de assinatura"* + `AuditLog` em cada comando |
| **INV-062** entitlement derivado explicitamente | integração → *"deriva entitlement da assinatura na mesma transacao, com snapshot"* |
| **INV-063** cortesia exige razão, responsável e validade | integração → *"recusa cortesia sem razao"* |
| **INV-064** modelo suporta as nove origens (ADR-009) | `EntitlementSource` no schema, enum extensível |
| **INV-084** evento na mesma transação da mudança de estado | integração → *"recusa transicao invalida sem deixar rastro parcial"*, *"deriva entitlement... na mesma transacao"* |

## 6. `M1-BR-003` / INV-030 — verificado por ausência

A regra de arquitetura nº 1 diz que **a catraca nunca consulta assinatura**. Isso não se prova
com asserção: prova-se mostrando que o caminho de decisão **não tem como** chegar lá.

- `entitlement.ts` — o módulo que decide efetividade — importa apenas `student.js` (status do
  aluno) e `plan.js` (janelas). **Não importa `Subscription`, `Invoice` nem `Payment`.**
- `direitoEhEfetivo()` recebe `DireitoDeAcesso`, cujos campos são status, validade e janelas do
  **snapshot**. Não há referência a `subscriptionId` na decisão.
- O snapshot é congelado na derivação: a propriedade *"mutar o plano depois da derivacao nao
  altera a decisao"* prova que nem o plano vivo influencia.

**O que isso não prova:** F9 ainda não existe. Quando o motor de decisão nascer, esta ausência
precisa ser reverificada — é fácil um `include: { subscription: true }` entrar sem ninguém notar.

## 7. Escopo negativo — o que esta entrega não faz

| item | onde foi |
|---|---|
| ~~**Interface de recepção** (Task 6 do plano)~~ | ✅ **Entregue em 16/08/2026**, PR seguinte na mesma issue #7 — ver §10 |
| ~~`M1-AC-002` e `M1-AC-003` fechados em E2E~~ | ✅ **Entregues** — ver §4 |
| **Componente de Toast** (`CLAUDE.md` → *Convenções de código*) | **Não implementado, e não por esquecimento.** Ver §10 |
| Edição de dados cadastrais do aluno | Nenhuma rota de `PATCH /students/:id` existe além de `/status`. Corrigir nome ou contato exige rota nova — fatia futura, não escopo desta |
| Busca de aluno por CPF | O CPF é guardado só como hash; buscar por ele exige rota nova. A tela **avisa** a limitação em vez de deixar a recepção concluir que o aluno não existe |
| Desativar plano pela interface | Não há rota de `PATCH /plans/:id`. `isActive` é exibido, não editável |
| Cortesia (`POST /entitlements/courtesy`) pela interface | A rota existe desde o PR #70 e **não ganhou tela**: o aceite da Slice 1.2 fala em atribuir *plano*. Tela de cortesia sem `M1-FR` que a peça seria inventar produto |
| Endpoint de merge de duplicatas | Fora do plano de apoio, por decisão dele: *"No merge endpoint is included"* |
| Job de expiração agendada de entitlement | Não há scheduler no repositório. A guarda por data em `direitoEhEfetivo` torna a expiração **correta mesmo sem o job** — o status fica desatualizado, a decisão não |
| Limite de 30 dias para cortesia sem permissão OWNER | O plano de apoio pede; **não há `M1-FR` nem invariante que o sustente**. Escrever a regra sem fonte seria inventar produto — pergunta ao PI |
| `PAST_DUE` de assinatura | Existe no enum, **não é alcançável no MVP 1** (`CONVENTION.md` §3.2). Chega com o MVP 2 |
| Endereço do aluno (`StudentAddress`) | Tabela criada, **sem rota**. Nenhum `M1-FR` a exige nesta fatia |
| **`Idempotency-Key` em `POST /subscriptions`** | **Não implementado.** Ver abaixo — limitação conhecida, não esquecimento |

### Limitação conhecida: ativação de assinatura não é idempotente

`POST /api/v1/subscriptions` chamado duas vezes com a mesma entrada cria **duas assinaturas e
dois entitlements**. Não há chave natural que distinga *"o operador clicou duas vezes"* de
*"o aluno contratou um segundo plano"* — as duas coisas são legítimas.

O INV-087 prevê `Idempotency-Key` para operações assim, mas **nenhuma rota do repositório o
implementa hoje**, nem F6 nem F7. Criá-lo dentro desta fatia seria decidir uma regra de
plataforma dentro de uma feature.

**Consequência aceita:** duplo clique na recepção gera duas assinaturas, ambas visíveis na
timeline do aluno — erro que o operador enxerga e corrige. Não há corrupção silenciosa, e o
entitlement duplicado é aditivo (dois direitos válidos), nunca contraditório.

**Sugestão ao PI:** `Idempotency-Key` transversal merece card `[INFRA]` próprio, antes de F12
(onde o mesmo problema envolve dinheiro e deixa de ser cosmético).

## 8. Decisão de fatia registrada — transições do `Student`

O `docs/CONVENTION.md` §3.1 declara as transições de `Student` como **`[indefinido]`** e manda
defini-las *"na spec de F7"*. **A SPEC-007 §2 saiu vazia** — o Cowork não as definiu.

A tabela implementada em `apps/api/src/modules/students/domain/student.ts`
(`TRANSICOES_DE_ALUNO`) vem do **plano de apoio** (Task 2), que é material de apoio e **não é
contrato**. Adotada nesta fatia por decisão do PI em 15/08/2026:

```text
LEAD      -> TRIAL | ACTIVE | CANCELLED | ARCHIVED
TRIAL     -> ACTIVE | CANCELLED | ARCHIVED
ACTIVE    -> SUSPENDED | BLOCKED | CANCELLED | ARCHIVED
SUSPENDED -> ACTIVE | BLOCKED | CANCELLED | ARCHIVED
BLOCKED   -> ACTIVE | CANCELLED | ARCHIVED
CANCELLED -> ACTIVE | ARCHIVED
ARCHIVED  -> (terminal)
```

> 📌 **Pendência para o Cowork:** o `CONVENTION.md` §3.1 precisa da emenda correspondente. O
> arquivo é dele (ADR-021); corrigi-lo daqui seria a erosão que o próprio ADR nomeia.

**Nota sobre `SUSPENDED`:** o aluno suspenso **continua elegível** a acesso normal. INV-033 e
`M1-BR-002` listam exatamente três estados sem acesso — `BLOCKED`, `CANCELLED`, `ARCHIVED` — e
`SUSPENDED` não está entre eles. Incluí-lo seria inventar regra que nenhum documento pede. Se a
intenção do produto for outra, é decisão do PI e vira emenda.

## 9. Bug encontrado e corrigido na revisão

A revisão de código antes do commit achou uma **condição de corrida real** — não hipotética.

**O bug:** `ativarAssinatura` e `concederCortesia` liam o status do aluno **fora** da transação e
criavam o entitlement **dentro** dela. Entre as duas operações, um arquivamento concorrente
passava despercebido: o `alterarStatus` suspende os entitlements *existentes*, e não via o que
ainda não havia sido criado. Resultado: **aluno `ARCHIVED` com entitlement `ACTIVE`** — violação
direta de INV-033, sem ninguém ter escrito uma linha errada.

**A correção:** `travarAlunoElegivel()` refaz a checagem dentro da transação, com
`SELECT ... FOR UPDATE` na linha do aluno. O arquivamento concorrente espera o commit e então
enxerga o entitlement que precisa suspender.

**A prova de que o teste pega o bug:** removi o lock e rodei a suíte — o teste *"nunca deixa
aluno arquivado com entitlement ativo, mesmo sob corrida"* falhou com `Expected: 0, Received: 1`.
Com o lock de volta, passa. Um teste de concorrência que nunca foi visto falhando não prova nada;
este foi.

## 10. Teste instável corrigido — o CI pegou o que a máquina local escondia

O primeiro CI **falhou** no teste das 20 criações concorrentes, com `read ECONNRESET`. Local,
passava 3 de 3 — máquina rápida escondia o problema.

**A causa não era o lock.** O teste disparava 20 requisições HTTP simultâneas contra um pool `pg`
de 10 conexões: as excedentes esperavam a transação anterior liberar (comportamento correto), e
no runner mais lento do CI o socket do supertest caía antes da resposta. O teste media **o
transporte junto com a regra**, e o transporte era a parte frágil.

**A correção:** a concorrência passou a ser exercida direto no `StudentRepository`, sem HTTP. A
disputa que importa — 20 transações sobre a mesma linha de contador — continua idêntica; o que
saiu foi a disputa por socket. A cobertura HTTP da mesma rota permanece nos outros testes do
arquivo.

De quebra, a asserção ficou **mais forte**: além de unicidade (`Set.size === 20`), agora exige
20 sequenciais **consecutivos** (`max - min === 19`) — o que prova ordem, e não só ausência de
repetição.

**Reverificado:** removi o `FOR UPDATE` e o teste voltou a falhar; com ele, passa.

## 11. Decisões técnicas que merecem revisão

1. **CPF não é persistido em claro.** Guardamos `cpfHash` (SHA-256 com pimenta por tenant, para
   comparar igualdade) e `cpfLast3` (para a recepção conferir). Uma fatia futura que precise
   exibir o CPF completo exige decisão do PI e cifra reversível — não um `ALTER TABLE`.
2. **Matrícula por contador travado.** `SELECT ... FOR UPDATE` na linha de `StudentSequence`,
   dentro da transação de criação. `COUNT(*)` reusaria número após arquivamento; `SEQUENCE` do
   Postgres é global e vazaria volume entre tenants.
3. **Fim de janela e `endsAt` são exclusivos.** `08:00-12:00` não permite entrar às 12:00. Sem
   isso, duas janelas encostadas fariam o instante pertencer a ambas, e "mais restritiva
   prevalece" perderia resposta única.
4. **Virada de dia entra como duas janelas.** `22:00-02:00` é recusado como intervalo único;
   vira `22:00-24:00` + `00:00-02:00`. Aceitar fim menor que início obrigaria todo consumidor —
   inclusive o motor de F9 — a lembrar do caso especial.
5. **DST registrado em teste.** `America/Sao_Paulo` não tem mais horário de verão (Decreto
   9.772/2019); o teste fixa isso e falha se a base IANA mudar. Um segundo teste usa
   `America/New_York` para provar que a conversão acompanha DST de verdade, e não offset fixo.

---

## 12. Interface da recepção — entrega de 16/08/2026

Segunda entrega da mesma issue #7, fechando a Task 6 do plano de apoio. **Nenhuma rota nova de
API:** as nove do PR #70 já cobriam o aceite; esta fatia é interface consumindo o que existe.

### 12.1 Telas

| rota | o que resolve |
|---|---|
| `/students` | busca por nome, matrícula ou contato; paginação |
| `/students/novo` | cadastro, com aviso de possível duplicata |
| `/students/[id]` | ficha: acesso agora, direitos com unidade e janela, atribuir plano, mudar situação |
| `/students/[id]/timeline` | histórico administrativo |
| `/plans` | listagem e cadastro de plano com janelas de horário |

`Alunos` e `Planos` entraram na navegação depois de `Dispositivos` — a ordem do menu é a do
turno, e cadastro vem depois do que responde "a catraca está de pé".

**Efeito colateral desejado:** `students/[id]/biometrics` (F8) era rota órfã — existia sem
nenhuma tela que levasse até ela. A ficha fechou esse caminho.

### 12.2 Decisão de fatia: Toast não foi implementado

O `CLAUDE.md` → *Convenções de código* diz: *"Não usar Alert para msg, sempre usar Toast para:
Info, Warn e error."* **Esta fatia não implementou Toast**, por decisão do PI em 16/08/2026.

O motivo é que a regra já estava não implementada antes desta fatia, e cumpri-la aqui custaria
mais do que parece:

- as telas de F6, F9 e F11 — mergeadas e em uso — comunicam erro e status por **texto inline
  com `role="alert"` / `role="status"`**, que é o mecanismo `aria-live` equivalente;
- o `admin-web` **não tem uma linha de CSS**: nem Tailwind, nem CSS Modules, nem `className`.
  Toast flutuante exigiria a primeira camada visual do produto;
- o `docs/DESIGN-UI.md` está `RASCUNHO`, com 8 decisões abertas na §17. Criar a primeira
  identidade visual dentro de uma fatia de cadastro seria decidir design sem o PI.

**Consequência aceita:** F7 segue o padrão das telas já aceitas. A regra do `CLAUDE.md`
permanece válida e **não cumprida em nenhuma tela do repositório** — o débito é anterior a esta
fatia e não foi ampliado por ela.

**Sugestão ao PI:** Toast + base de CSS merecem card `[INFRA]` próprio, depois que o
`DESIGN-UI.md` sair de `RASCUNHO`. Fazê-lo antes produz um componente que será refeito.

### 12.3 Espelho de regra de domínio no cliente, e o que o prende

`src/students/formatar.ts` carrega duas cópias de regra que **nasce no servidor**:

| espelho | por que existe | o que impede a divergência |
|---|---|---|
| `TRANSICOES_DE_SITUACAO` | o select só oferece o que a API aceita; sem ele a recepção escolhe destino inválido e leva 409 depois do clique | teste que compara a tabela inteira com `TRANSICOES_DE_ALUNO`, transição por transição |
| `impedeAcesso` | avisa **antes** da tentativa que a situação do aluno bloqueia acesso | teste que fixa INV-033: `SUSPENDED` **não** impede |

**A divergência já aconteceu nesta fatia.** A primeira versão da tabela do cliente inventou
`TRIAL → BLOCKED` e `BLOCKED → SUSPENDED`, que o domínio não permite. O E2E pegou; o teste de
espelho foi escrito depois, para que a próxima divergência falhe no CI e não na recepção.

O que estes espelhos **não** fazem: decidir acesso. Quem decide é o Access Decision Engine
(ADR-004). `vigenteAgora()` responde só vigência — status e intervalo — e não avalia janela nem
unidade, justamente para não criar uma segunda verdade sobre a decisão.

### 12.4 Bugs encontrados pelos próprios testes

1. **`diaDaSemana(0)` devolvia string vazia.** O array tinha casa vazia no índice 0 para alinhar
   com `dayOfWeek` 1..7, e `?? '—'` não pega string vazia — só `null`/`undefined`. A célula
   sairia em branco, parecendo dado faltando em vez de dado inválido. Pego pelo teste unitário
   antes de qualquer tela existir.
2. **Espelho de transições divergente do domínio** — ver §12.3. Pego pelo E2E.

### 12.5 Achados da revisão, corrigidos antes do commit

| gravidade | achado | correção |
|---|---|---|
| **GRAVE** | falha da consulta de direitos virava `[]`, e a ficha dizia **"Sem direito de acesso vigente"** para um aluno que podia ter direito ativo — a API tinha caído, não o dado | falha de `/entitlements` agora é estado de erro explícito. Planos e unidades, que são acessórios, avisam a própria limitação em vez de derrubar a ficha |
| ATENÇÃO | `version` obsoleta: duas alterações de situação seguidas, sem recarregar, faziam a segunda falhar com *"alguém alterou este aluno enquanto você editava"* — sem ninguém mais envolvido | a action devolve a `version` nova e o componente passa a usá-la. E2E dedicado prova o caminho **sem** reload no meio |
| ATENÇÃO | `alterarAssinatura` exportada sem nenhum consumidor | removida. O aceite da Slice 1.2 fala em *atribuir* plano; administrar ciclo de vida de assinatura é escopo de outra fatia — e a rota exige uma `version` que o `EntitlementDto` não entrega |

A revisão de segurança separada não achou bloqueio nem grave: `tenant_id` nunca sai do corpo do
formulário, CPF só trafega mascarado na leitura, nenhuma PII em log ou `data-testid`, e as
quatro Server Actions validam com Zod antes de chamar a API.

### 12.6 Verificação desta entrega

| comando | resultado |
|---|---|
| `pnpm --filter @arenahub/admin-web lint` | ✅ |
| `pnpm --filter @arenahub/admin-web typecheck` | ✅ |
| `pnpm --filter @arenahub/admin-web test` | ✅ **45 testes** (2 antes da fatia; 43 novos) |
| `pnpm --filter @arenahub/admin-web build` | ✅ 5 rotas novas registradas |
| `pnpm --filter @arenahub/admin-web test:e2e` | ✅ **39 testes** — 17 novos, 22 anteriores intactos |

O E2E sobe **API e banco reais** (`playwright.config.ts` levanta os dois processos): um teste que
mockasse a API provaria que a tela funciona contra um dublê, não que a fatia funciona.

> ⚠️ **Nota de ambiente:** rodar o E2E local exige que **não haja `pnpm dev` ocupando as portas
> 3000 e 3344**. Com `reuseExistingServer` fora do CI, o Playwright reaproveita o dev server, e
> o overlay de erro do Next (`<nextjs-portal>`) intercepta os cliques — os testes falham por
> motivo que não é o código. No CI o problema não existe, porque lá nada está de pé antes.
