# Pagamento em lote no balcão — atrasados, mês corrente e adiantados

- **Data:** 30/09/2026
- **Origem:** pedido do PI na conversa de 30/09/2026 (brainstorming)
- **Status:** revisada pelo Cowork; card aberto
- **Fatia/SPEC:** `F83` / `SPEC-083` — issue #458

## 1. Problema

Na ficha financeira do aluno, "Receber no balcão" quita **uma** invoice por vez. Dois casos reais
ficam sem saída:

- aluno com **meses atrasados** quer quitar todos de uma vez;
- aluno que gosta de **pagar adiantado** 2, 3 ou até 6 meses não tem como — só existe invoice do
  mês corrente.

**Sucesso:** a recepção vê os meses, marca até onde o aluno quer pagar, recebe numa operação só
com uma forma de pagamento e um total; o aluno que pagou adiantado não é cobrado nem bloqueado
nesses meses.

## 2. Decisões do PI (30/09/2026)

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | A seleção pode pular mês? | **Não.** Contínua a partir do mês em aberto mais antigo, sem buraco — vale para vencidos e adiantados. |
| 2 | Adiantar dá benefício? | **Sem desconto.** Cada mês pelo preço vigente da sua competência; o efeito colateral é travar o preço (INV-067). |
| 3 | Cancelamento com meses futuros pagos? | **Fora desta fatia.** Meses seguem `PAID`; estorno, se houver, é manual. Limitação conhecida. |
| 4 | Modelagem | **Um `Payment` por invoice, agrupados por `batchId`**, numa transação. Sem tabela de alocação, sem invoice consolidada. |
| 5 | Formas | Só as do balcão (Dinheiro, PIX maquininha, Débito, Crédito). PIX por QR do provedor segue um mês por vez. |
| 6 | Teto de meses adiantados? | **Competência corrente + 6.** (já refletido em §4.1) |
| 7 | Estorno de mês adiantado pago? | **Usa `EstornarPagamentoUseCase` existente**, aceitando que a `refundAccessPolicy` do tenant pode suspender o acesso mesmo com o mês corrente pago. Nada novo nesta fatia. |
| 8 | Aviso no app por lote ou por mês? | **Um aviso por mês.** Mantém o comportamento atual: N eventos `InvoicePaid` → N avisos "Pagamento confirmado". |

## 3. Contexto do código atual

- `Invoice.billingPeriod` (1º dia do mês) com `@@unique([tenantId, subscriptionId, billingPeriod])` — INV-066.
- `BillingRepository.abrirInvoiceDoPeriodo` já recebe `emQue` e é idempotente pela chave única;
  abrir mês futuro é passar outra data.
- `Payment.invoiceId` é N:1. `registrarPagamentoManual` recusa parcial (ADR-027 resp. 1) e manda
  excedente para `AccountCredit` (resp. 4).
- Acesso depende de **status** (assinatura/entitlement), não de mês pago. O job de inadimplência
  (`AplicarInadimplenciaUseCase`) só age sobre invoice `OPEN` vencida. Invoice futura `PAID` nunca
  vira `OVERDUE` → **não é preciso estender `Entitlement.endsAt`**.

## 4. API e domínio

### 4.1 Leitura — `GET /api/v1/subscriptions/:id/payable-months`

Devolve a faixa do **mês em aberto mais antigo** até **competência corrente + 6**:

```ts
{ months: Array<{
    competencia: 'YYYY-MM'
    status: 'OVERDUE' | 'OPEN' | 'NOT_OPENED'
    invoiceId: string | null
    totalMinor: number        // inteiro, menor unidade
    dueAt: string             // ISO; para NOT_OPENED, calculado por proximoVencimento
}> }
```

- Meses `PAID`/`CANCELLED` não entram.
- `NOT_OPENED` usa `precoVigenteEm(prices, competencia)`; nada é gravado.
- Se a assinatura tem `endsAt`, a faixa para no último mês cuja competência é anterior a `endsAt`.
- Aluno sem nada em aberto: a faixa começa no primeiro mês ainda não pago a partir do corrente.
- Permissão de leitura: a mesma que lista invoices do aluno hoje.

### 4.2 Recebimento — `POST /api/v1/subscriptions/:id/manual-payment-batch`

Header `Idempotency-Key` (vira `batchId`). Corpo:

```ts
{ ateCompetencia: 'YYYY-MM', channel: PaymentChannel, expectedTotalMinor: number, receivedAmountMinor?: number }
```

O cliente manda **só até onde pagar**. O servidor monta o conjunto: toda invoice `OPEN`/`OVERDUE`
com competência `<= ateCompetencia` + todo mês `NOT_OPENED` da faixa até `ateCompetencia`. Buraco é
impossível por construção.

Erros (`application/problem+json`, código estável):

