# Redesign do Painel Financeiro (shadcn/ui) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar o conteúdo da página `/billing` (painel financeiro) usando componentes shadcn/ui já
instalados no admin-web, mantendo a paleta de tokens `--ah-*` do ArenaHub, com 3 campos de dado novos
(`GymUnit.capacidadeMaxima`, `planoMaisPopular` e `ocupacaoPorUnidade` no resumo financeiro) que alimentam
widgets do mockup que hoje não têm dado real.

**Architecture:** Backend primeiro (migration + campo + DTO), depois frontend (form de unidade, depois a página
`/billing` com 3 componentes de gráfico novos e locais, usando shadcn `Card`/`Badge`/`Button`/`Progress`).
CSS Modules da tela saem, substituídos por classes Tailwind — os tokens `--ah-*` continuam sendo a fonte de
cor via o mapeamento já existente em `globals.css`.

**Tech Stack:** NestJS + Prisma (backend), Next.js App Router + shadcn/ui + Tailwind v4 + Recharts (frontend),
Vitest + Testing Library, Zod.

**Spec:** `docs/superpowers/specs/2026-09-27-redesign-painel-financeiro-shadcn-design.md`

## Global Constraints

- `capacidadeMaxima` é `Int?` em `GymUnit`; `null` = sem limite. Widget de ocupação é **por unidade** do tenant
  autenticado (`ocupacaoPorUnidade`), nunca uma barra única somando o tenant inteiro — um tenant pode ter
  várias unidades (`Tenant.gymUnits: GymUnit[]`), e `alunosAtivos` no resumo hoje é agregado do tenant todo.
- `planoMaisPopular` é `{ nome: string; quantidade: number } | null`; `null` quando não há assinatura
  ativa/inadimplente no período.
- `ocupacaoPorUnidade` é `{ nomeDaUnidade: string; alunosAtivos: number; capacidadeMaxima: number | null }[]`;
  unidade sem `capacidadeMaxima` aparece na lista só com a contagem, sem barra de progresso.
- Zero query nova pesada para `planoMaisPopular` — reaproveita a query `assinaturas` já carregada no use case.
  `ocupacaoPorUnidade` PRECISA de uma query nova (agrupamento por `gymUnitId`), diferente de `planoMaisPopular`.
- `metaMensalMinor` e `projecaoFechamentoMinor` NÃO entram no DTO — são funções puras em `page.tsx`.
- Componentes shadcn instalados via `npx shadcn add <nome>` usam o `components.json` já configurado
  (`baseColor: neutral`, `cssVariables: true`) — cor final vem do mapeamento `--ah-*` já existente em
  `globals.css`, nunca hex literal (lint do projeto proíbe).
- `exactOptionalPropertyTypes: true` no tsconfig — todo campo opcional em assinatura de função usa
  `campo?: Tipo | undefined`, nunca só `campo?: Tipo`, e spread condicional em vez de passar `undefined`
  explícito para prop opcional de componente React.
- `tenantId` sempre via `TenantContext`, nunca do corpo da requisição (regra de arquitetura nº 2) — já é o
  padrão de todo repository tocado aqui, não muda.
- Migration gerada via `prisma migrate dev` (nunca SQL escrito à mão), pasta nomeada
  `<timestamp>_capacidade_maxima_da_unidade`, timestamp posterior a `20260927120500` (última migration
  existente).
- Money/valor monetário sempre inteiro em centavos (`Minor`), nunca float — já é o padrão de todo campo tocado.
- 3 componentes de gráfico novos ficam em `apps/admin-web/app/(protected)/billing/` (locais à tela) — não tocam
  `packages/ui/src/components/GraficoDeRosca.tsx`, `BarrasVerticais.tsx`, `SerieFinanceira.tsx` (continuam
  existindo, usados por esta mesma página até a Task 9, quando são substituídos por versões locais).
- Cada gráfico novo mantém tabela invisível (`aria-hidden` no wrapper visual + tabela real no DOM) para leitor
  de tela — mesmo padrão testado nos componentes que está substituindo.

## Review Focus

- **`capacidadeMaxima` negativo ou zero enviado no PATCH**: o schema Zod deve rejeitar `0` e negativos
  (`.positive()`), não silenciosamente aceitar "capacidade zero" como se fosse um valor válido de unidade sem
  vaga nenhuma.
- **`alunosAtivos > capacidadeMaxima`** (unidade lotada além do limite cadastrado, ex.: capacidade reduzida
  depois de já ter mais matrículas): a barra de progresso não pode estourar visualmente nem quebrar layout —
  precisa clampar em 100% e ainda comunicar que passou do limite (não é o mesmo estado visual que "73% ocupado").
- **`planoMaisPopular` com empate exato de contagem entre 2+ planos**: a spec define "ordem alfabética do nome"
  como desempate — sem teste, um `reduce`/`sort` ingênuo pode devolver resultado não-determinístico (ordem de
  iteração do Map/array) e o card mostraria planos diferentes em recarregamentos idênticos.
  Retorno de assinaturas onde múltiplos alunos têm o mesmo `planId` mas o plano foi excluído/inativado
  (`db.plan.findMany` não encontra o id): a função não pode quebrar nem devolver `nome: undefined` — precisa
  decidir um fallback explícito (ex.: excluir esse grupo da contagem, já que não há nome para mostrar).
- **Score Saudável com `variacaoRecebido = null`** (uma das 3 guardas ativas: dado insuficiente, período
  parcial, meses não consecutivos): o card não pode herdar acidentalmente o mesmo `data-tom` do badge de
  tendência sem testar o estado neutro isoladamente — são dois componentes de UI diferentes lendo a mesma
  variável, e é fácil um dos dois esquecer o caso `null`.
- **Widget de capacidade some quando `capacidadeMaxima` é `null`, mas continua ausente mesmo com
  `capacidadeMaxima = 0`**: `0` é um valor válido tecnicamente diferente de `null` no tipo, mas a spec não
  cobre esse caso — o schema do backend já recusa `0` no PATCH (`.positive()`), então o teste do frontend deve
  confirmar que o widget também não quebra se, por algum caminho (dado legado, seed), `capacidadeMaxima` chegar
  como `0` em vez de `null`.
- **`ocupacaoPorUnidade` com lista de tamanho 1 vs. tamanho N**: a decisão de mostrar "uma barra por unidade" foi
  tomada tarde no planejamento — o teste precisa cobrir explicitamente o caso de tenant com uma única unidade
  (deve renderizar idêntico a uma barra única, sem rótulo redundante de nome de unidade se isso ficar estranho
  visualmente) e o caso de 2+ unidades (cada uma com seu próprio nome e percentual, sem misturar contagens).

---

## Task 1: Migration + campo `capacidadeMaxima` no schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `GymUnit`, linha ~857-896)
- Create: `packages/database/prisma/migrations/<timestamp>_capacidade_maxima_da_unidade/migration.sql` (gerado,
  não escrito à mão)

