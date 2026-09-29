# Situação Financeira na Grid de Alunos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na grid de Alunos (`/students`), a coluna Situação passa a mostrar a situação financeira (Em dia/Vence hoje/Bloqueio próximo/Vencida) para aluno `ACTIVE`, a coluna Motivo ganha a frase correspondente com contagem de dias, a coluna vira ordenável no servidor, "ID da catraca" vira "CATRACA", Motivo alinha à esquerda, e confirma-se (sem código, é dado ausente na base atual) que o botão "Liberar catraca" já funciona para aluno `BLOCKED`.

**Architecture:** A regra de vencimento já existe em `apps/admin-web/src/billing/vencimento.ts` (função pura `situacaoDeVencimento`, testada). Este plano: (1) adiciona uma `StateMachine` nova no design system (`@arenahub/ui`) para rotular os 4 estados financeiros com tom/ícone; (2) troca a `render` da coluna Situação no `page.tsx` para escolher entre badge de status e badge financeiro conforme o status do aluno; (3) adiciona duas funções puras de frase em `vencimento.ts` para a coluna Motivo; (4) replica a MESMA regra de prioridade em SQL raw no `student.repository.ts` da API, com um teste de paridade que roda os mesmos casos de borda contra TS e SQL.

**Tech Stack:** Next.js App Router (Server Component), NestJS + Prisma (`$queryRaw`), Vitest, PostgreSQL (`AT TIME ZONE`).

**Spec:** Nenhum arquivo de spec separado — este plano nasceu de brainstorming bounded-turned-architectural direto em chat (mudança contida a uma grid existente, sem novo subsistema). O design acordado com o PI está resumido nas seções abaixo; não há `docs/superpowers/specs/*.md` companheiro.

## Global Constraints

- Domínio em inglês, textos de interface em pt-BR (`CLAUDE.md`).
- Função de cálculo pura — sem banco, rede ou relógio; `agora` entra por parâmetro (`CLAUDE.md`, Convenções).
- `tenant_id` sempre via `TenantContext`/RLS (`comTenant`) — nunca `findMany`/`$queryRaw` fora da transação com RLS (regra de arquitetura nº 2, e o precedente de `idsPorNomeSemAcento` já usa `tx.$queryRaw` dentro de `comTenant`).
- Nenhuma regra de negócio nova reimplementada sem teste de paridade quando duplicada em duas linguagens (TS e SQL) — ver Review Focus.
- `StateMachine`/`STATE_LABELS` é dicionário fechado; todo estado novo precisa de `label`, `tone`, `icon` e teste (`state-labels.spec.ts`).
- Rótulo `Ausente` (não `—` cru) para célula sem dado, padrão já usado em toda a grid.
- Coluna de tabela declara `role` explícito (`CelulasDeTabela`/`DataTable`) — nunca nasce "neutra" sem decisão.

## A semântica REAL dos 4 estados — leia antes de qualquer task

Esta seção existe porque a primeira versão deste plano errou aqui, e o erro
sobreviveria aos testes. Foi corrigida depois de executar a lógica real
(`node` contra a implementação de `vencimento.ts`) e o SQL real (`psql`).

`situacaoDeVencimento` (`apps/admin-web/src/billing/vencimento.ts:106`) decide
nesta ordem, e **`BLOQUEIO_PROXIMO` é o estado mais grave, não um aviso
antecipado**:

| Condição (dia civil, fuso da unidade) | Estado | Significado real |
|---|---|---|
| invoice não é `OPEN`/`OVERDUE` | `EM_DIA` | paga/cancelada — nunca vencida |
| `dueAt` > hoje | `EM_DIA` | ainda vai vencer |
| `dueAt` == hoje | `VENCE_EM_BREVE` | vence hoje, ainda não venceu |
| `dueAt` < hoje **e** `blockAt` != null **e** `blockAt` <= hoje | `BLOQUEIO_PROXIMO` | **o bloqueio JÁ CHEGOU** |
| `dueAt` < hoje (demais casos) | `VENCIDA` | venceu; bloqueio ainda no futuro ou inexistente |

Consequências que mudam o código deste plano:

1. **`BLOQUEIO_PROXIMO` NUNCA tem "N dias até o bloqueio"** — por definição
   `blockAt <= hoje`, então qualquer contagem de dias futuros dá zero. A frase
   "Bloqueio da catraca em N dias" é impossível nesse estado. Não existe
   `diasAteBloqueio`; a função foi removida deste plano.
2. **`VENCIDA` é o estado que tem bloqueio no futuro**, quando há `blockAt`.
   É nele que faz sentido dizer "bloqueio em N dias" — e é opcional, porque
   `blockAt` pode ser `null`.
3. **A gravidade cresce assim:** `EM_DIA` < `VENCE_EM_BREVE` < `VENCIDA` <
   `BLOQUEIO_PROXIMO`. A ordenação da Task 7 usa exatamente esta escala.

Verificado por execução, não por leitura:

```
blockAt 2026-09-26, agora 2026-09-25 (SP) -> VENCIDA        (não BLOQUEIO_PROXIMO)
blockAt 2026-09-28, agora 2026-09-25 (SP) -> VENCIDA        (não BLOQUEIO_PROXIMO)
blockAt 2026-09-25, agora 2026-09-25 (SP) -> BLOQUEIO_PROXIMO
blockAt 2026-09-22, agora 2026-09-25 (SP) -> BLOQUEIO_PROXIMO
```

## Review Focus

- **Aluno `ACTIVE` sem `invoiceParaAviso`/`timezoneDaUnidade`** (sem fatura em aberto, ou unidade sem fuso cadastrado): a coluna Situação deve continuar mostrando o badge de status `ACTIVE` normal, nunca um badge financeiro incompleto ou quebrado.
- **`BLOQUEIO_PROXIMO` no limiar exato** (`blockAt` cai exatamente no dia civil de hoje, no fuso da unidade): TS e SQL precisam concordar. Atenção à assimetria documentada em `vencimento.ts:140` — `dueAt`/`blockAt` são lidos em **UTC** (são datas-calendário gravadas como meia-noite UTC), enquanto `agora` é convertido para o **fuso da unidade**. O SQL precisa da mesma assimetria: `(col AT TIME ZONE 'UTC')::date` de um lado, `(now() AT TIME ZONE gu.timezone)::date` do outro. Converter os dois pelo mesmo fuso erra por um dia.
- **Direção do primeiro clique**: `DataTable.tsx:235` faz o primeiro clique numa coluna ser sempre `asc`. A escala de prioridade precisa ser montada para que `asc` traga **os problemas ao topo** — a recepção clica em "Situação" para achar quem está devendo, não para ver quem está em dia.
- **Ordenação com paginação por cursor**: ordenar por `situacao` e depois clicar em "Próximos" não pode pular nem repetir aluno — precisa de critério de desempate estável (`id`) como as outras ordens já têm.
- **Aluno sem nenhuma invoice `OPEN`/`OVERDUE`** mas com assinatura `PAST_DUE`: `situacaoDeVencimento` deriva do `status` da invoice, não da assinatura — confirmar que o SQL usa o mesmo critério (`invoices.status IN ('OPEN','OVERDUE')`), não `subscriptions.status`.
- **Duas invoices em aberto do mesmo aluno com `due_at` igual**: o TS desempata por `id` (`faturaEmDestaque`); o SQL precisa do mesmo desempate (`DISTINCT ON ... ORDER BY due_at ASC, id ASC`) para escolher a mesma invoice que a grid mostra, senão a ordenação discorda do que a célula exibe.
- **Aluno sem `gym_unit_id` ou unidade sem `timezone`**: o `JOIN` do SQL precisa ser `LEFT JOIN` com fallback, ou o aluno **some da lista** ao ordenar por situação — desaparecimento silencioso é pior que ordem errada.

---

## File Structure

- **Modify** `packages/ui/src/domain/state-labels.ts` — nova `StateMachine` `'paymentStanding'` + 4 entradas no dicionário.
- **Modify** `packages/ui/src/domain/state-labels.spec.ts` — testes da máquina nova.
- **Modify** `apps/admin-web/src/billing/vencimento.ts` — uma função nova: `fraseDeVencimento`.
- **Modify** `apps/admin-web/src/billing/vencimento.test.ts` — 8 casos da função nova.
- **Modify** `apps/admin-web/app/(protected)/students/page.tsx` — `render` da coluna Situação, `render` da coluna Motivo, `header` da coluna catraca, `sortKey` da coluna Situação.
- **Modify** `apps/admin-web/app/(protected)/students/page.test.tsx` — suíte que **já existe** (143 linhas); ganha os casos da situação financeira.
- **Modify** `apps/api/src/modules/students/students.controller.ts` — `ordemDeListagem` aceita `'situacao'`.
- **Modify** `apps/api/src/modules/students/student.repository.ts` — extrai `INCLUDE_DA_LISTAGEM`, ramifica `buscar` para `ordem === 'situacao'`, adiciona `idsOrdenadosPorSituacaoFinanceira` e `paginarIds`.
- **Create** `apps/api/test/integration/students-ordenar-por-situacao.int-spec.ts` — 7 casos: ordem, direção, desempate, cursor, aluno sem fatura, filtro combinado, paridade TS/SQL.

