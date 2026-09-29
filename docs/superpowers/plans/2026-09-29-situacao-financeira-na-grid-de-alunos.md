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

## Review Focus

- **Aluno `ACTIVE` sem `invoiceParaAviso`/`timezoneDaUnidade`** (sem fatura em aberto, ou unidade sem fuso cadastrado): a coluna Situação deve continuar mostrando o badge de status `ACTIVE` normal, nunca um badge financeiro incompleto ou quebrado.
- **`BLOQUEIO_PROXIMO` no limiar exato** (`blockAt` é hoje às 00:00 UTC, mesmo dia civil do fuso da unidade): TS e SQL precisam concordar exatamente no mesmo dia, incluindo unidades em fuso não-UTC (`America/Sao_Paulo`, `America/Manaus`).
- **Ordenação com paginação por cursor**: ordenar por `situacao` e depois clicar em "Próximos" não pode pular nem repetir aluno — precisa de critério de desempate estável (`id`) como as outras ordens já têm.
- **Aluno sem nenhuma invoice `OPEN`/`OVERDUE`** mas com assinatura `PAST_DUE`: `situacaoDeVencimento` deriva do `status` da invoice, não da assinatura — confirmar que o SQL usa o mesmo critério (`invoices.status IN ('OPEN','OVERDUE')`), não `subscriptions.status`.
- **Duas invoices em aberto do mesmo aluno com `due_at` igual**: o TS desempata por `id` (`faturaEmDestaque`); o SQL precisa do mesmo desempate para escolher a mesma invoice que a grid mostra, senão a ordenação pode discordar do que a célula exibe.

---

## File Structure

- **Modify** `packages/ui/src/domain/state-labels.ts` — nova `StateMachine` `'paymentStanding'` + 4 entradas no dicionário.
- **Modify** `packages/ui/src/domain/state-labels.spec.ts` — testes da máquina nova.
- **Modify** `apps/admin-web/src/billing/vencimento.ts` — duas funções novas: `diasAteBloqueio` e `fraseDeVencimento`.
- **Modify** `apps/admin-web/src/billing/vencimento.test.ts` — testes das funções novas.
- **Modify** `apps/admin-web/app/(protected)/students/page.tsx` — `render` da coluna Situação, `render` da coluna Motivo, `header` da coluna catraca, `sortKey` da coluna Situação.
- **Modify** `packages/ui/src/components/CelulasDeTabela.module.css` ou `apps/admin-web/app/(protected)/students/students.module.css` — alinhamento à esquerda do Motivo (a checagem do mecanismo exato é o primeiro passo da Task 5).
- **Modify** `apps/api/src/modules/students/students.controller.ts` — `ordemDeListagem` aceita `'situacao'`.
- **Modify** `apps/api/src/modules/students/student.repository.ts` — `ordenacao()` monta `orderBy` diferente para `'situacao'`, com SQL raw auxiliar `idsOrdenadosPorSituacaoFinanceira`.
- **Create** `apps/api/test/integration/students-ordenar-por-situacao.int-spec.ts` — teste de integração cobrindo ordenação + paridade TS/SQL.

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
- Consumes: `InvoiceParaAviso`, `situacaoDeVencimento`, `diasDeAtraso`, `SituacaoDeVencimento` (já existem em `vencimento.ts`).
- Produces: `diasAteBloqueio(invoice, agora, timezone): number` e `fraseDeVencimento(situacao: SituacaoDeVencimento, invoice: InvoiceParaAviso, agora: Date, timezone: string): string | null`. `fraseDeVencimento` é consumida pela Task 3 na coluna Motivo.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `apps/admin-web/src/billing/vencimento.test.ts` (ver o arquivo para o padrão exato de `describe`/`it` e helpers de data já usados nele — replicar o mesmo estilo):

