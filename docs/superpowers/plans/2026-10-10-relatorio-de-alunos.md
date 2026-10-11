# Relatórios > Alunos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menu **Relatórios** no painel com o relatório **Alunos** (filtros Unidade, Situação, Perfil, Plano, Financeiro; colunas Catraca, Nome, CPF, Contato, Plano), exportável em PDF e CSV com logo e dados da academia.

**Architecture:** Módulo novo `reports` na API (`GET /api/v1/reports/students` e `.../export`) com **uma** consulta compartilhada pela tela e pela exportação. Os critérios de inadimplente/pagante saem de `billing` para um arquivo único que Cobrança e Relatório consomem. O painel ganha `/reports/students` (Server Component, filtros na URL) e uma Route Handler que repassa o download com o cookie de acesso.

**Tech Stack:** NestJS + Prisma 7 (`comTenant`), `pdfkit` (já na API), `exports/domain/csv.ts`, Zod, Next.js 16 App Router, Vitest, Jest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-10-relatorio-de-alunos-design.md`](../specs/2026-10-10-relatorio-de-alunos-design.md)

**Fatia / SPEC:** `F90` / `SPEC-090` (livres: último alocado é F89; `grep` em 10/10/2026 não achou reserva). Título do card: `[SPEC-090][F90] Relatórios > Alunos` — sem token `[MVP<n>]`, porque o MVP desta fatia não foi dito pelo PI (regra de ouro do `CLAUDE.md`: só entra token que é verdade).

## Global Constraints

- Idioma: texto de interface, docs e commits em **pt-BR**; identificadores em **inglês** onde o repo já usa inglês (`gymUnitId`, `profile`, `status`), nomes de domínio local em pt-BR como o resto do código (`ConsultarRelatorioDeAlunos`).
- Tenant vem **sempre** de `TenantContext` (regra de arquitetura nº 2); toda leitura de tabela com RLS vai dentro de `this.db.comTenant(...)` (guarda `check-rls-fora-de-transacao`).
- Permissão: rota `student.read`; item de menu `exigePermissao: 'student.read'`.
- Teto da exportação: **20.000 linhas** (`REPORT_TOO_LARGE`, HTTP 422). Página da tela: 20 por padrão, máximo 100.
- CSV: UTF-8 **com BOM**, separador **`;`**, fim de linha `\r\n`, toda célula passa por `formatarCelula` (escape RFC 4180 + neutralização de CSV injection).
- Nome do arquivo: `relatorio-alunos-AAAA-MM-DD.pdf|csv` (data no fuso da academia).
- Inadimplente = invoice `OPEN|OVERDUE` com `dueAt < agora`. Pagante = invoice `PAID` com `paidAt` não nulo. **Um** lugar define as duas (Task 1).
- Perfil vazio no filtro = **todos os perfis** (a Lista de Alunos mostra só `STUDENT`; o relatório tem filtro de perfil, então vazio não esconde ninguém).
- Valor de filtro inválido na URL vira "sem filtro", nunca 400 (mesma regra de `GET /students`).
- Sem `any`, sem `console.log`, sem dado real de aluno em fixture/log. `agora` entra por parâmetro.
- Código novo segue o estilo comentado do repo (comentário explica o PORQUÊ), mas sem inflar: nada de abstração de uso único.

## Review Focus

Entradas que a spec implica e que nenhum teste "feliz" exercita; cada linha tem o teste na task indicada.

1. **Aluno sem CPF, telefone, plano ou catraca** → célula vazia (`''` no CSV/PDF, `null` no JSON), nunca `null`/`undefined` escritos no arquivo. (Task 3, Task 4)
2. **Nome começando com `=`, `+`, `-`, `@`** → CSV neutralizado com `'`. (Task 3)
3. **Logo problemática**: SVG (pdfkit não renderiza), PNG corrompido, objeto sumido do bucket, chave de outro tenant → relatório sai com cabeçalho só de texto, nunca 500. (Task 5)
4. **Filtro/cursor lixo ou de outro tenant**: `status=XYZ`, `gymUnitId=abc`, `planId` de outro tenant, `cursor` inexistente → sem filtro / zero linhas / primeira página, nunca vaza dado nem dá 500. (Task 2, Task 4, Task 6)
5. **Base acima do teto** → 422 `REPORT_TOO_LARGE`, nenhum arquivo parcial. (Task 4)

## Decisões registradas (Claude Code, reversíveis)