**Nenhum CSS muda.** A investigação da Task 5 (feita na revisão) mostrou que `text-align: left` já é a regra base de toda célula.

---

## Task 1: `StateMachine` financeira no design system

**Files:**
- Modify: `packages/ui/src/domain/state-labels.ts`
- Test: `packages/ui/src/domain/state-labels.spec.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `StateMachine` inclui `'paymentStanding'`; `STATE_LABELS.paymentStanding` com chaves `'EM_DIA' | 'VENCE_EM_BREVE' | 'BLOQUEIO_PROXIMO' | 'VENCIDA'`. Usado pela Task 3 via `<StateBadge machine="paymentStanding" state={...} />`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `packages/ui/src/domain/state-labels.spec.ts` (dentro do `describe('state-labels', ...)` existente):

```typescript
  it('paymentStanding cobre os 4 estados de situacaoDeVencimento, com tom crescente de gravidade', () => {
    expect(stateLabel('paymentStanding', 'EM_DIA')).toEqual({
      label: 'Em dia',
      tone: 'success',
      icon: 'check-circle',
    });
    expect(stateLabel('paymentStanding', 'VENCE_EM_BREVE')).toEqual({
      label: 'Vence hoje',
      tone: 'warning',
      icon: 'alert-circle',
    });
    expect(stateLabel('paymentStanding', 'BLOQUEIO_PROXIMO')).toEqual({
      label: 'Bloqueio próximo',
      tone: 'risk',
      icon: 'alert-triangle',
    });
    expect(stateLabel('paymentStanding', 'VENCIDA')).toEqual({
      label: 'Vencida',
      tone: 'danger',
      icon: 'x-circle',
    });
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @arenahub/ui test -- state-labels`
Expected: FAIL — `Property 'paymentStanding' does not exist` (erro de tipo) ou `stateLabel` devolve `undefined`.

- [ ] **Step 3: Implementar**

Em `packages/ui/src/domain/state-labels.ts`, adicionar `'paymentStanding'` à união `StateMachine` (após `'rankingSnapshot'`, mantendo a lista alfabética/temática que já existe não é exigida — basta adicionar a linha):

```typescript
  | 'rankingSnapshot'
  /**
   * Situacao FINANCEIRA do aluno ATIVO -- espelha os 4 valores de
   * `situacaoDeVencimento` (`apps/admin-web/src/billing/vencimento.ts`).
   *
   * NAO E O STATUS DO ALUNO (`student`): um aluno pode estar `ACTIVE` e em
   * qualquer um destes 4 estados financeiros ao mesmo tempo. Maquina propria
   * porque as duas perguntas sao diferentes -- "ele pode treinar?" contra
   * "ele esta pagando em dia?" -- e a coluna Situacao da grid de Alunos
   * mostra APENAS UMA das duas por vez, conforme o status do aluno.
   */
  | 'paymentStanding';
```

E adicionar a entrada no dicionário `STATE_LABELS`, logo após o bloco `rankingSnapshot: { ... },`:

```typescript
  paymentStanding: {
    EM_DIA: { label: 'Em dia', tone: 'success', icon: 'check-circle' },
    VENCE_EM_BREVE: { label: 'Vence hoje', tone: 'warning', icon: 'alert-circle' },
    /**
     * `risk`, nao `warning` nem `danger`: mais grave que "vence hoje"
     * (ainda entra, mas por pouco tempo) e menos definitivo que "vencida"
     * (ja passou do prazo). Mesmo tom que `riskBand.HIGH` usa para o mesmo
     * proposito -- alertar sem afirmar o pior caso.
     */
    BLOQUEIO_PROXIMO: { label: 'Bloqueio próximo', tone: 'risk', icon: 'alert-triangle' },
    VENCIDA: { label: 'Vencida', tone: 'danger', icon: 'x-circle' },
  },
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @arenahub/ui test -- state-labels`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/domain/state-labels.ts packages/ui/src/domain/state-labels.spec.ts
git commit -m "feat: rotulos da situacao financeira do aluno (paymentStanding)"
```

---

## Task 2: Frases de Motivo com dias — `vencimento.ts`

**Files:**
- Modify: `apps/admin-web/src/billing/vencimento.ts`
- Test: `apps/admin-web/src/billing/vencimento.test.ts`

**Interfaces:**
- Consumes: `InvoiceParaAviso`, `SituacaoDeVencimento`, `diasDeAtraso`, `diferencaEmDias` (privada, mesmo módulo) — todos já existem em `vencimento.ts`.
- Produces: `fraseDeVencimento(situacao: SituacaoDeVencimento, invoice: InvoiceParaAviso, agora: Date, timezone: string): string | null`. Consumida pela Task 3 na coluna Motivo.

> **LEIA A SEÇÃO "A semântica REAL dos 4 estados" no topo deste plano antes
> de escrever qualquer linha desta task.** `BLOQUEIO_PROXIMO` significa que o
> bloqueio **já chegou** (`blockAt <= hoje`), não que faltam N dias. Escrever
> "bloqueio em N dias" nesse estado produz sempre "em 0 dias".

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `apps/admin-web/src/billing/vencimento.test.ts`. O arquivo
usa `import { describe, expect, it } from 'vitest'` e chama as funções direto,
sem helper de data — seguir o mesmo estilo. Ampliar o `import` existente na
linha 3 para incluir `fraseDeVencimento`.

Cada cenário abaixo foi **verificado por execução** contra a lógica real: o
comentário diz qual estado `situacaoDeVencimento` produz de fato para aquele
`invoice`/`agora`.

```typescript
describe('fraseDeVencimento', () => {
  const tz = 'America/Sao_Paulo';
  const agora = new Date('2026-09-25T12:00:00Z');

  it('EM_DIA nao tem frase -- a celula mostra Ausente', () => {
    expect(
      fraseDeVencimento(
        'EM_DIA',
        { status: 'OPEN', dueAt: '2026-10-05T00:00:00Z', blockAt: null },
        agora,
        tz,
      ),
    ).toBeNull();
  });

  it('VENCE_EM_BREVE diz que vence hoje, sem numero', () => {
    expect(
      fraseDeVencimento(
        'VENCE_EM_BREVE',
        { status: 'OPEN', dueAt: '2026-09-25T00:00:00Z', blockAt: null },
        agora,
        tz,
      ),
    ).toBe('Mensalidade vence hoje');
  });

  /*
   * BLOQUEIO_PROXIMO E O ESTADO MAIS GRAVE: `blockAt` ja chegou. Nao existe
   * "faltam N dias" aqui -- por definicao o prazo acabou. A frase diz o que a
   * recepcao precisa saber: a catraca esta fechando por este aluno.
   */
  it('BLOQUEIO_PROXIMO diz que o bloqueio chegou, quando blockAt e hoje', () => {
    expect(
      fraseDeVencimento(
        'BLOQUEIO_PROXIMO',
        { status: 'OVERDUE', dueAt: '2026-09-20T00:00:00Z', blockAt: '2026-09-25T00:00:00Z' },
        agora,
        tz,
      ),
    ).toBe('Bloqueio da catraca a partir de hoje');
  });

  it('BLOQUEIO_PROXIMO diz ha quantos dias bloqueou, quando blockAt ja passou', () => {
    expect(
      fraseDeVencimento(
        'BLOQUEIO_PROXIMO',
        { status: 'OVERDUE', dueAt: '2026-09-15T00:00:00Z', blockAt: '2026-09-22T00:00:00Z' },
        agora,
        tz,
      ),
    ).toBe('Catraca bloqueada há 3 dias');
  });

  it('BLOQUEIO_PROXIMO no singular', () => {
    expect(
      fraseDeVencimento(
        'BLOQUEIO_PROXIMO',
        { status: 'OVERDUE', dueAt: '2026-09-15T00:00:00Z', blockAt: '2026-09-24T00:00:00Z' },
        agora,
        tz,
      ),
    ).toBe('Catraca bloqueada há 1 dia');
  });

  /*
   * VENCIDA com `blockAt` no FUTURO e o unico estado onde "bloqueio em N
   * dias" e verdade -- e e a informacao acionavel: da para cobrar antes de a
   * catraca fechar.
   */
  it('VENCIDA anuncia o bloqueio futuro quando ha blockAt', () => {
    expect(
      fraseDeVencimento(
        'VENCIDA',
        { status: 'OVERDUE', dueAt: '2026-09-20T00:00:00Z', blockAt: '2026-09-28T00:00:00Z' },
        agora,
        tz,
      ),
    ).toBe('Mensalidade vencida há 5 dias — bloqueio em 3 dias');
  });

  it('VENCIDA com bloqueio amanha usa o singular nos dois numeros', () => {
    expect(
      fraseDeVencimento(
        'VENCIDA',
        { status: 'OVERDUE', dueAt: '2026-09-24T00:00:00Z', blockAt: '2026-09-26T00:00:00Z' },
        agora,
        tz,
      ),
    ).toBe('Mensalidade vencida há 1 dia — bloqueio em 1 dia');
  });

  it('VENCIDA sem blockAt fala so do vencimento', () => {
    expect(
      fraseDeVencimento(
        'VENCIDA',
        { status: 'OVERDUE', dueAt: '2026-09-18T00:00:00Z', blockAt: null },
        agora,
        tz,
      ),
    ).toBe('Mensalidade vencida há 7 dias');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter admin-web test -- vencimento`
Expected: FAIL — `fraseDeVencimento is not a function` / erro de import.

- [ ] **Step 3: Implementar**

Adicionar ao final de `apps/admin-web/src/billing/vencimento.ts`:

```typescript
/**
 * A frase da coluna MOTIVO para a situacao financeira da linha -- `null`
 * quando `EM_DIA`, que e o caso comum e nao precisa de explicacao (a celula
 * mostra `Ausente`, como qualquer motivo vazio na grid).
 *
 * SEPARADA de `situacaoDeVencimento`: aquela decide o ESTADO, esta so
 * formata o texto para o estado ja decidido -- quem chama sempre calcula os
 * dois com o MESMO `invoice`/`agora`/`timezone`, senao a frase falaria de um
 * instante diferente do que a badge ao lado mostra.
 *
 * `BLOQUEIO_PROXIMO` NAO ANUNCIA PRAZO FUTURO, e o nome do estado engana:
 * ele so e alcancado quando `blockAt <= hoje` (ver `situacaoDeVencimento`
 * acima), ou seja, o bloqueio JA VALE. Quem tem bloqueio marcado para o
 * futuro esta em `VENCIDA` -- e e la que a contagem regressiva aparece,
 * porque la ela e acionavel: da para cobrar antes de a catraca fechar.
 */
export function fraseDeVencimento(
  situacao: SituacaoDeVencimento,
  invoice: InvoiceParaAviso,
  agora: Date,
  timezone: string,
): string | null {
  switch (situacao) {
    case 'EM_DIA':
      return null;

    case 'VENCE_EM_BREVE':
      return 'Mensalidade vence hoje';

    case 'BLOQUEIO_PROXIMO': {
      // `blockAt` nunca e nulo aqui -- `situacaoDeVencimento` so devolve este
      // estado depois de checa-lo. O `?? ''` existe so para o compilador:
      // `diferencaEmDias` pede `string`, e o estreitamento nao atravessa a
      // fronteira da funcao.
      const dias = -diferencaEmDias(invoice.blockAt ?? '', agora, timezone);

      if (dias <= 0) return 'Bloqueio da catraca a partir de hoje';

      return `Catraca bloqueada há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    }

    case 'VENCIDA': {
      const atraso = diasDeAtraso(invoice, agora, timezone);
      const base = `Mensalidade vencida há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}`;

      if (invoice.blockAt === null) return base;

      // Aqui `blockAt` esta no FUTURO -- se estivesse no passado ou hoje, o
      // estado seria `BLOQUEIO_PROXIMO`, nao `VENCIDA`.
      const ateBloquear = diferencaEmDias(invoice.blockAt, agora, timezone);

      return `${base} — bloqueio em ${ateBloquear} ${ateBloquear === 1 ? 'dia' : 'dias'}`;
    }
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter admin-web test -- vencimento`
Expected: PASS — os 8 casos novos, mais os antigos de `situacaoDeVencimento`/`faturaEmDestaque`/`diasDeAtraso` intactos.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/billing/vencimento.ts apps/admin-web/src/billing/vencimento.test.ts
git commit -m "feat: frase de motivo para cada situacao financeira do aluno"
```

---

## Task 3: Coluna Situação vira financeira para aluno ATIVO; coluna Motivo ganha a frase

**Files:**
- Modify: `apps/admin-web/app/(protected)/students/page.tsx`

**Interfaces:**
- Consumes: `stateLabel`/`StateBadge machine="paymentStanding"` (Task 1), `fraseDeVencimento` (Task 2), `situacaoDeVencimento` (já importado), `MOTIVO_DA_SITUACAO` (já importado).
- Produces: nada consumido por tarefa posterior — mudança de UI terminal para esta grid.

> **EXISTE SUÍTE DE TESTE PARA ESTA GRID** —
> `apps/admin-web/app/(protected)/students/page.test.tsx` (143 linhas,
> Vitest + Testing Library, renderiza o Server Component direto com
> `chamarApi` mockado). Ela já tem fixtures `BASE` (ACTIVE), `BLOQUEADO`
> (BLOCKED/DELINQUENCY) e `SUSPENSO` (SUSPENDED/MEDICAL). Esta task é TDD
> em cima dela, não "só mudança visual".
>
> Um teste existente **vai quebrar de propósito** e precisa ser atualizado
> junto: `'nao mostra motivo para aluno ativo'` (linha ~108) afirma que
> `motivo-${BASE.id}` não existe para aluno ativo. Continua verdade — `BASE`
> tem `invoiceParaAviso: null`, então cai no caminho de status e a célula
> segue `Ausente`. **Confirme que ele passa sem alteração**; se quebrar, a
> condição `podeSerFinanceira` está errada.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `apps/admin-web/app/(protected)/students/page.test.tsx`, dentro do `describe('grid de alunos', ...)`. As fixtures novas reaproveitam `BASE`:

```tsx
/*
 * A data é RELATIVA a hoje, nunca literal: `page.tsx` usa `new Date()` como
 * "agora", que o teste não controla. Data fixa faria o CI ficar vermelho
 * sozinho semanas depois, sem ninguém ter mexido em nada.
 */
function emDias(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);

  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

const ATIVO_VENCIDO = {
  ...BASE,
  id: '44444444-4444-4444-8444-444444444444',
  fullName: 'Marcos Vinicius Alves',
  status: 'ACTIVE',
  invoiceParaAviso: { status: 'OVERDUE', dueAt: emDias(-7), blockAt: null },
};

const ATIVO_VENCE_HOJE = {
  ...BASE,
  id: '55555555-5555-4555-8555-555555555555',
  fullName: 'Carla Souza Lima',
  status: 'ACTIVE',
  invoiceParaAviso: { status: 'OPEN', dueAt: emDias(0), blockAt: null },
};

const ATIVO_BLOQUEIO_CHEGOU = {
  ...BASE,
  id: '66666666-6666-4666-8666-666666666666',
  fullName: 'Paulo Henrique Dias',
  status: 'ACTIVE',
  invoiceParaAviso: { status: 'OVERDUE', dueAt: emDias(-15), blockAt: emDias(-2) },
};

const ATIVO_EM_DIA = {
  ...BASE,
  id: '77777777-7777-4777-8777-777777777777',
  fullName: 'Renata Campos Melo',
  status: 'ACTIVE',
  invoiceParaAviso: { status: 'OPEN', dueAt: emDias(+10), blockAt: null },
};

/**
 * A COLUNA SITUACAO RESPONDE "ELE ESTA PAGANDO?" PARA QUEM ESTA ATIVO.
 *
 * Antes desta fatia ela dizia sempre "Ativo" -- verdade inutil para a
 * recepcao, que ja sabe que o aluno esta ativo porque ele esta na frente
 * dela. O que ela precisa saber e se pode liberar sem cobrar.
 */
it('mostra a situacao financeira no lugar do status, para aluno ativo', async () => {
  await renderizar([ATIVO_VENCIDO]);

  expect(screen.getByText('Vencida')).toBeInTheDocument();
  expect(screen.queryByText('Ativo')).not.toBeInTheDocument();
});

it('mostra "Vence hoje" para quem vence no dia', async () => {
  await renderizar([ATIVO_VENCE_HOJE]);

  expect(screen.getByText('Vence hoje')).toBeInTheDocument();
});

/*
 * BLOQUEIO_PROXIMO E O ESTADO MAIS GRAVE -- `blockAt` JA passou. Ver "A
 * semantica REAL dos 4 estados" no plano: nao e aviso de bloqueio futuro.
 */
it('mostra "Bloqueio proximo" para quem ja passou do prazo de bloqueio', async () => {
  await renderizar([ATIVO_BLOQUEIO_CHEGOU]);

  expect(screen.getByText('Bloqueio próximo')).toBeInTheDocument();
});

it('mostra "Em dia" para quem tem fatura em aberto ainda por vencer', async () => {
  await renderizar([ATIVO_EM_DIA]);

  expect(screen.getByText('Em dia')).toBeInTheDocument();
});

/**
 * ALUNO NAO-ATIVO MANTEM O STATUS na coluna Situacao.
 *
 * "Em dia" para um aluno bloqueado seria a informacao errada na hora errada:
 * quem esta na catraca precisa saber que ele nao entra, nao que a ultima
 * fatura esta paga.
 */
it('mantem o status na coluna Situacao para aluno bloqueado', async () => {
  await renderizar([{ ...BLOQUEADO, invoiceParaAviso: { status: 'OVERDUE', dueAt: emDias(-30), blockAt: emDias(-20) } }]);

  expect(screen.getByText('Bloqueado')).toBeInTheDocument();
  expect(screen.queryByText('Bloqueio próximo')).not.toBeInTheDocument();
});

/**
 * SEM FUSO DA UNIDADE NAO HA COMO DECIDIR O DIA -- a celula volta ao status.
 *
 * `timezoneDaUnidade` nulo acontece de verdade: unidade cadastrada sem fuso
 * (ADR-019 exige, mas dado antigo pode nao ter). Mostrar badge financeira
 * calculada em UTC erraria por um dia perto da meia-noite.
 */
it('cai no status quando falta o fuso da unidade', async () => {
  await renderizar([
    { ...ATIVO_VENCIDO, timezoneDaUnidade: null },
  ]);

  expect(screen.getByText('Ativo')).toBeInTheDocument();
  expect(screen.queryByText('Vencida')).not.toBeInTheDocument();
});

/**
 * A COLUNA MOTIVO EXPLICA A SITUACAO QUE A COLUNA AO LADO MOSTRA.
 *
 * As duas precisam contar a MESMA historia: badge financeira com motivo de
 * status ao lado ("Vencida" + "Atestado medico") seria incoerente.
 */
it('explica a situacao financeira na coluna Motivo', async () => {
  await renderizar([ATIVO_VENCIDO]);

  expect(screen.getByTestId(`motivo-financeiro-${ATIVO_VENCIDO.id}`)).toHaveTextContent(
    'Mensalidade vencida há 7 dias',
  );
});

it('nao mostra motivo financeiro para quem esta em dia', async () => {
  await renderizar([ATIVO_EM_DIA]);

  expect(screen.queryByTestId(`motivo-financeiro-${ATIVO_EM_DIA.id}`)).not.toBeInTheDocument();
});

it('mantem o motivo de status para aluno suspenso', async () => {
  await renderizar([SUSPENSO]);

  expect(screen.getByTestId(`motivo-${SUSPENSO.id}`)).toHaveTextContent('Atestado médico');
});

/**
 * A COLUNA CATRACA e ordenavel por SITUACAO -- o cabecalho vira link.
 */
it('permite ordenar pela coluna Situacao', async () => {
  await renderizar([ATIVO_VENCIDO]);

  const cabecalho = screen.getByRole('columnheader', { name: /Situação/ });

  expect(cabecalho.querySelector('a')).not.toBeNull();
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm --filter admin-web test -- students/page`
Expected: FAIL nos testes novos (a coluna ainda mostra "Ativo" e não há `motivo-financeiro-*`). Os 5 testes antigos devem continuar **passando**.

- [ ] **Step 3: Substituir o `render` da coluna `situacao`**

Trocar o bloco inteiro:

```tsx
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            /*
              MARCA DE VENCIMENTO -- F53 Task 12, spec SPEC-053 §3.4.
              ...
            */
            render: (aluno) => {
              const situacao =
                aluno.invoiceParaAviso && aluno.timezoneDaUnidade
                  ? situacaoDeVencimento(aluno.invoiceParaAviso, agora, aluno.timezoneDaUnidade)
                  : 'EM_DIA';

              return (
                <>
                  <StateBadge machine="student" state={aluno.status} />
                  {situacao !== 'EM_DIA' ? (
                    <Consequencia tom="danger" testId={`vencimento-${aluno.id}`}>
                      {situacao === 'VENCE_EM_BREVE'
                        ? ' — mensalidade vence hoje'
                        : situacao === 'BLOQUEIO_PROXIMO'
                          ? ' — mensalidade vencida, bloqueio próximo'
                          : ' — mensalidade vencida'}
                    </Consequencia>
                  ) : null}
                </>
              );
            },
          },
```

por:

```tsx
          {
            key: 'situacao',
            sortKey: 'situacao',
            header: 'Situação',
            role: 'state',
            /*
              SITUACAO FINANCEIRA para quem esta ATIVO, STATUS para todo o
              resto -- decisao do PI, 29/09/2026.

              As duas perguntas sao diferentes ("ele pode treinar?" contra
              "ele esta pagando em dia?"), e so faz sentido responder a
              segunda quando a primeira ja e sim: aluno Bloqueado, Suspenso,
              Cancelado, Interessado ou Experimental mostra o PROPRIO status,
              porque isso e mais urgente que saber se a ultima fatura venceu.

              Sem invoice em aberto OU sem o fuso da unidade cadastrado, a
              situacao cai em EM_DIA -- e junto com `podeSerFinanceira` abaixo
              isso faz a celula mostrar o status normal, exatamente como
              antes desta fatia.
            */
            render: (aluno) => {
              const podeSerFinanceira = aluno.status === 'ACTIVE';
              const situacao =
                podeSerFinanceira && aluno.invoiceParaAviso && aluno.timezoneDaUnidade
                  ? situacaoDeVencimento(aluno.invoiceParaAviso, agora, aluno.timezoneDaUnidade)
                  : 'EM_DIA';

              if (podeSerFinanceira && aluno.invoiceParaAviso && aluno.timezoneDaUnidade) {
                return <StateBadge machine="paymentStanding" state={situacao} />;
              }

              return <StateBadge machine="student" state={aluno.status} />;
            },
          },
```

**`StateBadge` NÃO aceita `testId`** — verificado: os props são `machine`, `state` e `live`, só. Não adicione o prop (fora do escopo, e mexeria no design system inteiro); os testes do Step 1 localizam a badge por **texto** (`getByText('Vencida')`), que é o que a recepção lê de qualquer forma.

- [ ] **Step 4: Substituir o `render` da coluna `motivo`**

Trocar:

```tsx
            render: (aluno) =>
              aluno.statusReason ? (
                <span
                  data-testid={`motivo-${aluno.id}`}
                  {...(aluno.statusReasonNote ? { title: aluno.statusReasonNote } : {})}
                >
                  {MOTIVO_DA_SITUACAO[aluno.statusReason] ?? aluno.statusReason}
                </span>
              ) : (
                <Ausente />
              ),
```

por:

```tsx
            /*
              MOTIVO FINANCEIRO para quem a coluna Situacao mostrou o badge
              financeiro (aluno ATIVO com fatura em aberto/vencida); motivo de
              STATUS para todo o resto -- mesmo criterio de `podeSerFinanceira`
              da coluna Situacao, ao lado. As duas colunas precisam concordar:
              uma mostra o ESTADO, a outra explica O ESTADO — mostrar o motivo
              de status ao lado de uma badge financeira contaria uma historia
              e a outra, outra.
            */
            render: (aluno) => {
              const podeSerFinanceira = aluno.status === 'ACTIVE';

              if (podeSerFinanceira && aluno.invoiceParaAviso && aluno.timezoneDaUnidade) {
                const situacao = situacaoDeVencimento(
                  aluno.invoiceParaAviso,
                  agora,
                  aluno.timezoneDaUnidade,
                );
                const frase = fraseDeVencimento(
                  situacao,
                  aluno.invoiceParaAviso,
                  agora,
                  aluno.timezoneDaUnidade,
                );

                return frase ? (
                  <span data-testid={`motivo-financeiro-${aluno.id}`}>{frase}</span>
                ) : (
                  <Ausente />
                );
              }

              return aluno.statusReason ? (
                <span
                  data-testid={`motivo-${aluno.id}`}
                  {...(aluno.statusReasonNote ? { title: aluno.statusReasonNote } : {})}
                >
                  {MOTIVO_DA_SITUACAO[aluno.statusReason] ?? aluno.statusReason}
                </span>
              ) : (
                <Ausente />
              );
            },
```

- [ ] **Step 5: Ajustar os imports**

No topo do arquivo, trocar:

```tsx
import { situacaoDeVencimento } from '../../../src/billing/vencimento';
```

por:

```tsx
import { fraseDeVencimento, situacaoDeVencimento } from '../../../src/billing/vencimento';
```

E **remover `Consequencia` do import de `@arenahub/ui`** se ele não for mais usado em nenhum outro ponto do arquivo (a coluna Situação era o único uso; confirmar com busca antes de remover, senão o lint acusa import não usado ou símbolo faltando).

- [ ] **Step 6: Rodar os testes e o typecheck**

Run: `pnpm --filter admin-web test -- students/page`
Expected: PASS — os testes novos e os 5 antigos.

Run: `pnpm --filter admin-web typecheck`
Expected: PASS (0 erros).

- [ ] **Step 7: Rodar o dev server e conferir visualmente**

Run: `pnpm --filter admin-web dev` (ou reaproveitar o servidor já rodando na porta 3000).

Abrir `http://localhost:3000/students?status=ACTIVE` logado como `dono@arena-positiva.test` / `senha-de-bancada-arenahub`. Confirmar:
- Aluno ativo com fatura vencida mostra badge vermelha "Vencida" na coluna Situação e "Mensalidade vencida há N dias" no Motivo.
- Aluno ativo em dia mostra badge verde "Em dia" e Motivo com `—`.
- Trocar o filtro para `status=BLOCKED` (ou `SUSPENDED`) e confirmar que a coluna Situação volta a mostrar o badge de status (ex: "Bloqueado"), não financeiro.

Na base de bancada os números esperados são **79 alunos ativos com mensalidade
vencida e 252 em dia** (medido na revisão do plano). Se a tela mostrar todo
mundo "Em dia", a condição `podeSerFinanceira` ou o `invoiceParaAviso` da API
não está chegando.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/app/\(protected\)/students/page.tsx apps/admin-web/app/\(protected\)/students/page.test.tsx
git commit -m "feat: coluna Situacao mostra pagamento para aluno ativo, Motivo explica"
```

---

## Task 4: Renomear "ID da catraca" para "CATRACA"

**Files:**
- Modify: `apps/admin-web/app/(protected)/students/page.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Trocar o header**

Em `apps/admin-web/app/(protected)/students/page.tsx`, no bloco da coluna `catraca`:

```tsx
          {
            key: 'catraca',
            header: 'ID da catraca',
```

trocar `header: 'ID da catraca',` por `header: 'Catraca',` (Title Case — o `DataTable` já uppercase o header via CSS, ver a coluna `Aluno`/`Plano` que estão em Title Case no código-fonte, não em CAIXA ALTA; conferir `CelulasDeTabela.module.css`/`DataTable.module.css` antes de escrever em caixa alta manual, para não duplicar o `text-transform`).

- [ ] **Step 2: Rodar o dev server e conferir visualmente**

Recarregar `http://localhost:3000/students`. Confirmar que o cabeçalho da coluna mostra "CATRACA" (via CSS uppercase) e não "ID DA CATRACA".

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/app/\(protected\)/students/page.tsx
git commit -m "fix: renomeia coluna ID da catraca para Catraca"
```

---

## Task 5: Alinhar Motivo à esquerda

**Files:**
- Modify: `apps/admin-web/app/(protected)/students/page.tsx` (a coluna `motivo` ganha `role` se ainda não tiver o certo) e/ou `apps/admin-web/app/(protected)/students/students.module.css`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

> **JÁ INVESTIGADO NA REVISÃO DO PLANO — leia antes de "consertar" o CSS.**
>
> `DataTable.module.css:49` aplica `text-align: left` a **toda** `th` e `td`, e
> nenhum seletor de `role` sobrescreve isso (só `value` e `actions` viram
> `right`). A coluna Motivo usa `role: 'label'`, que define apenas
> `inline-size: 1%` + `white-space: nowrap` — **não mexe em alinhamento**.
>
> Ou seja: **o texto do Motivo já está alinhado à esquerda.** O que parecia
> desalinhamento no print é outra coisa: a célula tem `inline-size: 1%`
> (encolhe ao máximo) e o conteúdo era só um travessão curto (`Ausente`), o
> que dá a impressão de flutuar no meio de um vão grande entre SITUAÇÃO e
> AÇÃO.
>
> **A Task 3 resolve isso sozinha**: com as frases financeiras ("Mensalidade
> vencida há 7 dias — bloqueio em 3 dias"), a coluna passa a ter conteúdo de
> verdade e o vão fecha.

- [ ] **Step 1: Verificar visualmente DEPOIS da Task 3**

Com a Task 3 aplicada, recarregar `http://localhost:3000/students?status=ACTIVE`
e olhar a coluna MOTIVO em linhas que agora têm frase.

- [ ] **Step 2: Decidir com o que está na tela**

- **Se o texto começa colado na borda esquerda da célula, alinhado com o
  cabeçalho "MOTIVO"** — está correto, nada a fazer. Registrar no relatório
  final que o item já estava resolvido e **não tocar em CSS**: mudar
  `text-align` no design system afetaria as outras treze tabelas do painel.

- **Se ainda parecer desalinhado**, o problema é largura, não alinhamento.
  Nesse caso a correção é trocar o `role` da coluna `motivo` de `'label'`
  (que encolhe com `inline-size: 1%`) para `'support'` (pensado para frase
  vinda da API, com piso de largura) — uma linha no `page.tsx`, sem CSS novo:

```tsx
            key: 'motivo',
            header: 'Motivo',
            role: 'support',
```

  Conferir antes em `DataTable.module.css:287` o que `role: 'support'` faz
  com a largura, e olhar o efeito nas colunas vizinhas — o comentário do
  `page.tsx` na coluna `plano` registra que `support` já esticou demais uma
  coluna no passado.

- [ ] **Step 3: Commit (só se o Step 2 mudou algo)**

```bash
git add apps/admin-web/app/\(protected\)/students/page.tsx
git commit -m "fix: largura da coluna Motivo acomoda a frase de vencimento"
```

---

## Task 6: Confirmar que "Liberar catraca" funciona para aluno BLOCKED (sem mudança de código)

**Files:** nenhum (task de verificação).

**Interfaces:** nenhuma.

- [ ] **Step 1: Preparar um aluno de teste bloqueado no tenant real**

O código do botão (`apps/admin-web/app/(protected)/students/botao-de-liberacao.tsx`, `acoes-do-aluno.tsx`, `page.tsx:podeLiberar`) e a action (`apps/admin-web/app/actions/students.ts:liberarFinanceiramente`) já existem e estão corretamente ligados — confirmado por leitura de código nesta mesma conversa. O tenant `arena-positiva` simplesmente não tem nenhum aluno com `status = 'BLOCKED'` hoje (confirmado via `docker exec arenahub-postgres psql`). Para verificar de ponta a ponta, mude manualmente um aluno de teste para Bloqueado pela própria UI:

1. Abrir `http://localhost:3000/students`, abrir a ficha de qualquer aluno de teste (não um aluno real).
2. Mudar a situação para "Bloqueado", escolher motivo "Inadimplência", salvar.
3. Voltar para `http://localhost:3000/students?status=BLOCKED`.

- [ ] **Step 2: Confirmar visualmente**

Confirmar que:
- A linha do aluno mostra o ícone de cadeado (liberar catraca) na coluna Ação, ao lado dos outros três ícones.
- Clicar no ícone dispara o `POST /api/v1/billing/financial-overrides` (conferir na aba Network do DevTools, ou pelo toast "Liberado por N dia(s)." que a UI mostra em caso de sucesso).

- [ ] **Step 3: Reverter o aluno de teste**

Voltar o status do aluno de teste para "Ativo" (ou o que era antes), para não deixar dado de teste sujo na base compartilhada.

- [ ] **Step 4: Registrar o resultado**

Nenhum commit — esta task é confirmação, não código. Se o botão NÃO aparecer ou NÃO funcionar neste teste manual, PARE e trate como bug real antes de prosseguir: abrir uma nova investigação (não coberta por este plano) em vez de seguir para a Task 7.

---

## Task 7: Ordenação por Situação financeira — SQL raw + teste de paridade

**Files:**
- Modify: `apps/api/src/modules/students/students.controller.ts`
- Modify: `apps/api/src/modules/students/student.repository.ts`
- Create: `apps/api/test/integration/students-ordenar-por-situacao.int-spec.ts`

**Interfaces:**
- Consumes: `TenantContext`, `Prisma.TransactionClient` (já usados no repository), o padrão `tx.$queryRaw` dentro de `comTenant` (precedente: `idsPorNomeSemAcento`).
- Produces: `GET /api/v1/students?ordem=situacao&direcao=asc|desc` funcional e testado. Nenhuma tarefa posterior consome isto — é o topo da pilha desta fatia no lado API.

- [ ] **Step 1: Aceitar `'situacao'` no schema de ordenação do controller**

Em `apps/api/src/modules/students/students.controller.ts`, trocar:

```typescript
const ordemDeListagem = z.enum(['nome', 'matricula', 'nascimento']);
```

por:

```typescript
const ordemDeListagem = z.enum(['nome', 'matricula', 'nascimento', 'situacao']);
```

E no bloco que monta o filtro (dentro de `buscar`), trocar:

```typescript
      ...(ordemDeListagem.safeParse(ordem).success
        ? { ordem: ordem as 'nome' | 'matricula' | 'nascimento' }
        : {}),
```

por:

```typescript
      ...(ordemDeListagem.safeParse(ordem).success
        ? { ordem: ordem as 'nome' | 'matricula' | 'nascimento' | 'situacao' }
        : {}),
```

- [ ] **Step 2: Escrever o teste de integração que falha**

Criar `apps/api/test/integration/students-ordenar-por-situacao.int-spec.ts`. Ler primeiro um dos specs de integração existentes (`apps/api/test/integration/students-busca-sem-acento.int-spec.ts` ou similar) para copiar o padrão exato de setup (app Nest, tenant de teste, autenticação, limpeza) usado neste projeto — o arquivo abaixo assume esse mesmo padrão, ajustando os helpers para o nome real que o projeto usa (o plano não pode adivinhar nomes de helper que a leitura do arquivo real revelará; o executor deste task copia a estrutura de setup/teardown do arquivo de referência linha a linha, trocando apenas o corpo dos `it`s):

```typescript
import { situacaoDeVencimento } from '../../../../admin-web/src/billing/vencimento';
// NOTA PARA O EXECUTOR: o import acima cruza pacotes (apps/api -> apps/admin-web).
// Se o monorepo não permitir esse import direto (workspaces isolados por app),
// não importe a função — em vez disso, copie a MESMA tabela de casos abaixo e
// calcule `esperado` manualmente por caso (a lógica de `situacaoDeVencimento`
// está documentada em `apps/admin-web/src/billing/vencimento.ts` e é curta o
// suficiente para replicar os 4 ramos no teste sem importar o módulo).

describe('GET /api/v1/students?ordem=situacao (integração)', () => {
  // Setup: copiar de students-busca-sem-acento.int-spec.ts —
  // criar app Nest de teste, tenant, unidade com timezone 'America/Sao_Paulo',
  // login/token do dono do tenant.
  //
  // ATENCAO AO 'AGORA': o SQL usa `now()` do BANCO, que este teste nao
  // controla. Por isso as datas dos cenarios abaixo sao RELATIVAS ao dia de
  // hoje (calculadas no setup do teste), nunca literais fixas -- data literal
  // envelhece e o CI fica vermelho sozinho semanas depois.
  //
  //   const hoje = new Date();
  //   const emDias = (n) => { const d = new Date(hoje); d.setUTCDate(d.getUTCDate() + n);
  //                           return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
  //
  // `emDias(0)` e a meia-noite UTC de hoje -- o mesmo formato em que o
  // backend grava `dueAt` (ver `proximoVencimento` em ciclo-de-cobranca.ts).

  it('ordena do mais grave para o menos grave em direcao=asc (o primeiro clique)', async () => {
    // Arrange: 4 alunos ACTIVE na mesma unidade. Os estados foram conferidos
    // contra a lógica real -- ver "A semantica REAL dos 4 estados" no plano:
    //   "A Bloqueado": OVERDUE, dueAt = emDias(-10), blockAt = emDias(-2)
    //                  -> BLOQUEIO_PROXIMO (blockAt JA passou) -- prioridade 0
    //   "B Vencida":   OVERDUE, dueAt = emDias(-5),  blockAt = emDias(+3)
    //                  -> VENCIDA (blockAt ainda no futuro)    -- prioridade 1
    //   "C Vence Hoje": OPEN,   dueAt = emDias(0),   blockAt = null
    //                  -> VENCE_EM_BREVE                       -- prioridade 2
    //   "D Em Dia":    OPEN,    dueAt = emDias(+10), blockAt = null
    //                  -> EM_DIA                               -- prioridade 3
    //
    // Act: GET /api/v1/students?status=ACTIVE&ordem=situacao&direcao=asc
    //
    // Assert: a ordem dos nomes devolvidos é exatamente
    //   ["A Bloqueado", "B Vencida", "C Vence Hoje", "D Em Dia"]
    //
    // `asc` traz o PIOR primeiro de proposito: `DataTable.tsx:235` faz o
    // primeiro clique ser sempre `asc`, e quem clica em "Situacao" quer achar
    // quem esta devendo.
  });

  it('direcao=desc inverte: em dia primeiro, bloqueado por ultimo', async () => {
    // Mesmo cenario do teste acima, GET ...&ordem=situacao&direcao=desc
    // Assert: ["D Em Dia", "C Vence Hoje", "B Vencida", "A Bloqueado"]
  });

  it('desempata por nome quando a situacao e a mesma', async () => {
    // Arrange: 3 alunos ACTIVE, TODOS com a mesma situacao (EM_DIA, sem
    // invoice), nomes "Ana", "Bruno", "Carlos" criados em ordem embaralhada.
    // Act: GET ...&ordem=situacao&direcao=asc
    // Assert: ["Ana", "Bruno", "Carlos"] -- ordem alfabetica, estavel entre
    //   carregamentos. Sem este desempate a ordem cairia na fisica do
    //   Postgres, que muda a cada UPDATE na tabela.
  });

  it('paginacao por cursor nao pula nem repete aluno ordenado por situacao', async () => {
    // Arrange: 5 alunos ACTIVE com situacoes variadas (para exercitar a
    // ordem por prioridade, nao so o desempate).
    // Act: GET ...&ordem=situacao&direcao=asc&limit=2 -> pagina 1 (2 ids)
    //      GET ...&ordem=situacao&direcao=asc&limit=2&cursor=<ultimo id da p1>
    //        -> pagina 2 (2 ids)
    //      GET ...&ordem=situacao&direcao=asc&limit=5 -> referencia (5 ids)
    // Assert: pagina1.concat(pagina2) === referencia.slice(0, 4)
    //   -- mesma ordem, sem repetir nem pular.
  });

  it('aluno sem fatura em aberto aparece como EM_DIA, nao some da lista', async () => {
    // Arrange: 1 aluno ACTIVE SEM nenhuma invoice, 1 aluno ACTIVE com invoice
    // vencida.
    // Act: GET ...&ordem=situacao&direcao=asc
    // Assert: os DOIS aparecem; o sem fatura vem por ultimo (prioridade 3).
    //   REGRESSAO: `JOIN` em vez de `LEFT JOIN` faria o aluno sem fatura --
    //   ou sem unidade/fuso -- desaparecer silenciosamente da listagem.
  });

  it('respeita o filtro de status junto com a ordenacao', async () => {
    // Arrange: 2 alunos ACTIVE e 1 BLOCKED, todos com invoice vencida.
    // Act: GET ...&status=ACTIVE&ordem=situacao&direcao=asc
    // Assert: só os 2 ACTIVE voltam -- o BLOCKED fica de fora.
    //   REGRESSAO: a funcao SQL precisa aplicar os MESMOS filtros do `where`
    //   do Prisma; sem isso, ordenar por situacao ignoraria o filtro da tela.
  });

  it('paridade TS/SQL: a ordem do servidor bate com situacaoDeVencimento', async () => {
    // Arrange: os mesmos 4 alunos do primeiro teste.
    // Act: GET ...&status=ACTIVE&ordem=situacao&direcao=asc
    // Assert: para CADA aluno devolvido, calcular em TS
    //   `situacaoDeVencimento(aluno.invoiceParaAviso, new Date(), aluno.timezoneDaUnidade)`
    //   e mapear pela escala { BLOQUEIO_PROXIMO:0, VENCIDA:1, VENCE_EM_BREVE:2, EM_DIA:3 }.
    //   A sequencia de prioridades assim calculada deve ser NAO-DECRESCENTE.
    //
    //   ESTE E O TESTE QUE PEGA DIVERGENCIA entre as duas implementacoes da
    //   regra: se alguem corrigir `vencimento.ts` e esquecer do SQL (ou o
    //   contrario), a ordem devolvida deixa de bater com o que a coluna
    //   mostra, e este teste falha. Ele foi validado manualmente contra a
    //   base de bancada na escrita do plano: 79/79 alunos iguais.
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `pnpm --filter api test:integration -- students-ordenar-por-situacao`
Expected: FAIL — `ordem=situacao` cai no `default` de `ordenacao()` (ordena por `createdAt`), então a ordem dos ids não bate com o esperado.

- [ ] **Step 4: Implementar a função SQL de prioridade**

Em `apps/api/src/modules/students/student.repository.ts`, adicionar a função auxiliar (perto de `idsPorNomeSemAcento`, mesmo padrão de `tx.$queryRaw` dentro da transação com RLS):

```typescript
/**
 * IDs de aluno ORDENADOS por situacao financeira, mais grave primeiro --
 * replica em SQL a MESMA regra de `situacaoDeVencimento`
 * (`apps/admin-web/src/billing/vencimento.ts`), com teste de paridade em
 * `students-ordenar-por-situacao.int-spec.ts`.
 *
 * DUAS IMPLEMENTACOES DA MESMA REGRA, de proposito: o Prisma nao expressa
 * "compare o DIA CIVIL de `due_at` contra 'agora' NO FUSO DA UNIDADE" dentro
 * de `orderBy` estruturado -- so SQL alcanca `AT TIME ZONE`. O `$queryRaw`
 * devolve so `id`, na ordem certa; quem chama usa esse array para montar
 * `orderBy: { id... }` -- o Prisma NAO preserva ordem de `IN`, entao a
 * consulta principal usa `array_position` (ver `ordenacao`/`buscar` abaixo)
 * em vez de um segundo `findMany` solto.
 *
 * PRIORIDADE -- MENOR NUMERO E MAIS GRAVE, de proposito:
 *   0 = BLOQUEIO_PROXIMO (catraca ja fechada -- o pior caso)
 *   1 = VENCIDA
 *   2 = VENCE_EM_BREVE
 *   3 = EM_DIA / sem fatura em aberto
 *
 * A ESCALA E INVERTIDA porque `DataTable.tsx:235` faz o PRIMEIRO clique numa
 * coluna ser sempre `asc`: a recepcao clica em "Situacao" para achar quem
 * esta devendo, e com a escala natural (maior = pior) o primeiro clique
 * mostraria quem esta em dia. Ordenar `asc` por este numero poe os problemas
 * no topo, que e o que o clique quer dizer.
 *
 * Espelha `situacaoDeVencimento` (ver "A semantica REAL dos 4 estados" no
 * plano):
 *   - so invoice `OPEN`/`OVERDUE` entra na conta; qualquer outro status (ou
 *     ausencia de invoice em aberto) e EM_DIA;
 *   - ASSIMETRIA DELIBERADA nas datas, copiada de `diferencaEmDias`
 *     (`vencimento.ts:140`): `due_at`/`block_at` sao DATAS-CALENDARIO
 *     gravadas como meia-noite UTC, entao le-se o dia delas EM UTC
 *     (`AT TIME ZONE 'UTC'`); `now()` e um INSTANTE de verdade, e so ele
 *     converte para o fuso da unidade. Converter os dois pelo mesmo fuso
 *     erra por um dia -- foi exatamente o bug que `vencimento.ts` documenta.
 *   - so a invoice em aberto MAIS ANTIGA (`due_at asc`, `id asc` no empate)
 *     conta -- mesmo criterio de `faturaEmDestaque`.
 *
 * `LEFT JOIN gym_units`, nao `JOIN`: aluno cuja unidade sumiu (ou sem fuso
 * cadastrado) NAO PODE DESAPARECER DA LISTA por causa da ordenacao --
 * `COALESCE(gu.timezone, 'UTC')` o mantem visivel, na faixa EM_DIA, que e
 * como a grid ja o trata hoje (`paraDtoDaLista` devolve `timezoneDaUnidade`
 * nulo e a celula cai no status normal).
 */
async function idsOrdenadosPorSituacaoFinanceira(
  tx: Prisma.TransactionClient,
  tenantId: string,
  direcao: 'asc' | 'desc',
  filtro: {
    status?: StudentStatus | undefined;
    gymUnitId?: string | undefined;
    modalityId?: string | undefined;
  },
): Promise<string[]> {
  const linhas = await tx.$queryRaw<{ id: string }[]>`
    WITH invoice_em_aberto AS (
      SELECT DISTINCT ON (i.student_id)
        i.student_id,
        i.due_at,
        i.block_at
      FROM invoices i
      WHERE i.tenant_id = ${tenantId}::uuid
        AND i.status IN ('OPEN', 'OVERDUE')
      ORDER BY i.student_id, i.due_at ASC, i.id ASC
    ),
    prioridade AS (
      SELECT
        s.id,
        s.full_name,
        CASE
          WHEN io.student_id IS NULL THEN 3
          WHEN (io.due_at AT TIME ZONE 'UTC')::date
               > (now() AT TIME ZONE COALESCE(gu.timezone, 'UTC'))::date THEN 3
          WHEN (io.due_at AT TIME ZONE 'UTC')::date
               = (now() AT TIME ZONE COALESCE(gu.timezone, 'UTC'))::date THEN 2
          WHEN io.block_at IS NOT NULL
               AND (io.block_at AT TIME ZONE 'UTC')::date
                   <= (now() AT TIME ZONE COALESCE(gu.timezone, 'UTC'))::date THEN 0
          ELSE 1
        END AS prioridade
      FROM students s
      LEFT JOIN gym_units gu ON gu.id = s.gym_unit_id
      LEFT JOIN invoice_em_aberto io ON io.student_id = s.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.profile = 'STUDENT'
        ${filtro.status ? Prisma.sql`AND s.status = ${filtro.status}::student_status` : Prisma.empty}
        ${filtro.gymUnitId ? Prisma.sql`AND s.gym_unit_id = ${filtro.gymUnitId}::uuid` : Prisma.empty}
        ${
          filtro.modalityId
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM student_modalities sm
                WHERE sm.student_id = s.id AND sm.modality_id = ${filtro.modalityId}::uuid
              )`
            : Prisma.empty
        }
    )
    SELECT id FROM prioridade
    ORDER BY
      prioridade ${direcao === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`},
      full_name ASC,
      id DESC
  `;

  return linhas.map((l) => l.id);
}
```

**Nomes já verificados contra o banco real** (não precisa reconferir, mas não
os troque por palpite):

| O que | Nome real | Como foi verificado |
|---|---|---|
| Tabela de junção aluno↔modalidade | `student_modalities(student_id, modality_id)` | `@@map` do model `StudentModality`, schema.prisma:1167 |
| Enum de status do aluno no Postgres | `student_status` (snake_case, **não** `"StudentStatus"`) | `information_schema.columns.udt_name` |
| Fuso da unidade | `gym_units.timezone` (sem `@map`) | schema.prisma:864 |
| Data-calendário lida em UTC | `(col AT TIME ZONE 'UTC')::date` | `psql` — confere com `diaCivilUtcComoNumero` do TS |

**Este SQL já foi executado contra a base de bancada e comparado com o TS
aluno a aluno: 79/79 iguais, zero divergência** (79 alunos `ACTIVE` da
Arena Positiva com fatura em aberto). O teste de integração do Step 2 existe
para manter essa paridade no futuro, não para descobri-la agora.

Ainda assim, rode o SQL isolado no psql antes de embutir no TypeScript se
alterar qualquer coisa nele — erro de nome de coluna em `$queryRaw` só
aparece em runtime, e a mensagem do Postgres é mais clara que a do Prisma:

```bash
docker exec arenahub-postgres psql -U arenahub -d arenahub -c "<SQL com o tenant real>"
```

- [ ] **Step 5: Ligar a nova ordenação ao `buscar` do repository**

O `orderBy` do `findMany` hoje vem de `ordenacao(filtro.ordem, filtro.direcao)`, uma função pura, síncrona e sem `tx`. A ordenação por situação não cabe ali: ela precisa do banco. E o Prisma **não suporta** `ORDER BY array_position(...)`, então a ordem calculada no SQL tem de ser reaplicada em JS depois do `findMany`.

O caminho é: `idsOrdenadosPorSituacaoFinanceira` devolve os ids **já filtrados e ordenados** (por isso ela recebe `filtro` no Step 4); `paginarIds` corta a janela; o `findMany` busca por `id: { in: pagina }`; e um `sort` final devolve a ordem que o `IN` perdeu.

  Reescrever o método `buscar`:

```typescript
  async buscar(
    contexto: TenantContext,
    filtro: { /* ...mesma assinatura já existente... */ },
    agora: Date = new Date(),
  ): Promise<Student[]> {
    return this.db.comTenant(async (tx) => {
      const condicoes = await condicoesDaListagem(tx, contexto.tenantId, filtro.termo);

      if (filtro.ordem === 'situacao') {
        const idsNaOrdem = await idsOrdenadosPorSituacaoFinanceira(
          tx,
          contexto.tenantId,
          filtro.direcao ?? 'asc',
          filtro,
        );

        /*
         * O TERMO DE BUSCA continua vindo do `where` do Prisma, nao do SQL
         * raw: `condicoesDaListagem` ja resolve nome sem acento, matricula e
         * telefone, e reimplementar isso no SQL seria a TERCEIRA copia da
         * mesma regra. A intersecao acontece no `where` abaixo -- `id: { in }`
         * junto de `...condicoes` filtra pelos dois criterios.
         *
         * CONSEQUENCIA: a paginacao precisa acontecer DEPOIS dessa
         * intersecao, senao a pagina 1 poderia vir vazia (os 20 primeiros da
         * ordem podem nao casar com o termo). Por isso, quando ha termo, o
         * corte e feito sobre os ids que sobreviveram ao filtro.
         */
        const idsQueCasam = filtro.termo
          ? new Set(
              (
                await tx.student.findMany({
                  where: { tenantId: contexto.tenantId, profile: 'STUDENT', ...condicoes },
                  select: { id: true },
                })
              ).map((a) => a.id),
            )
          : null;

        const elegiveis = idsQueCasam
          ? idsNaOrdem.filter((id) => idsQueCasam.has(id))
          : idsNaOrdem;

        const pagina = paginarIds(elegiveis, filtro.cursor, filtro.limite);

        if (pagina.length === 0) return [];

        const alunos = await tx.student.findMany({
          where: { id: { in: pagina } },
          include: INCLUDE_DA_LISTAGEM,
        });

        // O `findMany` com `id: { in }` NAO preserva a ordem de `pagina` --
        // reordena aqui, no mesmo criterio que a paginacao usou.
        const posicao = new Map(pagina.map((id, indice) => [id, indice]));

        return alunos.sort((a, b) => (posicao.get(a.id) ?? 0) - (posicao.get(b.id) ?? 0));
      }

      return tx.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          profile: 'STUDENT',
          ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
          ...(filtro.status ? { status: filtro.status } : {}),
          ...(filtro.modalityId ? condicaoDeModalidade(filtro.modalityId) : {}),
          ...condicoes,
        },
        orderBy: ordenacao(filtro.ordem, filtro.direcao),
        take: filtro.limite,
        ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
        include: INCLUDE_DA_LISTAGEM,
      });
    });
  }
