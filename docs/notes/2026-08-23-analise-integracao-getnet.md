# Análise dos documentos de integração Getnet — 23/08/2026

> **Nota de análise do Cowork.** Insumo: os quatro arquivos de `docs/integracao/`
> (`SPEC - Integracao getnet.md`, mais os de `Web-Admin`, `Totem` e `Mobile`), lidos por inteiro.
> **Nenhum deles é normativo** enquanto conflitar com PRD, ADR aceito, `CONVENTION.md` ou com
> código já entregue — é a regra do `CLAUDE.md`. Esta nota diz o que aproveitar, o que colide e o
> que só o PI pode decidir.

---

## 1. O que os documentos entregam de valor, e é bastante

1. **A correção de premissa comercial.** *Ter maquininha Getnet ativa não significa ter credencial
   de e-commerce* — adquirência presencial e Plataforma Digital são produtos contratuais
   distintos, e `client_id`/`client_secret`/`seller_id` saem do time de Integração, não de um
   autoatendimento no site. Isso confirma e **datifica** o bloqueio que a `SPEC-055` já registrava
   como "insumo do PI".
2. **Qual API usar.** Global API (SEP, `docs.globalgetnet.com`, sandbox `api-sbx.globalgetnet.com`)
   contra a API Brasil legada (`api.getnet.com.br`) — com a pergunta certa a fazer no onboarding e
   a mitigação certa (paths em configuração, não em caso de uso).
3. **Antifraude obrigatório em produção** para cartão: `customer` completo e
   `additional_data.device` com `finger_print` do script da Getnet. Transação sem isso é bloqueada.
   **Este é o achado com maior efeito colateral no nosso cadastro** — §5.
4. **Semântica real do PIX:** o QR continua pagável depois de a tela sair do ar, e webhook atrasado
   pode chegar depois do `expired`. O tratamento proposto (polling antes de expirar, reversão para
   `approved`) é correto e é exatamente o que a `M2-BR-008` já exige.
5. **Descarte fundamentado do Get Smart.** Os deeplinks `getnet://pagamento/v3/payment` valem para
   app Android **dentro do POS da Getnet**; uma PWA num totem genérico não os invoca. O Anexo A
   guarda o cenário para o futuro. Fecha uma dúvida antes que ela custasse uma fatia.

---

## 2. O erro-raiz: os documentos foram escritos como se o backend fosse greenfield

`SPEC - Integracao getnet.md` §4 diz *"Novo módulo `billing` (ou `payments`) em `apps/api`"* e
propõe tabelas, máquina de estados, endpoints e casos de uso do zero.

**O módulo `billing` existe, com o MVP 2 inteiro entregue** — F12 a F16, entre 18 e 19/08/2026:
`invoices`, `payments`, `payment_attempts`, `payment_methods`, `provider_accounts`,
`provider_events`, `refunds`, `reconciliation_runs/items`, `external_movements`, `receipts`,
`account_credits`, a porta `PaymentProvider` com **oito** métodos e o `FakePaymentProvider` no
boundary. Há máquina de estados testada, idempotência por índice parcial (que já pegou uma
cobrança em dobro medida), retry configurável por tenant e conciliação com fila de divergências.

Adotar o desenho dos documentos **como está** criaria uma segunda modelagem financeira dentro do
mesmo módulo. Isso não é opinião de estilo: é a **regra de arquitetura nº 1** (uma fonte de
verdade) e o motivo pelo qual o ADR-027 existe.

**Consequência prática:** os documentos entram como **fonte de conhecimento sobre a Getnet**, não
como especificação de implementação. O que é da Getnet (auth, paths, campos, antifraude, webhook,
sandbox) é ouro e vai para a `SPEC-055`. O que é modelagem, endpoint interno e nome de tabela
**é substituído pelo que já está no banco**.

---

## 3. Conflitos materiais, e quem vence

