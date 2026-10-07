# F88 — Padronizar vencimento, fatura mensal e bloqueio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda fatura vence no dia 10 da competência, nasce sozinha no dia 01, a paga mostra até quando cobre (pagamento + 30 × posição), e a catraca bloqueia o aluno `STUDENT` 5 dias depois do vencimento.

**Architecture:** Apaga a âncora de vencimento do lote (INV-163) e a restauração dela no cancelamento (F85). Grava `Invoice.coverageEndsAt` no pagamento. Corrige o `blockAt` para meia-noite local. Liga dois `@Cron` no `ScheduleModule` existente: geração mensal e inadimplência (esta atrás de variável de ambiente). Script idempotente saneia produção.

**Tech Stack:** NestJS + `@nestjs/schedule`, Prisma 7 (Postgres, RLS), Jest (api), Next.js 16 + Vitest (admin-web).

**Spec:** [`docs/superpowers/specs/2026-10-07-padronizar-vencimento-design.md`](../specs/2026-10-07-padronizar-vencimento-design.md) · ponteiro [`SPEC-088`](../../specs/SPEC-088-padronizar-vencimento-e-bloqueio.md)

## Global Constraints

- Vencimento = dia `BillingSettings.dueDay` (10) da competência, gravado como **data** (meia-noite UTC). Nenhum caminho reescreve `dueAt` de fatura por causa de pagamento.
- `blockAt` = meia-noite **local** (fuso da `GymUnit` do aluno) de `dueAt + graceDays` dias.
- Carência do tenant de produção = **5**; padrão do schema = **5**.
- `coverageEndsAt` = dia do pagamento + `30 × k` dias, *k* = posição do mês no lote em ordem de competência (avulso/webhook: *k* = 1). Informativo: nunca adia vencimento nem bloqueio.
- Elegível à fatura mensal **e** ao bloqueio: `Student.profile = STUDENT`, `Student.status = ACTIVE` (só mensal), assinatura `ACTIVE`/`PAST_DUE`, plano `billingMode ≠ DIARIA`.
- Job mensal: `@Cron('5 0 1 * *', { timeZone: 'America/Sao_Paulo' })`. Job de bloqueio: `@Cron('10 0 * * *', { timeZone: 'America/Sao_Paulo' })`, só roda com `BILLING_DELINQUENCY_JOB_ENABLED === 'true'`.
- Job/script fora de rota abre contexto com `comContexto({ kind: 'tenant', tenantId }, ...)` (RLS em `students`).
- Log sem PII: id de assinatura/tenant e código do erro, nunca nome/CPF.
- Textos de UI em pt-BR; identificadores em inglês; dinheiro inteiro em centavos.
- Integração roda contra Postgres descartável (memória `teste-local-com-postgres-descartavel`): **nunca** com `DATABASE_URL` do `.env` (é produção).

## Review Focus

1. **Aluno que paga atrasado não pode ficar bloqueado depois de pagar.** Pagamento de out/26 em 20/10 (já bloqueado em 15/10) → `ativarDireitoDeAcessoSePendente` reativa; o job da madrugada seguinte não pode re-suspender. Teste em Task 4.
2. **Job mensal rodado duas vezes no mesmo dia não cria fatura duplicada nem consome número.** Teste em Task 5.
3. **Perfil ADMIN/STAFF/TRAINER/PERMUTA com fatura vencida não é bloqueado.** Teste em Task 4.
4. **Saneamento rodado duas vezes não muda nada na segunda.** Teste do `dominio.spec` em Task 7.
5. **Cancelar o pagamento de um mês do lote zera só a cobertura daquela fatura**, e não mexe em `dueAt` de ninguém. Teste em Task 3.

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `apps/api/src/modules/billing/registrar-pagamento-em-lote.use-case.ts` | apagar âncora; passar cobertura por posição | 1, 3 |
| `apps/api/src/modules/billing/cancelar-pagamento-manual.use-case.ts` | apagar restauração; zerar cobertura | 1, 3 |
| `apps/api/src/modules/billing/domain/cancelamento-de-pagamento.ts` (+spec) | apagar `deveRestaurarVencimento` | 1 |
| `apps/api/src/modules/billing/billing.controller.ts` | tirar `vencimentoRestaurado`; expor `coverageEndsAt`; rota do job mensal | 1, 3, 5 |
| `apps/api/src/modules/billing/domain/bloqueio-por-inadimplencia.ts` | exportar `meiaNoiteLocalEmUtc` | 2 |
| `apps/api/src/modules/billing/domain/ciclo-de-cobranca.ts` (+spec) | `instanteDeBloqueio(vencimento, graceDays, fuso)` local | 2 |
| `apps/api/src/modules/billing/billing.repository.ts` | `blockAt` local na abertura; `coverageEndsAt` no pagamento manual | 2, 3 |
| `apps/api/src/modules/billing/aplicar-inadimplencia.use-case.ts` | fallback de `blockAt` local; filtro de perfil/diária | 2, 4 |
| `packages/database/prisma/schema.prisma` + migration | `coverage_ends_at`; `grace_days` default 5 | 3 |
| `apps/api/src/modules/billing/processar-webhook-de-pagamento.use-case.ts` | `coverageEndsAt` no webhook | 3 |
| `apps/api/src/modules/billing/aplicar-inadimplencia-scheduler.service.ts` (novo) | cron diário de bloqueio | 4 |
| `apps/api/src/modules/billing/gerar-faturas-do-mes.use-case.ts` (novo) | geração mensal por tenant | 5 |
| `apps/api/src/modules/billing/gerar-faturas-do-mes-scheduler.service.ts` (novo) | cron do dia 01 | 5 |
| `apps/api/src/modules/billing/billing.module.ts` | registrar os 3 providers novos | 4, 5 |
| `apps/admin-web/app/(protected)/students/[id]/billing/page.tsx` | "Vence em" = cobertura quando paga | 6 |
| `apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.tsx` (+test) | tirar "mais a carência" | 6 |
| `apps/api/src/scripts/padronizar-vencimentos.ts` + `padronizar-vencimentos/dominio.ts` (+spec) | saneamento de produção | 7 |
| `docs/*` | emendas, índice, status | 8 |

---

### Task 1: Apagar a âncora do lote e a restauração no cancelamento

**Files:**
- Modify: `apps/api/src/modules/billing/registrar-pagamento-em-lote.use-case.ts` (linhas 11, 17, 22, 47-51, 214-221, 269-326)
- Modify: `apps/api/src/modules/billing/cancelar-pagamento-manual.use-case.ts` (linhas 8-9, 15, 47-53, 166-178, 198-199, 219, 224, 282-358)
- Modify: `apps/api/src/modules/billing/domain/cancelamento-de-pagamento.ts` (linhas 4, 94-116) e `cancelamento-de-pagamento.spec.ts` (bloco `describe('deveRestaurarVencimento')`, linhas 63-~120, e o import da linha 9)
- Modify: `apps/api/src/modules/billing/billing.controller.ts:610-620` (schema de resposta do cancelamento)
- Test: `apps/api/test/integration/billing-pagamento-em-lote.int-spec.ts:254, 331-396`
- Test: `apps/api/test/integration/billing-cancelar-pagamento-manual.int-spec.ts:32, 242-269, 329, 367-390`

**Interfaces:**
- Produces: `PagamentoCancelado` sem `vencimentoRestaurado` → `{ paymentId; invoiceId; faturaReaberta }`. `diaDoPagamento(paidAt: Date): Date` continua exportado de `domain/cancelamento-de-pagamento.ts` (Task 3 usa).

- [ ] **Step 1: Reescrever os testes de integração do lote para a regra nova (vão falhar)**

Em `billing-pagamento-em-lote.int-spec.ts`, troque o teste da linha 331 por:

```ts
  it('DATA DO PAGAMENTO nao mexe na fatura seguinte: ela segue no dia do ciclo (F88)', async () => {
    const { studentId, subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');
    await invoiceEmAberto({ subscriptionId, studentId, competencia: '2026-09-01T00:00:00Z', dueAt: '2026-09-09T00:00:00Z', status: 'OPEN' });
    await invoiceEmAberto({ subscriptionId, studentId, competencia: '2026-10-01T00:00:00Z', dueAt: '2026-10-09T00:00:00Z', status: 'OPEN' });

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-09-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-09-10'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 10000,
        idempotencyKey: randomUUID(),
        agora: new Date('2026-09-15T12:00:00.000Z'),
      },
      'corr-sem-ancora',
    );

    const pagamento = await db.payment.findFirstOrThrow({ where: { tenantId: contexto.tenantId, invoice: { subscriptionId } } });
    expect(pagamento.paidAt!.toISOString()).toBe('2026-09-10T12:00:00.000Z');

    const outubro = await db.invoice.findUniqueOrThrow({
      where: { tenantId_subscriptionId_billingPeriod: { tenantId: contexto.tenantId, subscriptionId, billingPeriod: new Date('2026-10-01T00:00:00Z') } },
    });
    expect(outubro.dueAt.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('o lote NAO abre a fatura do mes seguinte ao ultimo pago (F88)', async () => {
    const { subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-09-15'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 20000,
        idempotencyKey: randomUUID(),
        agora: new Date('2026-09-15T12:00:00.000Z'),
      },
      'corr-sem-seguinte',
    );

    const novembro = await db.invoice.findUnique({
      where: { tenantId_subscriptionId_billingPeriod: { tenantId: contexto.tenantId, subscriptionId, billingPeriod: new Date('2026-11-01T00:00:00Z') } },
    });
    expect(novembro).toBeNull();
  });
```

E apague o teste "dois meses acumulam 60 dias" (linha 368), que fica coberto pelo segundo acima e pela Task 3. Na linha 254, ajuste a contagem: o comentário "5 pagas + a fatura SEGUINTE (dez)" passa a "5 pagas" e o número esperado cai em 1. Leia o `expect` logo abaixo da linha e subtraia 1.

- [ ] **Step 2: Reescrever os testes do cancelamento**

Em `billing-cancelar-pagamento-manual.int-spec.ts`:
- Apague as pré-condições de âncora (linhas 242-243, 377-378 e 385) e as asserções de `vencimentoRestaurado` (251, 329, 367, 382, 389).
- Onde o teste afirmava que a fatura seguinte voltou ao ciclo (269, 368, 390), troque por uma asserção de que o `dueAt` **não mudou** em relação ao valor antes do cancelamento:

```ts
    const antes = (await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString();
    // ... cancelar ...
    expect((await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString()).toBe(antes);
```

Se a fatura de dez não existir no cenário (o lote não a abre mais), troque por `expect(await db.invoice.findFirst({ where: { subscriptionId, billingPeriod: new Date('2026-12-01T00:00:00Z') } })).toBeNull()`. Atualize o comentário do topo (linha 32): o lote não ancora mais nada (F88).

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- --testPathPattern "billing-(pagamento-em-lote|cancelar-pagamento-manual)"`
Expected: FAIL. `outubro.dueAt` vem `2026-10-10` (ancorado) e `novembro` não é nulo.

- [ ] **Step 4: Apagar a âncora no lote**

Em `registrar-pagamento-em-lote.use-case.ts`:
- remova o import de `instanteDeBloqueio` (linha 11), `vencimentoAposPagamento` do import (linha 17) e a constante `MESES_A_FRENTE_PARA_ANCORAR` (linha 22);
- remova a chamada `await this.ancorarProximoVencimento(...)` (linhas 214-221) e o método `ancorarProximoVencimento` inteiro (269-326);
- troque o parágrafo do JSDoc da classe (linhas 47-51) por:

```ts
 * A recepcao informa a DATA do pagamento. Cada mes pago ganha a sua cobertura
 * (`coverageEndsAt` = data + 30 dias x posicao no lote), que e INFORMATIVA: o
 * vencimento de toda fatura e sempre o dia do ciclo (F88, decisao do PI em
 * 07/10/2026, que revogou a ancora `data + 30 x N` da INV-163). Mes anterior
 * nao usado pode ser DISPENSADO na hora (CANCELLED); o que a recepcao nao
 * dispensa nem paga segue em aberto.
```

Se `configuracao.graceDays` deixar de ser lido, mantenha a leitura de `configuracao` (ela ainda alimenta `dueDay` da faixa).

- [ ] **Step 5: Apagar a restauração no cancelamento**

Em `cancelar-pagamento-manual.use-case.ts`:
- remova os imports `ConfiguracaoFinanceiraAusenteError`, `instanteDeBloqueio`, `proximoVencimento` e `deveRestaurarVencimento`;
- tire `vencimentoRestaurado` da interface `PagamentoCancelado`, do `let`, da chamada (linha 178), do payload do outbox, do `metadata` da auditoria e do `return`;
- apague o método `restaurarVencimentoDaSeguinte` (282-358);
- remova "o vencimento," da frase do JSDoc da linha 34.

Em `domain/cancelamento-de-pagamento.ts`: apague `deveRestaurarVencimento` (94-116) e o import de `vencimentoAposPagamento`. No JSDoc de `diaDoPagamento`, troque a referência a `ancorarProximoVencimento` por "o dia que conta a cobertura do mes pago (`coverageEndsAt`, F88)". No spec, apague o `describe('deveRestaurarVencimento')` e o import.

Em `billing.controller.ts:610-620`, tire `'vencimentoRestaurado'` do `required` e de `properties`.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test -- --testPathPattern cancelamento-de-pagamento && pnpm --filter @arenahub/api test:integration -- --testPathPattern "billing-(pagamento-em-lote|cancelar-pagamento-manual)"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing apps/api/test/integration/billing-pagamento-em-lote.int-spec.ts apps/api/test/integration/billing-cancelar-pagamento-manual.int-spec.ts
git commit -m "refactor(billing): lote nao ancora mais o vencimento da fatura seguinte (F88)"
```

---

### Task 2: `blockAt` à meia-noite local

**Files:**
- Modify: `apps/api/src/modules/billing/domain/bloqueio-por-inadimplencia.ts:90-94, 136` (exportar)
- Modify: `apps/api/src/modules/billing/domain/ciclo-de-cobranca.ts:53-68`
- Modify: `apps/api/src/modules/billing/domain/ciclo-de-cobranca.spec.ts` (bloco de `instanteDeBloqueio`, ~linhas 55-75)
- Modify: `apps/api/src/modules/billing/billing.repository.ts:153-225`
- Modify: `apps/api/src/modules/billing/aplicar-inadimplencia.use-case.ts:152-209`
- Test: `apps/api/test/integration/billing.int-spec.ts` (novo `it`)

**Interfaces:**
- Produces: `instanteDeBloqueio(vencimento: Date, graceDays: number, fusoDaUnidade: string): Date` em `domain/ciclo-de-cobranca.ts`. `export function meiaNoiteLocalEmUtc(data: DataLocal, timeZone: string): Date` e `export interface DataLocal { ano; mes; dia }` em `domain/bloqueio-por-inadimplencia.ts`.

- [ ] **Step 1: Teste unitário que falha**

Em `ciclo-de-cobranca.spec.ts`, substitua os casos de `instanteDeBloqueio` por:

```ts
describe('instanteDeBloqueio (F88: meia-noite LOCAL de vencimento + carencia)', () => {
  const SP = 'America/Sao_Paulo';

  it('vence 10/10 (data em meia-noite UTC), carencia 5, Sao Paulo: bloqueia 15/10 00:00 BRT', () => {
    expect(instanteDeBloqueio(new Date('2026-10-10T00:00:00Z'), 5, SP)).toEqual(new Date('2026-10-15T03:00:00Z'));
  });

  it('carencia zero bloqueia no primeiro instante LOCAL do dia do vencimento', () => {
    expect(instanteDeBloqueio(new Date('2026-10-10T00:00:00Z'), 0, SP)).toEqual(new Date('2026-10-10T03:00:00Z'));
  });

  it('atravessa o fim do mes', () => {
    expect(instanteDeBloqueio(new Date('2026-10-30T00:00:00Z'), 5, SP)).toEqual(new Date('2026-11-04T03:00:00Z'));
  });

  it('recusa carencia negativa', () => {
    expect(() => instanteDeBloqueio(new Date('2026-10-10T00:00:00Z'), -1, SP)).toThrow(CicloInvalidoError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test -- --testPathPattern ciclo-de-cobranca`
Expected: FAIL (assinatura antiga, resultado `2026-10-15T00:00:00Z`).

- [ ] **Step 3: Implementar**