```

  Escrever a função auxiliar de paginação por array de ids:

```typescript
/**
 * Corta `idsNaOrdem` a partir de `cursor` (exclusivo) e pega `limite`.
 *
 * `indexOf` devolve -1 para cursor que nao esta mais na lista (o aluno mudou
 * de situacao entre uma pagina e outra, ou foi arquivado). `-1 + 1 = 0`
 * reinicia do comeco -- repetir a primeira pagina e melhor que devolver
 * vazio, que a tela leria como "acabou" e esconderia o resto da base.
 */
function paginarIds(idsNaOrdem: string[], cursor: string | undefined, limite: number): string[] {
  const inicio = cursor ? idsNaOrdem.indexOf(cursor) + 1 : 0;

  return idsNaOrdem.slice(inicio, inicio + limite);
}
```

- [ ] **Step 5a (fazer ANTES do 5b, e commitar separado): extrair `INCLUDE_DA_LISTAGEM`**

O objeto `include` do `findMany` atual (linhas ~800-899) passa a ser usado por **dois** `findMany`. Extrair para uma constante no escopo do módulo, `INCLUDE_DA_LISTAGEM`, e referenciá-la nos dois — duas cópias divergiriam na primeira edição, e o caminho ordenado por situação passaria a devolver aluno sem plano ou sem telefone enquanto o outro devolve completo.

**Copiar o objeto literalmente, sem "melhorar" nada** — os comentários dentro dele documentam decisões (o `take: 1` que evita N+1, o `orderBy` duplo do telefone, o `credentials` sem `take`) e devem viajar junto.

Este é um refactor mecânico, sem mudança de comportamento. Commitar sozinho para o diff da ordenação ficar legível:

```bash
pnpm --filter api test:integration -- students   # verde ANTES de commitar
git add apps/api/src/modules/students/student.repository.ts
git commit -m "refactor: extrai INCLUDE_DA_LISTAGEM para reuso entre os caminhos de buscar"
```

- [ ] **Step 5b: aplicar a ramificação por situação**

Com o `include` já extraído, aplicar a mudança do `buscar` mostrada acima.

- [ ] **Step 6: Rodar o teste de integração e confirmar que passa**

Run: `pnpm --filter api test:integration -- students-ordenar-por-situacao`
Expected: PASS nos 4 casos.

- [ ] **Step 7: Rodar a suíte de integração inteira de students, para garantir que o refactor do `include` compartilhado não quebrou os outros modos de ordenação**

Run: `pnpm --filter api test:integration -- students`
Expected: PASS em todos os arquivos `students-*.int-spec.ts` existentes.

- [ ] **Step 8: Commits**

```bash
git add apps/api/src/modules/students/student.repository.ts
git commit -m "refactor: extrai INCLUDE_DA_LISTAGEM compartilhado entre os dois caminhos de buscar"