| Situação | HTTP | code |
|----------|------|------|
| `ateCompetencia` fora da faixa (antes do 1º em aberto, além de +6 ou de `endsAt`) | 422 | `BATCH_OUT_OF_RANGE` |
| conjunto vazio | 422 | `BATCH_EMPTY` |
| `expectedTotalMinor` ≠ total calculado | 409 | `BATCH_TOTAL_CHANGED` |
| `receivedAmountMinor` < total | 422 | código de parcial já existente |
| invoice do conjunto paga por outra requisição em paralelo | 409 | `INVOICE_ALREADY_PAID` (o existente) |

Uma transação:

1. abre as invoices faltantes via `abrirInvoiceDoPeriodo` (recebendo `tx`, ver §4.4.1);
2. para cada invoice, em ordem de competência: `Payment` `CONFIRMED` com `batchId` e o `channel`,
   transição condicionada da invoice para `PAID` (ver §4.4.2), audit log, evento `InvoicePaid` no
   padrão atual;
3. excedente (`receivedAmountMinor - total`) vira **um** `AccountCredit` por lote;
4. `ativarDireitoDeAcessoSePendente` uma vez.

Falha em qualquer passo desfaz tudo.

**Idempotência:**
- Mesma `Idempotency-Key` + mesmo corpo (`ateCompetencia`, `channel`, `expectedTotalMinor`) →
  devolve o resultado do lote já gravado, sem gravar de novo.
- Mesma `Idempotency-Key` + corpo **diferente** → **422** `IDEMPOTENCY_KEY_BODY_MISMATCH`. Nunca
  processa o corpo novo nem devolve o lote antigo como se fosse a resposta dele.
- A chave (`tenantId`, `batchId`) mais o hash do corpo relevante é o que decide entre os dois
  casos acima; guardado em `PaymentBatch` (ver §4.3) ou, na falta de tabela própria, num campo do
  primeiro `Payment` do lote.

Permissão: `billing.payment.manual`. Tenant da identidade autenticada, nunca do corpo.

### 4.2.1 Concorrência — recebimento avulso e lote sobre o mesmo mês

O `registrarPagamentoManual` de hoje confere `podeTransicionar` **fora** da transação e faz
`update` **sem condição** (`billing.repository.ts:212-238`). Duas chamadas concorrentes sobre a
mesma invoice — um recebimento avulso e um lote, por exemplo — podem cobrar o aluno em dobro: as
duas leem `OPEN`, as duas passam na checagem, as duas gravam `Payment` `CONFIRMED`.

**Correção, nos dois caminhos (avulso e lote):** substituir o par
`findFirst` + `update` incondicional por uma transição condicionada no banco:

```ts
const resultado = await tx.invoice.updateMany({
  where: { id: invoice.id, tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
  data: { status: 'PAID', paidAt, version: { increment: 1 } },
});

if (resultado.count !== 1) {
  throw new TransicaoDeInvoiceInvalidaError(/* ... */);
}
```

Isso garante **a transição para `PAID` uma vez só**, que é a garantia real — não "no máximo um
`Payment` `CONFIRMED` por invoice": esse invariante é **falso por desenho**, porque o webhook PIX
já grava um segundo `Payment` sobre uma invoice `PAID` e manda o valor para crédito (fluxo
existente, fora desta fatia). Não introduzir índice único parcial em `payments` — quebraria esse
fluxo.

O `Payment` só é criado **depois** que o `updateMany` confirma `count === 1`, para não sobrar
`Payment` órfão do lado perdedor da corrida.

### 4.3 Schema

`Payment.batchId String?` + índice `(tenantId, batchId)`. Migração aditiva, sem backfill.

Para a checagem de idempotência com corpo (§4.2), o corpo relevante do primeiro pedido do lote
fica em `Payment.batchRequestHash String?` (hash estável de `ateCompetencia|channel|expectedTotalMinor`),
gravado só no primeiro `Payment` de cada `batchId`. Repetir a chave: busca 1 `Payment` por
`(tenantId, batchId)`, compara o hash. Sem tabela nova — reaproveita a coluna já adicionada.

### 4.4 Domínio puro

- `mesesPagaveis({ invoices, agora, endsAt, prices, dueDay })` → faixa ordenada.
- `resolverLote(faixa, ateCompetencia)` → subconjunto contínuo ou erro de domínio.

Sem banco, rede ou relógio; o "agora" entra por parâmetro.

### 4.4.1 Transação compartilhada

`abrirInvoiceDoPeriodo` e `registrarPagamentoManual` hoje abrem a própria `$transaction`
(`billing.repository.ts:123` e `:220`). Para o lote rodar como uma transação única (§4.2, passo
1-4), as duas passam a aceitar um `tx` opcional:

```ts
async abrirInvoiceDoPeriodo(
  contexto: TenantContext,
  entrada: { subscriptionId: string; emQue: Date },
  tx?: PrismaTx,
): Promise<Invoice> {
  const executar = async (tx: PrismaTx) => { /* corpo atual */ };
  return tx ? executar(tx) : this.db.$transaction(executar);
}
```

Mesmo padrão em `registrarPagamentoManual`. Caminho hoje existente (avulso, ciclo) continua
chamando sem `tx` e abre a própria transação, comportamento inalterado. O novo caso de uso do lote
chama as duas passando o mesmo `tx`.