| # | o documento diz | o repositório diz | quem vence |
|---|---|---|---|
| 1 | PIX pela Getnet (fase 2 inteira) | **ADR-032: PIX pelo Sicoob**, Getnet só cartão | **decisão do PI** — §4.1 |
| 2 | `payment` avulso com `amountCents` e `description` | `Payment.invoiceId` **obrigatório**; cadeia Pagamento → Invoice → Subscription → Entitlement (ADR-027, regra 1) | repositório |
| 3 | Tabelas `payment`, `saved_card`, `plan_mapping`, `subscription_charge`, `webhook_event` | as onze tabelas do MVP 2, entregues | repositório |
| 4 | PAN trafega pelo backend; **assume SAQ D** | `MVP-02` §15, `M2-AC-011`, INV-098: **tokenização hospedada**; e a decisão do PI de 23/08 (checkout hospedado) | repositório — §4.3 |
| 5 | Recorrência no **Subscriptions Engine da Getnet** | **F14 entregue**: invoice por período, retry `[0,3,7]` por tenant, `blockAnchor`, `PlanPrice.validFrom` | **decisão do PI** — §4.2 |
| 6 | `GETNET_SELLER_ID` em variável de ambiente | `ProviderAccount` por tenant e capacidade; INV-078 proíbe resolver tenant fora dela | repositório |
| 7 | Webhook autenticado por **Basic Auth** | `signingSecretEncrypted` (HMAC) e `M2-FR-007` + proteção a replay | repositório — §4.4 |
| 8 | `members`, `memberId`, `role: admin` | `students`; permissões nomeadas (`billing.read`, `billing.manage`…), não papéis no controller | repositório |
| 9 | Totem identifica por **CPF** e mostra pendências | `M4-FR-016`: **não usar apenas CPF como autenticação**; `M4-BR-007` e `DS-TOTEM` §11: sem valor nem pendência sem ação deliberada | repositório |
| 10 | Admin-web com **formulário de cartão digitado pelo atendente** | decisão do PI de 23/08: **checkout hospedado, o aluno digita no próprio celular** | PI, de hoje |
| 11 | Edge recebe "status de adimplência" para liberar catraca | o Edge recebe **entitlement**; a catraca nunca sabe o que é invoice (ADR-003, regra 1) | repositório |
| 12 | SSE `GET /payments/:id/events` | hoje existe `GET /payments/:id/status` (consulta ativa) | complementar — §6.3 |

**Nenhum desses itens torna os documentos inúteis.** Onze dos doze são tradução: o mesmo fluxo,
escrito contra o schema que existe. Os dois que **não** são tradução — PIX e recorrência — estão
na §4.

---

## 4. As decisões que só o PI toma

### 4.1 PIX: Sicoob (ADR-032) ou Getnet?

O **ADR-032** decidiu Sicoob para PIX porque *"a academia já recebe por lá"* — o dinheiro cai
direto na conta, sem intermediário. O documento assume PIX na Getnet e constrói a fase 2 inteira
em cima disso.

**O que pesa de cada lado, sem torcida:**

| | Sicoob (ADR-032) | Getnet |
|---|---|---|
| dinheiro | cai na conta da academia | passa pelo adquirente, com prazo e taxa dele |
| integração | mTLS com certificado, API do Sicoob — **nada disso está estudado** | mesma credencial, mesmo OAuth e mesmo webhook do cartão |
| esforço | **dois** adapters, dois webhooks, duas contas em `provider_accounts` | **um** adapter e um webhook |
| conciliação | dois extratos | um extrato |

Trocar para Getnet **simplifica a construção e encarece a operação**; manter Sicoob é o
inverso. A `ProviderAccount` já é por capacidade justamente para permitir os dois — a decisão não
é técnica, é de custo. **Se mudar, o ADR-032 é reaberto**; ele é ADR aceito e não se contradiz por
nota.

### 4.2 Recorrência: no ArenaHub (F14, entregue) ou no Subscriptions Engine da Getnet?

A **F14 já entregou** cobrança recorrente: o ArenaHub gera a invoice do período, cobra o cartão
tokenizado, aplica retry `D+0/D+3/D+7` **configurável por tenant** e a régua de inadimplência da
F15 (`blockAnchor`, carência, `PAYMENT_OVERDUE`).

O documento propõe entregar o ciclo à Getnet. **O que isso custa, e o documento admite:**

- **preço de plano vira imutável** — mudar valor = criar plano novo na Getnet + migrar
  assinaturas. O `PlanPrice.validFrom` do ArenaHub existe exatamente para versionar preço;
- **o retry passa a ser o da Getnet**, não o `[0,3,7]` que o PI escolheu em 19/08;
- **a régua de bloqueio depende do calendário do engine** — e o `M2-BR-007` manda bloquear no
  primeiro instante após vencimento + carência, no timezone da unidade;
- surge uma **segunda fonte de verdade de assinatura** (`getnet_subscription_id` com estado
  próprio) ao lado da nossa.

**Recomendação do Cowork, com o motivo:** manter a recorrência no ArenaHub e usar a Getnet como
**executor de cobrança de cartão tokenizado** — que é exatamente o que a F14 escreveu contra a
porta `PaymentProvider`. O engine da Getnet resolveria um problema que já está resolvido, e
cobraria em troca a nossa política comercial. **A decisão é do PI**; se ele escolher o engine, a
F14 é parcialmente refeita e isso precisa de ADR.