git add apps/api/src/modules/students/students.controller.ts apps/api/src/modules/students/student.repository.ts apps/api/test/integration/students-ordenar-por-situacao.int-spec.ts
git commit -m "feat: ordena alunos por situacao financeira, respeitando fuso da unidade"
```

---

## Task 8: Adicionar `sortKey` na coluna Situação do front e testar ponta a ponta

**Files:**
- Modify: `apps/admin-web/app/(protected)/students/page.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/students?ordem=situacao` (Task 7), `sort.href` já existente na página (usado por todas as outras colunas ordenáveis).

- [ ] **Step 1: Confirmar que `sortKey: 'situacao'` já foi adicionado na Task 3**

A Task 3, Step 2, já inclui `sortKey: 'situacao'` no objeto da coluna. Se por algum motivo não estiver lá (conferir o arquivo), adicionar agora.

- [ ] **Step 2: Rodar o dev server e testar a ordenação ponta a ponta**

Recarregar `http://localhost:3000/students?status=ACTIVE`. Clicar no cabeçalho "SITUAÇÃO" (deve virar link clicável, como "ALUNO" já é). Confirmar:
- Primeiro clique ordena (verificar a direção default — mesma UX das outras colunas, geralmente `asc`).
- Segundo clique inverte a direção.
- A URL muda para `?...&ordem=situacao&direcao=asc` (ou `desc`).
- A ordem visual das badges na coluna Situação bate com a prioridade esperada (Vencida antes de Em dia, por exemplo, em `direcao=desc`).