**Interfaces:**
- Produces: `GymUnit.capacidadeMaxima: number | null` (campo Prisma, mapeado para coluna `capacidade_maxima`)

- [ ] **Step 1: Adicionar o campo ao schema**

Em `packages/database/prisma/schema.prisma`, dentro do `model GymUnit`, logo após o campo `status`:

```prisma
model GymUnit {
  id           String        @id @default(uuid()) @db.Uuid
  tenantId     String        @map("tenant_id") @db.Uuid
  code         String
  name         String
  timezone     String
  openingHours Json          @map("opening_hours")
  status       GymUnitStatus @default(ACTIVE)
  /// Capacidade máxima de alunos simultaneamente matriculados. `null` = sem
  /// limite definido; o painel financeiro só mostra o widget de ocupação
  /// quando este campo está preenchido.
  capacidadeMaxima Int?       @map("capacidade_maxima")
  createdAt    DateTime      @default(now()) @map("created_at")
  updatedAt    DateTime      @updatedAt @map("updated_at")
  // ... resto do model inalterado
}
```

- [ ] **Step 2: Gerar a migration**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name capacidade_maxima_da_unidade`

Expected: comando cria a pasta `packages/database/prisma/migrations/<timestamp>_capacidade_maxima_da_unidade/`
com um `migration.sql` contendo só `ALTER TABLE "gym_units" ADD COLUMN "capacidade_maxima" INTEGER;`, aplica no
banco de desenvolvimento local, e regenera o client Prisma sem erro.

- [ ] **Step 3: Conferir o SQL gerado**

Run: `cat packages/database/prisma/migrations/*_capacidade_maxima_da_unidade/migration.sql`

Expected: uma única linha `ALTER TABLE "gym_units" ADD COLUMN "capacidade_maxima" INTEGER;` — sem `NOT NULL`,
sem `DEFAULT`, sem tocar em outra tabela.

- [ ] **Step 4: Build do pacote database**

Run: `pnpm --filter @arenahub/database build`

Expected: build limpo, sem erro de tipo — `GymUnit` no client gerado agora tem `capacidadeMaxima: number | null`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat: adiciona capacidadeMaxima ao schema de GymUnit"
```

---

## Task 2: `capacidadeMaxima` no backend de unidades (controller + repository)

**Files:**
- Modify: `apps/api/src/modules/tenancy/gym-unit.controller.ts`
- Modify: `apps/api/src/modules/tenancy/gym-unit.repository.ts`
- Test: `apps/api/src/modules/tenancy/gym-unit.controller.spec.ts` (criar se não existir; confirmar primeiro)

**Interfaces:**
- Consumes: `GymUnit.capacidadeMaxima: number | null` (Task 1)
- Produces: `UnidadeDto.capacidadeMaxima: number | null`; `esquemaDeCriacao`/`esquemaDeAtualizacao` aceitam
  `capacidadeMaxima?: number` no corpo da requisição; `GymUnitRepository.criar()`/`atualizar()` aceitam
  `capacidadeMaxima?: number | undefined` em `dados`.

- [ ] **Step 1: Confirmar se já existe spec de integração do controller**

Run: `ls apps/api/src/modules/tenancy/gym-unit.controller.spec.ts 2>&1; ls apps/api/src/modules/tenancy/*.spec.ts 2>&1`

Expected: lista os specs existentes no módulo (a investigação prévia não achou spec de
`gym-unit.controller.ts`; confirmar aqui antes de decidir se cria um novo arquivo do zero ou estende um
existente).

- [ ] **Step 2: Escrever o teste falho (schema Zod aceita e valida o campo)**

Se não existir spec do controller, criar `apps/api/src/modules/tenancy/gym-unit.controller.spec.ts` testando só
a validação Zod dos schemas exportados (sem subir o Nest inteiro, seguindo o padrão de
`resumo-financeiro.spec.ts` de testar lógica pura isoladamente onde possível). Como `esquemaDeCriacao` e
`esquemaDeAtualizacao` não são exportados hoje, o teste efetivo é via requisição HTTP simulada — usar o padrão
de outro `*.controller.spec.ts` do módulo `tenancy` se existir; senão, testar via chamada direta ao método do
controller com um repository fake mínimo:

```ts
import { describe, expect, it, vi } from 'vitest';
import { GymUnitController } from './gym-unit.controller.js';

describe('GymUnitController — capacidadeMaxima', () => {
  it('rejeita capacidadeMaxima zero ou negativa na atualização', async () => {
    const repositorioFake = { atualizar: vi.fn() } as never;
    const contextoFake = { require: () => ({ tenantId: 'x', actorId: 'y' }) } as never;
    const controller = new GymUnitController(repositorioFake, contextoFake);

    await expect(
      controller.atualizar(
        'id-qualquer',
        { capacidadeMaxima: 0 },
        { correlationId: 'c1' } as never,
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha esperada**

Run: `pnpm --filter @arenahub/api test -- gym-unit.controller.spec.ts`

Expected: FAIL — `esquemaDeAtualizacao` ainda não tem `capacidadeMaxima`, então hoje o Zod `.strict()` rejeita
qualquer objeto com essa chave por chave desconhecida (não pelo motivo certo ainda, mas falha). Se o teste
passar sem alteração nenhuma, o teste está testando o comportamento errado — revisar antes de prosseguir.

- [ ] **Step 4: Adicionar o campo aos schemas Zod e ao DTO**

Em `apps/api/src/modules/tenancy/gym-unit.controller.ts`:

```ts
const esquemaDeCriacao = z
  .object({
    code: z.string().min(1).max(32),
    name: z.string().min(1).max(120),
    timezone: timezoneValido,
    openingHours: esquemaDeHorario,
    capacidadeMaxima: z.number().int().positive().optional(),
  })
  .strict();

const esquemaDeAtualizacao = z
  .object({
    name: z.string().min(1).max(120).optional(),
    timezone: timezoneValido.optional(),
    openingHours: esquemaDeHorario.optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    reason: z.string().trim().min(10).max(500).optional(),
    capacidadeMaxima: z.number().int().positive().optional(),
  })
  .strict()
  .refine((dados) => dados.status !== 'INACTIVE' || dados.reason !== undefined, {
    message: 'Inativar uma unidade exige motivo',
    path: ['reason'],
  });

interface UnidadeDto {
  id: string;
  code: string;
  name: string;
  timezone: string;
  openingHours: unknown;
  status: string;
  capacidadeMaxima: number | null;
}
```

E em `paraDto()`:

```ts
private paraDto(unidade: GymUnit): UnidadeDto {
  return {
    id: unidade.id,
    code: unidade.code,
    name: unidade.name,
    timezone: unidade.timezone,
    openingHours: unidade.openingHours,
    status: unidade.status,
    capacidadeMaxima: unidade.capacidadeMaxima,
  };
}
```

- [ ] **Step 5: Estender o repository**

Em `apps/api/src/modules/tenancy/gym-unit.repository.ts`, método `atualizar()`:

```ts
async atualizar(
  contexto: TenantContext,
  id: string,
  dados: {
    name?: string | undefined;
    timezone?: string | undefined;
    openingHours?: Prisma.InputJsonValue | undefined;
    status?: 'ACTIVE' | 'INACTIVE' | undefined;
    capacidadeMaxima?: number | undefined;
  },
  correlationId: string,
  motivo?: string,
): Promise<GymUnit | null> {
  // corpo inalterado — o filtro de undefined já genérico cobre o campo novo
```

E método `criar()`, adicionando `capacidadeMaxima?: number` ao tipo de `dados` (opcional, sem exigir no
cadastro).

- [ ] **Step 6: Rodar e confirmar passagem**

Run: `pnpm --filter @arenahub/api test -- gym-unit.controller.spec.ts`

Expected: PASS.

- [ ] **Step 7: Rodar typecheck do pacote**

Run: `pnpm --filter @arenahub/api typecheck`

Expected: sem erro — `exactOptionalPropertyTypes` satisfeito em toda assinatura tocada.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/tenancy/gym-unit.controller.ts apps/api/src/modules/tenancy/gym-unit.repository.ts apps/api/src/modules/tenancy/gym-unit.controller.spec.ts
git commit -m "feat: aceita capacidadeMaxima no cadastro e edicao de unidade"
```

---

## Task 3: `capacidadeMaxima` no formulário de unidade (frontend)

**Files:**
- Modify: `apps/admin-web/app/(protected)/units/editar-unidade.tsx`
- Modify: `apps/admin-web/app/(protected)/units/nova/formulario-de-unidade.tsx`
- Modify: `apps/admin-web/app/actions/units.ts`
- Test: arquivo de teste correspondente a `editar-unidade.tsx` e `formulario-de-unidade.tsx` (confirmar nomes
  exatos antes de editar — seguir o padrão `*.test.tsx` já usado no restante do diretório `units/`)

**Interfaces:**
- Consumes: `UnidadeDto.capacidadeMaxima: number | null` (Task 2)
- Produces: Server Actions `cadastrarUnidade`/`editarUnidade` enviam `capacidadeMaxima` no corpo do PATCH/POST
  quando preenchido.

- [ ] **Step 1: Localizar os testes existentes do formulário de edição/criação de unidade**

Run: `ls apps/admin-web/app/\(protected\)/units/*.test.tsx apps/admin-web/app/\(protected\)/units/nova/*.test.tsx apps/admin-web/app/actions/units.test.ts 2>&1`

Expected: lista os arquivos de teste reais (nomes exatos a confirmar antes do próximo step — a investigação
prévia não leu esses arquivos de teste).

- [ ] **Step 2: Escrever teste falho para o Server Action `editarUnidade` incluir `capacidadeMaxima`**

No arquivo de teste de `apps/admin-web/app/actions/units.ts` (localizado no Step 1), adicionar:

```ts
it('inclui capacidadeMaxima no corpo do PATCH quando preenchida', async () => {
  vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: { id: 'u1', name: 'Unidade X' }, cookiesDaApi: [] });

  const formulario = new FormData();
  formulario.set('unitId', '11111111-1111-1111-1111-111111111111');
  formulario.set('name', 'Unidade X');
  formulario.set('timezone', 'America/Sao_Paulo');
  formulario.set('capacidadeMaxima', '300');

  await editarUnidade({}, formulario);

  expect(chamarApi).toHaveBeenCalledWith(
    expect.stringContaining('/units/'),
    expect.objectContaining({
      corpo: expect.objectContaining({ capacidadeMaxima: 300 }),
    }),
  );
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/admin-web test -- units.test.ts`

Expected: FAIL — `editarUnidade` hoje só manda `{ name, timezone }` no corpo.

- [ ] **Step 4: Estender `esquemaDeEdicaoDeUnidade`/`esquemaDeUnidade` e as duas actions**

Em `apps/admin-web/app/actions/units.ts`:

```ts
const esquemaDeUnidade = z.object({
  code: z.string().trim().min(1, 'Informe o código da unidade').max(32, 'Código longo demais'),
  name: z.string().trim().min(1, 'Informe o nome da unidade').max(120, 'Nome longo demais'),
  timezone: z.string().min(1, 'Selecione o fuso horário da unidade'),
  capacidadeMaxima: z
    .string()
    .trim()
    .optional()
    .transform((valor) => (valor ? Number(valor) : undefined))
    .refine((valor) => valor === undefined || (Number.isInteger(valor) && valor > 0), {
      message: 'Capacidade deve ser um número inteiro maior que zero',
    }),
});

const esquemaDeEdicaoDeUnidade = z.object({
  unitId: z.string().uuid(),
  name: z.string().trim().min(1, 'Informe o nome da unidade').max(120, 'Nome longo demais'),
  timezone: z.string().min(1, 'Selecione o fuso horário da unidade'),
  capacidadeMaxima: z
    .string()
    .trim()
    .optional()
    .transform((valor) => (valor ? Number(valor) : undefined))
    .refine((valor) => valor === undefined || (Number.isInteger(valor) && valor > 0), {
      message: 'Capacidade deve ser um número inteiro maior que zero',
    }),
});
```

Em `editarUnidade`, incluir no corpo enviado só quando presente (mesmo padrão do comentário existente sobre
"campo ausente = não mexer"):

```ts
const valores = {
  name: texto(formulario, 'name'),
  timezone: texto(formulario, 'timezone'),
  capacidadeMaxima: texto(formulario, 'capacidadeMaxima'),
};

const validado = esquemaDeEdicaoDeUnidade.safeParse({ unitId, ...valores });

// ...

const resposta = await chamarApi<{ id: string; name: string }>(`/api/v1/units/${unitId}`, {
  metodo: 'PATCH',
  corpo: {
    name: validado.data.name,
    timezone: validado.data.timezone,
    ...(validado.data.capacidadeMaxima !== undefined
      ? { capacidadeMaxima: validado.data.capacidadeMaxima }
      : {}),
  },
});
```

Mesma lógica de spread condicional em `cadastrarUnidade`.

- [ ] **Step 5: Rodar e confirmar passagem**

Run: `pnpm --filter @arenahub/admin-web test -- units.test.ts`

Expected: PASS.

- [ ] **Step 6: Adicionar o campo aos dois formulários**

Em `apps/admin-web/app/(protected)/units/editar-unidade.tsx`, dentro de `.corpoDoDialogo`, após o `SelectField`
de fuso:

```tsx
<Field
  id={`edicao-capacidade-unidade-${unitId}`}
  name="capacidadeMaxima"
  label="Capacidade máxima (opcional)"
  type="number"
  min={1}
  defaultValue={estado.valores?.capacidadeMaxima ?? capacidadeMaxima ?? ''}
  data-testid="campo-edicao-capacidade-da-unidade"
/>
```

Adicionar `capacidadeMaxima: number | null` a `Props` (interface no topo do arquivo) e ao componente que chama
`<EditarUnidade>` (localizar o caller na listagem de unidades e passar o valor vindo do `UnidadeDto`). Mesmo
campo em `apps/admin-web/app/(protected)/units/nova/formulario-de-unidade.tsx`, sem `defaultValue`.

Atualizar `EstadoDaUnidade['valores']` em `units.ts` para incluir `capacidadeMaxima?: string`.

- [ ] **Step 7: Rodar suíte completa do diretório units**

Run: `pnpm --filter @arenahub/admin-web test -- units`

Expected: PASS, sem regressão nos testes existentes de cadastro/edição de unidade.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/app/actions/units.ts apps/admin-web/app/\(protected\)/units/
git commit -m "feat: campo de capacidade maxima no formulario de unidade"
```

---

## Task 4: `planoMaisPopular` no domínio puro do resumo financeiro

**Files:**
- Modify: `apps/api/src/modules/billing/domain/resumo-financeiro.ts`
- Test: `apps/api/src/modules/billing/domain/resumo-financeiro.spec.ts`

**Interfaces:**
- Produces: `planoMaisPopular(assinaturas: readonly { planId: string }[], nomesPorId: ReadonlyMap<string, string>): { nome: string; quantidade: number } | null`

- [ ] **Step 1: Escrever os testes falhos**

Em `apps/api/src/modules/billing/domain/resumo-financeiro.spec.ts`, adicionar:

```ts
import { planoMaisPopular } from './resumo-financeiro.js';

describe('planoMaisPopular', () => {
  it('retorna null sem nenhuma assinatura', () => {
    expect(planoMaisPopular([], new Map())).toBeNull();
  });

  it('retorna o plano com mais assinaturas', () => {
    const assinaturas = [{ planId: 'p1' }, { planId: 'p1' }, { planId: 'p2' }];
    const nomes = new Map([['p1', 'Mensal'], ['p2', 'Anual']]);

    expect(planoMaisPopular(assinaturas, nomes)).toEqual({ nome: 'Mensal', quantidade: 2 });
  });

  it('desempata por ordem alfabetica do nome', () => {
    const assinaturas = [{ planId: 'p1' }, { planId: 'p2' }];
    const nomes = new Map([['p1', 'Zebra'], ['p2', 'Alfa']]);

    expect(planoMaisPopular(assinaturas, nomes)).toEqual({ nome: 'Alfa', quantidade: 1 });
  });

  it('ignora assinaturas cujo plano nao tem nome conhecido', () => {
    const assinaturas = [{ planId: 'p1' }, { planId: 'p1' }, { planId: 'orfao' }, { planId: 'orfao' }, { planId: 'orfao' }];
    const nomes = new Map([['p1', 'Mensal']]);

    // 'orfao' tem mais ocorrencias mas nao tem nome -- e excluido do agrupamento
    expect(planoMaisPopular(assinaturas, nomes)).toEqual({ nome: 'Mensal', quantidade: 2 });
  });

  it('retorna null quando so ha assinaturas de planos sem nome conhecido', () => {
    const assinaturas = [{ planId: 'orfao' }];

    expect(planoMaisPopular(assinaturas, new Map())).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- resumo-financeiro.spec.ts`

Expected: FAIL — `planoMaisPopular` não existe ainda (erro de import).

- [ ] **Step 3: Implementar a função pura**

Em `apps/api/src/modules/billing/domain/resumo-financeiro.ts`, adicionar:

```ts
/**
 * O plano com mais assinaturas ativas/inadimplentes no periodo -- widget
 * "Plano mais popular" do card de ticket medio.
 *
 * ASSINATURA SEM NOME CONHECIDO E EXCLUIDA DO AGRUPAMENTO, nao vira "plano
 * sem nome": mostrar um id no lugar do nome seria pior que nao mostrar nada,
 * e um plano excluido/inativado nao e o que o gestor quer ver destacado.
 *
 * EMPATE RESOLVE POR ORDEM ALFABETICA DO NOME -- determinismo, nao juizo de
 * valor sobre qual plano "ganha": sem uma regra de desempate explicita, a
 * ordem de iteracao do Map dependeria da ordem de insercao, que dependeria
 * da ordem da consulta ao banco, que nao e garantida entre execucoes.
 */