Em `bloqueio-por-inadimplencia.ts`, acrescente `export` em `interface DataLocal` (linha 90) e em `function meiaNoiteLocalEmUtc` (linha 136). Nada mais muda.

Em `ciclo-de-cobranca.ts`, troque `MS_POR_DIA` e `instanteDeBloqueio` (linhas 53-68) por:

```ts
/**
 * Primeiro instante em que a inadimplencia bloqueia (ADR-019, INV-144): a
 * meia-noite LOCAL do dia `vencimento + carencia`, no fuso da unidade.
 *
 * `vencimento` e DATA guardada como meia-noite UTC (convencao do `dueAt`), entao
 * o dia civil vem dos campos UTC -- ler o dia local de `2026-10-10T00:00Z` em
 * Sao Paulo daria 09/10 e bloquearia um dia antes. Ate a F88 esta conta era
 * `vencimento + N x 24h` em UTC, que bloqueava as 21h da vespera.
 */
export function instanteDeBloqueio(vencimento: Date, graceDays: number, fusoDaUnidade: string): Date {
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new CicloInvalidoError('carencia deve ser inteiro de dias nao negativo');
  }

  return meiaNoiteLocalEmUtc(
    {
      ano: vencimento.getUTCFullYear(),
      mes: vencimento.getUTCMonth() + 1,
      dia: vencimento.getUTCDate() + graceDays,
    },
    fusoDaUnidade,
  );
}
```

com `import { meiaNoiteLocalEmUtc } from './bloqueio-por-inadimplencia.js';` no topo.

- [ ] **Step 4: Usar o fuso na abertura da fatura**

Em `billing.repository.ts`, `abrirInvoiceDoPeriodo`: o `blockAt` passa a ser calculado **dentro** de `executar`. A leitura do fuso vai pela transação para valer o RLS de `students`, e isso funciona tanto na rota quanto no job com `comContexto`. Troque as linhas 155-156 por nada (apague `bloqueioEm`) e, dentro de `executar`, logo depois do `if (jaExiste) return jaExiste;`:

```ts
      // Fuso pela TRANSACAO: `students` tem RLS, e so dentro dela o
      // `set_config` vale (issue #306). A diaria traz o proprio `blockAt`.
      const bloqueioEm =
        entrada.vencimento?.blockAt ??
        instanteDeBloqueio(
          vencimento,
          configuracao.graceDays,
          (
            await tx.student.findFirstOrThrow({
              where: { id: assinatura.studentId, tenantId: contexto.tenantId },
              select: { gymUnit: { select: { timezone: true } } },
            })
          ).gymUnit.timezone,
        );
```

Mantenha `blockAt: bloqueioEm` no `create`.

- [ ] **Step 5: Fallback do job com a mesma conta**

Em `aplicar-inadimplencia.use-case.ts`:
- `jaBloqueia` (165-180): troque o `return deveBloquear(...)` por

```ts
    return agora.getTime() >= instanteDeBloqueio(invoice.dueAt, diasDeCarencia, invoice.fusoDaUnidade).getTime();
```

- o `update` de `aplicar` (199-208): troque por

```ts
        data: { blockAt: instanteDeBloqueio(invoice.dueAt, diasDeCarencia, invoice.fusoDaUnidade) },
```

- os imports passam a ser `import { instanteDeBloqueio } from './domain/ciclo-de-cobranca.js';` e `import type { PoliticaDeBloqueio } from './domain/bloqueio-por-inadimplencia.js';`. O tipo continua usado na assinatura de `jaBloqueia`; se não sobrar uso, remova o parâmetro `ancora` e o tipo.

`consultar-inadimplencia.use-case.ts` (só exibição) **não muda** nesta task.

- [ ] **Step 6: Teste de integração da abertura**

Em `billing.int-spec.ts`, ao lado do teste da linha ~154, acrescente (ajuste `a`/`contexto` ao cenário do arquivo; ele já tem unidade com `America/Sao_Paulo`):

```ts
  it('F88: blockAt da fatura aberta e a meia-noite LOCAL de vencimento + carencia', async () => {
    const invoice = await billing.abrirInvoiceDoPeriodo(contexto(a.tenantId, a.actorId), {
      subscriptionId: a.subscriptionId,
      emQue: new Date('2026-10-15T12:00:00Z'),
    });
    const cfg = await db.billingSettings.findUniqueOrThrow({ where: { tenantId: a.tenantId } });

    expect(invoice.dueAt.toISOString()).toBe(`2026-10-${String(cfg.dueDay).padStart(2, '0')}T00:00:00.000Z`);
    expect(invoice.blockAt!.toISOString().slice(11)).toBe('03:00:00.000Z');
  });
```

- [ ] **Step 7: Rodar e corrigir as asserções antigas**

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test -- --testPathPattern "ciclo-de-cobranca|bloqueio-por-inadimplencia" && pnpm --filter @arenahub/api test:integration -- --testPathPattern "billing|inadimplencia|venda-de-diaria|students-membership"`
Expected: unit PASS. Na integração, asserções que afirmavam `blockAt = dueAt + N×24h` (ex.: `billing-pagamento-em-lote.int-spec.ts`, `billing-inadimplencia.int-spec.ts`) falham com diferença de exatamente 3h. Atualize cada uma para `+ N×24h + 3h` (São Paulo) e cite F88 no comentário. Nenhuma outra diferença é aceitável: se aparecer, investigue antes de mexer no teste.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/billing apps/api/test/integration
git commit -m "fix(billing): bloqueio na meia-noite local de vencimento + carencia (F88)"
```

---

### Task 3: `Invoice.coverageEndsAt` + carência padrão 5

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `Invoice` ~3646; `BillingSettings.graceDays` 3436)
- Create: `packages/database/prisma/migrations/20261007180000_f88_cobertura_e_carencia/migration.sql`
- Modify: `apps/api/src/modules/billing/billing.repository.ts:237-356` (`registrarPagamentoManual`)
- Modify: `apps/api/src/modules/billing/registrar-pagamento-em-lote.use-case.ts:172-189`
- Modify: `apps/api/src/modules/billing/processar-webhook-de-pagamento.use-case.ts:445-448`
- Modify: `apps/api/src/modules/billing/cancelar-pagamento-manual.use-case.ts:169-172`
- Modify: `apps/api/src/modules/billing/billing.controller.ts:1395-1413` (`paraDto`) e o tipo `InvoiceDto`
- Test: `apps/api/test/integration/billing-pagamento-em-lote.int-spec.ts`, `billing-cancelar-pagamento-manual.int-spec.ts`

**Interfaces:**
- Consumes: `diaDoPagamento(paidAt)` (`domain/cancelamento-de-pagamento.ts`), `vencimentoAposPagamento(dia, meses)` (`domain/meses-pagaveis.ts`).
- Produces: coluna `Invoice.coverageEndsAt: Date | null`; parâmetro opcional `coverageEndsAt?: Date` em `registrarPagamentoManual`; campo `coverageEndsAt: string | null` em `InvoiceDto` (resposta de `GET students/:id/invoices` e `GET invoices/:id`).

- [ ] **Step 1: Schema e migration**

No model `Invoice`, logo após `paidAt`:

```prisma
  /// Ate quando o mes PAGO cobre (F88): dia do pagamento + 30 dias x posicao do
  /// mes no lote. INFORMATIVO -- nao adia vencimento nem bloqueio. Nulo em
  /// fatura nao paga; zerado quando o pagamento e cancelado.
  coverageEndsAt DateTime? @map("coverage_ends_at") @db.Timestamptz(6)
```

Antes, confira como `paidAt` está anotado e copie o mesmo `@db`. Em `BillingSettings.graceDays`, troque `@default(10)` por `@default(5)` e corrija o comentário ("vence dia 10, bloqueia dia 15").

Gere a migration com o Prisma 7 (memória `prisma7-migrate-diff-sem-shadow-url`: usar `--from-config-datasource` e `-o`), contra o Postgres **descartável**:

```bash
pnpm --filter @arenahub/database exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/20261007180000_f88_cobertura_e_carencia/migration.sql
```

Expected: o arquivo contém só

```sql
ALTER TABLE "billing_settings" ALTER COLUMN "grace_days" SET DEFAULT 5;
ALTER TABLE "invoices" ADD COLUMN "coverage_ends_at" TIMESTAMPTZ(6);
```