- [ ] **Step 3: Commit (se o Step 1 precisou de mudança)**

```bash
git add apps/admin-web/app/\(protected\)/students/page.tsx
git commit -m "feat: coluna Situacao ordenavel por situacao financeira"
```

(Se a Task 3 já cobriu isto, pular este commit.)

---

## Self-Review Notes

### O que a revisão do plano encontrou e corrigiu

Esta revisão rodou a lógica real (`node`) e o SQL real (`psql`) contra a base
de bancada, em vez de confiar em leitura. Achou **cinco defeitos** que teriam
virado bug ou trabalho perdido:

1. **Semântica de `BLOQUEIO_PROXIMO` invertida** (grave). O plano assumia
   "faltam N dias para bloquear"; a regra real é "o bloqueio **já chegou**"
   (`blockAt <= hoje`). Os três cenários que o plano rotulava como
   `BLOQUEIO_PROXIMO` produzem `VENCIDA` de fato — verificado por execução. A
   frase "Bloqueio da catraca em N dias" sairia sempre "em 0 dias", e o teste
   escrito passaria por acidente (a função só formata o estado que recebe),
   mascarando a contradição. `diasAteBloqueio` foi **removida**; a contagem
   regressiva migrou para `VENCIDA`, onde é verdadeira e acionável.