export function planoMaisPopular(
  assinaturas: readonly { planId: string }[],
  nomesPorId: ReadonlyMap<string, string>,
): { nome: string; quantidade: number } | null {
  const contagem = new Map<string, number>();

  for (const assinatura of assinaturas) {
    if (!nomesPorId.has(assinatura.planId)) continue;

    contagem.set(assinatura.planId, (contagem.get(assinatura.planId) ?? 0) + 1);
  }

  const grupos = [...contagem.entries()]
    .map(([planId, quantidade]) => ({ nome: nomesPorId.get(planId) as string, quantidade }))
    .sort((a, b) => {
      if (a.quantidade !== b.quantidade) return b.quantidade - a.quantidade;
      return a.nome.localeCompare(b.nome);
    });

  return grupos[0] ?? null;
}
```

- [ ] **Step 4: Rodar e confirmar passagem**

Run: `pnpm --filter @arenahub/api test -- resumo-financeiro.spec.ts`

Expected: PASS, todos os testes do arquivo (novos e pré-existentes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/domain/resumo-financeiro.ts apps/api/src/modules/billing/domain/resumo-financeiro.spec.ts
git commit -m "feat: funcao pura planoMaisPopular no dominio do resumo financeiro"
```

---

## Task 5: `planoMaisPopular` no use case e DTO do resumo financeiro

