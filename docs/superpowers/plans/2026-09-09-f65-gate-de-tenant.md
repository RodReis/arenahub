# F65 — Gate de tenant no motor de decisão · Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fatura da plataforma vencida e carência esgotada fecham a catraca da academia inteira com razão `TENANT_SUSPENDED`, sem tocar em nenhum Entitlement, e o dono é avisado antes.

**Architecture:** o motor puro (`packages/access-policy`) ganha uma checagem antes de todas as outras; o `gateActive` é derivado de `Tenant.status === 'SUSPENDED'` na projeção, nunca coluna própria. Um job diário suspende quem passou da carência, respeitando uma chave por tenant e uma janela de 6h locais. Três telas mostram a contagem regressiva a partir de um cálculo puro único.

**Tech Stack:** TypeScript estrito · NestJS · Prisma/PostgreSQL · Jest (api, packages) · Vitest + Testing Library (admin-web) · `@nestjs/schedule`.

**Spec:** [`docs/superpowers/specs/2026-09-09-f65-gate-de-tenant-design.md`](../specs/2026-09-09-f65-gate-de-tenant-design.md)

## Global Constraints

- **Idioma:** documentação, commits e comunicação em PT-BR; código e identificadores em inglês. Comentário de código **sem acento** (o repositório inteiro é assim).
- **Regra de arquitetura nº 1 preservada:** o gate não consulta `Invoice` nem `Subscription` **do aluno**. É o contratante, outra cadeia (ADR-053 §3).
- **Regra de arquitetura nº 5:** mudança de estado e sua auditoria commitam na mesma transação.
- **`INACTIVE` nunca fecha a catraca.** Só `SUSPENDED` (ADR-052 §4 × ADR-053).
- **Dinheiro é inteiro na menor unidade** (`totalMinor`). Nunca `float`.
- **Nada de `any` implícito**; `unknown` antes de validar dado externo.
- **Erro de domínio tem código estável**; resposta HTTP em `application/problem+json`.
- **Toast, nunca `alert`**, para info/warn/error no painel.
- **`POLICY_VERSION` vai para `2.0.0`** — major, porque o desfecho muda.
- **Gate local antes do push:** `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:integration` — e `--force` no turbo antes do PR, porque cache verde esconde lint vermelho.
- **PR usa `refs #288`, nunca `closes`** — fechar a issue forjaria o aceite do PI.

---

## Estado inicial: o que já está no branch

O branch `f65-gate-de-tenant-no-motor` **já tem** parte da Task 1 e da Task 2 aplicada, de antes do brainstorming. O executor deve **conferir antes de escrever**, e tratar a tarefa como concluída se o conteúdo bater:

- `packages/access-policy/src/types.ts` — razão `TENANT_SUSPENDED`, campo `tenant.gateActive`, `POLICY_VERSION = '2.0.0'`
- `packages/access-policy/src/evaluate-access.ts` — a checagem 0
- `packages/database/prisma/schema.prisma` — `TENANT_SUSPENDED` no enum `AccessReason`
- `apps/api/src/modules/access/access-reason.spec.ts` — lista com oito razões de DENY
- `apps/api/src/modules/access/access-projection.repository.ts` — leitura do tenant
- `apps/api/src/modules/access/manual-override.use-case.ts` — recusa quando suspenso

**Falta em todas elas o teste.** As Tasks 1 a 4 escrevem o teste primeiro; onde a implementação já existir, o passo "implementar" vira conferência, mas o passo "rodar e ver falhar" **não pode ser pulado** — ele é o que prova que o teste alcança a guarda. Reverta a implementação temporariamente (`git stash`) para ver o vermelho, e restaure.

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `packages/access-policy/src/types.ts` | razão, campo de entrada, versão da política | 1 |
| `packages/access-policy/src/evaluate-access.ts` | a checagem 0, antes de tudo | 1 |
| `packages/access-policy/src/evaluate-access.spec.ts` | prova de ordem e de reversibilidade | 1 |
| `packages/access-policy/src/evaluate-access.property.spec.ts` | gerador ganha `tenant` | 1 |
| `packages/database/prisma/schema.prisma` | enum + coluna `autoSuspend` | 1, 5 |
| `apps/api/src/modules/access/access-reason.spec.ts` | guarda de divergência de enum | 1 |
| `apps/api/src/modules/access/access-projection.repository.ts` | deriva `gateActive` do status | 2 |
| `apps/api/src/modules/access/manual-override.use-case.ts` | fecha a porta lateral da recepção | 3 |
| `apps/api/test/integration/access-gate-de-tenant.int-spec.ts` | Entitlements intactos, gate sobe e desce | 4 |
| `apps/api/src/modules/platform/domain/carencia.ts` | **cálculo puro** de dias restantes e janela | 6 |
| `apps/api/src/modules/platform/domain/carencia.spec.ts` | unitário do cálculo | 6 |
| `apps/api/src/modules/platform/suspender-tenant.use-case.ts` | suspende e levanta o gate, com auditoria | 7 |
| `apps/api/src/modules/platform/platform-invoice-scheduler.service.ts` | terceiro passo do ciclo diário | 7 |
| `apps/api/src/modules/platform/platform-invoice.use-case.ts` | pagamento levanta o gate | 8 |
| `apps/api/src/modules/auth/auth.controller.ts` | `/auth/me` carrega a cobrança | 9 |
| `apps/admin-web/app/(protected)/layout.tsx` | faixa no painel do dono | 9 |
| `apps/admin-web/app/(platform)/platform/page.tsx` | coluna na grid do Super Admin | 10 |
| `apps/admin-web/app/(protected)/billing/...` | contagem na linha da fatura | 10 |
| `packages/database/prisma/migrations/.../migration.sql` | enum + coluna | 11 |
| `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/TESTS.md` | entrega registrada | 12 |