2. **Asserção de fuso errada** no teste de integração: o plano afirmava que
   `blockAt=2026-09-26T02:00Z` com `agora=2026-09-25T20:00Z` em SP daria
   `BLOQUEIO_PROXIMO`. Dá `VENCIDA` — confirmado nos dois lados. O executor
   teria "consertado" código correto até o teste errado passar.
3. **Escala de prioridade invertida.** `DataTable.tsx:235` faz o primeiro
   clique ser sempre `asc`; com a escala natural (maior = pior), o primeiro
   clique mostraria quem está em dia. A escala agora é 0 = pior.
4. **`JOIN gym_units` faria aluno sumir** da listagem se a unidade não tivesse
   fuso. Virou `LEFT JOIN` + `COALESCE(gu.timezone, 'UTC')`.
5. **Nome de enum errado no SQL:** o plano escrevia `::"StudentStatus"`; no
   Postgres é `student_status`. Falharia em runtime.

Também corrigiu duas afirmações falsas: que **não havia teste** para a grid
(há — `page.test.tsx`, 143 linhas, com fixtures prontas) e que o **alinhamento
do Motivo precisava de CSS** (não precisa — `text-align: left` já é a regra
base; o que parecia desalinhamento era largura, que a Task 3 resolve ao pôr
conteúdo na coluna).

