# Cancelar pagamento manual lançado errado — Plano de implementação (F85)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a recepção cancela, pela tela e com motivo, um pagamento manual lançado por engano; a fatura volta a aberta e o lançamento some da grade, com trilha de auditoria.

**Architecture:** um caso de uso novo (`CancelarPagamentoManualUseCase`) numa transação só move `Payment` para `CANCELLED`, reabre a `Invoice` (`PAID → OPEN`), expira crédito `AVAILABLE`, devolve o vencimento da fatura seguinte quando o lote inteiro é desfeito e grava `AuditLog` + `OutboxEvent`. Regras puras ficam em `domain/cancelamento-de-pagamento.ts`. A grade esconde pagamento cancelado e o recibo dele deixa de ser emitido/consultado. A tela ganha um botão que abre o `ConfirmDialog` (motivo obrigatório) e chama uma Server Action.

**Tech Stack:** NestJS + Prisma 7 + Zod (api), Jest (unit/integração), Next.js 16 App Router + Vitest + Testing Library (admin-web), Playwright (E2E).

**Spec:** [`docs/superpowers/specs/2026-10-05-cancelar-pagamento-manual-design.md`](../specs/2026-10-05-cancelar-pagamento-manual-design.md) — ler antes de começar.

## Global Constraints

- Documentação, commits e mensagens ao usuário em **PT-BR**; o código segue o estilo do arquivo vizinho (o módulo `billing` usa identificadores em português — manter).
- **Dinheiro é inteiro em centavos**; nunca `float`/`number` formatado para valor. Não formatar dinheiro com `Intl` fora de `Money`/`TenantDateTime` (regra 5 do lint) — por isso o resumo do diálogo **não** mostra o valor, só competência e canal.
- **`tenantId` vem do `TenantContext` autenticado**, nunca do corpo. Toda query leva `tenantId`.
- **Evento de domínio e auditoria na mesma transação** da mudança de estado (regra de arquitetura nº 5).
- **Pagamento não controla acesso** (regra nº 1): este código **não toca** em `Entitlement` nem em `Subscription`.
- Erro de domínio tem **código estável** e HTTP `application/problem+json` (via `ErroDeDominio`).
- **Toast** para info/warn/error — nunca `Alert`. Nada de hex literal em CSS (`pnpm test:guardas` recusa); só tokens `--ah-*`.
- Validar motivo em JS, nunca `required` nativo (o `SensitiveAction` já faz).
- Commits seguem `<type>: <descrição>` (conventional), terminam com a linha `Co-Authored-By` do harness; PR usa **`refs #N`**, **nunca** `closes/fixes #N`.
- **Prisma só contra o banco de teste.** Nunca rodar `prisma` com o `DATABASE_URL` do `.env` (é produção); sempre exportar `DATABASE_URL` com o valor de `INTEGRATION_DATABASE_URL` no mesmo comando.
- Rodar `pnpm test:report` antes do commit final (a integração não roda no `pnpm test`).

## Review Focus

Entradas e condições que a spec implica e que quem opera vai encontrar; cada linha tem o teste que a fixa na tarefa dona do código.

1. **Duplo clique / dois cancelamentos simultâneos** → exatamente um vence, o outro recebe 409 e nada muda duas vezes (Task 3, testes "segundo cancelamento recusa" e "corrida").
2. **Crédito de sobrepagamento já usado em outra fatura** → 409 e o estado inteiro intacto (Task 3, "crédito APPLIED recusa").
3. **Lote com mais de um mês: cancelar só um** → os irmãos continuam pagos e o vencimento da fatura seguinte **não** é devolvido até o lote inteiro ser desfeito (Task 3, "lote de dois meses").
4. **Vencimento da fatura seguinte alterado à mão** → não é sobrescrito (Task 3, "vencimento divergente").
5. **Recibo já impresso do pagamento cancelado** → reemitir/consultar recusa com 409 (Task 4).
6. **Mês cancelado precisa poder ser pago de novo** pelo mesmo caminho do lote (Task 3, "paga de novo").
7. **Pagamento de outro tenant ou inexistente** → 404, sem vazar existência (Task 3).

---

### Task 0: Preflight — branch, número da fatia e issue

**Files:** nenhum.

- [ ] **Step 1: Alocar F85/SPEC-085 sem colisão**

Run: `grep -rnE "F85|SPEC-085" docs apps packages --include=*.md --include=*.ts | grep -v "2026-10-05-cancelar-pagamento-manual"`
Expected: sem resultados. Se alguém reservou o número, usar o próximo livre em **todos** os arquivos deste plano e da spec.

- [ ] **Step 2: Criar a issue (o Code cria a própria — `CLAUDE.md`)**

Título `[MVP2][SPEC-085][F85] Cancelar pagamento manual lançado errado`, corpo com links para a spec e este plano, labels do board conforme as issues vizinhas (`gh issue view 557` mostra o padrão); mover para `todo` ao pegar e `doing` ao iniciar. Anotar o número `N`: **substitui `#<issue>` em todos os commits abaixo**.

- [ ] **Step 3: Branch de trabalho**

A branch `docs/f85-cancelar-pagamento-manual` já carrega a spec e este plano. Renomear para virar a branch do PR: `git branch -m feat/f85-cancelar-pagamento-manual`. Confirmar que o banco de teste e o Docker estão de pé (novas portas, nunca as já configuradas — `CLAUDE.md`).

---

### Task 1: Regras puras do cancelamento

**Files:**
- Create: `apps/api/src/modules/billing/domain/cancelamento-de-pagamento.ts`
- Test: `apps/api/src/modules/billing/domain/cancelamento-de-pagamento.spec.ts`

**Interfaces:**
- Consumes: `ErroDeDominio` (`common/http/erro-de-dominio.js`), `vencimentoAposPagamento(dia: Date, mesesPagos: number): Date` (`domain/meses-pagaveis.js`).
- Produces (usados nas Tasks 3 e 4):
  - `class PagamentoNaoCancelavelError(motivo: string)` — 409 `BILLING_PAYMENT_NOT_CANCELLABLE`
  - `class CancelamentoInvalidoError(motivo: string)` — 422 `BILLING_INVALID_CANCEL`
  - `class CreditoJaAplicadoError()` — 409 `BILLING_CREDIT_ALREADY_APPLIED`
  - `class PagamentoCanceladoError()` — 409 `BILLING_PAYMENT_CANCELLED`
  - `validarCancelamento(pagamento: { method: string; status: string }, reason: string): void`
  - `diaDoPagamento(paidAt: Date): Date` — meia-noite UTC do dia UTC de `paidAt`
  - `deveRestaurarVencimento(entrada: { dueAtAtual: Date; paidAt: Date; tamanhoDoLote: number; confirmadosRestantesNoLote: number }): boolean`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/modules/billing/domain/cancelamento-de-pagamento.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import {
  CancelamentoInvalidoError,
  PagamentoNaoCancelavelError,
  deveRestaurarVencimento,
  diaDoPagamento,
  validarCancelamento,
} from './cancelamento-de-pagamento.js';

/**
 * Regras do cancelamento de pagamento manual. F85, decisao do PI em
 * 05/10/2026 (emenda do INV-069 so para pagamento MANUAL).
 */
describe('validarCancelamento', () => {
  const manualConfirmado = { method: 'MANUAL', status: 'CONFIRMED' };

  it('aceita pagamento manual confirmado com motivo', () => {
    expect(() => validarCancelamento(manualConfirmado, 'lancei no aluno errado')).not.toThrow();
  });

  it('recusa PIX e cartao: o caminho deles e o estorno com provedor', () => {
    expect(() => validarCancelamento({ method: 'PIX', status: 'CONFIRMED' }, 'motivo ok')).toThrow(
      PagamentoNaoCancelavelError,
    );
    expect(() => validarCancelamento({ method: 'CARD', status: 'CONFIRMED' }, 'motivo ok')).toThrow(
      PagamentoNaoCancelavelError,
    );
  });

  it.each(['CANCELLED', 'REFUNDED', 'PENDING', 'FAILED', 'REFUND_PENDING'])(
    'recusa pagamento em %s',
    (status) => {
      expect(() => validarCancelamento({ method: 'MANUAL', status }, 'motivo ok')).toThrow(
        PagamentoNaoCancelavelError,
      );
    },
  );

  it('recusa motivo curto ou so de espacos', () => {
    expect(() => validarCancelamento(manualConfirmado, 'ab')).toThrow(CancelamentoInvalidoError);
    expect(() => validarCancelamento(manualConfirmado, '   ab   ')).toThrow(CancelamentoInvalidoError);
  });

  it('checa o metodo ANTES do motivo: PIX com motivo vazio diz "nao cancelavel", nao "motivo"', () => {
    expect(() => validarCancelamento({ method: 'PIX', status: 'CONFIRMED' }, '')).toThrow(
      PagamentoNaoCancelavelError,
    );
  });
});