---

## Task 1: A razão e a checagem no motor puro

**Files:**
- Modify: `packages/access-policy/src/types.ts`
- Modify: `packages/access-policy/src/evaluate-access.ts`
- Modify: `packages/database/prisma/schema.prisma` (enum `AccessReason`)
- Test: `packages/access-policy/src/evaluate-access.spec.ts`
- Test: `packages/access-policy/src/evaluate-access.property.spec.ts`
- Test: `apps/api/src/modules/access/access-reason.spec.ts`

**Interfaces:**
- Produces: `DENY_REASON.TENANT_SUSPENDED` (string `'TENANT_SUSPENDED'`); `AccessPolicyInput.tenant: { readonly gateActive: boolean }`; `POLICY_VERSION = '2.0.0'`.

- [ ] **Step 1: Escrever os testes que falham**

Em `packages/access-policy/src/evaluate-access.spec.ts`, o helper `entrada(...)` (linha ~46) precisa ganhar `tenant: { gateActive: false }` no padrão. Depois, acrescentar o bloco:

```typescript
describe('F65 (ADR-053) -- gate do contratante', () => {
  it('nega aluno perfeitamente regular quando o gate esta ativo', () => {
    const resultado = evaluateAccess(entrada({ tenant: { gateActive: true } }));

    expect(resultado).toEqual({
      outcome: 'DENY',
      reason: 'TENANT_SUSPENDED',
      policyVersion: POLICY_VERSION,
    });
  });

  it('o gate PRECEDE o bloqueio administrativo', () => {
    // Os dois ativos ao mesmo tempo. Se a ordem inverter, a recepcao le
    // "bloqueio administrativo" e vai mexer no cadastro do aluno -- quando o
    // que ha e a academia suspensa, que so o dono resolve pagando.
    const resultado = evaluateAccess(
      entrada({ tenant: { gateActive: true }, adminBlock: { active: true } }),
    );

    expect(resultado.reason).toBe('TENANT_SUSPENDED');
  });

  it('o gate PRECEDE o estado do aluno', () => {
    const resultado = evaluateAccess(
      entrada({ tenant: { gateActive: true }, student: { status: 'BLOCKED' } }),
    );

    expect(resultado.reason).toBe('TENANT_SUSPENDED');
  });

  it('levantado o gate, a MESMA entrada volta a permitir', () => {
    // A reversibilidade e o coracao do ADR-053 §2: o gate nao revoga nada,
    // entao a mesma entrada com o gate baixo tem de devolver ALLOW sem que
    // ninguem seja recadastrado.
    const comGate = evaluateAccess(entrada({ tenant: { gateActive: true } }));
    const semGate = evaluateAccess(entrada({ tenant: { gateActive: false } }));

    expect(comGate.outcome).toBe('DENY');
    expect(semGate.outcome).toBe('ALLOW');
  });
});
```

Em `packages/access-policy/src/evaluate-access.property.spec.ts`, o gerador (linha ~69) ganha `tenant: fc.record({ gateActive: fc.constant(false) })`, e um novo invariante:

```typescript
it('gate ativo nega SEMPRE, qualquer que seja o resto da entrada', () => {
  fc.assert(
    fc.property(geradorDeEntrada, (entrada) => {
      const resultado = evaluateAccess({ ...entrada, tenant: { gateActive: true } });

      expect(resultado.outcome).toBe('DENY');
      expect(resultado.reason).toBe('TENANT_SUSPENDED');
    }),
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/access-policy test`
Expected: FAIL. Erro de tipo em `tenant` (campo não existe) e `TENANT_SUSPENDED` indefinido.

Se a implementação já estiver no branch, `git stash push packages/access-policy/src/types.ts packages/access-policy/src/evaluate-access.ts` antes de rodar, para ver o vermelho de verdade, e `git stash pop` depois.

- [ ] **Step 3: Implementar (ou conferir o que já está)**

Em `types.ts`, acrescentar **pelo fim** do objeto `DENY_REASON` (ADR-024: o enum é persistido e imutável, valor novo entra pelo fim):

```typescript
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
```

Em `AccessPolicyInput`, antes de `student`:

```typescript
  readonly tenant: { readonly gateActive: boolean };
```

E `POLICY_VERSION = '2.0.0'`, com a nota de histórico explicando por que é major.

Em `evaluate-access.ts`, **antes** da checagem de `adminBlock`:

```typescript
  if (input.tenant.gateActive) {
    return { outcome: 'DENY', reason: DENY_REASON.TENANT_SUSPENDED, policyVersion: POLICY_VERSION };
  }
```

Em `schema.prisma`, no enum `AccessReason`, pelo fim, antes do `@@map`:

```prisma
  /// F65 (ADR-053) -- a ACADEMIA esta suspensa por inadimplencia com o
  /// ArenaHub. Nega todo mundo e nao toca em Entitlement nenhum. Nao
  /// confundir com `PAYMENT_OVERDUE`, que e o ALUNO devendo a academia.
  TENANT_SUSPENDED
```

Em `access-reason.spec.ts`: acrescentar `'TENANT_SUSPENDED'` à lista copiada à mão e trocar `toHaveLength(7)` por `toHaveLength(8)`, ajustando o título do teste para "oito razões".

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/access-policy test && pnpm --filter @arenahub/api test -- access-reason`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add packages/access-policy/src packages/database/prisma/schema.prisma apps/api/src/modules/access/access-reason.spec.ts
git commit -m "feat(access): gate de tenant no motor puro com razao TENANT_SUSPENDED (refs #288)"
```

---

## Task 2: A projeção deriva o gate do status

**Files:**
- Modify: `apps/api/src/modules/access/access-projection.repository.ts`
- Test: `apps/api/test/integration/access-gate-de-tenant.int-spec.ts` (criado aqui, ampliado na Task 4)

