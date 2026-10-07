# Diária avulsa no balcão (F86) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recepção vende, num clique e na ficha do aluno sem plano, uma diária de R$ 30,00; o acesso só nasce junto do pagamento e vale até 23:59 do dia, sem poluir receita recorrente, inadimplência nem avisos.

**Architecture:** `Plan.billingMode` ganha `DIARIA`. Um caso de uso `VenderDiariaUseCase` (módulo `membership`) abre **uma transação** que cria assinatura `PENDING` + entitlement `SCHEDULED`, abre a invoice com vencimento na compra e registra o pagamento manual — é o pagamento que promove os dois para `ACTIVE` (`ativarDireitoDeAcessoSePendente`, que já existe). Tudo reaproveita `BillingRepository`, `MembershipRepository` e a trava `FOR UPDATE` do aluno.

**Tech Stack:** NestJS + Prisma 7 (Postgres), Zod, Jest (unit + integração com Postgres real), Next.js 16 (App Router, Server Actions), Vitest + Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md`](../specs/2026-10-07-diaria-avulsa-design.md) — o plano lê o spec; em conflito, o spec vence e é corrigido.

## Global Constraints

- **Dinheiro é inteiro na menor unidade** (R$ 30,00 = `3000`); nunca `float` nem `number` fracionário (regra 6, INV-065). Preço vem do `PlanPrice` vigente, nunca de constante.
- **`tenant_id` vem do `TenantContext`**, nunca do corpo (regra 2). Fuso é o da **unidade de origem do aluno**, sem fallback (INV-144, ADR-019).
- **Pagamento não controla acesso; entitlement controla** (regra 1). Aqui: entitlement só vira `ACTIVE` pela promoção do pagamento, dentro da mesma transação.
- **"Agora" entra por parâmetro** em toda função de cálculo e caso de uso (CLAUDE.md); só o controller chama `new Date()`.
- **Evento de domínio na mesma transação** (regra 5): reaproveitar `registrarDerivacao` e `publicarEvento`, sem publicar fora.
- **Erro de domínio com código estável** (`ErroDeDominio(code, status, title)`); resposta HTTP `application/problem+json`.
- **Sem `any` implícito; `unknown` antes de validar** dado externo (Zod no boundary).
- **UI:** textos em pt-BR, **Toast** (nunca `Alert`), datas só por `TenantDateTime`, sem hex literal (tokens do DS-PAINEL).
- **Idioma:** commits, docs e comunicação em PT-BR; identificadores seguem o código vizinho (métodos de domínio em português, códigos de erro em inglês `SCREAMING_SNAKE`).
- **PR:** `refs #N`, **nunca** `closes #N`. Mensagem de commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Prisma e testes só contra o Postgres descartável** da Task 0. **Nunca** rodar `prisma`/`jest` com o `DATABASE_URL` do `.env` (aponta para a produção) e nunca imprimir trecho do `.env`.
- **`pnpm test` não roda integração.** Integração: `jest --selectProjects integration --testPathPattern <arquivo>` (o `--selectProjects` sozinho engole o caminho e roda tudo).

## Review Focus

Entradas e condições que o spec sugere, nenhuma tarefa testa por padrão e que mais provavelmente quebram na recepção. Cada linha tem o teste na tarefa dona.

1. **Duas vendas ao mesmo tempo para o mesmo aluno** (duplo clique, duas recepções): uma passa, a outra recebe 409, um só pagamento existe. → Task 4.
2. **Pagamento recusado depois de criada a assinatura** (valor recebido menor que R$ 30,00; tenant sem configuração financeira): nada fica gravado, nem assinatura `PENDING`. → Task 4.
3. **Venda perto da meia-noite local** (23:59 e 00:00) e fuso inválido: o fim é a próxima meia-noite local, e fuso desconhecido falha em vez de cair em UTC. → Task 2.
4. **Plano de diária atribuído pelos caminhos antigos** (`POST /subscriptions`, trocar plano): daria acesso sem pagamento e com datas livres; precisa ser recusado. → Task 5.
5. **Aviso "plano vence em breve" para quem acabou de pagar a diária**, e diária inflando "alunos ativos", receita esperada e taxa de inadimplência. → Task 6.

---

### Task 0: Cards, número de fatia, branch e banco descartável

**Files:**
- Create: `docs/specs/SPEC-086-diaria-avulsa-no-balcao.md`
- Modify: `docs/STATUS.md` (Índice Fatia ↔ SPEC, depois da linha da F85)
- Create (git): branch `feat/f86-diaria-no-balcao`

**Interfaces:**
- Produces: número de issue `N86` (card da F86) e `N87` (card da F87). Os passos seguintes usam `#N86` nos commits.

- [ ] **Step 1: Conferir que F86/F87 e SPEC-086/087 seguem livres**

Run: `grep -rnE "\b(F86|F87|SPEC-086|SPEC-087)\b" docs apps packages --include=*.md --include=*.ts --include=*.tsx | grep -v "superpowers/specs/2026-10-07-diaria\|superpowers/plans/2026-10-07-diaria"`
Expected: nenhuma saída. Se houver, **pare**: o número foi reservado em prosa (memória: *número de fatia pode estar reservado*) e é preciso realocar.

- [ ] **Step 2: Criar os dois cards**

```bash
gh issue create --assignee RodReis --label proplan:backlog \
  --title "[MVP2][SPEC-086][F86] Diária avulsa no balcão: aluno sem plano paga R\$ 30,00 e usa no dia" \
  --body "Spec: docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md (§1–§8, §10). Decisões do PI de 07/10/2026 na §2 do spec."
gh issue create --assignee RodReis --label proplan:backlog \
  --title "[MVP2][SPEC-087][F87] Diária avulsa no totem (PIX QR) — liga quando a F55 liberar" \
  --body "Spec: docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md §9. Depende da F86 e da F55 (adapters reais)."
```
Expected: duas URLs `https://github.com/RodReis/arenahub/issues/<n>`. Anote os números como `N86` e `N87`.

- [ ] **Step 3: Pegar o card da F86**

```bash
gh issue edit 616 --remove-label proplan:backlog --add-label proplan:todo
git switch -c feat/f86-diaria-no-balcao
gh issue edit 616 --remove-label proplan:todo --add-label proplan:doing
```

- [ ] **Step 4: Criar `docs/specs/SPEC-086-diaria-avulsa-no-balcao.md` (ponteiro fino)**

```markdown
# SPEC-086 — Diária avulsa no balcão

| campo | valor |
|---|---|
| **Fatia** | F86 |
| **Slice do PRD** | não há. Nasce de pedido do PI em 07/10/2026 |
| **MVP** | 2 *(financeiro)* — decisão do PI, não Slice de PRD |
| **Superfície** | `apps/api` (`membership`, `billing`), `packages/database` e `apps/admin-web` (ficha do aluno) |
| **Plano de apoio** | [`2026-10-07-diaria-avulsa-balcao.md`](../superpowers/plans/2026-10-07-diaria-avulsa-balcao.md) |
| **Status** | `aprovada-pi` |
| **Criada em** | 2026-10-07 |
| **Aprovada pelo PI em** | 07/10/2026 (desenho aprovado em chat) |
| **Card** | [#616](https://github.com/RodReis/arenahub/issues/616) |

---

## 1. Objetivo em uma frase

A recepção vende, num clique, uma diária de R$ 30,00 a um aluno sem plano vigente; o acesso só existe
depois do pagamento registrado e vale até 23:59 do dia.

## 2. Onde mora o desenho

Esta spec é **ponteiro fino**: o escopo, as decisões do PI e os critérios estão em
[`docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md`](../superpowers/specs/2026-10-07-diaria-avulsa-design.md).
Nada é copiado para cá. A fatia seguinte, do totem, é a **F87 / SPEC-087** (§9 do mesmo documento) e
fica **sem spec própria** até a F55 liberar o PIX real.
```
Troque `616` pelo número real nas duas ocorrências.

- [ ] **Step 5: Alocar F86 e F87 no Índice do `docs/STATUS.md`**

Depois da linha que começa com `| F85 | SPEC-085 |` (hoje a linha 1067), insira:

```markdown
| F86 | SPEC-086 | 2 | — | Diária avulsa no balcão: aluno sem plano paga R$ 30,00 e usa no dia (acesso só depois do pagamento, até 23:59) | [`SPEC-086-diaria-avulsa-no-balcao.md`](specs/SPEC-086-diaria-avulsa-no-balcao.md) | [#616](https://github.com/RodReis/arenahub/issues/616) | 🚧 em andamento — decisão do PI em 07/10/2026 |
| F87 | SPEC-087 | 2 | — | Diária avulsa no totem (PIX QR): mesma venda da F86, ativada pelo webhook; limpa diária `PENDING` abandonada | — | [#617](https://github.com/RodReis/arenahub/issues/617) | ⏳ registrada — **depende da F55** (adapters reais), sem spec até lá |
```

- [ ] **Step 6: Subir o Postgres descartável (porta nova) e preparar o banco**

```bash
docker run -d --name arenahub-f86-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=f86-descartavel -e POSTGRES_DB=arenahub_f86_int \
  -e POSTGRES_INITDB_ARGS="--locale-provider=icu --icu-locale=pt-BR --encoding=UTF8 --locale=C" \
  -p 127.0.0.1:55486:5432 postgres:17-alpine
```
Aguarde ~5 s e confirme: `docker exec arenahub-f86-postgres pg_isready -U postgres` → `accepting connections`.

Exporte **no mesmo shell de cada comando seguinte** (o `.env` aponta para a produção):

```bash
export DATABASE_URL="postgresql://postgres:f86-descartavel@127.0.0.1:55486/arenahub_f86_int?schema=public"
export INTEGRATION_DATABASE_URL="$DATABASE_URL"
pnpm --filter @arenahub/database exec prisma migrate deploy
pnpm --filter @arenahub/database exec prisma generate
pnpm --filter @arenahub/database build
```
Expected: `All migrations have been successfully applied.` e build sem erro.

- [ ] **Step 7: Commit do spec, do plano e da alocação**

```bash
git add docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md docs/superpowers/plans/2026-10-07-diaria-avulsa-balcao.md docs/specs/SPEC-086-diaria-avulsa-no-balcao.md docs/STATUS.md
git commit -m "docs: spec, plano e numeração da diária avulsa (F86/F87) (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Modalidade `DIARIA` no schema, no catálogo e nos tipos

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (enum `PlanBillingMode`)
- Create: `packages/database/prisma/migrations/20261007140000_f86_plano_diaria/migration.sql`
- Modify: `packages/database/prisma/seed.ts` (plano `Diaria`)
- Modify: `apps/api/src/modules/membership/membership.controller.ts` (zod `billingMode`, `PlanoDto`)
- Modify: `apps/api/src/modules/membership/membership.repository.ts` (`DadosDeCriacaoDePlano.billingMode`)
- Modify: `apps/api/src/modules/billing/domain/assinatura-mensal.ts:25`
- Create: `apps/api/test/integration/helpers/cenario-de-diaria.ts`
- Create: `apps/api/test/integration/venda-de-diaria.int-spec.ts`

**Interfaces:**
- Produces (usado por todas as tasks seguintes):
  - `cenario-de-diaria.ts`:
    ```ts
    export const AGORA: Date;            // 2026-10-07T15:00:00.000Z = quarta 12:00 em America/Sao_Paulo
    export const FIM_DO_DIA: Date;       // 2026-10-08T03:00:00.000Z = quinta 00:00 em America/Sao_Paulo
    export const PRECO_DA_DIARIA_MINOR: 3000;
    export interface CenarioDeDiaria { sufixo: string; tenantId: string; actorId: string; unidadeId: string }
    export function contextoDe(c: CenarioDeDiaria): TenantContext;
    export function criarCenarioDeDiaria(db: PrismaService, senhas: PasswordService, opcoes?: { comConfiguracaoFinanceira?: boolean }): Promise<CenarioDeDiaria>;
    export function apagarCenario(db: PrismaService, c: CenarioDeDiaria): Promise<void>;
    export function criarPlano(db: PrismaService, c: CenarioDeDiaria, opcoes?: { nome?: string; billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA'; ativo?: boolean; amountMinor?: number; diasComJanela?: readonly number[] }): Promise<string>;
    export function criarAluno(db: PrismaService, c: CenarioDeDiaria, status?: 'ACTIVE' | 'BLOCKED'): Promise<string>;
    ```
  - `Plan.billingMode` aceita `'DIARIA'` em banco, API e painel.

- [ ] **Step 1: Escrever o helper de cenário**

Create `apps/api/test/integration/helpers/cenario-de-diaria.ts`:

```ts
import { randomUUID } from 'node:crypto';

import type { TenantContext } from '../../../src/common/tenant/tenant-context.js';
import type { PasswordService } from '../../../src/modules/auth/password.service.js';
import type { PrismaService } from '../../../src/persistence/prisma.service.js';

/** Quarta-feira, 12:00 em America/Sao_Paulo (UTC-3). */
export const AGORA = new Date('2026-10-07T15:00:00.000Z');
/** Quinta-feira, 00:00 em America/Sao_Paulo: o fim EXCLUSIVO da diaria vendida em `AGORA`. */
export const FIM_DO_DIA = new Date('2026-10-08T03:00:00.000Z');
export const PRECO_DA_DIARIA_MINOR = 3_000;

export interface CenarioDeDiaria {
  readonly sufixo: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly unidadeId: string;
}

/** `actorId` e um usuario REAL: `audit_logs.actor_id` tem FK para `users`. */
export function contextoDe(c: CenarioDeDiaria): TenantContext {
  return {
    tenantId: c.tenantId,
    actorId: c.actorId,
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };
}

export async function criarCenarioDeDiaria(
  db: PrismaService,
  senhas: PasswordService,
  opcoes: { comConfiguracaoFinanceira?: boolean } = {},
): Promise<CenarioDeDiaria> {
  const sufixo = randomUUID().slice(0, 8);

  const tenant = await db.tenant.create({
    data: {
      slug: `diaria-${sufixo}`,
      legalName: `Diaria ${sufixo} LTDA`,
      displayName: `Diaria ${sufixo}`,
    },
  });

  const operador = await db.user.create({
    data: {
      email: `diaria-op-${sufixo}@exemplo.test`,
      passwordHash: await senhas.gerarHash('diaria-senha-de-teste-nao-usada-em-producao'),
    },
    select: { id: true },
  });
  await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: operador.id } });

  if (opcoes.comConfiguracaoFinanceira ?? true) {
    await db.billingSettings.create({ data: { tenantId: tenant.id, dueDay: 9, graceDays: 3 } });
  }

  const unidade = await db.gymUnit.create({
    data: {
      tenantId: tenant.id,
      code: 'MTZ',
      name: 'Matriz',
      timezone: 'America/Sao_Paulo',
      openingHours: {},
    },
  });

  return { sufixo, tenantId: tenant.id, actorId: operador.id, unidadeId: unidade.id };
}