### 4.3 Cartão: PAN pelo backend (SAQ D) ou Checkout Iframe / hospedado?

O documento §3.1 é honesto: tokenização server-side **coloca o backend em escopo PCI DSS SAQ D**,
e registra o **Checkout Iframe** da Getnet como alternativa que tira o PAN do nosso servidor.

Não há o que decidir aqui, e o próprio PI já decidiu hoje: **checkout hospedado**. O
`MVP-02` §15 e o `M2-AC-011` já proibiam PAN no backend antes disso. **O que o documento traz de
novo é o nome do produto Getnet que atende** — é isso que entra na `SPEC-055`.

### 4.4 Webhook: Basic Auth basta?

O documento escolhe `user_credentials` (Basic) *"pela simplicidade"*. Basic autentica o
**remetente**, não o **corpo**: não há assinatura para verificar, e o `MVP-02` §15 exige proteção
contra replay. Se a Getnet oferecer HMAC ou mTLS, é o que usamos (a coluna
`signingSecretEncrypted` já espera isso). **Se Basic for o único modo disponível**, a compensação
é obrigatória e precisa estar na fatia: dedup por `(provider_account_id, external_event_id)` — que
já existe — **mais consulta ativa `getPaymentStatus` antes de aplicar qualquer efeito financeiro**.

---

## 5. O achado que ninguém previu: antifraude exige CPF, e o CPF é opcional aqui

O documento diz, e repete em três arquivos: em produção, cartão **sem** `customer` completo
(nome, e-mail, telefone, **CPF**, endereço de cobrança) e sem `device.finger_print` é **bloqueado
pelo antifraude**.

O ArenaHub decidiu o contrário, e de propósito: **CPF é opcional** (INV-009/011, decisão do PI em
18/08 na F45 — *"o mockup que o marcava obrigatório é que está errado"*). Endereço existe desde a
F45 (`student_addresses`), mas também não é obrigatório.

**Consequência concreta:** aluno cadastrado sem CPF **não paga com cartão** em produção. Ele paga
em espécie e por PIX, mas o cartão morre no antifraude — e a mensagem que volta é genérica, então
a recepção vai ver *"não foi possível concluir"* sem entender por quê.

**Três saídas, e a escolha é do PI:**

1. **CPF continua opcional**, e a tela de cartão **exige CPF e endereço na hora do pagamento** —
   pede o que falta, grava no cadastro, segue. Nada muda no cadastro; muda o fluxo de cobrança.
2. **CPF vira obrigatório** para quem tem plano pago — reabre a decisão de 18/08.
3. **Cartão só no app**, onde o aluno preenche o próprio dado.

A opção 1 é a que **não desfaz decisão nenhuma** e resolve o caso: quem paga em espécie ou PIX
nunca é incomodado.

---

## 6. Como isto entra nas nossas fatias

### 6.1 `SPEC-055` — é ela que absorve quase tudo

Entra: fase 0 comercial (credencial de e-commerce como produto separado da maquininha) · Global
API × API Brasil legada, com paths em configuração · OAuth `client_credentials` com cache de token
(~3600 s, sem refresh) · `x-seller-id` **por `ProviderAccount`, nunca em env** · antifraude e
`finger_print` · `soft_descriptor` · `idempotency_key` por tentativa · eventos de webhook a
assinar · modo de autenticação do webhook (§4.4) · sandbox, Postman e cartões de teste ·
monitoração do certificado TLS do endpoint (a Getnet para de entregar em silêncio se ele vencer).

**Não** entra: as tabelas do §4.1 do documento, os endpoints `/payments/card`, `/payments/pix`,
`/members/:id/cards`, `/plans/:id/getnet`, `/subscriptions/:id` — o ArenaHub já tem os seus, e o
`MVP-02` §13 é a lista canônica.

### 6.2 `SPEC-053` — balcão

Entra: **CPF e endereço de cobrança exigidos no fluxo de cartão** (§5, opção 1) · fingerprint
antifraude quando o checkout hospedado não o cobrir · mapa de mensagens de erro (recusa do
emissor, antifraude, QR expirado) — **sem expor a palavra "antifraude" ao balcão**, como o próprio
documento recomenda · contingência de maquininha física quando a API estiver fora.

**Não** entra: o formulário de cartão digitado pelo atendente (§3 item 10 — contraria a decisão do
PI de hoje).

### 6.3 `SPEC-052` — totem