**Interfaces:**
- Consumes: `AccessPolicyInput.tenant` da Task 1.
- Produces: `montarEntrada(...)` passa a devolver `tenant.gateActive`. Assinatura inalterada.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/integration/access-gate-de-tenant.int-spec.ts`. Seguir o preâmbulo de `apps/api/test/integration/manual-override.int-spec.ts` para montar app e banco (mesmo padrão de `beforeAll`/`afterAll` e criação de tenant, unidade, aluno e entitlement).

```typescript
describe('F65 -- a projecao deriva o gate do status do tenant', () => {
  it('tenant ACTIVE produz gateActive false', async () => {
    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(false);
  });

  it('tenant SUSPENDED produz gateActive true', async () => {
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(true);
  });

  it('tenant INACTIVE NAO fecha a catraca', async () => {
    /*
     * ADR-052 §4: INACTIVE e o dono do SaaS desligando o cliente; o ADR-053
     * fala so de inadimplencia. Colapsar os dois faria um desligamento
     * administrativo negar dizendo "suspensa por divida" -- mentira gravada
     * num fato imutavel.
     */
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'INACTIVE' } });

    const entrada = await projecao.montarEntrada(tenantId, unidadeId, alunoId, 'ACTIVE', agora);

    expect(entrada.tenant.gateActive).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- access-gate-de-tenant`
Expected: FAIL — `entrada.tenant` é `undefined`.

- [ ] **Step 3: Implementar**

Em `montarEntrada`, acrescentar a leitura ao `Promise.all` (segunda posição, depois de `gymUnit`):

```typescript
      /*
       * GATE DO CONTRATANTE -- F65, ADR-053.
       *
       * `findUniqueOrThrow`, e nao `findUnique`: tenant que sumiu no meio da
       * requisicao nao pode virar `null` e cair no `?? false` de um opcional,
       * porque `false` aqui significa ABRIR A CATRACA. Falhar alto e a unica
       * leitura segura de "nao sei o estado do tenant".
       */
      this.db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { status: true },
      }),
```

E no objeto devolvido, antes de `student`:

```typescript
      tenant: { gateActive: tenant.status === 'SUSPENDED' },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- access-gate-de-tenant`
Expected: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/access/access-projection.repository.ts apps/api/test/integration/access-gate-de-tenant.int-spec.ts
git commit -m "feat(access): projecao deriva gateActive do status do tenant (refs #288)"
```

---

## Task 3: A liberação manual não fura o gate

**Files:**
- Modify: `apps/api/src/modules/access/manual-override.use-case.ts`
- Test: `apps/api/test/integration/manual-override.int-spec.ts`

**Interfaces:**
- Produces: `TenantSuspensoError extends BadRequestException` com `{ code: 'TENANT_SUSPENDED' }`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `apps/api/test/integration/manual-override.int-spec.ts`:

```typescript
it('F65 -- recepcao NAO libera quando o tenant esta suspenso', async () => {
  /*
   * ADR-053 §1 diz "nega todo mundo". Sem esta guarda o gate teria porta
   * lateral: nega na catraca e libera na tela, e a suspensao por
   * inadimplencia viraria sugestao.
   */
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

  const resposta = await pedirOverride({ studentId: alunoId, reason: 'aluno esqueceu a digital' });

  expect(resposta.status).toBe(400);
  expect(resposta.body.code).toBe('TENANT_SUSPENDED');
});

it('F65 -- e nenhum AccessEvent e gravado nesse caso', async () => {
  // Recusa que grava evento de ALLOW seria pior que nao recusar: o relatorio
  // diria que a pessoa entrou.
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

  const antes = await db.accessEvent.count({ where: { tenantId } });
  await pedirOverride({ studentId: alunoId, reason: 'aluno esqueceu a digital' });
  const depois = await db.accessEvent.count({ where: { tenantId } });

  expect(depois).toBe(antes);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- manual-override`
Expected: FAIL — recebe 201 e grava evento.

- [ ] **Step 3: Implementar**

Antes de `export interface PedidoDeOverride`, a classe de erro:

```typescript
/**
 * Gate do contratante -- F65, ADR-053 §1: suspenso, a catraca nega TODO
 * MUNDO. Inclusive por aqui.
 *
 * A liberacao manual responde por decisao da OPERACAO sobre uma pessoa; ela
 * nao tem alcance sobre a divida da academia com o ArenaHub, que so o dono
 * resolve pagando.
 */
export class TenantSuspensoError extends BadRequestException {
  constructor() {
    super({ code: 'TENANT_SUSPENDED' });
  }
}
```

E dentro de `executar`, **antes** da busca do dispositivo:

```typescript
    /*
     * ANTES das checagens de dispositivo e aluno de proposito: suspenso, a
     * resposta e a mesma para todo mundo, e vasculhar o cadastro primeiro so
     * diria a quem sondasse quais UUIDs existem numa academia que nem
     * deveria estar respondendo.
     */
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: contexto.tenantId },
      select: { status: true },
    });

    if (tenant.status === 'SUSPENDED') throw new TenantSuspensoError();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- manual-override`
