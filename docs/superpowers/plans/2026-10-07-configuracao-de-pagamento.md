# Configuração > Pagamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono da academia define, em Configuração > Pagamento, o dia de gerar as parcelas, o dia de vencimento e os dias de bloqueio após o vencimento; a mudança vale só para parcelas futuras.

**Architecture:** `BillingSettings` (por tenant) já guarda `dueDay` e `graceDays`; ganha `invoiceGenerationDay`. Um caso de uso `ConfiguracaoDePagamentoUseCase` lê/grava os três com validação pura de domínio e auditoria, exposto em `GET/PUT /api/v1/billing/settings`. O cron do gerador passa a rodar todo dia e cada tenant só gera no seu dia. O admin-web ganha o menu Configuração com a aba Pagamento.

**Tech Stack:** NestJS + Prisma 7 (Postgres), Zod, `@nestjs/schedule`, Next.js App Router (Server Actions), Vitest, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-configuracao-de-pagamento-design.md` (e `docs/specs/SPEC-089-configuracao-de-pagamento.md`). Card: #624. Branch: `feat/f89-configuracao-pagamento`.

## Global Constraints

- Idioma: código e identificadores em inglês; textos de interface, docs, commits e comunicação em PT-BR.
- **O `.env` da raiz é a PRODUÇÃO.** Nunca use o `DATABASE_URL` dele para testar nem para `prisma migrate`. Teste de integração roda em Postgres descartável novo (receita: `C:\Users\rodri\.claude\projects\c--Desenv-Projetos-arenahub\memory\teste-local-com-postgres-descartavel.md`; container novo, porta nova, nunca as portas já configuradas no docker). Nunca imprima trecho do `.env`.
- Prisma 7: `migrate diff` usa `--from-config-datasource` e `-o <arquivo>` (nunca redirecionar stdout para o `.sql`).
- Dinheiro é inteiro; aqui não há dinheiro novo.
- Erro de domínio tem código estável e sai como `application/problem+json` (`ErroDeDominio(code, status, message)` em `apps/api/src/common/http/erro-de-dominio.ts`).
- Toast para info/warn/error; nunca `alert`. UI segue `docs/design/DS-PAINEL.md`: tokens, sem hex literal, sem `toLocaleString()` sem fuso.
- Limites (valores exatos do spec §3 e §4.1): dia de gerar e dia de vencer **1 a 28**; dias de bloqueio **1 a 30** na API; dia de gerar **≤** dia de vencer.
- **Ruling R7 (deste plano):** o `CHECK` de banco para `grace_days` é `BETWEEN 0 AND 30`, não `1 AND 30`. Motivo: `apps/api/test/integration/billing-inadimplencia.int-spec.ts:505` cria um tenant com `graceDays: 0` e o domínio já aceita 0. O limite de **1** é regra de entrada da API (`validarConfiguracaoDePagamento`). Custo se errado: apertar o `CHECK` numa migration nova.
- Permissão nova `billing.settings.manage`: só OWNER (e MANAGER, que deriva do OWNER por subtração e não está na lista de negadas). Financeiro e Recepção **não** a têm.
- Salvar a configuração **nunca** altera `Invoice` (`dueAt`, `blockAt` ficam congelados na abertura).
- Não stagear `CLAUDE.md` (alteração do usuário). Nada de `git add -A`; sempre os arquivos da tarefa.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. PR descrito com `refs #624` (nunca `closes`).
- **Ajuste do PI incluído (07/10/2026):** antes do PR o PI pediu que a venda da diária também apareça na tela de Cobrança do aluno quando ele não tem plano vinculado (Task 7). Com plano vinculado, a tela fica como hoje. A diária continua também na aba Plano.

## Review Focus

1. **Igualdade nos limites:** gerar 28 / vencer 28 é aceito; 29 é recusado; `gerar > vencer` (ex.: 15 e 10) é recusado. (Task 2)
2. **Salvar não toca fatura aberta:** depois do `PUT`, `dueAt` e `blockAt` das faturas abertas são idênticos aos de antes. (Task 3)
3. **Dois tenants, dias diferentes, mesmo ciclo:** hoje é dia 5; o tenant com dia 5 gera, o de dia 1 não. (Task 4)
4. **`PUT` incompleto ou com tipo errado** (campo ausente, `"10"` string, `10.5`, `null`): 4xx com código estável, nada gravado. (Task 3)
5. **Tenant sem linha em `billing_settings`:** `GET` devolve 1/10/5 sem criar linha; `PUT` cria a linha. (Task 3)
6. **Usuário sem a permissão** abre a tela e vê os valores sem o botão Salvar; o `PUT` direto devolve 403. (Tasks 3 e 6)
7. **Cobrança sem plano:** o aluno sem assinatura vê "Vender diária" na tela de Cobrança; com assinatura ACTIVE ou SUSPENDED (que usa a faixa de meses) a venda **não** aparece; aluno impedido (BLOCKED/CANCELLED/ARCHIVED) vê o aviso, não o botão. (Task 7)
8. **Duas abas salvando:** vale a última gravação, e a auditoria guarda antigo e novo de cada uma. (Task 3)

---

### Task 1: Banco e permissão

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `BillingSettings`)
- Create: `packages/database/prisma/migrations/20261007190000_f89_configuracao_de_pagamento/migration.sql`
- Modify: `packages/database/src/permissoes.ts` (lista `PERMISSOES_DO_OWNER`)
- Modify: `packages/database/src/permissoes.spec.ts`
- Test: `packages/database/test/` (siga o int-spec de migração/seed mais próximo; se não houver, a verificação SQL do Step 6)

**Interfaces:**
- Produces: coluna `billing_settings.invoice_generation_day` (Prisma: `BillingSettings.invoiceGenerationDay: number`); permissão `'billing.settings.manage'` no catálogo e no papel OWNER.

- [ ] **Step 1: Teste da permissão (falha)**

Em `packages/database/src/permissoes.spec.ts`, no `describe` do OWNER/MANAGER/FINANCEIRO/RECEPÇÃO já existente, acrescente:

```ts
it('billing.settings.manage: dono e gerente tem, financeiro e recepcao nao', () => {
  expect(PERMISSOES_DO_OWNER).toContain('billing.settings.manage');
  expect(PERMISSOES_DO_MANAGER).toContain('billing.settings.manage');
  expect(PERMISSOES_DO_FINANCEIRO).not.toContain('billing.settings.manage');
  expect(PERMISSOES_DA_RECEPCAO).not.toContain('billing.settings.manage');
});
```

Run: `pnpm --filter @arenahub/database exec vitest run src/permissoes.spec.ts` (ou o runner que o pacote usa; veja `package.json`). Expected: FAIL.

- [ ] **Step 2: Catálogo**

Em `packages/database/src/permissoes.ts`, logo depois de `'billing.payment.manual',` (bloco F12) acrescente:

```ts
  // F89: o dono define dia de gerar, vencimento e dias de bloqueio. Separada de
  // `billing.manage` (que o Financeiro tem): mudar a regra de cobranca da
  // academia inteira nao e ato de quem lanca pagamento.
  'billing.settings.manage',
```

Run o teste do Step 1. Expected: PASS (OWNER e MANAGER tem; os outros dois não listam).

- [ ] **Step 3: Schema**