export async function apagarCenario(db: PrismaService, c: CenarioDeDiaria): Promise<void> {
  await db.tenant.deleteMany({ where: { id: c.tenantId } });
}

/**
 * Plano com unidade, janela e preco vigente ancorado em 2026-01-01 (qualquer
 * competencia de 2026 encontra preco). Sem `diasComJanela`, abre os 7 dias,
 * 00:00-24:00 -- o teste que precisa de dia fechado diz quais dias abrem.
 */
export async function criarPlano(
  db: PrismaService,
  c: CenarioDeDiaria,
  opcoes: {
    nome?: string;
    billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA';
    ativo?: boolean;
    amountMinor?: number;
    diasComJanela?: readonly number[];
  } = {},
): Promise<string> {
  const dias = opcoes.diasComJanela ?? [0, 1, 2, 3, 4, 5, 6];

  const plano = await db.plan.create({
    data: {
      tenantId: c.tenantId,
      name: opcoes.nome ?? `Plano ${randomUUID().slice(0, 8)}`,
      billingMode: opcoes.billingMode ?? 'DIARIA',
      isActive: opcoes.ativo ?? true,
      units: { create: [{ tenantId: c.tenantId, gymUnitId: c.unidadeId }] },
      accessWindows: {
        create: dias.map((dayOfWeek) => ({
          tenantId: c.tenantId,
          gymUnitId: c.unidadeId,
          dayOfWeek,
          startMinute: 0,
          endMinute: 1440,
        })),
      },
      prices: {
        create: [
          {
            tenantId: c.tenantId,
            amountMinor: opcoes.amountMinor ?? PRECO_DA_DIARIA_MINOR,
            validFrom: new Date('2026-01-01T00:00:00Z'),
          },
        ],
      },
    },
    select: { id: true },
  });

  return plano.id;
}

export async function criarAluno(
  db: PrismaService,
  c: CenarioDeDiaria,
  status: 'ACTIVE' | 'BLOCKED' = 'ACTIVE',
): Promise<string> {
  const aluno = await db.student.create({
    data: {
      tenantId: c.tenantId,
      gymUnitId: c.unidadeId,
      membershipNumber: `D86-${randomUUID().slice(0, 8)}`,
      fullName: 'Aluno Diaria',
      birthDate: new Date('2000-01-01T00:00:00Z'),
      status,
    },
    select: { id: true },
  });

  return aluno.id;
}
```

- [ ] **Step 2: Escrever o teste que falha (a modalidade ainda não existe)**

Create `apps/api/test/integration/venda-de-diaria.int-spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { MembershipRepository } from '../../src/modules/membership/membership.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  AGORA,
  apagarCenario,
  contextoDe,
  criarCenarioDeDiaria,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * Diaria avulsa no balcao (F86, issue #616): o aluno sem plano paga R$ 30,00 e
 * usa a academia ate 23:59. Contra banco de verdade (`docs/TESTING.md` 3): a
 * atomicidade, a trava do aluno e a promocao pelo pagamento sao comportamento
 * do Postgres -- dublar o banco provaria so a sintaxe do TypeScript.
 */
describe('F86 -- diaria avulsa no balcao', () => {
  let db: PrismaService;
  let membership: MembershipRepository;
  let c: CenarioDeDiaria;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    membership = comContextoDeTenant(moduleRef.get(MembershipRepository));
    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));
  });

  afterAll(async () => {
    await apagarCenario(db, c);
  });

  it('persiste plano com a modalidade DIARIA', async () => {
    const plano = await membership.criarPlano(
      contextoDe(c),
      {
        name: `Diaria ${c.sufixo}`,
        gymUnitIds: [c.unidadeId],
        janelas: [{ gymUnitId: c.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 }],
        amountMinor: 3000,
        billingMode: 'DIARIA',
      },
      'corr-f86',
      AGORA,
    );

    expect(plano.billingMode).toBe('DIARIA');
  });
});
```
Troque `#616` pelo número real.

- [ ] **Step 3: Rodar e ver falhar**

```bash
export DATABASE_URL="postgresql://postgres:f86-descartavel@127.0.0.1:55486/arenahub_f86_int?schema=public"
export INTEGRATION_DATABASE_URL="$DATABASE_URL"
cd apps/api && node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --testPathPattern venda-de-diaria
```
Expected: FAIL — erro de tipo (`'DIARIA'` não é atribuível a `'AVULSO' | 'ASSINATURA'`) ou `invalid input value for enum "plan_billing_mode": "DIARIA"`.

- [ ] **Step 4: Adicionar o valor ao enum do schema**

Em `packages/database/prisma/schema.prisma`, no enum `PlanBillingMode`, acrescente depois de `ASSINATURA`:

```prisma
  /// Diaria avulsa (F86): o aluno SEM plano paga na recepcao e usa a academia
  /// so naquele dia, ate 23:59 no fuso da unidade. NAO e contrato: fica fora de
  /// receita recorrente, inadimplencia e aviso de vencimento. So se vende por
  /// `POST /students/:id/day-pass` -- atribuir ou trocar para este plano e
  /// recusado, porque daria acesso sem pagamento e com datas livres.
  DIARIA
```
No comentário do campo `billingMode` do model `Plan`, nada muda.

- [ ] **Step 5: Escrever a migration**

Create `packages/database/prisma/migrations/20261007140000_f86_plano_diaria/migration.sql`:

```sql
-- F86: modalidade DIARIA (diaria avulsa no balcao).
--
-- So ACRESCENTA um valor ao enum: nenhum plano existente muda de modalidade, e
-- nenhuma linha usa o valor novo dentro desta mesma migration (o Postgres nao
-- deixa USAR um valor de enum na transacao que o criou).
ALTER TYPE "plan_billing_mode" ADD VALUE 'DIARIA';
```

- [ ] **Step 6: Aplicar e regenerar o client**

```bash
export DATABASE_URL="postgresql://postgres:f86-descartavel@127.0.0.1:55486/arenahub_f86_int?schema=public"
pnpm --filter @arenahub/database exec prisma migrate deploy
pnpm --filter @arenahub/database exec prisma generate
pnpm --filter @arenahub/database build
```
Expected: `Applying migration 20261007140000_f86_plano_diaria`.

- [ ] **Step 7: Alargar os tipos escritos à mão**

Rode `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/admin-web typecheck` e corrija **cada** erro apontado. Os pontos conhecidos:

1. `apps/api/src/modules/membership/membership.controller.ts:54` →
   `billingMode: z.enum(['AVULSO', 'ASSINATURA', 'DIARIA']).optional(),`
2. `apps/api/src/modules/membership/membership.controller.ts:158` (`PlanoDto.billingMode`) e `:832`/`page.tsx:123` (`planBillingMode`) → `'AVULSO' | 'ASSINATURA' | 'DIARIA'` (e `| null` onde já houver).
3. `apps/api/src/modules/membership/membership.repository.ts:197` →
   `billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA' | undefined;`
4. `apps/api/src/modules/billing/domain/assinatura-mensal.ts:25` →
   `readonly modalidadeDoPlano: 'AVULSO' | 'ASSINATURA' | 'DIARIA';` (a regra da linha 61 `!== 'ASSINATURA'` já recusa `DIARIA`).
5. `apps/admin-web/app/(protected)/students/[id]/cobranca-recorrente.tsx:19` →
   `billingMode: 'AVULSO' | 'ASSINATURA' | 'DIARIA';`
6. `apps/admin-web/app/(protected)/students/[id]/page.tsx:123` → `planBillingMode: 'AVULSO' | 'ASSINATURA' | 'DIARIA' | null;`

Expected ao final: os dois `typecheck` verdes.

- [ ] **Step 8: Catálogo do seed — a `Diaria` passa a ser `DIARIA`**

Em `packages/database/prisma/seed.ts`, na interface/tipo das definições do `CATALOGO` acrescente `billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA'` e, na entrada `Diaria`, `billingMode: 'DIARIA'`. No `upsert` do plano:

```ts
      const plano = await db.plan.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: definicao.name } },
        create: {
          tenantId: tenant.id,
          name: definicao.name,
          description: definicao.description,
          ...(definicao.billingMode === undefined ? {} : { billingMode: definicao.billingMode }),
        },
        update: {
          description: definicao.description,
          ...(definicao.billingMode === undefined ? {} : { billingMode: definicao.billingMode }),
        },
      });
```
Se o tipo de `CATALOGO` for inferido (sem interface), o TypeScript já aceita o campo opcional na entrada; rode `pnpm --filter @arenahub/database typecheck`.

- [ ] **Step 9: Rodar e ver passar**

```bash
export DATABASE_URL="postgresql://postgres:f86-descartavel@127.0.0.1:55486/arenahub_f86_int?schema=public"
export INTEGRATION_DATABASE_URL="$DATABASE_URL"
cd apps/api && node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --testPathPattern venda-de-diaria
```
Expected: PASS (1 teste).

- [ ] **Step 10: Formulário de plano — opção "Diária"**

Em `apps/admin-web/app/actions/membership.ts`, no `esquemaDePlano`:
`billingMode: z.enum(['AVULSO', 'ASSINATURA', 'DIARIA']).catch('AVULSO'),`

Em `apps/admin-web/app/(protected)/plans/formulario-de-plano.tsx`, depois do `<label>` da `ASSINATURA` (antes do `<p role="note">`), acrescente:

```tsx
        <label className={estilos['marcador']}>
          <input
            type="radio"
            name="billingMode"
            value="DIARIA"
            data-testid="modalidade-diaria"
          />
          Diária — o aluno sem plano paga na recepção e usa a academia só naquele dia, até 23:59
        </label>
```
E troque o texto do `<p role="note">` para acrescentar a frase: `Plano de diária não se atribui com datas: ele se vende pelo botão "Vender diária" na ficha do aluno.` (mantenha a frase atual da assinatura antes dela).

- [ ] **Step 11: Typecheck, lint e commit**

```bash
pnpm --filter @arenahub/database typecheck && pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/admin-web typecheck
pnpm --filter @arenahub/api lint && pnpm --filter @arenahub/admin-web lint
git add packages/database apps/api apps/admin-web
git commit -m "feat: modalidade de plano DIARIA no schema, no seed e nos tipos (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Funções puras do dia da diária

**Files:**
- Create: `apps/api/src/modules/membership/domain/diaria.ts`
- Test: `apps/api/src/modules/membership/domain/diaria.spec.ts`

**Interfaces:**
- Consumes: `inicioDoDiaLocal(agora: Date, fuso: string): Date` (`health/domain/periodo.ts`, lança `RangeError` para fuso inválido); `momentoLocal(instante: Date, timezone: string): { dayOfWeek: number; minute: number }` e `JanelaDeAcesso` (`membership/domain/plan.ts`).
- Produces:
  ```ts
  export function fimDaDiaria(agora: Date, fuso: string): Date;
  export function haJanelaAteOFimDoDia(agora: Date, fuso: string, gymUnitId: string, janelas: readonly JanelaDeAcesso[]): boolean;
  ```

- [ ] **Step 1: Escrever os testes**

Create `apps/api/src/modules/membership/domain/diaria.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import { fimDaDiaria, haJanelaAteOFimDoDia } from './diaria.js';
import type { JanelaDeAcesso } from './plan.js';

const SP = 'America/Sao_Paulo';
const UNIDADE = 'unidade-1';