Expected: PASS, incluindo os dois novos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/access/manual-override.use-case.ts apps/api/test/integration/manual-override.int-spec.ts
git commit -m "feat(access): liberacao manual recusa com tenant suspenso (refs #288)"
```

---

## Task 4: Prova de que nenhum Entitlement é tocado

Este é o critério de aceite central da issue. Merece tarefa própria.

**Files:**
- Test: `apps/api/test/integration/access-gate-de-tenant.int-spec.ts` (ampliar)

**Interfaces:**
- Consumes: tudo das Tasks 1 a 3.

- [ ] **Step 1: Escrever o teste**

```typescript
describe('F65 -- o gate NAO revoga nada (ADR-053 §2)', () => {
  it('Entitlements ficam identicos antes, durante e depois da suspensao', async () => {
    /*
     * O criterio de aceite da #288. Revogar em massa seria destrutivo e
     * irreversivel na pratica; o gate existe justamente para nao fazer isso.
     *
     * Compara a LINHA INTEIRA, campo a campo, e nao so o status: uma
     * implementacao que "so" mexesse em `endsAt` passaria por uma
     * comparacao de status e teria estragado o direito do aluno.
     */
    const antes = await db.entitlement.findMany({
      where: { tenantId },
      orderBy: { id: 'asc' },
    });

    await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

    const decisaoComGate = await decidir(alunoId);

    const durante = await db.entitlement.findMany({
      where: { tenantId },
      orderBy: { id: 'asc' },
    });

    await db.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

    const decisaoSemGate = await decidir(alunoId);

    const depois = await db.entitlement.findMany({
      where: { tenantId },
      orderBy: { id: 'asc' },
    });

    expect(decisaoComGate.outcome).toBe('DENY');
    expect(decisaoComGate.reason).toBe('TENANT_SUSPENDED');
    expect(decisaoSemGate.outcome).toBe('ALLOW');

    expect(durante).toEqual(antes);
    expect(depois).toEqual(antes);
  });

  it('o AccessEvent negado registra a razao do gate', async () => {
    // Sem isso, "por que a academia inteira nao passou naquele dia?" so se
    // responde reconstruindo o estado do tenant, que ja mudou.
    await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

    await decidir(alunoId);

    const evento = await db.accessEvent.findFirst({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
    });

    expect(evento?.outcome).toBe('DENY');
    expect(evento?.reason).toBe('TENANT_SUSPENDED');
    expect(evento?.policyVersion).toBe('2.0.0');
  });
});
```

O helper `decidir(alunoId)` chama `DecideOnlineAccessUseCase.executar` com um `ContextoDoEdge` montado, como faz `access-event.int-spec.ts`.

- [ ] **Step 2: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- access-gate-de-tenant`
Expected: PASS. Aqui a implementação já existe (Tasks 1-2), então o vermelho já foi visto lá.

- [ ] **Step 3: Provar o teste com um canário**

Plantar deliberadamente, em `evaluate-access.ts`, uma versão errada que revoga: no ramo do gate, antes do `return`, não há como revogar (o motor é puro). Então o canário vai na **projeção**: fazer `montarEntrada` chamar `db.entitlement.updateMany({ where: { tenantId }, data: { status: 'REVOKED' } })` quando o gate está ativo.

Run: `pnpm --filter @arenahub/api test:integration -- access-gate-de-tenant`
Expected: FAIL no `expect(durante).toEqual(antes)`. **Reverter o canário em seguida.**

Se o teste passar com o canário plantado, ele não prova nada — corrija o teste antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/integration/access-gate-de-tenant.int-spec.ts
git commit -m "test(access): prova que o gate nao toca em Entitlement (refs #288)"
```

---

## Task 5: A chave automático/manual no tenant

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `Tenant`)
- Modify: `apps/api/src/modules/platform/alterar-tenant.use-case.ts`
- Modify: `apps/api/src/modules/platform/dto/` (o schema Zod do PATCH de tenant)
- Test: `apps/api/test/integration/platform-alterar-tenant.int-spec.ts`

**Interfaces:**
- Produces: `Tenant.autoSuspend: boolean` (default `false`); `AlteracaoDeTenant.autoSuspend?: boolean | undefined`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
it('F65 -- o PATCH liga e desliga a suspensao automatica', async () => {
  await patchTenant(tenantId, { autoSuspend: true });

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  expect(tenant.autoSuspend).toBe(true);
});

it('F65 -- a suspensao automatica nasce DESLIGADA', async () => {
  /*
   * Coluna nova que nascesse ligada fecharia catraca de tenant inadimplente
   * no primeiro deploy, sem ninguem ter decidido isso por aquele cliente.
   */
  const novo = await criarTenant({ slug: 'nasce-desligado' });

  expect(novo.autoSuspend).toBe(false);
});

it('F65 -- ligar a chave NAO exige motivo, ao contrario de suspender', async () => {
  // Motivo e exigido para TIRAR DE OPERACAO. Ligar o automatico nao tira
  // ninguem de lugar nenhum -- e so uma preferencia de cobranca.
  const resposta = await patchTenant(tenantId, { autoSuspend: true }, { motivo: undefined });

  expect(resposta.status).toBe(204);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- platform-alterar-tenant`
Expected: FAIL — `autoSuspend` não existe no model.

- [ ] **Step 3: Implementar**

Em `schema.prisma`, no model `Tenant`, junto de `status`:

```prisma
  /// F65 (ADR-053, decisao D2 do PI em 09/09/2026) -- suspensao automatica
  /// por inadimplencia.
  ///
  /// AQUI e nao no contrato: `TenantContract` e IMUTAVEL depois de ativo
  /// (F63), e virar esta chave exigiria contrato novo com PDF novo. Suspender
  /// ou nao e decisao operacional do dono do SaaS, nao clausula negociada.
  ///
  /// Nasce DESLIGADA: ligada por padrao fecharia catraca de inadimplente no
  /// primeiro deploy, sem ninguem ter decidido isso por aquele cliente.
  autoSuspend Boolean @default(false) @map("auto_suspend")
```

Em `AlteracaoDeTenant`, o campo `autoSuspend?: boolean | undefined`. Ele **não** entra em `saindoDeOperacao` — ligar a chave não tira ninguém de operação, então não exige motivo. O filtro de `undefined` já existente cuida do resto.