**Files:**
- Modify: `apps/api/src/modules/billing/consultar-resumo-financeiro.use-case.ts`
- Modify: `apps/api/src/modules/billing/billing.controller.ts` (`ResumoFinanceiroDto`, `@ApiOkResponse`)
- Test: teste de integração existente do use case, se houver (a investigação prévia não achou nenhum — criar
  cobertura mínima se necessário, ou confirmar que o teste de domínio da Task 4 mais o teste de `page.tsx` na
  Task 9 já bastam, decisão registrada no ledger)

**Interfaces:**
- Consumes: `planoMaisPopular()` de `resumo-financeiro.ts` (Task 4)
- Produces: `ResumoFinanceiroDto.planoMaisPopular: { nome: string; quantidade: number } | null`

- [ ] **Step 1: Localizar o ponto exato de uso da query `assinaturas` e do retorno final**

Já mapeado: a query `assinaturas` está em `consultar-resumo-financeiro.use-case.ts` (dentro do `Promise.all`,
`this.db.subscription.findMany({ where: { ...doTenant, status: { in: ['ACTIVE', 'PAST_DUE'] } }, select: { status: true, planId: true, studentId: true } })`),
e o objeto de retorno final começa em `return { de: entrada.de, ... }`.

- [ ] **Step 2: Adicionar a busca de nomes de plano e montar `planoMaisPopular` no retorno**

Logo antes do `return` final, adicionar:

```ts
const idsDosPlanos = [...new Set(assinaturas.map((a) => a.planId))];
const planos = idsDosPlanos.length
  ? await this.db.plan.findMany({
      where: { id: { in: idsDosPlanos } },
      select: { id: true, name: true },
    })
  : [];
const nomesPorId = new Map(planos.map((p) => [p.id, p.name]));
```

(Confirmar o nome exato do campo `name` no model `Plan` do schema — se divergir, ajustar aqui.) E no objeto de
retorno, adicionar a chave:

```ts
planoMaisPopular: planoMaisPopular(assinaturas, nomesPorId),
```

Import `planoMaisPopular` de `./domain/resumo-financeiro.js` no topo do arquivo.

- [ ] **Step 3: Atualizar o DTO e o schema Swagger**

Em `apps/api/src/modules/billing/billing.controller.ts`, `ResumoFinanceiroDto`:

```ts
interface ResumoFinanceiroDto {
  // ... campos existentes
  planoMaisPopular: { nome: string; quantidade: number } | null;
}
```

E no `@ApiOkResponse` schema (dentro de `properties`):

```ts
planoMaisPopular: {
  type: 'object',
  nullable: true,
  properties: { nome: { type: 'string' }, quantidade: { type: 'integer' } },
},
```

- [ ] **Step 4: Rodar typecheck e testes do módulo billing**

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test -- billing`

Expected: sem erro de tipo; suíte de testes do módulo `billing` passa sem regressão (o `return` do use case
agora tem uma chave a mais, o que não quebra nenhum teste existente que não a verifica explicitamente).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/billing/consultar-resumo-financeiro.use-case.ts apps/api/src/modules/billing/billing.controller.ts
git commit -m "feat: expoe planoMaisPopular no resumo financeiro"
```

---

## Task 6: `ocupacaoPorUnidade` no domínio, use case e DTO do resumo financeiro

**Files:**
- Modify: `apps/api/src/modules/billing/domain/resumo-financeiro.ts`
- Modify: `apps/api/src/modules/billing/domain/resumo-financeiro.spec.ts`
- Modify: `apps/api/src/modules/billing/consultar-resumo-financeiro.use-case.ts`
- Modify: `apps/api/src/modules/billing/billing.controller.ts` (`ResumoFinanceiroDto`, `@ApiOkResponse`)

**Interfaces:**
- Consumes: `GymUnit.capacidadeMaxima` (Task 1)
- Produces: `ocupacaoPorUnidade(unidades: readonly { nome: string; capacidadeMaxima: number | null }[], alunosPorUnidade: ReadonlyMap<string, number>): { nomeDaUnidade: string; alunosAtivos: number; capacidadeMaxima: number | null }[]`
  (função pura); `ResumoFinanceiroDto.ocupacaoPorUnidade` (mesmo tipo, array)

- [ ] **Step 1: Escrever os testes falhos da função pura**

Em `apps/api/src/modules/billing/domain/resumo-financeiro.spec.ts`, adicionar:

```ts
import { ocupacaoPorUnidade } from './resumo-financeiro.js';

describe('ocupacaoPorUnidade', () => {
  it('retorna lista vazia sem unidades', () => {
    expect(ocupacaoPorUnidade([], new Map())).toEqual([]);
  });

  it('junta capacidade da unidade com a contagem de alunos ativos dela', () => {
    const unidades = [
      { id: 'u1', nome: 'Jardins', capacidadeMaxima: 300 },
      { id: 'u2', nome: 'Centro', capacidadeMaxima: null },
    ];
    const alunosPorUnidade = new Map([['u1', 224], ['u2', 80]]);

    expect(ocupacaoPorUnidade(unidades, alunosPorUnidade)).toEqual([
      { nomeDaUnidade: 'Jardins', alunosAtivos: 224, capacidadeMaxima: 300 },
      { nomeDaUnidade: 'Centro', alunosAtivos: 80, capacidadeMaxima: null },
    ]);
  });

  it('unidade sem aluno nenhum entra com contagem zero, nao e omitida', () => {
    const unidades = [{ id: 'u1', nome: 'Nova Unidade', capacidadeMaxima: 100 }];

    expect(ocupacaoPorUnidade(unidades, new Map())).toEqual([
      { nomeDaUnidade: 'Nova Unidade', alunosAtivos: 0, capacidadeMaxima: 100 },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/api test -- resumo-financeiro.spec.ts`

Expected: FAIL — `ocupacaoPorUnidade` não existe ainda.

- [ ] **Step 3: Implementar a função pura**

Em `apps/api/src/modules/billing/domain/resumo-financeiro.ts`, adicionar:

```ts
/**
 * Ocupacao de cada unidade do tenant -- widget "Capacidade instalada".
 *
 * POR UNIDADE, NUNCA UMA BARRA SO SOMANDO O TENANT: `alunosAtivos` no resumo
 * e do tenant inteiro, e um tenant pode ter varias unidades
 * (`Tenant.gymUnits`). Comparar o total do tenant contra a capacidade de UMA
 * unidade seria uma comparacao sem sentido assim que existisse uma segunda
 * unidade -- achado durante o planejamento desta fatia.
 *
 * UNIDADE SEM ALUNO NENHUM ENTRA COM ZERO, nao e omitida: unidade nova sem
 * matricula ainda e informacao real (zero ocupada), nao ausencia de dado.
 */
export function ocupacaoPorUnidade(
  unidades: readonly { id: string; nome: string; capacidadeMaxima: number | null }[],
  alunosAtivosPorUnidade: ReadonlyMap<string, number>,
): readonly { nomeDaUnidade: string; alunosAtivos: number; capacidadeMaxima: number | null }[] {
  return unidades.map((unidade) => ({
    nomeDaUnidade: unidade.nome,
    alunosAtivos: alunosAtivosPorUnidade.get(unidade.id) ?? 0,
    capacidadeMaxima: unidade.capacidadeMaxima,
  }));
}
```

- [ ] **Step 4: Rodar e confirmar passagem**

Run: `pnpm --filter @arenahub/api test -- resumo-financeiro.spec.ts`

Expected: PASS, todos os testes do arquivo.

- [ ] **Step 5: Adicionar a query de unidades e a contagem por unidade no use case**

Em `consultar-resumo-financeiro.use-case.ts`, dentro do mesmo `Promise.all` que já carrega `assinaturas`
(reaproveitando o padrão do arquivo de paralelizar consultas independentes), adicionar:

```ts
this.db.gymUnit.findMany({
  where: doTenant,
  select: { id: true, name: true, capacidadeMaxima: true },
}),
```

E, junto da consulta que já lista `alunosAtivosAgora` (`subscription.findMany` com `distinct: ['studentId']`),
adicionar `gymUnitId: true` ao `select` dessa mesma query (evita nova consulta — só amplia o `select` da que já
existe) para poder agrupar por unidade:

```ts
const alunosAtivosPorUnidade = new Map<string, number>();
for (const aluno of alunosAtivosAgora) {
  if (!aluno.gymUnitId) continue;
  alunosAtivosPorUnidade.set(aluno.gymUnitId, (alunosAtivosPorUnidade.get(aluno.gymUnitId) ?? 0) + 1);
}
```

(Confirmar que `Student`/`Subscription` carrega `gymUnitId` — se a relação de unidade estiver em `Student` e
não em `Subscription`, ajustar o `select`/join conforme o schema real antes de implementar.) No objeto de
retorno final, adicionar:

```ts
ocupacaoPorUnidade: ocupacaoPorUnidade(unidadesDoTenant, alunosAtivosPorUnidade),
```

Import `ocupacaoPorUnidade` de `./domain/resumo-financeiro.js`.

- [ ] **Step 6: Atualizar o DTO e o schema Swagger**

Em `billing.controller.ts`, `ResumoFinanceiroDto`:

```ts
ocupacaoPorUnidade: { nomeDaUnidade: string; alunosAtivos: number; capacidadeMaxima: number | null }[];
```

E no `@ApiOkResponse`:

```ts
ocupacaoPorUnidade: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      nomeDaUnidade: { type: 'string' },
      alunosAtivos: { type: 'integer' },
      capacidadeMaxima: { type: 'integer', nullable: true },
    },
  },
},
```

- [ ] **Step 7: Rodar typecheck e testes do módulo billing**

Run: `pnpm --filter @arenahub/api typecheck && pnpm --filter @arenahub/api test -- billing`

