# Pagamento em lote no balcão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a recepção quite, numa única operação, uma faixa contínua de meses (atrasados + mês corrente + até 6 adiantados) para uma assinatura, sem parcial e sem desconto por antecipação.

**Architecture:** Uma leitura pura (`mesesPagaveis`/`resolverLote`, sem banco) monta a faixa de meses pagáveis a partir das invoices existentes e do preço vigente. Um novo caso de uso (`RegistrarPagamentoEmLoteUseCase`) abre as invoices que faltam e paga todas numa única transação Prisma, reaproveitando `abrirInvoiceDoPeriodo` e `registrarPagamentoManual` do `BillingRepository` — que passam a aceitar um `tx` opcional para participar dessa transação compartilhada. A concorrência entre um recebimento avulso e um lote sobre o mesmo mês é resolvida trocando o `update` incondicional de `registrarPagamentoManual` por um `updateMany` condicionado ao status atual (transição para `PAID` garantida "uma vez só" pelo banco, não pela aplicação).

**Tech Stack:** NestJS + Prisma (Postgres) na API; Next.js Server Actions no admin-web; Zod no boundary; Jest (`*.spec.ts` unit, `*.int-spec.ts` integração); Vitest no admin-web; Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-30-pagamento-em-lote-design.md`

## Global Constraints

- Dinheiro é inteiro em centavos (`amountMinor`), nunca float (`CLAUDE.md`, INV-065).
- `tenant_id` vem sempre do `TenantContext` da identidade autenticada, nunca do corpo (regra de arquitetura nº 2).
- Todo caso de uso que muda estado publica o evento de domínio na mesma transação da mudança (transactional outbox, regra nº 5).
- Erro de domínio tem `code` estável; resposta HTTP em `application/problem+json` (`CLAUDE.md`).
- Seleção de meses é sempre contínua a partir do mês em aberto mais antigo — nunca aceitar/produzir um conjunto com buraco.
- Sem desconto por antecipação: cada mês cobra o preço vigente da própria competência (`precoVigenteEm`).
- Teto: competência corrente + 6 meses.
- `Payment.invoiceId` continua N:1 — cada mês do lote gera seu próprio `Payment`, agrupado por `batchId`.
- Nunca usar `Alert`; toda mensagem de sucesso/erro na tela é `Toast`.
- Funções de domínio são puras: sem banco, rede ou relógio; o "agora" entra por parâmetro.
- Migração de schema é aditiva, sem backfill (`Payment.batchId`, `Payment.batchRequestHash` são `String?`).

## Review Focus

- **Buraco na seleção via API direta:** alguém chama `manual-payment-batch` pulando o mês em aberto mais antigo (ex.: deve jul/ago, manda `ateCompetencia` que só cobre ago). O servidor deve montar o conjunto ele mesmo a partir do mês mais antigo em aberto — nunca confiar em uma lista de meses vinda do cliente. Coberto na Task 3 (teste de "nunca aceita lista externa de meses, só `ateCompetencia`").
- **Corrida avulso × lote sobre a mesma invoice:** um clique de "Receber no balcão" de uma tela antiga e um lote concorrente sobre o mesmo mês não podem os dois transicionar para `PAID`. Coberto na Task 2 (guarda) e Task 4 (teste de integração de concorrência).
- **Mesma `Idempotency-Key`, corpo diferente:** reenvio com `ateCompetencia` diferente por engano (ex.: duplo clique que mudou de mês) não pode devolver o resultado do lote antigo como se fosse a resposta do novo. Coberto na Task 4.
- **Troca de preço no meio da faixa:** o plano reajusta entre a abertura da tela e o clique em "Receber". `expectedTotalMinor` desatualizado tem que dar 409 e não gravar nada, mesmo com alguns meses já abertos por outra chamada nesse meio-tempo. Coberto na Task 1 (domínio) e Task 4 (integração).
- **Falha no meio do lote não deixa rastro parcial:** se o terceiro mês falhar (ex.: violação de unicidade inesperada), os dois primeiros não podem ficar `PAID` enquanto o terceiro não foi. Coberto na Task 4 (teste de atomicidade com falha plantada).

---

## File Structure

**Backend (`apps/api/src/modules/billing/`):**
- `domain/meses-pagaveis.ts` — **novo**. Funções puras `mesesPagaveis` e `resolverLote`.
- `domain/meses-pagaveis.spec.ts` — **novo**. Testes unitários do domínio.
- `billing.repository.ts` — **modificado**. `abrirInvoiceDoPeriodo` e `registrarPagamentoManual` passam a aceitar `tx?: Prisma.TransactionClient`; `registrarPagamentoManual` troca `update` incondicional por `updateMany` condicionado.
- `registrar-pagamento-em-lote.use-case.ts` — **novo**. Orquestra a transação do lote.
- `consultar-meses-pagaveis.use-case.ts` — **novo**. Caso de uso de leitura para `GET .../payable-months`.
- `billing.controller.ts` — **modificado**. Duas rotas novas: `GET subscriptions/:id/payable-months` e `POST subscriptions/:id/manual-payment-batch`.
- `billing.module.ts` — **modificado**. Registra os dois novos providers.

**Migração (`packages/database/prisma/`):**
- `schema.prisma` — **modificado**. `Payment.batchId String?`, `Payment.batchRequestHash String?`, índice `(tenantId, batchId)`.
- `migrations/<timestamp>_add_payment_batch/migration.sql` — **novo** (gerado pelo Prisma).

**Testes de integração (`apps/api/test/integration/`):**
- `billing-pagamento-em-lote.int-spec.ts` — **novo**.

**Frontend (`apps/admin-web/`):**
- `app/actions/billing.ts` — **modificado**. Nova server action `receberPagamentoEmLote`.
- `app/(protected)/students/[id]/billing/faixa-de-meses.tsx` — **novo**. Componente da faixa de chips.
- `app/(protected)/students/[id]/billing/faixa-de-meses.module.css` — **novo**.
- `app/(protected)/students/[id]/billing/faixa-de-meses.test.tsx` — **novo**. Vitest.
- `app/(protected)/students/[id]/billing/painel-de-cobranca.tsx` — **modificado**. Troca a seção "Receber no balcão" de invoice única para a faixa.
- `src/billing/meses-pagaveis.ts` — **novo**. Tipos e helper de seleção contínua no cliente (espelha a regra do servidor para a interação de clique, sem duplicar cálculo de preço).

**E2E (`apps/e2e/` ou onde já vivem os specs de billing):**
- spec novo de pagamento em lote (caminho exato confirmado na Task 8, ao localizar a pasta E2E existente).

**Docs (entrega, Task 9):**
- `docs/CONVENTION.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/TESTING.md`/`TESTS.md`.

---

## Task 1: Domínio puro — `mesesPagaveis` e `resolverLote`

**Files:**
- Create: `apps/api/src/modules/billing/domain/meses-pagaveis.ts`
- Test: `apps/api/src/modules/billing/domain/meses-pagaveis.spec.ts`

**Interfaces:**
- Consumes: `competenciaDe`, `proximoVencimento` de `./ciclo-de-cobranca.js`; `precoVigenteEm` de `./dinheiro.js` (assinatura: `precoVigenteEm(prices: readonly PrecoVigente[], momento: Date): PrecoVigente | undefined`, onde `PrecoVigente` tem `amountMinor`, `currency`, `startsAt`, `endsAt?`).
- Produces:
  - `type MesPagavel = { competencia: Date; status: 'OVERDUE' | 'OPEN' | 'NOT_OPENED'; invoiceId: string | null; totalMinor: number; dueAt: Date }`
  - `function mesesPagaveis(entrada: { invoices: readonly InvoiceParaFaixa[]; agora: Date; endsAt: Date | null; prices: readonly PrecoVigente[]; dueDay: number }): MesPagavel[]`
  - `type InvoiceParaFaixa = { id: string; billingPeriod: Date; status: 'OPEN' | 'OVERDUE' | 'PAID' | 'CANCELLED' | 'REFUNDED'; totalMinor: number; dueAt: Date }`
  - `function resolverLote(faixa: readonly MesPagavel[], ateCompetencia: Date): MesPagavel[]` — lança `LoteInvalidoError` se `ateCompetencia` não corresponde a nenhum mês da faixa ou se o resultado ficaria vazio.
  - `class LoteInvalidoError extends ErroDeDominio` com `code: 'BILLING_BATCH_OUT_OF_RANGE'`, `status: 422`.

- [ ] **Step 1: Escrever os testes que falham**

```typescript
// apps/api/src/modules/billing/domain/meses-pagaveis.spec.ts
import { describe, expect, it } from 'vitest';

import { LoteInvalidoError, mesesPagaveis, resolverLote, type InvoiceParaFaixa } from './meses-pagaveis.js';

const PRECO_150 = [{ amountMinor: 15000, currency: 'BRL', startsAt: new Date('2020-01-01T00:00:00Z'), endsAt: undefined }];

function invoice(overrides: Partial<InvoiceParaFaixa>): InvoiceParaFaixa {
  return {
    id: 'inv-1',
    billingPeriod: new Date('2026-09-01T00:00:00Z'),
    status: 'OPEN',
    totalMinor: 15000,
    dueAt: new Date('2026-09-09T00:00:00Z'),
    ...overrides,
  };
}