Em `schema.prisma`, no model `BillingSettings`, depois de `graceDays`:

```prisma
  /// F89: dia do mes em que o job gera a parcela do mes. `CHECK` 1..28 e
  /// `<= dueDay` na migration.
  invoiceGenerationDay Int @default(1) @map("invoice_generation_day")
```

- [ ] **Step 4: Migration**

Crie `.../20261007190000_f89_configuracao_de_pagamento/migration.sql`:

```sql
-- F89: configuracao de pagamento por tenant.
--
-- `invoice_generation_day` nasce com DEFAULT 1: toda linha existente fica com o
-- comportamento do cron atual (dia 01). Producao ja tem due_day = 10 e
-- grace_days = 5.
ALTER TABLE "billing_settings"
  ADD COLUMN "invoice_generation_day" INTEGER NOT NULL DEFAULT 1;

-- `grace_days` aceita 0 no banco (existe tenant de teste sem carencia); o
-- minimo de 1 e regra de ENTRADA da API.
ALTER TABLE "billing_settings"
  ADD CONSTRAINT "billing_settings_invoice_generation_day_check"
    CHECK ("invoice_generation_day" BETWEEN 1 AND 28),
  ADD CONSTRAINT "billing_settings_due_day_check"
    CHECK ("due_day" BETWEEN 1 AND 28),
  ADD CONSTRAINT "billing_settings_grace_days_check"
    CHECK ("grace_days" BETWEEN 0 AND 30),
  ADD CONSTRAINT "billing_settings_generation_before_due_check"
    CHECK ("invoice_generation_day" <= "due_day");

INSERT INTO permissions (id, code)
VALUES (gen_random_uuid(), 'billing.settings.manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'billing.settings.manage'
WHERE r.name IN ('OWNER', 'MANAGER') AND r.is_system = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
```

Confirme que os nomes dos papéis de sistema são `OWNER` e `MANAGER` lendo `20260922190000_f80_papeis_de_sistema/migration.sql` (linhas ~55-70); ajuste se diferirem.

- [ ] **Step 5: Gerar o client e conferir o drift**

Run: `pnpm --filter @arenahub/database exec prisma generate`. Em seguida, contra o **Postgres descartável** (não a produção): `prisma migrate deploy` e depois `prisma migrate diff --from-config-datasource --to-schema <schema> -o <arquivo-temporario>`; o diff tem de sair vazio (sem drift). Se não sair vazio, ajuste `schema.prisma`/`migration.sql` até zerar.

- [ ] **Step 6: Verificar constraints e backfill no descartável**

```sql
SELECT invoice_generation_day, due_day, grace_days FROM billing_settings LIMIT 3;  -- gerar = 1
INSERT INTO billing_settings (tenant_id, invoice_generation_day, due_day) VALUES (gen_random_uuid(), 15, 10);  -- deve FALHAR (check)
```
(o segundo precisa de um `tenant_id` existente para chegar no `CHECK`; use um tenant real do descartável). Registre o resultado no relatório da tarefa.

- [ ] **Step 7: Suíte e commit**

Run: `pnpm --filter @arenahub/database test` (unit) e o int-spec de bootstrap/seed do pacote contra o descartável (`packages/database/test/bootstrap-tenant.int-spec.ts` confere a lista de permissões do OWNER; ajuste a expectativa se ela contar permissões).

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20261007190000_f89_configuracao_de_pagamento packages/database/src/permissoes.ts packages/database/src/permissoes.spec.ts
git commit -m "feat: coluna invoice_generation_day, checks de pagamento e permissao billing.settings.manage (F89, refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domínio puro: validação e "hoje é o dia de gerar?"

**Files:**
- Create: `apps/api/src/modules/billing/domain/configuracao-de-pagamento.ts`
- Create: `apps/api/src/modules/billing/domain/configuracao-de-pagamento.spec.ts`
- Modify: `apps/api/src/modules/billing/domain/bloqueio-por-inadimplencia.ts` (exportar `dataLocalDe`)

**Interfaces:**
- Consumes: `dataLocalDe(instante: Date, timeZone: string): DataLocal` (hoje privada em `bloqueio-por-inadimplencia.ts` ~linha 103; só passa a `export`).
- Produces:
  - `interface ConfiguracaoDePagamento { readonly invoiceGenerationDay: number; readonly dueDay: number; readonly graceDays: number }`
  - `const CONFIGURACAO_DE_PAGAMENTO_PADRAO: ConfiguracaoDePagamento` = `{ invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 }`
  - `class ConfiguracaoDePagamentoInvalidaError extends ErroDeDominio` (code `BILLING_SETTINGS_INVALID`, status 422)
  - `function validarConfiguracaoDePagamento(c: ConfiguracaoDePagamento): ConfiguracaoDePagamento` (devolve a mesma ou lança)
  - `const FUSO_DOS_AGENDADORES = 'America/Sao_Paulo'`
  - `function ehDiaDeGerar(agora: Date, diaDeGerar: number): boolean`

- [ ] **Step 1: Teste (falha)**

`configuracao-de-pagamento.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import {
  CONFIGURACAO_DE_PAGAMENTO_PADRAO,
  ConfiguracaoDePagamentoInvalidaError,
  ehDiaDeGerar,
  validarConfiguracaoDePagamento,
} from './configuracao-de-pagamento.js';

const ok = { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 };

describe('validarConfiguracaoDePagamento', () => {
  it('o padrao e o do job atual: gerar 1, vencer 10, bloquear 5', () => {
    expect(CONFIGURACAO_DE_PAGAMENTO_PADRAO).toEqual(ok);
    expect(validarConfiguracaoDePagamento(ok)).toEqual(ok);
  });

  it('aceita os limites exatos (gerar 28 / vencer 28 / bloqueio 1 e 30)', () => {
    expect(() => validarConfiguracaoDePagamento({ invoiceGenerationDay: 28, dueDay: 28, graceDays: 1 })).not.toThrow();
    expect(() => validarConfiguracaoDePagamento({ invoiceGenerationDay: 1, dueDay: 28, graceDays: 30 })).not.toThrow();
  });

  it.each([
    [{ ...ok, invoiceGenerationDay: 0 }],
    [{ ...ok, invoiceGenerationDay: 29, dueDay: 28 }],
    [{ ...ok, dueDay: 0 }],
    [{ ...ok, dueDay: 29 }],
    [{ ...ok, graceDays: 0 }],
    [{ ...ok, graceDays: 31 }],
    [{ ...ok, invoiceGenerationDay: 15, dueDay: 10 }],
    [{ ...ok, dueDay: 10.5 }],
    [{ ...ok, graceDays: Number.NaN }],
  ])('recusa %j com BILLING_SETTINGS_INVALID', (entrada) => {
    expect(() => validarConfiguracaoDePagamento(entrada)).toThrow(ConfiguracaoDePagamentoInvalidaError);
  });
});

describe('ehDiaDeGerar', () => {
  it('compara o dia do mes em Brasilia, nao em UTC', () => {
    // 01/11 02:30Z ainda e 31/10 23:30 em Sao Paulo (UTC-3)
    expect(ehDiaDeGerar(new Date('2026-11-01T02:30:00Z'), 1)).toBe(false);
    expect(ehDiaDeGerar(new Date('2026-11-01T03:05:00Z'), 1)).toBe(true);
  });

  it('dia 28 em fevereiro de ano comum existe e bate', () => {
    expect(ehDiaDeGerar(new Date('2027-02-28T12:00:00Z'), 28)).toBe(true);
    expect(ehDiaDeGerar(new Date('2027-02-27T12:00:00Z'), 28)).toBe(false);
  });
});
```