Abra o arquivo: sem banner do dotenv, sem outra mudança. Aplique com `pnpm --filter @arenahub/database exec prisma migrate deploy` e rode `prisma generate`.

- [ ] **Step 2: Testes que falham**

Em `billing-pagamento-em-lote.int-spec.ts`:

```ts
  it('F88: cobertura escalonada -- pago 07/10 out+nov+dez cobre 06/11, 06/12, 05/01', async () => {
    const { subscriptionId } = await novaAssinatura('2026-06-01T00:00:00Z');

    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: [new Date('2026-12-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')],
        dispensar: [],
        paidAt: diaUtc('2026-10-07'),
        channel: 'PIX',
        expectedTotalMinor: 30000,
        idempotencyKey: randomUUID(),
        agora: new Date('2026-10-07T15:00:00.000Z'),
      },
      'corr-cobertura',
    );

    const faturas = await db.invoice.findMany({
      where: { tenantId: contexto.tenantId, subscriptionId },
      orderBy: { billingPeriod: 'asc' },
      select: { billingPeriod: true, coverageEndsAt: true, dueAt: true },
    });
    expect(faturas.map((f) => f.coverageEndsAt?.toISOString().slice(0, 10))).toEqual(['2026-11-06', '2026-12-06', '2027-01-05']);
    // Vencimento intocado: dia do ciclo (dueDay do cenario).
    expect(faturas.map((f) => f.dueAt.toISOString().slice(8, 10))).toEqual(['09', '09', '09']);
  });
```

As competências entram fora de ordem de propósito: a posição *k* é pela competência, não pela ordem do pedido.

Em `billing-cancelar-pagamento-manual.int-spec.ts`, no teste que reabre a fatura adiantada:

```ts
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).coverageEndsAt).toBeNull();
```

(use a variável de id da fatura que o teste já tem).

Run: `pnpm --filter @arenahub/api test:integration -- --testPathPattern "billing-(pagamento-em-lote|cancelar-pagamento-manual)"`
Expected: FAIL (`coverageEndsAt` nulo).

- [ ] **Step 3: Gravar no pagamento manual**

Em `registrarPagamentoManual`, acrescente à `entrada`:

```ts
      /** Fim da cobertura deste mes (F88). Ausente = avulso: dia do pagamento + 30. */
      coverageEndsAt?: Date;
```

e no `updateMany` da transição:

```ts
        data: {
          status: 'PAID',
          paidAt: entrada.paidAt,
          coverageEndsAt: entrada.coverageEndsAt ?? vencimentoAposPagamento(diaDoPagamento(entrada.paidAt), 1),
          version: { increment: 1 },
        },
```

com imports de `vencimentoAposPagamento` (`./domain/meses-pagaveis.js`) e `diaDoPagamento` (`./domain/cancelamento-de-pagamento.js`).

No lote, antes do `for (const mes of lote)`:

```ts
      // Posicao k pela COMPETENCIA, nao pela ordem do pedido: o mes mais cedo
      // cobre 30 dias, o seguinte 60... (F88).
      const posicao = new Map(
        [...lote]
          .sort((a, b) => a.competencia.getTime() - b.competencia.getTime())
          .map((mes, i) => [mes.competencia.getTime(), i + 1]),
      );
```

e na chamada de `registrarPagamentoManual` acrescente `coverageEndsAt: vencimentoAposPagamento(entrada.paidAt, posicao.get(mes.competencia.getTime())!),`. `entrada.paidAt` já é o dia em meia-noite UTC; reimporte `vencimentoAposPagamento`.

No webhook (linha 447): `data: { status: 'PAID', paidAt: dados.occurredAt, coverageEndsAt: vencimentoAposPagamento(diaDoPagamento(dados.occurredAt), 1), version: { increment: 1 } },` com os mesmos imports.

No cancelamento (linha 171): `data: { status: 'OPEN', paidAt: null, coverageEndsAt: null, version: { increment: 1 } },`.

- [ ] **Step 4: Expor no DTO**

Em `billing.controller.ts`, no tipo `InvoiceDto` acrescente `coverageEndsAt: string | null;` e em `paraDto`, depois de `paidAt`:

```ts
      coverageEndsAt: invoice.coverageEndsAt?.toISOString() ?? null,
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test:integration -- --testPathPattern "billing"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma apps/api/src/modules/billing apps/api/test/integration
git commit -m "feat(billing): cobertura do mes pago (coverageEndsAt) e carencia padrao 5 (F88)"
```

---

### Task 4: Bloqueio automático — filtro de perfil e cron diário

**Files:**
- Modify: `apps/api/src/modules/billing/aplicar-inadimplencia.use-case.ts:106-150, 114-116`
- Create: `apps/api/src/modules/billing/aplicar-inadimplencia-scheduler.service.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts` (providers)
- Test: `apps/api/test/integration/billing-inadimplencia.int-spec.ts` (novos `it`)

**Interfaces:**
- Consumes: `AplicarInadimplenciaUseCase.executar(tenantId: string, agora: Date): Promise<ResultadoDaInadimplencia>`, `BillingRepository.listarTenantsAtivos(): Promise<string[]>`, `comContexto` de `@arenahub/database`.
- Produces: `AplicarInadimplenciaSchedulerService.executarCiclo(agora: Date): Promise<{ tenants: number; direitosSuspensos: number; falhas: number }>`.

- [ ] **Step 1: Testes que falham**

Em `billing-inadimplencia.int-spec.ts`, use as fábricas do arquivo (aluno, assinatura, fatura). Abra o arquivo e reaproveite as que já existem, sem criar fábrica nova. Três casos:

```ts
  it('F88: aluno de perfil STAFF com fatura vencida alem da carencia NAO e suspenso', async () => {
    // aluno com profile 'STAFF', fatura OPEN dueAt 2026-10-10, blockAt 2026-10-15T03:00Z
    const r = await aplicarInadimplencia.executar(tenantId, new Date('2026-10-16T12:00:00Z'));
    expect(r.direitosSuspensos).toBe(0);
    expect((await db.entitlement.findFirstOrThrow({ where: { subscriptionId } })).status).toBe('ACTIVE');
  });

  it('F88: assinatura de plano DIARIA nao entra na inadimplencia', async () => {
    // plano billingMode 'DIARIA', fatura OPEN vencida
    const r = await aplicarInadimplencia.executar(tenantId, new Date('2026-10-16T12:00:00Z'));
    expect(r.invoicesVencidas).toBe(0);
  });

  it('F88: STUDENT bloqueia em 15/10 00:00 BRT e nao antes; pagar reativa e o job seguinte nao re-suspende', async () => {
    // aluno STUDENT, fatura aberta via billing.abrirInvoiceDoPeriodo (dueDay 10, graceDays 5 no cenario)
    expect((await aplicarInadimplencia.executar(tenantId, new Date('2026-10-15T02:59:59Z'))).direitosSuspensos).toBe(0);
    expect((await aplicarInadimplencia.executar(tenantId, new Date('2026-10-15T03:00:00Z'))).direitosSuspensos).toBe(1);

    await billing.registrarPagamentoManual(contexto, { invoiceId, amountMinor: total, reason: 'balcao', paidAt: new Date('2026-10-20T12:00:00Z'), receivedVia: 'DINHEIRO' }, 'corr');
    expect((await db.entitlement.findFirstOrThrow({ where: { subscriptionId } })).status).toBe('ACTIVE');

    expect((await aplicarInadimplencia.executar(tenantId, new Date('2026-10-21T03:10:00Z'))).direitosSuspensos).toBe(0);
  });
```

Os comentários `// aluno com ...` são instruções de montagem do cenário: troque cada um pelas chamadas reais às fábricas do arquivo, com `profile`, `billingMode`, `dueDay: 10` e `graceDays: 5`.

Run: `pnpm --filter @arenahub/api test:integration -- --testPathPattern billing-inadimplencia`
Expected: FAIL nos dois primeiros (STAFF e DIARIA suspensos/vencidos).

- [ ] **Step 2: Filtro**

Em `candidatas`, no `where`:

```ts
          // F88: so quem depende de plano bloqueia. ADMIN/STAFF/TRAINER/PERMUTA
          // tem acesso por vinculo; diaria nao e contrato (F86).
          student: { profile: 'STUDENT' },
          subscription: { plan: { billingMode: { not: 'DIARIA' } } },
```