Expected: sem erro de tipo; suíte passa sem regressão.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/billing/
git commit -m "feat: expoe ocupacao por unidade no resumo financeiro"
```

---

## Task 7: Instalar componentes shadcn/ui necessários

**Files:**
- Create: `apps/admin-web/components/ui/card.tsx`, `badge.tsx`, `button.tsx`, `progress.tsx` (gerados pelo CLI)
- Modify: `apps/admin-web/components.json` (se o CLI atualizar automaticamente)

**Interfaces:**
- Produces: `Card`, `CardHeader`, `CardContent`, `Badge`, `Button`, `Progress` importáveis de
  `@/components/ui/*`.

- [ ] **Step 1: Instalar os componentes via CLI**

Run (a partir de `apps/admin-web/`): `npx shadcn@latest add card badge button progress`

Expected: cria `components/ui/card.tsx`, `components/ui/badge.tsx`, `components/ui/button.tsx`,
`components/ui/progress.tsx`. O `Button` já existe como componente próprio do `@arenahub/ui` — confirmar que o
shadcn `Button` instalado não colide de nome/import com o `Button` de `@arenahub/ui` já usado noutros pontos da
tela (aliasar a importação se necessário, ex. `import { Button as BotaoShadcn } from '@/components/ui/button'`).

- [ ] **Step 2: Conferir que os componentes gerados não introduzem hex literal**

Run: `grep -n "#[0-9a-fA-F]\{3,6\}" apps/admin-web/components/ui/*.tsx`

Expected: nenhum resultado — os componentes gerados usam só classes Tailwind (`bg-primary`, `text-foreground`
etc.), que resolvem para os tokens `--ah-*` via o mapeamento já existente em `globals.css`.

- [ ] **Step 3: Rodar lint**

Run: `pnpm --filter @arenahub/admin-web lint`

Expected: sem erro novo introduzido pelos arquivos gerados (o CLI shadcn normalmente já gera código conforme o
ESLint do projeto, mas confirmar).

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/components.json apps/admin-web/components/ui/
git commit -m "chore: instala componentes shadcn/ui Card, Badge, Button, Progress"
```

---

## Task 8: 3 componentes de gráfico locais à tela `/billing`

**Files:**
- Create: `apps/admin-web/app/(protected)/billing/_graficos/evolucao-de-receita.tsx`
- Create: `apps/admin-web/app/(protected)/billing/_graficos/composicao-por-metodo.tsx`
- Create: `apps/admin-web/app/(protected)/billing/_graficos/aging-da-divida.tsx`
- Test: `apps/admin-web/app/(protected)/billing/_graficos/evolucao-de-receita.test.tsx`,
  `composicao-por-metodo.test.tsx`, `aging-da-divida.test.tsx`

**Interfaces:**
- Consumes: nenhuma (componentes puros de apresentação, recebem props já formatadas pela página)
- Produces:
  - `EvolucaoDeReceita({ pontos: { rotulo: string; faturadoMinor: number; recebidoMinor: number }[]; testId?: string })`
  - `ComposicaoPorMetodo({ segmentos: { rotulo: string; valorMinor: number; percentual: number | null; tokenDeCor: string }[]; testId?: string })`
  - `AgingDaDivida({ faixas: { rotulo: string; valorMinor: number; tokenDeCor: string }[]; testId?: string })`

- [ ] **Step 1: Escrever teste falho para `AgingDaDivida` (caso mais simples, edge case de coluna zerada)**

```tsx
// aging-da-divida.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgingDaDivida } from './aging-da-divida';

describe('AgingDaDivida', () => {
  it('nao desenha barra para faixa com valor zero', () => {
    render(
      <AgingDaDivida
        testId="aging-teste"
        faixas={[
          { rotulo: 'Até 15 dias', valorMinor: 10_000, tokenDeCor: '--ah-state-warning' },
          { rotulo: '16 a 30 dias', valorMinor: 0, tokenDeCor: '--ah-state-risk' },
        ]}
      />,
    );

    const linhas = screen.getAllByRole('row');
    // cabecalho + so a faixa com valor > 0 na tabela visivel de apoio
    expect(screen.queryByText('16 a 30 dias')).not.toBeInTheDocument();
  });

  it('publica tabela invisivel para leitor de tela com todas as faixas', () => {
    render(
      <AgingDaDivida
        testId="aging-teste"
        faixas={[{ rotulo: 'Até 15 dias', valorMinor: 10_000, tokenDeCor: '--ah-state-warning' }]}
      />,
    );

    expect(screen.getByTestId('aging-teste')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/admin-web test -- aging-da-divida.test.tsx`

Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `AgingDaDivida`**

Barras horizontais (Recharts `BarChart layout="vertical"`), reaproveitando o padrão de resolução de cor por
token via `getComputedStyle` (mesmo hook `useCoresDosTokens` já implementado em `@arenahub/ui` — copiar a
implementação local, já que a Task cria componente independente, não reexporta):

```tsx
'use client';

import { useMemo, useRef } from 'react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

interface FaixaDeAging {
  readonly rotulo: string;
  readonly valorMinor: number;
  readonly tokenDeCor: string;
}

interface Props {
  readonly faixas: readonly FaixaDeAging[];
  readonly testId?: string;
}

function useCoresDosTokens(tokens: readonly string[]): readonly string[] {
  const ref = useRef<HTMLDivElement>(null);
  return useMemo(() => {
    if (typeof window === 'undefined' || !ref.current) return tokens.map(() => '#999999');
    const estilo = getComputedStyle(ref.current);
    return tokens.map((token) => estilo.getPropertyValue(token).trim() || '#999999');
  }, [tokens]);
}

export function AgingDaDivida({ faixas, testId }: Props) {
  const comValor = faixas.filter((f) => f.valorMinor > 0);
  const cores = useCoresDosTokens(comValor.map((f) => f.tokenDeCor));

  if (comValor.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma dívida em aberto no período.</p>;
  }

  const dados = comValor.map((f, i) => ({ rotulo: f.rotulo, valor: f.valorMinor / 100, cor: cores[i] }));

  return (
    <div>
      <div aria-hidden="true" {...(testId ? { 'data-testid': testId } : {})} className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="rotulo" width={104} />
            <Bar dataKey="valor" radius={4}>
              {dados.map((d) => (
                <Bar key={d.rotulo} fill={d.cor} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Valor vencido por faixa de tempo</caption>
        <tbody>
          {comValor.map((f) => (
            <tr key={f.rotulo}>
              <td>{f.rotulo}</td>
              <td>{(f.valorMinor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

(Ajustar a API exata do `Bar`/`Cell` do Recharts conforme o padrão real já usado em
`packages/ui/src/components/BarrasVerticais.tsx` — consultar esse arquivo como referência de como o projeto já
resolve cor-por-barra com Recharts antes de finalizar esta implementação, já que a sintaxe de `Cell` dentro de
`Bar` costuma ser necessária para cor por item.)

- [ ] **Step 4: Rodar e confirmar passagem**

Run: `pnpm --filter @arenahub/admin-web test -- aging-da-divida.test.tsx`

Expected: PASS.

- [ ] **Step 5: Repetir Steps 1-4 para `ComposicaoPorMetodo` (donut com legenda lateral)**

Teste cobrindo: segmento com `percentual: null` (quando `resumo.recebidoMinor === 0`, mas o card já trata esse
caso com `EmptyState` antes de renderizar o componente — então dentro do componente `percentual` só é `null`
se o chamador passar assim, o teste cobre que o componente não quebra formatando `null`), e segmento com
`valorMinor: 0` não aparecendo na legenda (mesmo critério de `AgingDaDivida`).

- [ ] **Step 6: Repetir Steps 1-4 para `EvolucaoDeReceita` (linha/área com gradiente)**

Teste cobrindo: 1 ponto (não desenha linha de tendência, mesmo aviso textual que a implementação anterior já
tinha), gradiente aplicado só à área de `recebidoMinor` (usar `<defs><linearGradient>` do Recharts,
conferindo contra `packages/ui/src/components/SerieFinanceira.tsx` como referência de como o projeto já
resolve isso).

- [ ] **Step 7: Rodar suíte completa dos 3 componentes**

Run: `pnpm --filter @arenahub/admin-web test -- _graficos`

Expected: PASS, todos os testes dos 3 arquivos.

- [ ] **Step 8: Commit**

```bash
git add "apps/admin-web/app/(protected)/billing/_graficos/"
git commit -m "feat: 3 componentes de grafico locais a tela de billing (shadcn)"
```

---

## Task 9: Reescrever `page.tsx` com layout shadcn/ui

**Files:**
- Modify: `apps/admin-web/app/(protected)/billing/page.tsx`
- Delete: `apps/admin-web/app/(protected)/billing/summary.module.css`
- Modify: `apps/admin-web/app/(protected)/billing/page.test.tsx`

**Interfaces:**
- Consumes: `ResumoFinanceiroDto.planoMaisPopular` (Task 5), `ResumoFinanceiroDto.ocupacaoPorUnidade` (Task 6,
  já vem pronto no mesmo fetch que a página já faz — sem chamada nova), `AgingDaDivida`,
  `ComposicaoPorMetodo`, `EvolucaoDeReceita` (Task 8), `Card`/`Badge`/`Button`/`Progress` (Task 7)
- Produces: funções puras `metaMensalMinor(resumo)`, `projecaoFechamentoMinor(resumo)`,
  `capacidadePercentual(alunosAtivos, capacidadeMaxima)` (clampada em 100), `scoreDoNegocio(variacaoRecebido)`
  → `'saudavel' | 'atencao' | 'neutro'`

- [ ] **Step 1: Escrever testes falhos para as novas funções puras e para os novos data-testid da página**

Adicionar a `page.test.tsx` (mantendo os testes existentes intactos):

```tsx
describe('capacidade instalada por unidade', () => {
  it('nao mostra a secao quando nenhuma unidade tem capacidadeMaxima definida', async () => {
    await renderizar({ ...RESUMO, ocupacaoPorUnidade: [{ nomeDaUnidade: 'Jardins', alunosAtivos: 224, capacidadeMaxima: null }] });
    expect(screen.queryByTestId('ocupacao-por-unidade')).not.toBeInTheDocument();
  });

  it('mostra uma barra por unidade com capacidadeMaxima definida', async () => {
    await renderizar({
      ...RESUMO,
      ocupacaoPorUnidade: [
        { nomeDaUnidade: 'Jardins', alunosAtivos: 224, capacidadeMaxima: 300 },
        { nomeDaUnidade: 'Centro', alunosAtivos: 80, capacidadeMaxima: null },
      ],
    });

    expect(screen.getByText('Jardins')).toBeInTheDocument();
    expect(screen.getByText(/74%|75%/)).toBeInTheDocument(); // 224/300 arredondado
    // unidade sem capacidadeMaxima aparece so com a contagem, sem barra
    expect(screen.getByText('Centro')).toBeInTheDocument();
  });

  it('clampa a barra em 100% quando alunosAtivos excede capacidadeMaxima', async () => {
    await renderizar({
      ...RESUMO,
      ocupacaoPorUnidade: [{ nomeDaUnidade: 'Jardins', alunosAtivos: 350, capacidadeMaxima: 300 }],
    });

    expect(screen.getByTestId('ocupacao-por-unidade')).toHaveTextContent('100%');
    expect(screen.getByTestId('ocupacao-por-unidade')).not.toHaveTextContent('116%');
  });

  it('nao mostra a secao inteira quando ocupacaoPorUnidade vem vazio', async () => {
    await renderizar({ ...RESUMO, ocupacaoPorUnidade: [] });
    expect(screen.queryByTestId('ocupacao-por-unidade')).not.toBeInTheDocument();
  });
});

describe('score saudavel', () => {
  it('mostra Sem dado suficiente quando variacaoRecebido e null (serie curta)', async () => {
    await renderizar({ ...RESUMO, serie: { pontos: RESUMO.serie.pontos.slice(0, 1), suficienteParaLinha: false } });
    expect(screen.getByTestId('score-do-negocio')).toHaveTextContent(/sem dado suficiente/i);
  });

  it('mostra Saudavel quando a receita cresceu vs o mes anterior', async () => {
    await renderizar();
    expect(screen.getByTestId('score-do-negocio')).toHaveTextContent(/saud/i);
  });
});

describe('plano mais popular', () => {
  it('mostra o nome do plano quando presente no resumo', async () => {
    await renderizar({ ...RESUMO, planoMaisPopular: { nome: 'Plano Anual', quantidade: 5 } });
    expect(screen.getByText(/plano anual/i)).toBeInTheDocument();
  });

  it('nao mostra a linha quando planoMaisPopular e null', async () => {
    await renderizar({ ...RESUMO, planoMaisPopular: null });
    expect(screen.queryByTestId('plano-mais-popular')).not.toBeInTheDocument();
  });
});
```

(Fixture `RESUMO` em `page.test.tsx` precisa ganhar `planoMaisPopular: null` e `ocupacaoPorUnidade: []` por
padrão para bater com o tipo novo do DTO — ajustar no mesmo commit.)

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @arenahub/admin-web test -- page.test.tsx`

Expected: FAIL nos testes novos — `ocupacao-por-unidade`, `score-do-negocio` etc. não existem ainda na página.

- [ ] **Step 3: Implementar as funções puras**

Em `page.tsx`, junto de `mesSeguinte`:

```ts
function metaMensalMinor(resumo: Resumo): number {
  return resumo.receitaEsperadaMinor;
}

function projecaoFechamentoMinor(resumo: Resumo): number {
  return resumo.recebidoMinor + resumo.aReceberMinor;
}

/** Clampada em 100 -- unidade que passou da capacidade cadastrada mostra barra cheia, nao estourada. */
function capacidadePercentual(alunosAtivos: number, capacidadeMaxima: number): number {
  return Math.min(Math.round((alunosAtivos / capacidadeMaxima) * 100), 100);
}