### Evidência já coletada

- **Paridade TS↔SQL: 79/79 alunos iguais, zero divergência**, medida contra os
  alunos `ACTIVE` reais da Arena Positiva. O teste de integração da Task 7
  existe para preservar isso, não para descobri-lo.
- **Distribuição na bancada:** 79 ativos com mensalidade vencida, 252 em dia —
  serve de sanity check visual na Task 3.
- **Nomes de schema conferidos** contra `information_schema` e `schema.prisma`
  (tabela de modalidades, enum de status, coluna de fuso).

### Notas de escopo

- **Cobertura do pedido do PI:** os 6 itens estão cobertos, exceto o nome do
  plano — que a investigação mostrou ser **dado real** cadastrado pela
  academia (`Plano Individuais - protocolos e acompanhamento` é o `name` no
  banco, não `name` + `description` concatenados). O PI decidiu corrigir o
  cadastro em vez de truncar string na grid.
- **Task 6 é confirmação, não correção:** o botão de liberar 3 dias já existe e
  está corretamente ligado. Ele não aparece porque o tenant `arena-positiva`
  não tem nenhum aluno `BLOCKED` hoje (os 18 do banco são de tenants `dash-*`
  de teste).
- **Risco maior:** a Task 7 continua sendo a mais pesada — duplica regra de
  negócio em SQL e reestrutura a paginação do `buscar()`. As Tasks 1-6 formam
  uma fatia entregável sozinha se o tempo apertar; o PI já sinalizou abertura a
  separar.