No schema Zod do PATCH: `autoSuspend: z.boolean().optional()`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- platform-alterar-tenant`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma apps/api/src/modules/platform apps/api/test/integration/platform-alterar-tenant.int-spec.ts
git commit -m "feat(platform): chave de suspensao automatica por tenant (refs #288)"
```

---

## Task 6: O cálculo puro da carência

Um lugar só, reusado pelo job e pelas três telas. Duplicar faria as telas discordarem sobre quando a catraca fecha.

**Files:**
- Create: `apps/api/src/modules/platform/domain/carencia.ts`
- Test: `apps/api/src/modules/platform/domain/carencia.spec.ts`

**Interfaces:**
- Produces:

```typescript
export interface SituacaoDeCobranca {
  /** `null` quando nao ha fatura vencida. */
  readonly vencidaEm: Date | null;
  /** Instante em que o gate fecha. `null` quando nao ha vencida. */
  readonly suspendeEm: Date | null;
  /** Dias inteiros que faltam. Negativo depois de esgotada; `null` sem vencida. */
  readonly diasRestantes: number | null;
  /** Soma das faturas vencidas, na menor unidade monetaria. */
  readonly emAbertoMinor: number;
  /** Carencia esgotada E ja passou das 6h locais. */
  readonly deveSuspender: boolean;
}

export function avaliarCarencia(entrada: {
  readonly faturasVencidas: readonly { readonly dueAt: Date; readonly totalMinor: number }[];
  readonly graceDays: number;
  readonly agora: Date;
  readonly timezone: string;
}): SituacaoDeCobranca;
```

Função **pura**: sem banco, sem relógio próprio. O "agora" entra por parâmetro (convenção do repositório).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
const SAO_PAULO = 'America/Sao_Paulo';

function fatura(dueAt: string, totalMinor = 100_00) {
  return { dueAt: new Date(dueAt), totalMinor };
}