/**
 * So RECEITA decide o score -- novosAlunos/cancelamentos ficam so como
 * contexto no card. Mesmas 3 guardas do badge de tendencia do Recebido:
 * dado insuficiente, periodo parcial ou meses nao consecutivos viram
 * 'neutro', nunca um veredito que a propria tela contradiz ao lado.
 */
function scoreDoNegocio(variacaoRecebido: number | null): 'saudavel' | 'atencao' | 'neutro' {
  if (variacaoRecebido === null) return 'neutro';
  return variacaoRecebido > 0 ? 'saudavel' : 'atencao';
}
```

Adicionar `ocupacaoPorUnidade: { nomeDaUnidade: string; alunosAtivos: number; capacidadeMaxima: number | null }[]`
e `planoMaisPopular: { nome: string; quantidade: number } | null` à interface `Resumo`.

- [ ] **Step 4: Montar o novo JSX consumindo `ocupacaoPorUnidade` direto do resumo**

Sem fetch novo — `ocupacaoPorUnidade` já vem no mesmo `GET /api/v1/billing/summary` que a página já chama
(Task 6 adicionou o campo ao DTO). Dentro do hero card "Assinaturas vigentes", renderizar a lista: se
`resumo.ocupacaoPorUnidade` tiver ao menos uma unidade com `capacidadeMaxima` não nula, mostrar a seção com
`data-testid="ocupacao-por-unidade"`, uma linha por unidade (nome + `<Progress>` clampado via
`capacidadePercentual` quando `capacidadeMaxima` existe, ou só a contagem quando é `null`). Se nenhuma unidade
da lista tiver `capacidadeMaxima`, ou a lista vier vazia, a seção inteira não renderiza.

Reescrever o corpo da página substituindo `estilos['...']` por classes Tailwind e os componentes
`GraficoDeRosca`/`BarrasVerticais`/`SerieFinanceira` pelos novos `ComposicaoPorMetodo`/`AgingDaDivida`/
`EvolucaoDeReceita`, dentro de `Card`/`CardHeader`/`CardContent` do shadcn. Hero card "Recebido" ganha
`<Progress value={recebidoMinor / metaMensalMinor(resumo) * 100} />` clampado da mesma forma. Card "Saúde do
negócio" ganha `<Badge>` de score com `data-testid="score-do-negocio"`. Botão "Acessar fila de cobrança"
linkando `/billing/delinquency`.

- [ ] **Step 5: Remover `summary.module.css` e o import correspondente**

Deletar o arquivo; remover `import estilos from './summary.module.css'` de `page.tsx`.

- [ ] **Step 6: Rodar e confirmar passagem**

Run: `pnpm --filter @arenahub/admin-web test -- page.test.tsx`

Expected: PASS — todos os testes, novos e pré-existentes (os pré-existentes continuam válidos porque os
`data-testid` de KPI já existentes não mudam de nome, só de classe CSS ao redor).

- [ ] **Step 7: Rodar typecheck e lint**

Run: `pnpm --filter @arenahub/admin-web typecheck && pnpm --filter @arenahub/admin-web lint`

Expected: sem erro.

- [ ] **Step 8: Commit**

```bash
git add "apps/admin-web/app/(protected)/billing/page.tsx" "apps/admin-web/app/(protected)/billing/page.test.tsx"
git rm "apps/admin-web/app/(protected)/billing/summary.module.css"
git commit -m "feat: reescreve o painel financeiro com componentes shadcn/ui"
```

---

## Task 10: Verificação visual ao vivo

**Files:** nenhum (só verificação manual/E2E)

- [ ] **Step 1: Subir a bancada Docker isolada (se não estiver rodando) e a API/admin-web**

Seguir o padrão já usado nesta mesma worktree em sessão anterior: `docker compose -p <nome-do-projeto>` com
`-p` explícito para nunca colidir com a bancada principal.

- [ ] **Step 2: Abrir `/billing` no navegador e conferir visualmente**

Confirmar: hero cards com barra de progresso e badge de tendência renderizando sem overflow; card de
capacidade ausente quando a unidade de teste não tem `capacidadeMaxima`; os 3 gráficos novos desenhando sem
erro de console; botão "Acessar fila de cobrança" navegando para `/billing/delinquency`; tema claro legível
(contraste de texto sobre os cards shadcn).

- [ ] **Step 3: Testar preenchendo `capacidadeMaxima` numa unidade via `/units`**

Editar uma unidade de teste com capacidade definida, voltar a `/billing`, confirmar que o widget aparece com o
percentual correto.

---

## Task 11: Rodar a suíte completa e preparar para revisão final

**Files:** nenhum

- [ ] **Step 1: Rodar os 5 comandos raiz do projeto**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`

Expected: todos verdes, sem regressão em módulo não tocado por este plano.

- [ ] **Step 2: Conferir cobertura dos arquivos novos**

Run: `pnpm --filter @arenahub/admin-web test -- --coverage _graficos` e equivalente para
`resumo-financeiro.spec.ts` no `@arenahub/api`.

Expected: cobertura das funções puras novas (`planoMaisPopular`, `ocupacaoPorUnidade`, `metaMensalMinor`,
`projecaoFechamentoMinor`, `capacidadePercentual`, `scoreDoNegocio`) e dos 3 componentes de gráfico acima do
piso do projeto (`docs/TESTING.md`).