describe('fimDaDiaria', () => {
  it('e a meia-noite local do dia seguinte', () => {
    // quarta 12:00 em Sao Paulo
    expect(fimDaDiaria(new Date('2026-10-07T15:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-08T03:00:00.000Z',
    );
  });

  it('as 23:59 locais ainda e a mesma meia-noite', () => {
    // quarta 23:59 em Sao Paulo = quinta 02:59Z
    expect(fimDaDiaria(new Date('2026-10-08T02:59:00.000Z'), SP).toISOString()).toBe(
      '2026-10-08T03:00:00.000Z',
    );
  });

  it('a 00:00 local ja e o dia seguinte', () => {
    // quinta 00:00 em Sao Paulo = quinta 03:00Z
    expect(fimDaDiaria(new Date('2026-10-08T03:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-09T03:00:00.000Z',
    );
  });

  it('respeita o fuso da unidade, e nao o UTC', () => {
    // 01:00Z de quinta ainda e QUARTA 22:00 em Sao Paulo, mas ja e 01:00 de quinta em UTC
    expect(fimDaDiaria(new Date('2026-10-08T01:00:00.000Z'), SP).toISOString()).toBe(
      '2026-10-08T03:00:00.000Z',
    );
    expect(fimDaDiaria(new Date('2026-10-08T01:00:00.000Z'), 'UTC').toISOString()).toBe(
      '2026-10-09T00:00:00.000Z',
    );
  });

  it('recusa fuso desconhecido em vez de cair em UTC (ADR-019)', () => {
    expect(() => fimDaDiaria(new Date('2026-10-07T15:00:00.000Z'), 'Marte/Olimpo')).toThrow(
      RangeError,
    );
  });
});

describe('haJanelaAteOFimDoDia', () => {
  // segunda a sexta, 06:00-22:00
  const SEG_A_SEX: JanelaDeAcesso[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    gymUnitId: UNIDADE,
    dayOfWeek,
    startMinute: 360,
    endMinute: 1320,
  }));

  it('quarta ao meio-dia: ha janela', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-07T15:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      true,
    );
  });

  it('domingo: nao ha janela', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-11T15:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      false,
    );
  });

  it('quarta 21:59 ainda ha janela; 22:00 nao (fim exclusivo)', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-08T00:59:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      true,
    );
    expect(haJanelaAteOFimDoDia(new Date('2026-10-08T01:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      false,
    );
  });

  it('antes da abertura ainda ha janela hoje', () => {
    // quarta 05:00 em Sao Paulo
    expect(haJanelaAteOFimDoDia(new Date('2026-10-07T08:00:00.000Z'), SP, UNIDADE, SEG_A_SEX)).toBe(
      true,
    );
  });

  it('ignora janela de OUTRA unidade', () => {
    expect(
      haJanelaAteOFimDoDia(new Date('2026-10-07T15:00:00.000Z'), SP, 'outra-unidade', SEG_A_SEX),
    ).toBe(false);
  });

  it('plano sem janela nenhuma: nao ha', () => {
    expect(haJanelaAteOFimDoDia(new Date('2026-10-07T15:00:00.000Z'), SP, UNIDADE, [])).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit --testPathPattern membership/domain/diaria`
Expected: FAIL — `Cannot find module './diaria.js'`.

- [ ] **Step 3: Implementar**

Create `apps/api/src/modules/membership/domain/diaria.ts`:

```ts
import { inicioDoDiaLocal } from '../../health/domain/periodo.js';
import { momentoLocal, type JanelaDeAcesso } from './plan.js';

/**
 * Funcoes puras da diaria avulsa (F86): sem banco, sem relogio -- o "agora"
 * entra por parametro (`CLAUDE.md`).
 */

const UMA_HORA_EM_MS = 3_600_000;

/**
 * O FIM da diaria: 00:00 local do dia seguinte, EXCLUSIVO (igual a
 * `Entitlement.endsAt`: o direito vale ate o instante, nao nele). Dito para
 * humano: "ate 23:59".
 *
 * Reusa `inicioDoDiaLocal` -- unico lugar que sabe converter fuso em meia-noite
 * -- e nao refaz aritmetica de offset. 36h depois da meia-noite de hoje cai
 * SEMPRE no meio do dia seguinte, mesmo num fuso com salto de horario de verao
 * na virada; dai a meia-noite local daquele dia e a do dia seguinte ao de hoje.
 *
 * Fuso invalido LANCA (herdado de `inicioDoDiaLocal`, ADR-019: sem fallback).
 */
export function fimDaDiaria(agora: Date, fuso: string): Date {
  const meiaNoiteDeHoje = inicioDoDiaLocal(agora, fuso);

  return inicioDoDiaLocal(new Date(meiaNoiteDeHoje.getTime() + 36 * UMA_HORA_EM_MS), fuso);
}

/**
 * Existe, na unidade, alguma janela do plano que ainda cobre um pedaco de hoje
 * (do minuto atual ate a meia-noite)? So o dia e o fim importam: o aluno pode
 * chegar antes da abertura, e e a janela quem decide, na catraca, se ele passa.
 *
 * Recusar a venda aqui evita cobrar R$ 30,00 de quem a catraca vai negar
 * (domingo com plano seg-sex, ou depois do fechamento).
 */
export function haJanelaAteOFimDoDia(
  agora: Date,
  fuso: string,
  gymUnitId: string,
  janelas: readonly JanelaDeAcesso[],
): boolean {
  const { dayOfWeek, minute } = momentoLocal(agora, fuso);

  return janelas.some(
    (j) => j.gymUnitId === gymUnitId && j.dayOfWeek === dayOfWeek && j.endMinute > minute,
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: o mesmo comando do Step 2.
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/membership/domain/diaria.ts apps/api/src/modules/membership/domain/diaria.spec.ts
git commit -m "feat: fim da diária e janela restante do dia, funções puras (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Vencimento explícito na abertura da invoice

**Files:**
- Modify: `apps/api/src/modules/billing/billing.repository.ts` (`abrirInvoiceDoPeriodo`, linhas ~102–180)
- Test: `apps/api/test/integration/venda-de-diaria.int-spec.ts`

**Interfaces:**
- Consumes: `criarPlano`, `criarAluno`, `AGORA`, `FIM_DO_DIA` (Task 1); `BillingRepository.abrirInvoiceDoPeriodo(contexto, entrada, tx?)`.
- Produces: `abrirInvoiceDoPeriodo(contexto, entrada: { subscriptionId: string; emQue: Date; vencimento?: { dueAt: Date; blockAt: Date } }, tx?)`. Sem `vencimento`, comportamento idêntico ao de hoje.

- [ ] **Step 1: Escrever os testes**

No `venda-de-diaria.int-spec.ts`, acrescente os imports `BillingRepository` (`../../src/modules/billing/billing.repository.js`), e do helper `criarAluno`, `criarPlano`, `FIM_DO_DIA`. Declare `let billing: BillingRepository;` e, no `beforeAll`, `billing = comContextoDeTenant(moduleRef.get(BillingRepository));`. Depois do teste existente, acrescente:

```ts
  describe('abrirInvoiceDoPeriodo -- vencimento', () => {
    /** Assinatura direta no banco: o que se testa aqui e a invoice, nao a venda. */
    async function assinaturaDe(planId: string): Promise<string> {
      const studentId = await criarAluno(db, c);
      const assinatura = await db.subscription.create({
        data: {
          tenantId: c.tenantId,
          studentId,
          planId,
          status: 'ACTIVE',
          startsAt: AGORA,
          endsAt: FIM_DO_DIA,
        },
        select: { id: true },
      });

      return assinatura.id;
    }

    it('usa o vencimento informado, sem tocar no dia de vencimento do tenant', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria venc ${c.sufixo}` });
      const subscriptionId = await assinaturaDe(planId);

      const invoice = await billing.abrirInvoiceDoPeriodo(contextoDe(c), {
        subscriptionId,
        emQue: AGORA,
        vencimento: { dueAt: AGORA, blockAt: FIM_DO_DIA },
      });

      expect(invoice.dueAt.toISOString()).toBe(AGORA.toISOString());
      expect(invoice.blockAt?.toISOString()).toBe(FIM_DO_DIA.toISOString());
      expect(invoice.totalMinor).toBe(3000);
      expect(invoice.status).toBe('OPEN');
    });

    it('sem vencimento informado, mantem o ciclo mensal (dia 9 + 3 dias de carencia)', async () => {
      const planId = await criarPlano(db, c, {
        nome: `Mensal venc ${c.sufixo}`,
        billingMode: 'AVULSO',
        amountMinor: 15000,
      });
      const subscriptionId = await assinaturaDe(planId);

      const invoice = await billing.abrirInvoiceDoPeriodo(contextoDe(c), {
        subscriptionId,
        emQue: AGORA,
      });

      expect(invoice.dueAt.toISOString()).toBe('2026-10-09T00:00:00.000Z');
      expect(invoice.blockAt?.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    });
  });
