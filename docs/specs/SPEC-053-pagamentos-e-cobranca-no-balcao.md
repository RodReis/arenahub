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
| 3 | **Dinheiro é baixa manual** | `PaymentMethodKind.MANUAL`, com `recognizedByUserId`, teto de `manualPaymentLimitMinor` e auditoria (INV-072) |
| 4 | **PIX confirma sozinho** | cobrança PIX + webhook; a recepcionista **não dá baixa em PIX** |
| 5 | **Recibo em toda confirmação** | `POST /payments/:id/receipt` e `GET /receipts/:id` já existem e nenhuma tela os chama |
| 6 | **`wa.me` continua sendo do operador** | mesma decisão de 19/08: abre o WhatsApp da recepção, texto curto, **sem valor em reais** |

**Decisão de modelagem que esta spec propõe e o PI precisa confirmar:** *dinheiro* usa
`PaymentMethodKind.MANUAL` **sem campo novo**. Com o cartão indo para checkout hospedado
(decisão 2), não existe mais "cartão na maquininha registrado à mão" — `MANUAL` volta a
significar uma coisa só: dinheiro recebido na recepção. Criar um `CASH` separado só faria sentido
se a maquininha física entrasse, e ela não entrou.

---

## 3. Escopo

### 3.1 Backend

- **`GET /api/v1/invoices`** — lista do tenant, com filtro por `status`, período de vencimento,
  unidade, aluno e método, ordenação e paginação. **O `MVP-02` §13 já prevê este endpoint e ele
  nunca foi implementado**: existem só `GET /students/:id/invoices` e `GET /invoices/:id`.
  Permissão `billing.read`.
- **`POST /api/v1/invoices/:id/payments/card`** já existe (F14) e cobra **método tokenizado
  existente**. O balcão precisa do caminho de **primeira** cobrança: gerar um **checkout hospedado**
  da Getnet para uma invoice e devolver a URL — método novo na porta `PaymentProvider`
  (`createHostedCheckout`), implementado pelo adapter da **F55** e pelo `FakePaymentProvider`.
  A ampliação da porta segue o precedente da emenda de 19/08 (`listMovements`/`getRefundStatus`).

### 3.2 Tela `/billing/invoices`

- Lista com busca por aluno, filtros persistentes na URL, `StateBadge` pelo dicionário do
  `DS-PAINEL` §7, valores em `tabular-nums` (§3 do mesmo documento).
- Ações na linha: **receber** (abre o fluxo da §3.3), abrir recibo, `wa.me`, abrir a ficha.
- `DataFreshness` em três estados, nunca colapsados (`DS-PAINEL` §8.2).

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

1. a recepcionista **acha a fatura pela busca**, sem abrir a ficha do aluno;
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
| 2 | Dinheiro precisa de método próprio (`CASH`)? | **em aberto** — proposta: usar `MANUAL`, §2 | — |
| 3 | Token de MVP: `[MVP3]` (fila) ou `[MVP2]` (conteúdo)? | `[MVP3]`, por posição na fila | 23/08/2026 |

---

## 8. Antes de codificar, confirme

- [ ] O PI aceitou esta spec
- [ ] A F55 está entregue **ou** está aceito que a fatia rode contra o `FakePaymentProvider`
- [ ] A pergunta 2 da §7 está respondida