describe('diaDoPagamento', () => {
  it('devolve a meia-noite UTC do dia UTC do instante', () => {
    expect(diaDoPagamento(new Date('2026-10-05T19:13:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(diaDoPagamento(new Date('2026-10-05T12:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('deveRestaurarVencimento', () => {
  const paidAt = new Date('2026-10-05T19:13:00Z');

  it('restaura quando o vencimento e exatamente o gravado pelo lote de 1 mes (05/10 + 30 dias)', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-11-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 1,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(true);
  });

  it('restaura com lote de 2 meses quando o vencimento e 05/10 + 60 dias', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-12-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 2,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(true);
  });

  it('nao restaura quando o vencimento e outro (alguem ja mexeu nele)', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-11-20T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 1,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(false);
  });

  it('nao restaura enquanto sobrar pagamento confirmado no lote', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-12-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 2,
        confirmadosRestantesNoLote: 1,
      }),
    ).toBe(false);
  });

  it('nao confunde o tamanho do lote: vencimento de 2 meses num lote de 1 nao casa', () => {
    expect(
      deveRestaurarVencimento({
        dueAtAtual: new Date('2026-12-04T00:00:00Z'),
        paidAt,
        tamanhoDoLote: 1,
        confirmadosRestantesNoLote: 0,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/api`): `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit --testPathPattern cancelamento-de-pagamento`
Expected: FAIL — `Cannot find module './cancelamento-de-pagamento.js'`.

- [ ] **Step 3: Implementar**

Criar `apps/api/src/modules/billing/domain/cancelamento-de-pagamento.ts`:

```ts
import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { vencimentoAposPagamento } from './meses-pagaveis.js';

/**
 * Cancelamento de pagamento MANUAL lancado por engano. F85, decisao do PI em
 * 05/10/2026.
 *
 * EMENDA DO INV-069 so para pagamento `MANUAL`: a fatura paga volta a `OPEN`.
 * PIX e cartao seguem so pelo estorno com provedor (`estorno.ts`) -- dinheiro
 * que passou por provedor nao se "cancela", se devolve.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`).
 */

export class PagamentoNaoCancelavelError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_PAYMENT_NOT_CANCELLABLE', 409, motivo);
  }
}

export class CancelamentoInvalidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_INVALID_CANCEL', 422, motivo);
  }
}

/**
 * O credito do sobrepagamento ja abateu OUTRA fatura. Cancelar o pagamento
 * deixaria o aluno com abatimento sem origem -- a recepcao nao resolve isso
 * sozinha, e o 409 diz exatamente que o caso e do gerente.
 */
export class CreditoJaAplicadoError extends ErroDeDominio {
  constructor() {
    super(
      'BILLING_CREDIT_ALREADY_APPLIED',
      409,
      'o credito gerado por este pagamento ja foi usado em outra cobranca; nao e possivel cancelar',
    );
  }
}

/** Recibo de pagamento cancelado nao circula: o recebimento nao vale mais. */
export class PagamentoCanceladoError extends ErroDeDominio {
  constructor() {
    super('BILLING_PAYMENT_CANCELLED', 409, 'o pagamento deste recibo foi cancelado');
  }
}

export interface PagamentoParaCancelar {
  readonly method: string;
  readonly status: string;
}

/**
 * ORDEM DAS GUARDAS IMPORTA: o metodo vem antes do motivo. Quem tenta cancelar
 * um PIX com o motivo em branco precisa ouvir "isto nao se cancela aqui", e
 * nao "escreva o motivo" -- escrever o motivo nao resolveria nada.
 */
export function validarCancelamento(pagamento: PagamentoParaCancelar, reason: string): void {
  if (pagamento.method !== 'MANUAL') {
    throw new PagamentoNaoCancelavelError(
      'so pagamento manual e cancelado por aqui; PIX e cartao passam pelo estorno',
    );
  }

  if (pagamento.status !== 'CONFIRMED') {
    throw new PagamentoNaoCancelavelError(
      `pagamento em ${pagamento.status} nao pode ser cancelado; so CONFIRMED`,
    );
  }

  if (reason.trim().length < 3) {
    throw new CancelamentoInvalidoError('motivo do cancelamento e obrigatorio (minimo 3 caracteres)');
  }
}

/**
 * O DIA em que o lote ancorou o vencimento: meia-noite UTC do dia UTC de
 * `paidAt`. O lote grava o instante real (hoje) ou meio-dia UTC (dia passado)
 * em `Payment.paidAt`, mas ancora o vencimento no DIA informado
 * (`ancorarProximoVencimento`).
 *
 * ponytail: recepcao que paga depois das 21h (Brasil) manda o dia local e o
 * `paidAt` cai no dia UTC seguinte; os dois dias divergem, o vencimento nao
 * casa e NAO e restaurado. Falha para o lado seguro (nao toca). Se aparecer
 * na pratica, guardar o dia ancorado no lote.
 */
export function diaDoPagamento(paidAt: Date): Date {
  return new Date(Date.UTC(paidAt.getUTCFullYear(), paidAt.getUTCMonth(), paidAt.getUTCDate()));
}

/**
 * O vencimento da fatura seguinte ainda e o que ESTE lote gravou?
 *
 * Conservador de proposito -- so devolve ao padrao do ciclo quando (a) o lote
 * inteiro foi desfeito e (b) o `dueAt` atual e exatamente o ancorado
 * (`dia + N * 30 dias`, N = tamanho do lote). Qualquer outra coisa significa
 * que outro pagamento ou a recepcao ja mexeu naquela data, e sobrescreve-la
 * apagaria uma decisao.
 */
export function deveRestaurarVencimento(entrada: {
  readonly dueAtAtual: Date;
  readonly paidAt: Date;
  readonly tamanhoDoLote: number;
  readonly confirmadosRestantesNoLote: number;
}): boolean {
  if (entrada.confirmadosRestantesNoLote > 0) {
    return false;
  }

  const ancora = vencimentoAposPagamento(diaDoPagamento(entrada.paidAt), entrada.tamanhoDoLote);

  return entrada.dueAtAtual.getTime() === ancora.getTime();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (de `apps/api`): `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit --testPathPattern cancelamento-de-pagamento`
Expected: PASS (todos os casos acima).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/domain/cancelamento-de-pagamento.ts apps/api/src/modules/billing/domain/cancelamento-de-pagamento.spec.ts
git commit -m "feat: regras puras do cancelamento de pagamento manual (refs #<issue>)"
```

---

### Task 2: Colunas de cancelamento em `payments`

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `Payment`, ~linha 3697, depois de `recognizedByUserId`)
- Create: `packages/database/prisma/migrations/20261005130000_f85_cancelamento_de_pagamento_manual/migration.sql`

**Interfaces:**
- Consumes: —
- Produces: `Payment.cancelledAt: Date | null`, `Payment.cancelledByUserId: string | null`, `Payment.cancelReason: string | null` no client Prisma (Tasks 3 e 4).

- [ ] **Step 1: Editar o schema**

No `model Payment`, logo depois do campo `recognizedByUserId`, acrescentar:

```prisma
  /// Cancelamento de pagamento MANUAL lancado por engano (F85, decisao do PI em
  /// 05/10/2026). Preenchidos juntos, so quando `status = CANCELLED`. A linha
  /// NAO e apagada: e a trilha de quem lancou, quem cancelou e por que.
  cancelledAt       DateTime? @map("cancelled_at")
  cancelledByUserId String?   @map("cancelled_by_user_id") @db.Uuid
  cancelReason      String?   @map("cancel_reason")
```

- [ ] **Step 2: Escrever a migration**

Criar `packages/database/prisma/migrations/20261005130000_f85_cancelamento_de_pagamento_manual/migration.sql`:

```sql
-- F85: cancelamento de pagamento manual lancado por engano (decisao do PI,
-- 05/10/2026). So colunas NULAS em `payments`: nenhuma linha existente muda e
-- nao ha backfill. `PaymentStatus.CANCELLED` ja existe no enum.
ALTER TABLE "payments"
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_by_user_id" UUID,
  ADD COLUMN "cancel_reason" TEXT;
```

- [ ] **Step 3: Aplicar no banco de TESTE e regenerar o client**

Run (confira que a variável existe e **nunca** use o `DATABASE_URL` do `.env`):

```bash
cd packages/database
DATABASE_URL="$INTEGRATION_DATABASE_URL" pnpm exec prisma migrate deploy
pnpm generate
```

Expected: `1 migration applied` (ou "already applied" se repetir) e `Generated Prisma Client`. Se `INTEGRATION_DATABASE_URL` não estiver no shell, ler o valor de `.env` **sem imprimi-lo** e exportá-lo na mesma linha do comando.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @arenahub/database typecheck && pnpm --filter @arenahub/api typecheck`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20261005130000_f85_cancelamento_de_pagamento_manual
git commit -m "feat: colunas de cancelamento em payments (refs #<issue>)"
```

---

### Task 3: Caso de uso, rota e testes de integração

**Files:**
- Create: `apps/api/src/modules/billing/cancelar-pagamento-manual.use-case.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts` (provider)
- Modify: `apps/api/src/modules/billing/billing.controller.ts` (schema Zod, injeção, rota)
- Test: `apps/api/test/integration/billing-cancelar-pagamento-manual.int-spec.ts`

**Interfaces:**
- Consumes (Task 1): `validarCancelamento`, `deveRestaurarVencimento`, `CreditoJaAplicadoError`, `PagamentoNaoCancelavelError`. De `domain/invoice.js`: `TransicaoDeInvoiceConcorrenteError(invoiceId)`. De `domain/ciclo-de-cobranca.js`: `proximoVencimento(competencia: Date, dueDay: number): Date`, `instanteDeBloqueio(vencimento: Date, graceDays: number): Date`. De `billing.repository.js`: `ConfiguracaoFinanceiraAusenteError`.
- Produces:
  - `class PagamentoNaoEncontradoParaCancelamentoError()` — 404 `PAYMENT_NOT_FOUND`
  - `interface PagamentoCancelado { paymentId: string; invoiceId: string; vencimentoRestaurado: boolean }`
  - `CancelarPagamentoManualUseCase.executar(contexto: TenantContext, entrada: { paymentId: string; reason: string; agora: Date }, correlationId: string): Promise<PagamentoCancelado>`
  - Rota `POST /payments/:id/cancel`, corpo `{ reason: string }`, resposta `PagamentoCancelado`, permissão `billing.payment.manual`.

- [ ] **Step 1: Escrever o teste de integração (falha)**

Criar `apps/api/test/integration/billing-cancelar-pagamento-manual.int-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import {
  CancelamentoInvalidoError,
  CreditoJaAplicadoError,
  PagamentoCanceladoError,
  PagamentoNaoCancelavelError,
} from '../../src/modules/billing/domain/cancelamento-de-pagamento.js';
import {
  CancelarPagamentoManualUseCase,
  PagamentoNaoEncontradoParaCancelamentoError,
} from '../../src/modules/billing/cancelar-pagamento-manual.use-case.js';
import { EmitirReciboUseCase } from '../../src/modules/billing/emitir-recibo.use-case.js';
import { RegistrarPagamentoEmLoteUseCase } from '../../src/modules/billing/registrar-pagamento-em-lote.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Cancelamento de pagamento manual lancado por engano (F85, decisao do PI em
 * 05/10/2026). Contra banco de verdade: a atomicidade, a corrida de dois
 * cancelamentos e a restauracao do vencimento sao comportamento do Postgres.
 *
 * O pagamento e criado pelo CAMINHO REAL (lote da recepcao), nao por `INSERT`:
 * e ele que ancora o vencimento da fatura seguinte, e e esse efeito que o
 * cancelamento precisa desfazer.
 */
describe('CancelarPagamentoManualUseCase', () => {
  let db: PrismaService;
  let cancelar: CancelarPagamentoManualUseCase;
  let registrarLote: RegistrarPagamentoEmLoteUseCase;
  let recibo: EmitirReciboUseCase;
  let billing: BillingRepository;

  const sufixo = randomUUID().slice(0, 8);
  const AGORA = new Date('2026-10-05T19:13:00Z');
  const contexto: TenantContext = {
    tenantId: '',
    actorId: '',
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };
  let outroTenantId = '';
  let unidadeId = '';
  let planoId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    cancelar = comContextoDeTenant(moduleRef.get(CancelarPagamentoManualUseCase));
    registrarLote = comContextoDeTenant(moduleRef.get(RegistrarPagamentoEmLoteUseCase));
    recibo = comContextoDeTenant(moduleRef.get(EmitirReciboUseCase));
    billing = comContextoDeTenant(moduleRef.get(BillingRepository));

    const tenant = await db.tenant.create({
      data: { slug: `canc-${sufixo}`, legalName: `Canc ${sufixo} LTDA`, displayName: `Canc ${sufixo}` },
    });
    contexto.tenantId = tenant.id;

    const outro = await db.tenant.create({
      data: { slug: `canc2-${sufixo}`, legalName: `Canc2 ${sufixo} LTDA`, displayName: `Canc2 ${sufixo}` },
    });
    outroTenantId = outro.id;

    const senhas = moduleRef.get(PasswordService);
    const operador = await db.user.create({
      data: {
        email: `canc-op-${sufixo}@exemplo.test`,
        passwordHash: await senhas.gerarHash('canc-senha-de-teste-nao-usada-em-producao'),
      },
      select: { id: true },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });
    contexto.actorId = operador.id;

    await db.billingSettings.create({ data: { tenantId: tenant.id, dueDay: 9, graceDays: 3 } });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    unidadeId = unidade.id;

    const plano = await db.plan.create({
      data: {
        tenantId: tenant.id,
        name: `Plano Canc ${sufixo}`,
        prices: {
          create: [
            {
              tenantId: tenant.id,
              amountMinor: 10000,
              currency: 'BRL',
              validFrom: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        },
      },
      select: { id: true },
    });
    planoId = plano.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [contexto.tenantId, outroTenantId] } } });
  });

  async function novaAssinatura(): Promise<{ studentId: string; subscriptionId: string }> {
    const marca = randomUUID().slice(0, 8);
    const aluno = await db.student.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `CANC-${marca}`,
        fullName: 'Aluno Cancelamento',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const assinatura = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: aluno.id,
        planId: planoId,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
      },
      select: { id: true },
    });

    return { studentId: aluno.id, subscriptionId: assinatura.id };
  }

  /** Paga um lote de meses ('YYYY-MM') pelo caminho real da recepcao. */
  async function pagarLote(
    subscriptionId: string,
    competencias: string[],
    receivedAmountMinor?: number,
  ): Promise<void> {
    await registrarLote.executar(
      contexto,
      {
        subscriptionId,
        competencias: competencias.map((c) => new Date(`${c}-01T00:00:00Z`)),
        dispensar: [],
        paidAt: new Date('2026-10-05T00:00:00Z'),
        channel: 'DINHEIRO',
        expectedTotalMinor: 10000 * competencias.length,
        ...(receivedAmountMinor !== undefined ? { receivedAmountMinor } : {}),
        idempotencyKey: randomUUID(),
        agora: AGORA,
      },
      'corr-cancelamento',
    );
  }

  async function invoiceDe(subscriptionId: string, mes: string) {
    return db.invoice.findUniqueOrThrow({
      where: {
        tenantId_subscriptionId_billingPeriod: {
          tenantId: contexto.tenantId,
          subscriptionId,
          billingPeriod: new Date(`${mes}-01T00:00:00Z`),
        },
      },
    });
  }

  async function pagamentoDe(subscriptionId: string, mes: string) {
    const invoice = await invoiceDe(subscriptionId, mes);

    return db.payment.findFirstOrThrow({ where: { invoiceId: invoice.id, status: 'CONFIRMED' } });
  }

  const cancelarPagamento = (paymentId: string, reason = 'lancado no aluno errado') =>
    cancelar.executar(contexto, { paymentId, reason, agora: AGORA }, 'corr-cancelamento');

  it('cancela o pagamento, reabre a fatura e devolve o vencimento da seguinte', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    // Pre-condicao: o lote ancorou nov em 05/10 + 30 dias.
    expect((await invoiceDe(subscriptionId, '2026-11')).dueAt.toISOString()).toBe('2026-11-04T00:00:00.000Z');

    const resultado = await cancelarPagamento(pagamento.id);

    expect(resultado).toEqual({
      paymentId: pagamento.id,
      invoiceId: pagamento.invoiceId,
      vencimentoRestaurado: true,
    });

    const depois = await db.payment.findUniqueOrThrow({ where: { id: pagamento.id } });
    expect(depois.status).toBe('CANCELLED');
    expect(depois.cancelReason).toBe('lancado no aluno errado');
    expect(depois.cancelledByUserId).toBe(contexto.actorId);
    expect(depois.cancelledAt?.toISOString()).toBe(AGORA.toISOString());
    // A trilha de quem lancou NAO some.
    expect(depois.recognizedByUserId).toBe(contexto.actorId);
    expect(depois.paidAt).not.toBeNull();

    const reaberta = await invoiceDe(subscriptionId, '2026-10');
    expect(reaberta.status).toBe('OPEN');
    expect(reaberta.paidAt).toBeNull();

    // Nov volta ao padrao do ciclo: dia 9, bloqueio +3 dias de carencia.
    const seguinte = await invoiceDe(subscriptionId, '2026-11');
    expect(seguinte.dueAt.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(seguinte.blockAt?.toISOString()).toBe('2026-11-12T00:00:00.000Z');

    const auditoria = await db.auditLog.findFirst({
      where: { tenantId: contexto.tenantId, action: 'billing.payment.cancelled', targetId: pagamento.id },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.actorId).toBe(contexto.actorId);

    const evento = await db.outboxEvent.findFirst({
      where: { tenantId: contexto.tenantId, eventType: 'PaymentCancelled', aggregateId: pagamento.id },
    });
    expect(evento).not.toBeNull();
  });

  it('nao toca em entitlement nem em assinatura (regra 1: acesso segue o entitlement)', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    await cancelarPagamento(pagamento.id);

    const assinatura = await db.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(assinatura.status).toBe('ACTIVE');
  });

  it('nao sobrescreve o vencimento da seguinte quando ele foi alterado por outra via', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    const seguinte = await invoiceDe(subscriptionId, '2026-11');
    await db.invoice.update({
      where: { id: seguinte.id },
      data: { dueAt: new Date('2026-11-20T00:00:00Z') },
    });

    const resultado = await cancelarPagamento(pagamento.id);

    expect(resultado.vencimentoRestaurado).toBe(false);
    expect((await invoiceDe(subscriptionId, '2026-11')).dueAt.toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });

  it('lote de dois meses: cancelar um nao toca nos irmaos e so devolve o vencimento quando o lote inteiro foi desfeito', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10', '2026-11']);
    const pagamentoOut = await pagamentoDe(subscriptionId, '2026-10');
    const pagamentoNov = await pagamentoDe(subscriptionId, '2026-11');

    // Pre-condicao: dez ancorado em 05/10 + 60 dias.
    expect((await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString()).toBe('2026-12-04T00:00:00.000Z');

    const primeiro = await cancelarPagamento(pagamentoNov.id);

    expect(primeiro.vencimentoRestaurado).toBe(false);
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
    expect((await invoiceDe(subscriptionId, '2026-11')).status).toBe('OPEN');
    expect((await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString()).toBe('2026-12-04T00:00:00.000Z');

    const segundo = await cancelarPagamento(pagamentoOut.id);

    expect(segundo.vencimentoRestaurado).toBe(true);
    expect((await invoiceDe(subscriptionId, '2026-12')).dueAt.toISOString()).toBe('2026-12-09T00:00:00.000Z');
  });

  it('expira o credito de sobrepagamento ainda disponivel', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10'], 12000);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    const antes = await db.accountCredit.findFirstOrThrow({ where: { originPaymentId: pagamento.id } });
    expect(antes.status).toBe('AVAILABLE');
    expect(antes.amountMinor).toBe(2000);

    await cancelarPagamento(pagamento.id);

    const depois = await db.accountCredit.findUniqueOrThrow({ where: { id: antes.id } });
    expect(depois.status).toBe('EXPIRED');
  });

  it('recusa quando o credito ja abateu outra fatura e deixa TUDO como estava', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10'], 12000);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await db.accountCredit.updateMany({
      where: { originPaymentId: pagamento.id },
      data: { status: 'APPLIED' },
    });

    await expect(cancelarPagamento(pagamento.id)).rejects.toBeInstanceOf(CreditoJaAplicadoError);

    expect((await db.payment.findUniqueOrThrow({ where: { id: pagamento.id } })).status).toBe('CONFIRMED');
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
  });

  it('recusa PIX: o caminho dele e o estorno', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const invoice = await invoiceDe(subscriptionId, '2026-10');
    const pix = await db.payment.create({
      data: {
        tenantId: contexto.tenantId,
        invoiceId: invoice.id,
        amountMinor: 10000,
        method: 'PIX',
        status: 'CONFIRMED',
        paidAt: AGORA,
      },
    });

    await expect(cancelarPagamento(pix.id)).rejects.toBeInstanceOf(PagamentoNaoCancelavelError);
  });

  it('recusa o segundo cancelamento do mesmo pagamento', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await cancelarPagamento(pagamento.id);

    await expect(cancelarPagamento(pagamento.id)).rejects.toBeInstanceOf(PagamentoNaoCancelavelError);
  });

  it('recusa motivo curto sem mudar nada', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    await expect(cancelarPagamento(pagamento.id, 'ab')).rejects.toBeInstanceOf(CancelamentoInvalidoError);

    expect((await db.payment.findUniqueOrThrow({ where: { id: pagamento.id } })).status).toBe('CONFIRMED');
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
  });

  it('pagamento de outro tenant ou inexistente: 404', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    await expect(
      cancelar.executar(
        { ...contexto, tenantId: outroTenantId },
        { paymentId: pagamento.id, reason: 'tentativa cruzada', agora: AGORA },
        'corr',
      ),
    ).rejects.toBeInstanceOf(PagamentoNaoEncontradoParaCancelamentoError);

    await expect(cancelarPagamento(randomUUID())).rejects.toBeInstanceOf(
      PagamentoNaoEncontradoParaCancelamentoError,
    );
  });

  it('corrida: dois cancelamentos simultaneos -- exatamente um vence, o outro e recusado', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');

    const resultados = await Promise.allSettled([
      cancelarPagamento(pagamento.id, 'clique um'),
      cancelarPagamento(pagamento.id, 'clique dois'),
    ]);

    const vencedores = resultados.filter((r) => r.status === 'fulfilled');
    const perdedores = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    // O INVARIANTE, nao a classe do erro: o perdedor pode cair na checagem
    // inicial ou na barreira condicionada, e as duas sao respostas validas.
    expect(vencedores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);
    expect((perdedores[0]!.reason as { code?: string }).code).toBe('BILLING_PAYMENT_NOT_CANCELLABLE');
    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('OPEN');
  });

  it('o mes reaberto pode ser pago de novo pelo mesmo caminho do lote', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await cancelarPagamento(pagamento.id);

    await pagarLote(subscriptionId, ['2026-10']);

    expect((await invoiceDe(subscriptionId, '2026-10')).status).toBe('PAID');
    const pagamentos = await db.payment.findMany({
      where: { invoiceId: pagamento.invoiceId },
      orderBy: { createdAt: 'asc' },
    });
    expect(pagamentos.map((p) => p.status)).toEqual(['CANCELLED', 'CONFIRMED']);
  });

  it('a grade do aluno nao lista o pagamento cancelado', async () => {
    const { studentId, subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    await cancelarPagamento(pagamento.id);

    const { invoices } = await billing.listarInvoicesDoAluno(contexto, studentId);
    const outubro = invoices.find((i) => i.id === pagamento.invoiceId);

    expect(outubro?.status).toBe('OPEN');
    expect(outubro?.payments).toHaveLength(0);
  });

  it('recibo ja emitido do pagamento cancelado nao e reemitido nem consultado', async () => {
    const { subscriptionId } = await novaAssinatura();
    await pagarLote(subscriptionId, ['2026-10']);
    const pagamento = await pagamentoDe(subscriptionId, '2026-10');
    const emitido = await recibo.executar(contexto, { paymentId: pagamento.id, agora: AGORA });

    await cancelarPagamento(pagamento.id);

    await expect(recibo.executar(contexto, { paymentId: pagamento.id, agora: AGORA })).rejects.toBeInstanceOf(
      PagamentoCanceladoError,
    );
    await expect(recibo.consultar(contexto, emitido.receiptId)).rejects.toBeInstanceOf(PagamentoCanceladoError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/api`, com o banco de teste já migrado na Task 2):
`node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --testPathPattern billing-cancelar-pagamento-manual --maxWorkers=1`
Expected: FAIL — `Cannot find module '.../cancelar-pagamento-manual.use-case.js'`.

- [ ] **Step 3: Implementar o caso de uso**

Criar `apps/api/src/modules/billing/cancelar-pagamento-manual.use-case.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import { ConfiguracaoFinanceiraAusenteError } from './billing.repository.js';
import { instanteDeBloqueio, proximoVencimento } from './domain/ciclo-de-cobranca.js';
import {
  CreditoJaAplicadoError,
  PagamentoNaoCancelavelError,
  deveRestaurarVencimento,
  validarCancelamento,
} from './domain/cancelamento-de-pagamento.js';
import { TransicaoDeInvoiceConcorrenteError } from './domain/invoice.js';

/**
 * Cancelamento de pagamento MANUAL lancado por engano. F85, decisao do PI em
 * 05/10/2026 (`docs/superpowers/specs/2026-10-05-cancelar-pagamento-manual-design.md`).
 *
 * EMENDA DO INV-069 so para pagamento `MANUAL`: a fatura volta de `PAID` para
 * `OPEN` e o aluno volta a dever o mes. A linha do `Payment` NAO e apagada --
 * vira `CANCELLED` com autor, data e motivo, que e a trilha que o ADR-027
 * exige para dinheiro reconhecido sem provedor.
 *
 * O QUE NAO FAZ, DE PROPOSITO: nao toca em `Entitlement` nem em `Subscription`
 * (regra de arquitetura nº 1). A fatura reaberta entra no fluxo normal de
 * inadimplencia e so bloqueia quando passar de `blockAt` -- cancelar nao
 * derruba o acesso de ninguem na hora.
 *
 * Tudo numa transacao so: ou o pagamento, a fatura, o credito, o vencimento, a
 * auditoria e o evento mudam juntos, ou nada muda.
 */

export class PagamentoNaoEncontradoParaCancelamentoError extends ErroDeDominio {
  constructor() {
    super('PAYMENT_NOT_FOUND', 404, 'pagamento nao encontrado');
  }
}

export interface PagamentoCancelado {
  readonly paymentId: string;
  readonly invoiceId: string;
  /** A fatura seguinte voltou ao vencimento padrao do ciclo? */
  readonly vencimentoRestaurado: boolean;
}

interface PagamentoLido {
  readonly id: string;
  readonly invoiceId: string;
  readonly method: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly paidAt: Date | null;
  readonly receivedVia: string | null;
  readonly batchId: string | null;
  readonly invoice: { readonly subscriptionId: string; readonly billingPeriod: Date };
}

@Injectable()
export class CancelarPagamentoManualUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(
    contexto: TenantContext,
    entrada: { paymentId: string; reason: string; agora: Date },
    correlationId: string,
  ): Promise<PagamentoCancelado> {
    const pagamento = await this.db.payment.findFirst({
      where: { id: entrada.paymentId, tenantId: contexto.tenantId },
      select: {
        id: true,
        invoiceId: true,
        method: true,
        status: true,
        amountMinor: true,
        paidAt: true,
        receivedVia: true,
        batchId: true,
        invoice: { select: { subscriptionId: true, billingPeriod: true } },
      },
    });

    if (!pagamento) {
      throw new PagamentoNaoEncontradoParaCancelamentoError();
    }

    validarCancelamento(pagamento, entrada.reason);

    const motivo = entrada.reason.trim();

    return this.db.$transaction(async (tx) => {
      const creditoUsado = await tx.accountCredit.findFirst({
        where: { tenantId: contexto.tenantId, originPaymentId: pagamento.id, status: 'APPLIED' },
        select: { id: true },
      });

      if (creditoUsado) {
        throw new CreditoJaAplicadoError();
      }

      /**
       * TRANSICAO CONDICIONADA, nao `update`: dois cancelamentos simultaneos
       * (duplo clique) leem ambos `CONFIRMED`; o filtro de status garante que
       * so UM move o pagamento. O outro recebe `count = 0` e a transacao
       * inteira desfaz -- mesma tecnica de `registrarPagamentoManual`.
       */
      const cancelado = await tx.payment.updateMany({
        where: { id: pagamento.id, tenantId: contexto.tenantId, method: 'MANUAL', status: 'CONFIRMED' },
        data: {
          status: 'CANCELLED',
          cancelledAt: entrada.agora,
          cancelledByUserId: contexto.actorId,
          cancelReason: motivo,
        },
      });

      if (cancelado.count !== 1) {
        throw new PagamentoNaoCancelavelError('pagamento ja foi cancelado ou alterado por outra operacao');
      }

      const reaberta = await tx.invoice.updateMany({
        where: { id: pagamento.invoiceId, tenantId: contexto.tenantId, status: 'PAID' },
        data: { status: 'OPEN', paidAt: null, version: { increment: 1 } },
      });

      if (reaberta.count !== 1) {
        throw new TransicaoDeInvoiceConcorrenteError(pagamento.invoiceId);
      }

      await tx.accountCredit.updateMany({
        where: { tenantId: contexto.tenantId, originPaymentId: pagamento.id, status: 'AVAILABLE' },
        data: { status: 'EXPIRED' },
      });

      const vencimentoRestaurado = await this.restaurarVencimentoDaSeguinte(tx, contexto, pagamento);

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'PaymentCancelled',
          aggregateType: 'Payment',
          aggregateId: pagamento.id,
          payload: {
            invoiceId: pagamento.invoiceId,
            amountMinor: pagamento.amountMinor,
            vencimentoRestaurado,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.payment.cancelled',
          target: 'Payment',
          targetId: pagamento.id,
          correlationId,
          metadata: {
            invoiceId: pagamento.invoiceId,
            amountMinor: pagamento.amountMinor,
            reason: motivo,
            receivedVia: pagamento.receivedVia,
            invoiceVencimentoRestaurado: vencimentoRestaurado,
          },
        },
      });

      return { paymentId: pagamento.id, invoiceId: pagamento.invoiceId, vencimentoRestaurado };
    });
  }

  /**
   * Devolve a fatura seguinte ao vencimento do ciclo SE o lote que a
   * empurrou foi desfeito por inteiro e a data ainda e a que ele gravou
   * (`deveRestaurarVencimento`). So pagamento em lote ancora vencimento --
   * o avulso (`batchId` nulo) nunca mexeu em fatura nenhuma.
   *
   * A "seguinte" e a primeira `OPEN`/`OVERDUE` com competencia POSTERIOR a
   * maior do lote: as do proprio lote acabaram de reabrir e nao contam.
   */
  private async restaurarVencimentoDaSeguinte(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    pagamento: PagamentoLido,
  ): Promise<boolean> {
    if (pagamento.batchId === null || pagamento.paidAt === null) {
      return false;
    }

    // Le DENTRO da transacao: este pagamento ja aparece como `CANCELLED`.
    const lote = await tx.payment.findMany({
      where: { tenantId: contexto.tenantId, batchId: pagamento.batchId },
      select: { status: true, invoice: { select: { billingPeriod: true } } },
    });

    const ultimaCompetencia = lote.reduce(
      (maior, p) => (p.invoice.billingPeriod.getTime() > maior.getTime() ? p.invoice.billingPeriod : maior),
      pagamento.invoice.billingPeriod,
    );

    const seguinte = await tx.invoice.findFirst({
      where: {
        tenantId: contexto.tenantId,
        subscriptionId: pagamento.invoice.subscriptionId,
        billingPeriod: { gt: ultimaCompetencia },
        status: { in: ['OPEN', 'OVERDUE'] },
      },
      orderBy: { billingPeriod: 'asc' },
      select: { id: true, dueAt: true, billingPeriod: true },
    });

    if (!seguinte) {
      return false;
    }

    const restaurar = deveRestaurarVencimento({
      dueAtAtual: seguinte.dueAt,
      paidAt: pagamento.paidAt,
      tamanhoDoLote: lote.length,
      confirmadosRestantesNoLote: lote.filter((p) => p.status === 'CONFIRMED').length,
    });

    if (!restaurar) {
      return false;
    }

    const configuracao = await tx.billingSettings.findUnique({
      where: { tenantId: contexto.tenantId },
      select: { dueDay: true, graceDays: true },
    });

    if (!configuracao) {
      throw new ConfiguracaoFinanceiraAusenteError();
    }

    const dueAt = proximoVencimento(seguinte.billingPeriod, configuracao.dueDay);

    await tx.invoice.update({
      where: { id: seguinte.id },
      data: {
        dueAt,
        blockAt: instanteDeBloqueio(dueAt, configuracao.graceDays),
        version: { increment: 1 },
      },
    });

    return true;
  }
}
```

- [ ] **Step 4: Registrar no módulo**

Em `apps/api/src/modules/billing/billing.module.ts`:
- adicionar `import { CancelarPagamentoManualUseCase } from './cancelar-pagamento-manual.use-case.js';` junto dos outros imports de casos de uso;
- adicionar `CancelarPagamentoManualUseCase,` na lista `providers`, logo depois de `RegistrarPagamentoEmLoteUseCase,`.

- [ ] **Step 5: Expor a rota**

Em `apps/api/src/modules/billing/billing.controller.ts`:

1. Import (junto dos outros use cases): `import { CancelarPagamentoManualUseCase } from './cancelar-pagamento-manual.use-case.js';`
2. Schema Zod, logo antes de `const esquemaDeLiberacao`:

```ts
/**
 * Cancelamento de pagamento manual (F85). `.strict()` como todo esquema deste
 * controller; motivo obrigatorio com o mesmo piso do pagamento manual -- sem
 * ele a auditoria mostra QUEM cancelou e nunca POR QUE.
 */
const esquemaDeCancelamento = z
  .object({
    reason: z.string().min(3).max(300),
  })
  .strict();
```

3. Construtor: acrescentar, antes de `private readonly contexto: TenantContextService,`:
   `private readonly cancelarPagamentoManual: CancelarPagamentoManualUseCase,`
4. Rota, logo depois do método `registrarPagamentoManual` (antes do comentário de `payable-months`):

```ts
  /**
   * Cancela pagamento MANUAL lancado por engano (F85, decisao do PI em
   * 05/10/2026): a fatura volta a aberta e o lancamento some da grade, com
   * motivo e autor na auditoria.
   *
   * Mesma permissao de `manual-payment`: quem recebe no balcao corrige o que
   * lancou errado. O controle e o motivo obrigatorio e a trilha -- detectivo,
   * nao preventivo, como o proprio lancamento (ADR-027, consequencia 3).
   */
  @Post('payments/:id/cancel')
  @RequirePermissions('billing.payment.manual')
  @HttpCode(200)
  async cancelarPagamento(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<PagamentoCancelado> {
    const dados = esquemaDeCancelamento.parse(corpo);

    return this.cancelarPagamentoManual.executar(
      this.contexto.require(),
      { paymentId: id, reason: dados.reason, agora: new Date() },
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }
```

   e importar o tipo: `import { CancelarPagamentoManualUseCase, type PagamentoCancelado } from './cancelar-pagamento-manual.use-case.js';` (uma linha só, no lugar do import do passo 1).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @arenahub/api typecheck`
Expected: sem erros.

- [ ] **Step 7: Rodar os testes de integração**

Run (de `apps/api`): `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --testPathPattern billing-cancelar-pagamento-manual --maxWorkers=1`
Expected: todos PASS **exceto** os dois últimos (`a grade do aluno…` e `recibo ja emitido…`), que dependem da Task 4 — se falharem agora, é esperado. Qualquer outro vermelho é defeito desta tarefa.

- [ ] **Step 8: Canários de mutação (provar que os testes pegam)**

Para cada item, aplicar, rodar o arquivo de teste e confirmar que **ao menos um teste cai**; depois desfazer (`git checkout -- apps/api/src/modules/billing/cancelar-pagamento-manual.use-case.ts`):
1. Remover `status: 'PAID'` do `where` do `invoice.updateMany` → um teste de estado da fatura/corrida deve cair.
2. Remover `status: 'CONFIRMED'` do `where` do `payment.updateMany` → o teste "segundo cancelamento" ou "corrida" deve cair.
3. Trocar `lote.filter((p) => p.status === 'CONFIRMED').length` por `0` → "lote de dois meses" deve cair.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/billing/cancelar-pagamento-manual.use-case.ts apps/api/src/modules/billing/billing.module.ts apps/api/src/modules/billing/billing.controller.ts apps/api/test/integration/billing-cancelar-pagamento-manual.int-spec.ts
git commit -m "feat: cancelar pagamento manual lancado errado (refs #<issue>)"
```

---

### Task 4: Leituras — grade esconde cancelado, recibo recusa

**Files:**
- Modify: `apps/api/src/modules/billing/billing.repository.ts` (`listarInvoicesDoAluno`, ~linha 501)
- Modify: `apps/api/src/modules/billing/emitir-recibo.use-case.ts` (`executar` ~linha 71 e `consultar` ~linha 182)
- Test: os dois últimos casos de `billing-cancelar-pagamento-manual.int-spec.ts` (já escritos na Task 3)

**Interfaces:**
- Consumes (Task 1): `PagamentoCanceladoError`.
- Produces: `listarInvoicesDoAluno` devolve `payments` sem os `CANCELLED`; `EmitirReciboUseCase.executar`/`consultar` rejeitam com `PagamentoCanceladoError`.

- [ ] **Step 1: Confirmar os dois testes vermelhos**

Run (de `apps/api`): `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --testPathPattern billing-cancelar-pagamento-manual --maxWorkers=1 -t "grade do aluno|recibo ja emitido"`
Expected: FAIL nos dois (a grade ainda lista o cancelado; o recibo ainda é devolvido).

- [ ] **Step 2: Grade esconde pagamento cancelado**

Em `billing.repository.ts`, no `findMany` de `listarInvoicesDoAluno`, trocar

```ts
      include: { items: true, payments: true },
```

por

```ts
      include: {
        items: true,
        /*
         * A GRADE nunca mostra pagamento CANCELADO (F85): para a recepcao o
         * lancamento errado "some" e a fatura reaparece em aberto. A linha
         * continua no banco, com autor e motivo, e `timelineDaInvoice` (a
         * trilha de auditoria) segue devolvendo tudo.
         *
         * `orderBy` explicito: sem ele a ordem das linhas filhas muda depois
         * de um UPDATE -- justamente o que acabamos de fazer no pagamento.
         */
        payments: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } },
      },
```

- [ ] **Step 3: Recibo recusa pagamento cancelado**

Em `emitir-recibo.use-case.ts`:

1. Import: `import { PagamentoCanceladoError } from './domain/cancelamento-de-pagamento.js';`
2. Em `executar`, no `findFirst` do recibo existente, incluir o status do pagamento e recusar:

```ts
    const existente = await this.db.receipt.findFirst({
      where: { tenantId: contexto.tenantId, paymentId: entrada.paymentId },
      select: {
        id: true,
        number: true,
        verificationHash: true,
        snapshot: true,
        payment: { select: { status: true } },
      },
    });

    if (existente) {
      // F85: o recibo de um pagamento CANCELADO nao circula -- o recebimento
      // nao vale mais. Sem esta checagem o ramo "existente" devolvia o papel.
      if (existente.payment.status === 'CANCELLED') {
        throw new PagamentoCanceladoError();
      }

      return {
        receiptId: existente.id,
        numero: existente.number,
        verificationHash: existente.verificationHash,
        snapshot: existente.snapshot as unknown as SnapshotDoRecibo,
      };
    }
```

   (O ramo de emissão nova já recusa: `PENDING/CANCELLED` caem em `PagamentoNaoConfirmadoParaReciboError`.)
3. Em `consultar`, mesma ideia:

```ts
    const recibo = await this.db.receipt.findFirst({
      where: { id: receiptId, tenantId: contexto.tenantId },
      select: {
        id: true,
        number: true,
        verificationHash: true,
        snapshot: true,
        payment: { select: { status: true } },
      },
    });

    if (!recibo) {
      throw new ReciboNaoEncontradoError();
    }

    if (recibo.payment.status === 'CANCELLED') {
      throw new PagamentoCanceladoError();
    }
```

- [ ] **Step 4: Typecheck + testes**

Run: `pnpm --filter @arenahub/api typecheck`
Run (de `apps/api`): `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --testPathPattern "billing-cancelar-pagamento-manual|billing" --maxWorkers=1`
Expected: o arquivo novo inteiro PASS e nenhuma regressão nas outras suítes `billing*` (o `payments` da grade agora filtra, e nenhuma delas cria pagamento `CANCELLED`).

- [ ] **Step 5: Verificar os outros leitores de `Payment`**

Run: `grep -rn "payment\.\(findMany\|aggregate\|groupBy\)" apps/api/src --include=*.ts | grep -v scripts`
Expected: `consultar-resumo-financeiro.use-case.ts` filtra `status: 'CONFIRMED'` nas 3 consultas (cancelado fica fora sozinho) e `conciliar-movimentos.use-case.ts` filtra `['CONFIRMED','REFUNDED']`. Se aparecer leitor novo que some pagamento sem filtrar status, tratar aqui e acrescentar teste.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing/billing.repository.ts apps/api/src/modules/billing/emitir-recibo.use-case.ts
git commit -m "feat: grade esconde pagamento cancelado e recibo dele nao circula (refs #<issue>)"
```

---

### Task 5: Tela — botão, diálogo com motivo e Server Action

**Files:**
- Modify: `apps/admin-web/app/actions/billing.ts` (mensagens + `cancelarPagamento`)
- Create: `apps/admin-web/app/(protected)/students/[id]/billing/cancelar-pagamento.tsx`
- Create: `apps/admin-web/app/(protected)/students/[id]/billing/cancelar-pagamento.module.css`
- Modify: `apps/admin-web/app/(protected)/students/[id]/billing/page.tsx` (renderizar o botão na coluna Recebimento)
- Test: `apps/admin-web/app/(protected)/students/[id]/billing/cancelar-pagamento.test.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/payments/:id/cancel` (Task 3); `ConfirmDialog`, `Button`, `Icon`, `useToast` de `@arenahub/ui`; `formatarMesAno(competencia: string)` de `src/billing/meses-pagaveis`.
- Produces: `cancelarPagamento(paymentId: string, reason: string): Promise<EstadoDoCancelamento>` onde `EstadoDoCancelamento = { erro?: string; sucesso?: true }`; componente `CancelarPagamento({ paymentId: string; resumo: string })`.

- [ ] **Step 1: Escrever o teste do componente (falha)**

Criar `apps/admin-web/app/(protected)/students/[id]/billing/cancelar-pagamento.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@arenahub/ui';

import { cancelarPagamento } from '../../../../actions/billing';
import { CancelarPagamento } from './cancelar-pagamento';

/**
 * F85 -- botao "Cancelar pagamento" da coluna Recebimento.
 *
 * `cancelarPagamento` e Server Action: o componente so precisa provar que a
 * CHAMA com o id e o motivo digitado, e que o resultado vira toast. A rota de
 * rede e teste de integracao/E2E. `HTMLDialogElement.showModal` nao existe no
 * jsdom, entao o `ConfirmDialog` e exercitado pelo conteudo que ele monta.
 */
vi.mock('../../../../actions/billing', () => ({
  cancelarPagamento: vi.fn(),
}));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

function renderizar() {
  return render(
    <ToastProvider>
      <CancelarPagamento paymentId="pag-1" resumo="nov/26, Dinheiro" />
    </ToastProvider>,
  );
}

describe('CancelarPagamento', () => {
  beforeEach(() => {
    vi.mocked(cancelarPagamento).mockReset();
    refresh.mockClear();
    // jsdom nao implementa <dialog>.showModal/close.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('abre o dialogo com o resumo e exige motivo antes de chamar a acao', () => {
    renderizar();

    fireEvent.click(screen.getByTestId('cancelar-pagamento'));

    expect(screen.getByText(/nov\/26, Dinheiro/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirmar-acao-sensivel'));

    expect(cancelarPagamento).not.toHaveBeenCalled();
    expect(screen.getByText(/Escreva o motivo/)).toBeInTheDocument();
  });

  it('chama a acao com o id e o motivo, avisa por toast e recarrega a pagina', async () => {
    vi.mocked(cancelarPagamento).mockResolvedValue({ sucesso: true });
    renderizar();

    fireEvent.click(screen.getByTestId('cancelar-pagamento'));
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'lancei no aluno errado' } });
    fireEvent.click(screen.getByTestId('confirmar-acao-sensivel'));

    await waitFor(() => expect(cancelarPagamento).toHaveBeenCalledWith('pag-1', 'lancei no aluno errado'));
    await waitFor(() => expect(screen.getByTestId('pagamento-cancelado')).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it('mostra o erro da API em toast e NAO recarrega', async () => {
    vi.mocked(cancelarPagamento).mockResolvedValue({ erro: 'Este pagamento não pode ser cancelado.' });
    renderizar();

    fireEvent.click(screen.getByTestId('cancelar-pagamento'));
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'motivo valido' } });
    fireEvent.click(screen.getByTestId('confirmar-acao-sensivel'));

    await waitFor(() => expect(screen.getByTestId('erro-ao-cancelar-pagamento')).toBeInTheDocument());
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/admin-web exec vitest run "cancelar-pagamento"`
Expected: FAIL — módulo `./cancelar-pagamento` não existe.

- [ ] **Step 3: Server Action + mensagens**

Em `apps/admin-web/app/actions/billing.ts`:

1. No objeto `MENSAGEM`, antes do `};` de fechamento, acrescentar:

```ts
  PAYMENT_NOT_FOUND: 'Pagamento não encontrado nesta academia.',
  BILLING_PAYMENT_NOT_CANCELLABLE:
    'Este pagamento não pode ser cancelado por aqui — já foi cancelado ou não é um recebimento manual.',
  BILLING_CREDIT_ALREADY_APPLIED:
    'O crédito gerado por este pagamento já foi usado em outra cobrança. Peça ao gerente para tratar o caso.',
  BILLING_INVALID_CANCEL: 'Descreva o motivo do cancelamento (mínimo de 3 caracteres).',
  BILLING_INVOICE_ALREADY_SETTLED:
    'Esta cobrança mudou desde que a tela carregou. Atualize a página e confira.',
```

2. No fim do arquivo, acrescentar:

```ts
export interface EstadoDoCancelamento {
  erro?: string;
  sucesso?: true;
}

const esquemaDeCancelamento = z.object({
  paymentId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo — a auditoria depende disso')
    .max(300, 'Motivo longo demais'),
});

/**
 * Cancela um pagamento MANUAL lancado por engano -- `POST
 * /payments/:id/cancel` (F85, decisao do PI em 05/10/2026).
 *
 * A fatura volta a aberta e o lancamento some da grade; a API grava autor e
 * motivo na auditoria. Mesma permissao do lancamento (`billing.payment.manual`):
 * quem recebe no balcao corrige o que lancou errado.
 *
 * Recebe `(paymentId, reason)` direto, e nao `FormData`: quem chama e o
 * `ConfirmDialog`, que ja entrega o motivo validado -- nao ha formulario.
 */
export async function cancelarPagamento(
  paymentId: string,
  reason: string,
): Promise<EstadoDoCancelamento> {
  const analisado = esquemaDeCancelamento.safeParse({ paymentId, reason });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ paymentId: string }>(
    `/api/v1/payments/${analisado.data.paymentId}/cancel`,
    { metodo: 'POST', corpo: { reason: analisado.data.reason } },
  );

  if (!resposta.ok) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível cancelar o pagamento.') };
  }

  revalidatePath('/billing');

  return { sucesso: true };
}
```

- [ ] **Step 4: Componente e CSS**

Criar `apps/admin-web/app/(protected)/students/[id]/billing/cancelar-pagamento.module.css`:

```css
/* Acao discreta na celula de recebimento -- so camada semantica (regra 2 de lint). */
.acao {
  margin-inline-start: 4px;
}

.acao button {
  min-height: 24px;
  padding-inline: 8px;
  font-size: var(--ah-type-caption-size);
  line-height: var(--ah-type-caption-lh);
  color: var(--ah-text-muted);
}

.acao button:hover:not(:disabled) {
  color: var(--ah-state-danger);
}
```

Criar `apps/admin-web/app/(protected)/students/[id]/billing/cancelar-pagamento.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button, ConfirmDialog, Icon, useToast } from '@arenahub/ui';

import { cancelarPagamento } from '../../../../actions/billing';
import estilos from './cancelar-pagamento.module.css';

interface Props {
  readonly paymentId: string;
  /** "nov/26, Dinheiro" -- o que a recepcao reconhece como SEU lancamento. */
  readonly resumo: string;
}

/**
 * Cancelar um pagamento manual lancado por engano -- F85, decisao do PI em
 * 05/10/2026.
 *
 * O `ConfirmDialog` ja entrega o que a regra pede: resumo do efeito, motivo
 * OBRIGATORIO e verbo real no botao ("Cancelar pagamento", nunca "OK"). O
 * resumo diz o que ninguem adivinharia da palavra: a cobranca volta a ficar em
 * aberto, entao o aluno volta a dever o mes ate alguem lancar o certo.
 *
 * Resultado em TOAST, nunca `Alert` (CLAUDE.md). Sucesso recarrega a pagina:
 * o pagamento some da coluna e a faixa de meses volta a oferecer o mes.
 */
export function CancelarPagamento({ paymentId, resumo }: Props) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const confirmar = (motivo: string): void => {
    setAberto(false);

    iniciar(async () => {
      const resultado = await cancelarPagamento(paymentId, motivo);

      if (resultado.erro !== undefined) {
        show('error', resultado.erro, 'erro-ao-cancelar-pagamento');

        return;
      }

      show(
        'info',
        'Pagamento cancelado. A cobrança voltou a ficar em aberto.',
        'pagamento-cancelado',
      );
      router.refresh();
    });
  };

  return (
    <span className={estilos['acao']}>
      <Button
        variant="ghost"
        type="button"
        disabled={pendente}
        onClick={() => setAberto(true)}
        data-testid="cancelar-pagamento"
      >
        <Icon name="x-circle" />
        Cancelar
      </Button>

      <ConfirmDialog
        open={aberto}
        verb="Cancelar pagamento"
        summary={`Cancelar o recebimento de ${resumo}. A cobrança volta a ficar em aberto e o aluno volta a dever o mês até alguém lançar o pagamento certo. O registro do cancelamento fica na auditoria.`}
        onConfirm={confirmar}
        onCancel={() => setAberto(false)}
        testId="confirmar-cancelamento"
      />
    </span>
  );
}
```

- [ ] **Step 5: Ligar na grade**

Em `page.tsx`:

1. Import: `import { CancelarPagamento } from './cancelar-pagamento';` (junto de `import { Recebimento } from './recebimento';`).
2. Dentro do `render` da coluna `recebimento`, trocar o `<li>` por:

```tsx
                    <li key={pagamento.id}>
                      <Recebimento pagamento={pagamento} timezone={timezoneDaUnidade} />
                      {/*
                        So pagamento MANUAL confirmado: PIX e cartao se devolvem
                        pelo estorno, e a API recusaria. A grade ja nao recebe
                        pagamento CANCELADO (`listarInvoicesDoAluno`).
                      */}
                      {pagamento.method === 'MANUAL' && pagamento.status === 'CONFIRMED' ? (
                        <CancelarPagamento
                          paymentId={pagamento.id}
                          resumo={`${formatarMesAno(invoice.billingPeriod.slice(0, 7))}, ${rotuloDoCanal(pagamento.receivedVia)}`}
                        />
                      ) : null}
                    </li>
```

3. Acima de `export default async function`, acrescentar o helper (mesmos rótulos de `seletor-de-forma`):

```tsx
const ROTULO_DO_CANAL: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
};

/** Pagamento anterior ao registro de canal (`receivedVia` nulo) cai em "Dinheiro", como o `Recebimento`. */
function rotuloDoCanal(canal: string | null): string {
  return (canal !== null ? ROTULO_DO_CANAL[canal] : undefined) ?? 'Dinheiro';
}
```

(Conferir que o `FORMAS` de `seletor-de-forma.tsx` usa os mesmos rótulos; se divergirem, usar o dele em vez de duplicar.)

- [ ] **Step 6: Rodar testes, typecheck e lint**

Run: `pnpm --filter @arenahub/admin-web exec vitest run "cancelar-pagamento"` → PASS (3 testes).
Run: `pnpm --filter @arenahub/admin-web typecheck && pnpm --filter @arenahub/admin-web lint`
Run (raiz): `pnpm test:guardas`
Expected: tudo verde (guarda de CSS recusa hex; `use-server` recusa export não-função — a action exporta só função e tipos).

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/app/actions/billing.ts "apps/admin-web/app/(protected)/students/[id]/billing/"
git commit -m "feat: botao de cancelar pagamento manual na grade do financeiro (refs #<issue>)"
```

---

### Task 6: E2E — cancelar e lançar o certo

**Files:**
- Create: `apps/admin-web/tests/e2e/cancelar-pagamento.e2e-spec.ts`

**Interfaces:**
- Consumes: testids da Task 5 (`cancelar-pagamento`, `confirmar-cancelamento`, `confirmar-acao-sensivel`, `pagamento-cancelado`) e os existentes (`forma-dinheiro`, `tabela-de-cobrancas`, `abrir-ficha`, `aba-plano`, `campo-plano`…).
- Produces: —

- [ ] **Step 1: Escrever o E2E**

Criar `apps/admin-web/tests/e2e/cancelar-pagamento.e2e-spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F85 -- a recepcao lanca um pagamento errado e o cancela pela tela.
 *
 * Mesmo andaime do golden path do lote (`pagamento-em-lote.e2e-spec.ts`):
 * aluno novo, plano do seed, vigencia relativa a agora. Aqui o aluno nao tem
 * mes vencido -- paga o MES CORRENTE (1 chip), cancela, e paga de novo.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const NOME_DO_PLANO_DO_SEED = 'Programa Adultos e Idosos';

let proximoCpf = 500;

function gerarCpfValido(): string {
  const base = String(100000000 + ((proximoCpf * 97) % 899999999)).padStart(9, '0');
  proximoCpf += 1;

  const digitos = base.split('').map(Number);
  const verificador = (ate: number, seq: number[]): number => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += seq[i]! * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = verificador(9, digitos);
  const d2 = verificador(10, [...digitos, d1]);

  return `${base}${d1}${d2}`;
}

function paraCampoDeData(data: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}T${pad(data.getUTCHours())}:${pad(data.getUTCMinutes())}`;
}

test('recepcao cancela pagamento lancado errado e lanca o certo', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await cadastrarAluno(page, {
    nome: `Aluno Cancela ${Date.now()}`,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
  const idDoAluno = page.url().split('/students/')[1]?.split('/')[0] ?? '';

  const agora = new Date();
  await page.getByTestId('aba-plano').click();
  await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();
  await page.getByTestId('campo-plano').selectOption({ label: NOME_DO_PLANO_DO_SEED });
  await page
    .getByTestId('campo-inicio')
    .fill(paraCampoDeData(new Date(Date.UTC(agora.getUTCFullYear() - 1, agora.getUTCMonth(), 1, 6, 0))));
  await page
    .getByTestId('campo-fim')
    .fill(paraCampoDeData(new Date(Date.UTC(agora.getUTCFullYear() + 5, agora.getUTCMonth(), 1, 22, 0))));
  await page.getByTestId('campo-motivo-atribuicao').fill('matricula para teste de cancelamento');
  await page.getByTestId('confirmar-atribuicao').click();
  await expect(page.getByTestId('plano-atribuido')).toBeVisible();

  await page.goto(`/students/${idDoAluno}/billing`);
  await expect(page.locator('#titulo-financeiro')).toContainText(/^Financeiro —/);

  // Paga so o mes corrente (selecao inicial: 1 chip) em dinheiro.
  await page.getByTestId('forma-dinheiro').click();
  await page.getByRole('button', { name: /^Receber$/ }).click();
  await expect(page.getByText(/1 mês recebido/i)).toBeVisible();

  const grade = page.getByTestId('tabela-de-cobrancas');
  await expect(grade.getByText('Paga')).toHaveCount(1);
  await expect(page.getByTestId('cancelar-pagamento')).toHaveCount(1);

  // Cancela com motivo.
  await page.getByTestId('cancelar-pagamento').click();
  await page.getByLabel(/Motivo/).fill('lancei no aluno errado');
  await page.getByTestId('confirmar-acao-sensivel').click();

  await expect(page.getByTestId('pagamento-cancelado')).toBeVisible();

  // A grade perdeu o lancamento e a cobranca voltou a aberta.
  await expect(grade.getByText('Paga')).toHaveCount(0);
  await expect(page.getByTestId('cancelar-pagamento')).toHaveCount(0);

  // E o mes volta a ser pagavel pelo mesmo caminho.
  await page.getByTestId('forma-dinheiro').click();
  await page.getByRole('button', { name: /^Receber$/ }).click();
  await expect(page.getByText(/1 mês recebido/i)).toBeVisible();
  await expect(grade.getByText('Paga')).toHaveCount(1);
});
```

- [ ] **Step 2: Subir o ambiente E2E e rodar**

Conferir antes que **nenhum Next de outra worktree/projeto ocupa a porta 3000** (`netstat -ano | findstr :3000` e o dono do PID — o E2E reutiliza o servidor existente e roda contra a árvore errada). Depois, com o banco E2E recriado (migration da Task 2 inclusa) e `.next` limpo:

Run (de `apps/admin-web`): `pnpm exec playwright test tests/e2e/cancelar-pagamento.e2e-spec.ts`
Expected: PASS. Se o texto "1 mês recebido" divergir do que a tela mostra, ajustar o seletor ao que `faixa-de-meses.tsx` realmente exibe (o lote usa `N meses recebidos`).

- [ ] **Step 3: Canário**

Plantar o defeito "grade não filtra cancelado" (reverter o `where` da Task 4), **rebuildar o `.next`**, rodar o E2E e confirmar que cai em `grade.getByText('Paga')).toHaveCount(0)`; desfazer e rebuildar.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/tests/e2e/cancelar-pagamento.e2e-spec.ts
git commit -m "test: e2e do cancelamento de pagamento manual (refs #<issue>)"
```

---

### Task 7: Documentação, issue e entrega

**Files:**
- Modify: `docs/DECISIONS.md` (ADR novo), `docs/CONVENTION.md` (INV-069/§3.4/§3.5), `docs/STATUS.md` (Índice Fatia ↔ SPEC), `docs/DEVELOPMENT.md`, `docs/TESTING.md`/`reports/TESTS.md` (via `pnpm test:report`)
- Create: `docs/specs/SPEC-085-cancelar-pagamento-manual.md` (ponteiro fino, a partir de `docs/specs/_TEMPLATE.md`)

**Interfaces:** —

- [ ] **Step 1: ADR**

Em `docs/DECISIONS.md`, acrescentar depois do último ADR (hoje o ADR-064) um **ADR-065** curto: *"Cancelamento de pagamento manual (F85): emenda do INV-069"*, registrando — decisão do PI em 05/10/2026; só pagamento `MANUAL`; `Payment.CANCELLED` com `cancelledAt/By/Reason`; fatura volta `PAID → OPEN`; a recepção cancela (`billing.payment.manual`), controle detectivo como no ADR-027; cancelar não toca em entitlement; PIX/cartão seguem só pelo estorno; realiza o "contra-lançamento auditado" do ADR-027 resposta 3. Confirmar o número livre com `grep -n "^## ADR-" docs/DECISIONS.md | tail -2`.

- [ ] **Step 2: CONVENTION.md**

Ajustar a linha do INV-069 (`docs/CONVENTION.md:403`) e §3.4/§3.5: `PAID → OPEN` só por cancelamento de pagamento **manual** (ADR-065); `Payment.CANCELLED` ganha esse significado para o manual.

- [ ] **Step 3: SPEC-085, STATUS e DEVELOPMENT**

- `docs/specs/SPEC-085-cancelar-pagamento-manual.md`: ponteiro fino (formato do `_TEMPLATE.md`) apontando para o desenho em `docs/superpowers/specs/2026-10-05-cancelar-pagamento-manual-design.md`.
- `docs/STATUS.md`: linha `F85 | SPEC-085 | … | Cancelar pagamento manual lançado errado | … | #<issue>` no Índice Fatia ↔ SPEC (formato das linhas F83/F84).
- `docs/DEVELOPMENT.md`: resumo da entrega no formato das fatias vizinhas.

- [ ] **Step 4: Gate local completo (5 comandos raiz) e relatório**

Run (raiz, com `--force` no lint para não ler cache do turbo): `pnpm lint --force`, `pnpm typecheck`, `pnpm test`, `pnpm test:guardas`, `pnpm build`.
Run: `pnpm test:report --issue <N> --spec F85` e conferir as duas medições da integração (o relatório herda o número antigo se o Jest cair no Windows).
Expected: tudo verde; `reports/TESTS.md` atualizado.

- [ ] **Step 5: Revisão de código**

Rodar a skill `/code-review` (e `/impeccable` + `frontend-design` para a parte de UI, como manda o `CLAUDE.md`) no diff da branch contra `main`; corrigir CRITICAL/HIGH antes do PR.

- [ ] **Step 6: PR e CI**

```bash
git branch -m feat/f85-cancelar-pagamento-manual
git push -u origin feat/f85-cancelar-pagamento-manual
gh pr create --title "feat: cancelar pagamento manual lançado errado (refs #<issue>)" --body "<resumo + decisões + o que não faz + link da spec>"
gh run watch <run-id> --exit-status   # em background; conferir job a job ao terminar
```

Avisar na conversa que a espera do CI é assíncrona e, se não houver notificação em ~3-5 min, fazer **uma** checagem (`gh pr checks <n>`). Com o CI verde, mergear, aplicar `proplan:done` com o link do PR na issue, atualizar o localhost (resubir na `main` com `.next`/`dist`/`tsbuildinfo` limpos) e perguntar ao PI se roda `/graphify . --update`.