describe('mesesPagaveis', () => {
  it('aluno em dia: comeca no mes corrente, sem invoice aberta', () => {
    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa[0]).toEqual({
      competencia: new Date('2026-09-01T00:00:00Z'),
      status: 'NOT_OPENED',
      invoiceId: null,
      totalMinor: 15000,
      dueAt: new Date('2026-09-09T00:00:00Z'),
    });
    // corrente + 6 = 7 meses no total
    expect(faixa).toHaveLength(7);
    expect(faixa[6]!.competencia).toEqual(new Date('2027-03-01T00:00:00Z'));
  });

  it('2 meses vencidos: comeca no mais antigo em aberto, nao no corrente', () => {
    const faixa = mesesPagaveis({
      invoices: [
        invoice({ id: 'jul', billingPeriod: new Date('2026-07-01T00:00:00Z'), status: 'OVERDUE' }),
        invoice({ id: 'ago', billingPeriod: new Date('2026-08-01T00:00:00Z'), status: 'OVERDUE' }),
      ],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa[0]!.competencia).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(faixa[0]!.status).toBe('OVERDUE');
    expect(faixa[0]!.invoiceId).toBe('jul');
    expect(faixa[1]!.status).toBe('OVERDUE');
    expect(faixa[2]!.competencia).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(faixa[2]!.status).toBe('NOT_OPENED');
  });

  it('invoices PAID e CANCELLED nao aparecem na faixa', () => {
    const faixa = mesesPagaveis({
      invoices: [
        invoice({ id: 'jul', billingPeriod: new Date('2026-07-01T00:00:00Z'), status: 'PAID' }),
        invoice({ id: 'ago', billingPeriod: new Date('2026-08-01T00:00:00Z'), status: 'OVERDUE' }),
      ],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    expect(faixa[0]!.competencia).toEqual(new Date('2026-08-01T00:00:00Z'));
    expect(faixa.find((m) => m.invoiceId === 'jul')).toBeUndefined();
  });

  it('endsAt corta a faixa antes do teto de 6 meses', () => {
    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: new Date('2026-11-01T00:00:00Z'), // assinatura acaba no comeco de novembro
      prices: PRECO_150,
      dueDay: 9,
    });

    // set e out cabem (competencia < endsAt); nov nao cabe
    expect(faixa.map((m) => m.competencia.getUTCMonth())).toEqual([8, 9]); // set(8), out(9)
  });

  it('troca de preco no meio da faixa: cada NOT_OPENED usa o preco vigente da sua propria competencia', () => {
    const precos = [
      { amountMinor: 15000, currency: 'BRL', startsAt: new Date('2020-01-01T00:00:00Z'), endsAt: new Date('2026-10-01T00:00:00Z') },
      { amountMinor: 18000, currency: 'BRL', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: undefined },
    ];

    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-09-15T00:00:00Z'),
      endsAt: null,
      prices: precos,
      dueDay: 9,
    });

    const setembro = faixa.find((m) => m.competencia.getTime() === new Date('2026-09-01T00:00:00Z').getTime())!;
    const outubro = faixa.find((m) => m.competencia.getTime() === new Date('2026-10-01T00:00:00Z').getTime())!;
    expect(setembro.totalMinor).toBe(15000);
    expect(outubro.totalMinor).toBe(18000);
  });

  it('virada de ano: dezembro para janeiro incrementa o ano corretamente', () => {
    const faixa = mesesPagaveis({
      invoices: [],
      agora: new Date('2026-11-15T00:00:00Z'),
      endsAt: null,
      prices: PRECO_150,
      dueDay: 9,
    });

    const competencias = faixa.map((m) => m.competencia.toISOString().slice(0, 7));
    expect(competencias).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05']);
  });
});

