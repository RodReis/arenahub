# F53 — Pagamentos e cobrança no balcão (`admin-web`) · design

| campo | valor |
|---|---|
| **Fatia** | F53 · `SPEC-053` · card [#156](https://github.com/RodReis/arenahub/issues/156) |
| **Superfície** | `admin-web` (`docs/design/DS-PAINEL.md`) + `apps/api` |
| **Spec** | [`docs/specs/SPEC-053-pagamentos-e-cobranca-no-balcao.md`](../../specs/SPEC-053-pagamentos-e-cobranca-no-balcao.md) |
| **Data** | 23/08/2026 |
| **Decisões do PI nesta sessão** | quatro, registradas na §1 |

---

## 1. Decisões do PI tomadas nesta sessão — 23/08/2026

Elas **alteram** a spec, que fica emendada na entrega.

| # | pergunta | decisão | consequência |
|---|---|---|---|
| 1 | `GET /api/v1/invoices` — a spec §3.1 propunha **cortar** | **implementar nesta fatia** | a lista transversal de faturas entra; a §7 pergunta 5 da spec fecha com "implementado na F53", e o escopo negativo perde a linha do corte |
| 2 | `FUSO_PROVISORIO` fixo na tela | **resolver pelo fuso da unidade do aluno** | INV-144 deixa de ser dívida nesta tela. **Sem migration**: `gym_units.timezone` existe desde o ADR-019 e `students.gym_unit_id` desde a F45 |
| 3 | como a tela sabe que o PIX/cartão confirmou | **polling de uma leitura barata**, não WebSocket | ver §2.1 — e o porquê de não ser a rota que já existe |
| 4 | CPF obrigatório (ADR-043 dec. 3) | **dentro desta fatia**, não card próprio | valida no `POST`/`PATCH` de aluno; a coluna segue anulável |

---

## 2. O que o desenho evita — os dois achados que mudaram o rumo

### 2.1 `GET /payments/:id/status` **não serve para polling**

A rota existe e a leitura óbvia seria consultá-la a cada 3 s enquanto o QR está na
tela. Ela **bate no provedor a cada chamada** — a docstring do
`ConsultarStatusDePagamentoUseCase` diz, com todas as letras, que é *"o caminho de
quem não pode esperar"*: escrita para o excepcional, não para o laço.

Polling nela custaria ~20 chamadas externas por minuto de QR aberto, **por caixa**.
Sicoob e Getnet cobram e limitam por taxa, e **o `FakePaymentProvider` não tem rate
limit** — é o desenho que passa verde em dev e quebra em produção sem avisar.

**Resposta:** separar leitura barata de consulta ativa.

- `GET /api/v1/payment-attempts/:id` — **só o nosso banco**, que o webhook já
  escreveu. É o que o laço consulta.
- `GET /payments/:id/status` — **intocada**. Vira o botão *"Conferir com o banco"*,
  no máximo uma chamada ao provedor por atendimento.

### 2.2 O índice parcial da F14 pode não cobrir o checkout hospedado

A F14 fechou a cobrança duplicada no cartão com
`UNIQUE (tenant_id, invoice_id) WHERE method = 'CARD' AND status = 'PROCESSING'` —
depois de medir dois sucessos concorrentes e um aluno cobrado em dobro.

O checkout hospedado é **outro caminho de escrita para a mesma invoice**. Se ele cair
fora do predicado do índice, é o mesmo defeito renascendo por outra porta.

**Isto é hipótese, não conclusão.** Vai ser **medido** com `Promise.allSettled`
contra Postgres real antes de qualquer afirmação, e o índice provado por mutação
(`DROP INDEX` tem de derrubar o teste). Ver §5.3.

---

## 3. Backend

### 3.1 `createHostedCheckout` — nono método da porta `PaymentProvider`

Primeira cobrança no cartão: no balcão o aluno **ainda não tem cartão salvo**, e o
`POST /invoices/:id/payments/card` da F14 cobra método **já tokenizado**.

⚠️ **Não** pode ser `createTokenizedSubscription` — ADR-043 Decisão 5.

- **Entrada:** `externalAccountId`, `amountMinor`, `currency`, `idempotencyKey`,
  `expiresAt`, `descricao` e o `customer` que o antifraude exige (nome, e-mail,
  telefone, CPF, endereço de cobrança).
- **Saída:** `externalPaymentId`, `checkoutUrl`, `qrCodeDataUri`, `expiresAt` —
  **mesma forma de `PixCharge`**, porque no balcão os dois viram QR na tela.
- Implementado pelo `FakePaymentProvider`. **Adapter real é F55**.

### 3.2 Caso de uso `criar-checkout-de-cartao`

Espelha `criar-cobranca-pix`:

- Conta resolvida **por capacidade** (`CARD`), nunca por marca — o resolvedor da F14
  já faz isso, e nenhum caso de uso menciona `getnet` ou `sicoob`.
- `PaymentAttempt` gravado com idempotência (INV-076).
- **Recusa antes de chamar o provedor** quando falta CPF ou endereço:
  `STUDENT_BILLING_DATA_INCOMPLETE` (422) com a lista do que falta. Chamar a Getnet
  sem isso gasta requisição para receber bloqueio de antifraude.

### 3.3 `GET /api/v1/payment-attempts/:id` — leitura barata

Só o banco. Escopo de tenant no `where`. Devolve `status`, `invoiceStatus`, `paidAt`,
`expiresAt` e `receiptId` quando já emitido.

### 3.4 `GET /api/v1/invoices` — decisão 1 do PI

Lista transversal do tenant, paginada, filtros por `status` e período de vencimento.
Permissão `invoice.read`, a mesma da rota por aluno.

### 3.5 Fuso da unidade — decisão 2 do PI

`GET /students/:id/invoices` passa a devolver o `timezone` da unidade de origem do
aluno. **Sem migration.** Aluno sem unidade não existe: a F45 tornou a coluna
`NOT NULL`, e o `SET NOT NULL` daquela migration é a garantia.

### 3.6 CPF obrigatório — decisão 4 do PI

Validação de **aplicação** no `POST` e no `PATCH` de aluno (ADR-043 Decisão 3).

A coluna `students.cpf` **continua anulável**: a base do Pacto tem pelo menos 308
alunos sem CPF (1.618 para 1.926, ADR-034) e não há de onde inventá-lo. Eles seguem
existindo e são barrados **apenas no cartão**.

Não toca INV-009, INV-011 nem INV-012: a matrícula continua sem depender do CPF, e o
CPF continua não sendo identificador de dispositivo.

---

## 4. Frontend — `/students/[id]/billing`

**Nenhuma rota nova, nenhum ícone novo** (spec §3.0). A grid de `/students` já tem a
coluna Ação com a cédula apontando para cá desde a F12.

### 4.1 O topo responde "o que este aluno deve agora"

Hoje a página abre com o histórico. Passa a abrir com a invoice em aberto/vencida em
destaque — valor, vencimento, dias de atraso —, e o histórico desce. Sem fatura
aberta a página não fica muda: mostra a situação e mantém *Gerar cobrança do mês*,
que já existe e é idempotente (INV-066).

### 4.2 O "receber" passa a perguntar a forma primeiro

O `PainelDeCobranca` atual pula direto para valor + `SensitiveAction` — que é o
caminho do **dinheiro**. Passa a ser uma pergunta por vez:

```
[forma]
   ├── dinheiro → valor → SensitiveAction (motivo) → baixa manual → recibo
   ├── PIX      → cobrança → QR + copia-e-cola → polling → recibo
   └── cartão   → checkout → QR/link no celular do aluno → polling → recibo
```

- **Dinheiro** é o fluxo de hoje, **intocado**.
- **Cartão sem CPF ou endereço:** a opção aparece **desabilitada com o motivo**, não
  some. Sumir faz a recepcionista procurar o que não está lá. Mensagem da spec §9.1,
  com atalho para completar o cadastro.

### 4.3 Polling — decisão 3 do PI

3 s contra `/payment-attempts/:id`, **só enquanto o QR está na tela**. Para no estado
terminal ou quando expira. QR expirado diz *"Gere um novo código"* em vez de girar
para sempre. *"Conferir com o banco"* chama a consulta ativa para quem não quer
esperar.

**A confirmação vem do backend, nunca do retorno visual** (`M2-BR-004`).

### 4.4 Recibo, cartão e fuso

- **Recibo em toda confirmação**, nos três caminhos. `POST /payments/:id/receipt` e
  `GET /receipts/:id` existem e **nenhuma tela os chama** hoje.
- **Nenhum campo de cartão em lugar nenhum do painel** (INV-098).
- `FUSO_PROVISORIO` **morre**; a página usa o fuso que a API passa a devolver.

### 4.5 Aviso de vencimento

Faixa na ficha do aluno e marca na lista, derivadas de `dueAt`, `blockAt` e `status`
— dado que **já vem na resposta**. Sem tabela nova, sem provedor, sem push.

---

## 5. Testes

### 5.1 Domínio (puro)

Máquina do recebimento: forma escolhida → o que pode acontecer. Teto do pagamento
manual **recusa**, não aprova (INV-072). Estado terminal não regride (INV-069).
Sobrepagamento vira `account_credits` e **não** ativa plano (`M2-BR-005`, ADR-027).

### 5.2 Integração, contra Postgres real

- Dez entregas do mesmo webhook = **uma** confirmação (`M2-AC-004`, aceite §6.6).
- Isolamento de tenant no `GET /invoices` e no `GET /payment-attempts/:id`: id de
  outro tenant é **404, nunca 409** — 409 vazaria que o id existe em algum lugar,
  oráculo de existência entre academias (INV-006). É a lição da F17, onde o teste
  passava com o status errado pela causa errada.
- Aluno sem CPF recusado **antes** de qualquer chamada à porta.

### 5.3 Concorrência — §2.2

Duas requisições concorrentes gerando checkout para a mesma invoice, medidas com
`Promise.allSettled` contra Postgres real. Guarda no **banco**, nunca em `if`: um
`if (jaExiste)` perde a mesma corrida (tese do inbox da F13, INV-076; defeito medido
na F14). Provada por mutação — `DROP INDEX` tem de derrubar o teste.

### 5.4 Estrutural

Nenhum campo de cartão no `admin-web` — guarda que **lê o código-fonte**, como a
`dado-de-cartao-nao-entra-no-backend.spec.ts` da F14. Verificada por mutação: um
`<input name="card_number">` plantado tem de acusar.

O caminho errado (PAN no nosso lado) é **mais fácil** que o certo, então não se chega
nele por descuido — chega-se por atalho. Daí a guarda ser estrutural.

### 5.5 Web e E2E

- **Vitest:** cada forma leva ao seu caminho; cartão desabilitado com motivo quando
  falta CPF; polling para no terminal e no expirado.
- **Playwright:** o aceite §6.1 inteiro — busca do aluno → ícone de cobrança → página
  → dinheiro → recibo abre.

### 5.6 Fuso

Unidade em fuso **diferente** de São Paulo, provando que a data lida vem da unidade.
Sem isso a correção passa sem prova: hoje os dois valores coincidem, e um teste em
São Paulo ficaria verde com o valor fixo ainda no lugar.

---

## 6. Escopo negativo

| o quê | para onde |
|---|---|
| Adapters reais de Sicoob e Getnet, tela de credenciais | **F55** |
| Pagamento no totem | **F52** |
| Pagamento no app do aluno | **F25** |
| Régua de cobrança, promessa de pagamento | **F38** |
| Rota `/students/[id]/pagar` separada | não existe — a página é a de cobrança |
| API oficial de WhatsApp | fatia própria; `wa.me` segue do operador |
| Maquininha física / TEF | descartado pela decisão 2 da spec |
| Push nativo | fora, decisão do PI em 23/08 |

**Saiu do escopo negativo da spec:** `GET /api/v1/invoices`, que a §3.1 propunha
cortar e o PI mandou implementar (decisão 1).

---

## 7. Invariantes preservados

INV-065 (centavos inteiros) · INV-069 (estado terminal não regride) · INV-072 (teto
manual recusa) · INV-076 (idempotência por evento externo) · INV-098 (nenhum PAN,
CVV ou trilha em coluna, log ou teste) · **INV-144** (instante de bloqueio no fuso da
unidade — deixa de ser dívida nesta tela, decisão 2).