Run: `pnpm --filter @arenahub/api test -- domain/configuracao-de-pagamento` (use o padrão de filtro de Jest do pacote; ver memória `jest-selectprojects-engole-o-caminho`: prefira `--testPathPattern`). Expected: FAIL (módulo não existe).

- [ ] **Step 2: Exportar `dataLocalDe`**

Em `bloqueio-por-inadimplencia.ts`, troque `function dataLocalDe(` por `export function dataLocalDe(`. Nada mais.

- [ ] **Step 3: Implementar**

```ts
import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

import { dataLocalDe } from './bloqueio-por-inadimplencia.js';

export interface ConfiguracaoDePagamento {
  /** Dia do mes em que o job gera a parcela do mes. */
  readonly invoiceGenerationDay: number;
  /** Dia do mes do vencimento. */
  readonly dueDay: number;
  /** Dias DEPOIS do vencimento em que a catraca bloqueia. */
  readonly graceDays: number;
}

/** O que o job de producao fazia antes da F89 (F88): gerar 01, vencer 10, bloquear +5. */
export const CONFIGURACAO_DE_PAGAMENTO_PADRAO: ConfiguracaoDePagamento = {
  invoiceGenerationDay: 1,
  dueDay: 10,
  graceDays: 5,
};

/** Dia 29-31 nao existe em todo mes; ate 28 o vencimento cai em qualquer um. */
const DIA_MAXIMO_DO_MES = 28;
const BLOQUEIO_MINIMO = 1;
const BLOQUEIO_MAXIMO = 30;

export class ConfiguracaoDePagamentoInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('BILLING_SETTINGS_INVALID', 422, `configuracao de pagamento invalida: ${motivo}`);
  }
}

function inteiroEntre(valor: number, minimo: number, maximo: number): boolean {
  return Number.isInteger(valor) && valor >= minimo && valor <= maximo;
}

export function validarConfiguracaoDePagamento(c: ConfiguracaoDePagamento): ConfiguracaoDePagamento {
  if (!inteiroEntre(c.invoiceGenerationDay, 1, DIA_MAXIMO_DO_MES)) {
    throw new ConfiguracaoDePagamentoInvalidaError('dia de gerar deve ser inteiro de 1 a 28');
  }
  if (!inteiroEntre(c.dueDay, 1, DIA_MAXIMO_DO_MES)) {
    throw new ConfiguracaoDePagamentoInvalidaError('dia de vencimento deve ser inteiro de 1 a 28');
  }
  if (!inteiroEntre(c.graceDays, BLOQUEIO_MINIMO, BLOQUEIO_MAXIMO)) {
    throw new ConfiguracaoDePagamentoInvalidaError('dias de bloqueio devem ser inteiro de 1 a 30');
  }
  if (c.invoiceGenerationDay > c.dueDay) {
    throw new ConfiguracaoDePagamentoInvalidaError('o dia de gerar nao pode ser depois do vencimento');
  }

  return c;
}

/**
 * Fuso dos agendadores: o mesmo `timeZone` dos `@Cron` do modulo. O "dia de
 * hoje" do tenant e o de Brasilia, nao o do servidor nem o UTC.
 */
export const FUSO_DOS_AGENDADORES = 'America/Sao_Paulo';

/** Hoje (em Brasilia) e o dia em que este tenant gera a parcela do mes? */
export function ehDiaDeGerar(agora: Date, diaDeGerar: number): boolean {
  return dataLocalDe(agora, FUSO_DOS_AGENDADORES).dia === diaDeGerar;
}
```

(Confirme o caminho relativo de `erro-de-dominio.js` a partir de `billing/domain/`: `../../../common/http/erro-de-dominio.js`.)

- [ ] **Step 4: Rodar**

