# Cancelar pagamento manual lançado errado

- **Data:** 05/10/2026
- **Origem:** pedido do PI em 05/10/2026 — a recepção lançou pagamento errado em nov/26 de uma aluna e não há como desfazer
- **Status:** desenho aprovado pelo PI em 05/10/2026
- **Fatia/SPEC:** `F85` / `SPEC-085` (a alocar no Índice Fatia ↔ SPEC do `STATUS.md` ao abrir a issue)

## 1. Problema

Um pagamento `MANUAL` (dinheiro, PIX na maquininha, débito, crédito) lançado por engano na recepção
fica para sempre: a fatura vira `PAID`, o vencimento da fatura seguinte é empurrado e o dinheiro
aparece na coluna **Recebimento**. O estorno do sistema recusa pagamento manual
(`PagamentoManualNaoEstornavelError`, ADR-027 resposta 3), e o ADR-027 só prevê "contra-lançamento
auditado" — que nunca foi implementado. Hoje a correção é script contra produção.

**Sucesso:** a recepção cancela o lançamento errado pela tela, com motivo, e lança o certo em seguida,
sem script e sem perder a trilha de auditoria.

## 2. Decisões do PI (05/10/2026)

1. **A fatura volta a aberta** ao cancelar o pagamento (não vira `CANCELLED`). O aluno volta a dever o mês.
2. **A própria recepção cancela**, com a permissão que já tem (`billing.payment.manual`). O controle é
   o motivo obrigatório e a auditoria — detectivo, não preventivo, como o ADR-027 já aceitou para o lançamento.
3. **Cancelar é emenda do INV-069** (fatura paga não volta a aberta) **para pagamento manual**. Vai num
   ADR curto. PIX/cartão continuam só pelo estorno com provedor.

## 3. Comportamento

`POST /api/v1/billing/payments/:paymentId/cancel`, corpo `{ reason: string }`. Uma transação só.

**Pré-condições** (todas recusam sem efeito algum):

| Condição | Erro |
|---|---|
| Pagamento existe no tenant | 404 `PAYMENT_NOT_FOUND` |
| `method = MANUAL` | 409 `BILLING_PAYMENT_NOT_CANCELLABLE` (PIX/cartão: usar estorno) |
| `status = CONFIRMED` | 409 `BILLING_PAYMENT_NOT_CANCELLABLE` (já cancelado ou estornado) |
| `reason` com ao menos 3 caracteres após `trim` | 422 `BILLING_INVALID_CANCEL` |
| Crédito gerado por este pagamento (`AccountCredit` com `originPaymentId`) **não** está `APPLIED` | 409 `BILLING_CREDIT_ALREADY_APPLIED` |

**Efeitos**, na ordem:

1. `Payment`: `status = CANCELLED`, `cancelledAt = agora`, `cancelledByUserId = ator`, `cancelReason = reason`.
   `paidAt` e `recognizedByUserId` **não** são apagados — são a trilha.
2. `Invoice`: transição condicionada (`updateMany` onde `status = PAID`) para `OPEN`, `paidAt = null`,
   `version + 1`. Se a contagem não for 1 (corrida), aborta. A fatura reaberta aparece como "A vencer"
   ou "Vencida" conforme `estadoExibido`, sem tocar em `dueAt`/`blockAt` dela.
3. **Vencimento da fatura seguinte:** o pagamento de um mês empurra `dueAt` da primeira fatura ainda
   devida depois dele (`ancorarProximoVencimento`, `vencimentoAposPagamento(paidAt, 1)`). Ao cancelar,
   a primeira fatura `OPEN`/`OVERDUE` com competência posterior volta ao padrão do ciclo
   (`proximoVencimento(competencia, dueDay)` e `instanteDeBloqueio`) **somente se** o `dueAt` atual for
   exatamente `vencimentoAposPagamento(paidAt do pagamento cancelado, 1)`. Se for outro valor, outro
   pagamento já mexeu nele e não é tocado.
4. `AccountCredit` com `originPaymentId = este pagamento` e `status = AVAILABLE` → `EXPIRED`.
5. `AuditLog` `billing.payment.cancelled` (metadata: `invoiceId`, `amountMinor`, `reason`,
   `receivedVia`, `invoiceVencimentoRestaurado`) e `OutboxEvent` `PaymentCancelled` na mesma transação
   (regra de arquitetura nº 5).

**O que NÃO faz:**

- **Não apaga linha do banco.** Para a recepção o lançamento "some" (a UI esconde pagamento
  `CANCELLED`); para a auditoria ele fica.