Confira o nome da relação `Invoice.subscription` no schema antes de usar. Atualize o comentário das linhas 114-116: o agendador chama dentro de `comContexto`.

- [ ] **Step 3: Scheduler**

Crie `aplicar-inadimplencia-scheduler.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { comContexto } from '@arenahub/database';

import { AplicarInadimplenciaUseCase } from './aplicar-inadimplencia.use-case.js';
import { BillingRepository } from './billing.repository.js';

/**
 * Bloqueio automatico por inadimplencia (F88, decisao do PI em 07/10/2026):
 * 5 dias depois do vencimento a catraca nega. Este job so decide QUANDO roda
 * `AplicarInadimplenciaUseCase`, que ja era reexecutavel (`M2-FR-013`).
 *
 * DESLIGADO ATE O PI LIGAR: so roda com `BILLING_DELINQUENCY_JOB_ENABLED=true`.
 * A primeira execucao bloqueia todo STUDENT com fatura vencida ha mais de 5
 * dias -- o saneamento de producao (script `padronizar-vencimentos`) tem de
 * rodar antes, e o PI conferir a lista.
 *
 * ESPELHA `ExpirarAssinaturasSchedulerService`: trava de reentrada no
 * processo, `agora` injetado, falha de um tenant nao derruba os outros.
 */
@Injectable()
export class AplicarInadimplenciaSchedulerService {
  private readonly log = new Logger(AplicarInadimplenciaSchedulerService.name);

  private executando = false;

  constructor(
    private readonly repositorio: BillingRepository,
    private readonly aplicarInadimplencia: AplicarInadimplenciaUseCase,
  ) {}

  @Cron('10 0 * * *', { name: 'bloqueio-por-inadimplencia', timeZone: 'America/Sao_Paulo' })
  async executarComTrava(): Promise<void> {
    if (process.env['BILLING_DELINQUENCY_JOB_ENABLED'] !== 'true') return;

    if (this.executando) {
      this.log.warn('ciclo anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.executando = true;

    try {
      const resultado = await this.executarCiclo(new Date());
      this.log.log(`inadimplencia: ${JSON.stringify(resultado)}`);
    } finally {
      this.executando = false;
    }
  }

  async executarCiclo(agora: Date): Promise<{ tenants: number; direitosSuspensos: number; falhas: number }> {
    const tenants = await this.repositorio.listarTenantsAtivos();

    let direitosSuspensos = 0;
    let falhas = 0;

    for (const tenantId of tenants) {
      try {
        const resultado = await comContexto({ kind: 'tenant', tenantId }, () =>
          this.aplicarInadimplencia.executar(tenantId, agora),
        );
        direitosSuspensos += resultado.direitosSuspensos;
      } catch (erro: unknown) {
        falhas += 1;
        this.log.error(
          `falha ao aplicar inadimplencia do tenant ${tenantId}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { tenants: tenants.length, direitosSuspensos, falhas };
  }
}
```

Registre em `billing.module.ts` (`providers`), ao lado de `ExpirarAssinaturasSchedulerService`.

- [ ] **Step 4: Teste do ciclo sem contexto de requisição**

No mesmo spec de integração, chame o scheduler **sem** `comContextoDeTenant` (é o que prova o `comContexto` interno):

```ts
  it('F88: o ciclo do scheduler abre o proprio contexto de tenant (RLS) e suspende', async () => {
    const scheduler = moduleRef.get(AplicarInadimplenciaSchedulerService);
    // cenario STUDENT vencido ha mais de 5 dias
    const r = await scheduler.executarCiclo(new Date('2026-10-16T12:00:00Z'));
    expect(r.falhas).toBe(0);
    expect(r.direitosSuspensos).toBeGreaterThanOrEqual(1);
  });
```

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test:integration -- --testPathPattern billing-inadimplencia`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing apps/api/test/integration/billing-inadimplencia.int-spec.ts
git commit -m "feat(billing): bloqueio automatico 5 dias apos o vencimento, so STUDENT (F88)"
```

---

### Task 5: Fatura do mês todo dia 01

**Files:**
- Create: `apps/api/src/modules/billing/gerar-faturas-do-mes.use-case.ts`
- Create: `apps/api/src/modules/billing/gerar-faturas-do-mes-scheduler.service.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`
- Modify: `apps/api/src/modules/billing/billing.controller.ts` (rota nova, perto da linha 995)
- Test: Create `apps/api/test/integration/billing-gerar-faturas-do-mes.int-spec.ts`

**Interfaces:**
- Consumes: `BillingRepository.abrirInvoiceDoPeriodo(contexto, { subscriptionId, emQue }, tx?)`, `listarTenantsAtivos()`, `PrismaService.comTenant`.
- Produces: `GerarFaturasDoMesUseCase.executar(tenantId: string, agora: Date): Promise<ResultadoDaGeracao>` com `ResultadoDaGeracao = { elegiveis: number; criadas: number; jaExistiam: number; falhas: number }`. `GerarFaturasDoMesSchedulerService.executarCiclo(agora: Date): Promise<ResultadoDaGeracao & { tenants: number }>`. Rota `POST /api/v1/billing/monthly-invoices/run` (`billing.manage`) → `ResultadoDaGeracao`.

- [ ] **Step 1: Teste de integração que falha**

Crie `billing-gerar-faturas-do-mes.int-spec.ts`, copiando o `beforeAll`/`afterAll` de `billing-pagamento-em-lote.int-spec.ts` (tenant, operador, `billingSettings { dueDay: 10, graceDays: 5 }`, unidade SP, plano com preço), e uma fábrica `aluno({ profile, status, billingMode, statusAssinatura })` que cria aluno + assinatura (plano DIARIA quando pedido). Casos:

```ts
  it('cria a fatura da competencia so para STUDENT ATIVO com assinatura vigente e plano mensal', async () => {
    const elegivel = await aluno({});
    const atrasado = await aluno({ statusAssinatura: 'PAST_DUE' });
    await aluno({ profile: 'STAFF' });
    await aluno({ status: 'SUSPENDED' });
    await aluno({ billingMode: 'DIARIA' });
    await aluno({ statusAssinatura: 'CANCELLED' });

    const r = await gerar.executar(tenantId, new Date('2026-11-01T03:05:00Z'));

    expect(r).toEqual({ elegiveis: 2, criadas: 2, jaExistiam: 0, falhas: 0 });
    const faturas = await db.invoice.findMany({ where: { tenantId, billingPeriod: new Date('2026-11-01T00:00:00Z') } });
    expect(faturas.map((f) => f.subscriptionId).sort()).toEqual([elegivel.subscriptionId, atrasado.subscriptionId].sort());
    expect(faturas.every((f) => f.dueAt.toISOString() === '2026-11-10T00:00:00.000Z')).toBe(true);
    expect(faturas.every((f) => f.blockAt!.toISOString() === '2026-11-15T03:00:00.000Z')).toBe(true);
  });

  it('rodar duas vezes nao duplica nem consome numero', async () => {
    await aluno({});
    const primeira = await gerar.executar(tenantId, new Date('2026-12-01T03:05:00Z'));
    const numeros = await db.invoice.count({ where: { tenantId } });
    const segunda = await gerar.executar(tenantId, new Date('2026-12-01T03:06:00Z'));

    expect(segunda.criadas).toBe(0);
    expect(segunda.jaExistiam).toBe(primeira.elegiveis);
    expect(await db.invoice.count({ where: { tenantId } })).toBe(numeros);
  });

  it('o scheduler abre o proprio contexto de tenant (sem requisicao)', async () => {
    await aluno({});
    const r = await moduleRef.get(GerarFaturasDoMesSchedulerService).executarCiclo(new Date('2027-01-01T03:05:00Z'));
    expect(r.falhas).toBe(0);
    expect(r.criadas).toBeGreaterThanOrEqual(1);
  });
```

Cada `it` usa competência própria (nov, dez, jan), porque o tenant é compartilhado (memória `cpf-de-teste-nao-se-reusa`). `gerar` é `comContextoDeTenant(moduleRef.get(GerarFaturasDoMesUseCase))`.

Run: `pnpm --filter @arenahub/api test:integration -- --testPathPattern billing-gerar-faturas-do-mes`
Expected: FAIL (módulo não existe).

- [ ] **Step 2: Use case**

`gerar-faturas-do-mes.use-case.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { BillingRepository } from './billing.repository.js';
import { competenciaDe } from './domain/ciclo-de-cobranca.js';

