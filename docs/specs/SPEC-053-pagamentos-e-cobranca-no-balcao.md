# SPEC-053 — Pagamentos e cobrança no balcão (`admin-web`)

| campo | valor |
|---|---|
| **Fatia** | F53 |
| **MVP** | 3 *(posição na fila, decisão do PI em 23/08/2026)* — **conteúdo é `MVP-02`, Smart Billing** |
| **Slice do PRD** | não há. Herda requisitos do `MVP-02` §7 (Slices 2.1 e 2.4), §13 e §15 |
| **Recorte** | [`notes/2026-08-23-pagamento-nas-tres-superficies.md`](../notes/2026-08-23-pagamento-nas-tres-superficies.md) §4 |
| **Superfície** | `admin-web` · contrato de UI: `docs/design/DS-PAINEL.md` |
| **Card** | [#156](https://github.com/RodReis/arenahub/issues/156) |
| **Status** | `em-revisao` — escrita em 23/08/2026, aguardando o aceite do PI |
| **ADRs que alcança** | ADR-027 (modelo de `Payment`), ADR-032 (Sicoob PIX / Getnet cartão) |
| **Depende de** | **F55** para operar com dinheiro real — sem os adapters, roda contra o `FakePaymentProvider` |

> **Esta spec não é ponteiro.** As F53–F55 não têm Slice de PRD que as descreva — como as F49–F52,
> que nascem do ADR-042. O escopo mora aqui; requisito numerado (`M2-FR/BR/NFR/AC`) continua
> morando no `MVP-02` e **não é copiado**.

---

## 1. O que esta fatia entrega

A recepcionista atende alguém no balcão e resolve o pagamento **em uma tela só**, com o aluno
escolhendo a forma: **dinheiro, PIX ou cartão**.

Hoje o dinheiro só é visível dentro da ficha do aluno (`/students/[id]/billing`): é preciso saber
o nome antes de saber que existe fatura, e nenhuma tela responde *"o que vence esta semana"*.

---

## 2. Decisões do PI — 23/08/2026

| # | decisão | consequência |
|---|---|---|
| 1 | **O aluno escolhe a forma de pagamento no balcão:** dinheiro, PIX ou cartão | três caminhos na mesma tela, não três telas |
| 2 | **Cartão é checkout hospedado da Getnet** | a recepcionista gera o checkout; **o aluno digita o cartão no próprio celular**. Nenhum número de cartão passa pelo painel, pela recepcionista ou pelo backend |
| 3 | **Dinheiro em espécie é baixa manual** | `PaymentMethodKind.MANUAL`, com `recognizedByUserId`, teto de `manualPaymentLimitMinor` e auditoria (INV-072) |
| 4 | **PIX confirma sozinho** | cobrança PIX + webhook; a recepcionista **não dá baixa em PIX** |
| 5 | **Recibo em toda confirmação** | `POST /payments/:id/receipt` e `GET /receipts/:id` já existem e nenhuma tela os chama |
| 6 | **`wa.me` continua sendo do operador** | mesma decisão de 19/08: abre o WhatsApp da recepção, texto curto, **sem valor em reais** |

**Decisão 7, do PI em 23/08/2026 — dinheiro é cédula, e não há maquininha.** *Dinheiro* usa
`PaymentMethodKind.MANUAL` **sem campo novo**: com o cartão indo para checkout hospedado
(decisão 2) e a maquininha física descartada, `MANUAL` volta a significar uma coisa só —
**dinheiro em espécie recebido na recepção**. Nenhuma migration, nenhum enum novo.

> ⚠️ **A consequência, registrada agora para não virar arqueologia depois:** no dia em que
> entrar TED, transferência ou maquininha, `MANUAL` deixa de ser inequívoco — e os registros
> criados até lá **não terão o qualificador** que a leitura futura vai querer. É o preço aceito
> em troca de zero migration hoje; quem for acrescentar o qualificador precisa saber que o
> histórico anterior é `MANUAL` = espécie por definição, não por dado.

---

## 3. Escopo

### 3.0 Onde o fluxo começa — decisão do PI em 23/08/2026

> *"Pesquisa do aluno → aluno localizado → na grid vai ter uma coluna ação: colocar o ícone do
> pagamento, ir para página de pagar."*

**Metade disso já está no ar, e a spec anterior errou o alvo por não ter olhado.** A grid de
`/students` já tem a coluna **Ação** com quatro ícones (`acoes-do-aluno.tsx`), e o terceiro é
**a cédula — "Cobrança do aluno"**, com `aria-label`, `title` e alvo de 32 px, apontando para
**`/students/[id]/billing`**, que existe desde a F12.

**Consequências, e elas encolhem a fatia:**

1. **Não há rota nova.** A "página de pagar" **é** `/students/[id]/billing`. Criar
   `/students/[id]/pagar` ao lado dela produziria **duas telas de dinheiro do mesmo aluno** — e a
   segunda nasceria sem o histórico de invoices, pagamentos e entitlement que a primeira já
   mostra.
2. **Não há ícone novo.** O que muda é o que a página faz quando a recepcionista chega nela.
3. **`GET /api/v1/invoices` sai do caminho crítico.** Ele foi proposto para uma busca por fatura
   que **não é o fluxo**: quem chega ao balcão é o aluno, e a busca é a de alunos, que já existe.
   Ver §3.1.

**O que a página tem hoje** (F12/F13): lista de invoices com itens e pagamentos, entitlement,
*Gerar cobrança do mês* (idempotente, INV-066) e *Receber no balcão* via `SensitiveAction` com
motivo obrigatório.

**O que falta, e é esta fatia:** escolher a **forma de pagamento**, o QR do PIX na tela, o QR/link
do **checkout hospedado** de cartão, o acompanhamento da confirmação e o **recibo**.

### 3.1 Backend

- **`createHostedCheckout` na porta `PaymentProvider`** — a primeira cobrança no cartão. O
  `POST /invoices/:id/payments/card` da F14 cobra **método já tokenizado**, e no balcão o aluno
  ainda não tem cartão salvo. Implementado pelo adapter da **F55** e pelo `FakePaymentProvider`.
  ⚠️ Ver ADR-043 Decisão 5: essa chamada **não** pode ser `createTokenizedSubscription`.
- **`GET /api/v1/invoices` — proposta de CORTE desta fatia.** Ele está no `MVP-02` §13 e nunca foi
  implementado, mas com a entrada pela grid de alunos ele deixa de servir ao balcão: a visão
  "quem deve" já é `/billing/delinquency` (F15), e a visão agregada é a **F54**. Fica registrado
  como pendência do PRD, para quem precisar de drill-down no dashboard. **Se o PI quiser a lista
  transversal de faturas, ela volta — mas como tela de gestão, não como caminho do atendimento.**

### 3.2 A página de pagamento — `/students/[id]/billing`

- Abre com **o que este aluno deve agora** no topo: invoice em aberto ou vencida, valor,
  vencimento e dias de atraso. Histórico continua embaixo.
- `StateBadge` pelo dicionário do `DS-PAINEL` §7, valores em `tabular-nums`, `DataFreshness` em
  três estados.
- **Sem fatura em aberto**, a página não fica muda: mostra a situação e mantém *Gerar cobrança do
  mês*, que já existe e é idempotente.
- ⚠️ **`FUSO_PROVISORIO`**: a página fixa `America/Sao_Paulo` em código. A INV-144 manda o instante
  de bloqueio ser no fuso da unidade, **sem fallback para o tenant** — enquanto esse valor for
  fixo, a data que a recepção lê pode divergir da que o job de vencimento usa. Esta fatia **não
  pode ampliar a tela sem tratar isso**.

### 3.3 Fluxo "receber" — uma pergunta por vez

```
[forma de pagamento]
   ├── dinheiro → confirmar valor → baixa manual (ator, evidência, teto) → recibo
   ├── PIX      → gera cobrança  → QR + copia-e-cola na tela → aguarda webhook → recibo
   └── cartão   → gera checkout  → QR/link para o celular do aluno → aguarda webhook → recibo
```

- **A confirmação de PIX e cartão vem do backend, nunca do retorno visual** (`M2-BR-004`). A tela
  faz polling controlado; `getPaymentStatus` é o par de segurança quando o webhook atrasa.
- **Pagamento parcial não ativa plano** (`M2-BR-005`): sobra vira `account_credits` (ADR-027).
- **Fatura paga não volta a aberta** (`M2-BR-002`, INV-069): a ação some da linha.

### 3.4 Aviso in-app de vencimento e atraso

Faixa na ficha do aluno e marca na lista, derivada de `dueAt`, `blockAt` e `status` — **dado que
já está na resposta**. Sem tabela nova, sem provedor, sem push.

---

## 4. Escopo negativo

| o quê | para onde foi |
|---|---|
| Adapters reais de Sicoob e Getnet, e a tela de credenciais | **F55** |
| Pagamento no totem | **F52** (MVP 3.5), depois de F49 e F50 |
| Pagamento no app do aluno | **F25** (MVP 4), depois de F23 e F24 |
| Régua de cobrança, histórico de contato, promessa de pagamento | **F38** (MVP 6) |
| Lista transversal de faturas (`GET /api/v1/invoices`) | **cortada** — §3.1; volta como tela de gestão se o PI quiser |
| Rota `/students/[id]/pagar` separada | **não existe** — a página de pagamento é a de cobrança do aluno, §3.0 |
| API oficial de WhatsApp | fatia própria; o `wa.me` continua abrindo o app do operador |
| Push nativo | não entra — decisão do PI em 23/08 |
| Maquininha física / TEF | descartado pela decisão 2 |
| Edição de invoice paga | proibido por `M2-BR-002` |

---

## 5. Invariantes que esta fatia preserva

- **INV-065** — valores em centavos, inteiros; nunca `float`.
- **INV-072** — teto do pagamento manual (`manualPaymentLimitMinor`) **recusa**, não aprova.
- **INV-076** — idempotência por `(provider_account_id, external_payment_id)`.
- **INV-069** — estado terminal de pagamento não regride.
- **INV-098** — nenhuma coluna, log ou teste com PAN, CVV ou trilha. **O checkout hospedado é o
  que torna isto verdadeiro no balcão.**
- **INV-144** — instante de bloqueio no timezone da unidade. ⚠️ A tela do aluno usa
  `FUSO_PROVISORIO = 'America/Sao_Paulo'` fixo hoje; a lista nova **não** pode repetir o valor
  fixo sem registrar a dívida.

---

## 6. Aceite operacional

O PI olha e diz "aceito" quando, com um aluno de demonstração:

1. a recepcionista acha o aluno na **pesquisa de alunos**, clica no **ícone de cobrança da coluna
   Ação** e cai na página de pagamento — o caminho que o PI descreveu, e que já existe;
2. **dinheiro** → baixa manual registra ator e evidência, e o recibo abre;
3. **PIX** → o QR aparece, o pagamento confirma **pelo webhook**, e a tela muda sozinha;
4. **cartão** → o checkout abre no celular do aluno, e **nenhum campo de cartão existe no painel**;
5. valor acima do teto de pagamento manual é **recusado com erro de domínio**, não aprovado;
6. dez entregas do mesmo webhook produzem **uma** confirmação (`M2-AC-004`).

---

## 7. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Como o cartão é passado no balcão? | **Checkout hospedado da Getnet** — o aluno paga no próprio celular | 23/08/2026 |
| 2 | Dinheiro precisa de método próprio (`CASH`)? | **Não.** Dinheiro é espécie, sem maquininha — usa `MANUAL` | 23/08/2026 |
| 3 | Token de MVP: `[MVP3]` (fila) ou `[MVP2]` (conteúdo)? | `[MVP3]`, por posição na fila | 23/08/2026 |
| 4 | Onde o atendimento começa? | **Pesquisa de aluno → ícone de cobrança na coluna Ação → página de pagamento** | 23/08/2026 |
| 5 | A lista transversal de faturas ainda é necessária? | **em aberto** — proposta de corte em §3.1 | — |

---

## 8. Antes de codificar, confirme

- [ ] O PI aceitou esta spec
- [ ] A F55 está entregue **ou** está aceito que a fatia rode contra o `FakePaymentProvider`
- [x] A pergunta 2 da §7 está respondida — 23/08/2026, `MANUAL` para espécie
- [ ] A pergunta 5 da §7 está respondida (corte do `GET /api/v1/invoices`)

---

## 9. Antifraude da Getnet e o CPF — 23/08/2026

Achado dos documentos de `docs/integracao/`, analisados em
[`notes/2026-08-23-analise-integracao-getnet.md`](../notes/2026-08-23-analise-integracao-getnet.md) §5.

**Em produção, cartão sem `customer` completo é bloqueado pelo antifraude da Getnet** — nome,
e-mail, telefone, **CPF** e endereço de cobrança.

**Decidido pelo PI em 23/08/2026, registrado no ADR-043 Decisão 3: o CPF passa a ser obrigatório
no cadastro de aluno.** Isso **reverte** a decisão de 18/08 (*"CPF continua opcional"*) — e não
toca INV-009, INV-011 nem INV-012: a matrícula continua não dependendo do CPF, e o CPF continua
não sendo identificador de dispositivo.

**O que esta fatia herda disso:**

- A obrigatoriedade é **validação de aplicação** (API e tela), para cadastro novo e edição. A
  coluna `students.cpf` **continua anulável** — a base legada do Pacto tem pelo menos **308 alunos
  sem CPF** (1.618 CPFs para 1.926 alunos, ADR-034), e não há de onde inventá-lo.
- **Aluno legado sem CPF não paga com cartão.** O fluxo de cartão precisa dizer isso com todas as
  letras e oferecer o caminho: completar o cadastro ali mesmo, ou receber em espécie ou por PIX.
- **Endereço de cobrança** também é exigido pelo antifraude. A F45 já entregou
  `student_addresses`; o que falta é a tela conferir que ele existe antes de abrir o checkout.
- Pendência de cadastro **não bloqueia catraca** — a razão de negativa é lista fechada (ADR-024).

### 9.1 Mensagens de erro — o que a recepção lê

| situação | mensagem |
|---|---|
| recusa do emissor | "Pagamento recusado pelo emissor. Tente outro cartão." |
| antifraude bloqueou | "Não foi possível concluir. Confirme os dados do aluno." — **a palavra "antifraude" não aparece** |
| aluno legado sem CPF | "Este aluno ainda não tem CPF no cadastro. Complete o cadastro para pagar com cartão, ou receba em espécie ou PIX." |
| QR PIX expirado | "QR expirado. Gere um novo código." |
| API do provedor fora | banner de indisponibilidade, com a contingência combinada com a operação |

O código técnico fica em tooltip ou detalhe para o suporte, nunca na frase principal.

### 9.2 O que **não** vem dos documentos

Eles descrevem, para o `admin-web`, um **formulário de cartão digitado pelo atendente** com
PAN e CVV no browser do painel. **Isso está morto por duas razões:** a decisão do PI de 23/08
(checkout hospedado, o aluno digita no próprio celular) e o `MVP-02` §15 + `M2-AC-011` + INV-098,
que já proibiam PAN no nosso lado antes dessa conversa.
