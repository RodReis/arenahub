# Diária avulsa — aluno sem plano paga R$ 30,00 e usa a academia no dia

- **Data:** 07/10/2026
- **Origem:** pedido do PI na conversa de 07/10/2026 (brainstorming)
- **Status:** desenho aprovado pelo PI; implementada na F86 (balcão)
- **Fatias:** `F86` / `SPEC-086` (balcão, esta) e `F87` / `SPEC-087` (totem, registrada na §9). Números
  conferidos por grep em 07/10/2026: último alocado é `F85`/`SPEC-085`.
- **MVP:** MVP2 (cobrança)

## 1. Problema

Aluno cadastrado, sem assinatura vigente, quer usar a academia **uma vez no dia** pagando R$ 30,00.

O que existe hoje:

- plano `Diaria` (R$ 30,00) **só no seed** — em produção só existe se alguém criou;
- recepção atribui plano digitando início e fim à mão; o entitlement nasce `ACTIVE` na hora;
- `POST /invoices` abre a invoice do mês e `manual-payment` recebe no balcão.

O que falta:

1. **Fluxo único.** São três passos manuais (atribuir → abrir invoice → receber).
2. **Acesso sem pagamento.** O entitlement nasce antes do pagamento (regra 1: o acesso é do
   entitlement, e a atribuição o cria). Recepção que esquece de cobrar libera o aluno de graça.
3. **Vencimento mensal.** A invoice usa `dueDay` e carência do mês, que não fazem sentido para um dia.
4. **Métricas.** Diária como assinatura comum polui churn, receita recorrente e scores de retenção.

**Sucesso:** a recepção vende a diária num clique, o acesso só existe se o pagamento foi registrado, e
a diária não aparece como mensalidade em nenhum indicador.

## 2. Decisões do PI (07/10/2026)

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Onde o aluno paga? | **Balcão e totem (PIX QR).** |
| 2 | Como entregar, com o PIX real (F55) bloqueado? | **Duas fatias.** F86 balcão agora; F87 totem pronta com o dublê, liga quando a F55 liberar. |
| 3 | Até quando vale? | **Até a meia-noite do dia**, no fuso da unidade, respeitando as janelas do plano. |
| 4 | Abordagem | **Plano `DIARIA` + venda atômica**, reaproveitando assinatura, invoice, pagamento e entitlement. |
| 5 | Vender em dia/horário sem janela no plano? | **Recusar** (`422 DAY_PASS_CLOSED_TODAY`). |

Preço: R$ 30,00 vem do `PlanPrice` vigente do plano, não de constante no código.

## 3. Contexto do código

- `Plan.billingMode` (`AVULSO` | `ASSINATURA`) — F56, ADR-043. `DIARIA` é o terceiro valor.
- `MembershipRepository.ativarAssinatura` cria assinatura + entitlement + timeline + outbox, mas
  **não** abre invoice nem cobra.
- `BillingRepository.abrirInvoiceDoPeriodo(contexto, entrada, tx?)` aceita `tx` e é idempotente por
  `(tenant, assinatura, competência)` (INV-066). Vencimento sai de `proximoVencimento(dueDay)`.
- `BillingRepository.registrarPagamentoManual(…, tx?)` aceita `tx`, recusa parcial e manda troco para
  `AccountCredit`.