export interface ResultadoDaGeracao {
  readonly elegiveis: number;
  readonly criadas: number;
  readonly jaExistiam: number;
  readonly falhas: number;
}

/**
 * Fatura do mes para todo aluno que depende de plano (F88, decisao do PI em
 * 07/10/2026): perfil STUDENT, aluno ATIVO, assinatura vigente, plano mensal
 * (diaria nao e contrato -- F86). Vence no `dueDay` do tenant.
 *
 * NADA DE REGRA NOVA: cada fatura sai de `abrirInvoiceDoPeriodo`, idempotente
 * por INV-066 -- rodar duas vezes devolve a mesma fatura e nao gasta numero.
 * Serial de proposito: a base tem centenas de alunos, nao milhoes.
 */
@Injectable()
export class GerarFaturasDoMesUseCase {
  private readonly log = new Logger(GerarFaturasDoMesUseCase.name);

  constructor(
    private readonly db: PrismaService,
    private readonly billing: BillingRepository,
  ) {}

  async executar(tenantId: string, agora: Date): Promise<ResultadoDaGeracao> {
    const competencia = competenciaDe(agora);
    // Job nao tem usuario; `actorId` nao e gravado na abertura de fatura.
    const contexto: TenantContext = {
      tenantId,
      actorId: 'sistema:gerar-faturas-do-mes',
      sessionId: 'gerar-faturas-do-mes',
      permissions: new Set<string>(),
      allowedUnitIds: 'ALL',
    };

    // `comTenant`: o filtro passa por `students`, que tem RLS (issue #306).
    const assinaturas = await this.db.comTenant((tx) =>
      tx.subscription.findMany({
        where: {
          tenantId,
          status: { in: ['ACTIVE', 'PAST_DUE'] },
          plan: { billingMode: { not: 'DIARIA' } },
          student: { profile: 'STUDENT', status: 'ACTIVE' },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );

    const jaExistentes = new Set(
      (
        await this.db.invoice.findMany({
          where: { tenantId, billingPeriod: competencia, subscriptionId: { in: assinaturas.map((a) => a.id) } },
          select: { subscriptionId: true },
        })
      ).map((i) => i.subscriptionId),
    );

    let criadas = 0;
    let falhas = 0;

    for (const { id } of assinaturas) {
      if (jaExistentes.has(id)) continue;

      try {
        await this.billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId: id, emQue: agora });
        criadas += 1;
      } catch (erro: unknown) {
        falhas += 1;
        this.log.error(
          `falha ao gerar fatura da assinatura ${id} (tenant ${tenantId}): ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
        );
      }
    }

    return { elegiveis: assinaturas.length, criadas, jaExistiam: jaExistentes.size, falhas };
  }
}
```

`abrirInvoiceDoPeriodo` sem `tx` abre `this.db.$transaction`, que aplica o contexto do `AsyncLocalStorage`. Por isso o chamador precisa estar dentro de `comContexto` (scheduler) ou de requisição (rota).

- [ ] **Step 3: Scheduler e rota**

`gerar-faturas-do-mes-scheduler.service.ts`: mesma estrutura do `AplicarInadimplenciaSchedulerService` (Task 4, Step 3), **sem** a variável de ambiente, com:

```ts
  @Cron('5 0 1 * *', { name: 'gerar-faturas-do-mes', timeZone: 'America/Sao_Paulo' })
```

e `executarCiclo` somando `elegiveis/criadas/jaExistiam/falhas` dos tenants, cada um dentro de `comContexto({ kind: 'tenant', tenantId }, () => this.gerar.executar(tenantId, agora))`. Retorno `{ tenants, elegiveis, criadas, jaExistiam, falhas }`; falha de tenant soma 1 em `falhas` e loga só o id.

No controller, perto de `subscription-cycle/run`:

```ts
  /**
   * Gera a fatura do mes sob demanda (F88). O cron do dia 01 faz o mesmo;
   * reexecutar e seguro (INV-066).
   */
  @Post('billing/monthly-invoices/run')
  @RequirePermissions('billing.manage')
  async gerarFaturasDoMes(): Promise<ResultadoDaGeracao> {
    return this.gerarFaturasDoMes.executar(this.contexto.require().tenantId, new Date());
  }
```

Injete `GerarFaturasDoMesUseCase` no construtor. Registre os dois providers no `billing.module.ts`. Se a guarda de OpenAPI (`openapi` spec, memória `openapi-prosa-so-pega-rota-que-some`) listar rotas em prosa, acrescente a nova lá.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test && pnpm --filter @arenahub/api test:integration -- --testPathPattern "billing-gerar-faturas-do-mes|openapi"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing apps/api/test/integration/billing-gerar-faturas-do-mes.int-spec.ts
git commit -m "feat(billing): fatura do mes gerada todo dia 01 para aluno STUDENT ativo (F88)"
```

---

### Task 6: Tela — "Vence em" da paga e texto do recebimento

**Files:**
- Modify: `apps/admin-web/app/(protected)/students/[id]/billing/page.tsx:53, 256-265`
- Modify: `apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.tsx:223`
- Test: `apps/admin-web/app/(protected)/students/[id]/billing/faixa-de-meses.test.tsx:159-162`; teste da página (ver Step 1)

**Interfaces:**
- Consumes: `coverageEndsAt: string | null` no item de `GET students/:id/invoices` (Task 3).

- [ ] **Step 1: Testes que falham**

Em `faixa-de-meses.test.tsx`, linhas 159 e 162: troque `/Vigente até 15\/10\/2026, mais a carência/i` por `/Vigente até 15\/10\/2026\.?$/i` e faça o mesmo para `14\/11`. Acrescente:

```ts
    expect(screen.queryByText(/mais a carência/i)).not.toBeInTheDocument();
```

Para a coluna "Vence em", procure o teste da página com `Glob apps/admin-web/app/(protected)/students/[id]/billing/*.test.tsx`. Se houver um que renderiza a grade, acrescente uma fatura `PAID` com `dueAt: '2026-10-10T00:00:00.000Z'` e `coverageEndsAt: '2026-11-06T00:00:00.000Z'` e afirme que a linha mostra `06/11/2026` e não `10/10/2026`. Se a página for Server Component sem teste (memória `jsdom-nao-roda-server-action`), extraia a escolha para uma função pura em `apps/admin-web/src/billing/vencimento.ts`:

```ts
/** "Vence em" da grade (F88): paga mostra ate quando cobre; as demais, o vencimento. */
export function venceEmDaLinha(invoice: { readonly status: string; readonly dueAt: string; readonly coverageEndsAt: string | null }): string {
  return (invoice.status === 'PAID' && invoice.coverageEndsAt ? invoice.coverageEndsAt : invoice.dueAt).slice(0, 10);
}
```

com teste em `vencimento.test.ts`:

```ts
describe('venceEmDaLinha', () => {
  it('paga mostra a cobertura', () => {
    expect(venceEmDaLinha({ status: 'PAID', dueAt: '2026-10-10T00:00:00.000Z', coverageEndsAt: '2026-11-06T00:00:00.000Z' })).toBe('2026-11-06');
  });
  it('aberta mostra o vencimento', () => {
    expect(venceEmDaLinha({ status: 'OPEN', dueAt: '2026-10-10T00:00:00.000Z', coverageEndsAt: null })).toBe('2026-10-10');
  });
  it('paga antiga sem cobertura cai no vencimento', () => {
    expect(venceEmDaLinha({ status: 'PAID', dueAt: '2026-09-10T00:00:00.000Z', coverageEndsAt: null })).toBe('2026-09-10');
  });
});
```

Run: `pnpm --filter @arenahub/admin-web test -- faixa-de-meses vencimento`
Expected: FAIL.

- [ ] **Step 2: Implementar**

`faixa-de-meses.tsx:223`: `Vigente até {formatarData(vigenteAte(dataPagamento, selecao.length))}.`

`page.tsx`: acrescente `coverageEndsAt: string | null;` ao tipo da linha 53 e troque a célula (261-263) por:

```tsx
            /* F88: paga mostra ate quando cobre; as demais, o vencimento (DATA em meia-noite UTC). */
              <TenantDateTime iso={venceEmDaLinha(invoice)} timeZone={timezoneDaUnidade} format="date" />
```

importando `venceEmDaLinha` de `@/src/billing/vencimento` (confira o alias usado nos imports vizinhos).

- [ ] **Step 3: Rodar**

Run: `pnpm --filter @arenahub/admin-web test && pnpm --filter @arenahub/admin-web typecheck && pnpm --filter @arenahub/admin-web lint`
Expected: PASS.

- [ ] **Step 4: E2E do recebimento**

`apps/admin-web/tests/e2e/pagamento-em-lote.e2e-spec.ts:221` conta chips assumindo a fatura seguinte aberta pelo lote. Rode o E2E (memórias `e2e-reusa-painel-de-outra-arvore` e `next-start-serve-build-antigo-no-e2e`: matar o que estiver na 3000 e rebuildar antes):

Run: `pnpm --filter @arenahub/admin-web test:e2e -- pagamento-em-lote`
Expected: a contagem da linha 221 cai 1 (a fatura seguinte não nasce mais); qualquer asserção de "mais a carência" falha. Corrija só essas duas coisas, citando F88. Qualquer outra falha: investigue antes.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web
git commit -m "feat(admin-web): fatura paga mostra ate quando cobre; recebimento sem 'mais a carencia' (F88)"
```

---

### Task 7: Script de saneamento de produção

**Files:**
- Create: `apps/api/src/scripts/padronizar-vencimentos/dominio.ts`
- Create: `apps/api/src/scripts/padronizar-vencimentos/dominio.spec.ts`
- Create: `apps/api/src/scripts/padronizar-vencimentos.ts`

**Interfaces:**
- Consumes: `proximoVencimento(competencia, dueDay)`, `instanteDeBloqueio(vencimento, graceDays, fuso)` (Task 2), `vencimentoAposPagamento`, `diaDoPagamento`, `BillingRepository.abrirInvoiceDoPeriodo`, `BillingRepository.ativarDireitoDeAcessoSePendente`, `comContexto`.
- Produces: funções puras `planejarFaturaAberta`, `coberturasDosPagos`.

- [ ] **Step 1: Teste do domínio (falha)**

`dominio.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import { coberturasDosPagos, planejarFaturaAberta } from './dominio.js';

const SP = 'America/Sao_Paulo';
const cfg = { dueDay: 10, graceDays: 5, fuso: SP };
const d = (iso: string): Date => new Date(iso);

describe('planejarFaturaAberta', () => {
  it('fatura ancorada (nov em 06/11) volta para 10/11 e bloqueio 15/11 local', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-11-01T00:00:00Z'), status: 'OPEN', dueAt: d('2026-11-06T00:00:00Z'), blockAt: d('2026-11-09T00:00:00Z') },
        cfg,
        d('2026-10-07T15:00:00Z'),
      ),
    ).toEqual({ dueAt: d('2026-11-10T00:00:00Z'), blockAt: d('2026-11-15T03:00:00Z'), status: 'OPEN' });
  });

  it('OVERDUE cujo novo bloqueio e futuro volta a OPEN', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-10-01T00:00:00Z'), status: 'OVERDUE', dueAt: d('2026-10-09T00:00:00Z'), blockAt: d('2026-10-12T00:00:00Z') },
        cfg,
        d('2026-10-13T15:00:00Z'),
      )?.status,
    ).toBe('OPEN');
  });

  it('OVERDUE de set/26 continua OVERDUE (15/09 ja passou)', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-09-01T00:00:00Z'), status: 'OVERDUE', dueAt: d('2026-09-10T00:00:00Z'), blockAt: null },
        cfg,
        d('2026-10-07T15:00:00Z'),
      ),
    ).toEqual({ dueAt: d('2026-09-10T00:00:00Z'), blockAt: d('2026-09-15T03:00:00Z'), status: 'OVERDUE' });
  });

  it('ja padronizada devolve null (idempotente)', () => {
    expect(
      planejarFaturaAberta(
        { billingPeriod: d('2026-10-01T00:00:00Z'), status: 'OPEN', dueAt: d('2026-10-10T00:00:00Z'), blockAt: d('2026-10-15T03:00:00Z') },
        cfg,
        d('2026-10-07T15:00:00Z'),
      ),
    ).toBeNull();
  });
});

describe('coberturasDosPagos', () => {
  it('lote escalonado por competencia; avulso k=1; ignora quem ja tem cobertura', () => {
    const r = coberturasDosPagos([
      { invoiceId: 'dez', billingPeriod: d('2026-12-01T00:00:00Z'), paidAt: d('2026-10-07T12:00:00Z'), batchId: 'L' },
      { invoiceId: 'out', billingPeriod: d('2026-10-01T00:00:00Z'), paidAt: d('2026-10-07T12:00:00Z'), batchId: 'L' },
      { invoiceId: 'nov', billingPeriod: d('2026-11-01T00:00:00Z'), paidAt: d('2026-10-07T12:00:00Z'), batchId: 'L' },
      { invoiceId: 'set', billingPeriod: d('2026-09-01T00:00:00Z'), paidAt: d('2026-09-05T18:00:00Z'), batchId: null },
    ]);

    expect(Object.fromEntries([...r].map(([id, data]) => [id, data.toISOString().slice(0, 10)]))).toEqual({
      out: '2026-11-06',
      nov: '2026-12-06',
      dez: '2027-01-05',
      set: '2026-10-05',
    });
  });
});
```

Run: `pnpm --filter @arenahub/api test -- --testPathPattern padronizar-vencimentos`
Expected: FAIL (módulo não existe).

- [ ] **Step 2: Domínio**

`dominio.ts`:

```ts
import { diaDoPagamento } from '../../modules/billing/domain/cancelamento-de-pagamento.js';
import { instanteDeBloqueio, proximoVencimento } from '../../modules/billing/domain/ciclo-de-cobranca.js';
import { vencimentoAposPagamento } from '../../modules/billing/domain/meses-pagaveis.js';

/** Saneamento da F88 -- funcoes puras, o "agora" entra por parametro. */

export interface FaturaAberta {
  readonly billingPeriod: Date;
  readonly status: 'OPEN' | 'OVERDUE';
  readonly dueAt: Date;
  readonly blockAt: Date | null;
}

export interface Politica {
  readonly dueDay: number;
  readonly graceDays: number;
  readonly fuso: string;
}

/**
 * Vencimento no dia do ciclo e bloqueio na meia-noite local de venc. + carencia.
 * OVERDUE cujo novo bloqueio e futuro volta a OPEN. `null` = nada a mudar.
 */
export function planejarFaturaAberta(
  fatura: FaturaAberta,
  politica: Politica,
  agora: Date,
): { dueAt: Date; blockAt: Date; status: 'OPEN' | 'OVERDUE' } | null {
  const dueAt = proximoVencimento(fatura.billingPeriod, politica.dueDay);
  const blockAt = instanteDeBloqueio(dueAt, politica.graceDays, politica.fuso);
  const status = fatura.status === 'OVERDUE' && blockAt.getTime() > agora.getTime() ? 'OPEN' : fatura.status;

  const igual =
    fatura.dueAt.getTime() === dueAt.getTime() &&
    fatura.blockAt?.getTime() === blockAt.getTime() &&
    fatura.status === status;

  return igual ? null : { dueAt, blockAt, status };
}

export interface FaturaPaga {
  readonly invoiceId: string;
  readonly billingPeriod: Date;
  /** `paidAt` do primeiro pagamento CONFIRMED da fatura. */
  readonly paidAt: Date;
  readonly batchId: string | null;
}

/** Cobertura de cada fatura paga: dia do pagamento + 30 x posicao no lote (por competencia). */
export function coberturasDosPagos(pagas: readonly FaturaPaga[]): Map<string, Date> {
  const grupos = new Map<string, FaturaPaga[]>();

  for (const paga of pagas) {
    const chave = paga.batchId ?? `avulso:${paga.invoiceId}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), paga]);
  }

  const resultado = new Map<string, Date>();

  for (const grupo of grupos.values()) {
    [...grupo]
      .sort((a, b) => a.billingPeriod.getTime() - b.billingPeriod.getTime())
      .forEach((paga, i) => resultado.set(paga.invoiceId, vencimentoAposPagamento(diaDoPagamento(paga.paidAt), i + 1)));
  }

  return resultado;
}
```

Run: `pnpm --filter @arenahub/api test -- --testPathPattern padronizar-vencimentos`
Expected: PASS.

- [ ] **Step 3: Executor**

`padronizar-vencimentos.ts`, no padrão de `reconciliar-setembro-2026.ts`: cabeçalho de uso, `reflect-metadata`, `dotenv` de `../../.env`, `NestFactory.createApplicationContext(AppModule)`, slug `PADRONIZAR_TENANT_SLUG ?? 'arena-positiva'`, `--gravar` opcional. Tudo dentro de `comContexto({ kind: 'tenant', tenantId }, async () => { ... })`. Ordem:

```ts
/**
 * Saneamento da F88 (SPEC-088) -- padroniza vencimento, cobertura e carencia.
 *
 *   PADRONIZAR_TENANT_SLUG=arena-positiva node dist/scripts/padronizar-vencimentos.js [--gravar]
 *
 * Sem `--gravar` SO LE e imprime o plano. Idempotente: a segunda execucao com
 * `--gravar` nao muda nada. Precisa de build antes (`tsx` nao emite
 * `design:paramtypes`). Nao imprime nome nem CPF -- so contagens e ids.
 */
```

1. **Carência:** lê `billingSettings`. Se `graceDays !== 5`, imprime `graceDays X -> 5` e, com `--gravar`, atualiza. O resto do script usa `graceDays: 5`.
2. **Faturas abertas:** `invoice.findMany({ where: { tenantId, status: { in: ['OPEN','OVERDUE'] } }, select: { id, billingPeriod, status, dueAt, blockAt, subscriptionId, student: { select: { gymUnit: { select: { timezone: true } } } } } })` dentro de `db.comTenant`. Para cada uma, `planejarFaturaAberta(f, { dueDay, graceDays: 5, fuso: f.student.gymUnit.timezone }, agora)`. Imprime contagem de mudanças e de `OVERDUE → OPEN`. Com `--gravar`: `invoice.updateMany({ where: { id, status: f.status }, data: { dueAt, blockAt, status, version: { increment: 1 } } })`.
3. **Reativar:** para cada assinatura cuja fatura voltou a `OPEN`, se depois do passo 2 não restar fatura dela `OVERDUE` com `blockAt <= agora`, chame `billing.ativarDireitoDeAcessoSePendente(tx, { tenantId, subscriptionId })` dentro de `db.$transaction`. Imprime quantas.
4. **Out/26 faltante:** mesma consulta de elegíveis da Task 5 (copie o `where`). Para quem não tem fatura com `billingPeriod = 2026-10-01`, `billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId, emQue: new Date('2026-10-15T12:00:00Z') })` (vence 10/10/2026 porque `dueDay` = 10; se o tenant tiver outro `dueDay`, **pare** e reporte). Antes de criar, imprime a contagem.
5. **Cobertura das pagas:** faturas `PAID` com `coverageEndsAt: null`, com o primeiro `Payment` `CONFIRMED` (`orderBy: { createdAt: 'asc' }`, `take: 1`). Para todas as faturas dos mesmos `batchId`, monte `FaturaPaga[]` (a posição depende do lote inteiro, inclusive das que já têm cobertura). `coberturasDosPagos` → `updateMany({ where: { id, coverageEndsAt: null }, data: { coverageEndsAt } })`.
6. **Relatório:** (a) contagem de alunos `profile STUDENT`, `status ACTIVE` sem assinatura `ACTIVE`/`PAST_DUE`, com a lista de `membershipNumber` (matrícula, não nome); (b) quantas assinaturas STUDENT seriam suspensas na primeira execução do job, ou seja, faturas `OPEN`/`OVERDUE` com novo `blockAt <= agora`, com as matrículas.

Formato de saída: linhas `[padronizar] <rótulo> : <n>`, como no script de setembro.

- [ ] **Step 4: Rodar contra o banco descartável**

Seed + build, depois:

Run: `pnpm --filter @arenahub/api build && cd apps/api && PADRONIZAR_TENANT_SLUG=<slug-do-seed> DATABASE_URL=<url-descartavel> RUNTIME_DATABASE_URL= node dist/scripts/padronizar-vencimentos.js`
Expected: plano impresso, nada gravado. Com `--gravar`, aplica. Rodar `--gravar` de novo mostra **zero** em todos os contadores de mudança.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scripts/padronizar-vencimentos.ts apps/api/src/scripts/padronizar-vencimentos
git commit -m "feat(scripts): saneamento de vencimentos e cobertura para producao (F88)"
```