- A página JSON devolve **envelope** `{ total, linhas, proximoCursor }` (como o painel de Pagantes), em vez de array + `X-Total-Count`. Motivo: `proximoCursor` evita a última página vazia quando o total é múltiplo de 20. A Task 8 atualiza o spec.
- Logo **SVG não entra no PDF** (o formato de upload aceita SVG ou PNG; `pdfkit` só embute PNG/JPEG e `svg-to-pdfkit` seria dependência nova para um cabeçalho). Cai no cabeçalho de texto. `// ponytail:` no código registra o teto e o caminho de upgrade. **Levar ao PI no fim.**
- Filtro **Plano** = plano da assinatura vigente (`ACTIVE`/`PAST_DUE`), o mesmo que a coluna Plano mostra. Acesso por vínculo (cortesia etc.) não tem `planId` e não casa com esse filtro.
- O painel busca a lista de planos em `/api/v1/plans` (exige `plan.read`). Sem essa permissão o filtro Plano simplesmente não aparece — mesma degradação do filtro de unidade.
- CPF volta ao relatório por pedido do PI em 10/10/2026, mesmo tendo saído da grid de Alunos em 01/09/2026 (issue #241). A decisão mais recente vale; a Lista de Alunos **não muda**.

## File Structure

**API — criar** (`apps/api/src/modules/reports/`):

| Arquivo | Responsabilidade |
|---|---|
| `domain/formato-brasileiro.ts` | Puro: máscara de CPF/CNPJ/telefone, data/hora em fuso, rótulo do plano, rótulos pt-BR |
| `domain/filtro-do-relatorio-de-alunos.ts` | Puro: tipo do filtro, `lerFiltro` (degrada para "sem filtro"), `descreverFiltro`, tipo da linha |
| `domain/dados-do-relatorio.ts` | Tipos `CabecalhoDaAcademia` e `DadosDoRelatorioImpresso` |
| `domain/csv-do-relatorio.ts` | Puro: `montarCsvDoRelatorio` → `Buffer` |
| `domain/pdf-do-relatorio.ts` | `gerarPdfDoRelatorio` → `Buffer` (pdfkit) |
| `relatorio-de-alunos.repository.ts` | `ondeDoRelatorio`, `contar`, `listar` (Prisma, `comTenant`) |
| `consultar-relatorio-de-alunos.use-case.ts` | `pagina` e `todos` (teto), erro `REPORT_TOO_LARGE` |
| `cabecalho-da-academia.service.ts` | Dados da academia + logo do storage + nomes do filtro |
| `reports.controller.ts` | As duas rotas |
| `reports.module.ts` | Módulo Nest |

**API — criar fora de `reports/`:** `modules/billing/domain/criterios-financeiros.ts` (+ spec).
**API — modificar:** `exports/domain/csv.ts` (separador opcional), `billing/consultar-inadimplencia.use-case.ts` e `billing/consultar-pagos.use-case.ts` (usam os critérios), `app.module.ts` (importa `ReportsModule`), `test/integration/openapi.int-spec.ts` (lista de rotas), `packages/api-contracts/openapi/arenahub-v1.json` (snapshot regenerado).
**API — testes:** specs ao lado do código (`*.spec.ts`, unit) e `test/integration/reports-alunos.int-spec.ts`, `reports-alunos-http.int-spec.ts`.

**Painel — criar** (`apps/admin-web/`):

| Arquivo | Responsabilidade |
|---|---|
| `src/reports/filtro.ts` | Puro: whitelist de chaves do filtro → `URLSearchParams` |
| `app/(protected)/reports/page.tsx` | Redireciona para `/reports/students` |
| `app/(protected)/reports/students/page.tsx` | Tela (Server Component) |
| `app/(protected)/reports/students/filtro-do-relatorio.tsx` | Selects que escrevem na URL (client) |
| `app/(protected)/reports/students/export/route.ts` | Repassa o download da API com o cookie de acesso |
| `tests/e2e/relatorio-de-alunos.e2e-spec.ts` | Jornada ponta a ponta |

**Painel — modificar:** `app/(protected)/layout.tsx` (item de menu), `app/(protected)/layout.test.tsx` (teste do item).
**Docs — modificar/criar:** `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/specs/SPEC-090-relatorio-de-alunos.md`, o spec (envelope), `docs/TESTS.md` via `pnpm test:report`.

## Comandos usados no plano

```bash
# unit (API) — SEMPRE com --testPathPattern; --selectProjects sozinho roda a suíte inteira
UNIT='pnpm --filter @arenahub/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit --testPathPattern'
# integração (API) — exige o Postgres da Task 0 exportado no shell
INT='pnpm --filter @arenahub/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration --maxWorkers=1 --testPathPattern'
# painel
WEB='pnpm --filter @arenahub/admin-web exec vitest run'
```

---

### Task 0: Ambiente de teste e branch de trabalho

**Files:** nenhum (ambiente).

- [ ] **Step 1: Branch a partir da `main` atualizada**

```bash
git fetch origin && git checkout -b feat/f90-relatorio-de-alunos origin/main
git cherry-pick docs/spec-relatorio-de-alunos   # traz spec + este plano para a branch da entrega
```

Expected: branch criada com o spec e o plano. (Se o PI já mergeou a branch de docs, pular o cherry-pick.)

- [ ] **Step 2: Postgres descartável em porta nova** (nunca a porta já configurada; nunca o `DATABASE_URL` do `.env`, que aponta para produção)

```bash
docker run -d --name arenahub-f90-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=f90-descartavel -e POSTGRES_DB=arenahub_f90_int -e POSTGRES_INITDB_ARGS="--locale-provider=icu --icu-locale=pt-BR --encoding=UTF8 --locale=C" -p 127.0.0.1:5492:5432 postgres:17-alpine
export INTEGRATION_DATABASE_URL='postgresql://postgres:f90-descartavel@127.0.0.1:5492/arenahub_f90_int?schema=public'
export DATABASE_URL="$INTEGRATION_DATABASE_URL"
pnpm exec prisma migrate deploy && pnpm exec prisma generate && pnpm --filter @arenahub/database build
```

Expected: migrations aplicadas, client gerado. Se a porta 5492 estiver ocupada, trocar por outra livre e ajustar a URL. **Nunca imprimir** trecho do `.env`.

- [ ] **Step 3: Provar que o ambiente roda uma suíte de integração existente**

```bash
eval "$INT billing-pagos"
```

Expected: PASS. (Se falhar por conexão, o ambiente está errado — corrigir antes de seguir.)

---

### Task 1: Critérios financeiros compartilhados (Cobrança ↔ Relatório)

Os critérios de "inadimplente" e "pagante" hoje moram dentro de dois use-cases de Cobrança. O relatório precisa dos mesmos, **e não de cópias** (Riscos do spec).

**Files:**
- Create: `apps/api/src/modules/billing/domain/criterios-financeiros.ts`
- Create: `apps/api/src/modules/billing/domain/criterios-financeiros.spec.ts`
- Modify: `apps/api/src/modules/billing/consultar-inadimplencia.use-case.ts` (o `where` de `tx.invoice.findMany`, hoje linhas ~118-122)
- Modify: `apps/api/src/modules/billing/consultar-pagos.use-case.ts` (o `where` de `tx.invoice.findMany`, hoje linhas ~92-96)

**Interfaces:**
- Produces: `faturaVencidaEmAberto(agora: Date): Prisma.InvoiceWhereInput` e `FATURA_PAGA: Prisma.InvoiceWhereInput`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/modules/billing/domain/criterios-financeiros.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import { FATURA_PAGA, faturaVencidaEmAberto } from './criterios-financeiros.js';

describe('critérios financeiros do aluno', () => {
  it('inadimplente = invoice OPEN ou OVERDUE com vencimento ANTERIOR a agora', () => {
    const agora = new Date('2026-10-10T15:00:00.000Z');

    expect(faturaVencidaEmAberto(agora)).toEqual({
      status: { in: ['OPEN', 'OVERDUE'] },
      dueAt: { lt: agora },
    });
  });

  it('pagante = invoice PAID com paidAt preenchido', () => {
    expect(FATURA_PAGA).toEqual({ status: 'PAID', paidAt: { not: null } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `eval "$UNIT criterios-financeiros"`
Expected: FAIL — `Cannot find module './criterios-financeiros.js'`.

- [ ] **Step 3: Implementar**

`apps/api/src/modules/billing/domain/criterios-financeiros.ts`:

```ts
import type { Prisma } from '@arenahub/database';

/**
 * Os dois critérios financeiros que mais de uma tela usa, num lugar só.
 *
 * Antes daqui cada um morava dentro do use-case da tela de Cobrança
 * (`consultar-inadimplencia` e `consultar-pagos`). O Relatório de Alunos
 * precisa responder "quem está inadimplente?" e "quem é pagante?" com a MESMA
 * resposta da Cobrança: duas cópias divergem na primeira edição, e o gestor
 * veria um número no relatório e outro na fila de cobrança.
 */

/**
 * Fatura vencida e em aberto -- o que a tela Cobrança chama de inadimplência.
 * `agora` entra por parâmetro: o critério depende do relógio.
 */
export function faturaVencidaEmAberto(agora: Date): Prisma.InvoiceWhereInput {
  return { status: { in: ['OPEN', 'OVERDUE'] }, dueAt: { lt: agora } };
}

/** Fatura paga -- o que a aba Pagantes considera. */
export const FATURA_PAGA: Prisma.InvoiceWhereInput = { status: 'PAID', paidAt: { not: null } };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `eval "$UNIT criterios-financeiros"`
Expected: PASS (2 testes).

- [ ] **Step 5: Fazer as duas telas consumirem os critérios**

Em `consultar-inadimplencia.use-case.ts`, adicionar o import
`import { faturaVencidaEmAberto } from './domain/criterios-financeiros.js';`
e trocar o `where`:

```ts
        where: {
          tenantId: contexto.tenantId,
          ...faturaVencidaEmAberto(agora),
        },
```

Em `consultar-pagos.use-case.ts`, adicionar
`import { FATURA_PAGA } from './domain/criterios-financeiros.js';`
e trocar o `where`:

```ts
        where: {
          tenantId: contexto.tenantId,
          ...FATURA_PAGA,
        },
```

- [ ] **Step 6: Provar que a refatoração não mudou comportamento**

Run: `eval "$INT billing-inadimplencia" && eval "$INT billing-pagos"`
Expected: PASS nas duas (são as suítes que já cobrem o comportamento das telas).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/billing
git commit -m "refactor: critérios de inadimplente e pagante num arquivo só (refs #<N>)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Formatação brasileira e filtro do relatório (puros)

**Files:**
- Create: `apps/api/src/modules/reports/domain/formato-brasileiro.ts`
- Create: `apps/api/src/modules/reports/domain/formato-brasileiro.spec.ts`
- Create: `apps/api/src/modules/reports/domain/filtro-do-relatorio-de-alunos.ts`
- Create: `apps/api/src/modules/reports/domain/filtro-do-relatorio-de-alunos.spec.ts`

**Interfaces:**
- Produces (`formato-brasileiro.ts`):
  - `formatarCpf(cpf: string | null): string`
  - `formatarCnpj(cnpj: string): string`
  - `formatarTelefone(valor: string | null): string`
  - `formatarDataHora(data: Date, fuso: string): string` → `DD/MM/AAAA HH:mm`
  - `dataParaNomeDeArquivo(data: Date, fuso: string): string` → `AAAA-MM-DD`
  - `rotuloDoPlano(planName: string | null, accessSource: string | null): string | null`
  - `ROTULO_DE_SITUACAO`, `ROTULO_DE_PERFIL`, `ROTULO_FINANCEIRO`: `Readonly<Record<string, string>>`
- Produces (`filtro-do-relatorio-de-alunos.ts`):
  - `SITUACOES_DO_ALUNO`, `PERFIS_DO_ALUNO`, `VALORES_FINANCEIROS` (tuplas `as const`)
  - `interface FiltroDoRelatorioDeAlunos { readonly gymUnitId: string | undefined; readonly status: (typeof SITUACOES_DO_ALUNO)[number] | undefined; readonly profile: (typeof PERFIS_DO_ALUNO)[number] | undefined; readonly planId: string | undefined; readonly financeiro: (typeof VALORES_FINANCEIROS)[number] | undefined }`
  - `interface LinhaDoRelatorioDeAlunos { readonly studentId: string; readonly deviceIds: readonly string[]; readonly fullName: string; readonly cpf: string | null; readonly phone: string | null; readonly planLabel: string | null }`
  - `lerFiltro(entrada: Record<string, unknown>): FiltroDoRelatorioDeAlunos`
  - `interface NomesDoFiltro { readonly unidade: string | undefined; readonly plano: string | undefined }`
  - `descreverFiltro(filtro: FiltroDoRelatorioDeAlunos, nomes: NomesDoFiltro): string[]`

- [ ] **Step 1: Teste da formatação (falha)**

`formato-brasileiro.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import {
  dataParaNomeDeArquivo,
  formatarCnpj,
  formatarCpf,
  formatarDataHora,
  formatarTelefone,
  rotuloDoPlano,
} from './formato-brasileiro.js';

describe('formatarCpf', () => {
  it('aplica a máscara em 11 dígitos', () => {
    expect(formatarCpf('11144477735')).toBe('111.444.777-35');
  });
  it('mantém quem já vem formatado', () => {
    expect(formatarCpf('111.444.777-35')).toBe('111.444.777-35');
  });
  it('null vira vazio, nunca a palavra "null"', () => {
    expect(formatarCpf(null)).toBe('');
  });
  it('valor que não é CPF volta como veio (não inventa dígito)', () => {
    expect(formatarCpf('123')).toBe('123');
  });
});

describe('formatarCnpj', () => {
  it('aplica a máscara em 14 dígitos', () => {
    expect(formatarCnpj('12345678000195')).toBe('12.345.678/0001-95');
  });
  it('valor fora do padrão volta como veio', () => {
    expect(formatarCnpj('123')).toBe('123');
  });
});

describe('formatarTelefone', () => {
  it('celular com DDD', () => {
    expect(formatarTelefone('41999990000')).toBe('(41) 99999-0000');
  });
  it('fixo com DDD', () => {
    expect(formatarTelefone('4133334444')).toBe('(41) 3333-4444');
  });
  it('tira o DDI 55', () => {
    expect(formatarTelefone('+5541999990000')).toBe('(41) 99999-0000');
  });
  it('null vira vazio', () => {
    expect(formatarTelefone(null)).toBe('');
  });
  it('número fora do padrão volta como veio', () => {
    expect(formatarTelefone('12345')).toBe('12345');
  });
});

describe('formatarDataHora / dataParaNomeDeArquivo', () => {
  const instante = new Date('2026-10-10T17:32:00.000Z');

  it('usa o fuso da academia (São Paulo = UTC-3)', () => {
    expect(formatarDataHora(instante, 'America/Sao_Paulo')).toBe('10/10/2026 14:32');
  });
  it('outro fuso dá outra hora (Manaus = UTC-4)', () => {
    expect(formatarDataHora(instante, 'America/Manaus')).toBe('10/10/2026 13:32');
  });
  it('virada do dia respeita o fuso: 02:30Z de 11/10 ainda é 10/10 em São Paulo', () => {
    const virada = new Date('2026-10-11T02:30:00.000Z');

    expect(formatarDataHora(virada, 'America/Sao_Paulo')).toBe('10/10/2026 23:30');
    expect(dataParaNomeDeArquivo(virada, 'America/Sao_Paulo')).toBe('2026-10-10');
  });
});

describe('rotuloDoPlano', () => {
  it('o nome do plano vence', () => {
    expect(rotuloDoPlano('Mensal Fit', 'SUBSCRIPTION')).toBe('Mensal Fit');
  });
  it('sem plano, acesso por vínculo mostra a origem', () => {
    expect(rotuloDoPlano(null, 'EMPLOYEE')).toBe('Funcionário');
  });
  it('sem plano e sem vínculo é null (célula vazia)', () => {
    expect(rotuloDoPlano(null, null)).toBeNull();
  });
  it('origem SUBSCRIPTION sem nome de plano não ganha rótulo', () => {
    expect(rotuloDoPlano(null, 'SUBSCRIPTION')).toBeNull();
  });
  it('origem desconhecida cai no próprio código, nunca em branco', () => {
    expect(rotuloDoPlano(null, 'NOVA_ORIGEM')).toBe('NOVA_ORIGEM');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `eval "$UNIT formato-brasileiro"`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar a formatação**

`formato-brasileiro.ts`:

```ts
/**
 * Formatação pt-BR do Relatório de Alunos, em funções puras.
 *
 * Existe aqui, e não no painel, porque PDF e CSV nascem NA API: o arquivo não
 * passa pelo navegador de ninguém. O painel tem a própria máscara
 * (`src/lib/mascaras.ts`) para o que mostra na tela; as duas precisam
 * concordar no formato, e os testes dos dois lados o fixam.
 */

const soDigitos = (valor: string): string => valor.replace(/\D/g, '');

export function formatarCpf(cpf: string | null): string {
  if (cpf === null) return '';

  const d = soDigitos(cpf);

  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}

export function formatarCnpj(cnpj: string): string {
  const d = soDigitos(cnpj);

  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : cnpj;
}

export function formatarTelefone(valor: string | null): string {
  if (valor === null) return '';

  const d = soDigitos(valor);
  const nacional = d.length > 11 && d.startsWith('55') ? d.slice(2) : d;

  if (nacional.length === 11) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  }
  if (nacional.length === 10) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  }

  return valor;
}

/**
 * Partes da data no fuso pedido. `formatToParts`, e não `format`: o texto de
 * `format` varia com a versão do ICU do servidor, as partes não.
 */
function partesDaData(data: Date, fuso: string): (tipo: string) => string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);

  return (tipo) => partes.find((p) => p.type === tipo)?.value ?? '';
}

/** `10/10/2026 14:32` no fuso da academia. */
export function formatarDataHora(data: Date, fuso: string): string {
  const p = partesDaData(data, fuso);

  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`;
}

/** `2026-10-10`, para o nome do arquivo. */
export function dataParaNomeDeArquivo(data: Date, fuso: string): string {
  const p = partesDaData(data, fuso);

  return `${p('year')}-${p('month')}-${p('day')}`;
}

const ROTULO_DE_ORIGEM: Readonly<Record<string, string>> = {
  SUBSCRIPTION: 'Assinatura',
  COURTESY: 'Cortesia',
  EMPLOYEE: 'Funcionário',
  PERSONAL_TRAINER: 'Personal trainer',
  VISITOR: 'Visitante',
  TRIAL_CLASS: 'Aula experimental',
  DEPENDENT: 'Dependente',
  PARTNER: 'Parceiro',
  CORPORATE: 'Convênio corporativo',
};

/**
 * O que a coluna PLANO mostra -- a mesma regra da Lista de Alunos
 * (`planoDaListagem`, em `admin-web/src/students/formatar.ts`): nome do plano
 * quando há assinatura; origem do vínculo quando o acesso não nasce de
 * assinatura; `null` quando não há nada (célula vazia, não "sem plano").
 */
export function rotuloDoPlano(planName: string | null, accessSource: string | null): string | null {
  if (planName !== null) return planName;
  if (accessSource === null || accessSource === 'SUBSCRIPTION') return null;

  return ROTULO_DE_ORIGEM[accessSource] ?? accessSource;
}

export const ROTULO_DE_SITUACAO: Readonly<Record<string, string>> = {
  LEAD: 'Interessado',
  TRIAL: 'Experimental',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
  CANCELLED: 'Cancelado',
  ARCHIVED: 'Arquivado',
};

export const ROTULO_DE_PERFIL: Readonly<Record<string, string>> = {
  STUDENT: 'Aluno',
  TRAINER: 'Professor',
  STAFF: 'Funcionário',
  ADMIN: 'Administrador',
  PERMUTA_TACIO: 'Permuta-Tacio',
  PERMUTA_DOUGLAS: 'Permuta-Douglas',
};

export const ROTULO_FINANCEIRO: Readonly<Record<string, string>> = {
  INADIMPLENTES: 'Inadimplentes',
  PAGANTES: 'Pagantes',
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `eval "$UNIT formato-brasileiro"`
Expected: PASS.

- [ ] **Step 5: Teste do filtro (falha)**

`filtro-do-relatorio-de-alunos.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import { descreverFiltro, lerFiltro } from './filtro-do-relatorio-de-alunos.js';

const UUID = '3f6c1c2e-8a4b-4d57-9a2e-6a1f0d7b9c11';

describe('lerFiltro', () => {
  it('lê os cinco filtros válidos', () => {
    expect(
      lerFiltro({
        gymUnitId: UUID,
        status: 'ACTIVE',
        profile: 'TRAINER',
        planId: UUID,
        financeiro: 'INADIMPLENTES',
      }),
    ).toEqual({
      gymUnitId: UUID,
      status: 'ACTIVE',
      profile: 'TRAINER',
      planId: UUID,
      financeiro: 'INADIMPLENTES',
    });
  });

  it('valor inválido vira "sem filtro", nunca erro (a URL é editada à mão)', () => {
    expect(
      lerFiltro({
        gymUnitId: 'abc',
        status: 'ATIVO',
        profile: 'CHEFE',
        planId: '',
        financeiro: 'TODOS',
      }),
    ).toEqual({
      gymUnitId: undefined,
      status: undefined,
      profile: undefined,
      planId: undefined,
      financeiro: undefined,
    });
  });

  it('chaves ausentes e tipos estranhos (array, número) também viram "sem filtro"', () => {
    expect(lerFiltro({ status: ['ACTIVE', 'BLOCKED'], planId: 7 })).toEqual({
      gymUnitId: undefined,
      status: undefined,
      profile: undefined,
      planId: undefined,
      financeiro: undefined,
    });
  });
});

describe('descreverFiltro', () => {
  const vazio = lerFiltro({});

  it('sem filtro, lista vazia', () => {
    expect(descreverFiltro(vazio, { unidade: undefined, plano: undefined })).toEqual([]);
  });

  it('descreve cada filtro em pt-BR, com o NOME da unidade e do plano', () => {
    const filtro = lerFiltro({
      gymUnitId: UUID,
      status: 'BLOCKED',
      profile: 'STUDENT',
      planId: UUID,
      financeiro: 'PAGANTES',
    });

    expect(descreverFiltro(filtro, { unidade: 'Matriz', plano: 'Mensal Fit' })).toEqual([
      'Unidade: Matriz',
      'Situação: Bloqueado',
      'Perfil: Aluno',
      'Plano: Mensal Fit',
      'Financeiro: Pagantes',
    ]);
  });

  it('id que não resolveu para nome aparece como "não encontrado", não some', () => {
    const filtro = lerFiltro({ gymUnitId: UUID, planId: UUID });

    expect(descreverFiltro(filtro, { unidade: undefined, plano: undefined })).toEqual([
      'Unidade: não encontrada',
      'Plano: não encontrado',
    ]);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `eval "$UNIT filtro-do-relatorio-de-alunos"`
Expected: FAIL — módulo não existe.

- [ ] **Step 7: Implementar o filtro**

`filtro-do-relatorio-de-alunos.ts`:

```ts
import { z } from 'zod';

import {
  ROTULO_DE_PERFIL,
  ROTULO_DE_SITUACAO,
  ROTULO_FINANCEIRO,
} from './formato-brasileiro.js';

/** As sete situações do aluno -- as mesmas de `situacaoDoAluno` em `students.controller.ts`. */
export const SITUACOES_DO_ALUNO = [
  'LEAD',
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
] as const;

/** Os seis perfis (`StudentProfile`). */
export const PERFIS_DO_ALUNO = [
  'ADMIN',
  'STUDENT',
  'STAFF',
  'TRAINER',
  'PERMUTA_TACIO',
  'PERMUTA_DOUGLAS',
] as const;

export const VALORES_FINANCEIROS = ['INADIMPLENTES', 'PAGANTES'] as const;

export interface FiltroDoRelatorioDeAlunos {
  /** Unidade de ORIGEM do aluno (mesma coluna que o filtro da Lista de Alunos). */
  readonly gymUnitId: string | undefined;
  readonly status: (typeof SITUACOES_DO_ALUNO)[number] | undefined;
  /** Vazio = todos os perfis. */
  readonly profile: (typeof PERFIS_DO_ALUNO)[number] | undefined;
  /** Plano da assinatura vigente. */
  readonly planId: string | undefined;
  readonly financeiro: (typeof VALORES_FINANCEIROS)[number] | undefined;
}

/** Uma linha do relatório, já sem nada que a tela ou o arquivo não mostrem. */
export interface LinhaDoRelatorioDeAlunos {
  readonly studentId: string;
  /** Números do leitor; vazio antes da primeira credencial. */
  readonly deviceIds: readonly string[];
  readonly fullName: string;
  /** Em claro, como está no cadastro (ADR-034). */
  readonly cpf: string | null;
  readonly phone: string | null;
  /** Nome do plano ou origem do vínculo; `null` = nada a mostrar. */
  readonly planLabel: string | null;
}

/**
 * Lê UM valor ou devolve `undefined`.
 *
 * Valor inválido vira "sem filtro" e não 400 -- mesma regra de
 * `GET /students`: o parâmetro vem da URL, que a recepção edita, o colega
 * manda por chat e o navegador restaura de sessão antiga. Trocar a tela
 * inteira por erro por causa de um `?status=ATIVO` datilografado seria pior
 * que mostrar a lista completa.
 */
function ler<T>(esquema: z.ZodType<T>, bruto: unknown): T | undefined {
  const resultado = esquema.safeParse(bruto);

  return resultado.success ? resultado.data : undefined;
}

export function lerFiltro(entrada: Record<string, unknown>): FiltroDoRelatorioDeAlunos {
  return {
    gymUnitId: ler(z.string().uuid(), entrada['gymUnitId']),
    status: ler(z.enum(SITUACOES_DO_ALUNO), entrada['status']),
    profile: ler(z.enum(PERFIS_DO_ALUNO), entrada['profile']),
    planId: ler(z.string().uuid(), entrada['planId']),
    financeiro: ler(z.enum(VALORES_FINANCEIROS), entrada['financeiro']),
  };
}

export interface NomesDoFiltro {
  readonly unidade: string | undefined;
  readonly plano: string | undefined;
}

/** As linhas "Filtros:" do cabeçalho do arquivo, em pt-BR. */
export function descreverFiltro(filtro: FiltroDoRelatorioDeAlunos, nomes: NomesDoFiltro): string[] {
  const linhas: string[] = [];

  if (filtro.gymUnitId !== undefined) linhas.push(`Unidade: ${nomes.unidade ?? 'não encontrada'}`);
  if (filtro.status !== undefined) linhas.push(`Situação: ${ROTULO_DE_SITUACAO[filtro.status] ?? filtro.status}`);
  if (filtro.profile !== undefined) linhas.push(`Perfil: ${ROTULO_DE_PERFIL[filtro.profile] ?? filtro.profile}`);
  if (filtro.planId !== undefined) linhas.push(`Plano: ${nomes.plano ?? 'não encontrado'}`);
  if (filtro.financeiro !== undefined) {
    linhas.push(`Financeiro: ${ROTULO_FINANCEIRO[filtro.financeiro] ?? filtro.financeiro}`);
  }

  return linhas;
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `eval "$UNIT filtro-do-relatorio-de-alunos" && eval "$UNIT formato-brasileiro"`
Expected: PASS nas duas.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/reports/domain
git commit -m "feat: formatação pt-BR e leitura do filtro do relatório de alunos (refs #<N>)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CSV do relatório

**Files:**
- Modify: `apps/api/src/modules/exports/domain/csv.ts` (`formatarCelula`, linha ~52)
- Modify: `apps/api/src/modules/exports/domain/csv.spec.ts` (acrescentar casos)
- Create: `apps/api/src/modules/reports/domain/dados-do-relatorio.ts`
- Create: `apps/api/src/modules/reports/domain/csv-do-relatorio.ts`
- Create: `apps/api/src/modules/reports/domain/csv-do-relatorio.spec.ts`

**Interfaces:**
- Consumes: `formatarCpf`, `formatarCnpj`, `formatarTelefone`, `formatarDataHora`, `LinhaDoRelatorioDeAlunos` (Task 2).
- Produces: `formatarCelula(valor, separador = ',')` (retrocompatível); `CabecalhoDaAcademia`, `DadosDoRelatorioImpresso`; `montarCsvDoRelatorio(dados: DadosDoRelatorioImpresso): Buffer`.

- [ ] **Step 1: Teste do separador em `csv.ts` (falha)**

Acrescentar ao final de `csv.spec.ts` (manter o `import` existente de `formatarCelula`; se ele não estiver importado, acrescentá-lo):

```ts
describe('formatarCelula com separador explícito', () => {
  it('com ";" entre aspas só quem contém ";"', () => {
    expect(formatarCelula('a;b', ';')).toBe('"a;b"');
    expect(formatarCelula('a,b', ';')).toBe('a,b');
  });

  it('sem o segundo argumento o comportamento antigo (",") não muda', () => {
    expect(formatarCelula('a,b')).toBe('"a,b"');
    expect(formatarCelula('a;b')).toBe('a;b');
  });

  it('neutraliza fórmula antes de escapar, em qualquer separador', () => {
    expect(formatarCelula('=1+1', ';')).toBe("'=1+1");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `eval "$UNIT exports/domain/csv"`
Expected: FAIL — `formatarCelula('a;b', ';')` devolve `a;b` (sem aspas) hoje.

- [ ] **Step 3: Implementar o separador opcional**

Em `csv.ts`, trocar a assinatura e a linha `precisaAspas`:

```ts
export function formatarCelula(
  valor: string | number | boolean | null | undefined,
  separador = ',',
): string {
  if (valor === null || valor === undefined) return '';

  const texto = neutralizarCelula(String(valor));

  const precisaAspas =
    texto.includes(separador) ||
    texto.includes('"') ||
    texto.includes('\n') ||
    texto.includes('\r');
```

(O resto da função, `if (!precisaAspas) return texto; return ...` e `formatarLinha`, ficam como estão.)

- [ ] **Step 4: Rodar e ver passar**

Run: `eval "$UNIT exports/domain/csv"`
Expected: PASS (casos novos e antigos).

- [ ] **Step 5: Tipos de entrada dos arquivos**

`apps/api/src/modules/reports/domain/dados-do-relatorio.ts`:

```ts
import type { LinhaDoRelatorioDeAlunos } from './filtro-do-relatorio-de-alunos.js';

/** Quem emite o relatório -- o que vai no cabeçalho do PDF e do CSV. */
export interface CabecalhoDaAcademia {
  readonly nome: string;
  readonly razaoSocial: string;
  /** 14 dígitos, como no cadastro. */
  readonly cnpj: string | null;
  readonly endereco: string | null;
  readonly telefone: string | null;
  /** Fuso IANA em que `geradoEm` é mostrado. */
  readonly fuso: string;
  /** `null` = sem logo, ilegível ou de outro tenant: o cabeçalho cai para texto. */
  readonly logo: { readonly body: Buffer; readonly contentType: string } | null;
}

export interface DadosDoRelatorioImpresso {
  readonly academia: CabecalhoDaAcademia;
  /** Linhas já em pt-BR (`descreverFiltro`). Vazia = "Nenhum". */
  readonly filtros: readonly string[];
  readonly geradoEm: Date;
  readonly total: number;
  readonly linhas: readonly LinhaDoRelatorioDeAlunos[];
}
```

- [ ] **Step 6: Teste do CSV do relatório (falha)**

`csv-do-relatorio.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import { montarCsvDoRelatorio } from './csv-do-relatorio.js';
import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';

const BASE: DadosDoRelatorioImpresso = {
  academia: {
    nome: 'Arena Positiva',
    razaoSocial: 'Complexo Arena Positiva LTDA',
    cnpj: '12345678000195',
    endereco: 'Rua A, 10, Curitiba - PR, CEP 80000000',
    telefone: '4133334444',
    fuso: 'America/Sao_Paulo',
    logo: null,
  },
  filtros: ['Situação: Ativo'],
  geradoEm: new Date('2026-10-10T17:32:00.000Z'),
  total: 2,
  linhas: [
    {
      studentId: 'a',
      deviceIds: ['1042', '1043'],
      fullName: 'Maria da Silva',
      cpf: '11144477735',
      phone: '41999990000',
      planLabel: 'Mensal Fit',
    },
    {
      studentId: 'b',
      deviceIds: [],
      fullName: '=HYPERLINK("http://x")',
      cpf: null,
      phone: null,
      planLabel: null,
    },
  ],
};

const texto = (dados = BASE): string => montarCsvDoRelatorio(dados).toString('utf8');

describe('montarCsvDoRelatorio', () => {
  it('começa com BOM UTF-8 (o Excel abre os acentos certos)', () => {
    const bytes = montarCsvDoRelatorio(BASE);

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('usa ";" e \\r\\n, com os dados da academia no topo', () => {
    const linhas = texto().replace(/^﻿/, '').split('\r\n');

    expect(linhas.slice(0, 9)).toEqual([
      'Relatório de Alunos',
      'Arena Positiva',
      'Razão social;Complexo Arena Positiva LTDA',
      'CNPJ;12.345.678/0001-95',
      'Endereço;Rua A, 10, Curitiba - PR, CEP 80000000',
      'Telefone;(41) 3333-4444',
      'Gerado em;10/10/2026 14:32',
      'Filtros;Situação: Ativo',
      'Total de alunos;2',
    ]);
  });

  it('linha em branco, depois colunas e alunos formatados', () => {
    const linhas = texto().replace(/^﻿/, '').split('\r\n');

    expect(linhas[9]).toBe('');
    expect(linhas[10]).toBe('Catraca;Nome;CPF;Contato;Plano');
    expect(linhas[11]).toBe('1042, 1043;Maria da Silva;111.444.777-35;(41) 99999-0000;Mensal Fit');
  });

  it('aluno sem CPF, contato, plano e catraca: células vazias, nunca "null"', () => {
    const linhas = texto().replace(/^﻿/, '').split('\r\n');

    // Célula com aspas internas vai entre aspas, com as internas duplicadas (RFC 4180);
    // o `'` na frente é a neutralização de fórmula.
    expect(linhas[12]).toBe(`;"'=HYPERLINK(""http://x"")";;;`);
    expect(texto()).not.toMatch(/null|undefined/);
  });

  it('nome que parece fórmula é neutralizado com aspa simples', () => {
    expect(texto()).toContain(`'=HYPERLINK(`);
  });

  it('sem filtro escreve "Nenhum"; sem CNPJ/endereço/telefone deixa o valor vazio', () => {
    const sem = texto({
      ...BASE,
      filtros: [],
      academia: { ...BASE.academia, cnpj: null, endereco: null, telefone: null },
    });

    expect(sem).toContain('Filtros;Nenhum');
    expect(sem).toContain('CNPJ;\r\n');
    expect(sem).toContain('Endereço;\r\n');
    expect(sem).toContain('Telefone;\r\n');
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `eval "$UNIT csv-do-relatorio"`
Expected: FAIL — módulo não existe.

- [ ] **Step 8: Implementar o CSV**

`csv-do-relatorio.ts`:

```ts
import { formatarCelula } from '../../exports/domain/csv.js';
import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';
import {
  formatarCnpj,
  formatarCpf,
  formatarDataHora,
  formatarTelefone,
} from './formato-brasileiro.js';

const SEPARADOR = ';';
const BOM = '﻿';
const FIM_DE_LINHA = '\r\n';

type Celula = string | number | null;

/**
 * Ponto e vírgula, e não vírgula: o Excel em pt-BR usa vírgula como separador
 * decimal e abriria o arquivo inteiro numa coluna só. O BOM é o que faz o
 * Excel reconhecer UTF-8 -- sem ele, "Ação" vira "AÃ§Ã£o".
 */
const linha = (celulas: readonly Celula[]): string =>
  celulas.map((c) => formatarCelula(c, SEPARADOR)).join(SEPARADOR);

export function montarCsvDoRelatorio(dados: DadosDoRelatorioImpresso): Buffer {
  const { academia } = dados;

  const linhas: (readonly Celula[])[] = [
    ['Relatório de Alunos'],
    [academia.nome],
    ['Razão social', academia.razaoSocial],
    ['CNPJ', academia.cnpj === null ? '' : formatarCnpj(academia.cnpj)],
    ['Endereço', academia.endereco ?? ''],
    ['Telefone', formatarTelefone(academia.telefone)],
    ['Gerado em', formatarDataHora(dados.geradoEm, academia.fuso)],
    ['Filtros', dados.filtros.length > 0 ? dados.filtros.join(' | ') : 'Nenhum'],
    ['Total de alunos', dados.total],
    [],
    ['Catraca', 'Nome', 'CPF', 'Contato', 'Plano'],
    ...dados.linhas.map((aluno) => [
      aluno.deviceIds.join(', '),
      aluno.fullName,
      formatarCpf(aluno.cpf),
      formatarTelefone(aluno.phone),
      aluno.planLabel ?? '',
    ]),
  ];

  return Buffer.from(BOM + linhas.map(linha).join(FIM_DE_LINHA) + FIM_DE_LINHA, 'utf8');
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `eval "$UNIT csv-do-relatorio"`
Expected: PASS (6 testes).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/exports apps/api/src/modules/reports/domain
git commit -m "feat: CSV do relatório de alunos com BOM, ponto e vírgula e dados da academia (refs #<N>)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Repositório e caso de uso (consulta compartilhada)

**Files:**
- Create: `apps/api/src/modules/reports/relatorio-de-alunos.repository.ts`
- Create: `apps/api/src/modules/reports/consultar-relatorio-de-alunos.use-case.ts`
- Create: `apps/api/src/modules/reports/consultar-relatorio-de-alunos.use-case.spec.ts`
- Create: `apps/api/test/integration/reports-alunos.int-spec.ts`

**Interfaces:**
- Consumes: `FiltroDoRelatorioDeAlunos`, `LinhaDoRelatorioDeAlunos`, `rotuloDoPlano` (Task 2); `faturaVencidaEmAberto`, `FATURA_PAGA` (Task 1); `TenantContext`; `PrismaService.comTenant`.
- Produces:
  - `RelatorioDeAlunosRepository.contar(contexto: TenantContext, filtro: FiltroDoRelatorioDeAlunos, agora: Date): Promise<number>`
  - `RelatorioDeAlunosRepository.listar(contexto: TenantContext, filtro: FiltroDoRelatorioDeAlunos, agora: Date, janela: { limite: number; cursor?: string | undefined }): Promise<LinhaDoRelatorioDeAlunos[]>`
  - `TETO_DE_LINHAS_DA_EXPORTACAO = 20_000`, `LIMITE_MAXIMO_DA_PAGINA = 100`
  - `interface PaginaDoRelatorio { readonly total: number; readonly linhas: readonly LinhaDoRelatorioDeAlunos[]; readonly proximoCursor: string | null }`
  - `ConsultarRelatorioDeAlunosUseCase.pagina(contexto, filtro, janela: { limite: number; cursor?: string | undefined }, agora: Date): Promise<PaginaDoRelatorio>`
  - `ConsultarRelatorioDeAlunosUseCase.todos(contexto, filtro, agora): Promise<{ total: number; linhas: readonly LinhaDoRelatorioDeAlunos[] }>` — lança `ErroDeDominio('REPORT_TOO_LARGE', 422, ...)`.

- [ ] **Step 1: Teste de integração do repositório (falha)**

`apps/api/test/integration/reports-alunos.int-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { ConsultarInadimplenciaUseCase } from '../../src/modules/billing/consultar-inadimplencia.use-case.js';
import { ConsultarPagosUseCase } from '../../src/modules/billing/consultar-pagos.use-case.js';
import {
  lerFiltro,
  type FiltroDoRelatorioDeAlunos,
} from '../../src/modules/reports/domain/filtro-do-relatorio-de-alunos.js';
import { RelatorioDeAlunosRepository } from '../../src/modules/reports/relatorio-de-alunos.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  apagarCenario,
  contextoDe,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * Relatório de Alunos, contra Postgres de verdade (`docs/TESTING.md` §3): o
 * filtro por relação (`invoices some`, `subscriptions some`), a ordenação e a
 * paginação por cursor são comportamento do Prisma e do banco -- dublê
 * provaria só a sintaxe.
 */
describe('F90 -- consulta do Relatório de Alunos', () => {
  let db: PrismaService;
  let repo: RelatorioDeAlunosRepository;
  let inadimplencia: ConsultarInadimplenciaUseCase;
  let pagos: ConsultarPagosUseCase;
  let c: CenarioDeDiaria;
  let outro: CenarioDeDiaria;
  let ctx: TenantContext;
  let planoId: string;
  let planoOutroTenantId: string;
  let segundaUnidadeId: string;
  let numeroDaFatura = 1;

  const AGORA = new Date('2026-10-10T15:00:00.000Z');
  const SEM_FILTRO = lerFiltro({});
  const com = (f: Record<string, unknown>): FiltroDoRelatorioDeAlunos => lerFiltro(f);

  const nomes = async (filtro: FiltroDoRelatorioDeAlunos, limite = 100): Promise<string[]> =>
    (await repo.listar(ctx, filtro, AGORA, { limite })).map((l) => l.fullName);

  async function aluno(opcoes: {
    nome: string;
    unidadeId?: string;
    profile?: 'STUDENT' | 'TRAINER';
    status?: 'ACTIVE' | 'BLOCKED';
    cpf?: string;
    telefone?: string;
    catraca?: string;
    tenant?: CenarioDeDiaria;
  }): Promise<string> {
    const t = opcoes.tenant ?? c;
    const criado = await db.student.create({
      data: {
        tenantId: t.tenantId,
        gymUnitId: opcoes.unidadeId ?? t.unidadeId,
        membershipNumber: `F90-${randomUUID().slice(0, 8)}`,
        fullName: opcoes.nome,
        birthDate: new Date('1990-01-01T00:00:00Z'),
        status: opcoes.status ?? 'ACTIVE',
        profile: opcoes.profile ?? 'STUDENT',
        ...(opcoes.cpf ? { cpf: opcoes.cpf } : {}),
        ...(opcoes.telefone
          ? { contacts: { create: { tenantId: t.tenantId, type: 'PHONE', value: opcoes.telefone, isPrimary: true } } }
          : {}),
        ...(opcoes.catraca
          ? { credentials: { create: { tenantId: t.tenantId, kind: 'TURNSTILE_CARD', externalId: opcoes.catraca } } }
          : {}),
      },
      select: { id: true },
    });

    return criado.id;
  }

  async function assinatura(
    studentId: string,
    status: 'ACTIVE' | 'PAST_DUE' = 'ACTIVE',
    plano: string = planoId,
    tenant: CenarioDeDiaria = c,
  ): Promise<string> {
    const criada = await db.subscription.create({
      data: {
        tenantId: tenant.tenantId,
        studentId,
        planId: plano,
        status,
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });

    return criada.id;
  }

  async function fatura(
    studentId: string,
    subscriptionId: string,
    situacao: { status: 'PAID'; paidAt: Date } | { status: 'OPEN' | 'OVERDUE'; dueAt: Date },
    periodo: string,
  ): Promise<void> {
    await db.invoice.create({
      data: {
        tenantId: c.tenantId,
        subscriptionId,
        studentId,
        billingPeriod: new Date(`${periodo}T00:00:00Z`),
        number: numeroDaFatura++,
        status: situacao.status,
        currency: 'BRL',
        subtotalMinor: 12_000,
        totalMinor: 12_000,
        dueAt: 'dueAt' in situacao ? situacao.dueAt : new Date('2026-08-10T14:00:00Z'),
        ...('paidAt' in situacao ? { paidAt: situacao.paidAt } : {}),
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    repo = comContextoDeTenant(moduleRef.get(RelatorioDeAlunosRepository));
    inadimplencia = comContextoDeTenant(moduleRef.get(ConsultarInadimplenciaUseCase));
    pagos = comContextoDeTenant(moduleRef.get(ConsultarPagosUseCase));

    const senhas = moduleRef.get(PasswordService);
    c = await criarCenarioDeDiaria(db, senhas);
    outro = await criarCenarioDeDiaria(db, senhas);
    ctx = contextoDe(c);
    planoId = await criarPlano(db, c, { nome: 'Mensal Fit', billingMode: 'ASSINATURA' });
    planoOutroTenantId = await criarPlano(db, outro, { nome: 'Plano do Outro', billingMode: 'ASSINATURA' });

    const segunda = await db.gymUnit.create({
      data: { tenantId: c.tenantId, code: 'FIL', name: 'Filial', timezone: 'America/Sao_Paulo', openingHours: {} },
    });
    segundaUnidadeId = segunda.id;

    // A: pagante, plano, tudo preenchido -- Matriz
    const a = await aluno({ nome: 'Ana Pagante', cpf: '11144477735', telefone: '41999990000', catraca: '1042' });
    const subA = await assinatura(a);
    await fatura(a, subA, { status: 'PAID', paidAt: new Date('2026-09-05T12:00:00Z') }, '2026-09-01');

    // B: inadimplente (assinatura em atraso, fatura vencida em aberto) -- Matriz
    const b = await aluno({ nome: 'Bruno Devedor' });
    const subB = await assinatura(b, 'PAST_DUE');
    await fatura(b, subB, { status: 'OVERDUE', dueAt: new Date('2026-09-10T14:00:00Z') }, '2026-09-01');

    // C: bloqueado, sem plano, sem nada -- Filial
    await aluno({ nome: 'Carla Sem Nada', unidadeId: segundaUnidadeId, status: 'BLOCKED' });

    // D: professor com acesso por vínculo (sem assinatura) -- Matriz
    const d = await aluno({ nome: 'Davi Professor', profile: 'TRAINER' });
    await db.entitlement.create({
      data: {
        tenantId: c.tenantId,
        studentId: d,
        source: 'EMPLOYEE',
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2027-01-01T00:00:00Z'),
        policySnapshot: {},
      },
    });

    // E: aluno de OUTRO tenant -- nunca pode aparecer
    await aluno({ nome: 'Eva de Outro Tenant', tenant: outro });
    void (await assinatura(await aluno({ nome: 'Fabio de Outro', tenant: outro }), 'ACTIVE', planoOutroTenantId, outro));
  });

  afterAll(async () => {
    await apagarCenario(db, c);
    await apagarCenario(db, outro);
  });

  it('sem filtro: todos os perfis do tenant, por nome, e NUNCA de outro tenant', async () => {
    expect(await nomes(SEM_FILTRO)).toEqual([
      'Ana Pagante',
      'Bruno Devedor',
      'Carla Sem Nada',
      'Davi Professor',
    ]);
    expect(await repo.contar(ctx, SEM_FILTRO, AGORA)).toBe(4);
  });

  it('perfil filtra (vazio = todos)', async () => {
    expect(await nomes(com({ profile: 'TRAINER' }))).toEqual(['Davi Professor']);
    expect(await nomes(com({ profile: 'STUDENT' }))).toEqual([
      'Ana Pagante',
      'Bruno Devedor',
      'Carla Sem Nada',
    ]);
  });

  it('situação e unidade filtram', async () => {
    expect(await nomes(com({ status: 'BLOCKED' }))).toEqual(['Carla Sem Nada']);
    expect(await nomes(com({ gymUnitId: segundaUnidadeId }))).toEqual(['Carla Sem Nada']);
  });

  it('plano filtra pela assinatura vigente (ACTIVE ou PAST_DUE)', async () => {
    expect(await nomes(com({ planId: planoId }))).toEqual(['Ana Pagante', 'Bruno Devedor']);
  });

  it('plano de OUTRO tenant não vaza: zero linhas, não erro', async () => {
    expect(await nomes(com({ planId: planoOutroTenantId }))).toEqual([]);
    expect(await repo.contar(ctx, com({ planId: planoOutroTenantId }), AGORA)).toBe(0);
  });

  it('financeiro=INADIMPLENTES traz só quem tem fatura vencida em aberto', async () => {
    expect(await nomes(com({ financeiro: 'INADIMPLENTES' }))).toEqual(['Bruno Devedor']);
  });

  it('financeiro=PAGANTES traz só quem tem fatura paga', async () => {
    expect(await nomes(com({ financeiro: 'PAGANTES' }))).toEqual(['Ana Pagante']);
  });

  it('filtros combinam (E lógico)', async () => {
    expect(await nomes(com({ planId: planoId, financeiro: 'INADIMPLENTES', status: 'ACTIVE' }))).toEqual([
      'Bruno Devedor',
    ]);
    expect(await nomes(com({ planId: planoId, status: 'BLOCKED' }))).toEqual([]);
  });

  it('PARIDADE com a Cobrança: mesmo número de inadimplentes e de pagantes que as duas telas', async () => {
    const painel = await inadimplencia.executar(ctx, AGORA);
    const abaPagantes = await pagos.executar(ctx);

    expect(await repo.contar(ctx, com({ financeiro: 'INADIMPLENTES' }), AGORA)).toBe(
      painel.resumo.alunosInadimplentes,
    );
    expect(await repo.contar(ctx, com({ financeiro: 'PAGANTES' }), AGORA)).toBe(abaPagantes.total);
  });

  it('linha completa: catraca, CPF, telefone e nome do plano', async () => {
    const [ana] = await repo.listar(ctx, com({ financeiro: 'PAGANTES' }), AGORA, { limite: 10 });

    expect(ana).toMatchObject({
      fullName: 'Ana Pagante',
      deviceIds: ['1042'],
      cpf: '11144477735',
      phone: '41999990000',
      planLabel: 'Mensal Fit',
    });
  });

  it('aluno sem nada: vazio e null, sem inventar valor', async () => {
    const [carla] = await repo.listar(ctx, com({ status: 'BLOCKED' }), AGORA, { limite: 10 });

    expect(carla).toMatchObject({
      deviceIds: [],
      cpf: null,
      phone: null,
      planLabel: null,
    });
  });

  it('acesso por vínculo mostra a ORIGEM no lugar do plano', async () => {
    const [davi] = await repo.listar(ctx, com({ profile: 'TRAINER' }), AGORA, { limite: 10 });

    expect(davi?.planLabel).toBe('Funcionário');
  });

  it('cursor pagina sem repetir nem pular, e cursor inexistente não derruba', async () => {
    const primeira = await repo.listar(ctx, SEM_FILTRO, AGORA, { limite: 2 });
    const segunda = await repo.listar(ctx, SEM_FILTRO, AGORA, {
      limite: 2,
      cursor: primeira[1]?.studentId,
    });

    expect(primeira.map((l) => l.fullName)).toEqual(['Ana Pagante', 'Bruno Devedor']);
    expect(segunda.map((l) => l.fullName)).toEqual(['Carla Sem Nada', 'Davi Professor']);
    await expect(
      repo.listar(ctx, SEM_FILTRO, AGORA, { limite: 2, cursor: randomUUID() }),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `eval "$INT reports-alunos.int-spec"`
Expected: FAIL — `Cannot find module '.../relatorio-de-alunos.repository.js'`.

- [ ] **Step 3: Implementar o repositório**

`relatorio-de-alunos.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { FATURA_PAGA, faturaVencidaEmAberto } from '../billing/domain/criterios-financeiros.js';
import type {
  FiltroDoRelatorioDeAlunos,
  LinhaDoRelatorioDeAlunos,
} from './domain/filtro-do-relatorio-de-alunos.js';
import { rotuloDoPlano } from './domain/formato-brasileiro.js';

/**
 * O `where` do relatório. UM só, usado por `contar` e `listar`: o total do
 * cabeçalho e as linhas da tela/arquivo respondem à mesma pergunta por
 * construção -- o mesmo motivo de `condicoesDaListagem` na Lista de Alunos.
 *
 * PERFIL VAZIO = TODOS. A Lista de Alunos fixa `profile = STUDENT`; aqui o
 * relatório tem filtro de perfil, e fixar um padrão esconderia professor e
 * funcionário de quem não mexeu no filtro.
 *
 * PLANO = o da assinatura VIGENTE (`ACTIVE`/`PAST_DUE`), o mesmo que a coluna
 * Plano mostra. Acesso por vínculo (cortesia etc.) não tem `planId`.
 */
export function ondeDoRelatorio(
  tenantId: string,
  filtro: FiltroDoRelatorioDeAlunos,
  agora: Date,
): Prisma.StudentWhereInput {
  return {
    tenantId,
    ...(filtro.profile ? { profile: filtro.profile } : {}),
    ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
    ...(filtro.status ? { status: filtro.status } : {}),
    ...(filtro.planId
      ? { subscriptions: { some: { planId: filtro.planId, status: { in: ['ACTIVE', 'PAST_DUE'] } } } }
      : {}),
    ...(filtro.financeiro === 'INADIMPLENTES'
      ? { invoices: { some: faturaVencidaEmAberto(agora) } }
      : {}),
    ...(filtro.financeiro === 'PAGANTES' ? { invoices: { some: FATURA_PAGA } } : {}),
  };
}

/**
 * O que a linha precisa -- e nada além. Mesmos critérios de "assinatura
 * vigente", "telefone principal" e "vínculo vigente" de `includeDaListagem`
 * (`students/student.repository.ts`), de propósito: a coluna Plano e a coluna
 * Contato do relatório têm de dizer o que a Lista de Alunos diz. O teste de
 * integração fixa os três casos (assinatura, vínculo, nada).
 */
function selecao(agora: Date) {
  return {
    id: true,
    fullName: true,
    cpf: true,
    credentials: { orderBy: { createdAt: 'asc' }, select: { externalId: true } },
    contacts: {
      where: { type: 'PHONE' },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      take: 1,
      select: { value: true },
    },
    subscriptions: {
      where: { status: { in: ['ACTIVE', 'PAST_DUE'] } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: { plan: { select: { name: true } } },
    },
    entitlements: {
      where: { subscriptionId: null, status: 'ACTIVE', startsAt: { lte: agora }, endsAt: { gte: agora } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 1,
      select: { source: true },
    },
  } satisfies Prisma.StudentSelect;
}

type AlunoLido = Prisma.StudentGetPayload<{ select: ReturnType<typeof selecao> }>;

function paraLinha(aluno: AlunoLido): LinhaDoRelatorioDeAlunos {
  return {
    studentId: aluno.id,
    deviceIds: [...new Set(aluno.credentials.map((c) => c.externalId))],
    fullName: aluno.fullName,
    cpf: aluno.cpf,
    phone: aluno.contacts[0]?.value ?? null,
    planLabel: rotuloDoPlano(
      aluno.subscriptions[0]?.plan.name ?? null,
      aluno.entitlements[0]?.source ?? null,
    ),
  };
}

@Injectable()
export class RelatorioDeAlunosRepository {
  constructor(private readonly db: PrismaService) {}

  async contar(contexto: TenantContext, filtro: FiltroDoRelatorioDeAlunos, agora: Date): Promise<number> {
    return this.db.comTenant((tx) =>
      tx.student.count({ where: ondeDoRelatorio(contexto.tenantId, filtro, agora) }),
    );
  }

  /**
   * Ordem por nome com `id` de desempate: sem chave estável, dois alunos com o
   * mesmo nome trocam de lugar entre páginas e o cursor repete ou pula gente.
   */
  async listar(
    contexto: TenantContext,
    filtro: FiltroDoRelatorioDeAlunos,
    agora: Date,
    janela: { limite: number; cursor?: string | undefined },
  ): Promise<LinhaDoRelatorioDeAlunos[]> {
    const alunos = await this.db.comTenant((tx) =>
      tx.student.findMany({
        where: ondeDoRelatorio(contexto.tenantId, filtro, agora),
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        take: janela.limite,
        ...(janela.cursor ? { cursor: { id: janela.cursor }, skip: 1 } : {}),
        select: selecao(agora),
      }),
    );

    return alunos.map(paraLinha);
  }
}
```

- [ ] **Step 4: O repositório precisa estar num módulo para o `Test` resolvê-lo**

O teste usa `moduleRef.get(RelatorioDeAlunosRepository)` sobre o `AppModule`. Criar já o esqueleto do módulo e registrá-lo (será completado na Task 6):

`apps/api/src/modules/reports/reports.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';

/** Relatórios -- F90. */
@Module({
  providers: [RelatorioDeAlunosRepository],
  exports: [RelatorioDeAlunosRepository],
})
export class ReportsModule {}
```

Em `apps/api/src/app.module.ts`, junto do `import { ExportsModule } ...` (linha ~22):
`import { ReportsModule } from './modules/reports/reports.module.js';`
e, na lista `imports` (junto de `ExportsModule,`, linha ~99): `ReportsModule,`.

Nota: `moduleRef.get(Classe)` no Nest exige `{ strict: false }` quando o provider está num módulo filho. Se o teste falhar com `Nest could not find RelatorioDeAlunosRepository`, trocar as três chamadas `moduleRef.get(X)` do `beforeAll` por `moduleRef.get(X, { strict: false })` (os outros int-specs do repo, p.ex. `billing-pagos`, já resolvem providers de módulos filhos assim).

- [ ] **Step 5: Rodar e ver passar**

Run: `eval "$INT reports-alunos.int-spec"`
Expected: PASS (12 testes). Se "PARIDADE" falhar, **o relatório e a Cobrança divergem — pare e investigue**, não ajuste o teste.

- [ ] **Step 6: Canário — o teste de paridade tem dente?**

Plantar a quebra e provar que algo cai: em `criterios-financeiros.ts`, trocar `lt: agora` por `lte: agora`... não derruba (mesma massa). Plantar então no **repositório** `financeiro === 'INADIMPLENTES'` → `FATURA_PAGA`. Run: `eval "$INT reports-alunos.int-spec"`
Expected: FAIL em "INADIMPLENTES" **e** em "PARIDADE". Reverter a quebra e rodar de novo: PASS.

- [ ] **Step 7: Teste do caso de uso (unit, com repositório falso) — teto e página (falha)**

`consultar-relatorio-de-alunos.use-case.spec.ts`:

```ts
import { describe, expect, it, jest } from '@jest/globals';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  ConsultarRelatorioDeAlunosUseCase,
  LIMITE_MAXIMO_DA_PAGINA,
  TETO_DE_LINHAS_DA_EXPORTACAO,
} from './consultar-relatorio-de-alunos.use-case.js';
import { lerFiltro, type LinhaDoRelatorioDeAlunos } from './domain/filtro-do-relatorio-de-alunos.js';
import type { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';

const CTX = { tenantId: 't' } as TenantContext;
const AGORA = new Date('2026-10-10T15:00:00.000Z');
const FILTRO = lerFiltro({});

const linha = (n: number): LinhaDoRelatorioDeAlunos => ({
  studentId: `id-${n}`,
  deviceIds: [],
  fullName: `Aluno ${n}`,
  cpf: null,
  phone: null,
  planLabel: null,
});

function repoFalso(total: number, linhas: LinhaDoRelatorioDeAlunos[] = []) {
  const contar = jest.fn(async () => total);
  const listar = jest.fn(async (..._args: unknown[]) => linhas);

  return { repo: { contar, listar } as unknown as RelatorioDeAlunosRepository, contar, listar };
}

describe('ConsultarRelatorioDeAlunosUseCase.todos', () => {
  it('acima do teto: 422 REPORT_TOO_LARGE e NENHUMA linha é lida', async () => {
    const { repo, listar } = repoFalso(TETO_DE_LINHAS_DA_EXPORTACAO + 1);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    const erro = await caso.todos(CTX, FILTRO, AGORA).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect(erro).toMatchObject({ code: 'REPORT_TOO_LARGE', status: 422 });
    expect(listar).not.toHaveBeenCalled();
  });

  it('exatamente no teto passa', async () => {
    const { repo } = repoFalso(TETO_DE_LINHAS_DA_EXPORTACAO, [linha(1)]);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    await expect(caso.todos(CTX, FILTRO, AGORA)).resolves.toMatchObject({
      total: TETO_DE_LINHAS_DA_EXPORTACAO,
    });
  });

  it('base vazia: devolve vazio sem consultar linhas', async () => {
    const { repo, listar } = repoFalso(0);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    await expect(caso.todos(CTX, FILTRO, AGORA)).resolves.toEqual({ total: 0, linhas: [] });
    expect(listar).not.toHaveBeenCalled();
  });
});

describe('ConsultarRelatorioDeAlunosUseCase.pagina', () => {
  it('lê limite+1 para saber se há próxima e devolve só `limite` linhas', async () => {
    const tres = [linha(1), linha(2), linha(3)];
    const { repo, listar } = repoFalso(10, tres);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    const pagina = await caso.pagina(CTX, FILTRO, { limite: 2 }, AGORA);

    expect(listar).toHaveBeenCalledWith(CTX, FILTRO, AGORA, { limite: 3, cursor: undefined });
    expect(pagina.linhas.map((l) => l.studentId)).toEqual(['id-1', 'id-2']);
    expect(pagina.proximoCursor).toBe('id-2');
    expect(pagina.total).toBe(10);
  });

  it('última página: sem próximo cursor', async () => {
    const { repo } = repoFalso(2, [linha(1), linha(2)]);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    const pagina = await caso.pagina(CTX, FILTRO, { limite: 2 }, AGORA);

    expect(pagina.proximoCursor).toBeNull();
  });

  it('limite é travado em [1, 100]', async () => {
    const { repo, listar } = repoFalso(0);
    const caso = new ConsultarRelatorioDeAlunosUseCase(repo);

    await caso.pagina(CTX, FILTRO, { limite: 100_000 }, AGORA);
    await caso.pagina(CTX, FILTRO, { limite: -5 }, AGORA);

    expect(listar).toHaveBeenNthCalledWith(1, CTX, FILTRO, AGORA, {
      limite: LIMITE_MAXIMO_DA_PAGINA + 1,
      cursor: undefined,
    });
    expect(listar).toHaveBeenNthCalledWith(2, CTX, FILTRO, AGORA, { limite: 2, cursor: undefined });
  });
});
```

- [ ] **Step 8: Rodar e ver falhar**

Run: `eval "$UNIT consultar-relatorio-de-alunos"`
Expected: FAIL — módulo não existe.

- [ ] **Step 9: Implementar o caso de uso**

`consultar-relatorio-de-alunos.use-case.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type {
  FiltroDoRelatorioDeAlunos,
  LinhaDoRelatorioDeAlunos,
} from './domain/filtro-do-relatorio-de-alunos.js';
import { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';

/**
 * Teto de linhas de UMA exportação. Existe porque o arquivo é montado em
 * memória: sem teto, uma base grande vira o processo da API sem memória num
 * download. 20.000 é ~10x a maior academia atendida hoje (~2.000 alunos).
 *
 * GATILHO DE REVISÃO: se alguém bater nesse erro com filtro razoável, o
 * caminho é exportação assíncrona por job (como `access-events/exports`), não
 * subir o número.
 */
export const TETO_DE_LINHAS_DA_EXPORTACAO = 20_000;

/** Máximo de uma página da TELA. Mesmo teto de `GET /students`. */
export const LIMITE_MAXIMO_DA_PAGINA = 100;

export interface PaginaDoRelatorio {
  readonly total: number;
  readonly linhas: readonly LinhaDoRelatorioDeAlunos[];
  /** `studentId` da última linha, ou `null` quando não há próxima página. */
  readonly proximoCursor: string | null;
}

/**
 * A consulta do Relatório de Alunos -- UMA, para a tela e para a exportação.
 *
 * O arquivo que a pessoa baixa é, por construção, o que ela viu na tela: as
 * duas rotas chamam o mesmo repositório com o mesmo filtro, e só a janela
 * (página x tudo) muda.
 */
@Injectable()
export class ConsultarRelatorioDeAlunosUseCase {
  constructor(private readonly repositorio: RelatorioDeAlunosRepository) {}

  async pagina(
    contexto: TenantContext,
    filtro: FiltroDoRelatorioDeAlunos,
    janela: { limite: number; cursor?: string | undefined },
    agora: Date,
  ): Promise<PaginaDoRelatorio> {
    const limite = Math.min(Math.max(janela.limite, 1), LIMITE_MAXIMO_DA_PAGINA);

    const [total, lidas] = await Promise.all([
      this.repositorio.contar(contexto, filtro, agora),
      // limite+1: a linha a mais só diz que HÁ próxima página; não é devolvida.
      this.repositorio.listar(contexto, filtro, agora, { limite: limite + 1, cursor: janela.cursor }),
    ]);

    const linhas = lidas.slice(0, limite);
    const ultima = linhas[linhas.length - 1];

    return {
      total,
      linhas,
      proximoCursor: lidas.length > limite && ultima ? ultima.studentId : null,
    };
  }

  async todos(
    contexto: TenantContext,
    filtro: FiltroDoRelatorioDeAlunos,
    agora: Date,
  ): Promise<{ total: number; linhas: readonly LinhaDoRelatorioDeAlunos[] }> {
    const total = await this.repositorio.contar(contexto, filtro, agora);

    if (total > TETO_DE_LINHAS_DA_EXPORTACAO) {
      throw new ErroDeDominio(
        'REPORT_TOO_LARGE',
        422,
        `O relatório tem ${total} alunos e o limite de exportação é ${TETO_DE_LINHAS_DA_EXPORTACAO}. Refine os filtros.`,
      );
    }

    if (total === 0) return { total: 0, linhas: [] };

    const linhas = await this.repositorio.listar(contexto, filtro, agora, { limite: total });

    return { total, linhas };
  }
}
```

- [ ] **Step 10: Rodar e ver passar**

Run: `eval "$UNIT consultar-relatorio-de-alunos"`
Expected: PASS (6 testes).

- [ ] **Step 11: Registrar o caso de uso no módulo**

Em `reports.module.ts` acrescentar `ConsultarRelatorioDeAlunosUseCase` (import + `providers` + `exports`).

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/modules/reports apps/api/src/app.module.ts apps/api/test/integration/reports-alunos.int-spec.ts
git commit -m "feat: consulta do relatório de alunos (filtros, paginação, teto de exportação) (refs #<N>)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cabeçalho da academia e PDF

**Files:**
- Create: `apps/api/src/modules/reports/cabecalho-da-academia.service.ts`
- Create: `apps/api/src/modules/reports/domain/pdf-do-relatorio.ts`
- Create: `apps/api/src/modules/reports/domain/pdf-do-relatorio.spec.ts`
- Create: `apps/api/test/integration/reports-cabecalho.int-spec.ts`

**Interfaces:**
- Consumes: `CabecalhoDaAcademia`, `DadosDoRelatorioImpresso` (Task 3); `OBJECT_STORAGE`/`ObjectStoragePort.getPrivateObject`; `chaveDeIdentidadePertenceA(chave, tenantId)` de `../platform/domain/identidade-visual.js`; `NomesDoFiltro`, `FiltroDoRelatorioDeAlunos` (Task 2).
- Produces:
  - `gerarPdfDoRelatorio(dados: DadosDoRelatorioImpresso): Promise<Buffer>`
  - `CabecalhoDaAcademiaService.carregar(contexto: TenantContext, gymUnitId: string | undefined): Promise<CabecalhoDaAcademia>`
  - `CabecalhoDaAcademiaService.nomesDoFiltro(contexto: TenantContext, filtro: FiltroDoRelatorioDeAlunos): Promise<NomesDoFiltro>`

- [ ] **Step 1: Teste do PDF (falha)**

`pdf-do-relatorio.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';
import { gerarPdfDoRelatorio } from './pdf-do-relatorio.js';

/** PNG 1x1 válido (67 bytes). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const academia = {
  nome: 'Arena Positiva',
  razaoSocial: 'Complexo Arena Positiva LTDA',
  cnpj: '12345678000195',
  endereco: 'Rua A, 10, Curitiba - PR',
  telefone: '4133334444',
  fuso: 'America/Sao_Paulo',
  logo: null,
} as const;

function dados(n: number, extra: Partial<DadosDoRelatorioImpresso> = {}): DadosDoRelatorioImpresso {
  return {
    academia,
    filtros: ['Situação: Ativo'],
    geradoEm: new Date('2026-10-10T17:32:00.000Z'),
    total: n,
    linhas: Array.from({ length: n }, (_, i) => ({
      studentId: `id-${i}`,
      deviceIds: i % 3 === 0 ? [String(1000 + i)] : [],
      fullName: `Aluno de Teste Número ${i} com um nome bem comprido para forçar a reticência`,
      cpf: i % 2 === 0 ? '11144477735' : null,
      phone: i % 2 === 0 ? '41999990000' : null,
      planLabel: i % 5 === 0 ? null : 'Mensal Fit',
    })),
    ...extra,
  };
}

const paginas = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

describe('gerarPdfDoRelatorio', () => {
  it('gera um PDF válido', async () => {
    const pdf = await gerarPdfDoRelatorio(dados(3));

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('lista vazia gera uma página só (cabeçalho + títulos)', async () => {
    expect(paginas(await gerarPdfDoRelatorio(dados(0)))).toBe(1);
  });

  it('muita linha pagina: 300 alunos ocupam mais de uma página, 5 cabem em uma', async () => {
    expect(paginas(await gerarPdfDoRelatorio(dados(5)))).toBe(1);
    expect(paginas(await gerarPdfDoRelatorio(dados(300)))).toBeGreaterThan(1);
  });

  it('logo PNG entra; o PDF com logo é maior que o sem logo', async () => {
    const sem = await gerarPdfDoRelatorio(dados(3));
    const com = await gerarPdfDoRelatorio(
      dados(3, { academia: { ...academia, logo: { body: PNG_1X1, contentType: 'image/png' } } }),
    );

    expect(com.length).toBeGreaterThan(sem.length);
  });

  it('logo SVG, PNG corrompido ou tipo estranho NÃO derrubam: cai no cabeçalho de texto', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const lixo = Buffer.from('isto nao e um png');

    for (const logo of [
      { body: svg, contentType: 'image/svg+xml' },
      { body: lixo, contentType: 'image/png' },
      { body: lixo, contentType: 'application/zip' },
    ]) {
      const pdf = await gerarPdfDoRelatorio(dados(3, { academia: { ...academia, logo } }));

      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });

  it('academia sem CNPJ, endereço e telefone gera normalmente', async () => {
    const pdf = await gerarPdfDoRelatorio(
      dados(3, { academia: { ...academia, cnpj: null, endereco: null, telefone: null } }),
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('volume do teto (20.000) termina em tempo razoável e com memória estável', async () => {
    const inicio = Date.now();
    const pdf = await gerarPdfDoRelatorio(dados(20_000));

    expect(Date.now() - inicio).toBeLessThan(30_000);
    expect(paginas(pdf)).toBeGreaterThan(500);
  }, 60_000);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `eval "$UNIT pdf-do-relatorio"`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o PDF**

`pdf-do-relatorio.ts`:

```ts
import PDFDocument from 'pdfkit';

import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';
import type { LinhaDoRelatorioDeAlunos } from './filtro-do-relatorio-de-alunos.js';
import {
  formatarCnpj,
  formatarCpf,
  formatarDataHora,
  formatarTelefone,
} from './formato-brasileiro.js';

type Documento = InstanceType<typeof PDFDocument>;

const MARGEM = 40;
const LARGURA_UTIL = 515; // A4 (595,28) - 2 * MARGEM
const ALTURA_DA_LINHA = 18;
const RESERVA_DO_RODAPE = 36;
const LADO_DO_LOGO = 56;

/** A soma das larguras é `LARGURA_UTIL`. */
const COLUNAS = [
  { titulo: 'Catraca', largura: 62 },
  { titulo: 'Nome', largura: 168 },
  { titulo: 'CPF', largura: 90 },
  { titulo: 'Contato', largura: 95 },
  { titulo: 'Plano', largura: 100 },
] as const;

/**
 * Tipos que o `pdfkit` embute. SVG é aceito no upload da identidade visual
 * (F62), mas `pdfkit` não o renderiza -- o relatório sai com cabeçalho só de
 * texto. ponytail: SVG fica sem logo no PDF; subir `svg-to-pdfkit` só se o PI
 * pedir (é dependência nova para um cabeçalho).
 */
const IMAGENS_ACEITAS = new Set(['image/png', 'image/jpeg']);

/**
 * PDF do Relatório de Alunos.
 *
 * `pdfkit` (já usado no contrato da plataforma), tabela desenhada à mão com
 * posição explícita: toda linha tem altura fixa e o texto é cortado com
 * reticências, então a conta de "quantas linhas cabem na página" é exata e o
 * `pdfkit` nunca quebra página por conta própria no meio de uma linha.
 *
 * Fonte Helvetica (WinAnsi): acentos do português funcionam; caractere fora
 * do Latin-1 (p.ex. "ł") sai errado. Aceito -- nomes de academia brasileira.
 */
export function gerarPdfDoRelatorio(dados: DadosDoRelatorioImpresso): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const documento = new PDFDocument({
      size: 'A4',
      margin: MARGEM,
      bufferPages: true,
      info: { Title: 'Relatório de Alunos', Author: dados.academia.nome },
    });
    const pedacos: Buffer[] = [];

    documento.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
    documento.on('end', () => resolver(Buffer.concat(pedacos)));
    documento.on('error', rejeitar);

    try {
      let y = desenharCabecalho(documento, dados);
      y = desenharTitulosDaTabela(documento, y);

      dados.linhas.forEach((aluno, indice) => {
        if (y + ALTURA_DA_LINHA > documento.page.height - MARGEM - RESERVA_DO_RODAPE) {
          documento.addPage();
          y = desenharTitulosDaTabela(documento, MARGEM);
        }

        desenharLinha(documento, aluno, y, indice % 2 === 1);
        y += ALTURA_DA_LINHA;
      });

      desenharRodapes(documento);
      documento.end();
    } catch (erro) {
      rejeitar(erro);
    }
  });
}

/** Devolve o `y` onde a tabela começa. */
function desenharCabecalho(doc: Documento, dados: DadosDoRelatorioImpresso): number {
  const { academia } = dados;
  let xDoTexto = MARGEM;
  let logoDesenhado = false;

  if (academia.logo && IMAGENS_ACEITAS.has(academia.logo.contentType)) {
    try {
      doc.image(academia.logo.body, MARGEM, MARGEM, { fit: [LADO_DO_LOGO, LADO_DO_LOGO] });
      xDoTexto = MARGEM + LADO_DO_LOGO + 12;
      logoDesenhado = true;
    } catch {
      // Imagem corrompida: o relatório vale mais que o logo. Segue só com texto.
    }
  }

  const largura = LARGURA_UTIL - (xDoTexto - MARGEM);

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111');
  doc.text(academia.nome, xDoTexto, MARGEM, { width: largura });

  const detalhes = [
    academia.razaoSocial !== academia.nome ? academia.razaoSocial : null,
    academia.cnpj === null ? null : `CNPJ ${formatarCnpj(academia.cnpj)}`,
    academia.endereco,
    academia.telefone === null ? null : `Tel. ${formatarTelefone(academia.telefone)}`,
  ].filter((linha): linha is string => linha !== null && linha !== '');

  doc.font('Helvetica').fontSize(9).fillColor('#555555');
  for (const linha of detalhes) doc.text(linha, xDoTexto, doc.y, { width: largura });

  let y = Math.max(doc.y, logoDesenhado ? MARGEM + LADO_DO_LOGO : 0) + 14;

  doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA_UTIL, y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  y += 12;

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111');
  doc.text('Relatório de Alunos', MARGEM, y, { width: LARGURA_UTIL });

  doc.font('Helvetica').fontSize(9).fillColor('#555555');
  doc.text(
    `Gerado em ${formatarDataHora(dados.geradoEm, academia.fuso)} · ${dados.total} aluno(s)`,
    MARGEM,
    doc.y + 4,
    { width: LARGURA_UTIL },
  );
  doc.text(
    `Filtros: ${dados.filtros.length > 0 ? dados.filtros.join(' · ') : 'nenhum'}`,
    MARGEM,
    doc.y + 2,
    { width: LARGURA_UTIL },
  );

  return doc.y + 12;
}

function desenharTitulosDaTabela(doc: Documento, y: number): number {
  doc.rect(MARGEM, y, LARGURA_UTIL, ALTURA_DA_LINHA).fill('#eeeeee');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');

  let x = MARGEM;
  for (const coluna of COLUNAS) {
    doc.text(coluna.titulo, x + 4, y + 5, { width: coluna.largura - 8, height: 11, ellipsis: true });
    x += coluna.largura;
  }

  return y + ALTURA_DA_LINHA;
}

function desenharLinha(doc: Documento, aluno: LinhaDoRelatorioDeAlunos, y: number, zebra: boolean): void {
  if (zebra) doc.rect(MARGEM, y, LARGURA_UTIL, ALTURA_DA_LINHA).fill('#f7f7f7');

  const celulas = [
    aluno.deviceIds.join(', '),
    aluno.fullName,
    formatarCpf(aluno.cpf),
    formatarTelefone(aluno.phone),
    aluno.planLabel ?? '',
  ];

  doc.font('Helvetica').fontSize(9).fillColor('#111111');

  let x = MARGEM;
  COLUNAS.forEach((coluna, i) => {
    doc.text(celulas[i] ?? '', x + 4, y + 5, { width: coluna.largura - 8, height: 11, ellipsis: true });
    x += coluna.largura;
  });
}

/** "Página X de Y" -- só dá para saber o Y no fim, por isso `bufferPages`. */
function desenharRodapes(doc: Documento): void {
  const { start, count } = doc.bufferedPageRange();

  for (let i = 0; i < count; i += 1) {
    doc.switchToPage(start + i);
    // Sem zerar a margem inferior, escrever no rodapé faz o pdfkit abrir uma página nova.
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#777777');
    doc.text(`Página ${i + 1} de ${count}`, MARGEM, doc.page.height - 30, {
      width: LARGURA_UTIL,
      align: 'center',
    });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `eval "$UNIT pdf-do-relatorio"`
Expected: PASS (7 testes). Se o teste de 20.000 passar do tempo, **medir** (`console` no teste local, sem commitar) antes de mexer no teto.

- [ ] **Step 5: Olhar o PDF de verdade**

Gerar uma amostra com 60 alunos (script descartável no scratchpad, não no repo) e abrir com a ferramenta `Read` (`pages: "1-2"`) para conferir: logo/cabeçalho, linha divisória, títulos repetidos na página 2, zebra, reticências nos nomes longos, rodapé "Página 1 de 2". Ajustar `MARGEM`, larguras ou alturas só se algo estiver cortado ou sobreposto.

- [ ] **Step 6: Teste de integração do cabeçalho (falha)**

`reports-cabecalho.int-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE, type ObjectStoragePort } from '../../src/common/storage/object-storage.port.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { montarChaveDeIdentidade } from '../../src/modules/platform/domain/identidade-visual.js';
import { CabecalhoDaAcademiaService } from '../../src/modules/reports/cabecalho-da-academia.service.js';
import { lerFiltro } from '../../src/modules/reports/domain/filtro-do-relatorio-de-alunos.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  apagarCenario,
  contextoDe,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

describe('F90 -- cabeçalho da academia no relatório', () => {
  let db: PrismaService;
  let servico: CabecalhoDaAcademiaService;
  let storage: ObjectStoragePort;
  let c: CenarioDeDiaria;
  let ctx: TenantContext;

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    servico = comContextoDeTenant(moduleRef.get(CabecalhoDaAcademiaService, { strict: false }));
    storage = moduleRef.get<ObjectStoragePort>(OBJECT_STORAGE, { strict: false });

    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));
    ctx = contextoDe(c);
  });

  afterAll(async () => {
    await apagarCenario(db, c);
  });

  async function definirTenant(dados: Record<string, unknown>): Promise<void> {
    await db.tenant.update({ where: { id: c.tenantId }, data: dados });
  }

  it('traz nome, razão social, CNPJ, endereço e telefone do cadastro', async () => {
    await definirTenant({
      cnpj: '12345678000195',
      addressLine: 'Rua A, 10',
      addressCity: 'Curitiba',
      addressState: 'PR',
      addressZip: '80000000',
      phone: '4133334444',
    });

    const cabecalho = await servico.carregar(ctx, undefined);

    expect(cabecalho).toMatchObject({
      nome: `Diaria ${c.sufixo}`,
      razaoSocial: `Diaria ${c.sufixo} LTDA`,
      cnpj: '12345678000195',
      endereco: 'Rua A, 10, Curitiba - PR, CEP 80000000',
      telefone: '4133334444',
      logo: null,
    });
  });

  it('sem fuso no tenant usa o fuso da primeira unidade; com unidade escolhida usa o dela', async () => {
    await definirTenant({ timezone: null });
    expect((await servico.carregar(ctx, undefined)).fuso).toBe('America/Sao_Paulo');

    const manaus = await db.gymUnit.create({
      data: { tenantId: c.tenantId, code: 'MAO', name: 'Manaus', timezone: 'America/Manaus', openingHours: {} },
    });

    expect((await servico.carregar(ctx, manaus.id)).fuso).toBe('America/Manaus');
  });

  it('tenant sem endereço/CNPJ/telefone devolve null, não texto vazio inventado', async () => {
    await definirTenant({ cnpj: null, addressLine: null, addressCity: null, addressState: null, addressZip: null, phone: null });

    const cabecalho = await servico.carregar(ctx, undefined);

    expect(cabecalho).toMatchObject({ cnpj: null, endereco: null, telefone: null });
  });

  it('lê o logo do storage quando a chave é do próprio tenant', async () => {
    const chave = montarChaveDeIdentidade(c.tenantId, 'logo', 'png');
    await storage.putPrivateObject({ key: chave, body: PNG, contentType: 'image/png' });
    await definirTenant({ logoObjectKey: chave });

    const cabecalho = await servico.carregar(ctx, undefined);

    expect(cabecalho.logo?.contentType).toBe('image/png');
    expect(cabecalho.logo?.body.length).toBe(PNG.length);
  });

  it('chave de OUTRO tenant no campo do logo é ignorada (nunca serve o arquivo alheio)', async () => {
    await definirTenant({ logoObjectKey: montarChaveDeIdentidade(randomUUID(), 'logo', 'png') });

    expect((await servico.carregar(ctx, undefined)).logo).toBeNull();
  });

  it('objeto sumido do bucket vira cabeçalho sem logo, não erro', async () => {
    await definirTenant({ logoObjectKey: montarChaveDeIdentidade(c.tenantId, 'logo', 'png').replace('logo', 'logo-que-sumiu') });

    await expect(servico.carregar(ctx, undefined)).resolves.toMatchObject({ logo: null });
  });

  it('nomesDoFiltro resolve unidade e plano do PRÓPRIO tenant e ignora ids alheios', async () => {
    const planoId = await criarPlano(db, c, { nome: 'Mensal Fit', billingMode: 'ASSINATURA' });
    const filtro = lerFiltro({ gymUnitId: c.unidadeId, planId: planoId });

    expect(await servico.nomesDoFiltro(ctx, filtro)).toEqual({ unidade: 'Matriz', plano: 'Mensal Fit' });
    expect(
      await servico.nomesDoFiltro(ctx, lerFiltro({ gymUnitId: randomUUID(), planId: randomUUID() })),
    ).toEqual({ unidade: undefined, plano: undefined });
  });
});
```

> Verificar a assinatura real de `montarChaveDeIdentidade` em `platform/domain/identidade-visual.ts` antes de rodar (ela monta a chave `tenants/{id}/...`); se os parâmetros forem outros, ajustar as três chamadas do teste — a **intenção** é: uma chave que passa em `chaveDeIdentidadePertenceA(chave, tenantId)` e outra que não passa.

- [ ] **Step 7: Rodar e ver falhar**

Run: `eval "$INT reports-cabecalho"`
Expected: FAIL — `CabecalhoDaAcademiaService` não existe.

- [ ] **Step 8: Implementar o serviço**

`cabecalho-da-academia.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';

import { OBJECT_STORAGE, type ObjectStoragePort } from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { chaveDeIdentidadePertenceA } from '../platform/domain/identidade-visual.js';
import type { CabecalhoDaAcademia } from './domain/dados-do-relatorio.js';
import type { FiltroDoRelatorioDeAlunos, NomesDoFiltro } from './domain/filtro-do-relatorio-de-alunos.js';

/**
 * Quem emite o relatório: dados cadastrais e logo da academia, mais os NOMES
 * (não os ids) que o cabeçalho mostra nos filtros.
 */
@Injectable()
export class CabecalhoDaAcademiaService {
  constructor(
    private readonly db: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /**
   * `gymUnitId` escolhido no filtro define o fuso; sem ele vale o fuso do
   * tenant e, na falta, o da primeira unidade. A hora impressa é a da
   * academia, não a do servidor.
   */
  async carregar(contexto: TenantContext, gymUnitId: string | undefined): Promise<CabecalhoDaAcademia> {
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: contexto.tenantId },
      select: {
        displayName: true,
        legalName: true,
        cnpj: true,
        timezone: true,
        phone: true,
        addressLine: true,
        addressCity: true,
        addressState: true,
        addressZip: true,
        logoObjectKey: true,
      },
    });

    const unidade = await this.db.comTenant((tx) =>
      tx.gymUnit.findFirst({
        where: { tenantId: contexto.tenantId, ...(gymUnitId ? { id: gymUnitId } : {}) },
        orderBy: { code: 'asc' },
        select: { timezone: true },
      }),
    );

    return {
      nome: tenant.displayName,
      razaoSocial: tenant.legalName,
      cnpj: tenant.cnpj,
      endereco: montarEndereco(tenant),
      telefone: tenant.phone,
      fuso: (gymUnitId ? unidade?.timezone : undefined) ?? tenant.timezone ?? unidade?.timezone ?? 'America/Sao_Paulo',
      logo: await this.lerLogo(contexto.tenantId, tenant.logoObjectKey),
    };
  }

  async nomesDoFiltro(contexto: TenantContext, filtro: FiltroDoRelatorioDeAlunos): Promise<NomesDoFiltro> {
    return this.db.comTenant(async (tx) => {
      const unidade = filtro.gymUnitId
        ? await tx.gymUnit.findFirst({
            where: { id: filtro.gymUnitId, tenantId: contexto.tenantId },
            select: { name: true },
          })
        : null;
      const plano = filtro.planId
        ? await tx.plan.findFirst({
            where: { id: filtro.planId, tenantId: contexto.tenantId },
            select: { name: true },
          })
        : null;

      return { unidade: unidade?.name, plano: plano?.name };
    });
  }

  /**
   * Logo ausente, de outro tenant, sumido do bucket ou ilegível => `null`, e o
   * cabeçalho cai para texto. O relatório vale mais que o enfeite. A checagem
   * de pertencimento é a mesma de `BrandingService.lerArquivo`: a chave sai de
   * uma coluna, e servir o que a coluna disser entregaria arquivo alheio.
   */
  private async lerLogo(tenantId: string, chave: string | null): Promise<CabecalhoDaAcademia['logo']> {
    if (chave === null || !chaveDeIdentidadePertenceA(chave, tenantId)) return null;

    try {
      return await this.storage.getPrivateObject(chave);
    } catch {
      return null;
    }
  }
}

function montarEndereco(t: {
  addressLine: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}): string | null {
  const cidade = [t.addressCity, t.addressState].filter(Boolean).join(' - ');
  const partes = [t.addressLine, cidade, t.addressZip ? `CEP ${t.addressZip}` : null].filter(
    (p): p is string => p !== null && p !== '',
  );

  return partes.length > 0 ? partes.join(', ') : null;
}
```

Registrar `CabecalhoDaAcademiaService` em `reports.module.ts` (`providers` e `exports`).

- [ ] **Step 9: Rodar e ver passar**

Run: `eval "$INT reports-cabecalho"`
Expected: PASS (7 testes).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/reports apps/api/test/integration/reports-cabecalho.int-spec.ts
git commit -m "feat: cabeçalho da academia e PDF do relatório de alunos (refs #<N>)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rotas HTTP, permissões e contrato OpenAPI

**Files:**
- Create: `apps/api/src/modules/reports/reports.controller.ts`
- Modify: `apps/api/src/modules/reports/reports.module.ts`
- Create: `apps/api/test/integration/reports-alunos-http.int-spec.ts`
- Modify: `apps/api/test/integration/openapi.int-spec.ts` (lista de rotas, junto de `/api/v1/exports/{id}/download`)
- Modify: `packages/api-contracts/openapi/arenahub-v1.json` (regenerado)

**Interfaces:**
- Consumes: `ConsultarRelatorioDeAlunosUseCase.pagina/todos`, `CabecalhoDaAcademiaService.carregar/nomesDoFiltro`, `lerFiltro`, `descreverFiltro`, `montarCsvDoRelatorio`, `gerarPdfDoRelatorio`, `dataParaNomeDeArquivo`.
- Produces: `GET /api/v1/reports/students` → `{ total, linhas, proximoCursor }`; `GET /api/v1/reports/students/export?format=pdf|csv` → arquivo.

- [ ] **Step 1: Teste HTTP (falha)**

`reports-alunos-http.int-spec.ts` (mesmo molde de `venda-de-diaria-http.int-spec.ts`):

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
import { apagarCenario, criarCenarioDeDiaria, type CenarioDeDiaria } from './helpers/cenario-de-diaria.js';

/**
 * O que SÓ o HTTP prova: a permissão `student.read` guarda as duas rotas, o
 * tenant vem da sessão (nunca de parâmetro), filtro lixo não vira 400, e o
 * arquivo sai com os cabeçalhos e o conteúdo certos.
 */
describe('F90 -- GET /reports/students e /reports/students/export', () => {
  let app: INestApplication;
  let db: PrismaService;
  let c: CenarioDeDiaria;
  let outro: CenarioDeDiaria;

  const SENHA = 'senha-de-teste-relatorio';
  const cookies = { leitor: '', semPermissao: '' };

  const servidor = (): Parameters<typeof request>[0] => app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((x) => x.startsWith('arenahub_access=')) ?? '';
  };

  async function usuarioCom(rotulo: string, tenant: CenarioDeDiaria, codigos: readonly string[]): Promise<string> {
    const usuario = await db.user.create({
      data: {
        email: `relatorio-http-${rotulo}-${tenant.sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: tenant.tenantId, name: `PAPEL_${rotulo}_${tenant.sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({ where: { code }, create: { code }, update: {} });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({ data: { tenantId: tenant.tenantId, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor()).post('/api/v1/auth/login').send({ email: usuario.email, password: SENHA });

    return cookieDeAcesso(login);
  }

  async function aluno(tenant: CenarioDeDiaria, nome: string): Promise<void> {
    await db.student.create({
      data: {
        tenantId: tenant.tenantId,
        gymUnitId: tenant.unidadeId,
        membershipNumber: `F90H-${randomUUID().slice(0, 8)}`,
        fullName: nome,
        birthDate: new Date('1990-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    c = await criarCenarioDeDiaria(db, app.get(PasswordService));
    outro = await criarCenarioDeDiaria(db, app.get(PasswordService));
    await db.tenant.update({ where: { id: c.tenantId }, data: { cnpj: '12345678000195' } });

    await aluno(c, 'Ana do Tenant');
    await aluno(c, '=HYPERLINK("http://x")');
    await aluno(outro, 'Eva de Outro Tenant');

    cookies.leitor = await usuarioCom('leitor', c, ['student.read']);
    cookies.semPermissao = await usuarioCom('sem', c, ['plan.read']);
  });

  afterAll(async () => {
    await apagarCenario(db, c);
    await apagarCenario(db, outro);
    await db.user.deleteMany({ where: { email: { contains: 'relatorio-http-' } } });
    await app.close();
  });

  it('sem student.read: 403 nas duas rotas', async () => {
    for (const rota of ['/api/v1/reports/students', '/api/v1/reports/students/export?format=csv']) {
      const resposta = await request(servidor()).get(rota).set('Cookie', cookies.semPermissao);

      expect(resposta.status).toBe(403);
    }
  });

  it('sem sessão: 401', async () => {
    expect((await request(servidor()).get('/api/v1/reports/students')).status).toBe(401);
  });

  it('lista só o tenant da sessão e devolve o envelope', async () => {
    const resposta = await request(servidor()).get('/api/v1/reports/students').set('Cookie', cookies.leitor);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ total: 2, proximoCursor: null });
    expect((resposta.body as { linhas: { fullName: string }[] }).linhas.map((l) => l.fullName)).toEqual([
      '=HYPERLINK("http://x")',
      'Ana do Tenant',
    ]);
  });

  it('paginação por cursor: limit=1 devolve um e aponta o próximo', async () => {
    const primeira = await request(servidor()).get('/api/v1/reports/students?limit=1').set('Cookie', cookies.leitor);
    const corpo = primeira.body as { linhas: { studentId: string }[]; proximoCursor: string | null };

    expect(corpo.linhas).toHaveLength(1);
    expect(corpo.proximoCursor).toBe(corpo.linhas[0]?.studentId);

    const segunda = await request(servidor())
      .get(`/api/v1/reports/students?limit=1&cursor=${corpo.proximoCursor}`)
      .set('Cookie', cookies.leitor);

    expect((segunda.body as { linhas: unknown[] }).linhas).toHaveLength(1);
    expect((segunda.body as { proximoCursor: string | null }).proximoCursor).toBeNull();
  });

  it('filtro e cursor lixo não viram 400: ignorados, e `tenantId` de parâmetro é ignorado', async () => {
    const resposta = await request(servidor())
      .get(`/api/v1/reports/students?status=XYZ&gymUnitId=abc&cursor=lixo&limit=banana&tenantId=${outro.tenantId}`)
      .set('Cookie', cookies.leitor);

    expect(resposta.status).toBe(200);
    expect((resposta.body as { total: number }).total).toBe(2);
  });

  it('CSV: tipo, nome do arquivo, BOM, dados da academia, aluno e fórmula neutralizada', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/reports/students/export?format=csv')
      .set('Cookie', cookies.leitor)
      .buffer(true)
      .parse((res, cb) => {
        const pedacos: Buffer[] = [];
        res.on('data', (p: Buffer) => pedacos.push(p));
        res.on('end', () => cb(null, Buffer.concat(pedacos)));
      });

    const bytes = resposta.body as Buffer;
    const texto = bytes.toString('utf8');

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toContain('text/csv');
    expect(resposta.headers['content-disposition']).toMatch(/attachment; filename="relatorio-alunos-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(texto).toContain('CNPJ;12.345.678/0001-95');
    expect(texto).toContain('Total de alunos;2');
    expect(texto).toContain('Ana do Tenant');
    expect(texto).toContain(`'=HYPERLINK(`);
    expect(texto).not.toContain('Eva de Outro Tenant');
  });

  it('PDF: tipo, nome do arquivo e assinatura %PDF', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/reports/students/export?format=pdf')
      .set('Cookie', cookies.leitor)
      .buffer(true)
      .parse((res, cb) => {
        const pedacos: Buffer[] = [];
        res.on('data', (p: Buffer) => pedacos.push(p));
        res.on('end', () => cb(null, Buffer.concat(pedacos)));
      });

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toContain('application/pdf');
    expect(resposta.headers['content-disposition']).toMatch(/filename="relatorio-alunos-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect((resposta.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('format ausente ou inválido: 400 com código estável', async () => {
    for (const rota of ['/api/v1/reports/students/export', '/api/v1/reports/students/export?format=xlsx']) {
      const resposta = await request(servidor()).get(rota).set('Cookie', cookies.leitor);

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('REPORT_FORMAT_INVALID');
    }
  });

  it('a exportação respeita o filtro (arquivo = tela)', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/reports/students/export?format=csv&status=BLOCKED')
      .set('Cookie', cookies.leitor);

    expect(resposta.status).toBe(200);
    expect(resposta.text).toContain('Total de alunos;0');
    expect(resposta.text).toContain('Situação: Bloqueado');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `eval "$INT reports-alunos-http"`
Expected: FAIL — rotas respondem 404.

- [ ] **Step 3: Implementar o controller**

`reports.controller.ts`:

```ts
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { CabecalhoDaAcademiaService } from './cabecalho-da-academia.service.js';
import { ConsultarRelatorioDeAlunosUseCase } from './consultar-relatorio-de-alunos.use-case.js';
import { montarCsvDoRelatorio } from './domain/csv-do-relatorio.js';
import type { DadosDoRelatorioImpresso } from './domain/dados-do-relatorio.js';
import { descreverFiltro, lerFiltro } from './domain/filtro-do-relatorio-de-alunos.js';
import { dataParaNomeDeArquivo } from './domain/formato-brasileiro.js';
import { gerarPdfDoRelatorio } from './domain/pdf-do-relatorio.js';

const POR_PAGINA_PADRAO = 20;

type Consulta = Record<string, unknown>;

/**
 * Relatórios -- F90. Hoje só "Alunos"; a pasta existe para os próximos.
 *
 * O TENANT vem da sessão (`TenantContextService`), nunca de parâmetro: um
 * `?tenantId=` na URL é ignorado porque nenhum código o lê.
 */
@Controller('api/v1/reports/students')
export class ReportsController {
  constructor(
    private readonly consulta: ConsultarRelatorioDeAlunosUseCase,
    private readonly cabecalho: CabecalhoDaAcademiaService,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('student.read')
  async listar(@Query() query: Consulta) {
    const limite = z.coerce.number().int().safeParse(query['limit']);
    const cursor = z.string().uuid().safeParse(query['cursor']);

    return this.consulta.pagina(
      this.contexto.require(),
      lerFiltro(query),
      {
        limite: limite.success ? limite.data : POR_PAGINA_PADRAO,
        cursor: cursor.success ? cursor.data : undefined,
      },
      new Date(),
    );
  }

  @Get('export')
  @RequirePermissions('student.read')
  async exportar(@Query() query: Consulta, @Res() resposta: Response): Promise<void> {
    const formato = z.enum(['pdf', 'csv']).safeParse(query['format']);

    if (!formato.success) {
      throw new ErroDeDominio('REPORT_FORMAT_INVALID', 400, 'Escolha o formato: pdf ou csv.');
    }

    const contexto = this.contexto.require();
    const filtro = lerFiltro(query);
    const agora = new Date();

    const [{ total, linhas }, academia, nomes] = await Promise.all([
      this.consulta.todos(contexto, filtro, agora),
      this.cabecalho.carregar(contexto, filtro.gymUnitId),
      this.cabecalho.nomesDoFiltro(contexto, filtro),
    ]);

    const dados: DadosDoRelatorioImpresso = {
      academia,
      filtros: descreverFiltro(filtro, nomes),
      geradoEm: agora,
      total,
      linhas,
    };

    const nome = `relatorio-alunos-${dataParaNomeDeArquivo(agora, academia.fuso)}.${formato.data}`;
    const arquivo =
      formato.data === 'pdf'
        ? { corpo: await gerarPdfDoRelatorio(dados), tipo: 'application/pdf' }
        : { corpo: montarCsvDoRelatorio(dados), tipo: 'text/csv; charset=utf-8' };

    resposta
      .status(200)
      .setHeader('Content-Type', arquivo.tipo)
      .setHeader('Content-Disposition', `attachment; filename="${nome}"`)
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('Cache-Control', 'no-store')
      .send(arquivo.corpo);
  }
}
```

Completar `reports.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { CabecalhoDaAcademiaService } from './cabecalho-da-academia.service.js';
import { ConsultarRelatorioDeAlunosUseCase } from './consultar-relatorio-de-alunos.use-case.js';
import { RelatorioDeAlunosRepository } from './relatorio-de-alunos.repository.js';
import { ReportsController } from './reports.controller.js';

/** Relatórios -- F90. */
@Module({
  controllers: [ReportsController],
  providers: [
    RelatorioDeAlunosRepository,
    ConsultarRelatorioDeAlunosUseCase,
    CabecalhoDaAcademiaService,
    TenantContextService,
  ],
  exports: [RelatorioDeAlunosRepository, ConsultarRelatorioDeAlunosUseCase, CabecalhoDaAcademiaService],
})
export class ReportsModule {}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `eval "$INT reports-alunos-http"`
Expected: PASS (9 testes). Se a falha for `401`/`403` na lista com `student.read`, conferir se o `student.read` existe no catálogo de permissões do teste (o `upsert` do helper cria).

- [ ] **Step 5: Contrato OpenAPI**

Em `openapi.int-spec.ts`, na lista `arrayContaining` logo depois de `'/api/v1/exports/{id}/download',` acrescentar:

```ts
        // F90 -- relatorio de alunos (tela e exportacao PDF/CSV).
        '/api/v1/reports/students',
        '/api/v1/reports/students/export',
```

Regenerar o snapshot:

```bash
ATUALIZAR_OPENAPI=1 eval "$INT openapi.int-spec"
```

Depois, **sem** a variável: `eval "$INT openapi.int-spec"` → PASS. Conferir no diff de `arenahub-v1.json` que só entraram as duas rotas novas.

- [ ] **Step 6: Guardas do repositório**

Run: `pnpm test:guardas`
Expected: PASS (nenhuma leitura de tabela RLS fora de `comTenant`).

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/api-contracts
git commit -m "feat: rotas do relatório de alunos (lista, PDF e CSV) com student.read (refs #<N>)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Painel — menu, tela, filtros e download

**Files:**
- Create: `apps/admin-web/src/reports/filtro.ts`
- Create: `apps/admin-web/src/reports/filtro.test.ts`
- Create: `apps/admin-web/app/(protected)/reports/page.tsx`
- Create: `apps/admin-web/app/(protected)/reports/students/page.tsx`
- Create: `apps/admin-web/app/(protected)/reports/students/page.test.tsx`
- Create: `apps/admin-web/app/(protected)/reports/students/filtro-do-relatorio.tsx`
- Create: `apps/admin-web/app/(protected)/reports/students/filtro-do-relatorio.test.tsx`
- Create: `apps/admin-web/app/(protected)/reports/students/export/route.ts`
- Create: `apps/admin-web/app/(protected)/reports/students/export/route.test.ts`
- Modify: `apps/admin-web/app/(protected)/layout.tsx` (item de menu, depois de `Aulas`, ~linha 83)
- Modify: `apps/admin-web/app/(protected)/layout.test.tsx` (teste do item)

**Interfaces:**
- Consumes: `GET /api/v1/reports/students` → `{ total: number; linhas: { studentId; deviceIds: string[]; fullName; cpf: string | null; phone: string | null; planLabel: string | null }[]; proximoCursor: string | null }` (Task 6); `GET /api/v1/units`; `GET /api/v1/plans`; `mascararCpf` de `src/lib/mascaras.ts`; componentes `@arenahub/ui`.
- Produces: `consultaDoFiltro(ler: (chave: string) => string | undefined): URLSearchParams` e `CHAVES_DO_FILTRO`; rota `/reports/students`; Route Handler `GET /reports/students/export`.

> Antes de escrever a tela, **invocar `/impeccable` e `/frontend-design:frontend-design`** (CLAUDE.md, papel do Code) e seguir `docs/design/DS-PAINEL.md`. A tela deve parecer irmã de `/students` (mesmo `PageHeader`, `DataTable`, `SelectField`) — sem componente novo.

- [ ] **Step 1: Teste do helper de filtro (falha)**

`src/reports/filtro.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CHAVES_DO_FILTRO, consultaDoFiltro } from './filtro';

describe('consultaDoFiltro', () => {
  it('repassa só as chaves conhecidas e não vazias', () => {
    const valores: Record<string, string> = {
      gymUnitId: 'u1',
      status: 'ACTIVE',
      profile: '',
      planId: 'p1',
      financeiro: 'PAGANTES',
      tenantId: 'outro',
      format: 'pdf',
    };

    const consulta = consultaDoFiltro((chave) => valores[chave]);

    expect(Object.fromEntries(consulta)).toEqual({
      gymUnitId: 'u1',
      status: 'ACTIVE',
      planId: 'p1',
      financeiro: 'PAGANTES',
    });
  });

  it('nada informado = consulta vazia', () => {
    expect(consultaDoFiltro(() => undefined).toString()).toBe('');
  });

  it('as chaves são exatamente as cinco do relatório', () => {
    expect([...CHAVES_DO_FILTRO]).toEqual(['gymUnitId', 'status', 'profile', 'planId', 'financeiro']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `eval "$WEB src/reports/filtro.test.ts"`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o helper**

`src/reports/filtro.ts`:

```ts
/**
 * As cinco chaves do filtro do Relatório de Alunos -- a MESMA lista na tela,
 * no link de exportação e na Route Handler. UMA lista, para que filtro novo
 * entre nos três lugares de uma vez.
 */
export const CHAVES_DO_FILTRO = ['gymUnitId', 'status', 'profile', 'planId', 'financeiro'] as const;

/**
 * Whitelist: só estas chaves, e só se tiverem valor. Qualquer outra coisa da
 * URL (`tenantId`, `format`, lixo) fica de fora -- a Route Handler repassa
 * cookie de sessão, e o que ela encaminha tem de ser decidido aqui, não pelo
 * navegador.
 */
export function consultaDoFiltro(ler: (chave: string) => string | undefined): URLSearchParams {
  const consulta = new URLSearchParams();

  for (const chave of CHAVES_DO_FILTRO) {
    const valor = ler(chave);

    if (valor) consulta.set(chave, valor);
  }

  return consulta;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `eval "$WEB src/reports/filtro.test.ts"`
Expected: PASS.

- [ ] **Step 5: Teste da Route Handler (falha)**

`app/(protected)/reports/students/export/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lerCookie = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: lerCookie }),
}));

import { GET } from './route';

const requisicao = (query: string) => new Request(`http://painel.test/reports/students/export?${query}`) as never;

describe('GET /reports/students/export', () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    lerCookie.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it('sem cookie de acesso: 404 e a API nem é chamada', async () => {
    lerCookie.mockReturnValue(undefined);
    const chamada = vi.fn();
    globalThis.fetch = chamada as never;

    const resposta = await GET(requisicao('format=csv'));

    expect(resposta.status).toBe(404);
    expect(chamada).not.toHaveBeenCalled();
  });

  it('format inválido: 400 e a API nem é chamada', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    const chamada = vi.fn();
    globalThis.fetch = chamada as never;

    expect((await GET(requisicao('format=xlsx'))).status).toBe(400);
    expect((await GET(requisicao(''))).status).toBe(400);
    expect(chamada).not.toHaveBeenCalled();
  });

  it('repassa SÓ o cookie de acesso e SÓ as chaves do filtro (nada de tenantId)', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    const chamada = vi.fn(async () => new Response('x', { status: 200 }));
    globalThis.fetch = chamada as never;

    await GET(requisicao('format=pdf&status=ACTIVE&tenantId=outro&financeiro=PAGANTES&lixo=1'));

    const [url, opcoes] = chamada.mock.calls[0] as unknown as [string, RequestInit];
    const alvo = new URL(url);

    expect(alvo.pathname).toBe('/api/v1/reports/students/export');
    expect(Object.fromEntries(alvo.searchParams)).toEqual({
      format: 'pdf',
      status: 'ACTIVE',
      financeiro: 'PAGANTES',
    });
    expect(opcoes.headers).toEqual({ cookie: 'arenahub_access=tok' });
  });

  it('devolve o corpo e só os cabeçalhos de download', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    globalThis.fetch = (async () =>
      new Response('conteudo', {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="relatorio-alunos-2026-10-10.csv"',
          'x-content-type-options': 'nosniff',
          'set-cookie': 'arenahub_refresh=vaza',
          'x-interno': 'segredo',
        },
      })) as never;

    const resposta = await GET(requisicao('format=csv'));

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe('conteudo');
    expect(resposta.headers.get('content-disposition')).toContain('relatorio-alunos-2026-10-10.csv');
    expect(resposta.headers.get('set-cookie')).toBeNull();
    expect(resposta.headers.get('x-interno')).toBeNull();
  });

  it('erro da API (403, 422...) vira o mesmo status, sem corpo da API', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    globalThis.fetch = (async () => new Response('{"code":"REPORT_TOO_LARGE"}', { status: 422 })) as never;

    expect((await GET(requisicao('format=csv'))).status).toBe(422);
  });

  it('API fora do ar: 404, não erro de servidor', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as never;

    expect((await GET(requisicao('format=csv'))).status).toBe(404);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `eval "$WEB 'app/(protected)/reports/students/export'"`
Expected: FAIL — `./route` não existe.

- [ ] **Step 7: Implementar a Route Handler**

`app/(protected)/reports/students/export/route.ts`:

```ts
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

import { consultaDoFiltro } from '../../../../../src/reports/filtro';

/**
 * Download do Relatório de Alunos, servido pelo painel -- F90.
 *
 * Mesma razão de `/contratos/[id]/documento`: `API_INTERNAL_URL` é o endereço
 * da API vista DE DENTRO da rede e o navegador não o alcança. Esta rota repassa
 * o cookie de ACESSO (nunca o de refresh) e devolve o arquivo.
 *
 * NÃO É PROXY GENÉRICO. O caminho é literal e a query é reconstruída por
 * whitelist (`consultaDoFiltro` + `format`): é justamente por repassar cookie
 * que esta rota não pode virar um caminho autenticado para qualquer parâmetro
 * que o navegador mande. A AUTORIZAÇÃO continua sendo da API (`student.read`).
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

const FORMATOS = new Set(['pdf', 'csv']);

/** Os cabeçalhos que o navegador precisa receber, e nenhum outro. */
const CABECALHOS_REPASSADOS = [
  'content-type',
  'content-disposition',
  'x-content-type-options',
  'cache-control',
] as const;

export async function GET(requisicao: NextRequest): Promise<Response> {
  const acesso = (await cookies()).get('arenahub_access');

  if (!acesso) return new Response(null, { status: 404 });

  const parametros = new URL(requisicao.url).searchParams;
  const formato = parametros.get('format') ?? '';

  if (!FORMATOS.has(formato)) return new Response(null, { status: 400 });

  const consulta = consultaDoFiltro((chave) => parametros.get(chave) ?? undefined);
  consulta.set('format', formato);

  let resposta: Response;

  try {
    resposta = await fetch(`${URL_INTERNA}/api/v1/reports/students/export?${consulta.toString()}`, {
      cache: 'no-store',
      headers: { cookie: `${acesso.name}=${acesso.value}` },
    });
  } catch {
    // API fora do ar: o link não pode pintar a tela de erro. A pessoa tenta de novo.
    return new Response(null, { status: 404 });
  }

  if (!resposta.ok) return new Response(null, { status: resposta.status });

  const cabecalhos = new Headers();

  for (const nome of CABECALHOS_REPASSADOS) {
    const valor = resposta.headers.get(nome);

    if (valor !== null) cabecalhos.set(nome, valor);
  }

  return new Response(await resposta.arrayBuffer(), { status: 200, headers: cabecalhos });
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `eval "$WEB 'app/(protected)/reports/students/export'"`
Expected: PASS (6 testes).

- [ ] **Step 9: Teste do filtro cliente (falha)**

`filtro-do-relatorio.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/students',
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams('status=ACTIVE&cursor=abc'),
}));

import { FiltroDoRelatorio } from './filtro-do-relatorio';

const UNIDADES = [
  { id: 'u1', name: 'Matriz' },
  { id: 'u2', name: 'Filial' },
];
const PLANOS = [{ id: 'p1', name: 'Mensal Fit' }];

const props = {
  unidades: UNIDADES,
  planos: PLANOS,
  valores: { gymUnitId: '', status: 'ACTIVE', profile: '', planId: '', financeiro: '' },
};

describe('FiltroDoRelatorio', () => {
  beforeEach(() => replace.mockReset());

  it('mostra os cinco filtros com rótulo acessível', () => {
    render(<FiltroDoRelatorio {...props} />);

    for (const rotulo of ['Unidade', 'Situação', 'Perfil', 'Plano', 'Financeiro']) {
      expect(screen.getByLabelText(rotulo)).toBeTruthy();
    }
  });

  it('trocar um filtro escreve na URL, mantém os outros e LIMPA o cursor', () => {
    render(<FiltroDoRelatorio {...props} />);

    fireEvent.change(screen.getByLabelText('Financeiro'), { target: { value: 'INADIMPLENTES' } });

    expect(replace).toHaveBeenCalledWith(
      '/reports/students?status=ACTIVE&financeiro=INADIMPLENTES',
      { scroll: false },
    );
  });

  it('voltar a "Todos" remove a chave da URL', () => {
    render(<FiltroDoRelatorio {...props} />);

    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: '' } });

    expect(replace).toHaveBeenCalledWith('/reports/students', { scroll: false });
  });

  it('com uma unidade só, o filtro de unidade não aparece (nada para separar)', () => {
    render(<FiltroDoRelatorio {...props} unidades={[UNIDADES[0]!]} />);

    expect(screen.queryByLabelText('Unidade')).toBeNull();
  });

  it('sem planos (sem plan.read), o filtro de plano não aparece', () => {
    render(<FiltroDoRelatorio {...props} planos={[]} />);

    expect(screen.queryByLabelText('Plano')).toBeNull();
  });

  it('financeiro oferece Todos, Inadimplentes e Pagantes', () => {
    render(<FiltroDoRelatorio {...props} />);

    const opcoes = [...(screen.getByLabelText('Financeiro') as HTMLSelectElement).options].map((o) => o.text);

    expect(opcoes).toEqual(['Todos', 'Inadimplentes', 'Pagantes']);
  });
});
```

- [ ] **Step 10: Rodar e ver falhar**

Run: `eval "$WEB 'reports/students/filtro-do-relatorio'"`
Expected: FAIL — componente não existe.

- [ ] **Step 11: Implementar o filtro cliente**

`filtro-do-relatorio.tsx`:

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { SelectField } from '@arenahub/ui';

import { CHAVES_DO_FILTRO } from '../../../../src/reports/filtro';
import estilos from '../../students/students.module.css';

const SITUACOES = [
  ['LEAD', 'Interessado'],
  ['TRIAL', 'Experimental'],
  ['ACTIVE', 'Ativo'],
  ['SUSPENDED', 'Suspenso'],
  ['BLOCKED', 'Bloqueado'],
  ['CANCELLED', 'Cancelado'],
  ['ARCHIVED', 'Arquivado'],
] as const;

const PERFIS = [
  ['STUDENT', 'Aluno'],
  ['TRAINER', 'Professor'],
  ['STAFF', 'Funcionário'],
  ['ADMIN', 'Administrador'],
  ['PERMUTA_TACIO', 'Permuta-Tacio'],
  ['PERMUTA_DOUGLAS', 'Permuta-Douglas'],
] as const;

type Chave = (typeof CHAVES_DO_FILTRO)[number];

interface Props {
  unidades: { id: string; name: string }[];
  /** Vazio quando o usuário não tem `plan.read`: o filtro simplesmente não aparece. */
  planos: { id: string; name: string }[];
  valores: Record<Chave, string>;
}

/**
 * Filtros do Relatório de Alunos. A URL é a fonte da verdade (link
 * compartilhável, botão voltar funciona); o componente só a reescreve. Sem
 * busca por texto, não há debounce: cada select navega na hora.
 *
 * Trocar qualquer filtro APAGA o `cursor`: ele aponta para uma posição da
 * lista ANTERIOR, e mantê-lo pularia ou repetiria gente.
 */
export function FiltroDoRelatorio({ unidades, planos, valores }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const trocar = (chave: Chave, valor: string): void => {
    const url = new URLSearchParams(searchParams.toString());

    url.delete('cursor');

    if (valor) url.set(chave, valor);
    else url.delete(chave);

    const consulta = url.toString();

    router.replace(consulta ? `${pathname}?${consulta}` : pathname, { scroll: false });
  };

  return (
    <div className={estilos['filtro']}>
      {unidades.length > 1 ? (
        <SelectField
          id="relatorio-unidade"
          name="gymUnitId"
          label="Unidade"
          value={valores.gymUnitId}
          onChange={(e) => trocar('gymUnitId', e.target.value)}
        >
          <option value="">Todas</option>
          {unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <SelectField
        id="relatorio-situacao"
        name="status"
        label="Situação"
        value={valores.status}
        onChange={(e) => trocar('status', e.target.value)}
      >
        <option value="">Todas</option>
        {SITUACOES.map(([chave, rotulo]) => (
          <option key={chave} value={chave}>
            {rotulo}
          </option>
        ))}
      </SelectField>

      <SelectField
        id="relatorio-perfil"
        name="profile"
        label="Perfil"
        value={valores.profile}
        onChange={(e) => trocar('profile', e.target.value)}
      >
        <option value="">Todos</option>
        {PERFIS.map(([chave, rotulo]) => (
          <option key={chave} value={chave}>
            {rotulo}
          </option>
        ))}
      </SelectField>

      {planos.length > 0 ? (
        <SelectField
          id="relatorio-plano"
          name="planId"
          label="Plano"
          value={valores.planId}
          onChange={(e) => trocar('planId', e.target.value)}
        >
          <option value="">Todos</option>
          {planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      ) : null}

      <SelectField
        id="relatorio-financeiro"
        name="financeiro"
        label="Financeiro"
        value={valores.financeiro}
        onChange={(e) => trocar('financeiro', e.target.value)}
      >
        <option value="">Todos</option>
        <option value="INADIMPLENTES">Inadimplentes</option>
        <option value="PAGANTES">Pagantes</option>
      </SelectField>
    </div>
  );
}
```

- [ ] **Step 12: Rodar e ver passar**

Run: `eval "$WEB 'reports/students/filtro-do-relatorio'"`
Expected: PASS (6 testes). (Se o import do `students.module.css` do vizinho incomodar a lint de fronteira de pasta, copiar só a regra `.filtro` para `reports.module.css` ao lado — decidir olhando o que `pnpm lint` disser, sem inventar estilo novo.)

- [ ] **Step 13: Teste da página (falha)**

`page.test.tsx` (mesma estrutura de `students/page.test.tsx`):

```tsx
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/students',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import PaginaDoRelatorioDeAlunos from './page';

const LINHA = {
  studentId: '11111111-1111-4111-8111-111111111111',
  deviceIds: ['1042', '1043'],
  fullName: 'Maria da Silva',
  cpf: '11144477735',
  phone: '41999990000',
  planLabel: 'Mensal Fit',
};
const SEM_NADA = {
  studentId: '22222222-2222-4222-8222-222222222222',
  deviceIds: [],
  fullName: 'Joao Sem Dados',
  cpf: null,
  phone: null,
  planLabel: null,
};

function responder(relatorio: unknown, extras: { unidades?: unknown[]; planos?: unknown[] | 'erro' } = {}) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho.startsWith('/api/v1/reports/students')) {
      return Promise.resolve({ ok: true, dados: relatorio, cookiesDaApi: [] });
    }
    if (caminho === '/api/v1/units') {
      return Promise.resolve({ ok: true, dados: extras.unidades ?? [], cookiesDaApi: [] });
    }
    if (caminho === '/api/v1/plans') {
      return extras.planos === 'erro'
        ? Promise.resolve({ ok: false, erro: { code: 'FORBIDDEN' }, cookiesDaApi: [] })
        : Promise.resolve({ ok: true, dados: extras.planos ?? [], cookiesDaApi: [] });
    }
    return Promise.resolve({ ok: true, dados: [], cookiesDaApi: [] });
  });
}

async function renderizar(searchParams: Record<string, string> = {}) {
  const elemento = await PaginaDoRelatorioDeAlunos({ searchParams: Promise.resolve(searchParams) });

  return render(elemento);
}

describe('Relatório de Alunos', () => {
  beforeEach(() => vi.mocked(chamarApi).mockReset());

  it('mostra as cinco colunas, com CPF e contato mascarados e as catracas juntas', async () => {
    responder({ total: 1, linhas: [LINHA], proximoCursor: null });
    await renderizar();

    const tabela = screen.getByTestId('tabela-do-relatorio-de-alunos');

    for (const titulo of ['Catraca', 'Nome', 'CPF', 'Contato', 'Plano']) {
      expect(within(tabela).getByRole('columnheader', { name: titulo })).toBeTruthy();
    }
    expect(within(tabela).getByText('1042, 1043')).toBeTruthy();
    expect(within(tabela).getByText('Maria da Silva')).toBeTruthy();
    expect(within(tabela).getByText('111.444.777-35')).toBeTruthy();
    expect(within(tabela).getByText('Mensal Fit')).toBeTruthy();
  });

  it('aluno sem CPF, contato, plano e catraca mostra célula vazia, não "null"', async () => {
    responder({ total: 1, linhas: [SEM_NADA], proximoCursor: null });
    await renderizar();

    const tabela = screen.getByTestId('tabela-do-relatorio-de-alunos');

    expect(within(tabela).getByText('Joao Sem Dados')).toBeTruthy();
    expect(tabela.textContent).not.toMatch(/null|undefined/);
  });

  it('repassa o filtro da URL para a API (e o total na barra)', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar({ status: 'ACTIVE', financeiro: 'INADIMPLENTES', tenantId: 'outro' });

    const chamada = vi.mocked(chamarApi).mock.calls.find(([c]) => String(c).startsWith('/api/v1/reports/students'));
    const consulta = new URLSearchParams(String(chamada?.[0]).split('?')[1]);

    expect(consulta.get('status')).toBe('ACTIVE');
    expect(consulta.get('financeiro')).toBe('INADIMPLENTES');
    expect(consulta.get('tenantId')).toBeNull();
    expect(consulta.get('limit')).toBe('20');
  });

  it('botões de exportação carregam os filtros atuais', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar({ status: 'BLOCKED', planId: 'p1' });

    const pdf = screen.getByRole('link', { name: /exportar pdf/i }).getAttribute('href') ?? '';
    const csv = screen.getByRole('link', { name: /exportar csv/i }).getAttribute('href') ?? '';

    expect(pdf).toBe('/reports/students/export?status=BLOCKED&planId=p1&format=pdf');
    expect(csv).toBe('/reports/students/export?status=BLOCKED&planId=p1&format=csv');
  });

  it('há próxima página: o link leva filtros e cursor', async () => {
    responder({ total: 50, linhas: [LINHA], proximoCursor: LINHA.studentId });
    await renderizar({ status: 'ACTIVE' });

    const proximo = screen.getByRole('link', { name: /próxim/i }).getAttribute('href') ?? '';

    expect(proximo).toBe(`/reports/students?status=ACTIVE&cursor=${LINHA.studentId}`);
  });

  it('lista vazia com filtro: mensagem de filtro, não "nenhum aluno cadastrado"', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar({ status: 'BLOCKED' });

    expect(screen.getByText('Nenhum aluno encontrado com esses filtros.')).toBeTruthy();
  });

  it('lista vazia sem filtro: diz que não há aluno', async () => {
    responder({ total: 0, linhas: [], proximoCursor: null });
    await renderizar();

    expect(screen.getByText('Nenhum aluno cadastrado ainda.')).toBeTruthy();
  });

  it('sem plan.read (planos falham), a tela segue e o filtro de plano some', async () => {
    responder({ total: 1, linhas: [LINHA], proximoCursor: null }, { planos: 'erro' });
    await renderizar();

    expect(screen.getByTestId('tabela-do-relatorio-de-alunos')).toBeTruthy();
    expect(screen.queryByLabelText('Plano')).toBeNull();
  });

  it('API recusa (sem student.read): erro de permissão, sem tabela', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', status: 403, code: 'FORBIDDEN', correlationId: 'c' },
      cookiesDaApi: [],
    } as never);
    await renderizar();

    expect(screen.getByTestId('erro-de-permissao')).toBeTruthy();
    expect(screen.queryByTestId('tabela-do-relatorio-de-alunos')).toBeNull();
  });
});
```

- [ ] **Step 14: Rodar e ver falhar**

Run: `eval "$WEB 'reports/students/page.test'"`
Expected: FAIL — `./page` não existe.

- [ ] **Step 15: Implementar a página e o redirect**

`app/(protected)/reports/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

/** Só há um relatório por enquanto; quando houver mais, esta vira o índice. */
export default function PaginaDeRelatorios(): never {
  redirect('/reports/students');
}
```

`app/(protected)/reports/students/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { z } from 'zod';

import {
  Ausente,
  Button,
  DataTable,
  EmptyState,
  Identidade,
  PageHeader,
  ProblemDetail,
  Telefone,
} from '@arenahub/ui';

import { chamarApi } from '../../../../lib/api/server-client';
import { mascararCpf } from '../../../../src/lib/mascaras';
import { consultaDoFiltro } from '../../../../src/reports/filtro';
import { FiltroDoRelatorio } from './filtro-do-relatorio';

export const metadata: Metadata = { title: 'Relatório de alunos — ArenaHub' };

export const dynamic = 'force-dynamic';

const POR_PAGINA = 20;

const esquemaDoRelatorio = z.object({
  total: z.number(),
  proximoCursor: z.string().nullable(),
  linhas: z.array(
    z.object({
      studentId: z.string(),
      deviceIds: z.array(z.string()),
      fullName: z.string(),
      cpf: z.string().nullable(),
      phone: z.string().nullable(),
      planLabel: z.string().nullable(),
    }),
  ),
});

const esquemaDeUnidade = z.array(z.object({ id: z.string(), name: z.string() }));
const esquemaDePlano = z.array(z.object({ id: z.string(), name: z.string() }));

/**
 * Relatório de Alunos -- F90. Irmã da Lista de Alunos: mesmo cabeçalho, mesma
 * tabela, filtros na URL. Server Component, sem JavaScript para filtrar.
 *
 * A EXPORTAÇÃO É O MESMO FILTRO: os dois botões apontam para a Route Handler
 * com exatamente a consulta desta tela, então o arquivo é o que se vê.
 */
export default async function PaginaDoRelatorioDeAlunos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const texto = (chave: string): string | undefined => {
    const valor = parametros[chave];

    return typeof valor === 'string' && valor !== '' ? valor : undefined;
  };

  const filtro = consultaDoFiltro(texto);
  const cursor = texto('cursor');

  const consulta = new URLSearchParams(filtro);
  consulta.set('limit', String(POR_PAGINA));
  if (cursor) consulta.set('cursor', cursor);

  // Unidades e planos são do FILTRO: falhar ao buscá-los não derruba a tela.
  const [resposta, respostaDeUnidades, respostaDePlanos] = await Promise.all([
    chamarApi(`/api/v1/reports/students?${consulta.toString()}`, { esquema: esquemaDoRelatorio }),
    chamarApi('/api/v1/units', { esquema: esquemaDeUnidade }),
    chamarApi('/api/v1/plans', { esquema: esquemaDePlano }),
  ]);

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-relatorio-de-alunos">
        <PageHeader id="titulo-relatorio-de-alunos" title="Relatório de alunos" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? { type: 'about:blank', status: 0, code: 'erro', correlationId: '' }),
            title: `Sem permissão para consultar o relatório (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const relatorio = resposta.dados;
  const unidades = respostaDeUnidades.ok ? (respostaDeUnidades.dados ?? []) : [];
  const planos = respostaDePlanos.ok ? (respostaDePlanos.dados ?? []) : [];
  const temFiltro = filtro.size > 0;

  const proxima = relatorio.proximoCursor
    ? `/reports/students?${new URLSearchParams([...filtro, ['cursor', relatorio.proximoCursor]]).toString()}`
    : '';
  const primeira = cursor
    ? `/reports/students${filtro.size > 0 ? `?${filtro.toString()}` : ''}`
    : '';

  const exportar = (formato: 'pdf' | 'csv'): string => {
    const url = new URLSearchParams(filtro);
    url.set('format', formato);

    return `/reports/students/export?${url.toString()}`;
  };

  return (
    <section aria-labelledby="titulo-relatorio-de-alunos">
      <PageHeader
        id="titulo-relatorio-de-alunos"
        title="Relatório de alunos"
        breadcrumb={<span>Relatórios</span>}
        actions={
          <>
            <Button href={exportar('pdf')} variant="outline" data-testid="exportar-pdf">
              Exportar PDF
            </Button>
            <Button href={exportar('csv')} variant="outline" data-testid="exportar-csv">
              Exportar CSV
            </Button>
          </>
        }
      />

      <FiltroDoRelatorio
        unidades={unidades}
        planos={planos}
        valores={{
          gymUnitId: texto('gymUnitId') ?? '',
          status: texto('status') ?? '',
          profile: texto('profile') ?? '',
          planId: texto('planId') ?? '',
          financeiro: texto('financeiro') ?? '',
        }}
      />

      <DataTable
        testId="tabela-do-relatorio-de-alunos"
        rows={relatorio.linhas}
        total={relatorio.total}
        rowKey={(aluno) => aluno.studentId}
        rowTestId={(aluno) => `relatorio-aluno-${aluno.studentId}`}
        caption="Alunos do relatório, em ordem alfabética"
        columns={[
          {
            key: 'catraca',
            header: 'Catraca',
            role: 'code',
            // Dois números aparecem os dois: é o caso que precisa ser visto (cartão antigo ainda válido).
            render: (aluno) => (aluno.deviceIds.length === 0 ? <Ausente /> : aluno.deviceIds.join(', ')),
          },
          {
            key: 'nome',
            header: 'Nome',
            role: 'identity',
            render: (aluno) => <Identidade nome={aluno.fullName} href={`/students/${aluno.studentId}`} />,
          },
          {
            key: 'cpf',
            header: 'CPF',
            role: 'code',
            render: (aluno) => (aluno.cpf === null ? <Ausente /> : mascararCpf(aluno.cpf)),
          },
          {
            key: 'contato',
            header: 'Contato',
            role: 'label',
            render: (aluno) => <Telefone numero={aluno.phone} />,
          },
          {
            key: 'plano',
            header: 'Plano',
            role: 'label',
            render: (aluno) => (aluno.planLabel === null ? <Ausente /> : aluno.planLabel),
          },
        ]}
        {...(primeira ? { prevHref: primeira, prevLabel: 'Primeira página' } : {})}
        {...(proxima ? { nextHref: proxima } : {})}
        empty={
          <EmptyState
            testId="sem-alunos-no-relatorio"
            title={temFiltro ? 'Nenhum aluno encontrado com esses filtros.' : 'Nenhum aluno cadastrado ainda.'}
            hint={temFiltro ? 'Amplie ou limpe os filtros.' : 'Cadastre o primeiro aluno para ver o relatório.'}
          />
        }
      />
    </section>
  );
}
```

> Antes de rodar: confirmar a assinatura real de `chamarApi` com `esquema` (a página de Planos usa `chamarApi('/api/v1/plans', { esquema: z.array(...) })`, `app/(protected)/plans/page.tsx:84`) e o formato de `Telefone`/`Ausente` exportados por `@arenahub/ui` (a Lista de Alunos importa os dois). Se `chamarApi` com `esquema` devolver `dados` já tipado, os `?? []` e o `!resposta.dados` acima continuam corretos.

- [ ] **Step 16: Rodar e ver passar**

Run: `eval "$WEB 'reports/students/page.test'"`
Expected: PASS (9 testes). Se o teste do `href` de exportar falhar só pela ORDEM dos parâmetros, a ordem certa é a da `CHAVES_DO_FILTRO` + `format` no fim — ajustar o teste, não a ordem do helper.

- [ ] **Step 17: Item de menu (teste primeiro)**

Em `layout.test.tsx`, dentro do `describe` que já testa o menu por permissão (perto do teste `'mostra Configuração só a quem tem billing.read'`, linha ~238), acrescentar:

```tsx
    it('mostra Relatórios só a quem tem student.read', async () => {
      responder([unidade('Unidade Matriz')], ['student.read']);
      await renderizar();

      expect(screen.getByRole('link', { name: 'Relatórios' }).getAttribute('href')).toBe('/reports');
    });

    it('esconde Relatórios de quem não tem student.read', async () => {
      responder([unidade('Unidade Matriz')], ['class.read']);
      await renderizar();

      expect(screen.queryByRole('link', { name: 'Relatórios' })).toBeNull();
    });
```

Run: `eval "$WEB 'app/\(protected\)/layout.test'"`
Expected: FAIL (link inexistente).

Em `layout.tsx`, logo após a linha do item `Aulas` (`{ href: '/classes', label: 'Aulas', exigePermissao: 'class.read' },`), inserir:

```tsx
  /*
    RELATÓRIOS -- F90. Mesma regra de quem lê aluno (`student.read`): o
    primeiro relatório é a lista de alunos exportável. Fica antes do
    Financeiro porque o grupo abaixo começa em "Cobrança" e carrega o rótulo.
  */
  { href: '/reports', label: 'Relatórios', exigePermissao: 'student.read' },
```

Run: `eval "$WEB 'app/\(protected\)/layout.test'"`
Expected: PASS (inclusive os testes de agrupamento antigos, que não podem mudar).

- [ ] **Step 18: Lint, tipos e build do painel**

Run: `pnpm --filter @arenahub/admin-web lint && pnpm --filter @arenahub/admin-web typecheck`
Expected: sem erro. Cuidado conhecido: a regra 5 do DS proíbe `Intl.DateTimeFormat` e `toLocale*` no painel — esta tela não formata data, então nada a fazer; se a lint reclamar de hex literal ou token inexistente, usar só tokens que existem em `packages/ui/dist-tokens/theme.css`.

- [ ] **Step 19: Commit**

```bash
git add apps/admin-web
git commit -m "feat: menu Relatórios e tela Relatório de alunos com exportação PDF e CSV (refs #<N>)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: E2E, documentação e gate local

**Files:**
- Create: `apps/admin-web/tests/e2e/relatorio-de-alunos.e2e-spec.ts`
- Create: `docs/specs/SPEC-090-relatorio-de-alunos.md`
- Modify: `docs/superpowers/specs/2026-10-10-relatorio-de-alunos-design.md` (envelope e nota do SVG)
- Modify: `docs/STATUS.md` (Índice Fatia ↔ SPEC, depois da linha F89, ~linha 1071)
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/TESTS.md` (via `pnpm test:report`)

- [ ] **Step 1: E2E (jornada real, contra API e banco semeados)**

`relatorio-de-alunos.e2e-spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';

/**
 * F90 -- Relatório de Alunos de ponta a ponta: o menu leva à tela, o filtro
 * escreve na URL e muda a lista, e os dois botões baixam um arquivo de verdade
 * com os dados da academia. Contra a API real: um dublê não provaria que o
 * cookie chega até a rota de download.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe('relatório de alunos', () => {
  test('o menu leva ao relatório e o aluno cadastrado aparece', async ({ page }) => {
    await entrar(page);
    const nome = `Relatorio E2E ${Date.now()}`;
    await cadastrarAluno(page, { nome, nascimento: '01/01/1990' });

    await page.getByRole('link', { name: 'Relatórios' }).click();

    await expect(page).toHaveURL(/\/reports\/students/);
    await expect(page.getByRole('heading', { name: 'Relatório de alunos' })).toBeVisible();
    await expect(page.getByTestId('tabela-do-relatorio-de-alunos')).toBeVisible();
  });

  test('o filtro escreve na URL e a lista responde', async ({ page }) => {
    await entrar(page);
    await page.goto('/reports/students');

    await page.getByLabel('Situação').selectOption('BLOCKED');

    await expect(page).toHaveURL(/status=BLOCKED/);
    await expect(page.getByLabel('Situação')).toHaveValue('BLOCKED');
  });

  test('Exportar CSV baixa o arquivo com BOM, dados da academia e o filtro aplicado', async ({ page }) => {
    await entrar(page);
    await page.goto('/reports/students?status=ACTIVE');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: /exportar csv/i }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^relatorio-alunos-\d{4}-\d{2}-\d{2}\.csv$/);

    const caminho = await download.path();
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(caminho);
    const texto = bytes.toString('utf8');

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(texto).toContain('Relatório de Alunos');
    expect(texto).toContain('Filtros;Situação: Ativo');
    expect(texto).toContain('Catraca;Nome;CPF;Contato;Plano');
  });

  test('Exportar PDF baixa um PDF de verdade', async ({ page }) => {
    await entrar(page);
    await page.goto('/reports/students');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: /exportar pdf/i }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(await download.path());

    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
```

> Preparar o ambiente do E2E como na memória `teste-local-com-postgres-descartavel` (banco `..._e2e` no container da Task 0, `migrate deploy`, `pnpm seed`, `pnpm --filter @arenahub/api build`, `pnpm --filter @arenahub/admin-web build`, e **matar qualquer Next na porta 3000 antes** — `reuseExistingServer` pegaria o painel de outra árvore/projeto). Exportar `E2E_DATABASE_URL` e `RUNTIME_E2E_DATABASE_URL` no próprio comando.

Run: `pnpm --filter @arenahub/admin-web exec playwright test relatorio-de-alunos`
Expected: PASS (4 testes). Rebuild do `admin-web` e da `api` **entre** qualquer correção e a re-execução (o `next start` serve o build antigo).

- [ ] **Step 2: Atualizar o spec com as duas decisões desta implementação**

No spec (`2026-10-10-relatorio-de-alunos-design.md`):
- Na seção **API**, trocar "JSON paginado por cursor (`limit` ≤ 100, padrão 20) + `X-Total-Count`" por "envelope `{ total, linhas, proximoCursor }` paginado por cursor (`limit` ≤ 100, padrão 20)" e a frase da tabela equivalente.
- Na seção **Arquivos gerados**, na linha do PDF, acrescentar: "Logo PNG/JPEG é embutida; logo **SVG** não é (o `pdfkit` não a renderiza), e o cabeçalho sai só com texto."

- [ ] **Step 3: SPEC-090 (ponteiro fino) e linha do Índice**

Criar `docs/specs/SPEC-090-relatorio-de-alunos.md` a partir de `docs/specs/_TEMPLATE.md`, no formato de `SPEC-089-...md` (tabela de campos: Fatia F90, "Slice do PRD: não há. Nasce de pedido do PI em 10/10/2026", Superfície `apps/api` (`reports`) e `apps/admin-web`, Status `aprovada-pi`, Card), seção 1 com a frase de objetivo, seção 2 apontando para o spec em `docs/superpowers/specs/2026-10-10-relatorio-de-alunos-design.md` ("Nada é copiado para cá").

Em `docs/STATUS.md`, depois da linha `| F89 | SPEC-089 | ...`, acrescentar (substituir `<N>` e `<PR>` pelos números reais):

```
| F90 | SPEC-090 | — | — | Relatórios > Alunos: filtros, exportação PDF e CSV com logo e dados da academia | [`SPEC-090-relatorio-de-alunos.md`](specs/SPEC-090-relatorio-de-alunos.md) | [#<N>](https://github.com/RodReis/arenahub/issues/<N>) | 🚧 em andamento — pedido do PI em 10/10/2026 |
```

Em `docs/DEVELOPMENT.md`, acrescentar a seção da F90 no padrão das fatias vizinhas (o que entrou, onde mora o código, como verificar, o limite do SVG).

- [ ] **Step 4: Issue do card**

```bash
gh issue create --title "[SPEC-090][F90] Relatórios > Alunos" --body "Spec: docs/superpowers/specs/2026-10-10-relatorio-de-alunos-design.md. Plano: docs/superpowers/plans/2026-10-10-relatorio-de-alunos.md." --label proplan:backlog --assignee RodReis
```

Mover para `todo`/`doing` conforme o fluxo do `CLAUDE.md`. Substituir `<N>` nos commits já feitos **não** é necessário (a PR usa `refs #N`); usar o número real daqui em diante.

- [ ] **Step 5: Revisão de código (obrigatória antes do commit final)**

Invocar `/code-review` na branch (e `security-reviewer`: a rota exporta CPF/telefone de toda a base, é entrada de usuário na URL e toca object storage). Tratar CRITICAL e HIGH. Revisão **adversarial**, nada de CodeRabbit.

- [ ] **Step 6: Gate local — os cinco comandos raiz, com cache forçado**

```bash
pnpm lint --force && pnpm typecheck --force && pnpm test && pnpm test:guardas && pnpm build --force
pnpm test:report --issue <N>      # roda unit + integração e atualiza docs/TESTS.md
git add -A && pnpm test:report --check
```

Expected: tudo verde. `test:report` herda o número antigo quando o Jest de integração crasha no Windows (exit 3221226505 depois dos testes passarem): conferir por duas medições e corrigir à mão se for o caso. A coluna **PR** do `TESTS.md` nasce com `—` e é preenchida **depois do merge** (PR de docs próprio).

- [ ] **Step 7: PR, CI e merge**

```bash
git push -u origin feat/f90-relatorio-de-alunos
gh pr create --title "feat: Relatórios > Alunos com exportação PDF e CSV (F90)" --body "<resumo, decisões do corpo do plano, testes, o limite do SVG>

refs #<N>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Nunca `closes`/`fixes` colado em `#N`. Esperar o CI com `gh run watch <run-id> --exit-status` em background, avisando em uma frase que a espera é assíncrona; sem notificação em ~3-5 min, **uma** checagem (`gh pr checks <n>`) e relatar "ainda rodando". Conferir job a job ao terminar. Merge só com CI verde; depois aplicar `proplan:done` com o link do PR no corpo da issue.

- [ ] **Step 8: Depois do merge**

Atualizar o localhost (resubir na `main` com `.next`/`dist`/`tsbuildinfo` limpos), abrir `/reports/students` e baixar os dois arquivos de verdade antes de dizer "entregue". Perguntar ao PI se roda `/graphify . --update`. Parar e remover o container `arenahub-f90-postgres`.

---

## Self-Review

**1. Cobertura do spec**

| Requisito do spec | Onde |
|---|---|
| Menu Relatórios, `student.read`, `/reports` → `/reports/students` | Task 7 (steps 15, 17) |
| Filtros Unidade, Situação, Perfil, Plano, Financeiro (select único) | Task 2 (`lerFiltro`), Task 4 (`ondeDoRelatorio`), Task 7 (`FiltroDoRelatorio`) |
| Colunas Catraca, Nome, CPF, Contato, Plano | Task 4 (`selecao`/`paraLinha`), Task 7 (colunas), Task 3/5 (arquivos) |
| Tela no padrão da Lista de Alunos (DataTable, cursor, filtros na URL) | Task 7 |
| Exportar PDF e CSV com filtros atuais | Task 6 (rota), Task 7 (botões + Route Handler) |
| Exportação = todos os alunos do filtro, teto 20.000, `REPORT_TOO_LARGE` | Task 4 (`todos`) |
| Mesma consulta tela/arquivo | Task 4 (`ConsultarRelatorioDeAlunosUseCase`), teste "arquivo = tela" na Task 6 |
| Inadimplente/Pagante = regras da Cobrança, sem cópia | Task 1 + teste de PARIDADE (Task 4) |
| Cabeçalho: logo, razão social, CNPJ, endereço, telefone, filtros, data no fuso, total | Task 5 (serviço + PDF), Task 3 (CSV) |
| PDF: cabeçalho de tabela repetido, "Página X de Y" | Task 5 |
| CSV: BOM, `;`, linhas da academia no topo, escape + neutralização | Task 3 |
| Sem logo → texto | Task 5 (testes de logo) |
| Sem dado de saúde/biometria/token no arquivo | Colunas fixas (Task 4); nada além das cinco é selecionado |
| Testes unit/integração/web/E2E + canário + code-review | Tasks 1-8 (canário no Step 6 da Task 4) |
| Docs (STATUS, DEVELOPMENT, SPEC ponteiro, TESTS) | Task 8 |
| OpenAPI declarado | Task 6 Step 5 |

Divergências do spec, todas declaradas em "Decisões registradas": envelope no lugar de `X-Total-Count`; SVG sem logo no PDF; Plano = assinatura vigente; filtro de Plano some sem `plan.read`.

**2. Placeholders:** os únicos `<N>`/`<PR>` são números de issue/PR que só existem depois de criar o card (Task 8 Step 4) — o plano diz onde obtê-los. Nenhum.

**3. Consistência de tipos:** `FiltroDoRelatorioDeAlunos` (campos `| undefined`, todos obrigatórios), `LinhaDoRelatorioDeAlunos`, `NomesDoFiltro`, `CabecalhoDaAcademia`, `DadosDoRelatorioImpresso`, `PaginaDoRelatorio` têm a mesma forma em todas as tasks; `lerFiltro` produz o que `ondeDoRelatorio`, `descreverFiltro` e o controller consomem; `listar(contexto, filtro, agora, janela)` tem a mesma ordem de argumentos no repositório, no caso de uso e nos testes; `carregar(contexto, gymUnitId)` idem. Nomes de chave do filtro (`gymUnitId`, `status`, `profile`, `planId`, `financeiro`) são idênticos na API, em `CHAVES_DO_FILTRO` e nos testes do painel.

**4. Review Focus:** cada uma das cinco linhas tem teste: (1) Task 3 "aluno sem CPF…" + Task 4 "aluno sem nada" + Task 7 "sem null"; (2) Task 3 + Task 6 (CSV neutralizado); (3) Task 5 (SVG/PNG corrompido/tipo estranho/chave alheia/objeto sumido); (4) Task 2 (`lerFiltro` lixo) + Task 4 (plano alheio, cursor inexistente) + Task 6 (HTTP lixo e `tenantId`); (5) Task 4 (teto, unit).

**Riscos que o plano não elimina** (vão para o PI): (a) a aba "Pagantes" da Cobrança lê no máximo 5.000 faturas (`LIMITE_DE_FATURAS_LIDAS`); o relatório filtra no banco sem esse teto, então em tenant com mais de 5.000 faturas pagas os dois números podem divergir — o teste de paridade usa massa pequena e não pega isso; (b) "pagante" é "tem alguma fatura paga na vida", não "está em dia": um inadimplente que já pagou antes é pagante **e** inadimplente nos dois lugares, que é o comportamento atual da Cobrança.