describe('avaliarCarencia -- F65, ADR-053', () => {
  it('sem fatura vencida, nao ha contagem nem valor', () => {
    const s = avaliarCarencia({
      faturasVencidas: [],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s).toEqual({
      vencidaEm: null,
      suspendeEm: null,
      diasRestantes: null,
      emAbertoMinor: 0,
      deveSuspender: false,
    });
  });

  it('conta a carencia a partir do vencimento', () => {
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-09-01T00:00:00Z')],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.diasRestantes).toBe(7);
  });

  it('ancora na fatura MAIS ANTIGA quando ha varias', () => {
    /*
     * Ancorar na mais recente daria ao inadimplente uma carencia nova a cada
     * mes que ele deixasse de pagar -- a divida cresceria e o prazo nunca
     * chegaria ao fim.
     */
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-08-01T00:00:00Z'), fatura('2026-09-01T00:00:00Z')],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.vencidaEm).toEqual(new Date('2026-08-01T00:00:00Z'));
    expect(s.diasRestantes).toBeLessThan(0);
  });

  it('soma TODAS as vencidas no valor em aberto', () => {
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-08-01T00:00:00Z', 500_00), fatura('2026-09-01T00:00:00Z', 300_00)],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.emAbertoMinor).toBe(800_00);
  });

  it('graceDays zero suspende no dia seguinte ao vencimento, nao no mesmo', () => {
    // Carencia zero e legitima (o campo aceita 0). Ainda assim a janela das
    // 6h vale: quem vence hoje fecha amanha de manha, nunca agora.
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-09-09T00:00:00Z')],
      graceDays: 0,
      agora: new Date('2026-09-09T20:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.deveSuspender).toBe(false);
  });

  describe('a janela das 6h locais (decisao D3 do PI)', () => {
    it('NAO suspende as 5h locais, mesmo com a carencia esgotada', () => {
      // 08:00Z = 05:00 em Sao Paulo (UTC-3).
      const s = avaliarCarencia({
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-09-09T08:00:00Z'),
        timezone: SAO_PAULO,
      });

      expect(s.diasRestantes).toBeLessThan(0);
      expect(s.deveSuspender).toBe(false);
    });

    it('suspende as 6h locais', () => {
      // 09:00Z = 06:00 em Sao Paulo.
      const s = avaliarCarencia({
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-09-09T09:00:00Z'),
        timezone: SAO_PAULO,
      });

      expect(s.deveSuspender).toBe(true);
    });

    it('a janela e do fuso da ACADEMIA, nao do servidor', () => {
      /*
       * Manaus e UTC-4. As 09:00Z sao 05:00 la e 06:00 em Sao Paulo -- a
       * mesma chamada tem de decidir diferente nos dois, ou a academia do
       * Amazonas fecharia uma hora antes de abrir.
       */
      const entrada = {
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-09-09T09:00:00Z'),
      };

      expect(avaliarCarencia({ ...entrada, timezone: 'America/Sao_Paulo' }).deveSuspender).toBe(true);
      expect(avaliarCarencia({ ...entrada, timezone: 'America/Manaus' }).deveSuspender).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test -- carencia`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `carencia.ts`. Para a hora local, reusar a resolução de fuso que já existe em `packages/access-policy/src/local-time.ts` (`resolverHoraLocal`), que devolve `minuteOfDay` — 6h locais é `minuteOfDay >= 360`.

`diasRestantes` é `Math.ceil((suspendeEm - agora) / 86_400_000)`, para que "faltam 0 dias" signifique "fecha hoje" e não "já fechou".

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test -- carencia`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/platform/domain/carencia.ts apps/api/src/modules/platform/domain/carencia.spec.ts
git commit -m "feat(platform): calculo puro da carencia com janela de 6h locais (refs #288)"
```

---

## Task 7: O job suspende quem passou da carência

**Files:**
- Create: `apps/api/src/modules/platform/suspender-tenant.use-case.ts`
- Modify: `apps/api/src/modules/platform/platform-invoice-scheduler.service.ts`
- Modify: `apps/api/src/modules/platform/platform.module.ts`
- Test: `apps/api/test/integration/platform-suspensao-automatica.int-spec.ts`

**Interfaces:**
- Consumes: `avaliarCarencia` (Task 6), `Tenant.autoSuspend` (Task 5).
- Produces:

```typescript
export class SuspenderTenantUseCase {
  /** Suspende os que passaram da carencia. Devolve quantos foram. */
  async executarCiclo(agora: Date): Promise<{ avaliados: number; suspensos: number; falhas: number }>;
  /** Levanta o gate de um tenant suspenso AUTOMATICAMENTE. */
  async levantarGate(tenantId: string, correlationId: string, tx?: PrismaTransaction): Promise<boolean>;
}
```

- [ ] **Step 1: Escrever os testes que falham**

```typescript
describe('F65 -- suspensao automatica', () => {
  it('suspende quem passou da carencia e esta em autoSuspend', async () => {
    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    expect(tenant.status).toBe('SUSPENDED');
  });

  it('NAO suspende quem esta fora do autoSuspend', async () => {
    // A carencia esgotada e identica; so a chave muda.
    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    expect(tenant.status).toBe('ACTIVE');
  });

  it('NAO suspende dentro da carencia', async () => {
    await criarFaturaVencida(tenantId, { dueAt: '2026-09-05', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe('ACTIVE');
  });

  it('NAO suspende antes das 6h locais', async () => {
    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T08:00:00Z'));

    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe('ACTIVE');
  });

  it('e IDEMPOTENTE -- rodar duas vezes nao gera duas auditorias', async () => {
    /*
     * O job roda todo dia. Sem a guarda de `status = ACTIVE` no `where`, um
     * tenant suspenso ontem viraria linha de auditoria nova toda madrugada, e
     * "quando esta academia foi suspensa?" deixaria de ter resposta.
     */
    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({ where: { id: tenantId }, data: { autoSuspend: true } });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));
    await suspender.executarCiclo(new Date('2026-09-10T09:00:00Z'));

    const atos = await db.platformAuditLog.count({
      where: { tenantId, action: 'tenant.suspended_automatically' },
    });

    expect(atos).toBe(1);
  });

  it('NAO suspende tenant INACTIVE', async () => {
    // Desligado pelo dono do SaaS ja esta fora; suspende-lo trocaria o motivo
    // registrado de "desligado" para "inadimplente".
    await criarFaturaVencida(tenantId, { dueAt: '2026-08-01', totalMinor: 500_00 });
    await db.tenant.update({
      where: { id: tenantId },
      data: { autoSuspend: true, status: 'INACTIVE' },
    });

    await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe('INACTIVE');
  });

  it('falha de um tenant nao derruba os outros', async () => {
    // Mesmo precedente da emissao: log e o laco segue.
    const resultado = await suspender.executarCiclo(new Date('2026-09-09T09:00:00Z'));

    expect(resultado).toHaveProperty('falhas');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- platform-suspensao-automatica`
Expected: FAIL — caso de uso não existe.

- [ ] **Step 3: Implementar**

`SuspenderTenantUseCase.executarCiclo` busca tenants `ACTIVE` com `autoSuspend: true` que tenham fatura `OVERDUE`; para cada um, lê o `graceDays` do contrato vigente e o `timezone` (do tenant, ou da primeira unidade), chama `avaliarCarencia` e, com `deveSuspender`, grava `SUSPENDED` **na mesma transação** da auditoria `tenant.suspended_automatically` (regra nº 5). O `where` do update inclui `status: 'ACTIVE'` — é o que dá idempotência.

`levantarGate` volta o tenant a `ACTIVE` **só se** a auditoria mais recente de suspensão for a automática, e registra `tenant.gate_lifted`.

No scheduler, terceiro passo do `executarCiclo`, **depois** de `marcarVencidas`:

```typescript
    // ORDEM: emitir, marcar vencidas, suspender. Suspender antes de marcar
    // vencidas olharia para um `OVERDUE` que este mesmo ciclo ainda vai
    // escrever, e a suspensao chegaria um dia atrasada.
    const { suspensos } = await this.suspensao.executarCiclo(agora);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- platform-suspensao-automatica`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/platform apps/api/test/integration/platform-suspensao-automatica.int-spec.ts
git commit -m "feat(platform): job diario suspende tenant apos a carencia (refs #288)"
```

---

## Task 8: Pagamento levanta o gate

**Files:**
- Modify: `apps/api/src/modules/platform/platform-invoice.use-case.ts` (`registrarPagamento`, linha ~270)
- Test: `apps/api/test/integration/platform-fatura.int-spec.ts`

**Interfaces:**
- Consumes: `SuspenderTenantUseCase.levantarGate` (Task 7).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
it('F65 -- pagar a ultima vencida levanta o gate na hora', async () => {
  const fatura = await criarFaturaVencida(tenantId, { dueAt: '2026-08-01' });
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
  await registrarSuspensaoAutomatica(tenantId);

  await faturas.registrarPagamento(contexto, fatura.id, new Date(), 'teste');

  expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe('ACTIVE');
});

it('F65 -- pagar UMA com outra vencida NAO reabre', async () => {
  /*
   * Pagar janeiro com fevereiro vencida nao reabre a academia -- senao o
   * inadimplente mantem a catraca aberta pagando sempre a mais velha.
   */
  const agosto = await criarFaturaVencida(tenantId, { dueAt: '2026-08-01' });
  await criarFaturaVencida(tenantId, { dueAt: '2026-09-01' });
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
  await registrarSuspensaoAutomatica(tenantId);

  await faturas.registrarPagamento(contexto, agosto.id, new Date(), 'teste');

  expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe('SUSPENDED');
});

it('F65 -- pagamento NAO reabre quem o PI suspendeu a mao', async () => {
  /*
   * Decisao registrada no spec §5.6: so se levanta automaticamente o gate que
   * o job baixou. Suspensao manual tem outro motivo, que o pagamento nao
   * resolve, e reabrir aqui passaria por cima da decisao do PI.
   */
  const fatura = await criarFaturaVencida(tenantId, { dueAt: '2026-08-01' });
  await suspenderAMao(tenantId, 'equipamento apreendido pela prefeitura');

  await faturas.registrarPagamento(contexto, fatura.id, new Date(), 'teste');

  expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).status).toBe('SUSPENDED');
});

it('F65 -- e a catraca volta a abrir de verdade depois do pagamento', async () => {
  // Ponta a ponta: o teste acima olha a coluna; este olha a DECISAO.
  const fatura = await criarFaturaVencida(tenantId, { dueAt: '2026-08-01' });
  await db.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
  await registrarSuspensaoAutomatica(tenantId);

  expect((await decidir(alunoId)).reason).toBe('TENANT_SUSPENDED');

  await faturas.registrarPagamento(contexto, fatura.id, new Date(), 'teste');

  expect((await decidir(alunoId)).outcome).toBe('ALLOW');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- platform-fatura`
Expected: FAIL — segue `SUSPENDED` no primeiro teste.

- [ ] **Step 3: Implementar**

Em `registrarPagamento`, envolver o `updateMany` da fatura e a chamada a `levantarGate` numa `$transaction` (regra nº 5), passando o `tx`. `levantarGate` só age se não sobrar nenhuma fatura `OVERDUE` do tenant e se a suspensão foi automática.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- platform-fatura`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/platform apps/api/test/integration/platform-fatura.int-spec.ts
git commit -m "feat(platform): pagamento levanta o gate na mesma transacao (refs #288)"
```

---

## Task 9: A faixa no painel do dono

**Files:**
- Modify: `apps/api/src/modules/auth/auth.controller.ts` (`/auth/me`, linha ~214)
- Modify: `apps/admin-web/app/(protected)/layout.tsx` (slot `banner`, linha ~328)
- Create: `packages/ui/src/components/AvisoDeCobranca.tsx` + `.module.css` + `.spec.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `avaliarCarencia` (Task 6).
- Produces: `/auth/me` passa a devolver, quando há fatura vencida:

```typescript
cobranca: {
  diasRestantes: number;      // negativo depois de esgotada
  emAbertoMinor: number;
  suspensa: boolean;
}
```

- [ ] **Step 1: Escrever o teste do componente**

```typescript
describe('AvisoDeCobranca', () => {
  it('mostra dias restantes e valor em aberto', () => {
    render(<AvisoDeCobranca diasRestantes={7} emAbertoMinor={59_62_50} suspensa={false} />);

    expect(screen.getByText(/7 dias/)).toBeInTheDocument();
    expect(screen.getByText(/5\.962,50/)).toBeInTheDocument();
  });

  it('suspensa, troca a contagem por acesso bloqueado', () => {
    /*
     * Contagem regressiva que chegou a zero e continua contando e pior que
     * nenhuma: ela diz que ainda ha prazo quando a catraca ja fechou.
     */
    render(<AvisoDeCobranca diasRestantes={-3} emAbertoMinor={59_62_50} suspensa />);

    expect(screen.getByText(/acesso bloqueado/i)).toBeInTheDocument();
    expect(screen.queryByText(/dias/)).not.toBeInTheDocument();
  });

  it('no ultimo dia diz "hoje", nao "0 dias"', () => {
    render(<AvisoDeCobranca diasRestantes={0} emAbertoMinor={100_00} suspensa={false} />);

    expect(screen.getByText(/hoje/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/ui test -- AvisoDeCobranca`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar**

O componente espelha `ElevatedSessionBanner` (mesmo precedente, mesma forma): não dispensável, no topo. Valor formatado com o utilitário de moeda que já existe — **nunca** `Intl.NumberFormat` direto, que a regra 5 do lint recusa fora de `TenantDateTime`/`Money`.

Em `/auth/me`, acrescentar o bloco `cobranca` seguindo o padrão do `supportElevation`: só aparece quando existe.

No `layout.tsx`, o slot `banner` passa a compor os dois avisos — a faixa de sessão elevada continua tendo precedência quando as duas existem.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/ui test -- AvisoDeCobranca && pnpm --filter @arenahub/admin-web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src apps/admin-web/app apps/api/src/modules/auth
git commit -m "feat(admin-web): faixa de cobranca com contagem regressiva para o dono (refs #288)"
```

---

## Task 10: As outras duas telas

**Files:**
- Modify: `apps/admin-web/app/(platform)/platform/page.tsx` (grid do Super Admin)
- Modify: `apps/api/src/modules/platform/platform.controller.ts` (o DTO da lista)
- Modify: `apps/admin-web/app/(protected)/billing/` (grid de faturas da plataforma)
- Test: `apps/admin-web/app/(platform)/platform/page.test.tsx`

**Interfaces:**
- Consumes: `SituacaoDeCobranca` (Task 6).
- Produces: `TenantNaLista` ganha `cobranca: { diasRestantes: number | null; emAbertoMinor: number }`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
it('F65 -- a grid mostra quantos dias faltam para a suspensao', async () => {
  const tela = await render(<PaginaDeAcademias />, {
    api: { tenants: [tenantComVencida({ diasRestantes: 7, emAbertoMinor: 59_62_50 })] },
  });

  expect(tela.getByText(/7 dias/)).toBeInTheDocument();
});

it('F65 -- suspensa aparece como suspensa, nao como contagem negativa', () => {
  const tela = render(<PaginaDeAcademias />, {
    api: { tenants: [tenantSuspenso({ diasRestantes: -3 })] },
  });

  expect(tela.getByText(/suspensa/i)).toBeInTheDocument();
  expect(tela.queryByText(/-3/)).not.toBeInTheDocument();
});

it('F65 -- academia em dia nao mostra contagem nenhuma', () => {
  // Ruido em 90% das linhas esconde justamente as que importam.
  const tela = render(<PaginaDeAcademias />, { api: { tenants: [tenantEmDia()] } });

  expect(tela.queryByText(/dias/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/admin-web test -- platform/page`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Na grid do Super Admin, a coluna de situação passa a distinguir três casos: em dia, vencida com N dias, suspensa. `EstadoSimples` com o tom já usado, sem inventar máquina de estado nova no dicionário do DS-PAINEL (a nota no arquivo é explícita sobre isso).

Na grid de faturas do tenant, a linha da fatura vencida ganha a contagem ao lado do valor.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/admin-web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/app apps/api/src/modules/platform
git commit -m "feat(admin-web): contagem regressiva na grid do Super Admin e nas faturas (refs #288)"
```

---

## Task 11: A migration

**Files:**
- Create: `packages/database/prisma/migrations/20260910000000_f65_gate_de_tenant/migration.sql`

- [ ] **Step 1: Gerar a migration**

Run:
```bash
cd packages/database && pnpm prisma migrate dev --name f65_gate_de_tenant --create-only
```

O `--create-only` é obrigatório: gerar e aplicar de uma vez recriaria o banco de desenvolvimento em alguns caminhos, e o Prisma 7 não roda seed no reset.

- [ ] **Step 2: Conferir o SQL gerado**

Deve conter exatamente duas coisas:

```sql
ALTER TYPE "access_reason" ADD VALUE 'TENANT_SUSPENDED';

ALTER TABLE "tenants" ADD COLUMN "auto_suspend" BOOLEAN NOT NULL DEFAULT false;
```

O precedente de `ALTER TYPE ... ADD VALUE` junto de outro DDL no mesmo arquivo é `20260816111545_biometrics_devices`. A restrição do Postgres é sobre **ler** o valor novo na mesma transação que o cria, e nenhuma das duas o lê.

- [ ] **Step 3: Aplicar e conferir contra o schema**

Run:
```bash
cd packages/database && pnpm prisma migrate deploy && pnpm prisma migrate diff --from-config-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: exit 0, sem diferença. Se o `migrate diff` reclamar de flag, conferir a ajuda: o Prisma 7 removeu `--from-url` e `--to-schema-datamodel` de algumas combinações, e o erro real fica no topo do stderr.

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/migrations
git commit -m "feat(database): migration do gate de tenant (refs #288)"
```

---

## Task 12: Gate local, documentação e PR

- [ ] **Step 1: Rodar o gate inteiro, com `--force`**

Cache verde esconde lint vermelho. Rodar:

```bash
pnpm lint --force && pnpm typecheck --force && pnpm build && pnpm test && pnpm test:integration
```

Expected: tudo verde. `pnpm test` **não** roda integração — os dois são obrigatórios.

- [ ] **Step 2: Rodar o E2E**

Run: `pnpm test:e2e`

O gate muda fluxo de tela (faixa nova no layout), e é exatamente o caso que o E2E cobre e o `pnpm test` não. Antes de rodar, matar qualquer Next na 3000 de outra árvore — o `reuseExistingServer` pega o servidor errado.

- [ ] **Step 3: Atualizar a documentação**

- `docs/STATUS.md` — linha da F65 de `📋 backlog` para entregue, com o resumo do que a fatia ensinou; atualizar o cabeçalho "Última atualização".
- `docs/DEVELOPMENT.md` — marcar a F65.
- `docs/TESTS.md` — a linha da F65 com os números medidos (unitário, integração, E2E). O campo do PR nasce com `—` e o `--check` **não** valida esse campo: preencher à mão depois do merge.
- `docs/DECISIONS.md` — acrescentar ao ADR-053 uma nota com as três decisões do PI de 09/09 (D1, D2, D3) e o impedimento do `tenantGateAt`.

- [ ] **Step 4: Abrir o PR**

```bash
git push -u origin f65-gate-de-tenant-no-motor
gh pr create --title "feat(access,platform): gate de tenant no motor de decisao (refs #288)" --body "..."
```

O corpo do PR registra as decisões tomadas: a versão da política em major, `gateActive` derivado, `INACTIVE` fora do gate, a chave no tenant e não no contrato, a janela das 6h, e o `tenantGateAt` fora de escopo com o motivo.

**`refs #288`, nunca `closes`** — fechar a issue forjaria o aceite do PI.

- [ ] **Step 5: Esperar o CI e mergear**

Run: `gh pr checks <n> --watch` em background.

**O exit code dele mente** — já saiu 0 com job vermelho e com rollup vazio. Conferir job a job com `gh run watch <id> --exit-status` antes de afirmar que está verde.

Com o CI verde, mergear. Depois: conferir se o merge fechou a issue sozinho (não pode — o aceite é do PI), aplicar `proplan:done` com o link do PR, preencher o número do PR em `docs/TESTS.md`, e perguntar ao PI se roda `/graphify . --update`.

---

## Cobertura do spec

| Requisito do spec | Task |
|---|---|
| §5.1 gate no motor puro, antes de tudo | 1 |
| §5.2 versão 2.0.0 major | 1 |
| §5.3 derivado, `INACTIVE` fora | 2 |
| §5.4 override não fura | 3 |
| §5.5 coluna `autoSuspend` | 5 |
| §5.5 job, carência e janela das 6h | 6, 7 |
| §5.6 pagamento levanta o gate | 8 |
| §6 D1 — os três avisos | 9, 10 |
| §8 Entitlements idênticos | 4 |
| §9 migration | 11 |
| §4 `tenantGateAt` fora de escopo | registrado no PR e no ADR (12) |