---

### Task 8: Documentação, gate e entrega

**Files:**
- Modify: `docs/DECISIONS.md` (F83 ~4680-4729, F85 ~4844-4859, ADR-019 ~801-836)
- Modify: `docs/CONVENTION.md` (INV-163 ~430-444; nova INV depois da última)
- Modify: `docs/STATUS.md` (índice Fatia↔SPEC, linha F88), `docs/DEVELOPMENT.md`, `docs/TESTS.md`/`docs/TESTING.md` (padrão das fatias anteriores)
- Modify: `docs/specs/SPEC-088-padronizar-vencimento-e-bloqueio.md` (Card)

- [ ] **Step 1: Emendas**
  - **F83 em `DECISIONS.md`:** nota "Emenda de 07/10/2026 (F88, decisão do PI): a âncora `data + 30 × N` na fatura seguinte foi **revogada**. Todo vencimento é o dia do ciclo; a data do pagamento só define `Invoice.coverageEndsAt` (informativo). O lote não abre mais a fatura seguinte."
  - **F85:** "a restauração de vencimento deixou de existir (F88)."
  - **ADR-019:** "carência do tenant inaugural = 5 dias (F88); bloqueio = meia-noite local de `dueAt + carência`."
  - **`CONVENTION.md`, INV-163:** a mesma emenda da F83.
  - **Nova INV (próximo número livre, conferido por grep):** "Fatura mensal nasce todo dia 01 (00:05 no fuso de São Paulo) para aluno `STUDENT` + `ACTIVE` com assinatura vigente e plano ≠ DIARIA; idempotente por INV-066. Inadimplência roda diariamente (00:10) só sobre `STUDENT` e plano ≠ DIARIA, ligada por `BILLING_DELINQUENCY_JOB_ENABLED`."