```typescript
describe('diasAteBloqueio', () => {
  it('zero quando blockAt e null', () => {
    const invoice = { status: 'OVERDUE', dueAt: '2026-09-20T00:00:00.000Z', blockAt: null };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(diasAteBloqueio(invoice, agora, 'America/Sao_Paulo')).toBe(0);
  });

  it('dias positivos ate o bloqueio, arredondado para cima', () => {
    const invoice = {
      status: 'OVERDUE',
      dueAt: '2026-09-20T00:00:00.000Z',
      blockAt: '2026-09-28T00:00:00.000Z',
    };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(diasAteBloqueio(invoice, agora, 'America/Sao_Paulo')).toBe(3);
  });

  it('zero quando o bloqueio ja passou', () => {
    const invoice = {
      status: 'OVERDUE',
      dueAt: '2026-09-01T00:00:00.000Z',
      blockAt: '2026-09-10T00:00:00.000Z',
    };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(diasAteBloqueio(invoice, agora, 'America/Sao_Paulo')).toBe(0);
  });
});

describe('fraseDeVencimento', () => {
  const timezone = 'America/Sao_Paulo';

  it('EM_DIA nao tem frase', () => {
    const invoice = { status: 'PAID', dueAt: '2026-09-01T00:00:00.000Z', blockAt: null };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(fraseDeVencimento('EM_DIA', invoice, agora, timezone)).toBeNull();
  });

  it('VENCE_EM_BREVE diz que vence hoje', () => {
    const invoice = { status: 'OPEN', dueAt: '2026-09-25T00:00:00.000Z', blockAt: null };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(fraseDeVencimento('VENCE_EM_BREVE', invoice, agora, timezone)).toBe(
      'Mensalidade vence hoje',
    );
  });

  it('BLOQUEIO_PROXIMO diz em quantos dias bloqueia, no singular', () => {
    const invoice = {
      status: 'OVERDUE',
      dueAt: '2026-09-20T00:00:00.000Z',
      blockAt: '2026-09-26T00:00:00.000Z',
    };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(fraseDeVencimento('BLOQUEIO_PROXIMO', invoice, agora, timezone)).toBe(
      'Bloqueio da catraca em 1 dia',
    );
  });

  it('BLOQUEIO_PROXIMO diz em quantos dias bloqueia, no plural', () => {
    const invoice = {
      status: 'OVERDUE',
      dueAt: '2026-09-20T00:00:00.000Z',
      blockAt: '2026-09-28T00:00:00.000Z',
    };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(fraseDeVencimento('BLOQUEIO_PROXIMO', invoice, agora, timezone)).toBe(
      'Bloqueio da catraca em 3 dias',
    );
  });

  it('VENCIDA diz ha quantos dias venceu, no singular', () => {
    const invoice = { status: 'OVERDUE', dueAt: '2026-09-24T00:00:00.000Z', blockAt: null };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(fraseDeVencimento('VENCIDA', invoice, agora, timezone)).toBe(
      'Mensalidade vencida há 1 dia',
    );
  });

  it('VENCIDA diz ha quantos dias venceu, no plural', () => {
    const invoice = { status: 'OVERDUE', dueAt: '2026-09-18T00:00:00.000Z', blockAt: null };
    const agora = new Date('2026-09-25T12:00:00.000Z');

    expect(fraseDeVencimento('VENCIDA', invoice, agora, timezone)).toBe(
      'Mensalidade vencida há 7 dias',
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter admin-web test -- vencimento`
Expected: FAIL — `diasAteBloqueio is not defined` / `fraseDeVencimento is not defined`.

- [ ] **Step 3: Implementar**

Adicionar ao final de `apps/admin-web/src/billing/vencimento.ts`:

```typescript
/**
 * Dias ate o bloqueio, em dia CIVIL no fuso da unidade -- zero quando nao ha
 * `blockAt` ou quando o bloqueio ja passou.
 *
 * MESMA TECNICA de `diasDeAtraso`, espelhada para o outro extremo do prazo:
 * a coluna Motivo da grid de Alunos precisa do NUMERO ("bloqueio em 3 dias"),
 * nao so da faixa `BLOQUEIO_PROXIMO`.
 */
export function diasAteBloqueio(
  invoice: { readonly blockAt: string | null },
  agora: Date,
  timezone: string,
): number {
  if (invoice.blockAt === null) return 0;

  const dias = diferencaEmDias(invoice.blockAt, agora, timezone);

  return dias > 0 ? dias : 0;
}

/**
 * A frase da coluna MOTIVO para a situacao financeira da linha -- `null`
 * quando `EM_DIA`, que e o caso comum e nao precisa de explicacao (a celula
 * mostra `Ausente`, como qualquer motivo vazio na grid).
 *
 * SEPARADA de `situacaoDeVencimento`: aquela decide o ESTADO, esta so
 * formata o texto para o estado ja decidido -- quem chama sempre calcula os
 * dois com o MESMO `invoice`/`agora`/`timezone`, senao a frase falaria de um
 * instante diferente do que a badge mostra.
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
      const dias = diasAteBloqueio(invoice, agora, timezone);

      return `Bloqueio da catraca em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    }
    case 'VENCIDA': {
      const dias = diasDeAtraso(invoice, agora, timezone);

      return `Mensalidade vencida há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    }
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter admin-web test -- vencimento`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/billing/vencimento.ts apps/admin-web/src/billing/vencimento.test.ts
git commit -m "feat: frase de motivo com dias para vence-hoje/bloqueio-proximo/vencida"
```

---

## Task 3: Coluna Situação vira financeira para aluno ATIVO; coluna Motivo ganha a frase

**Files:**
- Modify: `apps/admin-web/app/(protected)/students/page.tsx`

**Interfaces:**
- Consumes: `stateLabel`/`StateBadge machine="paymentStanding"` (Task 1), `fraseDeVencimento` (Task 2), `situacaoDeVencimento` (já importado), `MOTIVO_DA_SITUACAO` (já importado).
- Produces: nada consumido por tarefa posterior — mudança de UI terminal para esta grid.

- [ ] **Step 1: Localizar o bloco a trocar**

Abrir `apps/admin-web/app/(protected)/students/page.tsx`. O bloco da coluna `situacao` (linhas ~438-476 na versão atual) e o bloco da coluna `motivo` (linhas ~477-515) são os dois pontos de mudança. Não há teste automatizado prévio para esta página (é Server Component sem spec de página) — a verificação desta task é via Task 6 (E2E manual) e a Task 8 (revisão de branch); ainda assim, escrever o código de forma que `situacao`/`podeSerFinanceira` sejam expressões extraíveis e legíveis.

- [ ] **Step 2: Substituir o `render` da coluna `situacao`**

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
                return (
                  <StateBadge
                    machine="paymentStanding"
                    state={situacao}
                    testId={`situacao-financeira-${aluno.id}`}
                  />
                );
              }

              return <StateBadge machine="student" state={aluno.status} />;
            },
          },
```

**Nota:** confira em `packages/ui/src/components/StateBadge.tsx` se o prop se chama `testId` (com `data-testid`) — pela leitura anterior do componente ele NÃO tem esse prop hoje (só `machine`, `state`, `live`). Se `testId` não existir no componente, **remover** o prop `testId` da chamada acima (não adicionar prop nova ao `StateBadge` — fora do escopo deste plano); confirmar rodando o typecheck no Step 4.

- [ ] **Step 3: Substituir o `render` da coluna `motivo`**

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

- [ ] **Step 4: Adicionar o import de `fraseDeVencimento`**

No topo do arquivo, trocar:

```tsx
import { situacaoDeVencimento } from '../../../src/billing/vencimento';
```

por:

```tsx
import { fraseDeVencimento, situacaoDeVencimento } from '../../../src/billing/vencimento';
```

- [ ] **Step 5: Rodar o typecheck**

Run: `pnpm --filter admin-web typecheck`
Expected: PASS (0 erros). Se `StateBadge` não aceitar `testId`, o erro aponta exatamente essa linha — remover o prop conforme a nota do Step 2.

- [ ] **Step 6: Rodar o dev server e conferir visualmente**

Run: `pnpm --filter admin-web dev` (ou reaproveitar o servidor já rodando na porta 3000).

Abrir `http://localhost:3000/students?status=ACTIVE` logado como `dono@arena-positiva.test` / `senha-de-bancada-arenahub`. Confirmar:
- Aluno ativo com fatura vencida mostra badge vermelha "Vencida" na coluna Situação e "Mensalidade vencida há N dia(s)" no Motivo.
- Aluno ativo em dia mostra badge verde "Em dia" e Motivo com `—`.
- Trocar o filtro para `status=BLOCKED` (ou `SUSPENDED`) e confirmar que a coluna Situação volta a mostrar o badge de status (ex: "Bloqueado"), não financeiro.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/app/\(protected\)/students/page.tsx
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

- [ ] **Step 1: Investigar o mecanismo de alinhamento existente**

Ler `packages/ui/src/components/DataTable.tsx` e `DataTable.module.css` (e `CelulasDeTabela.module.css`) para entender como `role: 'label'`/`role: 'code'` etc. hoje decidem alinhamento — o comentário da coluna `plano` no `page.tsx` diz que `role: 'code'` existe "porque nome de plano é dado curto e fechado", sugerindo que `role` já controla largura/alinhamento centralmente. Confirmar se a coluna `motivo` já usa `role: 'label'` (releitura do arquivo mostrou que sim, `role: 'label'` já está lá) e se esse `role` já alinha à esquerda ou centraliza.

- [ ] **Step 2: Aplicar o alinhamento**

Se `role: 'label'` já alinha à esquerda (mais provável, dado que `plano`/`contato` usam o mesmo `role` e têm texto variável alinhado à esquerda no print original), então NENHUMA mudança de CSS é necessária — o que estava desalinhado no print do usuário era a ausência de `role` explícito antes desta fatia (já corrigido, `role: 'label'` já está no código atual). Confirmar comparando visualmente no dev server (Step 3) antes de tocar em CSS.

Se o `role: 'label'` centraliza (ou se o CSS aplica `text-align: center` a `role: 'state'`/coluna sem `role`), adicionar ou ajustar a regra em `CelulasDeTabela.module.css` (ou no módulo local `students.module.css`, seguindo o padrão que o arquivo já usa) para `text-align: left` no seletor correspondente ao `role: 'label'`.

- [ ] **Step 3: Rodar o dev server e conferir visualmente**

Recarregar `http://localhost:3000/students`. Confirmar que o texto da coluna Motivo (tanto o motivo de status quanto a nova frase financeira da Task 3) está alinhado à esquerda, igual às colunas Plano e Contato.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/app/\(protected\)/students/page.tsx apps/admin-web/app/\(protected\)/students/students.module.css
git commit -m "fix: alinha coluna Motivo a esquerda"
```

(Se o Step 2 concluiu que nenhuma mudança é necessária, pular este commit e registrar no relatório final da Task 8 que o item já estava correto.)

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

  it('ordena vencida > bloqueio_proximo > vence_em_breve > em_dia, desempatando por nome', async () => {
    // Arrange: criar 4 alunos ACTIVE na mesma unidade, cada um com uma invoice
    // OPEN/OVERDUE cujo dueAt/blockAt produz uma das 4 situações, usando o
    // MESMO 'agora' fixo que o teste vai passar para a asserção:
    //   agora = 2026-09-25T12:00:00.000Z (meio-dia UTC = manhã em America/Sao_Paulo)
    //   aluno "A Vencida":     invoice OVERDUE, dueAt = 2026-09-18 (7 dias de atraso), blockAt = null
    //   aluno "B Bloqueio":    invoice OVERDUE, dueAt = 2026-09-20, blockAt = 2026-09-26 (bloqueia amanhã)
    //   aluno "C Vence Hoje":  invoice OPEN,    dueAt = 2026-09-25 (hoje em SP)
    //   aluno "D Em Dia":      invoice OPEN,    dueAt = 2026-10-05 (futuro)
    //
    // Act: GET /api/v1/students?status=ACTIVE&ordem=situacao&direcao=desc
    //
    // Assert: a ordem dos ids devolvidos é exatamente
    //   ["A Vencida", "B Bloqueio", "C Vence Hoje", "D Em Dia"]
    // (mais grave primeiro, em direcao=desc)
  });

  it('direcao=asc inverte a prioridade: em_dia primeiro, vencida por ultimo', async () => {
    // Mesmo cenario do teste acima, GET ...&ordem=situacao&direcao=asc
    // Assert: ordem invertida ["D Em Dia", "C Vence Hoje", "B Bloqueio", "A Vencida"]
  });

  it('paginacao por cursor nao pula nem repete aluno ordenado por situacao', async () => {
    // Arrange: 5 alunos ACTIVE, todos VENCIDOS com dueAt diferentes (garante
    // ordem determinística mesmo sem desempate por prioridade).
    // Act: GET ...&ordem=situacao&direcao=desc&limit=2, pegar o ultimo id,
    //      GET de novo com &cursor=<ultimo id>.
    // Assert: a uniao das duas paginas tem 4 ids distintos, sem repeticao,
    //      na mesma ordem relativa que uma unica chamada com limit=5 devolve.
  });

  it('BLOQUEIO_PROXIMO respeita o fuso da unidade, nao UTC', async () => {
    // Arrange: unidade com timezone 'America/Sao_Paulo' (UTC-3). Uma invoice
    // com blockAt = 2026-09-26T02:00:00.000Z -- que em UTC e dia 26, mas em
    // America/Sao_Paulo (UTC-3) ainda e 25 as 23h, ou seja, dia civil 25.
    // agora = 2026-09-25T20:00:00.000Z (17h em SP, ainda dia 25 la).
    // Assert: a situacao calculada em SQL bate com situacaoDeVencimento em TS
    //   para o MESMO invoice/agora/timezone -- ambas devem concordar que o
    //   bloqueio "ja e hoje" (BLOQUEIO_PROXIMO), nao "e amanha".
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
 * PRIORIDADE (maior primeiro): VENCIDA(3) > BLOQUEIO_PROXIMO(2) >
 * VENCE_EM_BREVE(1) > EM_DIA(0). Espelha `situacaoDeVencimento`:
 *   - so invoice `OPEN`/`OVERDUE` entra na conta; qualquer outro status (ou
 *     ausencia de invoice em aberto) e EM_DIA;
 *   - dia civil de `due_at`/`block_at` (armazenados como meia-noite UTC,
 *     como `diaCivilUtcComoNumero` em `vencimento.ts` documenta) comparado
 *     contra o dia civil de `agora` NO FUSO DA UNIDADE -- `AT TIME ZONE`
 *     dobrado (texto -> timestamptz -> timestamp local) e como o Postgres
 *     converte um instante para "que dia e, naquele fuso";
 *   - so a invoice em aberto MAIS ANTIGA (`due_at asc`, `id asc` no empate)
 *     conta -- mesmo criterio de `faturaEmDestaque`.
 */
async function idsOrdenadosPorSituacaoFinanceira(
  tx: Prisma.TransactionClient,
  tenantId: string,
  direcao: 'asc' | 'desc',
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
          WHEN io.student_id IS NULL THEN 0
          WHEN (io.due_at AT TIME ZONE 'UTC')::date
               < (now() AT TIME ZONE gu.timezone)::date THEN
            CASE
              WHEN io.block_at IS NOT NULL
                   AND (io.block_at AT TIME ZONE 'UTC')::date
                       <= (now() AT TIME ZONE gu.timezone)::date
              THEN 2
              ELSE 3
            END
          WHEN (io.due_at AT TIME ZONE 'UTC')::date
               = (now() AT TIME ZONE gu.timezone)::date THEN 1
          ELSE 0
        END AS prioridade
      FROM students s
      JOIN gym_units gu ON gu.id = s.gym_unit_id
      LEFT JOIN invoice_em_aberto io ON io.student_id = s.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.profile = 'STUDENT'
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

- [ ] **Step 5: Ligar a nova ordenação ao `buscar` do repository**

Ainda em `student.repository.ts`, o `orderBy` do `findMany` hoje vem de `ordenacao(filtro.ordem, filtro.direcao)`, uma função pura sem acesso ao banco. Para `ordem === 'situacao'`, o `orderBy` precisa ser por `array_position` sobre os ids já ordenados pela função acima — que exige `tx`, então essa ramificação não pode ficar dentro de `ordenacao()` (que é síncrona e sem `tx`). Ajustar o método `buscar`:

```typescript
      return tx.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          profile: 'STUDENT',
          ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
          ...(filtro.status ? { status: filtro.status } : {}),
          ...(filtro.modalityId ? condicaoDeModalidade(filtro.modalityId) : {}),
          ...condicoes,
          ...(filtro.ordem === 'situacao'
            ? { id: { in: await idsOrdenadosPorSituacaoFinanceira(tx, contexto.tenantId, filtro.direcao ?? 'asc') } }
            : {}),
        },
        orderBy:
          filtro.ordem === 'situacao'
            ? undefined // ordem real vem do `array_position` abaixo, no include/select nao da para expressar; ver nota
            : ordenacao(filtro.ordem, filtro.direcao),
        ...