Run o spec. Expected: PASS. Rode também `pnpm --filter @arenahub/api typecheck` e `lint` (regra 5 do lint cobre `Intl`; a função nova não usa `Intl`, só reusa `dataLocalDe`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/domain/configuracao-de-pagamento.ts apps/api/src/modules/billing/domain/configuracao-de-pagamento.spec.ts apps/api/src/modules/billing/domain/bloqueio-por-inadimplencia.ts
git commit -m "feat: validacao e dia de gerar da configuracao de pagamento (F89, refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Caso de uso, rota GET/PUT e testes de integração

**Files:**
- Create: `apps/api/src/modules/billing/configuracao-de-pagamento.use-case.ts`
- Create: `apps/api/src/modules/billing/configuracao-de-pagamento.controller.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts` (registrar controller e use case)
- Modify: `packages/api-contracts/openapi/arenahub-v1.json` (regenerar)
- Create: `apps/api/test/integration/billing-configuracao-de-pagamento.int-spec.ts`

**Interfaces:**
- Consumes: Task 1 (coluna e permissão), Task 2 (`ConfiguracaoDePagamento`, `CONFIGURACAO_DE_PAGAMENTO_PADRAO`, `validarConfiguracaoDePagamento`).
- Produces:
  - `ConfiguracaoDePagamentoUseCase.obter(tenantId: string): Promise<ConfiguracaoDePagamento>`
  - `ConfiguracaoDePagamentoUseCase.salvar(contexto: TenantContext, entrada: ConfiguracaoDePagamento): Promise<ConfiguracaoDePagamento>`
  - Rotas `GET api/v1/billing/settings` (`billing.read`) e `PUT api/v1/billing/settings` (`billing.settings.manage`), corpo e resposta `{ invoiceGenerationDay: integer, dueDay: integer, graceDays: integer }`.

- [ ] **Step 1: Teste de integração (falha)**

`billing-configuracao-de-pagamento.int-spec.ts`. Siga a estrutura de `billing-gerar-faturas-do-mes.int-spec.ts` (módulo `AppModule`, `PrismaService`, `comContextoDeTenant`, tenant com sufixo aleatório, `afterAll` apaga o tenant). Casos:

```ts
it('GET sem linha devolve 1/10/5 e NAO cria a linha', async () => {
  // tenant novo sem billingSettings
  expect(await useCase.obter(tenantSemLinha)).toEqual({ invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 });
  expect(await db.billingSettings.count({ where: { tenantId: tenantSemLinha } })).toBe(0);
});

it('PUT cria a linha quando nao existe e devolve o que gravou', async () => { /* salvar(...) -> obter igual */ });

it('PUT grava auditoria billing.settings_updated com antigo e novo', async () => {
  // salvar 1/10/5 -> 3/12/3
  const log = await db.auditLog.findFirstOrThrow({ where: { tenantId, action: 'billing.settings_updated' }, orderBy: { occurredAt: 'desc' } });
  expect(log.metadata).toEqual({
    before: { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 },
    after: { invoiceGenerationDay: 3, dueDay: 12, graceDays: 3 },
  });
});

it('PUT NAO altera fatura aberta (dueAt e blockAt congelados)', async () => {
  // cria uma invoice OPEN com dueAt/blockAt conhecidos, salva outra config, relê: idêntica
});

it.each([
  ['gerar maior que vencer', { invoiceGenerationDay: 15, dueDay: 10, graceDays: 5 }],
  ['vencer 29', { invoiceGenerationDay: 1, dueDay: 29, graceDays: 5 }],
  ['bloqueio 0', { invoiceGenerationDay: 1, dueDay: 10, graceDays: 0 }],
])('PUT recusa %s e nao grava nada', async (_nome, entrada) => {
  await expect(useCase.salvar(contexto, entrada)).rejects.toMatchObject({ code: 'BILLING_SETTINGS_INVALID' });
  // linha e auditoria inalteradas
});

it('duas gravacoes em sequencia valem a ultima e geram duas auditorias', async () => { /* ... */ });

it('o banco recusa escrita direta fora dos limites (CHECK)', async () => {
  await expect(db.billingSettings.update({ where: { tenantId }, data: { invoiceGenerationDay: 20 } })).rejects.toThrow(); // gerar 20 > vencer 10
});
```

Para a rota HTTP (permissão), acrescente em `billing-http.int-spec.ts` ou neste arquivo um caso: usuário FINANCEIRO recebe 403 em `PUT api/v1/billing/settings`, OWNER recebe 200 (siga o padrão de autenticação desse arquivo). Run (no descartável): `--testPathPattern billing-configuracao-de-pagamento`. Expected: FAIL.

- [ ] **Step 2: Caso de uso**

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

import {
  CONFIGURACAO_DE_PAGAMENTO_PADRAO,
  validarConfiguracaoDePagamento,
  type ConfiguracaoDePagamento,
} from './domain/configuracao-de-pagamento.js';

/**
 * Configuracao de pagamento do tenant (F89, decisao do PI em 07/10/2026): dia
 * de gerar a parcela, dia do vencimento e dias de bloqueio depois dele.
 *
 * SO PARCELAS FUTURAS: salvar nunca toca em `Invoice`. `dueAt` e `blockAt` sao
 * gravados na abertura e ficam congelados -- o aluno ja viu aquela data.
 */
@Injectable()
export class ConfiguracaoDePagamentoUseCase {
  constructor(private readonly db: PrismaService) {}

  /** Sem linha, devolve o padrao SEM criar: ler nao grava. */
  async obter(tenantId: string): Promise<ConfiguracaoDePagamento> {
    const linha = await this.db.billingSettings.findUnique({
      where: { tenantId },
      select: { invoiceGenerationDay: true, dueDay: true, graceDays: true },
    });

    return linha ?? CONFIGURACAO_DE_PAGAMENTO_PADRAO;
  }

  async salvar(contexto: TenantContext, entrada: ConfiguracaoDePagamento): Promise<ConfiguracaoDePagamento> {
    const nova = validarConfiguracaoDePagamento({
      invoiceGenerationDay: entrada.invoiceGenerationDay,
      dueDay: entrada.dueDay,
      graceDays: entrada.graceDays,
    });

    return this.db.$transaction(async (tx) => {
      const antes = await tx.billingSettings.findUnique({
        where: { tenantId: contexto.tenantId },
        select: { invoiceGenerationDay: true, dueDay: true, graceDays: true },
      });

      await tx.billingSettings.upsert({
        where: { tenantId: contexto.tenantId },
        create: { tenantId: contexto.tenantId, ...nova },
        update: nova,
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'billing.settings_updated',
          target: 'BillingSettings',
          targetId: contexto.tenantId,
          correlationId: `billing-settings-${randomUUID()}`,
          metadata: { before: antes ?? CONFIGURACAO_DE_PAGAMENTO_PADRAO, after: nova },
        },
      });

      return nova;
    });
  }
}
```

(Confira como os outros casos de uso obtêm o `correlationId`: se `contexto` já traz um, use-o em vez do `randomUUID()`. O `cancelar-pagamento-manual.use-case.ts` mostra o padrão.)

- [ ] **Step 3: Controller**

```ts
import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';

import { ConfiguracaoDePagamentoUseCase } from './configuracao-de-pagamento.use-case.js';
import type { ConfiguracaoDePagamento } from './domain/configuracao-de-pagamento.js';

/** Os TRES campos, sempre: a regra `gerar <= vencer` olha o conjunto. */
const esquema = z
  .object({
    invoiceGenerationDay: z.number().int(),
    dueDay: z.number().int(),
    graceDays: z.number().int(),
  })
  .strict();

const ESQUEMA_DA_CONFIGURACAO = {
  type: 'object',
  required: ['invoiceGenerationDay', 'dueDay', 'graceDays'],
  properties: {
    invoiceGenerationDay: { type: 'integer' },
    dueDay: { type: 'integer' },
    graceDays: { type: 'integer' },
  },
};

