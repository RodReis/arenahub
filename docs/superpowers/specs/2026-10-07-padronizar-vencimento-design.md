# Padronizar vencimento, cobrança mensal automática e bloqueio por inadimplência

- **Data:** 07/10/2026
- **Origem:** pedido do PI na conversa de 07/10/2026 (brainstorming)
- **Status:** desenho aprovado pelo PI em 07/10/2026
- **Fatia:** `F88` / `SPEC-088`. Número conferido por grep em 07/10/2026: último alocado é `F87`/`SPEC-087`.
- **MVP:** MVP2 (cobrança)

## 1. Problema

A aba Cobrança da ficha do aluno mostra datas de vencimento sem padrão, e a geração das faturas é manual.

O que o código faz hoje:

- **Vencimento.** `abrirInvoiceDoPeriodo` usa `BillingSettings.dueDay` (10) da competência. O recebimento no
  balcão (`registrar-pagamento-em-lote.use-case.ts`, `ancorarProximoVencimento`) **reescreve** o `dueAt` da
  primeira fatura devida depois do último mês pago para `pagamento + 30 × meses` (INV-163). Resultado: uma
  fatura vence no dia 10 e a seguinte em 06/11, 24/11 etc., cada aluno numa data.
- **"Vence em" da fatura paga.** A grade mostra `invoice.dueAt` cru (`students/[id]/billing/page.tsx`). O
  pagamento não toca no `dueAt`, então a paga mostra o dia 10 ou uma data ancorada antiga.
- **Geração.** Só existe o botão "Gerar cobrança do mês". Aluno de balcão sem clique fica sem fatura. O
  `subscription-cycle/run` só cobre recorrência de cartão (`externalSubscriptionId`).
- **Bloqueio.** `AplicarInadimplenciaUseCase` existe, mas **nenhum agendador o chama**. Ninguém é bloqueado
  por falta de pagamento. Ele também não filtra perfil.
- **Fuso.** A competência e o `blockAt` de abertura saem de conta em UTC (`ciclo-de-cobranca.ts`). Clique
  entre 21h e 23h59 do último dia do mês (Brasília) gera a competência do mês seguinte.

**Sucesso:** toda fatura vence no dia 10 da sua competência; toda fatura paga mostra até quando cobre; a
fatura do mês nasce sozinha no dia 01; quem não paga é bloqueado na catraca 5 dias depois do vencimento.

## 2. Decisões do PI (07/10/2026)

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Vencimento da fatura seguinte a um pagamento | **Dia 10 fixo, sempre.** A âncora `pagamento + 30 × N` da INV-163 **é revogada**. |
| 2 | "Vence em" de fatura paga | **`data do pagamento + 30 dias`**, escalonado no lote: o mês na posição *k* (ordem de competência, começando em 1) cobre até `pagamento + 30 × k`. Ex.: pago 07/10 out+nov+dez → 06/11, 06/12, 05/01. Só informativo: **não adia** vencimento nem bloqueio. |
| 3 | Saneamento de produção | Aluno elegível sem fatura out/26 → criar com vencimento **10/10/2026**. **Toda** fatura `OPEN`/`OVERDUE` → vencimento no dia 10 da própria competência. |
| 4 | Geração mensal | Job **todo dia 01**, vencimento **dia 10**, para todo aluno ativo de perfil `STUDENT`. |
| 5 | Bloqueio por inadimplência | **5 dias depois do vencimento** a catraca bloqueia. Vence 10/10 → bloqueia a partir de 15/10 00:00 no fuso da unidade. |

## 3. Elegibilidade

Aluno elegível à fatura mensal (job e saneamento) — as quatro condições juntas:

1. `Student.profile = STUDENT` (os demais perfis têm acesso por vínculo, não por plano);
2. `Student.status = ACTIVE`;
3. assinatura vigente (`Subscription.status IN (ACTIVE, PAST_DUE)` — no máximo uma, índice #272);
4. plano da assinatura com `billingMode ≠ DIARIA` (diária não é contrato — F86).

Aluno que cumpre 1 e 2 mas **não** tem assinatura vigente não recebe fatura; o saneamento lista esses à
parte para a recepção resolver.

## 4. Desenho

### 4.1 Regra única de vencimento

- `dueAt` = dia `dueDay` da competência, **00:00 no fuso da unidade do aluno** (não mais UTC).
- `blockAt` = `dueAt + graceDays`, no fuso da unidade — a mesma conta de `domain/bloqueio-por-inadimplencia.ts`
  passa a ser usada também na abertura (some a soma em milissegundos de `ciclo-de-cobranca.ts`).
- A competência de "agora" sai do fuso da unidade.
- **Apagar** `ancorarProximoVencimento` do lote e a restauração da âncora no cancelamento
  (`cancelar-pagamento-manual.use-case.ts`). O lote continua abrindo as faturas dos meses **pagos**; deixa
  de abrir/reescrever a fatura seguinte.

### 4.2 Cobertura da fatura paga — `Invoice.coverageEndsAt`

- Coluna nova `coverage_ends_at timestamptz NULL` em `invoices`. Migration aditiva.
- Gravada por `registrarPagamentoManual` e pelo lote: `paidAt` (dia) + `30 × k` dias, *k* = posição no lote
  (avulso: *k* = 1). Função pura no domínio, com o "agora"/data por parâmetro.
- Cancelar o pagamento (F85) zera a coluna junto com o `paidAt`.
- Webhook de pagamento (cartão/PIX) grava com *k* = 1.
- UI: coluna "Vence em" mostra `coverageEndsAt` quando a fatura é `PAID`, senão `dueAt`.
- A tela de receber continua mostrando "Vigente até `pagamento + 30 × N`"; sai o "mais a carência".

### 4.3 Job mensal — `GerarFaturasDoMesScheduler`

- `@Cron('5 0 1 * *', { timeZone: 'America/Sao_Paulo' })` no `ScheduleModule` existente.
- Para cada tenant ativo, dentro de `comContexto`: lista assinaturas elegíveis (§3) e chama
  `abrirInvoiceDoPeriodo` para a competência corrente. Idempotente pela `@@unique` (INV-066): rodar duas
  vezes cria zero na segunda.
- Falha em uma assinatura é logada (id da assinatura, código do erro — **sem PII**) e o job segue.
- Log final por tenant: `criadas`, `jaExistiam`, `falhas`.
- Rota `POST /api/v1/billing/monthly-invoices/run` (perfil financeiro/admin) para reexecutar à mão.

### 4.4 Bloqueio por inadimplência

- `BillingSettings.graceDays`: padrão do schema passa de 10 para **5**; o saneamento grava 5 no tenant de
  produção.
- `@Cron('10 0 * * *', { timeZone: 'America/Sao_Paulo' })` chama `AplicarInadimplenciaUseCase.executar`
  por tenant, com `comContexto` (o próprio use case avisa que worker precisa abrir o contexto).
- `AplicarInadimplenciaUseCase.candidatas` passa a filtrar `student.profile = STUDENT` e plano
  `billingMode ≠ DIARIA`.
- Cadeia inalterada (regra 1): fatura `OVERDUE` → assinatura `PAST_DUE` → entitlement `SUSPENDED` → catraca
  nega. Pagamento reativa via `ativarDireitoDeAcessoSePendente`.
- Rota manual `POST billing/delinquency/apply` continua.

### 4.5 Saneamento de produção — script

`apps/api/src/scripts/padronizar-vencimentos.ts` + `padronizar-vencimentos/dominio.ts` (+ spec), padrão
dos scripts de setembro: sem flag imprime o plano; `--gravar` aplica. Idempotente.

1. `BillingSettings.graceDays = 5` no tenant.
2. Elegível (§3) sem fatura out/26 → `abrirInvoiceDoPeriodo` com `dueAt = 10/10/2026`.
3. Fatura `OPEN`/`OVERDUE` (qualquer competência) → `dueAt` = dia 10 da competência, `blockAt` recalculado
   (sobrescreve o congelado). `OVERDUE` volta a `OPEN` se o novo `blockAt` for futuro; nesse caso,
   assinatura `PAST_DUE` → `ACTIVE` e entitlement `SUSPENDED` → `ACTIVE` só se não restar outra fatura
   vencida além da carência.
4. Fatura `PAID` sem `coverageEndsAt` → preenche pela §4.2 (lote por `Payment.batchId`, ordem de competência).
5. Relatório: alunos `STUDENT` + `ACTIVE` sem assinatura vigente; e **quem seria bloqueado na primeira
   execução do job** (faturas cujo novo `blockAt` já passou — ex.: set/26 → 15/09).

Ordem de operação: merge → dry-run em produção → PI confere o plano → `--gravar`. O job de bloqueio só
liga depois do saneamento (variável `BILLING_DELINQUENCY_JOB_ENABLED`, desligada por padrão, no `globalEnv`
do turbo).

## 5. Efeito em produção (PI ciente)

- Todo aluno `STUDENT` com out/26 não paga fica bloqueado na catraca a partir de **15/10/2026 00:00**.
- Faturas vencidas mais antigas bloqueiam na **primeira execução** do job.
- Ninguém é bloqueado antes do PI ligar a variável.

## 6. Documentação

- `DECISIONS.md`: emenda na F83 (âncora revogada) e na F85 (sem restauração), decisão do PI em 07/10/2026;
  nota de carência 5 no ADR-019.
- `CONVENTION.md`: INV-163 emendada; nova INV para o job mensal e para `coverageEndsAt`.
- `STATUS.md` (índice F88), `DEVELOPMENT.md`, `TESTING.md`/`TESTS.md`.

## 7. Testes

- **Unit:** `coverageEndsAt` escalonado (k = 1..7); `dueAt`/`blockAt` no fuso (último dia do mês às 22h
  BRT dá a competência certa); plano do saneamento (`dominio.spec`).
- **Integração:** lote não toca mais a fatura seguinte; cancelar zera `coverageEndsAt`; job mensal cria só
  para elegíveis (não-STUDENT, DIARIA, sem assinatura → zero) e é idempotente; inadimplência ignora
  não-STUDENT e bloqueia STUDENT só depois de `dueAt + 5`.
- **E2E:** fluxo de receber continua verde (o texto "mais a carência" muda).

## 8. Fora do escopo

- Aviso ao aluno antes do bloqueio (já existe `notification-deadline-scheduler`; não muda).
- Feriado / dia útil no vencimento (ADR-019: sem adiar por feriado).
- Vencimento por aluno (`billingDay` por assinatura).