```

**Nota para o executor:** o Prisma `findMany` **não suporta** `ORDER BY array_position(...)` nativamente. A forma correta é: chamar `idsOrdenadosPorSituacaoFinanceira` primeiro (já devolve os ids na ordem certa, respeitando `where`/paginação seria o ideal, mas a função acima ainda não aplica `status`/`gymUnitId`/`modalityId`/cursor). **Isto expõe uma lacuna real do plano**: `idsOrdenadosPorSituacaoFinanceira` como escrita no Step 4 não recebe os mesmos filtros (`status`, `gymUnitId`, `modalityId`, `termo`, `cursor`) que o resto do `where` aplica. Duas opções, decidir no início deste step antes de codar:

  **Opção A (mais simples, escolher esta salvo objeção):** `idsOrdenadosPorSituacaoFinanceira` recebe os MESMOS parâmetros de filtro que `condicoesDaListagem`/`where` já usa (tenantId, status, gymUnitId, modalityId — replicados como cláusulas `WHERE` adicionais no SQL raw), devolve a lista de ids **já filtrada E ordenada**, e o `findMany` final vira `where: { id: { in: idsRaw } }` **sem** `orderBy` do Prisma — a ordem final é reconstruída em JS após o `findMany` (`Map` de id → posição no array `idsRaw`, depois `.sort()` no array de resultados antes de devolver). Cursor (`filtro.cursor`) vira um corte manual em `idsRaw` (`idsRaw.indexOf(cursor) + 1`) antes do `.slice(0, filtro.limite)`, já que paginação por `skip`/`cursor` do Prisma não se aplica a uma ordem calculada fora dele.

  Reescrever o método `buscar` com essa opção:

```typescript
  async buscar(
    contexto: TenantContext,
    filtro: { /* ...mesma assinatura já existente... */ },
    agora: Date = new Date(),
  ): Promise<Student[]> {
    return this.db.comTenant(async (tx) => {
      const condicoes = await condicoesDaListagem(tx, contexto.tenantId, filtro.termo);

      if (filtro.ordem === 'situacao') {
        const idsNaOrdem = await idsOrdenadosPorSituacaoFinanceira(tx, contexto, filtro);
        const pagina = paginarIds(idsNaOrdem, filtro.cursor, filtro.limite);

        const alunos = await tx.student.findMany({
          where: { id: { in: pagina } },
          include: { /* MESMO include que o findMany abaixo ja usa -- reaproveitar
                         literalmente o mesmo objeto, extraindo-o para uma
                         constante `INCLUDE_DA_LISTAGEM` compartilhada pelos
                         dois caminhos, para nao divergir quando alguem editar
                         um e esquecer do outro */ },
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
        include: { /* mesmo INCLUDE_DA_LISTAGEM */ },
      });
    });
  }
```

  Extrair o objeto `include` atual (linhas ~800-899 do arquivo hoje) para uma constante `INCLUDE_DA_LISTAGEM` no escopo do módulo, e usá-la nos dois `findMany` acima — isto é uma mudança mecânica de refactor, sem alterar comportamento, e deve ser o PRIMEIRO commit deste step (separado do commit que adiciona a ordenação nova), para o diff do comportamento novo ficar legível.

  Escrever a função auxiliar de paginação por array de ids:

```typescript
/** Corta `idsNaOrdem` a partir de `cursor` (exclusivo) e pega `limite`. */
function paginarIds(idsNaOrdem: string[], cursor: string | undefined, limite: number): string[] {
  const inicio = cursor ? idsNaOrdem.indexOf(cursor) + 1 : 0;

  return idsNaOrdem.slice(inicio, inicio + limite);
}
```

  E ajustar `idsOrdenadosPorSituacaoFinanceira` (Step 4) para receber `contexto: TenantContext` e `filtro` completo, aplicando os mesmos `WHERE`s condicionais que `condicoesDaListagem`/o `where` do `findMany` original aplicam (status, gymUnitId, modalityId — replicados como filtros SQL adicionais na CTE `prioridade`, usando os MESMOS valores que `filtro.status`/`filtro.gymUnitId`/`filtro.modalityId` já carregam). O termo de busca textual (`filtro.termo`) usa o mesmo `idsPorNomeSemAcento`/`condicoesDaListagem` já existente, intersectado com o resultado desta função.

  **Opção B (mais simples de implementar, escopo menor):** ordenar por situação SEM combinar com os outros filtros de forma otimizada — aceitar que `ordem=situacao` só funciona sem os filtros `gymUnitId`/`modalityId`/`termo` combinados (documentar a limitação, a API ignora silenciosamente esses filtros quando `ordem=situacao`, ou devolve 400). Rejeitada: contradiz a promessa de "ordena a base inteira" e criaria um comportamento surpreendente sem aviso claro à recepção.

  **Escolher a Opção A.** Ela é mais trabalho, mas é a única que não quebra silenciosamente quando alguém combina "Situação: Bloqueado" + ordenar por pagamento — cenário plausível no dia a dia da recepção.

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

- **Cobertura do design acordado:** os 6 itens do pedido do PI (badge financeira na coluna Situação com Motivo explicando; botão de liberar 3 dias confirmado; Motivo alinhado à esquerda; nome do plano — **fora de escopo, decisão do PI**; renomear coluna Catraca; ordenar Situação) estão cobertos pelas Tasks 1-8, exceto o nome do plano, que o PI decidiu tratar como correção de cadastro, não de código.
- **Tipo/assinatura consistente:** `fraseDeVencimento` (Task 2) usa a mesma assinatura de parâmetros (`invoice, agora, timezone`) que `situacaoDeVencimento`/`diasDeAtraso` já usam, para quem chamar não precisar montar um objeto diferente a cada função.
- **Risco maior do plano:** a Task 7 é a mais arriscada — duplica regra de negócio em SQL, e o `array_position`/paginação por array de ids é uma mudança estrutural no `buscar()` do repository. Se o tempo apertar, considere entregar as Tasks 1-6 (coluna, motivo, catraca, alinhamento, confirmação do botão) como uma fatia própria e as Tasks 7-8 (ordenação) como uma SEGUNDA fatia — o PI já sinalizou disposição a separar quando perguntado sobre escopo do item de ordenação.