```
Atualize o `import` do helper para trazer `FIM_DO_DIA`, `criarAluno` e `criarPlano`.

- [ ] **Step 2: Rodar e ver falhar**

Run (com as variáveis de banco exportadas, como no Task 1 Step 3): `... --testPathPattern venda-de-diaria`
Expected: FAIL — erro de tipo (`vencimento` não existe em `{ subscriptionId; emQue }`) ou `dueAt` = `2026-10-09`.

- [ ] **Step 3: Implementar**

Em `billing.repository.ts`, na assinatura de `abrirInvoiceDoPeriodo`:

```ts
  async abrirInvoiceDoPeriodo(
    contexto: TenantContext,
    entrada: {
      subscriptionId: string;
      emQue: Date;
      /**
       * Vencimento e bloqueio EXPLICITOS (F86, diaria): a diaria vence na compra
       * e bloqueia no fim do dia -- `dueDay` e carencia sao do ciclo MENSAL e nao
       * descrevem um dia. Ausente = ciclo mensal, como sempre foi.
       */
      vencimento?: { dueAt: Date; blockAt: Date };
    },
    tx?: Prisma.TransactionClient,
  ): Promise<Invoice> {
```
E troque o cálculo do vencimento (hoje `const vencimento = proximoVencimento(competencia, configuracao.dueDay);`) por:

```ts
    const vencimento =
      entrada.vencimento?.dueAt ?? proximoVencimento(competencia, configuracao.dueDay);
    const bloqueioEm =
      entrada.vencimento?.blockAt ?? instanteDeBloqueio(vencimento, configuracao.graceDays);
```
E no `tx.invoice.create`, troque `blockAt: instanteDeBloqueio(vencimento, configuracao.graceDays),` por `blockAt: bloqueioEm,`. O `abrirInvoice({ ..., dueAt: vencimento })` não muda.

- [ ] **Step 4: Rodar e ver passar**

Run: o mesmo. Expected: PASS (3 testes).

- [ ] **Step 5: Garantir que nada do ciclo mensal quebrou**

Run (mesmas variáveis): `... --testPathPattern "billing.int-spec|billing-ciclo|billing-pagamento-em-lote"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing/billing.repository.ts apps/api/test/integration/venda-de-diaria.int-spec.ts
git commit -m "feat: abrir invoice com vencimento e bloqueio explícitos (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Venda atômica da diária (`VenderDiariaUseCase`)

**Files:**
- Modify: `apps/api/src/modules/students/student.repository.ts` (novo `unidadeDeOrigem`, depois de `encontrar`)
- Modify: `apps/api/src/modules/membership/membership.repository.ts` (novo erro + `criarDiariaPendente`)
- Create: `apps/api/src/modules/membership/vender-diaria.use-case.ts`
- Modify: `apps/api/src/modules/membership/membership.module.ts`
- Test: `apps/api/test/integration/venda-de-diaria.int-spec.ts`

**Interfaces:**
- Consumes: Task 1 (helper), Task 2 (`fimDaDiaria`, `haJanelaAteOFimDoDia`), Task 3 (`vencimento`); `BillingRepository.registrarPagamentoManual(contexto, { invoiceId, amountMinor, reason, paidAt, receivedVia, batchId? }, correlationId, tx?) => Promise<Payment>`; `precoVigenteEm(prices, competencia)`; `competenciaDe(momento)`; `MembershipRepository.encontrarPlano(contexto, id) => Promise<PlanoComRegras | null>`.
- Produces:
  ```ts
  // StudentRepository
  unidadeDeOrigem(contexto: TenantContext, id: string): Promise<{ gymUnitId: string; timezone: string } | null>;
  // MembershipRepository
  criarDiariaPendente(tx: Prisma.TransactionClient, contexto: TenantContext,
    entrada: { studentId: string; plano: PlanoComRegras; startsAt: Date; endsAt: Date },
    correlationId: string): Promise<{ subscription: Subscription; entitlement: Entitlement }>;
  // VenderDiariaUseCase
  export interface EntradaDeVendaDeDiaria {
    readonly studentId: string; readonly planId: string;
    readonly channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
    readonly expectedTotalMinor: number; readonly receivedAmountMinor?: number | undefined;
  }
  export interface DiariaVendida {
    readonly subscriptionId: string; readonly invoiceId: string; readonly paymentId: string;
    readonly startsAt: Date; readonly endsAt: Date;
  }
  VenderDiariaUseCase.executar(contexto: TenantContext, entrada: EntradaDeVendaDeDiaria,
    correlationId: string, agora: Date): Promise<DiariaVendida>;
  ```
  Códigos de erro: `DAY_PASS_PLAN_INVALID` 422, `DAY_PASS_CLOSED_TODAY` 422, `PRICE_CHANGED` 409, `STUDENT_HAS_ACTIVE_SUBSCRIPTION` 409, `STUDENT_NOT_FOUND` 404, `PLAN_NOT_FOUND` 404; e os já existentes `PLAN_WITHOUT_ACTIVE_PRICE`, `BILLING_SETTINGS_MISSING`, `STUDENT_NOT_ELIGIBLE`.

- [ ] **Step 1: Escrever os testes (todos devem falhar)**

No `venda-de-diaria.int-spec.ts`, acrescente imports:
```ts
import { ExpirarAssinaturasVencidasUseCase } from '../../src/modules/billing/expirar-assinaturas-vencidas.use-case.js';
import { VenderDiariaUseCase } from '../../src/modules/membership/vender-diaria.use-case.js';
```
Declare no `describe`: `let venderDiaria: VenderDiariaUseCase;`, `let membershipCru: MembershipRepository;`, `let expirar: ExpirarAssinaturasVencidasUseCase;`, `let semConfiguracao: CenarioDeDiaria;` e, no `beforeAll` (depois de `c = ...`):

```ts
    venderDiaria = comContextoDeTenant(moduleRef.get(VenderDiariaUseCase));
    membershipCru = moduleRef.get(MembershipRepository);
    expirar = moduleRef.get(ExpirarAssinaturasVencidasUseCase);
    semConfiguracao = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService), {
      comConfiguracaoFinanceira: false,
    });
```
No `afterAll`, `await apagarCenario(db, semConfiguracao);`. Depois do bloco de vencimento da Task 3, acrescente:

```ts
  describe('VenderDiariaUseCase', () => {
    const venda = (studentId: string, planId: string, mais: Partial<{ expectedTotalMinor: number; receivedAmountMinor: number; channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' }> = {}) => ({
      studentId,
      planId,
      channel: 'DINHEIRO' as const,
      expectedTotalMinor: 3000,
      ...mais,
    });

    const linhasDo = async (studentId: string) => ({
      assinaturas: await db.subscription.count({ where: { tenantId: c.tenantId, studentId } }),
      direitos: await db.entitlement.count({ where: { tenantId: c.tenantId, studentId } }),
      invoices: await db.invoice.count({ where: { tenantId: c.tenantId, studentId } }),
      pagamentos: await db.payment.count({ where: { tenantId: c.tenantId, invoice: { studentId } } }),
    });

    it('vende: assinatura, direito, invoice e pagamento nascem juntos e o acesso vale ate a meia-noite', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria feliz ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      const vendida = await venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-1', AGORA);

      expect(vendida.startsAt.toISOString()).toBe(AGORA.toISOString());
      expect(vendida.endsAt.toISOString()).toBe(FIM_DO_DIA.toISOString());

      const assinatura = await db.subscription.findUniqueOrThrow({ where: { id: vendida.subscriptionId } });
      expect(assinatura.status).toBe('ACTIVE');
      expect(assinatura.endsAt?.toISOString()).toBe(FIM_DO_DIA.toISOString());

      const direito = await db.entitlement.findFirstOrThrow({ where: { subscriptionId: vendida.subscriptionId } });
      expect(direito.status).toBe('ACTIVE');
      expect(direito.source).toBe('SUBSCRIPTION');
      expect(direito.endsAt.toISOString()).toBe(FIM_DO_DIA.toISOString());

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: vendida.invoiceId } });
      expect(invoice.status).toBe('PAID');
      expect(invoice.totalMinor).toBe(3000);
      expect(invoice.dueAt.toISOString()).toBe(AGORA.toISOString());

      const pagamento = await db.payment.findUniqueOrThrow({ where: { id: vendida.paymentId } });
      expect(pagamento.status).toBe('CONFIRMED');
      expect(pagamento.method).toBe('MANUAL');
      expect(pagamento.receivedVia).toBe('DINHEIRO');
      expect(pagamento.amountMinor).toBe(3000);
    });

    it('o repositorio cria a diaria ESPERANDO o pagamento: PENDING e SCHEDULED', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria pendente ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      const plano = await membershipCru.encontrarPlano(contextoDe(c), planId);

      class Desfazer extends Error {}

      await expect(
        db.$transaction(async (tx) => {
          const criada = await membershipCru.criarDiariaPendente(
            tx,
            contextoDe(c),
            { studentId, plano: plano!, startsAt: AGORA, endsAt: FIM_DO_DIA },
            'corr-pendente',
          );

          expect(criada.subscription.status).toBe('PENDING');
          expect(criada.entitlement.status).toBe('SCHEDULED');

          throw new Desfazer();
        }),
      ).rejects.toBeInstanceOf(Desfazer);

      expect(await linhasDo(studentId)).toEqual({ assinaturas: 0, direitos: 0, invoices: 0, pagamentos: 0 });
    });

    it('troco: valor recebido maior vira credito do aluno', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria troco ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await venderDiaria.executar(contextoDe(c), venda(studentId, planId, { receivedAmountMinor: 5000 }), 'corr-troco', AGORA);

      const credito = await db.accountCredit.findFirstOrThrow({ where: { tenantId: c.tenantId, studentId } });
      expect(credito.amountMinor).toBe(2000);
    });

    it('valor recebido menor que o preco: recusa e NADA fica gravado', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria parcial ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, planId, { receivedAmountMinor: 1000 }), 'corr-parcial', AGORA),
      ).rejects.toThrow();

      expect(await linhasDo(studentId)).toEqual({ assinaturas: 0, direitos: 0, invoices: 0, pagamentos: 0 });
    });

    it('tenant sem configuracao financeira: recusa e NADA fica gravado', async () => {
      const planId = await criarPlano(db, semConfiguracao, { nome: `Diaria sem cfg ${c.sufixo}` });
      const studentId = await criarAluno(db, semConfiguracao);

      await expect(
        venderDiaria.executar(contextoDe(semConfiguracao), venda(studentId, planId), 'corr-sem-cfg', AGORA),
      ).rejects.toMatchObject({ code: 'BILLING_SETTINGS_MISSING' });

      expect(await db.subscription.count({ where: { tenantId: semConfiguracao.tenantId, studentId } })).toBe(0);
      expect(await db.entitlement.count({ where: { tenantId: semConfiguracao.tenantId, studentId } })).toBe(0);
    });

    it('aluno com plano vigente: 409', async () => {
      const mensal = await criarPlano(db, c, { nome: `Mensal vigente ${c.sufixo}`, billingMode: 'AVULSO', amountMinor: 15000 });
      const diaria = await criarPlano(db, c, { nome: `Diaria barrada ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      await db.subscription.create({
        data: { tenantId: c.tenantId, studentId, planId: mensal, status: 'ACTIVE', startsAt: AGORA },
      });

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, diaria), 'corr-vigente', AGORA),
      ).rejects.toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
    });

    it('depois de vendida, a segunda diaria no mesmo dia e recusada', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria dupla ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-d1', AGORA);

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-d2', new Date(AGORA.getTime() + 3_600_000)),
      ).rejects.toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
    });

    it('duas vendas AO MESMO TEMPO para o mesmo aluno: uma passa, a outra recebe 409, um so pagamento', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria corrida ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      const resultados = await Promise.allSettled([
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-a', AGORA),
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-b', AGORA),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejeitada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejeitada.reason).toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
      expect(await linhasDo(studentId)).toEqual({ assinaturas: 1, direitos: 1, invoices: 1, pagamentos: 1 });
    });

    it('no dia seguinte, depois de a diaria expirar, o aluno compra outra', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria retorno ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      await venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-r1', AGORA);

      const amanha = new Date(AGORA.getTime() + 24 * 3_600_000);
      await expirar.executar(c.tenantId, amanha);

      const segunda = await venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-r2', amanha);
      expect(segunda.endsAt.toISOString()).toBe('2026-10-09T03:00:00.000Z');
      expect(await db.subscription.count({ where: { tenantId: c.tenantId, studentId } })).toBe(2);
    });

    it('preco mudou depois de a tela abrir: 409 PRICE_CHANGED', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria preco ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, planId, { expectedTotalMinor: 2500 }), 'corr-preco', AGORA),
      ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    });

    it('plano mensal ou inativo nao e diaria: 422', async () => {
      const mensal = await criarPlano(db, c, { nome: `Mensal nao diaria ${c.sufixo}`, billingMode: 'AVULSO' });
      const inativa = await criarPlano(db, c, { nome: `Diaria inativa ${c.sufixo}`, ativo: false });
      const studentId = await criarAluno(db, c);

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, mensal), 'corr-m', AGORA),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_INVALID' });
      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, inativa), 'corr-i', AGORA),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_INVALID' });
    });

    it('domingo, com plano que so abre de segunda a sexta: 422 e nada gravado', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria dia util ${c.sufixo}`, diasComJanela: [1, 2, 3, 4, 5] });
      const studentId = await criarAluno(db, c);
      const domingo = new Date('2026-10-11T15:00:00.000Z');

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-dom', domingo),
      ).rejects.toMatchObject({ code: 'DAY_PASS_CLOSED_TODAY' });

      expect(await linhasDo(studentId)).toEqual({ assinaturas: 0, direitos: 0, invoices: 0, pagamentos: 0 });
    });

    it('aluno bloqueado: STUDENT_NOT_ELIGIBLE e nada gravado', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria bloqueado ${c.sufixo}` });
      const studentId = await criarAluno(db, c, 'BLOCKED');

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-bloq', AGORA),
      ).rejects.toMatchObject({ code: 'STUDENT_NOT_ELIGIBLE' });

      expect(await linhasDo(studentId)).toEqual({ assinaturas: 0, direitos: 0, invoices: 0, pagamentos: 0 });
    });

    it('aluno ou plano de OUTRO tenant: 404', async () => {
      const planoDeFora = await criarPlano(db, semConfiguracao, { nome: `Diaria de fora ${c.sufixo}` });
      const alunoDeFora = await criarAluno(db, semConfiguracao);
      const planoDeDentro = await criarPlano(db, c, { nome: `Diaria de dentro ${c.sufixo}` });

      await expect(
        venderDiaria.executar(contextoDe(c), venda(await criarAluno(db, c), planoDeFora), 'corr-x1', AGORA),
      ).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
      await expect(
        venderDiaria.executar(contextoDe(c), venda(alunoDeFora, planoDeDentro), 'corr-x2', AGORA),
      ).rejects.toMatchObject({ code: 'STUDENT_NOT_FOUND' });
    });
  });
```
Atualize o import do helper para `AGORA, FIM_DO_DIA, apagarCenario, contextoDe, criarAluno, criarCenarioDeDiaria, criarPlano`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `... --testPathPattern venda-de-diaria`
Expected: FAIL — `Cannot find module '.../vender-diaria.use-case.js'`.

- [ ] **Step 3: `StudentRepository.unidadeDeOrigem`**

Em `apps/api/src/modules/students/student.repository.ts`, logo depois do método `encontrar` (termina em `}` antes do comentário de `encontrarComDetalhes`), acrescente:

```ts
  /**
   * Unidade de ORIGEM do aluno e o fuso dela (INV-144, ADR-019: sem fallback para
   * o tenant). E de onde a diaria tira "ate quando vale": o dia civil da unidade.
   *
   * Devolve `null` quando o aluno nao existe NESTE tenant. `comTenant` pelo mesmo
   * motivo de `encontrar`: fora de transacao interceptada a politica RLS devolve
   * zero linhas em silencio sob o role restrito.
   */
  async unidadeDeOrigem(
    contexto: TenantContext,
    id: string,
  ): Promise<{ gymUnitId: string; timezone: string } | null> {
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id, tenantId: contexto.tenantId },
        select: { gymUnitId: true, gymUnit: { select: { timezone: true } } },
      }),
    );

    if (!aluno) return null;

    return { gymUnitId: aluno.gymUnitId, timezone: aluno.gymUnit.timezone };
  }
```

- [ ] **Step 4: `MembershipRepository.criarDiariaPendente` e o erro novo**

Em `membership.repository.ts`, junto das outras classes de erro (depois de `PlanoSemJanelaError`), acrescente:

```ts
export class AlunoJaTemAssinaturaVigenteError extends ErroDeDominio {
  constructor() {
    super(
      'STUDENT_HAS_ACTIVE_SUBSCRIPTION',
      409,
      'Aluno ja tem assinatura vigente; diaria so se vende a quem esta sem plano',
    );
  }
}
```
E, logo depois do método `ativarAssinatura` (antes de `registrarDerivacao`), o método:

```ts
  /**
   * Cria, DENTRO da transacao do chamador, a assinatura da DIARIA e o direito de
   * acesso que ela deriva -- os dois ESPERANDO o pagamento: assinatura `PENDING`,
   * entitlement `SCHEDULED`. Quem os promove e `registrarPagamentoManual`
   * (`ativarDireitoDeAcessoSePendente`), na mesma transacao: a cadeia
   * `Pagamento -> Invoice -> Subscription -> Entitlement` da regra de arquitetura
   * no 1, sem atalho. Se o pagamento falhar, a transacao volta atras e nem a
   * assinatura `PENDING` sobra.
   *
   * Trava a linha do aluno (`FOR UPDATE`, como `ativarAssinatura`): duas vendas
   * simultaneas para o mesmo aluno se serializam aqui, e a segunda ve a primeira
   * ja `ACTIVE` e recebe 409. O indice parcial "uma assinatura vigente por
   * aluno" fica como segunda barreira, nao como a primeira.
   *
   * NAO reaproveita `ativarAssinatura`: ele cria `ACTIVE`, que e justamente o
   * acesso-antes-do-pagamento que a diaria existe para nao ter.
   */
  async criarDiariaPendente(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    entrada: { studentId: string; plano: PlanoComRegras; startsAt: Date; endsAt: Date },
    correlationId: string,
  ): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    await this.travarAlunoElegivel(tx, contexto, entrada.studentId);

    const vigente = await tx.subscription.findFirst({
      where: {
        tenantId: contexto.tenantId,
        studentId: entrada.studentId,
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
      select: { id: true },
    });

    if (vigente) throw new AlunoJaTemAssinaturaVigenteError();

    const janelas: JanelaDeAcesso[] = entrada.plano.accessWindows.map((j) => ({
      gymUnitId: j.gymUnitId,
      dayOfWeek: j.dayOfWeek,
      startMinute: j.startMinute,
      endMinute: j.endMinute,
    }));

    const snapshot = montarSnapshotDePolitica(
      entrada.plano.id,
      entrada.plano.name,
      entrada.plano.units.map((u) => u.gymUnitId),
      janelas,
    );

    const assinatura = await tx.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: entrada.studentId,
        planId: entrada.plano.id,
        status: 'PENDING',
        startsAt: entrada.startsAt,
        endsAt: entrada.endsAt,
        lastActorId: contexto.actorId,
        lastReason: 'Diaria vendida no balcao',
      },
    });

    const entitlement = await tx.entitlement.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: entrada.studentId,
        source: 'SUBSCRIPTION',
        subscriptionId: assinatura.id,
        status: 'SCHEDULED',
        startsAt: entrada.startsAt,
        endsAt: entrada.endsAt,
        policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
        unitWindows: {
          create: janelas.map((j) => ({ ...j, tenantId: contexto.tenantId })),
        },
      },
    });

    await this.registrarDerivacao(tx, contexto, {
      studentId: entrada.studentId,
      subscriptionId: assinatura.id,
      entitlementId: entitlement.id,
      correlationId,
    });

    return { subscription: assinatura, entitlement };
  }
```

- [ ] **Step 5: O caso de uso**

Create `apps/api/src/modules/membership/vender-diaria.use-case.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { BillingRepository, PlanoSemPrecoVigenteError } from '../billing/billing.repository.js';
import { competenciaDe } from '../billing/domain/ciclo-de-cobranca.js';
import { precoVigenteEm } from '../billing/domain/dinheiro.js';
import { StudentRepository } from '../students/student.repository.js';
import { fimDaDiaria, haJanelaAteOFimDoDia } from './domain/diaria.js';
import { MembershipRepository, PlanoNaoEncontradoError } from './membership.repository.js';

export class PlanoDeDiariaInvalidoError extends ErroDeDominio {
  constructor() {
    super('DAY_PASS_PLAN_INVALID', 422, 'O plano nao e uma diaria ativa e vendavel hoje');
  }
}