- [ ] **Step 2: Issue e índice**

Crie a issue `[MVP2][SPEC-088][F88] Padronizar vencimento, fatura mensal e bloqueio por inadimplência` (Backlog, assignee PI, label `proplan:backlog`, corpo com link para a spec) e mova para `doing`. Preencha o número em `SPEC-088` (Card) e na linha F88 do `STATUS.md`.

- [ ] **Step 3: Gate local (memória `gate-local-antes-do-push`)**

Run: `pnpm lint --force && pnpm typecheck && pnpm test && pnpm --filter @arenahub/api test:integration && pnpm build`
Expected: tudo verde. Integração contra o Postgres descartável.

- [ ] **Step 4: Revisão adversarial**

Rode a skill `code-review` (sem CodeRabbit: memória `nunca-usar-coderabbit`) sobre `main...HEAD`. Corrija o que for CRITICAL/HIGH.

- [ ] **Step 5: Commit, PR, CI, merge**

```bash
git add docs
git commit -m "docs: F88 — emendas F83/F85/ADR-019, INV nova, indice e status"
git push -u origin feat/f88-padronizar-vencimento
gh pr create --title "feat: padronizar vencimento, fatura mensal e bloqueio (F88)" --body "refs #<issue> ..."
```

PR com `refs #N` (nunca `closes`). Esperar o CI com `gh run watch <id> --exit-status` em background, avisando o PI. Merge com CI verde e `proplan:done` com link do PR. Depois do merge, conferir que a issue **não** fechou sozinha (memória `merge-pode-fechar-issue-sem-closes`).

- [ ] **Step 6: Produção (com o PI)**

1. Conferir no log do deploy da Railway que a migration `20261007180000_f88_cobertura_e_carencia` aplicou (memória `migration-aplica-sozinha-no-deploy`).
2. Rodar o script **sem** `--gravar` contra produção e mostrar ao PI as contagens, a lista "sem assinatura vigente" e a lista "seria bloqueado no primeiro dia".
3. Com o OK do PI, rodar `--gravar` e depois sem flag de novo (zero mudanças).
4. Só então o PI define `BILLING_DELINQUENCY_JOB_ENABLED=true` no serviço da API.
5. Perguntar ao PI se roda `/graphify . --update`.