O documento do totem **concorda** com o `MVP-04` Slice 4.6 (só PIX) e **discorda da decisão do PI
de hoje** (cartão por QR de checkout). Os dois cabem juntos sem furar PCI: **o totem exibe um QR e
não tem teclado de cartão** — se o QR for PIX ou um link de checkout hospedado, o totem continua
fora de escopo PCI e sem dado sensível.

Entra: semântica de cancelamento (*"cancelar" na tela não cancela a cobrança*) · pagamento
aprovado **depois** de a tela morrer ainda produz o efeito de negócio · sem fila local de
pagamento no totem, nunca · contador baseado no relógio do servidor, por delta — o totem não
confia no próprio clock (é o mesmo defeito do leitor facial em 17/08, que veio com `ocorridoEm`
congelado) · SSE com fallback para polling de 5 s.

**Não** entra: identificação por CPF (`M4-FR-016`) · exibir pendência antes de ação deliberada
(`M4-BR-007`) · **"diária" e "quitação de débito avulso"**, que pressupõem venda sem invoice — o
domínio não tem produto avulso, e criar um é escopo novo, não detalhe de integração.

### 6.4 `SPEC-025` (mobile, MVP 4)

Fica registrado, sem virar trabalho agora: `AppState → active` força `GET` do pagamento ao voltar
do app do banco (não confiar no SSE em background) · JWT em `SecureStore` · `FLAG_SECURE` na tela
de cartão · a régua de `past_due` como principal redutor de churn involuntário. ⚠️ O documento
afirma *"push notifications já existentes no app"* — **não existem**: não há app, nem módulo de
notificação na API.

---

## 7. O que fazer com `docs/integracao/`

Os quatro arquivos ficam onde estão, como **material de fornecedor** — o mesmo estatuto de
`docs/vendor/topdata/`. Eles não viram spec, não são citados como contrato e **não bloqueiam
ninguém**. Quando a `SPEC-055` for executada, ela cita este documento para o que é da Getnet e o
schema do repositório para o que é nosso.

**Uma pendência de higiene:** os quatro se referem a um documento-mãe chamado
`integracao-getnet-spec.md`, que não existe com esse nome — o arquivo é
`SPEC - Integracao getnet.md`. Quem for implementar vai procurar o nome errado.

---

## 8. Decisões do PI — 23/08/2026, registradas no **ADR-043**

As quatro perguntas da §4 foram respondidas no mesmo dia. **O ADR-043 é a fonte**; esta seção só
diz o que aconteceu com cada ponto desta análise.

| § | pergunta | resposta do PI |
|---|---|---|
| 4.1 | PIX: Sicoob ou Getnet? | **Sicoob agora, Getnet como plano B escrito.** O ADR-032 fica de pé; o gatilho de reabertura é o custo do mTLS medido na fase 0 |
| 4.2 | Recorrência: ArenaHub ou engine da Getnet? | **ArenaHub.** E entra escopo novo: *"quero a possibilidade de criar um plano com assinatura mensal"* → **modalidade de plano**, fatia **F56** |
| 4.3 | PAN no backend ou checkout hospedado? | **Checkout hospedado** — já era o que o `MVP-02` §15 exigia |
| 4.4 | Webhook por Basic Auth basta? | segue a ordem HMAC → mTLS → Basic, com compensação obrigatória se só houver Basic |
| 5 | CPF opcional × antifraude | **CPF passa a ser obrigatório no cadastro** — reverte a decisão de 18/08. Validação de aplicação; a coluna segue anulável por causa dos **308 alunos legados sem CPF** |
| 6.3 | totem: só PIX ou dois QRs? | **Dois QRs** — PIX e checkout de cartão. O `MVP-04` §7 Slice 4.6 foi emendado, autorizado pelo ADR-043 |

### 8.1 O que a análise achou e ninguém tinha pedido

Cruzar os documentos com o código revelou um **defeito latente na F14**, registrado como
**Decisão 5 do ADR-043**: a cobrança de invoice no cartão chama `createTokenizedSubscription` —
**uma vez por cobrança**. Contra o `FakePaymentProvider` isso passa; contra a Getnet real, cada
invoice instalaria uma **recorrência mensal viva**, e doze meses produziriam doze assinaturas
cobrando o mesmo aluno em paralelo. O ArenaHub sequer teria onde vê-las: o
`externalSubscriptionId` é gravado em `payment_attempts`, não em `Subscription`.

**A F55 não entrega adapter real sem separar os dois atos** — cobrança pontual com token salvo
contra recorrência instalada uma vez. É o tipo de defeito que só aparece quando o dublê sai, e é
exatamente por isso que ele estava invisível.