@Controller('api/v1/billing/settings')
export class ConfiguracaoDePagamentoController {
  constructor(
    private readonly configuracao: ConfiguracaoDePagamentoUseCase,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('billing.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_CONFIGURACAO })
  async obter(): Promise<ConfiguracaoDePagamento> {
    return this.configuracao.obter(this.contexto.require().tenantId);
  }

  @Put()
  @RequirePermissions('billing.settings.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_CONFIGURACAO })
  async salvar(@Body() corpo: unknown): Promise<ConfiguracaoDePagamento> {
    return this.configuracao.salvar(this.contexto.require(), esquema.parse(corpo));
  }
}
```

Confirme o prefixo dos controllers do billing (`billing.controller.ts` usa `@Controller(...)` com qual prefixo?) e que um `ZodError` vira 4xx pelo filtro global (veja `engagement-configuracao.controller.ts`, que faz o mesmo `parse`).

- [ ] **Step 4: Módulo**

Em `billing.module.ts`: importe e inclua `ConfiguracaoDePagamentoController` em `controllers` e `ConfiguracaoDePagamentoUseCase` em `providers` (ao lado de `GerarFaturasDoMesUseCase`, linha ~95).

- [ ] **Step 5: OpenAPI**

Regenere o snapshot: `ATUALIZAR_OPENAPI=1 pnpm --filter @arenahub/api test -- --testPathPattern openapi` e confira no diff que só entram `/api/v1/billing/settings` (get e put). Rode de novo sem a variável: verde.

- [ ] **Step 6: Rodar tudo**

Run (descartável): `--testPathPattern billing-configuracao-de-pagamento`, depois `billing-inadimplencia`, `billing-gerar-faturas-do-mes` e `billing-http`. Expected: PASS. Typecheck e lint verdes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing/configuracao-de-pagamento.use-case.ts apps/api/src/modules/billing/configuracao-de-pagamento.controller.ts apps/api/src/modules/billing/billing.module.ts apps/api/test/integration/billing-configuracao-de-pagamento.int-spec.ts packages/api-contracts/openapi/arenahub-v1.json
git commit -m "feat: GET/PUT billing/settings com auditoria (F89, refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cron diário do gerador respeita o dia de cada tenant

**Files:**
- Modify: `apps/api/src/modules/billing/gerar-faturas-do-mes-scheduler.service.ts`
- Modify: `apps/api/src/modules/billing/billing.repository.ts` (método `diaDeGerarFaturas`)
- Create: `apps/api/src/modules/billing/gerar-faturas-do-mes-scheduler.service.spec.ts`
- Modify: `apps/api/test/integration/billing-gerar-faturas-do-mes.int-spec.ts`

**Interfaces:**
- Consumes: `ehDiaDeGerar(agora, dia)` e `CONFIGURACAO_DE_PAGAMENTO_PADRAO` (Task 2); coluna (Task 1).
- Produces: `BillingRepository.diaDeGerarFaturas(tenantId: string): Promise<number>` (linha ausente → `1`); `executarCiclo(agora)` passa a devolver também `foraDoDia: number` (tenants que não geram hoje).

- [ ] **Step 1: Teste unitário do scheduler (falha)**

`gerar-faturas-do-mes-scheduler.service.spec.ts` (siga `aplicar-inadimplencia-scheduler.service.spec.ts` para montar o serviço com `repositorio` e `gerar` falsos; `comContexto` precisa funcionar sem banco: veja como aquele spec o contorna, ou teste só a decisão extraindo-a). Casos:

```ts
it('gera so nos tenants cujo dia de gerar e hoje', async () => {
  // repositorio: tenants A (dia 5) e B (dia 1); agora = 05/11 12:00Z
  // gerar.executar chamado so com A; resultado.foraDoDia === 1
});
it('tenant sem linha (dia 1) gera no dia 01 e nao no dia 02', async () => { /* ... */ });
it('falha em um tenant nao impede os outros', async () => { /* ... */ });
```

Run: `--testPathPattern gerar-faturas-do-mes-scheduler`. Expected: FAIL.

- [ ] **Step 2: Repositório**

Em `BillingRepository`, ao lado de `listarTenantsAtivos`:

```ts
  /** Dia do mes em que o tenant gera a parcela; sem linha, 1 (o padrao do job). */
  async diaDeGerarFaturas(tenantId: string): Promise<number> {
    const linha = await this.db.billingSettings.findUnique({
      where: { tenantId },
      select: { invoiceGenerationDay: true },
    });

    return linha?.invoiceGenerationDay ?? CONFIGURACAO_DE_PAGAMENTO_PADRAO.invoiceGenerationDay;
  }
```

(importe `CONFIGURACAO_DE_PAGAMENTO_PADRAO`). Se `billing_settings` tiver RLS, a leitura precisa estar dentro de `comContexto` do tenant (o scheduler já abre).

- [ ] **Step 3: Scheduler**

Troque o `@Cron` e o ciclo:

```ts
  // Todo dia as 00:05 de Brasilia; cada tenant decide se hoje e o seu dia
  // (`invoiceGenerationDay`, F89). Sem recuperar dia perdido: a rota
  // `billing/monthly-invoices/run` repoe o que faltou.
  @Cron('5 0 * * *', { name: 'gerar-faturas-do-mes', timeZone: FUSO_DOS_AGENDADORES })
```

Em `executarCiclo`, dentro do `try` de cada tenant:

```ts
        const resultado = await comContexto({ kind: 'tenant', tenantId }, async () => {
          const dia = await this.repositorio.diaDeGerarFaturas(tenantId);
          if (!ehDiaDeGerar(agora, dia)) return null;

          return this.gerar.executar(tenantId, agora);
        });

        if (resultado === null) {
          foraDoDia += 1;
          continue;
        }
```

Declare `let foraDoDia = 0;`, inclua `foraDoDia` no objeto devolvido e no tipo (`ResultadoDaGeracao & { tenants: number; foraDoDia: number }`). Atualize o docstring da classe: o job agora roda todo dia e o tenant escolhe o dia; o texto "todo dia 01" vira "no dia configurado (padrão 01)". Importe `ehDiaDeGerar` e `FUSO_DOS_AGENDADORES` de `./domain/configuracao-de-pagamento.js`.

- [ ] **Step 4: Teste de integração do ciclo (falha → passa)**

Em `billing-gerar-faturas-do-mes.int-spec.ts`: os casos atuais que chamam `executarCiclo`/o scheduler passam um `agora`; com o tenant em `invoiceGenerationDay` default 1, só geram se `agora` cair no dia 1 em Brasília. Ajuste esses `agora` para o dia 1 (ex.: `2026-12-01T12:00:00Z`) **sem mudar o que cada caso afirma**. Acrescente:

```ts
it('dois tenants com dias diferentes: so o do dia de hoje gera', async () => {
  // tenant A com invoiceGenerationDay 5, tenant B com 1; agora = 2026-11-05T12:00:00Z
  // ciclo: A cria faturas, B nao; resultado.foraDoDia >= 1
});
```

Run (descartável): `--testPathPattern billing-gerar-faturas-do-mes`. Expected: PASS.

- [ ] **Step 5: Suíte do billing e commit**

Run: unit do scheduler, `billing-gerar-faturas-do-mes`, `billing-inadimplencia`, typecheck, lint.

```bash
git add apps/api/src/modules/billing/gerar-faturas-do-mes-scheduler.service.ts apps/api/src/modules/billing/gerar-faturas-do-mes-scheduler.service.spec.ts apps/api/src/modules/billing/billing.repository.ts apps/api/test/integration/billing-gerar-faturas-do-mes.int-spec.ts
git commit -m "feat: gerador mensal roda todo dia e respeita o dia de gerar do tenant (F89, refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: admin-web — server action, tela e exemplo ao vivo

**Files:**
- Create: `apps/admin-web/app/actions/configuracao-de-pagamento.ts`
- Create: `apps/admin-web/app/actions/configuracao-de-pagamento.test.ts`
- Create: `apps/admin-web/app/(protected)/configuracao/page.tsx`
- Create: `apps/admin-web/app/(protected)/configuracao/pagamento/painel-de-pagamento.tsx`
- Create: `apps/admin-web/app/(protected)/configuracao/pagamento/painel-de-pagamento.test.tsx`
- Create: `apps/admin-web/app/(protected)/configuracao/pagamento/painel-de-pagamento.module.css`
- Create: `apps/admin-web/src/billing/exemplo-do-ciclo.ts`
- Create: `apps/admin-web/src/billing/exemplo-do-ciclo.test.ts`
- Modify: `apps/admin-web/app/(protected)/layout.tsx` (item de menu)
- Modify: `apps/admin-web/app/(protected)/navegacao.test.tsx` (se contar itens)

**Interfaces:**
- Consumes: API da Task 3 (`GET/PUT /api/v1/billing/settings`).
- Produces:
  - `exemploDoCiclo(c: ConfiguracaoDePagamento, referencia: { ano: number; mes: number }): { competencia: string; gerada: string; vence: string; bloqueia: string }` (strings PT-BR prontas: `"nov/26"`, `"01/11"`, `"10/11"`, `"15/11"`).
  - `salvarConfiguracaoDePagamento(anterior: EstadoDaConfiguracaoDePagamento, formulario: FormData): Promise<EstadoDaConfiguracaoDePagamento>` com `EstadoDaConfiguracaoDePagamento = { erro?: string; sucesso?: true }`.
  - Componente `PainelDePagamento({ inicial, podeEditar })`.

- [ ] **Step 1: Exemplo ao vivo (função pura, falha primeiro)**

`exemplo-do-ciclo.test.ts` (Vitest):

```ts
import { describe, expect, it } from 'vitest';

import { exemploDoCiclo } from './exemplo-do-ciclo';

describe('exemploDoCiclo', () => {
  it('padrao 1/10/5 em novembro de 2026', () => {
    expect(exemploDoCiclo({ invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 }, { ano: 2026, mes: 11 })).toEqual({
      competencia: 'nov/26', gerada: '01/11', vence: '10/11', bloqueia: '15/11',
    });
  });
  it('bloqueio que passa do fim do mes cai no mes seguinte', () => {
    expect(exemploDoCiclo({ invoiceGenerationDay: 1, dueDay: 28, graceDays: 5 }, { ano: 2026, mes: 11 }).bloqueia).toBe('03/12');
  });
  it('virada de ano', () => {
    expect(exemploDoCiclo({ invoiceGenerationDay: 1, dueDay: 28, graceDays: 10 }, { ano: 2026, mes: 12 }).bloqueia).toBe('07/01');
  });
});
```

Implementação (sem `Intl`, regra 5 do lint): meses `['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']`; `bloqueia` = `new Date(Date.UTC(ano, mes - 1, dueDay + graceDays))` formatado com `getUTCDate()`/`getUTCMonth()` e `padStart(2, '0')`; `competencia` = `${mesAbreviado}/${String(ano % 100).padStart(2, '0')}`.

Run: `pnpm --filter @arenahub/admin-web exec vitest run src/billing/exemplo-do-ciclo.test.ts`. FAIL → implemente → PASS.

- [ ] **Step 2: Server action**

Siga `app/actions/engagement.ts` (`salvarConfiguracaoDeEngajamento`). Regras:
- Lê `invoiceGenerationDay`, `dueDay`, `graceDays` do `FormData`; cada um tem de ser `string` não vazia que vira inteiro com `Number.isInteger`; senão devolve `{ erro: 'Preencha os três campos com números inteiros.' }` **sem chamar a API**.
- `chamarApi('/api/v1/billing/settings', { metodo: 'PUT', corpo })`.
- Mensagem por código estável: `BILLING_SETTINGS_INVALID` → "Confira os valores: gerar e vencer de 1 a 28, bloqueio de 1 a 30, e gerar não pode ser depois do vencimento."; `MENSAGEM_DE_SESSAO` espalhada como nos outros; padrão "Não foi possível salvar a configuração."
- Sucesso: `revalidatePath('/configuracao')` e `{ sucesso: true }`.

Teste (`configuracao-de-pagamento.test.ts`, siga `contratos.test.ts` para mockar `chamarApi`): afirma o **corpo enviado** (três inteiros, não strings), o caminho sem chamada para campo vazio/`10.5`/`abc`, e a mensagem do código `BILLING_SETTINGS_INVALID`.

- [ ] **Step 3: Painel**

`painel-de-pagamento.tsx` (`'use client'`), `useActionState(salvarConfiguracaoDePagamento, {})`, `useToastDeErro(estado.erro, 'error', 'erro-da-config-de-pagamento')`, toast de sucesso com `useToast()` quando `estado.sucesso` ("Configuração de pagamento salva."). Três `<Field>` numéricos (`type="number"`, `min`/`max` dos limites, `inputMode="numeric"`) com rótulos exatos:
- "Dia de gerar as parcelas" (ajuda: "Todo mês, neste dia, o sistema gera a parcela de cada aluno ativo.")
- "Dia do vencimento" (ajuda: "Dia do mês em que a parcela vence.")
- "Dias de bloqueio após o vencimento" (ajuda: "Quantos dias depois do vencimento a catraca deixa de liberar quem não pagou.")

Estado local dos três valores; abaixo, o **exemplo ao vivo** (`exemploDoCiclo(valores, referencia)`) em uma frase: "Parcela de {competencia}: gerada em {gerada}, vence em {vence}, catraca bloqueia em {bloqueia} às 00:00." Se os valores estiverem inválidos no cliente (gerar > vencer, fora do limite), mostre o motivo inline e desabilite Salvar. Aviso fixo sob o botão: "A mudança vale para as próximas parcelas. As parcelas já geradas não mudam." Com `podeEditar === false`: campos `disabled` e sem botão Salvar. `data-testid`: `config-gerar`, `config-vencer`, `config-bloqueio`, `config-exemplo`, `config-salvar`.

Estilos em `painel-de-pagamento.module.css` só com tokens do `DS-PAINEL.md` (copie a estrutura de `engagement/configuracao/configuracao.module.css`); nenhum hex literal.

Teste (`painel-de-pagamento.test.tsx`, Vitest + Testing Library, mock da action como em `painel-de-configuracao.test.tsx`): abre com 1/10/5 e o exemplo "nov/26"…; mudar o vencimento atualiza o exemplo; `gerar > vencer` desabilita Salvar e mostra o motivo; `podeEditar=false` não renderiza Salvar e os campos ficam `disabled`. (Clicar em form com `action` não roda no jsdom — o envio vai para o E2E da Task 6.)

- [ ] **Step 4: Página**

`app/(protected)/configuracao/page.tsx` (Server Component, `dynamic = 'force-dynamic'`, `metadata.title = 'Configuração — ArenaHub'`): `chamarApi<ConfiguracaoDePagamento>('/api/v1/billing/settings')`; erro → `ProblemDetail` como `engagement/page.tsx`. Descubra em `app/(protected)/layout.tsx` (~linha 337) de onde `permissions` vem e use a mesma fonte para `podeEditar = permissoes.has('billing.settings.manage')`. Renderiza `<Abas rotulo="Seções da configuração" abas={[{ id: 'pagamento', rotulo: 'Pagamento', conteudo: <PainelDePagamento .../> }]} />` (componente `src/components/abas`). `referencia` do exemplo = mês seguinte ao de hoje, calculado no servidor com `Date` (sem `Intl`).

- [ ] **Step 5: Menu**

Em `layout.tsx`, no grupo "Administração", depois de `{ href: '/units', label: 'Unidades' }`:

```ts
  { href: '/configuracao', label: 'Configuração', exigePermissao: 'billing.read' },
```

(visível a quem lê cobrança; só quem tem `billing.settings.manage` edita). Ajuste `navegacao.test.tsx`/`layout.test.tsx` se eles enumeram os itens.

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @arenahub/admin-web test`, `typecheck`, `lint` (use `--force` no lint por causa do cache do turbo; memória `turbo-cache-esconde-lint-vermelho`). Expected: verde. Suba o painel e **abra a tela** (memória `ci-verde-nao-prova-tela`) contra a API local com banco descartável; confirme visualmente o exemplo e o toast.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/app/actions/configuracao-de-pagamento.ts apps/admin-web/app/actions/configuracao-de-pagamento.test.ts "apps/admin-web/app/(protected)/configuracao" apps/admin-web/src/billing/exemplo-do-ciclo.ts apps/admin-web/src/billing/exemplo-do-ciclo.test.ts "apps/admin-web/app/(protected)/layout.tsx"
git commit -m "feat: menu Configuracao, aba Pagamento com exemplo ao vivo (F89, refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Inclua `navegacao.test.tsx`/`layout.test.tsx` no `git add` se tiverem mudado.)

---

### Task 6: E2E e verificação ponta a ponta

**Files:**
- Create: `apps/admin-web/tests/e2e/configuracao-de-pagamento.e2e-spec.ts`

**Interfaces:**
- Consumes: tudo acima.

- [ ] **Step 1: E2E**

Siga `apps/admin-web/tests/e2e/pagamento-em-lote.e2e-spec.ts` (login, tenant semeado). Fluxo: abrir `/configuracao`, ver `config-gerar=1`, `config-vencer=10`, `config-bloqueio=5` e o exemplo; trocar vencimento para 12 e bloqueio para 3; ver o exemplo atualizar; salvar; ver o toast de sucesso; recarregar e ver 1/12/3; restaurar 1/10/5 no fim para não vazar para outros E2E. Segundo caso: `gerar=15` com `vencer=10` → botão desabilitado.

- [ ] **Step 2: Rodar**

Antes: matar painel de outra árvore/projeto na porta 3000 (memórias `e2e-reusa-painel-de-outra-arvore` e `e2e-reusa-painel-de-outro-projeto`: conferir o dono do PID) e rebuildar (`next start` serve build antigo). Run: `pnpm test:e2e` (ou o filtro do arquivo). Expected: PASS, e a contagem de chips/outros E2E inalterada.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/tests/e2e/configuracao-de-pagamento.e2e-spec.ts
git commit -m "test: e2e da configuracao de pagamento (F89, refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Diária na tela de Cobrança (ajuste do PI)

**Contexto:** hoje "Vender diária" só existe na aba Plano da ficha (`students/[id]/page.tsx` ~linha 900, só quando o aluno está sem plano vigente). Na tela **Cobrança** (`students/[id]/billing`), um aluno sem assinatura vê só "Este aluno não tem assinatura ativa" (`painel-de-cobranca.tsx` ~linha 96). O PI quer a venda da diária **na mesma tela em que se recebe o plano**: com plano vinculado, a Cobrança fica como hoje; sem plano, mostra a diária. Pode ficar nas duas telas.

**Files:**
- Create: `apps/admin-web/src/billing/planos-de-diaria.ts` e `planos-de-diaria.test.ts`
- Modify: `apps/admin-web/app/(protected)/students/[id]/page.tsx` (usar o helper no lugar do `flatMap` inline, ~linhas 275-286)
- Modify: `apps/admin-web/app/(protected)/students/[id]/billing/page.tsx` (buscar planos, calcular `impedido`, passar `diaria`)
- Modify: `apps/admin-web/app/(protected)/students/[id]/billing/painel-de-cobranca.tsx` e `painel-de-cobranca.module.css`; teste novo ou existente do painel
- Modify: `apps/admin-web/app/actions/membership.ts` (`venderDiaria`: revalidar também a Cobrança) e o teste da action
- Modify: `apps/admin-web/tests/e2e/billing.e2e-spec.ts` (o `sem-assinatura-ativa` continua; acrescentar a diária)

**Interfaces:**
- Consumes: `VenderDiaria` (`students/[id]/vender-diaria.tsx`, props `{ studentId, planos, impedido, emAtraso? }`) e `PlanoDeDiaria` do mesmo arquivo; `impedeAcesso(situacao: string): boolean` de `src/students/formatar.ts`.
- Produces: `planosDeDiariaDe(planos: readonly PlanoDaLista[]): PlanoDeDiaria[]`, com `PlanoDaLista = { id: string; name: string; isActive: boolean; billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA'; currentPrice?: { amountMinor: number; currency: string } | null }`; prop opcional nova de `PainelDeCobranca`: `diaria?: { studentId: string; planos: readonly PlanoDeDiaria[]; impedido: boolean }`.

- [ ] **Step 1: Helper compartilhado (teste primeiro)**

`planos-de-diaria.test.ts` (Vitest):

```ts
import { describe, expect, it } from 'vitest';

import { planosDeDiariaDe } from './planos-de-diaria';

const preco = { amountMinor: 3000, currency: 'BRL' };

describe('planosDeDiariaDe', () => {
  it('so plano DIARIA, ativo e com preco vigente', () => {
    const lista = [
      { id: 'a', name: 'Diaria', isActive: true, billingMode: 'DIARIA' as const, currentPrice: preco },
      { id: 'b', name: 'Mensal', isActive: true, billingMode: 'AVULSO' as const, currentPrice: preco },
      { id: 'c', name: 'Diaria inativa', isActive: false, billingMode: 'DIARIA' as const, currentPrice: preco },
      { id: 'd', name: 'Diaria sem preco', isActive: true, billingMode: 'DIARIA' as const, currentPrice: null },
      { id: 'e', name: 'Sem modo', isActive: true },
    ];

    expect(planosDeDiariaDe(lista)).toEqual([
      { id: 'a', name: 'Diaria', amountMinor: 3000, currency: 'BRL' },
    ]);
  });
});
```

Implementação (`planos-de-diaria.ts`) = o `flatMap` hoje inline em `page.tsx` (linhas ~275-286), movido sem mudar o comportamento:

```ts
import type { PlanoDeDiaria } from '../../app/(protected)/students/[id]/vender-diaria';

export interface PlanoDaLista {
  id: string;
  name: string;
  isActive: boolean;
  billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA';
  currentPrice?: { amountMinor: number; currency: string } | null;
}

/** Planos que a recepcao pode vender como diaria: modalidade DIARIA, ativo e com preco vigente. */
export function planosDeDiariaDe(planos: readonly PlanoDaLista[]): PlanoDeDiaria[] {
  return planos.flatMap((p) =>
    p.billingMode === 'DIARIA' && p.isActive && p.currentPrice
      ? [{ id: p.id, name: p.name, amountMinor: p.currentPrice.amountMinor, currency: p.currentPrice.currency }]
      : [],
  );
}
```

Em `students/[id]/page.tsx`, troque o bloco `const planosDeDiaria = planos.flatMap(...)` por `const planosDeDiaria = planosDeDiariaDe(planos);` (importe o helper). Comportamento idêntico; os testes existentes da ficha seguem verdes.

- [ ] **Step 2: Página de Cobrança busca os planos**

Em `billing/page.tsx`, acrescente `chamarApi<PlanoDaLista[]>('/api/v1/plans')` ao `Promise.all` (linha ~105). Falha ao listar planos **não derruba a tela**: use `resposta.dados ?? []` (sem plano de diária o `VenderDiaria` já mostra a nota "Nenhum plano de diária ativo com preço…"). Calcule:

```ts
const diaria = {
  studentId: id,
  planos: planosDeDiariaDe(respostaDosPlanos.dados ?? []),
  impedido: aluno !== null && impedeAcesso(aluno.status),
};
```

(use o nome real da variável do aluno nessa página) e passe `diaria={diaria}` ao `PainelDeCobranca`.

- [ ] **Step 3: Painel mostra a diária só quando não há plano (teste primeiro)**

No teste do painel (crie `painel-de-cobranca.test.tsx` se não existir; siga `faixa-de-meses.test.tsx` para mockar `next/navigation` e as actions), casos:

```tsx
const diaria = {
  studentId: 's1',
  planos: [{ id: 'p', name: 'Diaria', amountMinor: 3000, currency: 'BRL' }],
  impedido: false,
};

it('sem assinatura: mostra o vazio E a venda de diaria', () => {
  render(<PainelDeCobranca subscriptionId={null} subscriptionIdParaPagamento={null} mesesPagaveis={[]} diaria={diaria} />);
  expect(screen.getByTestId('sem-assinatura-ativa')).toBeInTheDocument();
  expect(screen.getByTestId('abrir-venda-de-diaria')).toBeInTheDocument();
});

it('com assinatura ativa: NAO mostra a venda de diaria', () => {
  render(<PainelDeCobranca subscriptionId="sub" subscriptionIdParaPagamento="sub" mesesPagaveis={[]} diaria={diaria} />);
  expect(screen.queryByTestId('abrir-venda-de-diaria')).not.toBeInTheDocument();
});

it('assinatura suspensa (so faixa de meses): NAO mostra a venda de diaria', () => {
  render(<PainelDeCobranca subscriptionId={null} subscriptionIdParaPagamento="sub" mesesPagaveis={[]} diaria={diaria} />);
  expect(screen.queryByTestId('abrir-venda-de-diaria')).not.toBeInTheDocument();
});

it('aluno impedido: mostra o aviso, nao o botao', () => {
  render(<PainelDeCobranca subscriptionId={null} subscriptionIdParaPagamento={null} mesesPagaveis={[]} diaria={{ ...diaria, impedido: true }} />);
  expect(screen.getByTestId('diaria-impedida')).toBeInTheDocument();
  expect(screen.queryByTestId('abrir-venda-de-diaria')).not.toBeInTheDocument();
});
```

Implementação em `painel-de-cobranca.tsx`: nova prop opcional `diaria`. No ramo `subscriptionId === null && subscriptionIdParaPagamento === null`, mantenha o `EmptyState` (`testId="sem-assinatura-ativa"`, mesmo título) mas troque o `hint` por `"Atribua um plano na aba Plano ou venda uma diária abaixo."` e, **depois** dele, renderize quando `diaria !== undefined`:

```tsx
<div className={estilos['diaria']} data-testid="diaria-na-cobranca">
  <h3>Diária</h3>
  <p className={estilos['nota']}>Acesso pago no balcão, válido até 23:59 de hoje.</p>
  <VenderDiaria studentId={diaria.studentId} planos={diaria.planos} impedido={diaria.impedido} />
</div>
```

Importe `VenderDiaria` de `'../vender-diaria'`. Acrescente `.diaria` (e `.nota`, se faltar) em `painel-de-cobranca.module.css` só com tokens do `DS-PAINEL.md`, sem hex. Hoje o único teste que olha o vazio é `tests/e2e/billing.e2e-spec.ts:62` (por testid, que não muda); se algum teste unitário afirma o texto do `hint`, atualize-o.

- [ ] **Step 4: Atualizar a Cobrança depois da venda**

Em `app/actions/membership.ts`, na `venderDiaria`, ao lado de `revalidatePath(`/students/${analisado.data.studentId}`)` (linha ~747) acrescente `revalidatePath(`/students/${analisado.data.studentId}/billing`)`. No teste da action, afirme as **duas** revalidações.

- [ ] **Step 5: E2E**

Em `tests/e2e/billing.e2e-spec.ts` (linha ~62, caso do aluno sem assinatura): além de `sem-assinatura-ativa`, afirme `abrir-venda-de-diaria` visível. Se o fluxo de venda da diária já tem E2E (`grep -rn "venda-de-diaria" apps/admin-web/tests`), reutilize-o para vender **a partir da Cobrança** e conferir o toast "Diária paga". Rebuilde o painel antes de rodar (o `next start` serve build antigo).

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @arenahub/admin-web test`, `typecheck`, `lint --force`. Suba o painel e **abra** a Cobrança de um aluno sem plano e a de um com plano, contra o banco descartável; confira a diferença. Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/billing/planos-de-diaria.ts apps/admin-web/src/billing/planos-de-diaria.test.ts "apps/admin-web/app/(protected)/students/[id]/page.tsx" "apps/admin-web/app/(protected)/students/[id]/billing" apps/admin-web/app/actions/membership.ts apps/admin-web/tests/e2e/billing.e2e-spec.ts
git commit -m "feat: venda de diaria tambem na tela de Cobranca do aluno sem plano (F89, ajuste do PI, refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Inclua no `git add` o teste da action, se ele ficar fora dos caminhos acima.)

---

### Task 8: Documentação e gate local

**Files:**
- Modify: `docs/CONVENTION.md` (INV-164)
- Modify: `docs/STATUS.md` (linha F89 no Índice Fatia ↔ SPEC, depois da F88)
- Modify: `docs/DEVELOPMENT.md` (linha F89)
- Modify: `reports/TESTS.md` e `reports/.test-report-cache.json` (via `pnpm test:report`)

- [ ] **Step 1: INV-164**

Na INV-164 (job mensal), troque "todo dia 01, vencimento dia 10" por "no dia configurado do tenant (`BillingSettings.invoiceGenerationDay`, padrão 01), vencimento em `dueDay` (padrão 10), bloqueio `graceDays` dias depois (padrão 5)", e acrescente: "Configurável pelo dono em Configuração > Pagamento (F89); a mudança vale só para parcelas futuras — `dueAt` e `blockAt` ficam congelados na abertura da parcela." Mesma coisa em qualquer emenda de ADR-063/ADR-065/ADR-019 que cite "dia 10 fixo": acrescente nota "padrão; configurável por tenant desde a F89".

- [ ] **Step 2: STATUS e DEVELOPMENT**

`STATUS.md`: nova linha `| F89 | SPEC-089 | 2 | — | Configuração > Pagamento: dia de gerar, vencimento e bloqueio configuráveis | [SPEC-089…](specs/SPEC-089-configuracao-de-pagamento.md) | [#624](https://github.com/RodReis/arenahub/issues/624) | ✅ entregue em <data> (PR a preencher) … |` no mesmo formato da linha F88. `DEVELOPMENT.md`: linha F89 no padrão da F88, com a nota de produção: "no deploy nada muda (padrão 1/10/5); a migration cria a coluna, os checks e a permissão".

- [ ] **Step 3: Gate local completo**

Run, nesta ordem, na raiz (ver memória `gate-local-antes-do-push`): `pnpm install --frozen-lockfile`, `pnpm lint --force`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` (no descartável), `pnpm build`. Depois `pnpm test:report` e **confira o total de integração por duas medições** (memória `test-report-herda-numero-antigo`). Todo vermelho que não seja seu: `git stash` prova se é pré-existente (e recrie o banco dos dois lados, memória `stash-invalida-banco-de-teste`).

- [ ] **Step 4: Commit dos docs**

```bash
git add docs/CONVENTION.md docs/STATUS.md docs/DEVELOPMENT.md reports/TESTS.md reports/.test-report-cache.json
git commit -m "docs: INV-164, STATUS e DEVELOPMENT da F89 (refs #624)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Fechar a entrega**

Com o gate verde, siga o fluxo de PR do projeto: `git push -u origin feat/f89-configuracao-pagamento`, PR com `refs #624` (o corpo cita a spec, o desenho, o ajuste do PI da diária na Cobrança e o ruling R7), `gh run watch <id> --exit-status` em background com aviso de espera, conferir job a job, merge, preencher o PR no `TESTS.md`, `fechar-card` e `proplan:done`. O aceite é do PI.