describe('resolverLote', () => {
  const faixaBase = mesesPagaveis({
    invoices: [
      invoice({ id: 'jul', billingPeriod: new Date('2026-07-01T00:00:00Z'), status: 'OVERDUE' }),
      invoice({ id: 'ago', billingPeriod: new Date('2026-08-01T00:00:00Z'), status: 'OVERDUE' }),
    ],
    agora: new Date('2026-09-15T00:00:00Z'),
    endsAt: null,
    prices: PRECO_150,
    dueDay: 9,
  });

  it('ateCompetencia = jul devolve so o primeiro mes', () => {
    const lote = resolverLote(faixaBase, new Date('2026-07-01T00:00:00Z'));
    expect(lote).toHaveLength(1);
    expect(lote[0]!.invoiceId).toBe('jul');
  });

  it('ateCompetencia cobrindo vencidos + adiantados devolve todos os meses ate la, sem buraco', () => {
    const lote = resolverLote(faixaBase, new Date('2026-11-01T00:00:00Z'));
    // jul, ago, set, out, nov = 5 meses
    expect(lote).toHaveLength(5);
    expect(lote.map((m) => m.competencia.getUTCMonth())).toEqual([6, 7, 8, 9, 10]);
  });

  it('ateCompetencia fora da faixa (alem do teto) lanca LoteInvalidoError', () => {
    expect(() => resolverLote(faixaBase, new Date('2028-01-01T00:00:00Z'))).toThrow(LoteInvalidoError);
  });

  it('ateCompetencia antes do primeiro mes da faixa lanca LoteInvalidoError (nao ha como excluir o mais antigo)', () => {
    expect(() => resolverLote(faixaBase, new Date('2026-06-01T00:00:00Z'))).toThrow(LoteInvalidoError);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- meses-pagaveis.spec.ts`
Expected: FAIL — `Cannot find module './meses-pagaveis.js'`

- [ ] **Step 3: Implementar**

```typescript
// apps/api/src/modules/billing/domain/meses-pagaveis.ts
import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { competenciaDe, proximoVencimento } from './ciclo-de-cobranca.js';
import { precoVigenteEm, type PrecoVigente } from './dinheiro.js';

const TETO_MESES_ADIANTADOS = 6;

export type StatusDoMesPagavel = 'OVERDUE' | 'OPEN' | 'NOT_OPENED';

export interface MesPagavel {
  readonly competencia: Date;
  readonly status: StatusDoMesPagavel;
  readonly invoiceId: string | null;
  readonly totalMinor: number;
  readonly dueAt: Date;
}

export interface InvoiceParaFaixa {
  readonly id: string;
  readonly billingPeriod: Date;
  readonly status: 'OPEN' | 'OVERDUE' | 'PAID' | 'CANCELLED' | 'REFUNDED';
  readonly totalMinor: number;
  readonly dueAt: Date;
}

export class LoteInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_BATCH_OUT_OF_RANGE', 422, motivo);
  }
}

/**
 * Meses pagaveis: do mais antigo em aberto (OVERDUE/OPEN) ate a
 * competencia corrente + 6. Nunca pula mes -- e o que da a Decisao 1 do PI
 * (30/09/2026): selecao sem buraco.
 *
 * So invoice OVERDUE/OPEN entra na faixa; PAID/CANCELLED/REFUNDED ja
 * resolveram e nao aparecem aqui (elas ficam na tabela de historico).
 */
export function mesesPagaveis(entrada: {
  invoices: readonly InvoiceParaFaixa[];
  agora: Date;
  endsAt: Date | null;
  prices: readonly PrecoVigente[];
  dueDay: number;
}): MesPagavel[] {
  const emAberto = entrada.invoices
    .filter((i) => i.status === 'OPEN' || i.status === 'OVERDUE')
    .sort((a, b) => a.billingPeriod.getTime() - b.billingPeriod.getTime());

  const competenciaCorrente = competenciaDe(entrada.agora);
  const inicio = emAberto[0]?.billingPeriod ?? competenciaCorrente;

  const teto = new Date(Date.UTC(competenciaCorrente.getUTCFullYear(), competenciaCorrente.getUTCMonth() + TETO_MESES_ADIANTADOS, 1));

  const meses: MesPagavel[] = [];
  let cursor = new Date(inicio);

  while (cursor.getTime() <= teto.getTime()) {
    if (entrada.endsAt && cursor.getTime() >= entrada.endsAt.getTime()) {
      break;
    }

    const existente = emAberto.find((i) => i.billingPeriod.getTime() === cursor.getTime());

    if (existente) {
      meses.push({
        competencia: cursor,
        status: existente.status,
        invoiceId: existente.id,
        totalMinor: existente.totalMinor,
        dueAt: existente.dueAt,
      });
    } else {
      const preco = precoVigenteEm(entrada.prices, cursor);
      meses.push({
        competencia: cursor,
        status: 'NOT_OPENED',
        invoiceId: null,
        totalMinor: preco?.amountMinor ?? 0,
        dueAt: proximoVencimento(cursor, entrada.dueDay),
      });
    }

    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return meses;
}

/**
 * Recorta a faixa do inicio ate `ateCompetencia`, inclusive.
 *
 * Nao aceita excluir o mais antigo: a faixa ja comeca no mes em aberto mais
 * antigo (Decisao 1 do PI), entao "pagar so parte dos vencidos" nunca e uma
 * opcao valida aqui -- e por isso o corte e sempre um PREFIXO da faixa.
 */
export function resolverLote(faixa: readonly MesPagavel[], ateCompetencia: Date): MesPagavel[] {
  const indice = faixa.findIndex((m) => m.competencia.getTime() === ateCompetencia.getTime());

  if (indice === -1) {
    throw new LoteInvalidoError('competencia informada nao esta na faixa pagavel');
  }

  return faixa.slice(0, indice + 1);
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @arenahub/api test -- meses-pagaveis.spec.ts`
Expected: PASS (todos os `it`)

- [ ] **Step 5: Verificar a assinatura real de `precoVigenteEm` e `PrecoVigente`**

Abra `apps/api/src/modules/billing/domain/dinheiro.ts` e confirme que `PrecoVigente` é exportado com esse nome e esses campos (`amountMinor`, `currency`, `startsAt`, `endsAt?`). Se o nome do tipo for outro, ajuste o import em `meses-pagaveis.ts` para o nome real — não redeclare o tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing/domain/meses-pagaveis.ts apps/api/src/modules/billing/domain/meses-pagaveis.spec.ts
git commit -m "feat: dominio puro de meses pagaveis e resolucao de lote (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `BillingRepository` — transação compartilhada e guarda de concorrência

**Files:**
- Modify: `apps/api/src/modules/billing/billing.repository.ts:87-181` (`abrirInvoiceDoPeriodo`)
- Modify: `apps/api/src/modules/billing/billing.repository.ts:193-287` (`registrarPagamentoManual`)
- Test: `apps/api/src/modules/billing/billing.repository.spec.ts` (criar se não existir; senão, adicionar ao existente — confira primeiro com `ls apps/api/src/modules/billing/billing.repository.spec.ts`)

**Interfaces:**
- Consumes: nada novo — só reorganiza o corpo existente das duas funções.
- Produces:
  - `abrirInvoiceDoPeriodo(contexto: TenantContext, entrada: { subscriptionId: string; emQue: Date }, tx?: Prisma.TransactionClient): Promise<Invoice>`
  - `registrarPagamentoManual(contexto: TenantContext, entrada: { invoiceId: string; amountMinor: number; reason: string; paidAt: Date; receivedVia: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO'; batchId?: string }, correlationId: string, tx?: Prisma.TransactionClient): Promise<Payment>`
  - Novo erro: `class TransicaoDeInvoiceConcorrenteError extends ErroDeDominio` com `code: 'BILLING_INVOICE_ALREADY_SETTLED'`, `status: 409` — lançado quando o `updateMany` condicionado não afeta exatamente 1 linha. Definir em `apps/api/src/modules/billing/domain/invoice.ts` (mesmo arquivo de `InvoiceInvalidaError`), exportar dali.

Este task só reestrutura o **caminho existente** (`registrarPagamentoManual` avulso). O caso de uso do lote (Task 3) é quem vai passar `tx` de fora.

- [ ] **Step 1: Ler o arquivo de teste existente do repository, se houver, para não duplicar setup**

```bash
find apps/api/src/modules/billing -iname "billing.repository*.spec.ts" -o -iname "billing.repository*.int-spec.ts"
```

Se existir um `.int-spec.ts` para `registrarPagamentoManual`, é ali que o teste de guarda de concorrência (Task 4) vai morar — pular a duplicação de setup aqui é aceitável; a Task 4 cobre o cenário fim a fim com banco real. Este task foca só na mudança de assinatura e na troca do `update` por `updateMany`.

- [ ] **Step 2: Adicionar `TransicaoDeInvoiceConcorrenteError` em `domain/invoice.ts`**

Abra `apps/api/src/modules/billing/domain/invoice.ts` e adicione, logo após `InvoiceInvalidaError`:

```typescript
/**
 * A invoice ja foi paga (ou cancelada/estornada) por OUTRA operacao entre a
 * leitura do status e a escrita desta. 409, nao 422: o pedido em si estava
 * correto, so chegou depois de outro que jah resolveu a mesma invoice --
 * caso classico de recebimento avulso e lote em corrida sobre o mesmo mes.
 */
export class TransicaoDeInvoiceConcorrenteError extends ErroDeDominio {
  constructor(invoiceId: string) {
    super('BILLING_INVOICE_ALREADY_SETTLED', 409, `invoice ${invoiceId} ja foi resolvida por outra operacao`);
  }
}
```

- [ ] **Step 3: Reescrever `abrirInvoiceDoPeriodo` para aceitar `tx` opcional**

Em `apps/api/src/modules/billing/billing.repository.ts`, substitua o método inteiro (linhas 87-181) por:

```typescript
  async abrirInvoiceDoPeriodo(
    contexto: TenantContext,
    entrada: { subscriptionId: string; emQue: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<Invoice> {
    const competencia = competenciaDe(entrada.emQue);

    const cliente = tx ?? this.db;

    const assinatura = await cliente.subscription.findFirst({
      where: { id: entrada.subscriptionId, tenantId: contexto.tenantId },
      include: { plan: { include: { prices: true } } },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaError();
    }

    const configuracao = await cliente.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteError();
    }

    const preco = precoVigenteEm(assinatura.plan.prices, competencia);

    if (!preco) {
      throw new PlanoSemPrecoVigenteError();
    }

    const vencimento = proximoVencimento(competencia, configuracao.dueDay);
    const totais = abrirInvoice({
      itens: [{ quantity: 1, unitAmountMinor: preco.amountMinor }],
      discountMinor: 0,
      dueAt: vencimento,
    });

    const executar = async (tx: Prisma.TransactionClient): Promise<Invoice> => {
      // Idempotencia ANTES de consumir numero: sem isto, a segunda chamada
      // gastaria um numero de invoice para depois descobrir que a linha ja
      // existe -- e a numeracao ficaria com buraco.
      const jaExiste = await tx.invoice.findUnique({
        where: {
          tenantId_subscriptionId_billingPeriod: {
            tenantId: contexto.tenantId,
            subscriptionId: entrada.subscriptionId,
            billingPeriod: competencia,
          },
        },
      });

      if (jaExiste) {
        return jaExiste;
      }

      const numero = await this.proximoNumero(tx, contexto.tenantId);

      const invoice = await tx.invoice.create({
        data: {
          tenantId: contexto.tenantId,
          subscriptionId: entrada.subscriptionId,
          studentId: assinatura.studentId,
          billingPeriod: competencia,
          status: 'OPEN',
          number: numero,
          currency: preco.currency,
          subtotalMinor: totais.subtotalMinor,
          discountMinor: totais.discountMinor,
          totalMinor: totais.totalMinor,
          dueAt: vencimento,
          blockAt: instanteDeBloqueio(vencimento, configuracao.graceDays),
          items: {
            create: [
              {
                tenantId: contexto.tenantId,
                description: assinatura.plan.name,
                quantity: 1,
                unitAmountMinor: preco.amountMinor,
                totalMinor: preco.amountMinor,
              },
            ],
          },
        },
      });

      await this.publicarEvento(tx, contexto, {
        invoiceId: invoice.id,
        eventType: 'InvoiceOpened',
        payload: { number: numero, totalMinor: totais.totalMinor },
      });

      return invoice;
    };

    return tx ? executar(tx) : this.db.$transaction(executar);
  }
```

**Nota:** `cliente = tx ?? this.db` é usado só nas duas leituras iniciais (`subscription.findFirst`, `billingSettings.findUnique`), que hoje já rodam fora da transação original — manter isso. A parte que precisa de atomicidade (idempotência + criação) continua isolada em `executar`, que roda dentro do `tx` recebido ou de um novo.

- [ ] **Step 4: Reescrever `registrarPagamentoManual` com a guarda condicionada e `tx` opcional**

Substitua o método inteiro (linhas 193-287) por:

```typescript
  async registrarPagamentoManual(
    contexto: TenantContext,
    entrada: {
      invoiceId: string;
      amountMinor: number;
      reason: string;
      paidAt: Date;
      receivedVia: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
      batchId?: string;
    },
    correlationId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Payment> {
    const cliente = tx ?? this.db;

    const invoice = await cliente.invoice.findFirst({
      where: { id: entrada.invoiceId, tenantId: contexto.tenantId },
    });

    if (!invoice) {
      throw new InvoiceNaoEncontradaError();
    }

    if (!podeTransicionar(invoice.status, 'PAID')) {
      throw new TransicaoDeInvoiceInvalidaError(invoice.status, 'PAID');
    }

    // Rejeita parcial e calcula o troco que vira credito. A regra mora no
    // dominio puro, testada sem banco.
    const resultado = aplicarPagamento(invoice.totalMinor, entrada.amountMinor);

    const executar = async (tx: Prisma.TransactionClient): Promise<Payment> => {
      /**
       * Transicao CONDICIONADA, nao `update` incondicional (F83, issue
       * #458): duas chamadas concorrentes sobre a MESMA invoice -- um
       * recebimento avulso e um lote, por exemplo -- podem ambas ler
       * `OPEN` e ambas tentar pagar. O `updateMany` com filtro de status
       * garante que so UMA transiciona para `PAID`; a outra recebe
       * `count !== 1` e falha aqui, antes de criar qualquer `Payment`.
       *
       * A garantia real e "a invoice transiciona para PAID uma vez so" --
       * NAO "no maximo 1 Payment CONFIRMED por invoice" (esse invariante e
       * falso por desenho: o webhook PIX grava um segundo Payment numa
       * invoice ja PAID e manda o valor para credito).
       */
      const transicao = await tx.invoice.updateMany({
        where: { id: invoice.id, tenantId: contexto.tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
        data: { status: 'PAID', paidAt: entrada.paidAt, version: { increment: 1 } },
      });

      if (transicao.count !== 1) {
        throw new TransicaoDeInvoiceConcorrenteError(invoice.id);
      }

      const pagamento = await tx.payment.create({
        data: {
          tenantId: contexto.tenantId,
          invoiceId: invoice.id,
          amountMinor: entrada.amountMinor,
          currency: invoice.currency,
          method: 'MANUAL',
          status: 'CONFIRMED',
          paidAt: entrada.paidAt,
          recognizedByUserId: contexto.actorId,
          receivedVia: entrada.receivedVia,
          batchId: entrada.batchId ?? null,
        },
      });

      // Sobrepagamento vira credito do aluno (ADR-027, resposta 4 do PI).
      if (resultado.creditoMinor > 0) {
        await tx.accountCredit.create({
          data: {
            tenantId: contexto.tenantId,
            studentId: invoice.studentId,
            originPaymentId: pagamento.id,
            amountMinor: resultado.creditoMinor,
            currency: invoice.currency,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.payment.manual',
          target: 'Payment',
          targetId: pagamento.id,
          correlationId,
          metadata: {
            invoiceId: invoice.id,
            amountMinor: entrada.amountMinor,
            creditoMinor: resultado.creditoMinor,
            reason: entrada.reason,
            receivedVia: entrada.receivedVia,
            batchId: entrada.batchId ?? null,
          },
        },
      });

      await this.ativarDireitoDeAcessoSePendente(tx, {
        tenantId: contexto.tenantId,
        subscriptionId: invoice.subscriptionId,
      });

      await this.publicarEvento(tx, contexto, {
        invoiceId: invoice.id,
        eventType: 'InvoicePaid',
        payload: { paymentId: pagamento.id, method: 'MANUAL' },
      });

      return pagamento;
    };

    return tx ? executar(tx) : this.db.$transaction(executar);
  }
```

- [ ] **Step 5: Rodar os testes existentes de billing para garantir que nada quebrou**

Run: `pnpm --filter @arenahub/api test -- billing`
Expected: PASS em todos os specs unitários existentes (nenhum teste unitário deveria testar a assinatura interna dessas funções — se algum mock quebrar por causa do `tx?`, ajuste a chamada no mock, não a assinatura).

- [ ] **Step 6: Rodar o typecheck**

Run: `pnpm --filter @arenahub/api typecheck`
Expected: sem erro. Se `PrismaService['$transaction']` não expõe `Prisma.TransactionClient` diretamente, confira o tipo real usado em `estornar-pagamento.use-case.ts:384` (`Parameters<Parameters<PrismaService['$transaction']>[0]>[0]`) e alinhe a assinatura de `tx?:` com esse mesmo tipo em vez de `Prisma.TransactionClient` se forem diferentes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/billing.repository.ts apps/api/src/modules/billing/domain/invoice.ts
git commit -m "fix: registrarPagamentoManual usa transicao condicionada, evita pagamento em dobro na corrida (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Schema — `Payment.batchId` e `Payment.batchRequestHash`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: migração gerada pelo Prisma (caminho exato definido pelo comando)

**Interfaces:**
- Consumes: nenhum.
- Produces: `Payment.batchId String?`, `Payment.batchRequestHash String?`, índice `@@index([tenantId, batchId])`.

- [ ] **Step 1: Localizar o model `Payment` no schema**

```bash
grep -n "^model Payment" packages/database/prisma/schema.prisma
```

- [ ] **Step 2: Adicionar os dois campos e o índice**

Na declaração de `Payment` (por volta da linha 3586, conforme mapeado na pesquisa), adicione, perto dos demais campos opcionais de rastreamento:

```prisma
  /// Agrupa N Payments de um pagamento em lote (F83). Null para pagamento
  /// avulso -- nao existe lote de 1.
  batchId            String?
  /// Hash do corpo do primeiro pedido deste batchId (ateCompetencia +
  /// channel + expectedTotalMinor). So preenchido no primeiro Payment do
  /// lote; usado para recusar reenvio da mesma Idempotency-Key com corpo
  /// diferente (F83, issue #458).
  batchRequestHash   String?
```

E, no bloco de índices do mesmo model:

```prisma
  @@index([tenantId, batchId])
```

- [ ] **Step 3: Gerar a migração**

Run: `pnpm --filter @arenahub/database prisma migrate dev --name add_payment_batch`
Expected: migração criada em `packages/database/prisma/migrations/<timestamp>_add_payment_batch/migration.sql`, contendo só `ALTER TABLE payments ADD COLUMN ...` e `CREATE INDEX ...` — nenhum `DROP`, nenhum backfill.

- [ ] **Step 4: Conferir a migração gerada**

Abra o arquivo `migration.sql` gerado e confirme que só adiciona colunas nullable e um índice — se o Prisma gerar qualquer coisa destrutiva (não deveria, campos são opcionais), pare e ajuste o schema antes de aplicar.

- [ ] **Step 5: Regenerar o client Prisma**

Run: `pnpm --filter @arenahub/database prisma generate`
Expected: sem erro; `Payment` no client TypeScript agora tem `batchId` e `batchRequestHash`.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat: adiciona Payment.batchId e batchRequestHash para pagamento em lote (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Caso de uso — `RegistrarPagamentoEmLoteUseCase`

**Files:**
- Create: `apps/api/src/modules/billing/registrar-pagamento-em-lote.use-case.ts`
- Create: `apps/api/src/modules/billing/consultar-meses-pagaveis.use-case.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`
- Test: `apps/api/test/integration/billing-pagamento-em-lote.int-spec.ts`

**Interfaces:**
- Consumes:
  - `BillingRepository.abrirInvoiceDoPeriodo(contexto, entrada, tx)` (Task 2)
  - `BillingRepository.registrarPagamentoManual(contexto, entrada, correlationId, tx)` (Task 2)
  - `mesesPagaveis`, `resolverLote`, `LoteInvalidoError` de `./domain/meses-pagaveis.js` (Task 1)
  - `PrismaService` (mesmo padrão de outros use cases do módulo)
- Produces:
  - `class ConsultarMesesPagaveisUseCase { async executar(contexto: TenantContext, subscriptionId: string): Promise<MesPagavel[]> }`
  - `class RegistrarPagamentoEmLoteUseCase { async executar(contexto: TenantContext, entrada: { subscriptionId: string; ateCompetencia: Date; channel: 'DINHEIRO'|'PIX'|'DEBITO'|'CREDITO'; expectedTotalMinor: number; receivedAmountMinor?: number; idempotencyKey: string; agora: Date }, correlationId: string): Promise<{ batchId: string; invoiceIds: string[]; totalMinor: number }> }`
  - `class TotalDoLoteDivergenteError extends ErroDeDominio` — `code: 'BILLING_BATCH_TOTAL_CHANGED'`, `status: 409`
  - `class IdempotencyKeyComCorpoDiferenteError extends ErroDeDominio` — `code: 'BILLING_BATCH_IDEMPOTENCY_MISMATCH'`, `status: 422`

- [ ] **Step 1: Escrever o teste de integração que falha (caminho feliz + concorrência + idempotência)**

Primeiro, confira o setup padrão de um `.int-spec.ts` de billing existente para reaproveitar helpers de fixture (criação de tenant, aluno, assinatura, plano com preço):

```bash
sed -n '1,60p' apps/api/test/integration/billing-pagos.int-spec.ts
```

Use os mesmos helpers de fixture encontrados ali (nomes exatos dependem do arquivo — copie o padrão, não invente um novo). Escreva:

```typescript
// apps/api/test/integration/billing-pagamento-em-lote.int-spec.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest'; // ou jest, conforme o padrao do arquivo copiado no Step 1

// Importar os mesmos helpers de setup (criarTenant, criarAlunoComAssinatura, etc.)
// encontrados no arquivo de referencia do Step 1. Nomes exatos: copiar do
// arquivo real, nao inventar.

describe('RegistrarPagamentoEmLoteUseCase', () => {
  it('deve 2 meses, paga ate corrente+2: 5 invoices PAID, 5 Payments com mesmo batchId, assinatura e entitlement ACTIVE', async () => {
    // Arrange: tenant, aluno, assinatura com 2 meses OVERDUE (jul, ago),
    // "agora" = set/2026, dueDay = 9.
    // Act: chamar useCase.executar com ateCompetencia = nov/2026
    //   (corrente=set + 2 = nov), channel='DINHEIRO', expectedTotalMinor
    //   calculado a partir de consultarMesesPagaveis.
    // Assert:
    //   - 5 invoices no banco para essa subscription, todas status PAID
    //   - 5 payments com o mesmo batchId retornado
    //   - subscription.status === 'ACTIVE'
    //   - entitlement.status === 'ACTIVE'
  });

  it('mesma Idempotency-Key + mesmo corpo repetido: nenhum Payment novo, devolve resultado anterior', async () => {
    // Act: chamar executar duas vezes com a MESMA idempotencyKey e o MESMO
    //   corpo (ateCompetencia, channel, expectedTotalMinor iguais).
    // Assert: contagem de Payment no banco e a mesma apos as duas chamadas;
    //   os dois retornos tem o mesmo batchId.
  });

  it('mesma Idempotency-Key + corpo diferente: 422, nada gravado', async () => {
    // Act: primeira chamada com ateCompetencia = set; segunda chamada com a
    //   MESMA idempotencyKey mas ateCompetencia = out.
    // Assert: segunda chamada lanca IdempotencyKeyComCorpoDiferenteError;
    //   contagem de invoices/payments igual a antes da segunda chamada.
  });

  it('recebimento avulso e lote concorrentes sobre a mesma invoice: so um transiciona para PAID', async () => {
    // Arrange: aluno com 1 mes OVERDUE (jul).
    // Act: disparar em paralelo (Promise.allSettled)
    //   1) billingRepository.registrarPagamentoManual(contexto, { invoiceId: <jul>, ... })
    //   2) registrarPagamentoEmLoteUseCase.executar(contexto, { ateCompetencia: jul, ... })
    // Assert: exatamente uma das duas promises resolve, a outra rejeita com
    //   TransicaoDeInvoiceConcorrenteError; no banco, a invoice de julho
    //   tem EXATAMENTE 1 Payment CONFIRMED e status PAID (nao verificar
    //   ordem/relogio, so o estado final).
  });

  it('expectedTotalMinor divergente do total calculado: 409, nada gravado', async () => {
    // Act: chamar executar com expectedTotalMinor errado (ex: metade do
    //   valor real).
    // Assert: lanca TotalDoLoteDivergenteError; nenhuma invoice nova
    //   aberta, nenhum payment criado.
  });

  it('falha plantada no terceiro mes desfaz os dois primeiros (atomicidade)', async () => {
    // Arrange: aluno sem nada em aberto, "agora" tal que o lote abriria 3
    //   meses novos (NOT_OPENED). Forcar uma falha no terceiro mes -- por
    //   exemplo, usando um mock/spy que faz o terceiro
    //   registrarPagamentoManual (chamado internamente pelo use case)
    //   lancar um erro generico depois que os dois primeiros ja rodaram
    //   dentro da MESMA transacao.
    // Assert: NENHUMA invoice nova existe no banco para essa subscription
    //   (nem as duas que "passaram" antes da falha) -- a transacao inteira
    //   foi desfeita.
  });

  it('job de inadimplencia rodado depois nao suspende quem pagou adiantado', async () => {
    // Arrange: aluno em dia, paga corrente + 2 meses adiantados via lote.
    // Act: rodar AplicarInadimplenciaUseCase (mesmo caso de uso do ciclo
    //   existente) com "agora" = corrente + 1 mes.
    // Assert: subscription continua ACTIVE, entitlement continua ACTIVE --
    //   as invoices dos meses futuros estao PAID, entao o job nao acha
    //   nada OPEN vencido para suspender.
  });

  it('tenant B nao enxerga assinatura do tenant A', async () => {
    // Act: chamar executar com o TenantContext do tenant B mas o
    //   subscriptionId de uma assinatura do tenant A.
    // Assert: lanca o erro de "assinatura nao encontrada" (mesmo
    //   comportamento de isolamento que abrirInvoiceDoPeriodo ja tem hoje).
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/api test:integration -- billing-pagamento-em-lote`
Expected: FAIL — módulos `registrar-pagamento-em-lote.use-case.js` e `consultar-meses-pagaveis.use-case.js` não existem.

- [ ] **Step 3: Implementar `ConsultarMesesPagaveisUseCase`**

```typescript
// apps/api/src/modules/billing/consultar-meses-pagaveis.use-case.ts
import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { AssinaturaNaoEncontradaError, ConfiguracaoFinanceiraAusenteError } from './billing.repository.js';
import { mesesPagaveis, type MesPagavel } from './domain/meses-pagaveis.js';

/**
 * Leitura pura da faixa de meses pagaveis (F83, issue #458). Nao grava
 * nada -- a invoice do mes NOT_OPENED so existe de verdade quando o lote e
 * de fato pago (RegistrarPagamentoEmLoteUseCase).
 */
@Injectable()
export class ConsultarMesesPagaveisUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(contexto: TenantContext, subscriptionId: string, agora: Date): Promise<MesPagavel[]> {
    const assinatura = await this.db.subscription.findFirst({
      where: { id: subscriptionId, tenantId: contexto.tenantId },
      include: { plan: { include: { prices: true } } },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaError();
    }

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteError();
    }

    const invoices = await this.db.invoice.findMany({
      where: { subscriptionId, tenantId: contexto.tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
    });

    return mesesPagaveis({
      invoices,
      agora,
      endsAt: assinatura.endsAt,
      prices: assinatura.plan.prices,
      dueDay: configuracao.dueDay,
    });
  }
}
```

**Nota:** confirme se `AssinaturaNaoEncontradaError` e `ConfiguracaoFinanceiraAusenteError` já são exportadas de `billing.repository.ts` (a pesquisa mostrou que são usadas lá dentro — confirme o `export` antes deste import).

- [ ] **Step 4: Implementar `RegistrarPagamentoEmLoteUseCase`**

```typescript
// apps/api/src/modules/billing/registrar-pagamento-em-lote.use-case.ts
import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { AssinaturaNaoEncontradaError, BillingRepository, ConfiguracaoFinanceiraAusenteError } from './billing.repository.js';
import { mesesPagaveis, resolverLote } from './domain/meses-pagaveis.js';

export class TotalDoLoteDivergenteError extends ErroDeDominio {
  constructor() {
    super('BILLING_BATCH_TOTAL_CHANGED', 409, 'o total do lote mudou desde que a tela foi carregada');
  }
}

export class IdempotencyKeyComCorpoDiferenteError extends ErroDeDominio {
  constructor() {
    super('BILLING_BATCH_IDEMPOTENCY_MISMATCH', 422, 'esta Idempotency-Key ja foi usada com um pedido diferente');
  }
}

export interface ResultadoDoLote {
  readonly batchId: string;
  readonly invoiceIds: string[];
  readonly totalMinor: number;
}

/**
 * Pagamento em lote no balcao (F83, issue #458): quita, numa transacao so,
 * uma faixa continua de meses -- vencidos, corrente e ate 6 adiantados.
 *
 * Reaproveita `abrirInvoiceDoPeriodo` e `registrarPagamentoManual` do
 * `BillingRepository`, passando o MESMO `tx` para as duas -- e o que faz o
 * lote inteiro ser atomico (falha em qualquer mes desfaz todos).
 */
@Injectable()
export class RegistrarPagamentoEmLoteUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly billing: BillingRepository,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: {
      subscriptionId: string;
      ateCompetencia: Date;
      channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
      expectedTotalMinor: number;
      receivedAmountMinor?: number;
      idempotencyKey: string;
      agora: Date;
    },
    correlationId: string,
  ): Promise<ResultadoDoLote> {
    const corpoHash = hashDoCorpo(entrada);

    /**
     * Idempotencia: procura um Payment ja gravado com este batchId. Se
     * achar, compara o hash do corpo -- corpo igual devolve o resultado
     * anterior sem gravar de novo; corpo diferente recusa (F83, decisao
     * tecnica da issue #458: nunca reprocessar nem devolver o lote errado).
     */
    const existente = await this.db.payment.findFirst({
      where: { tenantId: contexto.tenantId, batchId: entrada.idempotencyKey },
      select: { batchId: true, batchRequestHash: true, invoiceId: true, amountMinor: true },
    });

    if (existente) {
      if (existente.batchRequestHash !== corpoHash) {
        throw new IdempotencyKeyComCorpoDiferenteError();
      }

      const pagamentosDoLote = await this.db.payment.findMany({
        where: { tenantId: contexto.tenantId, batchId: entrada.idempotencyKey },
        select: { invoiceId: true, amountMinor: true },
      });

      return {
        batchId: entrada.idempotencyKey,
        invoiceIds: pagamentosDoLote.map((p) => p.invoiceId),
        totalMinor: pagamentosDoLote.reduce((soma, p) => soma + p.amountMinor, 0),
      };
    }

    const assinatura = await this.db.subscription.findFirst({
      where: { id: entrada.subscriptionId, tenantId: contexto.tenantId },
      include: { plan: { include: { prices: true } } },
    });

    if (!assinatura) {
      throw new AssinaturaNaoEncontradaError();
    }

    const configuracao = await this.db.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteError();
    }

    const invoicesAbertas = await this.db.invoice.findMany({
      where: { subscriptionId: entrada.subscriptionId, tenantId: contexto.tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
    });

    const faixa = mesesPagaveis({
      invoices: invoicesAbertas,
      agora: entrada.agora,
      endsAt: assinatura.endsAt,
      prices: assinatura.plan.prices,
      dueDay: configuracao.dueDay,
    });

    const lote = resolverLote(faixa, entrada.ateCompetencia);
    const totalCalculado = lote.reduce((soma, mes) => soma + mes.totalMinor, 0);

    if (totalCalculado !== entrada.expectedTotalMinor) {
      throw new TotalDoLoteDivergenteError();
    }

    const invoiceIds: string[] = [];

    await this.db.$transaction(async (tx) => {
      for (const mes of lote) {
        const invoice = mes.invoiceId
          ? await tx.invoice.findUniqueOrThrow({ where: { id: mes.invoiceId } })
          : await this.billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId: entrada.subscriptionId, emQue: mes.competencia }, tx);

        const pagamento = await this.billing.registrarPagamentoManual(
          contexto,
          {
            invoiceId: invoice.id,
            amountMinor: mes.totalMinor,
            reason: `pagamento em lote ate ${entrada.ateCompetencia.toISOString().slice(0, 7)}`,
            paidAt: entrada.agora,
            receivedVia: entrada.channel,
            batchId: entrada.idempotencyKey,
          },
          correlationId,
          tx,
        );

        invoiceIds.push(invoice.id);

        // So o PRIMEIRO Payment do lote carrega o hash -- e o que a
        // checagem de idempotencia acima consulta.
        if (invoiceIds.length === 1) {
          await tx.payment.update({ where: { id: pagamento.id }, data: { batchRequestHash: corpoHash } });
        }
      }

      const excedente = (entrada.receivedAmountMinor ?? totalCalculado) - totalCalculado;

      if (excedente > 0) {
        await tx.accountCredit.create({
          data: {
            tenantId: contexto.tenantId,
            studentId: assinatura.studentId,
            originPaymentId: null,
            amountMinor: excedente,
            currency: lote[0]?.totalMinor !== undefined ? assinatura.plan.prices[0]!.currency : 'BRL',
          },
        });
      }
    });

    return { batchId: entrada.idempotencyKey, invoiceIds, totalMinor: totalCalculado };
  }
}

function hashDoCorpo(entrada: { ateCompetencia: Date; channel: string; expectedTotalMinor: number }): string {
  return createHash('sha256')
    .update(`${entrada.ateCompetencia.toISOString()}|${entrada.channel}|${entrada.expectedTotalMinor}`)
    .digest('hex');
}
```

**Atenção ao implementar:** confira o schema de `AccountCredit` — a pesquisa mostrou `originPaymentId` como campo obrigatório rastreável em `registrarPagamentoManual` (`billing.repository.ts:248`). Se `originPaymentId` for **não-nulo** no schema, o crédito de excedente do lote precisa apontar para o **último** `Payment` criado no lote (não `null`) — ajuste antes de rodar o teste. Verifique com:

```bash
grep -n "originPaymentId" packages/database/prisma/schema.prisma
```

Se for obrigatório, troque `originPaymentId: null` por `originPaymentId: pagamento.id` referenciando o último `pagamento` criado no loop (capture a variável fora do loop).

- [ ] **Step 5: Registrar os dois providers em `billing.module.ts`**

Adicione os imports e as entradas em `providers`:

```typescript
import { ConsultarMesesPagaveisUseCase } from './consultar-meses-pagaveis.use-case.js';
import { RegistrarPagamentoEmLoteUseCase } from './registrar-pagamento-em-lote.use-case.js';
```

E na lista `providers: [...]`, adicione `ConsultarMesesPagaveisUseCase, RegistrarPagamentoEmLoteUseCase,` junto dos demais use cases já listados.

- [ ] **Step 6: Rodar os testes de integração e confirmar sucesso**

Run: `pnpm --filter @arenahub/api test:integration -- billing-pagamento-em-lote`
Expected: PASS em todos os `it`. Se o teste de atomicidade (falha plantada) for difícil de forçar sem um mock, alternativa aceitável: usar um `subscriptionId` que causa erro no meio (ex.: um `studentId` que viola uma constraint em algum mês específico) — documente no teste qual mecanismo de falha foi usado.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/registrar-pagamento-em-lote.use-case.ts apps/api/src/modules/billing/consultar-meses-pagaveis.use-case.ts apps/api/src/modules/billing/billing.module.ts apps/api/test/integration/billing-pagamento-em-lote.int-spec.ts
git commit -m "feat: caso de uso de pagamento em lote com idempotencia e atomicidade (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Rotas HTTP

**Files:**
- Modify: `apps/api/src/modules/billing/billing.controller.ts`

**Interfaces:**
- Consumes: `ConsultarMesesPagaveisUseCase`, `RegistrarPagamentoEmLoteUseCase` (Task 4)
- Produces: `GET /api/v1/subscriptions/:id/payable-months`, `POST /api/v1/subscriptions/:id/manual-payment-batch`

- [ ] **Step 1: Localizar onde injetar os novos use cases no controller**

```bash
grep -n "constructor(" apps/api/src/modules/billing/billing.controller.ts
```

Adicione `private readonly consultarMesesPagaveis: ConsultarMesesPagaveisUseCase` e `private readonly registrarPagamentoEmLote: RegistrarPagamentoEmLoteUseCase` na lista de injeção, seguindo o padrão dos outros use cases já injetados ali.

- [ ] **Step 2: Adicionar os schemas Zod**

Próximo aos outros `const esquemaDe... = z.object({...}).strict()` do arquivo (por volta da linha 172), adicione:

```typescript
const esquemaDePagamentoEmLote = z
  .object({
    /** 'YYYY-MM' -- mesmo formato usado na tela, convertido para Date(UTC, dia 1) no controller. */
    ateCompetencia: z.string().regex(/^\d{4}-\d{2}$/),
    channel: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO']),
    expectedTotalMinor: z.number().int().min(0),
    receivedAmountMinor: z.number().int().min(0).optional(),
  })
  .strict();
```

- [ ] **Step 3: Adicionar as duas rotas**

Próximo à rota `manual-payment` existente, adicione:

```typescript
  /**
   * Faixa de meses pagaveis: do mais antigo em aberto ate corrente + 6
   * (F83, issue #458). Leitura pura -- nao grava nada.
   */
  @Get('subscriptions/:id/payable-months')
  @RequirePermissions('billing.manage')
  async consultarMesesPagaveisRota(@Param('id') id: string): Promise<{ months: MesPagavelDto[] }> {
    const agora = new Date();
    const meses = await this.consultarMesesPagaveis.executar(this.contexto.require(), id, agora);

    return {
      months: meses.map((m) => ({
        competencia: m.competencia.toISOString().slice(0, 7),
        status: m.status,
        invoiceId: m.invoiceId,
        totalMinor: m.totalMinor,
        dueAt: m.dueAt.toISOString(),
      })),
    };
  }

  /**
   * Recebe uma faixa continua de meses numa unica operacao (F83, issue
   * #458). `Idempotency-Key` e obrigatorio -- vira o `batchId`, e repetir
   * a chave com o MESMO corpo devolve o resultado anterior sem regravar;
   * com corpo DIFERENTE, recusa (422).
   */
  @Post('subscriptions/:id/manual-payment-batch')
  @RequirePermissions('billing.payment.manual')
  async registrarPagamentoEmLoteRota(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<{ batchId: string; invoiceIds: string[]; totalMinor: number }> {
    if (!idempotencyKey) {
      throw new IdempotencyKeyAusenteError();
    }

    const dados = esquemaDePagamentoEmLote.parse(corpo);
    const [ano, mes] = dados.ateCompetencia.split('-').map(Number);

    return this.registrarPagamentoEmLote.executar(
      this.contexto.require(),
      {
        subscriptionId: id,
        ateCompetencia: new Date(Date.UTC(ano!, mes! - 1, 1)),
        channel: dados.channel,
        expectedTotalMinor: dados.expectedTotalMinor,
        receivedAmountMinor: dados.receivedAmountMinor,
        idempotencyKey,
        agora: new Date(),
      },
      randomUUID(), // mesmo padrao de correlationId usado nas outras rotas do controller -- confirme o helper exato usado alhures no arquivo (ex.: `this.correlationId()` ou `randomUUID()` direto) e replique
    );
  }
```

Adicione também, no topo do arquivo perto dos outros erros de domínio importados/definidos:

```typescript
class IdempotencyKeyAusenteError extends ErroDeDominio {
  constructor() {
    super('BILLING_IDEMPOTENCY_KEY_REQUIRED', 422, 'header Idempotency-Key e obrigatorio para pagamento em lote');
  }
}

interface MesPagavelDto {
  competencia: string;
  status: 'OVERDUE' | 'OPEN' | 'NOT_OPENED';
  invoiceId: string | null;
  totalMinor: number;
  dueAt: string;
}
```

**Antes de finalizar este step:** confirme o padrão real de geração de `correlationId` usado pelas outras rotas do mesmo controller (`grep -n "correlationId" apps/api/src/modules/billing/billing.controller.ts`) e replique exatamente esse padrão em vez de assumir `randomUUID()` direto — pode já existir um helper/interceptor que popula isso.

- [ ] **Step 4: Rodar o teste de integração HTTP (se existir um `.int-spec.ts` de rotas de billing) ou criar verificação manual mínima**

```bash
grep -n "manual-payment\b" apps/api/test/integration/billing-http.int-spec.ts
```

Se esse arquivo já testa a rota `manual-payment` fazendo requisição HTTP real via supertest, adicione dois testes seguindo o mesmo padrão: um `GET .../payable-months` retornando 200 com a faixa esperada, um `POST .../manual-payment-batch` sem header `Idempotency-Key` retornando 422.

- [ ] **Step 5: Rodar o typecheck e os testes de integração**

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test:integration -- billing`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing/billing.controller.ts apps/api/test/integration/billing-http.int-spec.ts
git commit -m "feat: rotas GET payable-months e POST manual-payment-batch (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Server action e helper de seleção contínua (admin-web)

**Files:**
- Modify: `apps/admin-web/app/actions/billing.ts`
- Create: `apps/admin-web/src/billing/meses-pagaveis.ts`
- Create: `apps/admin-web/src/billing/meses-pagaveis.test.ts`

**Interfaces:**
- Consumes: nenhuma interface de backend nova além do payload JSON das duas rotas da Task 5 (contrato: `{ months: MesPagavelDto[] }` e `{ batchId, invoiceIds, totalMinor }`).
- Produces:
  - `async function receberPagamentoEmLote(input: { subscriptionId: string; ateCompetencia: string; channel: 'DINHEIRO'|'PIX'|'DEBITO'|'CREDITO'; expectedTotalMinor: number; receivedAmountMinor?: number }): Promise<{ ok: true; batchId: string } | { ok: false; error: string }>` em `billing.ts`
  - `type MesPagavelUI = { competencia: string; status: 'OVERDUE'|'OPEN'|'NOT_OPENED'; invoiceId: string | null; totalMinor: number; dueAt: string }`
  - `function selecionarAte(faixa: readonly MesPagavelUI[], competenciaClicada: string): MesPagavelUI[]` — prefixo contínuo da faixa até a competência clicada, mesma regra de `resolverLote` no cliente (para feedback visual instantâneo, sem round-trip).

- [ ] **Step 1: Escrever o teste do helper de seleção que falha**

```typescript
// apps/admin-web/src/billing/meses-pagaveis.test.ts
import { describe, expect, it } from 'vitest';

import { selecionarAte, type MesPagavelUI } from './meses-pagaveis';

const FAIXA: MesPagavelUI[] = [
  { competencia: '2026-07', status: 'OVERDUE', invoiceId: 'jul', totalMinor: 15000, dueAt: '2026-07-09' },
  { competencia: '2026-08', status: 'OVERDUE', invoiceId: 'ago', totalMinor: 15000, dueAt: '2026-08-09' },
  { competencia: '2026-09', status: 'OPEN', invoiceId: 'set', totalMinor: 15000, dueAt: '2026-09-09' },
  { competencia: '2026-10', status: 'NOT_OPENED', invoiceId: null, totalMinor: 15000, dueAt: '2026-10-09' },
];

describe('selecionarAte', () => {
  it('clicar no primeiro mes seleciona so ele', () => {
    expect(selecionarAte(FAIXA, '2026-07')).toEqual([FAIXA[0]]);
  });

  it('clicar no terceiro mes seleciona os tres primeiros, sem buraco', () => {
    expect(selecionarAte(FAIXA, '2026-09')).toEqual([FAIXA[0], FAIXA[1], FAIXA[2]]);
  });

  it('clicar no ultimo mes (adiantado) seleciona a faixa inteira', () => {
    expect(selecionarAte(FAIXA, '2026-10')).toEqual(FAIXA);
  });

  it('competencia que nao esta na faixa devolve array vazio (estado invalido, tela nao deve permitir)', () => {
    expect(selecionarAte(FAIXA, '2099-01')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/admin-web test -- meses-pagaveis.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o helper**

```typescript
// apps/admin-web/src/billing/meses-pagaveis.ts

export interface MesPagavelUI {
  readonly competencia: string; // 'YYYY-MM'
  readonly status: 'OVERDUE' | 'OPEN' | 'NOT_OPENED';
  readonly invoiceId: string | null;
  readonly totalMinor: number;
  readonly dueAt: string;
}

/**
 * Prefixo continuo da faixa ate a competencia clicada -- mesma regra do
 * `resolverLote` do backend (F83), replicada aqui so para feedback visual
 * instantaneo no clique. O servidor SEMPRE recalcula e e a fonte de
 * verdade; este helper nunca decide o que e cobrado.
 */
export function selecionarAte(faixa: readonly MesPagavelUI[], competenciaClicada: string): MesPagavelUI[] {
  const indice = faixa.findIndex((m) => m.competencia === competenciaClicada);

  if (indice === -1) {
    return [];
  }

  return faixa.slice(0, indice + 1);
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @arenahub/admin-web test -- meses-pagaveis.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar a server action**

Primeiro, veja o padrão exato de `registrarPagamentoNoBalcao` existente para replicar (tratamento de erro, formato de retorno, geração de `Idempotency-Key`):

```bash
grep -n "registrarPagamentoNoBalcao\|abrirCobranca" -A 30 apps/admin-web/app/actions/billing.ts | head -80
```

Adicione, seguindo exatamente esse padrão (fetch para a API, mesmo tratamento de erro HTTP → `{ ok: false, error }`):

```typescript
export async function receberPagamentoEmLote(input: {
  subscriptionId: string;
  ateCompetencia: string;
  channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
  expectedTotalMinor: number;
  receivedAmountMinor?: number;
}): Promise<{ ok: true; batchId: string } | { ok: false; error: string }> {
  const idempotencyKey = crypto.randomUUID();

  // Replicar aqui o mesmo helper de fetch autenticado (baseUrl, headers de
  // sessao, tratamento de erro) usado por `registrarPagamentoNoBalcao` --
  // copiar o padrao exato encontrado no Step 5, nao reinventar.
  const resposta = await fetchApi(`/api/v1/subscriptions/${input.subscriptionId}/manual-payment-batch`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {
      ateCompetencia: input.ateCompetencia,
      channel: input.channel,
      expectedTotalMinor: input.expectedTotalMinor,
      receivedAmountMinor: input.receivedAmountMinor,
    },
  });

  if (!resposta.ok) {
    return { ok: false, error: resposta.error };
  }

  return { ok: true, batchId: resposta.data.batchId };
}

export async function consultarMesesPagaveis(subscriptionId: string): Promise<MesPagavelUI[]> {
  const resposta = await fetchApi(`/api/v1/subscriptions/${subscriptionId}/payable-months`, { method: 'GET' });

  if (!resposta.ok) {
    return [];
  }

  return resposta.data.months;
}
```

**Nota:** `fetchApi` é um placeholder — use o nome real do helper HTTP encontrado no Step 5. O tipo `MesPagavelUI` deve ser importado de `src/billing/meses-pagaveis.ts`.

- [ ] **Step 6: Rodar o typecheck**

Run: `pnpm --filter @arenahub/admin-web typecheck`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/app/actions/billing.ts apps/admin-web/src/billing/meses-pagaveis.ts apps/admin-web/src/billing/meses-pagaveis.test.ts
git commit -m "feat: server action e selecao continua de meses no cliente (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Componente de tela — faixa de meses

**Files:**
- Create: `apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.tsx`
- Create: `apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.module.css`
- Create: `apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.test.tsx`
- Modify: `apps/admin-web/app/(protected)/students/[id]/billing/painel-de-cobranca.tsx`

**Interfaces:**
- Consumes: `MesPagavelUI`, `selecionarAte` (Task 6); `receberPagamentoEmLote`, `consultarMesesPagaveis` (Task 6); `seletor-de-forma.tsx` existente (confirme a prop exata lendo o arquivo antes de usar).
- Produces: componente `<FaixaDeMeses subscriptionId={...} onPago={() => void} />`.

- [ ] **Step 1: Ler `seletor-de-forma.tsx` e `painel-de-cobranca.tsx` para copiar convenções de props, Toast e CSS modules**

```bash
sed -n '1,60p' apps/admin-web/app/\(protected\)/students/\[id\]/billing/seletor-de-forma.tsx
sed -n '1,80p' apps/admin-web/app/\(protected\)/students/\[id\]/billing/painel-de-cobranca.tsx
```

Confirme: nome exato do componente de Toast usado no projeto (`import { toast } from ...` ou similar), formato de valor em Real (função de formatação já existente — não reescrever), e como `seletor-de-forma.tsx` expõe a forma escolhida (prop `value`/`onChange` ou callback).

- [ ] **Step 2: Escrever o teste de componente que falha**

```typescript
// apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { FaixaDeMeses } from './faixa-de-meses';

const FAIXA = [
  { competencia: '2026-07', status: 'OVERDUE' as const, invoiceId: 'jul', totalMinor: 15000, dueAt: '2026-07-09' },
  { competencia: '2026-08', status: 'OVERDUE' as const, invoiceId: 'ago', totalMinor: 15000, dueAt: '2026-08-09' },
  { competencia: '2026-09', status: 'OPEN' as const, invoiceId: 'set', totalMinor: 15000, dueAt: '2026-09-09' },
  { competencia: '2026-10', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-10-09' },
];

describe('FaixaDeMeses', () => {
  it('seleciona do vencido mais antigo ate o mes corrente por padrao', () => {
    render(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    // set (OPEN, mes corrente) e o ultimo selecionado por padrao -- os dois
    // OVERDUE (jul, ago) tambem estao selecionados.
    expect(screen.getByText(/3 meses/i)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 450,00/)).toBeInTheDocument();
  });

  it('clicar num mes adiantado estende a selecao sem criar buraco', () => {
    render(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /out\/26/i }));

    expect(screen.getByText(/4 meses/i)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 600,00/)).toBeInTheDocument();
  });

  it('clicar no ultimo mes selecionado recua a selecao em um', () => {
    render(<FaixaDeMeses faixa={FAIXA} subscriptionId="sub-1" onPago={vi.fn()} />);

    // set esta selecionado por padrao (ultimo da selecao inicial)
    fireEvent.click(screen.getByRole('button', { name: /set\/26/i }));

    expect(screen.getByText(/2 meses/i)).toBeInTheDocument();
  });

  it('aluno em dia (nenhum mes OVERDUE/OPEN antes do corrente) comeca sem selecao e botao desabilitado', () => {
    const semAtraso = [{ competencia: '2026-09', status: 'NOT_OPENED' as const, invoiceId: null, totalMinor: 15000, dueAt: '2026-09-09' }];

    render(<FaixaDeMeses faixa={semAtraso} subscriptionId="sub-1" onPago={vi.fn()} />);

    expect(screen.getByRole('button', { name: /receber/i })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/admin-web test -- faixa-de-meses.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 4: Implementar o componente**

```typescript
// apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.tsx
'use client';

import { useMemo, useState } from 'react';

import { receberPagamentoEmLote, type MesPagavelUI } from '../../../../actions/billing';
// Ajustar o import de `toast` e `SeletorDeForma` para os caminhos reais do
// projeto, confirmados no Step 1 da Task 7.
import { SeletorDeForma } from './seletor-de-forma';
import { toast } from '../../../../../src/ui/toast'; // caminho placeholder -- confirmar

import styles from './faixa-de-meses.module.css';

interface FaixaDeMesesProps {
  faixa: readonly MesPagavelUI[];
  subscriptionId: string;
  onPago: () => void;
}

const ROTULO_STATUS: Record<MesPagavelUI['status'], string> = {
  OVERDUE: 'Vencido',
  OPEN: 'Em aberto',
  NOT_OPENED: 'Adiantado',
};

function formatarReal(minor: number): string {
  return (minor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarMesAno(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[Number(mes) - 1]}/${ano!.slice(2)}`;
}

/** Indice do ultimo mes que faz parte da selecao inicial: todo OVERDUE + o primeiro OPEN. */
function indiceInicial(faixa: readonly MesPagavelUI[]): number {
  let ultimo = -1;

  for (let i = 0; i < faixa.length; i += 1) {
    if (faixa[i]!.status === 'OVERDUE' || faixa[i]!.status === 'OPEN') {
      ultimo = i;
    } else {
      break;
    }
  }

  return ultimo;
}

export function FaixaDeMeses({ faixa, subscriptionId, onPago }: FaixaDeMesesProps): JSX.Element {
  const [indiceSelecionado, setIndiceSelecionado] = useState(() => indiceInicial(faixa));
  const [forma, setForma] = useState<'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO'>('DINHEIRO');
  const [enviando, setEnviando] = useState(false);

  const selecao = useMemo(() => faixa.slice(0, indiceSelecionado + 1), [faixa, indiceSelecionado]);
  const total = useMemo(() => selecao.reduce((soma, m) => soma + m.totalMinor, 0), [selecao]);

  function handleClique(indice: number): void {
    // Clicar no ultimo mes ja selecionado recua a selecao em um; qualquer
    // outro clique estende ate ali (Decisao 1 do PI: nunca cria buraco).
    setIndiceSelecionado(indice === indiceSelecionado ? Math.max(indice - 1, -1) : indice);
  }

  async function handleReceber(): Promise<void> {
    if (selecao.length === 0) {
      return;
    }

    setEnviando(true);

    const resultado = await receberPagamentoEmLote({
      subscriptionId,
      ateCompetencia: selecao[selecao.length - 1]!.competencia,
      channel: forma,
      expectedTotalMinor: total,
    });

    setEnviando(false);

    if (!resultado.ok) {
      toast.warning('O valor mudou desde que a tela abriu. Atualizando...');
      onPago(); // forca recarregar a faixa com os valores atuais
      return;
    }

    toast.success(`${selecao.length} ${selecao.length === 1 ? 'mês recebido' : 'meses recebidos'}`);
    onPago();
  }

  return (
    <section className={styles.faixa}>
      <div className={styles.chips}>
        {faixa.map((mes, indice) => (
          <button
            key={mes.competencia}
            type="button"
            className={indice <= indiceSelecionado ? styles.chipSelecionado : styles.chip}
            onClick={() => handleClique(indice)}
            aria-pressed={indice <= indiceSelecionado}
          >
            <span>{formatarMesAno(mes.competencia)}</span>
            <span className={styles.status}>{ROTULO_STATUS[mes.status]}</span>
            <span className={styles.valor}>{formatarReal(mes.totalMinor)}</span>
          </button>
        ))}
      </div>

      {selecao.length > 0 && (
        <p className={styles.resumo}>
          {selecao.length} {selecao.length === 1 ? 'mês' : 'meses'} · {formatarMesAno(selecao[0]!.competencia)} a{' '}
          {formatarMesAno(selecao[selecao.length - 1]!.competencia)} · Total {formatarReal(total)}
        </p>
      )}

      <SeletorDeForma value={forma} onChange={setForma} />

      <button type="button" disabled={selecao.length === 0 || enviando} onClick={handleReceber}>
        {enviando ? 'Recebendo...' : `Receber ${formatarReal(total)}`}
      </button>
    </section>
  );
}
```

**Antes de rodar:** ajuste os imports de `toast` e `SeletorDeForma` para os caminhos e assinaturas reais confirmados no Step 1. Os placeholders acima (`../../../../../src/ui/toast`, prop `value`/`onChange` de `SeletorDeForma`) precisam ser trocados pelo que o código já usa — não introduzir uma segunda convenção de Toast ou de seletor de forma.

- [ ] **Step 5: Escrever o CSS module usando os tokens do design system**

Abra `docs/design/DS-PAINEL.md` e localize os tokens de cor/espaçamento para estado "vencido", "em aberto" e "neutro/futuro" (provavelmente cores semânticas de alerta/sucesso/neutro já definidas). Não usar hex literal — só `var(--token)`.

```css
/* apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.module.css */
.faixa {
  display: flex;
  flex-direction: column;
  gap: var(--ah-space-md, 1rem);
}

.chips {
  display: flex;
  gap: var(--ah-space-sm, 0.5rem);
  overflow-x: auto;
  padding-block: var(--ah-space-xs, 0.25rem);
}

.chip,
.chipSelecionado {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  min-width: 88px;
  padding: var(--ah-space-sm, 0.5rem);
  border-radius: var(--ah-radius-md, 0.5rem);
  border: 1px solid var(--ah-border-default);
  background: var(--ah-surface-default);
  cursor: pointer;
}

.chipSelecionado {
  border-color: var(--ah-border-accent);
  background: var(--ah-surface-accent-subtle);
}

.status {
  font-size: 0.75rem;
  color: var(--ah-text-secondary);
}

.valor {
  font-weight: 600;
}

.resumo {
  font-weight: 500;
}
```

**Confirme os nomes reais dos tokens** (`--ah-space-md`, `--ah-surface-accent-subtle`, etc.) em `docs/design/DS-PAINEL.md` ou em um `.module.css` já existente do mesmo diretório — os nomes acima são um placeholder da estrutura, não o token real.

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `pnpm --filter @arenahub/admin-web test -- faixa-de-meses.test.tsx`
Expected: PASS.

- [ ] **Step 7: Integrar no `painel-de-cobranca.tsx`**

Leia o arquivo inteiro primeiro:

```bash
cat apps/admin-web/app/\(protected\)/students/\[id\]/billing/painel-de-cobranca.tsx
```

Localize a seção "Receber no balcão" (que hoje trabalha com uma única invoice) e substitua pela renderização de `<FaixaDeMeses faixa={mesesPagaveis} subscriptionId={subscriptionId} onPago={recarregar} />`, buscando `mesesPagaveis` via `consultarMesesPagaveis` (Task 6) no mesmo padrão de carregamento de dados que o componente já usa para a tabela de invoices. Preservar o botão "Gerar cobrança do mês" e a seção de PIX por QR exatamente como estão (fora de escopo, §8 da spec).

- [ ] **Step 8: Rodar o typecheck e a suíte inteira do admin-web**

Run: `pnpm --filter @arenahub/admin-web typecheck && pnpm --filter @arenahub/admin-web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web/app/\(protected\)/students/\[id\]/billing/
git commit -m "feat: tela de pagamento em lote na ficha financeira do aluno (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: E2E

**Files:**
- Create: spec E2E novo (caminho definido no Step 1)

- [ ] **Step 1: Localizar a pasta de specs E2E de billing existente**

```bash
find . -path "*/e2e/*billing*" -o -path "*/e2e/*cobranca*" 2>/dev/null | grep -v node_modules
```

Use o mesmo diretório e convenção de nome dos specs de billing já existentes (provavelmente `apps/kiosk` tem os E2E de catraca, e o admin-web tem os seus próprios em algum `e2e/` ou `tests/e2e/`).

- [ ] **Step 2: Escrever o teste que falha**

```typescript
// caminho confirmado no Step 1, ex.: apps/admin-web/e2e/pagamento-em-lote.spec.ts
import { test, expect } from '@playwright/test';

// Reaproveitar os helpers de login/seed já usados pelos outros specs E2E de
// billing encontrados no Step 1 -- copiar o padrão de setup, não inventar.

test('aluno com 1 mes vencido paga ate corrente+1 e fica em dia', async ({ page }) => {
  // Arrange: via seed ou fixture de teste (mesmo padrão dos outros E2E),
  //   criar aluno com assinatura ativa e 1 invoice OVERDUE do mês anterior.
  // Act:
  //   1. Navegar até a ficha financeira do aluno.
  //   2. Na faixa de meses, clicar no mês seguinte ao corrente (2 além do
  //      vencido: vencido + corrente + 1 adiantado).
  //   3. Escolher "Dinheiro" e clicar em "Receber".
  // Assert:
  //   - Toast "3 meses recebidos" visível.
  //   - Tabela de cobranças mostra as 3 linhas com situação "Pago".
  //   - Bloco "Situação atual" mostra "Em dia" (ou o rótulo real usado na
  //     tela -- confirmar lendo `situacao-atual.tsx`).
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: comando de E2E do projeto (confirme em `docs/prd/README.md` §7 — provavelmente `pnpm test:e2e` filtrado pelo spec novo).
Expected: FAIL — feature ainda não existe visualmente ou seed não criado.

- [ ] **Step 4: Ajustar seed/fixture se necessário e rodar até passar**

Se o seed de teste (`packages/database/prisma/seed.ts`, conforme ADR-020) não tiver um aluno com padrão "1 mês vencido, assinatura ativa" pronto para reuso, adicionar um cenário de seed dedicado, seguindo o padrão de nomeação usado pelos outros cenários de seed de billing.

Run: `pnpm test:e2e -- pagamento-em-lote`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <arquivo do spec E2E> <ajuste de seed se houver>
git commit -m "test: E2E do pagamento em lote — vencido ate corrente+1 (F83)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Documentação da entrega

**Files:**
- Modify: `docs/CONVENTION.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/TESTING.md` (ou `docs/TESTS.md`, conforme o nome real do arquivo de evidência por SPEC/issue — confirmar)

- [ ] **Step 1: `docs/CONVENTION.md` — nova invariante**

Localize a seção de invariantes de billing (perto de INV-066 a INV-071, conforme mapeado na pesquisa) e adicione a próxima invariante na sequência (confirme o próximo número livre com `grep -n "^INV-1" docs/CONVENTION.md | tail -5`):

```markdown
- **INV-XXX**: pagamento em lote (F83) é sempre um prefixo contínuo da faixa de meses pagáveis,
  a partir do mês em aberto mais antigo, até no máximo competência corrente + 6. Cada mês gera seu
  próprio `Payment`, todos com o mesmo `batchId`; não existe invoice consolidada nem desconto por
  antecipação — cada mês cobra o preço vigente da própria competência (INV-068 continua valendo
  mês a mês).
```

- [ ] **Step 2: `docs/DECISIONS.md` — novo ADR**

Adicione um ADR novo (confirme o próximo número livre) documentando as decisões 1-8 do PI (30/09/2026), citando a spec e a issue #458. Seguir o formato dos ADRs existentes (contexto, decisão, consequências).

- [ ] **Step 3: `docs/STATUS.md`**

Atualizar o Kanban/roadmap com a entrega da F83. **Não editar o Índice Fatia ↔ SPEC** — essa tabela é escrita só pelo Cowork (regra explícita no próprio arquivo); se F83/SPEC-083 ainda não estiver lá quando a entrega acontecer, sinalizar no corpo do PR em vez de editar a tabela.

- [ ] **Step 4: `docs/DEVELOPMENT.md`**

Marcar a fatia como entregue na ordem de execução, apontando para o PR.

- [ ] **Step 5: `docs/TESTING.md`/`docs/TESTS.md`**

Adicionar a linha de evidência da F83/SPEC-083/issue #458, seguindo o formato já usado pelas fatias anteriores (contagem de testes por tipo, link do PR — o link entra depois do merge, conforme a memória "Preencher PR no TESTS.md após merge").

- [ ] **Step 6: Commit**

```bash
git add docs/CONVENTION.md docs/DECISIONS.md docs/STATUS.md docs/DEVELOPMENT.md docs/TESTING.md
git commit -m "docs: documenta pagamento em lote (F83/SPEC-083) em CONVENTION, DECISIONS e STATUS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Gate local e abertura do PR

**Files:** nenhum arquivo novo — só execução de comandos e abertura do PR.

- [ ] **Step 1: Rodar os 5 comandos raiz (gate local antes do push, por memória e CLAUDE.md)**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Expected: todos verdes. Se algum falhar, corrigir antes de prosseguir — não pular para o push com gate vermelho.

- [ ] **Step 2: Rodar `pnpm test:report` (não só `pnpm test`) para garantir que a integração conta na evidência**

Conforme a memória "pnpm test não roda integração": confirmar que o relatório de testes usado no `docs/TESTING.md`/`TESTS.md` vem de `pnpm test:report`, não de `pnpm test` isolado.

- [ ] **Step 3: Push e abertura do PR**

```bash
git push -u origin feat/pagamento-em-lote
gh pr create --title "[MVP2][SPEC-083][F83] Pagamento em lote no balcão — atrasados, mês corrente e adiantados" --body "$(cat <<'EOF'
## Resumo

- Faixa contínua de meses (vencidos → corrente → até 6 adiantados) recebida numa única operação.
- Sem desconto por antecipação; sem parcial (ADR-027 continua valendo mês a mês).
- Um `Payment` por invoice, agrupados por `batchId`; transação única para o lote inteiro.
- Corrigida corrida entre recebimento avulso e lote sobre o mesmo mês: `registrarPagamentoManual` agora usa transição condicionada (`updateMany` com filtro de status) em vez de `update` incondicional.
- Idempotência por `Idempotency-Key`: mesmo corpo devolve o resultado anterior; corpo diferente recusa com 422.

refs #458

## Decisões registradas no PR

- `abrirInvoiceDoPeriodo` e `registrarPagamentoManual` passaram a aceitar `tx?: Prisma.TransactionClient` opcional, para participar da transação compartilhada do lote sem duplicar lógica.
- Invariante correto documentado: "a invoice transiciona para PAID uma vez só", não "≤ 1 Payment CONFIRMED por invoice" (esse é falso por desenho — o webhook PIX já grava um segundo Payment numa invoice PAID).
- `docs/STATUS.md`: Índice Fatia ↔ SPEC ainda não tinha F83/SPEC-083 no momento desta entrega — sinalizado aqui em vez de editado, por ser tabela exclusiva do Cowork.

## Test plan

- [ ] `pnpm lint` verde
- [ ] `pnpm typecheck` verde
- [ ] `pnpm test` verde (unitários, incl. `meses-pagaveis.spec.ts` e domínio de invoice)
- [ ] `pnpm test:integration` verde (incl. `billing-pagamento-em-lote.int-spec.ts` — caminho feliz, idempotência, concorrência avulso×lote, atomicidade, inadimplência, isolamento de tenant)
- [ ] `pnpm build` verde
- [ ] E2E `pagamento-em-lote.spec.ts` verde
- [ ] Testado manualmente na bancada local: aluno com 2 meses vencidos, pagar até corrente+2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirmar CI**

Anunciar de forma assíncrona que o CI está rodando em background (regra do CLAUDE.md), usar `gh run watch <run-id> --exit-status` e conferir job a job ao terminar — nunca confiar no exit code de `gh pr checks --watch`.

---

## Self-Review desta versão do plano

**1. Cobertura da spec:** as 8 decisões do PI e os 4 pontos técnicos da issue #458 estão mapeados: Decisão 1 (sem buraco) → Task 1 (`mesesPagaveis`/`resolverLote`); Decisão 2 (sem desconto) → Task 1 (preço vigente por mês); Decisão 3 (cancelamento fora) → não implementado, listado em §8 da spec, sem task correspondente (correto, é "fora de escopo"); Decisão 4 (Payment+batchId) → Task 3 e 4; Decisão 5 (formas do balcão) → Task 5/6/7; Decisão 6 (teto +6) → Task 1; Decisão 7 (estorno reusa fluxo existente) → nenhuma mudança de código necessária, correto não ter task; Decisão 8 (aviso por mês) → comportamento herdado de `registrarPagamentoManual`, sem mudança necessária. Ponto técnico 1 (tx compartilhado) → Task 2. Ponto técnico 2 (invariante correto) → Task 2. Ponto técnico 3 (guarda avulso×lote) → Task 2 e teste em Task 4. Ponto técnico 4 (idempotência com corpo) → Task 4.

**2. Placeholder scan:** os únicos "placeholders" deixados de propósito são nomes de helpers que dependem de arquivos existentes não lidos ainda pelo executor (ex.: nome exato do helper de fetch autenticado, nome exato do Toast, tokens CSS exatos) — cada um vem acompanhado de um Step explícito de "ler o arquivo real e confirmar o nome antes de usar", não é um TODO deixado em aberto sem instrução de como resolver.

**3. Consistência de tipos:** `MesPagavel`/`MesPagavelUI` mantêm os mesmos campos (`competencia`, `status`, `invoiceId`, `totalMinor`, `dueAt`) do domínio (Task 1) até a UI (Task 7), convertendo `Date`↔`string 'YYYY-MM'` só na borda HTTP (Task 5) e no componente (Task 7) — consistente. `resolverLote` (backend, Task 1) e `selecionarAte` (frontend, Task 6) implementam a mesma regra de prefixo contínuo, documentado explicitamente que o frontend é só feedback visual e o backend é a fonte de verdade.

**4. Review Focus:** as 5 entradas do Review Focus têm teste na task que possui o código: buraco via API direta → Task 4 (resolverLote already rejects out-of-range/gap by construction, tested); corrida avulso×lote → Task 2 (guarda) + Task 4 (teste de integração); idempotência com corpo diferente → Task 4; troca de preço no meio da faixa → Task 1 (domínio) + Task 4 (integração com `expectedTotalMinor` divergente); falha no meio do lote → Task 4 (teste de atomicidade).

Nenhuma lacuna encontrada que precisasse de task nova.