## 5. Tela — Financeiro do aluno

"Receber no balcão" vira uma **faixa de meses** (chips) + resumo + forma de pagamento:

```
[JUL/26] [AGO/26] [SET/26]  [OUT/26]  ...  [MAR/27]
 Vencido  Vencido  Em aberto Adiantado      Adiantado
 R$150    R$150    R$150     R$150          R$150

3 meses · jul/26 a set/26 · Total R$ 450,00
FORMA DE PAGAMENTO  [Dinheiro] [PIX] [Débito] [Crédito]
                                   [ Receber R$ 450,00 ]
```

- Clicar num mês seleciona todos até ele; clicar no último selecionado recua um. Não há estado com buraco.
- Seleção inicial: do vencido mais antigo até o mês corrente. Aluno em dia começa sem seleção e
  o botão fica desabilitado.
- Reaproveita `seletor-de-forma.tsx`; Dinheiro mantém o valor recebido atual (excedente → crédito).
- Sucesso: Toast "N meses recebidos", recarrega tabela e situação atual. 409 de total: Toast de
  aviso e recarrega a faixa. Nunca `Alert`.
- Mobile: faixa com rolagem horizontal, chips com alvo de toque adequado.
- Tokens do `docs/design/DS-PAINEL.md`; sem hex literal.
- Fica como está: "Gerar cobrança do mês" e o PIX por QR (um mês).

## 6. Testes

**Unitário (api):** `mesesPagaveis` — sem atraso, 2 vencidos, `endsAt` cortando, troca de preço no
meio, virada de ano, teto +6. `resolverLote` — vazio, fora da faixa, conjunto correto.

**Integração (Postgres real):**
- deve 2 meses, paga até corrente+2 → 5 invoices `PAID`, 5 `Payment` com mesmo `batchId`,
  assinatura e entitlement `ACTIVE`;
- mesmo `Idempotency-Key` + mesmo corpo repetido → nenhum `Payment` novo, devolve o resultado do
  lote anterior;
- mesmo `Idempotency-Key` + corpo diferente (outro `ateCompetencia`) → 422, nada gravado;
- **recebimento avulso e lote concorrentes sobre o mesmo mês** (chamando
  `registrarPagamentoManual` e o novo caso de uso em paralelo para a mesma invoice) → só um
  transiciona para `PAID`, o outro recebe erro de transição inválida; afirma
  "a invoice transiciona para `PAID` uma vez só", nunca o relógio;
- duas requisições de lote paralelas, chaves diferentes, faixas sobrepostas → cada invoice paga
  uma vez só, a outra recebe erro por invoice já paga;
- `expectedTotalMinor` divergente → 409 e nada gravado;
- falha plantada no 3º mês desfaz os anteriores (inclusive as invoices abertas nesta mesma
  transação);
- job de inadimplência depois não suspende quem pagou adiantado;
- quitar os atrasados reativa assinatura `PAST_DUE` e entitlement `SUSPENDED`;
- tenant B não enxerga assinatura de A.

**Web (Vitest):** seleção contínua, sem buraco, seleção inicial, total/rótulo do botão, corpo da
action (`ateCompetencia`, `expectedTotalMinor`, `Idempotency-Key`).

**E2E (Playwright):** aluno com 1 vencido paga até corrente+1 → 3 meses `PAID`, situação "Em dia".

## 7. Documentação na entrega

- `docs/CONVENTION.md`: invariante nova — lote contínuo a partir do mês em aberto mais antigo,
  teto +6, sem desconto, um `Payment` por invoice com `batchId`.
- `docs/DECISIONS.md`: ADR com as decisões 1–3 do PI (contrato de dado/cobrança, caro de desfazer).
- `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/TESTING`/`TESTS.md` conforme o fluxo.

## 8. Fora de escopo

- Cancelamento com meses adiantados pagos (decisão 3).
- Desconto por antecipação (decisão 2).
- PIX por QR do provedor em lote.
- Aplicar `AccountCredit` existente para abater meses (o crédito continua sem consumo, como hoje).
- Relatório de caixa agrupado por `batchId` — o dado fica pronto; a tela de relatório é outra fatia.
- Estorno de mês adiantado: usa o `EstornarPagamentoUseCase` já existente, sem alteração (decisão 7).

## 9. Critérios de aceite (issue #458)

- [ ] A recepção seleciona uma faixa contínua (do mais antigo em aberto até no máximo corrente + 6)
      e recebe numa operação só, com uma forma e um total.
- [ ] Os meses adiantados pagos não são cobrados pelo ciclo nem suspensos pela inadimplência.
- [ ] Quitar os atrasados reativa assinatura `PAST_DUE` e entitlement `SUSPENDED`.
- [ ] Falha em qualquer mês desfaz o lote inteiro.
- [ ] Recebimento avulso e lote concorrentes sobre o mesmo mês: só um passa.
- [ ] Repetir a mesma `Idempotency-Key` não grava nada novo; a mesma chave com corpo diferente dá 422.