export class DiariaFechadaHojeError extends ErroDeDominio {
  constructor() {
    super(
      'DAY_PASS_CLOSED_TODAY',
      422,
      'O plano nao tem horario de acesso restante hoje na unidade do aluno',
    );
  }
}

export class PrecoDaDiariaMudouError extends ErroDeDominio {
  constructor() {
    super('PRICE_CHANGED', 409, 'O preco da diaria mudou; recarregue e confira o valor');
  }
}

export interface EntradaDeVendaDeDiaria {
  readonly studentId: string;
  readonly planId: string;
  readonly channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
  /** O que a tela mostrou: conferencia otimista, nao autoridade (mesma ideia do lote). */
  readonly expectedTotalMinor: number;
  /** Ausente = recebeu exatamente o preco. Maior vira credito; menor e recusado. */
  readonly receivedAmountMinor?: number | undefined;
}

export interface DiariaVendida {
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly paymentId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Venda de diaria no balcao -- F86, `SPEC-086`.
 *
 * UMA transacao: assinatura `PENDING` + direito `SCHEDULED`, invoice com
 * vencimento na compra e pagamento manual. E o PAGAMENTO que promove os dois
 * para `ACTIVE` -- nao existe acesso sem pagamento registrado, e qualquer falha
 * desfaz tudo.
 *
 * Esta classe so ORQUESTRA: o calculo do dia e puro (`domain/diaria.ts`), a
 * trava do aluno e a criacao do direito moram em `MembershipRepository`, e a
 * invoice e o pagamento sao os de sempre em `BillingRepository`. Nada de regra
 * financeira reimplementada aqui.
 */
@Injectable()
export class VenderDiariaUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly membership: MembershipRepository,
    private readonly billing: BillingRepository,
    private readonly alunos: StudentRepository,
  ) {}

  async executar(
    contexto: TenantContext,
    entrada: EntradaDeVendaDeDiaria,
    correlationId: string,
    agora: Date,
  ): Promise<DiariaVendida> {
    // Tudo que pode recusar a venda roda ANTES da transacao: nao ha o que desfazer.
    const plano = await this.membership.encontrarPlano(contexto, entrada.planId);
    if (!plano) throw new PlanoNaoEncontradoError();

    const dentroDaValidadeDeVenda =
      (plano.salesStartAt === null || agora >= plano.salesStartAt) &&
      (plano.salesEndAt === null || agora < plano.salesEndAt);

    if (plano.billingMode !== 'DIARIA' || !plano.isActive || !dentroDaValidadeDeVenda) {
      throw new PlanoDeDiariaInvalidoError();
    }

    const preco = precoVigenteEm(plano.prices, competenciaDe(agora));
    if (!preco) throw new PlanoSemPrecoVigenteError();
    if (preco.amountMinor !== entrada.expectedTotalMinor) throw new PrecoDaDiariaMudouError();

    const unidade = await this.alunos.unidadeDeOrigem(contexto, entrada.studentId);
    if (!unidade) throw new ErroDeDominio('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');

    if (!haJanelaAteOFimDoDia(agora, unidade.timezone, unidade.gymUnitId, plano.accessWindows)) {
      throw new DiariaFechadaHojeError();
    }

    const endsAt = fimDaDiaria(agora, unidade.timezone);

    return this.db.$transaction(async (tx) => {
      const { subscription } = await this.membership.criarDiariaPendente(
        tx,
        contexto,
        { studentId: entrada.studentId, plano, startsAt: agora, endsAt },
        correlationId,
      );

      const invoice = await this.billing.abrirInvoiceDoPeriodo(
        contexto,
        {
          subscriptionId: subscription.id,
          emQue: agora,
          // Vence na compra e bloqueia no fim do dia: `dueDay` e carencia sao do ciclo mensal.
          vencimento: { dueAt: agora, blockAt: endsAt },
        },
        tx,
      );

      const pagamento = await this.billing.registrarPagamentoManual(
        contexto,
        {
          invoiceId: invoice.id,
          amountMinor: entrada.receivedAmountMinor ?? invoice.totalMinor,
          reason: 'Diaria vendida no balcao',
          paidAt: agora,
          receivedVia: entrada.channel,
        },
        correlationId,
        tx,
      );

      return {
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        paymentId: pagamento.id,
        startsAt: agora,
        endsAt,
      };
    });
  }
}
```

- [ ] **Step 6: Registrar no módulo**

Em `membership.module.ts`, importe `VenderDiariaUseCase` e acrescente em `providers`:
`providers: [MembershipRepository, TenantContextService, AplicarTrocasAgendadasSchedulerService, VenderDiariaUseCase],`

- [ ] **Step 7: Rodar e ver passar**

Run: `... --testPathPattern venda-de-diaria`
Expected: PASS. Se o teste de **corrida** falhar com outro código que não `STUDENT_HAS_ACTIVE_SUBSCRIPTION`, **não afrouxe o teste**: leia o erro, confirme que a trava `FOR UPDATE` do aluno abre antes da leitura de assinatura vigente (é a causa provável) e corrija o código.

- [ ] **Step 8: Typecheck, lint e commit**

```bash
pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api lint
git add apps/api
git commit -m "feat: venda atômica da diária — assinatura, invoice e pagamento numa transação (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rota HTTP e fechamento dos caminhos que dariam acesso sem pagamento

**Files:**
- Modify: `apps/api/src/modules/membership/membership.controller.ts`
- Modify: `apps/api/src/modules/membership/membership.repository.ts` (guarda em 3 pontos + erro)
- Create: `apps/api/test/integration/venda-de-diaria-http.int-spec.ts`
- Test: `apps/api/test/integration/venda-de-diaria.int-spec.ts` (guardas)

**Interfaces:**
- Consumes: `VenderDiariaUseCase.executar` (Task 4).
- Produces: `POST /api/v1/students/:id/day-pass` → `201 { subscriptionId, invoiceId, paymentId, startsAt, endsAt }` (datas em ISO). Exige `subscription.manage` **e** `billing.payment.manual`. Erro novo `DAY_PASS_PLAN_NOT_ASSIGNABLE` (422).

- [ ] **Step 1: Escrever os testes das guardas (devem falhar)**

No `venda-de-diaria.int-spec.ts`, depois do `describe('VenderDiariaUseCase')`, acrescente:

```ts
  describe('plano de diaria nao se atribui nem se troca', () => {
    it('POST /subscriptions (ativarAssinatura) com plano DIARIA: 422 e nada gravado', async () => {
      const diaria = await criarPlano(db, c, { nome: `Diaria nao atribuivel ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await expect(
        membership.ativarAssinatura(
          contextoDe(c),
          { studentId, planId: diaria, startsAt: AGORA, endsAt: new Date('2027-10-07T00:00:00Z'), reason: 'tentativa de acesso gratis' },
          'corr-guarda-1',
        ),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_NOT_ASSIGNABLE' });

      expect(await db.subscription.count({ where: { tenantId: c.tenantId, studentId } })).toBe(0);
    });

    it('agendar troca para plano DIARIA: 422', async () => {
      const mensal = await criarPlano(db, c, { nome: `Mensal origem ${c.sufixo}`, billingMode: 'AVULSO', amountMinor: 15000 });
      const diaria = await criarPlano(db, c, { nome: `Diaria destino ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      const assinatura = await db.subscription.create({
        data: { tenantId: c.tenantId, studentId, planId: mensal, status: 'ACTIVE', startsAt: AGORA },
      });

      await expect(
        membership.agendarTrocaDePlano(
          contextoDe(c),
          assinatura.id,
          { planId: diaria, versaoEsperada: assinatura.version, reason: 'tentativa' },
          'corr-guarda-2',
          AGORA,
        ),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_NOT_ASSIGNABLE' });
    });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `... --testPathPattern venda-de-diaria`
Expected: FAIL nos 2 testes novos (a assinatura é criada / o código é outro).

- [ ] **Step 3: A guarda nos três pontos**

Em `membership.repository.ts`, junto dos outros erros:

```ts
export class PlanoDeDiariaSoPorVendaError extends ErroDeDominio {
  constructor() {
    super(
      'DAY_PASS_PLAN_NOT_ASSIGNABLE',
      422,
      'Plano de diaria so se vende em "Vender diaria": atribuir ou trocar para ele daria acesso sem pagamento',
    );
  }
}
```
O trecho `if (plano.accessWindows.length === 0) throw new PlanoSemJanelaError();` aparece **três vezes** (`ativarAssinatura`, `trocarPlanoDaAssinatura`, `agendarTrocaDePlano`). Troque **cada uma** por (use `replace_all`):

```ts
    if (plano.billingMode === 'DIARIA') throw new PlanoDeDiariaSoPorVendaError();
    if (plano.accessWindows.length === 0) throw new PlanoSemJanelaError();
```
Confirme: `grep -c "PlanoDeDiariaSoPorVendaError()" apps/api/src/modules/membership/membership.repository.ts` → `3`.

- [ ] **Step 4: Rodar e ver passar**

Run: `... --testPathPattern venda-de-diaria` → PASS.

- [ ] **Step 5: Escrever o teste HTTP (deve falhar)**

Create `apps/api/test/integration/venda-de-diaria-http.int-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import {
  apagarCenario,
  criarAluno,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * F86 -- o que SO o HTTP prova: a rota exige as DUAS permissoes (vender diaria e
 * receber dinheiro sao atos diferentes, e quem tem so uma nao passa), e o Zod
 * recusa valor fracionario ANTES do dominio (INV-065).
 */
describe('F86 -- POST /students/:id/day-pass', () => {
  let app: INestApplication;
  let db: PrismaService;
  let c: CenarioDeDiaria;
  let planId = '';
  let studentId = '';

  const SENHA = 'senha-de-teste-diaria';
  const cookies = { completo: '', soAtribui: '', soCaixa: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((x) => x.startsWith('arenahub_access=')) ?? '';
  };

  async function usuarioCom(rotulo: string, codigos: readonly string[]): Promise<string> {
    const usuario = await db.user.create({
      data: {
        email: `diaria-http-${rotulo}-${c.sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });
    await db.tenantMembership.create({ data: { tenantId: c.tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: c.tenantId, name: `PAPEL_${rotulo}_${c.sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({
      data: { tenantId: c.tenantId, userId: usuario.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    return cookieDeAcesso(login);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    c = await criarCenarioDeDiaria(db, app.get(PasswordService));
    planId = await criarPlano(db, c, { nome: `Diaria http ${c.sufixo}` });
    studentId = await criarAluno(db, c);

    cookies.completo = await usuarioCom('completo', ['subscription.manage', 'billing.payment.manual']);
    cookies.soAtribui = await usuarioCom('so-atribui', ['subscription.manage']);
    cookies.soCaixa = await usuarioCom('so-caixa', ['billing.payment.manual']);
  });

  afterAll(async () => {
    await apagarCenario(db, c);
    await db.user.deleteMany({ where: { email: { contains: `diaria-http-` } } });
    await app.close();
  });

  const corpo = () => ({ planId, channel: 'DINHEIRO', expectedTotalMinor: 3000 });

  it('quem so tem subscription.manage e barrado', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.soAtribui)
      .send(corpo());

    expect(resposta.status).toBe(403);
  });

  it('quem so tem billing.payment.manual e barrado', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.soCaixa)
      .send(corpo());

    expect(resposta.status).toBe(403);
  });

  it('valor fracionario e recusado pelo Zod antes do dominio (INV-065)', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send({ ...corpo(), expectedTotalMinor: 30.5 });

    expect(resposta.status).toBe(400);
  });

  it('id de aluno que nao e UUID e recusado antes de tocar no banco', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/nao-e-uuid/day-pass`)
      .set('Cookie', cookies.completo)
      .send(corpo());

    expect(resposta.status).toBe(400);
  });

  it('corpo com campo desconhecido e recusado (strict)', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send({ ...corpo(), tenantId: randomUUID() });

    expect(resposta.status).toBe(400);
  });

  it('com as duas permissoes, vende: 201 e o direito fica ativo', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send(corpo());

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      subscriptionId: expect.any(String),
      invoiceId: expect.any(String),
      paymentId: expect.any(String),
    });

    const direito = await db.entitlement.findFirstOrThrow({
      where: { tenantId: c.tenantId, studentId },
    });
    expect(direito.status).toBe('ACTIVE');
    expect(new Date(resposta.body.endsAt as string).getTime()).toBe(direito.endsAt.getTime());
  });

  it('segunda venda para o mesmo aluno no mesmo dia: 409 com codigo estavel', async () => {
    const resposta = await request(servidor())
      .post(`/api/v1/students/${studentId}/day-pass`)
      .set('Cookie', cookies.completo)
      .send(corpo());

    expect(resposta.status).toBe(409);
    expect(resposta.body).toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `... --testPathPattern venda-de-diaria-http`
Expected: FAIL — 404 (rota inexistente).

- [ ] **Step 7: A rota**

Em `membership.controller.ts`:

1. Import: `import { VenderDiariaUseCase } from './vender-diaria.use-case.js';`
2. Depois de `esquemaDeCortesia`, o esquema:

```ts
const esquemaDeDiaria = z
  .object({
    planId: z.uuid(),
    channel: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO']),
    // Centavos, INV-065: o Zod recusa fracionario antes do dominio.
    expectedTotalMinor: z.number().int().positive(),
    receivedAmountMinor: z.number().int().positive().optional(),
  })
  .strict();
```
3. No construtor, acrescente `private readonly venderDiaria: VenderDiariaUseCase,` depois de `billing`.
4. A rota, logo depois de `ativarAssinatura` (antes de `@Post('subscriptions/:id/actions')`):

```ts
  /**
   * Vende a DIARIA avulsa no balcao (F86, `SPEC-086`): assinatura, invoice,
   * pagamento e direito de acesso numa transacao so. O acesso so existe porque o
   * pagamento foi registrado.
   *
   * Exige as DUAS permissoes -- vender plano e reconhecer dinheiro sao atos
   * distintos (`billing.payment.manual` e propria, separada de `billing.manage`).
   */
  @Post('students/:id/day-pass')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['subscriptionId', 'invoiceId', 'paymentId', 'startsAt', 'endsAt'],
      properties: {
        subscriptionId: { type: 'string' },
        invoiceId: { type: 'string' },
        paymentId: { type: 'string' },
        startsAt: { type: 'string' },
        endsAt: { type: 'string' },
      },
    },
  })
  @RequirePermissions('subscription.manage', 'billing.payment.manual')
  async venderDiariaAoAluno(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{
    subscriptionId: string;
    invoiceId: string;
    paymentId: string;
    startsAt: string;
    endsAt: string;
  }> {
    // UUID validado AQUI: o id vai para um `::uuid` em SQL cru (trava do aluno), e
    // texto qualquer viraria 500 em vez de 400.
    const studentId = z.uuid().parse(id);
    const dados = esquemaDeDiaria.parse(corpo);

    const vendida = await this.venderDiaria.executar(
      this.contexto.require(),
      { studentId, ...dados },
      requisicao.correlationId ?? 'sem-correlacao',
      new Date(),
    );

    return {
      subscriptionId: vendida.subscriptionId,
      invoiceId: vendida.invoiceId,
      paymentId: vendida.paymentId,
      startsAt: vendida.startsAt.toISOString(),
      endsAt: vendida.endsAt.toISOString(),
    };
  }
```

- [ ] **Step 8: Rodar e ver passar**

Run: `... --testPathPattern "venda-de-diaria"` (pega os dois arquivos).
Expected: PASS em ambos.

- [ ] **Step 9: Typecheck, lint e commit**

```bash
pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api lint
git add apps/api
git commit -m "feat: rota POST /students/:id/day-pass e guarda contra atribuir plano de diária (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Diária fora de receita recorrente, inadimplência, aviso de vencimento e retenção

**Files:**
- Modify: `apps/api/src/modules/membership/domain/plan.ts` (constante do filtro)
- Modify: `apps/api/src/modules/billing/consultar-resumo-financeiro.use-case.ts` (2 consultas, ~linhas 441 e 475)
- Modify: `apps/api/src/modules/billing/consultar-inadimplencia.use-case.ts` (~linha 522)
- Modify: `apps/api/src/modules/notifications/notification-deadline.repository.prisma.ts` (~linha 52)
- Modify: `apps/api/src/modules/retention/retention-scores.repository.ts` (~linha 228)
- Modify: `apps/api/src/modules/retention/retention-experiments.repository.ts` (~linha 191)
- Modify: `apps/api/src/modules/retention/retention-snapshots.repository.ts` (~linha 196)
- Create: `apps/api/test/integration/diaria-fora-das-metricas.int-spec.ts`

**Interfaces:**
- Consumes: Task 1 (helper).
- Produces: `export const ASSINATURA_QUE_NAO_E_DIARIA` (em `membership/domain/plan.ts`), um fragmento de `where` de `Subscription`.

- [ ] **Step 1: Escrever os canários (devem falhar)**

Create `apps/api/test/integration/diaria-fora-das-metricas.int-spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { ConsultarInadimplenciaUseCase } from '../../src/modules/billing/consultar-inadimplencia.use-case.js';
import { ConsultarResumoFinanceiroUseCase } from '../../src/modules/billing/consultar-resumo-financeiro.use-case.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { NotificationDeadlineRepository } from '../../src/modules/notifications/notification-deadline.repository.prisma.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  AGORA,
  FIM_DO_DIA,
  apagarCenario,
  contextoDe,
  criarAluno,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * CANARIO (F86): a diaria existe no cenario e o indicador NAO se mexe. Cada
 * `expect` abaixo falha se o filtro `plan.billingMode != DIARIA` sair do leitor --
 * e todos passariam por acaso num cenario sem diaria, que e o que o canario evita.
 */
describe('F86 -- diaria fora das metricas', () => {
  let db: PrismaService;
  let c: CenarioDeDiaria;
  let resumo: ConsultarResumoFinanceiroUseCase;
  let inadimplencia: ConsultarInadimplenciaUseCase;
  let prazos: NotificationDeadlineRepository;
  let assinaturaMensalId = '';
  let assinaturaDiariaId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    resumo = comContextoDeTenant(moduleRef.get(ConsultarResumoFinanceiroUseCase));
    inadimplencia = comContextoDeTenant(moduleRef.get(ConsultarInadimplenciaUseCase));
    prazos = moduleRef.get(NotificationDeadlineRepository);
    const billing = comContextoDeTenant(moduleRef.get(BillingRepository));

    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));

    const mensal = await criarPlano(db, c, { nome: `Mensal ${c.sufixo}`, billingMode: 'AVULSO', amountMinor: 15000 });
    const diaria = await criarPlano(db, c, { nome: `Diaria ${c.sufixo}` });

    // Aluno A: mensalista, com a parcela de setembro em atraso (OPEN, vencida em 09/09).
    const alunoMensal = await criarAluno(db, c);
    const mensalSub = await db.subscription.create({
      data: {
        tenantId: c.tenantId,
        studentId: alunoMensal,
        planId: mensal,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2026-10-09T12:00:00Z'), // vence em ~2 dias de AGORA: entra na janela do aviso
      },
    });
    assinaturaMensalId = mensalSub.id;
    await billing.abrirInvoiceDoPeriodo(contextoDe(c), {
      subscriptionId: mensalSub.id,
      emQue: new Date('2026-09-15T12:00:00Z'),
    });

    // Aluno B: so diaria, ACTIVE e vencendo hoje a meia-noite (tambem na janela do aviso).
    const alunoDiaria = await criarAluno(db, c);
    const diariaSub = await db.subscription.create({
      data: {
        tenantId: c.tenantId,
        studentId: alunoDiaria,
        planId: diaria,
        status: 'ACTIVE',
        startsAt: AGORA,
        endsAt: FIM_DO_DIA,
      },
    });
    assinaturaDiariaId = diariaSub.id;
  });

  afterAll(async () => {
    await apagarCenario(db, c);
  });

  it('alunos ativos e receita esperada contam so a mensalidade', async () => {
    const r = await resumo.executar(contextoDe(c), {
      de: new Date('2026-10-01T00:00:00Z'),
      ate: new Date('2026-10-07T00:00:00Z'),
      agora: AGORA,
    });

    expect(r.alunosAtivos).toBe(1);
    expect(r.receitaEsperadaMinor).toBe(15000);
  });

  it('a taxa de inadimplencia nao ganha pagante por causa da diaria', async () => {
    const painel = await inadimplencia.executar(contextoDe(c), AGORA);

    // 1 aluno inadimplente / 1 pagante = 100%. Com a diaria contada, seria 1/2 = 50%.
    expect(painel.resumo.taxaDeInadimplencia).toBe(100);
  });

  it('quem pagou a diaria NAO recebe "plano vence em breve" -- a mensalidade que vence continua avisada', async () => {
    const ids = (await prazos.assinaturasAtivasSemAvisoDeVencimento(AGORA)).map((s) => s.id);

    expect(ids).toContain(assinaturaMensalId); // controle: a consulta enxerga o que deve
    expect(ids).not.toContain(assinaturaDiariaId);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `... --testPathPattern diaria-fora-das-metricas`
Expected: FAIL nas 3 asserções do canário (alunosAtivos 2, receita 18000, taxa 50, aviso incluso). Se alguma **passar** antes do filtro, o cenário não está alcançando a consulta — corrija o cenário antes de seguir (memória: *canário passa por guarda anterior*).

- [ ] **Step 3: A constante do filtro**

Em `apps/api/src/modules/membership/domain/plan.ts`, no fim do arquivo:

```ts
/**
 * Fragmento de `where` de `Subscription` que deixa a DIARIA de fora (F86).
 *
 * A diaria e venda avulsa de um dia, nao contrato: contada como assinatura ela
 * infla "alunos ativos", receita esperada e o denominador da inadimplencia, e
 * dispara "seu plano vence em breve" para quem acabou de pagar. Todo leitor de
 * assinatura VIGENTE que alimenta indicador ou aviso espalha este fragmento --
 * uma constante so, para a proxima consulta nova nao esquecer.
 */
export const ASSINATURA_QUE_NAO_E_DIARIA = {
  plan: { billingMode: { not: 'DIARIA' } },
} as const;
```

- [ ] **Step 4: Aplicar nos leitores**

Em cada arquivo, importe `ASSINATURA_QUE_NAO_E_DIARIA` de `../membership/domain/plan.js` e espalhe no `where` da consulta de assinatura **vigente**:

1. `consultar-resumo-financeiro.use-case.ts` — as **duas** `this.db.subscription.findMany` com `status: { in: ['ACTIVE', 'PAST_DUE'] }`:
   `where: { ...doTenant, status: { in: ['ACTIVE', 'PAST_DUE'] }, ...ASSINATURA_QUE_NAO_E_DIARIA },`
2. `consultar-inadimplencia.use-case.ts` — o `count` de `pagantes`:
   `where: { tenantId: contexto.tenantId, status: { in: ['ACTIVE', 'PAST_DUE'] }, ...ASSINATURA_QUE_NAO_E_DIARIA },`
3. `notification-deadline.repository.prisma.ts` — `assinaturasAtivasSemAvisoDeVencimento`:
   `where: { status: 'ACTIVE', endsAt: { gte: de, lte: ate }, ...ASSINATURA_QUE_NAO_E_DIARIA },`
4. `retention-scores.repository.ts` — no `subscriptions: { where: { tenantId: contexto.tenantId } ...` do `select`: `where: { tenantId: contexto.tenantId, ...ASSINATURA_QUE_NAO_E_DIARIA },`
5. `retention-experiments.repository.ts` — mesmo ajuste no `subscriptions: { where: { tenantId: contexto.tenantId } ...`.
6. `retention-snapshots.repository.ts` — no `this.db.subscription.findFirst` de `fatosDoAluno`: `where: { ...escopo, createdAt: { lte: corteDeConhecimento }, ...ASSINATURA_QUE_NAO_E_DIARIA },`.

Os itens 4–6 (retenção) são consistência: o aluno com diária deixa de contar como "assinante" na régua de churn (sem eles, um aluno em experimento de retenção que comprasse uma diária pareceria "retido"). **Não têm canário próprio** — exigiria montar snapshot e experimento só para provar um `where`; as suítes `retencao-*.int-spec.ts` existentes cobrem a regressão (Step 6).

- [ ] **Step 5: Rodar e ver passar**

Run: `... --testPathPattern diaria-fora-das-metricas` → PASS (3 testes).

- [ ] **Step 6: Regressão nos leitores tocados**

Run (variáveis de banco exportadas): `... --testPathPattern "retencao-|billing-inadimplencia|painel-financeiro|dashboard|notification"`
Expected: PASS. (O nome do arquivo do painel financeiro pode variar; liste com `ls apps/api/test/integration | grep -i "resumo\|financ\|painel"` e inclua.)

- [ ] **Step 7: Typecheck, lint e commit**

```bash
pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api lint
git add apps/api
git commit -m "feat: diária fora de receita recorrente, inadimplência, aviso de vencimento e retenção (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Painel — botão "Vender diária" na ficha do aluno

**Files:**
- Modify: `apps/admin-web/app/actions/membership.ts` (action `venderDiaria` + mensagens)
- Create: `apps/admin-web/app/(protected)/students/[id]/vender-diaria.tsx`
- Create: `apps/admin-web/app/(protected)/students/[id]/vender-diaria.module.css`
- Test: `apps/admin-web/app/(protected)/students/[id]/vender-diaria.test.tsx`
- Modify: `apps/admin-web/app/(protected)/students/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/students/:id/day-pass` (Task 5); `SeletorDeForma` e `FormaDePagamento` de `./billing/seletor-de-forma`; `useToast` e `formatarDinheiro` de `@arenahub/ui`.
- Produces:
  ```ts
  // actions/membership.ts
  export type ResultadoDaDiaria = { ok: true; paymentId: string; endsAt: string } | { ok: false; error: string };
  export async function venderDiaria(input: { studentId: string; planId: string;
    channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO'; expectedTotalMinor: number }): Promise<ResultadoDaDiaria>;
  // vender-diaria.tsx
  export interface PlanoDeDiaria { id: string; name: string; amountMinor: number; currency: string }
  export function VenderDiaria(props: { studentId: string; planos: readonly PlanoDeDiaria[]; impedido: boolean }): JSX.Element;
  ```
  Test ids: `abrir-venda-de-diaria`, `venda-de-diaria`, `diaria-valor`, `confirmar-diaria`, `sem-plano-de-diaria`, `diaria-impedida`; formas: `forma-dinheiro`, `forma-pix`, `forma-debito`, `forma-credito` (do `SeletorDeForma`).

- [ ] **Step 1: Escrever o teste do componente (deve falhar)**

Create `apps/admin-web/app/(protected)/students/[id]/vender-diaria.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

const venderDiaria = vi.hoisted(() => vi.fn());

vi.mock('../../../actions/membership', () => ({ venderDiaria }));

import { VenderDiaria, type PlanoDeDiaria } from './vender-diaria';

const ALUNO = '11111111-1111-4111-8111-111111111111';
const PLANO: PlanoDeDiaria = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Diaria',
  amountMinor: 3000,
  currency: 'BRL',
};

function montar(sobrescritas: Partial<React.ComponentProps<typeof VenderDiaria>> = {}) {
  return render(
    <ToastProvider>
      <VenderDiaria studentId={ALUNO} planos={[PLANO]} impedido={false} {...sobrescritas} />
    </ToastProvider>,
  );
}

async function abrir() {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByTestId('abrir-venda-de-diaria'));

  return usuario;
}

describe('vender diaria na ficha do aluno', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fica fechada ate a recepcao pedir', () => {
    montar();

    expect(screen.getByTestId('abrir-venda-de-diaria')).toBeInTheDocument();
    expect(screen.queryByTestId('venda-de-diaria')).toBeNull();
  });

  it('mostra o valor da diaria antes de confirmar', async () => {
    montar();
    await abrir();

    expect(screen.getByTestId('diaria-valor')).toHaveTextContent('R$ 30,00');
  });

  it('confirma com o preco que a tela mostrou e dinheiro como forma padrao', async () => {
    venderDiaria.mockResolvedValue({ ok: true, paymentId: 'p1', endsAt: '2026-10-08T03:00:00.000Z' });
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('confirmar-diaria'));

    await waitFor(() =>
      expect(venderDiaria).toHaveBeenCalledWith({
        studentId: ALUNO,
        planId: PLANO.id,
        channel: 'DINHEIRO',
        expectedTotalMinor: 3000,
      }),
    );
    expect(await screen.findByText(/Diária paga/)).toBeInTheDocument();
  });

  it('manda a forma de pagamento escolhida', async () => {
    venderDiaria.mockResolvedValue({ ok: true, paymentId: 'p1', endsAt: '2026-10-08T03:00:00.000Z' });
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('forma-pix'));
    await usuario.click(screen.getByTestId('confirmar-diaria'));

    await waitFor(() =>
      expect(venderDiaria).toHaveBeenCalledWith(expect.objectContaining({ channel: 'PIX' })),
    );
  });

  it('mostra o erro da API num aviso e nao diz que pagou', async () => {
    venderDiaria.mockResolvedValue({ ok: false, error: 'Este aluno já tem plano vigente.' });
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('confirmar-diaria'));

    expect(await screen.findByText('Este aluno já tem plano vigente.')).toBeInTheDocument();
    expect(screen.queryByText(/Diária paga/)).toBeNull();
  });

  it('bloqueia o botao enquanto envia: clique duplo nao vende duas vezes', async () => {
    let liberar: (v: unknown) => void = () => undefined;
    venderDiaria.mockReturnValue(new Promise((resolve) => { liberar = resolve; }));
    montar();
    const usuario = await abrir();

    await usuario.click(screen.getByTestId('confirmar-diaria'));
    await usuario.click(screen.getByTestId('confirmar-diaria'));

    expect(venderDiaria).toHaveBeenCalledTimes(1);
    liberar({ ok: true, paymentId: 'p1', endsAt: '2026-10-08T03:00:00.000Z' });
  });

  it('com mais de um plano de diaria, pede a escolha', async () => {
    montar({ planos: [PLANO, { ...PLANO, id: '33333333-3333-4333-8333-333333333333', name: 'Diaria promo', amountMinor: 2500 }] });
    await abrir();

    expect(screen.getByTestId('diaria-plano')).toBeInTheDocument();
  });

  it('sem plano de diaria ativo, explica o que fazer em vez de esconder', () => {
    montar({ planos: [] });

    expect(screen.getByTestId('sem-plano-de-diaria')).toHaveTextContent(/Planos/);
    expect(screen.queryByTestId('abrir-venda-de-diaria')).toBeNull();
  });

  it('aluno com acesso impedido nao ve o botao e ve o motivo', () => {
    montar({ impedido: true });

    expect(screen.getByTestId('diaria-impedida')).toBeInTheDocument();
    expect(screen.queryByTestId('abrir-venda-de-diaria')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/admin-web exec vitest run "app/(protected)/students/[id]/vender-diaria.test.tsx"`
Expected: FAIL — `Failed to resolve import "./vender-diaria"`.

- [ ] **Step 3: A Server Action**

Em `apps/admin-web/app/actions/membership.ts`, no mapa `MENSAGEM`, acrescente (antes do `};` de fechamento):

```ts
  DAY_PASS_PLAN_INVALID: 'Este plano não é uma diária ativa. Escolha outro plano de diária.',
  DAY_PASS_CLOSED_TODAY:
    'O plano não tem horário de acesso restante hoje na unidade do aluno. Ajuste as janelas do plano.',
  DAY_PASS_PLAN_NOT_ASSIGNABLE:
    'Plano de diária só se vende em "Vender diária": ele não pode ser atribuído com datas.',
  STUDENT_HAS_ACTIVE_SUBSCRIPTION: 'Este aluno já tem plano vigente.',
  PRICE_CHANGED: 'O preço da diária mudou. Recarregue a ficha e confira o valor.',
  BILLING_SETTINGS_MISSING:
    'A academia ainda não configurou vencimento e carência. Configure em Financeiro antes de cobrar.',
```
(Se alguma dessas chaves já existir no mapa, mantenha a existente.) E ao fim do arquivo:

```ts
export type ResultadoDaDiaria =
  | { ok: true; paymentId: string; endsAt: string }
  | { ok: false; error: string };

const esquemaDeDiaria = z.object({
  studentId: z.string().uuid(),
  planId: z.string().uuid(),
  channel: z.enum(['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO']),
  expectedTotalMinor: z.number().int().positive(),
});

/**
 * Vende a diaria avulsa -- `POST /api/v1/students/:id/day-pass` (F86). Recebe os
 * campos direto (nao `FormData`): quem chama e um componente que ja os tem
 * montados, e nao ha formulario a preencher.
 *
 * O `expectedTotalMinor` e o que a TELA mostrou: o servidor recalcula pelo preco
 * vigente e recusa (`PRICE_CHANGED`) se divergir -- conferencia, nao autoridade.
 */
export async function venderDiaria(input: {
  studentId: string;
  planId: string;
  channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
  expectedTotalMinor: number;
}): Promise<ResultadoDaDiaria> {
  const analisado = esquemaDeDiaria.safeParse(input);

  if (!analisado.success) {
    return { ok: false, error: 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ paymentId: string; endsAt: string }>(
    `/api/v1/students/${analisado.data.studentId}/day-pass`,
    {
      metodo: 'POST',
      corpo: {
        planId: analisado.data.planId,
        channel: analisado.data.channel,
        expectedTotalMinor: analisado.data.expectedTotalMinor,
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      ok: false,
      error: frase(resposta.erro?.code ?? '', 'Não foi possível vender a diária'),
    };
  }

  revalidatePath(`/students/${analisado.data.studentId}`);

  return { ok: true, paymentId: resposta.dados.paymentId, endsAt: resposta.dados.endsAt };
}
```

- [ ] **Step 4: O estilo**

Create `apps/admin-web/app/(protected)/students/[id]/vender-diaria.module.css` (só tokens do DS — sem hex literal; use as mesmas variáveis que `atribuir-plano.module.css` usa; abra-o e copie os nomes):

```css
.painel {
  display: grid;
  gap: var(--ah-space-3);
  margin-block-start: var(--ah-space-3);
}

.valor {
  font-size: var(--ah-text-lg);
  font-weight: 600;
}

.acoes {
  display: flex;
  gap: var(--ah-space-2);
  align-items: center;
}
```
Antes de salvar, confira com `grep -n "var(--ah-" "apps/admin-web/app/(protected)/students/[id]/atribuir-plano.module.css" | head` que os tokens `--ah-space-*` e `--ah-text-*` existem; **troque pelos nomes reais** se diferirem (a lint de tokens barra nome inventado).

- [ ] **Step 5: O componente**

Create `apps/admin-web/app/(protected)/students/[id]/vender-diaria.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { Button, SelectField, formatarDinheiro, useToast } from '@arenahub/ui';

import { venderDiaria } from '../../../actions/membership';
import { SeletorDeForma, type FormaDePagamento } from './billing/seletor-de-forma';
import estilos from './vender-diaria.module.css';

export interface PlanoDeDiaria {
  id: string;
  name: string;
  amountMinor: number;
  currency: string;
}

interface Props {
  studentId: string;
  /** Planos `DIARIA` ativos e com preco vigente. Vazio = ninguem cadastrou. */
  planos: readonly PlanoDeDiaria[];
  /** `true` quando a situacao do aluno impede o acesso (INV-033). */
  impedido: boolean;
}

/**
 * Vender a diaria avulsa -- F86, `SPEC-086`.
 *
 * FECHADA POR PADRAO, como `AtribuirPlano`: vender diaria e ato pontual, e a ficha
 * serve antes de tudo para consultar.
 *
 * O botao se bloqueia enquanto envia. A defesa de verdade contra o clique duplo
 * mora no servidor (trava do aluno + 409), mas a tela nao deve disparar duas
 * requisicoes de proposito.
 *
 * O ACESSO NAO NASCE AQUI: a API cria o direito junto do pagamento. Tocar no botao
 * nunca libera nada por si -- so a resposta `ok` do servidor diz que pagou.
 */
export function VenderDiaria({ studentId, planos, impedido }: Props) {
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [planoId, setPlanoId] = useState(planos[0]?.id ?? '');
  const [forma, setForma] = useState<FormaDePagamento>('DINHEIRO');
  const { show } = useToast();

  if (impedido) {
    return (
      <p role="note" data-testid="diaria-impedida">
        A situação do aluno impede o acesso. Regularize antes de vender a diária.
      </p>
    );
  }

  if (planos.length === 0) {
    return (
      <p role="note" data-testid="sem-plano-de-diaria">
        Nenhum plano de diária ativo com preço. Cadastre em Planos, com a modalidade “Diária”.
      </p>
    );
  }

  if (!aberto) {
    return (
      <Button type="button" variant="outline" data-testid="abrir-venda-de-diaria" onClick={() => setAberto(true)}>
        Vender diária
      </Button>
    );
  }

  const plano = planos.find((p) => p.id === planoId) ?? planos[0]!;

  async function confirmar(): Promise<void> {
    if (enviando) return;
    setEnviando(true);

    // `try/finally`: se a action LANCAR (500, rede), sem isto o botao ficava preso
    // em "Vendendo…" e a recepcao nao saberia se o dinheiro entrou.
    try {
      const resultado = await venderDiaria({
        studentId,
        planId: plano.id,
        channel: forma,
        expectedTotalMinor: plano.amountMinor,
      });

      if (resultado.ok) {
        show('info', 'Diária paga. O acesso vale até 23:59.', 'diaria-vendida');
        setAberto(false);
      } else {
        show('warn', resultado.error, 'erro-diaria');
      }
    } catch {
      show('error', 'Não foi possível vender a diária. Confira a ficha antes de tentar de novo.', 'erro-diaria');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={estilos['painel']} data-testid="venda-de-diaria">
      {planos.length > 1 ? (
        <SelectField
          id="diaria-plano"
          name="planId"
          label="Plano de diária"
          value={planoId}
          onChange={(e) => setPlanoId(e.target.value)}
          data-testid="diaria-plano"
        >
          {planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatarDinheiro(p.amountMinor, p.currency)}
            </option>
          ))}
        </SelectField>
      ) : (
        <p>{plano.name}</p>
      )}

      <p className={estilos['valor']} data-testid="diaria-valor">
        {formatarDinheiro(plano.amountMinor, plano.currency)}
      </p>

      <SeletorDeForma onEscolher={setForma} escolhida={forma} />

      <div className={estilos['acoes']}>
        <Button type="button" disabled={enviando} data-testid="confirmar-diaria" onClick={() => void confirmar()}>
          {enviando ? 'Vendendo…' : 'Receber e liberar acesso'}
        </Button>
        <Button type="button" variant="outline" disabled={enviando} onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
```
Se `SelectField` não aceitar `value`/`onChange` controlados, abra `atribuir-plano.tsx` (linhas ~245–262) e **use exatamente as mesmas props** que ele usa (o componente do `@arenahub/ui` é o mesmo); o teste `diaria-plano` só exige que o `data-testid` exista.

- [ ] **Step 6: Rodar e ver passar**

Run: o mesmo comando do Step 2. Expected: PASS (9 testes).

- [ ] **Step 7: Ligar na ficha**

Em `page.tsx`:

1. Imports: `import { VenderDiaria } from './vender-diaria';`
2. Na `interface Plano` (linha ~131), acrescente `billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA';`.
3. Depois de `const planosIndisponiveis = !respostaDosPlanos.ok;`:

```tsx
  /*
    DIARIA tem fluxo proprio ("Vender diaria", com pagamento): ficar fora da lista
    de atribuicao e o que impede a recepcao de dar acesso por datas livres, sem
    cobrar. A API tambem recusa (DAY_PASS_PLAN_NOT_ASSIGNABLE) -- esta e so a
    cortesia de nao oferecer o que vai falhar.
  */
  const planosAtribuiveis = planos.filter((p) => p.billingMode !== 'DIARIA');
  const planosDeDiaria = planos.flatMap((p) =>
    p.billingMode === 'DIARIA' && p.isActive && p.currentPrice
      ? [{ id: p.id, name: p.name, amountMinor: p.currentPrice.amountMinor, currency: p.currentPrice.currency }]
      : [],
  );
```
4. No `<AtribuirPlano ... planos={planos}` troque por `planos={planosAtribuiveis}`.
5. Logo **depois** do `</section>` da seção `titulo-atribuir` (antes do comentário `ISSUE #396`), acrescente:

```tsx
            {/*
              F86 -- diaria avulsa. So para quem esta SEM plano vigente: quem tem
              plano troca pelo "Alterar plano" acima, e a API recusa a diaria de
              qualquer jeito (STUDENT_HAS_ACTIVE_SUBSCRIPTION).
            */}
            {assinaturaVigente ? null : (
              <section aria-labelledby="titulo-diaria" className={estilos['secao']}>
                <h2 id="titulo-diaria">Diária</h2>
                <VenderDiaria studentId={aluno.id} planos={planosDeDiaria} impedido={bloqueado} />
              </section>
            )}
```

- [ ] **Step 8: Regressão do painel**

Run: `pnpm --filter @arenahub/admin-web test`
Expected: PASS. Se `page.test.tsx` quebrar porque o mock de `actions/membership` não tem `venderDiaria`, acrescente `venderDiaria: vi.fn()` ao `vi.mock('../../../actions/membership', ...)` desse arquivo.

- [ ] **Step 9: Typecheck, lint e commit**

```bash
pnpm --filter @arenahub/admin-web typecheck && pnpm --filter @arenahub/admin-web lint
git add apps/admin-web
git commit -m "feat: botão Vender diária na ficha do aluno sem plano (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Revisão de UI (obrigatória antes do PR, CLAUDE.md)**

Invoque as skills `impeccable` e `frontend-design:frontend-design` sobre `vender-diaria.tsx` e a seção "Diária" da ficha, contra `docs/design/DS-PAINEL.md`. Aplique só o que for **material** (hierarquia, foco, estados, contraste, mobile) e commite como `refactor: ajustes de design da venda de diária (refs #616)`. A tela real é aberta no Task 8, depois do E2E.

---

### Task 8: E2E — a recepção vende a diária pela interface

**Files:**
- Create: `apps/admin-web/tests/e2e/venda-de-diaria.e2e-spec.ts`

**Interfaces:**
- Consumes: `cadastrarAluno` (`./cadastro-de-aluno`); testids da Task 7; rotas `POST /api/v1/plans` e `GET /api/v1/students/:id/entitlements`.

- [ ] **Step 1: Escrever o E2E**

Create `apps/admin-web/tests/e2e/venda-de-diaria.e2e-spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F86 -- o golden path da diaria: a recepcao cadastra um aluno SEM plano, vende a
 * diaria pela ficha e o acesso aparece ate o fim do dia.
 *
 * O PLANO DE DIARIA E CRIADO PELA API, com janela nos 7 dias, 00:00-24:00: o plano
 * `Diaria` do seed abre so de segunda a sexta (06:00-22:00), e o teste falharia
 * sozinho no fim de semana ou de noite (`DAY_PASS_CLOSED_TODAY`) -- exatamente a
 * regra que o teste de integracao ja prova. Aqui o que importa e a TELA.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };
const API = 'http://localhost:3344';

let proximoCpf = 700;

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

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('recepcao vende a diaria a um aluno sem plano e o acesso vale ate a meia-noite', async ({ page }) => {
  await entrar(page);

  await cadastrarAluno(page, {
    nome: `Aluno Diaria ${Date.now()}`,
    nascimento: '1990-05-20',
    cpf: gerarCpfValido(),
  });
  await page.getByTestId('abrir-ficha').click();
  await expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/);
  const idDoAluno = page.url().split('/students/')[1]?.split('/')[0] ?? '';

  // A unidade do aluno -- o plano de diaria precisa abrir nela.
  const aluno = await page.request.get(`${API}/api/v1/students/${idDoAluno}`);
  expect(aluno.ok()).toBeTruthy();
  const unidadeId = ((await aluno.json()) as { gymUnitId: string }).gymUnitId;

  const nomeDoPlano = `Diaria E2E ${Date.now()}`;
  const criado = await page.request.post(`${API}/api/v1/plans`, {
    data: {
      name: nomeDoPlano,
      gymUnitIds: [unidadeId],
      janelas: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        gymUnitId: unidadeId,
        dayOfWeek,
        startMinute: 0,
        endMinute: 1440,
      })),
      amountMinor: 3000,
      billingMode: 'DIARIA',
    },
  });
  expect(criado.status()).toBe(201);

  await page.reload();
  await page.getByTestId('aba-plano').click();

  // O plano de diaria NAO aparece na lista de atribuicao (daria acesso sem pagar).
  await page.getByRole('button', { name: /Atribuir plano|Alterar plano/ }).first().click();
  const opcoes = await page.getByTestId('campo-plano').locator('option').allTextContents();
  expect(opcoes.some((o) => o.startsWith(nomeDoPlano))).toBe(false);

  await page.getByTestId('abrir-venda-de-diaria').click();
  await expect(page.getByTestId('diaria-valor')).toContainText('R$ 30,00');

  await page.getByTestId('forma-dinheiro').click();
  await page.getByTestId('confirmar-diaria').click();

  await expect(page.getByText('Diária paga. O acesso vale até 23:59.')).toBeVisible();

  // O direito existe, esta ATIVO e vence na proxima meia-noite local.
  const direitos = await page.request.get(`${API}/api/v1/students/${idDoAluno}/entitlements`);
  expect(direitos.ok()).toBeTruthy();
  const lista = (await direitos.json()) as { status: string; endsAt: string }[];
  const ativo = lista.find((d) => d.status === 'ACTIVE');
  expect(ativo).toBeTruthy();

  const fim = new Date(ativo!.endsAt);
  expect(fim.getTime()).toBeGreaterThan(Date.now());
  expect(fim.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
});
```

- [ ] **Step 2: Preparar o banco do E2E e subir**

Siga a receita da memória *Teste local com Postgres descartável* (passos 3 e 5):

```bash
docker exec arenahub-f86-postgres psql -U postgres -c "CREATE DATABASE arenahub_f86_e2e;"
export DATABASE_URL="postgresql://postgres:f86-descartavel@127.0.0.1:55486/arenahub_f86_e2e?schema=public"
pnpm --filter @arenahub/database exec prisma migrate deploy
pnpm --filter @arenahub/database seed
pnpm --filter @arenahub/api build
pnpm --filter @arenahub/admin-web build
```
Antes de rodar, confira o dono da porta 3000 (memória: *E2E reusa painel de OUTRO projeto*): `netstat -ano | findstr :3000` — se houver processo, mate-o ou pare. Exporte `E2E_DATABASE_URL` **e** `RUNTIME_E2E_DATABASE_URL` apontando para o banco acima (o `.env` aponta para outro).

- [ ] **Step 3: Rodar o E2E**

Run: `pnpm --filter @arenahub/admin-web exec playwright test venda-de-diaria`
Expected: PASS (1 teste). Se falhar, abra o screenshot em `test-results/` e corrija a tela ou o seletor — **não** relaxe a asserção do "aluno não vê o plano de diária na lista de atribuição".

- [ ] **Step 4: Abrir a tela de verdade (CLAUDE.md: "CI verde não prova a tela")**

Suba API e painel contra o banco do E2E, abra a ficha de um aluno sem plano e confira por screenshot (320, 768, 1440): botão "Vender diária", painel aberto, estado de erro, e o aluno com plano vigente **sem** a seção. Corrija o que estiver feio ou quebrado e commite.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/tests/e2e/venda-de-diaria.e2e-spec.ts
git commit -m "test: E2E da venda de diária pela ficha do aluno (refs #616)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentação, gate local e PR

**Files:**
- Modify: `docs/DEVELOPMENT.md`, `docs/STATUS.md`, `docs/CONVENTION.md`, `docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md`
- Regenerate: `reports/TESTS.md` (via `pnpm test:report`)

- [ ] **Step 1: Ajustar o spec ao que foi construído**

Em `docs/superpowers/specs/2026-10-07-diaria-avulsa-design.md`:
- §7 (Painel): remova "valor recebido e troco" e "recibo existente" do painel de venda e escreva: *"O painel não pede valor recebido: a API aceita `receivedAmountMinor` (troco vira crédito), mas o balcão hoje recebe o valor exato, como no pagamento em lote. O recibo se emite pelo Financeiro do aluno, como já é."*
- §8: acrescente: *"`retention-scores`, `retention-experiments` e `retention-snapshots` ganharam o filtro sem canário próprio; a regressão fica com as suítes `retencao-*`."*
- Cabeçalho: troque "spec aguardando revisão" por "implementada na F86".

- [ ] **Step 2: CONVENTION.md — o que é plano `DIARIA`**

Rode `grep -n "billingMode\|ASSINATURA\|AVULSO" docs/CONVENTION.md | head`. Na seção de plano/assinatura (onde `AVULSO`/`ASSINATURA` são descritos), acrescente um parágrafo:

```markdown
**Plano `DIARIA` (F86).** Venda avulsa de um dia, não contrato. Só se vende por `POST /students/:id/day-pass`:
uma transação cria assinatura `PENDING` + entitlement `SCHEDULED`, abre a invoice com vencimento na compra e
registra o pagamento manual, que promove os dois para `ACTIVE` — o acesso nasce junto do pagamento. Vale até
00:00 local do dia seguinte (fuso da unidade de origem do aluno). Atribuir ou trocar para um plano `DIARIA`
é recusado (`DAY_PASS_PLAN_NOT_ASSIGNABLE`). Fica fora de receita recorrente, inadimplência e aviso de
vencimento (`ASSINATURA_QUE_NAO_E_DIARIA`).
```
Se o `grep` não achar uma seção adequada, acrescente o parágrafo ao fim da seção de assinatura/entitlement e registre isso no corpo do PR.

- [ ] **Step 3: DEVELOPMENT.md e STATUS.md**

Em `docs/DEVELOPMENT.md`, acrescente (no formato das entregas vizinhas, F85) uma entrada **F86** com: o que entrou, as decisões (diária atômica, `PENDING`/`SCHEDULED` promovidos pelo pagamento, filtro de métricas), a limitação herdada da F85 (cancelar o pagamento não revoga o direito) e o que fica para a **F87** (totem, depende da F55). Em `docs/STATUS.md`, troque o status da linha F86 para `✅ **entregue** em <data> ([#<PR>](https://github.com/RodReis/arenahub/pull/<PR>)) — aguardando aceite. Ver resumo completo em DEVELOPMENT.md` **depois de o PR existir** (Step 8).

- [ ] **Step 4: Gate local — os cinco comandos da raiz, sem cache**

```bash
export DATABASE_URL="postgresql://postgres:f86-descartavel@127.0.0.1:55486/arenahub_f86_int?schema=public"
export INTEGRATION_DATABASE_URL="$DATABASE_URL"
pnpm lint --force
pnpm typecheck --force
pnpm test --force
pnpm build --force
pnpm test:guardas
```
Expected: tudo verde. Depois a integração, **sem** o `pretest` que o classificador bloqueia: `cd apps/api && node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --maxWorkers=2` (no Windows o Jest pode sair com `3221226505` depois de os testes passarem — pré-existente; confira o total de suítes/testes no resumo, não só o exit).

- [ ] **Step 5: Relatório de evidência**

Run: `pnpm test:report` com as flags de entrega descritas em `docs/TESTING.md` §5 (`--issue 616 --spec SPEC-086`; o campo **PR** nasce `—`). Se o Jest tiver crashado, confira o número de integração gravado contra a sua contagem (memória: *test:report herda número antigo*) e corrija à mão. Commite `reports/TESTS.md`.

- [ ] **Step 6: Code review adversarial (CLAUDE.md, antes do commit final)**

Rode a skill `/code-review` sobre o branch inteiro (`git diff main...HEAD`), com `security-reviewer` (auth/dinheiro/SQL cru) e `typescript-reviewer`. **Nunca CodeRabbit** (memória). Resolva CRITICAL e HIGH; registre MEDIUM no PR.

- [ ] **Step 7: Push e PR**

```bash
git push -u origin feat/f86-diaria-no-balcao
gh pr create --title "feat: diária avulsa no balcão (F86)" --body "<corpo>"
```
Corpo (PT-BR): resumo; decisões do PI (spec §2); decisões técnicas **minhas** registradas aqui (venda atômica `PENDING`/`SCHEDULED` promovida pelo pagamento; guarda contra atribuir plano `DIARIA`; filtro `ASSINATURA_QUE_NAO_E_DIARIA`; painel sem troco); a limitação da F85; `refs #616` (**nunca** `closes`); plano de teste com os números reais; e termine com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 8: Esperar o CI (sem silêncio, sem loop artesanal)**

```bash
gh pr checks <n>   # pega o run id
gh run watch <run-id> --exit-status --interval 30
```
Avise em uma frase que a espera é assíncrona; se passar de ~3–5 min sem notificação, faça **uma** checagem (`gh pr checks <n>`) e reporte "ainda rodando". Ao terminar, confira **job a job** (o exit do watch já saiu 0 com job vermelho). Com tudo verde: merge, `proplan:done` + link do PR no corpo da issue, preencher o PR em `reports/TESTS.md` e o status no `STATUS.md`, e **atualizar o localhost** na `main` (apagar `.next`/`dist`/`tsbuildinfo`).

- [ ] **Step 9: Fechar o card e perguntar do grafo**

Invoque a skill `fechar-card` (comentário de encerramento: Resumo, Aprendizado, Imprevistos). Depois pergunte ao PI se roda `/graphify . --update`. **Não** feche a issue nem aplique `proplan:finalizado`: o aceite é só do PI.

---

## Self-Review (feito ao escrever o plano)

**Cobertura do spec:** §4 modelo → Task 1; §5 caso de uso → Tasks 2, 3, 4; §6 API → Task 5; §7 painel → Task 7; §8 métricas → Task 6; §10 testes → Tasks 2–8; §11 fora de escopo → respeitado (sem totem, sem pacote de diárias, sem visitante); §9 (F87) → só registrada (Task 0). Decisão 5 do PI (dia sem janela → recusar) → Task 4 (`DAY_PASS_CLOSED_TODAY`). A guarda contra atribuir plano `DIARIA` (Task 5) **não está no spec aprovado**: nasceu da análise do código (sem ela, `POST /subscriptions` daria acesso grátis e com datas livres) e vai declarada no corpo do PR.

**Desvios do spec, declarados:** painel sem "valor recebido/troco" e sem botão de recibo (o painel de lote existente também não tem; a API suporta troco) — ajustado no spec no Task 9; retenção com filtro mas sem canário próprio.

**Consistência de tipos:** `criarDiariaPendente(tx, contexto, { studentId, plano, startsAt, endsAt }, correlationId)` (Task 4) é chamado igual no caso de uso e no teste; `vencimento: { dueAt, blockAt }` (Task 3) é o que o caso de uso passa; `EntradaDeVendaDeDiaria`/`DiariaVendida` (Task 4) são o que o controller espalha e devolve (Task 5); `venderDiaria({ studentId, planId, channel, expectedTotalMinor })` (Task 7) casa com o corpo `{ planId, channel, expectedTotalMinor }` da rota.

**Placeholders:** `616`, `617` e `<PR>` são números que só existem depois do `gh issue create`/`gh pr create` (Task 0 Step 2, Task 9 Step 7) — cada uso diz de onde vem. Nenhum outro.