- **Não toca em entitlement/assinatura.** A regra nº 1 manda o acesso seguir entitlement, e quem o
  suspende é o job de inadimplência (`aplicar-inadimplencia`) quando a fatura reaberta passar de
  `blockAt`. Cancelar não bloqueia ninguém na hora.
- **Não cancela o lote inteiro.** Escopo é um pagamento, um mês. Os outros pagamentos do mesmo
  `batchId` ficam como estão.
- **Recibo:** a linha de `Receipt` permanece. A reimpressão do recibo de pagamento `CANCELLED` é
  recusada com 409 `BILLING_PAYMENT_CANCELLED`, para não circular papel de um recebimento que não vale.

## 4. Dados

Migration única em `payments`, só colunas nulas (sem backfill, sem reescrever linha):

```
cancelled_at          timestamptz  NULL
cancelled_by_user_id  uuid         NULL
cancel_reason         text         NULL
```

`PaymentStatus.CANCELLED` já existe. Sem permissão nova, sem enum novo.

Leitura: `listarInvoicesDoAluno` passa a devolver só pagamentos `status != CANCELLED` no array
`payments` da fatura (a grade nunca mostra cancelado). Outras leituras de `payments` (resumo
financeiro, conciliação, dashboard) devem filtrar por `CONFIRMED` onde somam dinheiro — a
implementação confere cada uma com grep antes de entregar, e o que contar `PAID` sem olhar o status
do pagamento entra no plano como correção.

## 5. Tela

Em `apps/admin-web/app/(protected)/students/[id]/billing/`:

- Coluna **Recebimento**: em cada pagamento `MANUAL`/`CONFIRMED`, botão de ação discreto
  "Cancelar pagamento" ao lado do canal/data (`Recebimento` ganha `invoiceId`/`id`).
- Clique abre `<dialog>` nativo (centralizado explicitamente — o preflight do Tailwind remove o
  `margin: auto`) com resumo (competência, valor, canal, data), campo **Motivo** obrigatório e
  botões Cancelar pagamento / Voltar.
- Resultado em **Toast** (info no sucesso, erro com a mensagem do código), nunca `Alert`. Server
  Action em `app/actions/billing.ts`; o formulário valida o motivo em JS (não `required` nativo em
  passo escondido).
- Após sucesso a página recarrega: pagamento some da coluna, fatura reaparece "A vencer/Vencida" e o
  painel de cobrança volta a oferecer o mês em **Pagar**.
- Superfície web: contrato `docs/design/DS-PAINEL.md`; sem hex literal.

## 6. Testes

- **Unitário (domínio puro):** `podeCancelarPagamento(pagamento)` por método/estado e
  `deveRestaurarVencimento(dueAtAtual, paidAt)` — iguais, diferentes, fatura seguinte inexistente.
- **Integração (Postgres):** cancela pagamento avulso (fatura volta `OPEN`, paidAt nulo, auditoria,
  outbox); cancela pagamento de lote (os irmãos intactos); restaura vencimento da seguinte; **não**
  restaura quando o vencimento difere; crédito `AVAILABLE` expira; crédito `APPLIED` recusa com 409 e
  nada muda; PIX/cartão recusam; segundo cancelamento recusa; motivo curto recusa; tenant alheio 404;
  corrida (dois cancelamentos simultâneos): um ganha, o outro 409.
- **E2E (Playwright):** abre a ficha com um mês pago em dinheiro, cancela com motivo, vê a fatura
  aberta, paga o mês de novo.
- **Mutação de canário:** remover a condição de status do `updateMany` da fatura derruba um teste;
  remover o filtro `!= CANCELLED` da listagem derruba um teste.

## 7. Documentação a atualizar na entrega

- `docs/DECISIONS.md`: ADR curto — INV-069 emendado para pagamento `MANUAL`; contra-lançamento do
  ADR-027 resposta 3 realizado como cancelamento com trilha, por decisão do PI.
- `docs/CONVENTION.md` §3.4/§3.5 e INV-069/INV-072: transição `PAID → OPEN` só por cancelamento de
  pagamento manual; `Payment.CANCELLED` ganha significado.
- `docs/STATUS.md` (Índice Fatia ↔ SPEC, F85), `docs/DEVELOPMENT.md`, `docs/TESTING.md` (linha na
  matriz por SPEC) e `docs/specs/SPEC-085-…md` como ponteiro fino para este desenho.

## 8. Fora de escopo

- Estorno de PIX/cartão (já existe e não muda).
- Cancelar o lote inteiro de uma vez.
- Segundo aprovador ou limite de tempo para cancelar (o PI escolheu a recepção cancelar livremente;
  se o uso indevido aparecer, a auditoria detecta e a permissão própria é decisão futura).
- Corrigir valor/canal do pagamento sem cancelar (cancela e lança de novo).