- Índice parcial: **uma assinatura `ACTIVE`/`PAST_DUE` por aluno** (#272). Barra a segunda diária.
- `ExpirarAssinaturasVencidasUseCase` passa `ACTIVE` → `EXPIRED` quando `endsAt` vence.
- Precedente de orquestração entre módulos: `membership.controller` chama o billing dentro da mesma
  transação em `trocar-plano-agora`.
- `BillingRepository.ativarDireitoDeAcessoSePendente(tx, …)` — chamado por `registrarPagamentoManual`
  e pelo webhook de pagamento — promove assinatura `PENDING`/`PAST_DUE` e entitlement
  `SCHEDULED`/`SUSPENDED` para `ACTIVE`. **Não cria** o entitlement: quem cria é a matrícula. É a
  cadeia da regra 1 (`Pagamento → Invoice → Subscription → Entitlement`) já implementada.
- `SUBSCRIPTION_CREATED` na timeline só nasce do import do Pacto; `ativarAssinatura` grava
  `SUBSCRIPTION_ACTIVATED`. Os KPIs da F74 (novos, cancelamentos, churn, LTV) leem `CREATED` e
  `CANCELLED`, então a venda de diária não os toca.

## 4. Modelo

- Migration: `plan_billing_mode` ganha `DIARIA`. Sem coluna nova — a validade "até meia-noite" vem do
  modo, não do plano.
- Plano `DIARIA` exige `PlanPrice` vigente, ao menos uma unidade e janela (regra de aplicação, como o
  `ASSINATURA`; `POST /plans` já exige unidade e janela).
- Formulário de plano ganha a opção "Diária". O seed passa a criar `Diaria` com `billingMode: DIARIA`.
- A rotina de ciclo mensal já só considera assinatura com recorrência instalada
  (`externalSubscriptionId`), então ignora diária sem mudança.

## 5. Caso de uso `VenderDiariaUseCase` (módulo `membership`)

Entrada: `studentId`, `planId`, `channel` (`DINHEIRO` | `PIX` | `DEBITO` | `CREDITO`),
`expectedTotalMinor`, `receivedAmountMinor?`. O "agora" entra por parâmetro.

Antes da transação (nada a desfazer):

1. Aluno existe e é elegível (porta pública de `students`).
2. Plano existe, está ativo, é `DIARIA`, está dentro da validade de venda.
3. Preço vigente = `expectedTotalMinor`, senão `409 PRICE_CHANGED`.
4. O plano tem janela **hoje, em algum horário depois de agora**, na **unidade de origem do aluno**
   (é dela o fuso, INV-144); senão `422 DAY_PASS_CLOSED_TODAY`.

Numa transação só:

1. Trava a linha do aluno (`FOR UPDATE`, como `ativarAssinatura`) e confere que não há assinatura
   `ACTIVE`/`PAST_DUE`; senão `409 STUDENT_HAS_ACTIVE_SUBSCRIPTION`.
2. `Subscription` **`PENDING`** e `Entitlement` **`SCHEDULED`** (snapshot e janelas do plano),
   `startsAt = agora`, `endsAt =` 00:00 local do dia seguinte, mais timeline, auditoria e outbox.
3. Invoice via `abrirInvoiceDoPeriodo` com **vencimento na compra** e `blockAt` no fim do dia. O método
   ganha parâmetro opcional de vencimento; sem ele, o comportamento mensal fica intacto.
4. Pagamento via `registrarPagamentoManual`, `paidAt = agora`, `amountMinor` = recebido (troco vira
   crédito, como hoje). **É o pagamento que promove** assinatura e entitlement para `ACTIVE`
   (`ativarDireitoDeAcessoSePendente`): a cadeia da regra 1, sem atalho.

Falha em qualquer passo desfaz tudo: **não existe acesso sem pagamento registrado**.

Duplo clique: a trava do passo 1 serializa as duas chamadas e a segunda devolve
`409 STUDENT_HAS_ACTIVE_SUBSCRIPTION`. Sem `Idempotency-Key` novo.

## 6. API

`POST /api/v1/students/:id/day-pass`

```ts
{ planId: string, channel: 'DINHEIRO'|'PIX'|'DEBITO'|'CREDITO',
  expectedTotalMinor: number, receivedAmountMinor?: number }
```

- Permissões: `subscription.manage` **e** `billing.payment.manual` (a venda faz as duas coisas).
- Resposta: `{ subscriptionId, invoiceId, paymentId, entitlement: { startsAt, endsAt } }`.
- Erros (`application/problem+json`, `code` estável): `PRICE_CHANGED` 409,
  `STUDENT_HAS_ACTIVE_SUBSCRIPTION` 409, `DAY_PASS_PLAN_INVALID` 422, `DAY_PASS_CLOSED_TODAY` 422,
  `STUDENT_NOT_FOUND` 404, aluno inelegível e pagamento parcial pelos códigos já existentes.
- Dinheiro em inteiro na menor unidade; tenant vem do `TenantContext`.

## 7. Painel (`admin-web`)

- Ficha do aluno **sem assinatura vigente**: botão **"Vender diária"** ao lado de "Atribuir plano".
- Painel de venda: plano (escolha só se houver mais de uma `DIARIA` ativa), valor, forma de pagamento.
  O painel **não pede valor recebido** nem emite recibo: a API aceita `receivedAmountMinor` (o troco
  vira crédito), mas o balcão hoje recebe o valor exato, como no pagamento em lote; o recibo se emite
  pelo Financeiro do aluno, como já é.
- Sucesso: "Diária paga. O acesso vale até 23:59." Erro e aviso por Toast, nunca Alert. O botão mostra
  o valor ("Receber R$ 30,00") e **não** diz que o pagamento "libera" a catraca: quem libera é o
  entitlement (regra 1).
- A ficha de quem tem diária **não** mostra "Cobrança recorrente" (não há o que cobrar depois), e o
  plano de diária **não** aparece na lista de "Atribuir plano".
- Formulário de plano: opção "Diária" no modo de cobrança.
- UI passa por `impeccable` e `frontend-design:frontend-design` antes do commit; segue
  `docs/design/DS-PAINEL.md`.

## 8. Métricas — o que a diária **não** é

Fica fora de receita recorrente, inadimplência, avisos de vencimento e scores de retenção. O dinheiro
continua contando como **recebido** (`Payment`). Leitores de assinatura que ganham o filtro
`plan.billingMode != DIARIA` (inventário de 07/10/2026, por leitura do código):

- `consultar-resumo-financeiro.use-case.ts` — as **duas** consultas de assinatura vigente (receita
  esperada e alunos ativos);
- `consultar-inadimplencia.use-case.ts` — o denominador `pagantes`;
- `notification-deadline.repository.prisma.ts` — `assinaturasAtivasSemAvisoDeVencimento`: sem o filtro, o
  aluno que pagou a diária receberia "seu plano vence em breve" às 23:59 do mesmo dia;
- `retention-scores`, `retention-experiments` (status da assinatura mais recente) e
  `retention-snapshots.fatosDoAluno` (assinatura mais recente), por consistência: a diária não é
  contrato.

**Não precisam de filtro:** os KPIs da F74 (leem `SUBSCRIPTION_CREATED`/`CANCELLED`, que a diária não
emite), `alunosElegiveis` da retenção (exige `startsAt` 30 dias atrás) e a coluna "Plano" da lista de
alunos (mostrar "Diaria" ali é informação útil à recepção).

Cada leitor de dinheiro e aviso ganha **teste canário** (diária no cenário, indicador inalterado).
`retention-scores`, `retention-experiments` e `retention-snapshots` ganharam o filtro **sem canário
próprio** (montar snapshot e experimento só para provar um `where` custaria mais que o risco); a
regressão fica com as suítes `retencao-*`.

Fora de escopo (YAGNI): card "diárias vendidas" no painel financeiro.

## 9. Fatia 2 — F87 / SPEC-087, totem (só registrada)

- Totem identifica o aluno sem assinatura e oferece "Diária R$ 30,00".
- Cria assinatura `PENDING` + entitlement `SCHEDULED` + invoice `OPEN` (a mesma criação da F86, sem o
  pagamento) e entrega o QR PIX pelo fluxo existente (`apps/kiosk/components/pagamento.tsx`).
- O webhook de pagamento **já promove** os dois para `ACTIVE` (`ativarDireitoDeAcessoSePendente`). O
  código novo da F87 é o **lado de quem não pagou**: diária `PENDING` abandonada precisa ser cancelada
  (invoice `CANCELLED`, assinatura `EXPIRED`) no fim do dia, e uma `PENDING` aberta não pode ser
  vendida de novo em paralelo. `M4-BR-001` continua valendo: tocar na tela nunca libera acesso.
- Pronta e testada com o `FakePaymentProvider`; **liga sozinha quando a F55 liberar** (credenciais
  Getnet + mTLS Sicoob). Pagamento atrasado depois de a tela morrer ainda ativa a diária, desde que no
  mesmo dia; depois da meia-noite a invoice paga fica sem acesso a ativar e vai para estorno manual.
  Esse ponto vira pergunta ao PI na SPEC-087.

## 10. Testes

- **Unitário:** `fimDoDiaLocal(agora, timezone)` — 00:00, 23:30, fusos da unidade; janela "hoje depois de
  agora"; permissões.
- **Integração (Postgres real):** venda feliz (assinatura + invoice `PAID` + payment + entitlement até a
  meia-noite); **rollback** quando o pagamento falha (nada criado); duplo clique → 409; aluno com plano
  vigente → 409; preço mudou → 409; dia sem janela → 422; troco vira crédito; isolamento de tenant
  (RLS).
- **Canário de métricas:** um por leitor da §8.
- **E2E (Playwright):** recepção vende diária na ficha; recarregar a ficha mostra o acesso até 23:59.
- Seguem `docs/TESTING.md` e as guardas de evidência (`TESTS.md` com o PR preenchido após o merge).

## 11. Fora de escopo

- Totem (F87) e app mobile.
- Passe de N dias, pacote de diárias, desconto na diária.
- Visitante **sem cadastro** (a diária é de aluno cadastrado).
- Estorno de diária: usa o `EstornarPagamentoUseCase` existente, sem mudança.
- **Limitação herdada da F85:** cancelar o pagamento manual de uma diária reabre a invoice, mas **não
  toca o entitlement** (`cancelar-pagamento-manual.use-case.ts`). O aluno mantém o acesso até 23:59.
  Fica registrado, sem tratamento nesta fatia.
