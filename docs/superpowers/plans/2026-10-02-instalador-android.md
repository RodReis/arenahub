# Area do instalador Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recepcao mostra, no painel e no totem, um QR que leva o aluno ao APK Android atual da academia.

**Architecture:** Uma tabela por academia (`tenant_app_distribution`, PK = `tenant_id`, RLS da F66) guarda URL e versao. API expoe `GET/PUT /api/v1/app-distribution` e anexa `appAndroid` ao `GET /api/v1/kiosk/config`. Painel tem pagina `/app` (QR gerado no servidor); totem ganha botao na espera e uma etapa `app` com QR e retorno automatico.

**Tech Stack:** NestJS, Prisma 7, Zod, Next 16 (admin-web e kiosk), `qrcode`, Jest (api), Vitest (web).

**Spec:** `docs/superpowers/specs/2026-10-02-instalador-android-design.md` (issue #534)

## Global Constraints

- Idioma: texto de interface e docs em pt-BR; codigo e identificadores em ingles (dominio) ou nomes do modulo vizinho.
- `tenant_id` vem da identidade autenticada, nunca do corpo. Corpo com `.strict()`.
- URL do instalador: `https`, ate 2048 caracteres; versao: ate 40 caracteres. Validacao no servidor.
- Ler: `student.read`. Salvar: `user.manage`. Nenhuma permissao nova.
- Toast para sucesso e erro; nunca `Alert`. Sem hex literal nem `any`.
- Nunca logar o valor da URL em erro.
- Totem: sem CPF, sem sessao, retorno automatico a espera em 60 s.
- Todo acesso a tabela nova vai por `this.db.comTenant(...)`.

## Review Focus

- URL com esquema `javascript:`, `http:` ou `data:` colada por engano: recusada no servidor (Task 1, 4).
- Academia sem linha configurada: `GET` devolve nulos, painel mostra estado vazio, totem esconde o botao (Tasks 4, 6, 7).
- Academia A nunca le a linha da academia B, nem pelo `kiosk/config` (Tasks 3, 5).
- `kiosk-media-link.service` reconstroi `{ version, config }` e descartaria campo novo: `appAndroid` entra no controller, depois de `resolverMidias` (Task 5).
- Clique no botao novo do totem nao pode disparar o "Entrar" da tela inteira (`stopPropagation`) (Task 7).
- Usuario sem `user.manage` nao ve o formulario e o `PUT` devolve 403 (Tasks 4, 6).

---

### Task 1: Validacao da URL do instalador (dominio puro)

**Files:**
- Create: `apps/api/src/modules/app-distribution/domain/instalador-android.ts`
- Test: `apps/api/src/modules/app-distribution/domain/instalador-android.spec.ts`

**Interfaces:**
- Produces: `LIMITE_DA_URL = 2048`, `LIMITE_DA_VERSAO = 40`, `urlDeInstaladorValida(bruta: unknown): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { LIMITE_DA_URL, urlDeInstaladorValida } from './instalador-android.js';

describe('urlDeInstaladorValida', () => {
  it('aceita https', () => {
    expect(urlDeInstaladorValida('https://expo.dev/artifacts/eas/abc.apk')).toBe(true);
  });

  it.each([
    ['http', 'http://expo.dev/a.apk'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html;base64,AAAA'],
    ['vazia', ''],
    ['sem esquema', 'expo.dev/a.apk'],
    ['nao string', 42],
    ['gigante', `https://expo.dev/${'a'.repeat(LIMITE_DA_URL)}`],
  ])('recusa %s', (_caso, valor) => {
    expect(urlDeInstaladorValida(valor)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run (em `apps/api`): `pnpm exec jest --selectProjects unit src/modules/app-distribution/domain/instalador-android.spec.ts`
Expected: FAIL, modulo inexistente. (Se o projeto unit tiver outro nome, usar o de `jest.config.mjs`.)

- [ ] **Step 3: Implement**

```ts
export const LIMITE_DA_URL = 2048;
export const LIMITE_DA_VERSAO = 40;

/**
 * URL que o QR vai ABRIR no celular do aluno -- por isso o esquema e conferido
 * aqui, no servidor. `javascript:` executa codigo; `http:` entrega o aluno a um
 * intermediario. Mesmo criterio de `urlSegura` em `politica-de-versao.ts`.
 */
export function urlDeInstaladorValida(bruta: unknown): boolean {
  if (typeof bruta !== 'string' || bruta === '' || bruta.length > LIMITE_DA_URL) return false;

  try {
    return new URL(bruta).protocol === 'https:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run it, expect PASS** (mesmo comando).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/app-distribution/domain
git commit -m "feat(api): validacao da URL do instalador Android (refs #534)"
```

---

### Task 2: Tabela `tenant_app_distribution` com RLS

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (novo model + relacao reversa em `model Tenant`, perto de `billingSettings`)
- Create: `packages/database/prisma/migrations/20261002130000_add_tenant_app_distribution/migration.sql`

**Interfaces:**
- Produces: `prisma.tenantAppDistribution` com `tenantId` (PK), `androidUrl`, `androidVersion`, `updatedAt`, `updatedByUserId`.

- [ ] **Step 1: Model**

```prisma
/// Instalador Android da academia -- issue #534. Uma linha por academia; o
/// proprio tenant e a PK (mesmo molde de `TenantPrivacySettings`).
model TenantAppDistribution {
  tenantId        String   @id @map("tenant_id") @db.Uuid
  androidUrl      String   @map("android_url")
  androidVersion  String?  @map("android_version")
  /// Quem salvou. Sem FK de proposito: o link sobrevive a saida do usuario.
  updatedByUserId String?  @map("updated_by_user_id") @db.Uuid
  updatedAt       DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("tenant_app_distribution")
}
```

E em `model Tenant`: `appDistribution TenantAppDistribution?`

- [ ] **Step 2: Migration** (SQL escrito a mao; politica copiada da F66, `20260910100000_f66_rls_role_e_politicas`)

```sql
CREATE TABLE "tenant_app_distribution" (
    "tenant_id" UUID NOT NULL,
    "android_url" TEXT NOT NULL,
    "android_version" TEXT,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_app_distribution_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_app_distribution"
  ADD CONSTRAINT "tenant_app_distribution_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE tenant_app_distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_app_distribution FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenant_app_distribution ON tenant_app_distribution
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  )
  WITH CHECK (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.actor', true) = 'platform'
  );
```

Os GRANTs ao role `arenahub_app` vem do `ALTER DEFAULT PRIVILEGES` da F66; conferir em producao (Task 8).

- [ ] **Step 3: Gerar client e conferir drift**

Run: `pnpm --filter @arenahub/database exec prisma generate` e, contra o banco local, `pnpm --filter @arenahub/database exec prisma migrate dev --skip-seed` (ou o script do pacote). Expected: migration aplicada, sem pedir migration extra (se o Prisma gerar diff, ajustar o SQL ate o diff zerar).

- [ ] **Step 4: Guarda de catalogo**

Run (em `apps/api`): `pnpm test:integration -- rls-cobertura`
Expected: PASS (a tabela tem `tenant_id`).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma
git commit -m "feat(database): tabela tenant_app_distribution com RLS (refs #534)"
```

---

### Task 3: Repositorio

**Files:**
- Create: `apps/api/src/modules/app-distribution/app-distribution.repository.ts`
- Test: `apps/api/test/integration/app-distribution-repository.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService.comTenant`, `TenantContext` (`tenantId`, `actorId`).
- Produces:
```ts
export interface InstaladorAndroid { androidUrl: string; androidVersion: string | null; updatedAt: Date }
class AppDistributionRepository {
  obter(contexto: TenantContext): Promise<InstaladorAndroid | null>;
  salvar(contexto: TenantContext, dados: { androidUrl: string; androidVersion: string | null }): Promise<InstaladorAndroid>;
}
```

- [ ] **Step 1: Write the failing test** (esqueleto de `team-repository.int-spec.ts`)

```ts
import { Test } from '@nestjs/testing';
import { comContexto } from '@arenahub/database';

import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AppDistributionRepository } from '../../src/modules/app-distribution/app-distribution.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

describe('AppDistributionRepository', () => {
  let repo: AppDistributionRepository;
  let db: PrismaService;
  let tenantA: string;
  let tenantB: string;
  const sufixo = `${Date.now()}`;

  const ctx = (tenantId: string) => ({ tenantId, actorId: null }) as unknown as TenantContext;
  const como = <T>(tenantId: string, fn: () => Promise<T>) =>
    comContexto({ kind: 'tenant', tenantId }, fn);

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      providers: [AppDistributionRepository, PrismaService],
    }).compile();
    repo = ref.get(AppDistributionRepository);
    db = ref.get(PrismaService);
    const a = await db.tenant.create({ data: { slug: `app-a-${sufixo}`, legalName: `A ${sufixo}`, displayName: `A ${sufixo}` } });
    const b = await db.tenant.create({ data: { slug: `app-b-${sufixo}`, legalName: `B ${sufixo}`, displayName: `B ${sufixo}` } });
    tenantA = a.id;
    tenantB = b.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  });

  it('devolve null quando a academia nao configurou', async () => {
    expect(await como(tenantA, () => repo.obter(ctx(tenantA)))).toBeNull();
  });

  it('salva e le; salvar de novo substitui (upsert por tenant)', async () => {
    await como(tenantA, () => repo.salvar(ctx(tenantA), { androidUrl: 'https://expo.dev/a.apk', androidVersion: '0.1.0' }));
    await como(tenantA, () => repo.salvar(ctx(tenantA), { androidUrl: 'https://expo.dev/b.apk', androidVersion: null }));

    const lido = await como(tenantA, () => repo.obter(ctx(tenantA)));
    expect(lido?.androidUrl).toBe('https://expo.dev/b.apk');
    expect(lido?.androidVersion).toBeNull();
  });

  it('uma academia nao le a linha da outra', async () => {
    expect(await como(tenantB, () => repo.obter(ctx(tenantB)))).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run (em `apps/api`): `pnpm test:integration -- app-distribution-repository`
Expected: FAIL, repositorio inexistente.

- [ ] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export interface InstaladorAndroid {
  androidUrl: string;
  androidVersion: string | null;
  updatedAt: Date;
}

const SELECAO = { androidUrl: true, androidVersion: true, updatedAt: true } as const;

@Injectable()
export class AppDistributionRepository {
  constructor(private readonly db: PrismaService) {}

  obter(contexto: TenantContext): Promise<InstaladorAndroid | null> {
    return this.db.comTenant((tx) =>
      tx.tenantAppDistribution.findUnique({
        where: { tenantId: contexto.tenantId },
        select: SELECAO,
      }),
    );
  }

  salvar(
    contexto: TenantContext,
    dados: { androidUrl: string; androidVersion: string | null },
  ): Promise<InstaladorAndroid> {
    return this.db.comTenant((tx) =>
      tx.tenantAppDistribution.upsert({
        where: { tenantId: contexto.tenantId },
        create: { tenantId: contexto.tenantId, ...dados, updatedByUserId: contexto.actorId ?? null },
        update: { ...dados, updatedByUserId: contexto.actorId ?? null },
        select: SELECAO,
      }),
    );
  }
}
```

- [ ] **Step 4: Run, expect PASS** (mesmo comando).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/app-distribution/app-distribution.repository.ts apps/api/test/integration/app-distribution-repository.int-spec.ts
git commit -m "feat(api): repositorio do instalador Android por academia (refs #534)"
```

---

### Task 4: Controller, modulo e OpenAPI

**Files:**
- Create: `apps/api/src/modules/app-distribution/app-distribution.controller.ts`
- Create: `apps/api/src/modules/app-distribution/app-distribution.module.ts`
- Modify: `apps/api/src/app.module.ts` (import + `imports: [...]`, junto de `TeamModule`)
- Modify: `apps/api/test/integration/openapi.int-spec.ts` (acrescentar `'/api/v1/app-distribution'` em `arrayContaining`)
- Modify: `packages/api-contracts/openapi/arenahub-v1.json` (regenerado)
- Test: `apps/api/test/integration/app-distribution.int-spec.ts`

**Interfaces:**
- Consumes: `AppDistributionRepository` (Task 3), `urlDeInstaladorValida`, `LIMITE_DA_VERSAO` (Task 1).
- Produces: `GET /api/v1/app-distribution -> { androidUrl: string | null, androidVersion: string | null, updatedAt: string | null }`; `PUT` com corpo `{ androidUrl: string, androidVersion?: string | null }` devolve o mesmo formato.

- [ ] **Step 1: Write the failing test** (HTTP, copiar `montarAcademia()` e o login de `tenant-isolation.int-spec.ts`, ajustando para criar DOIS usuarios na mesma academia: um com `user.manage` + `student.read` e outro so com `student.read`)

```ts
it('GET sem configuracao devolve nulos', async () => {
  const r = await request(servidor()).get('/api/v1/app-distribution').set('Cookie', cookieDoGerente);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ androidUrl: null, androidVersion: null, updatedAt: null });
});

it('PUT salva e GET devolve', async () => {
  const put = await request(servidor()).put('/api/v1/app-distribution').set('Cookie', cookieDoGerente)
    .send({ androidUrl: 'https://expo.dev/a.apk', androidVersion: '0.1.0 (build 8)' });
  expect(put.status).toBe(200);
  const get = await request(servidor()).get('/api/v1/app-distribution').set('Cookie', cookieDaRecepcao);
  expect(get.body.androidUrl).toBe('https://expo.dev/a.apk');
});

it.each(['http://expo.dev/a.apk', 'javascript:alert(1)', ''])('PUT recusa %s com 400', async (url) => {
  const r = await request(servidor()).put('/api/v1/app-distribution').set('Cookie', cookieDoGerente).send({ androidUrl: url });
  expect(r.status).toBe(400);
});

it('PUT sem user.manage devolve 403', async () => {
  const r = await request(servidor()).put('/api/v1/app-distribution').set('Cookie', cookieDaRecepcao)
    .send({ androidUrl: 'https://expo.dev/a.apk' });
  expect(r.status).toBe(403);
});

it('recusa tenantId no corpo (strict)', async () => {
  const r = await request(servidor()).put('/api/v1/app-distribution').set('Cookie', cookieDoGerente)
    .send({ androidUrl: 'https://expo.dev/a.apk', tenantId: '00000000-0000-0000-0000-000000000000' });
  expect(r.status).toBe(400);
});
```

- [ ] **Step 2: Run, expect FAIL** (404)

Run (em `apps/api`): `pnpm test:integration -- app-distribution.int-spec`

- [ ] **Step 3: Implement controller**

```ts
import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AppDistributionRepository, type InstaladorAndroid } from './app-distribution.repository.js';
import { LIMITE_DA_VERSAO, urlDeInstaladorValida } from './domain/instalador-android.js';

const esquemaDoInstalador = z
  .object({
    androidUrl: z.string(),
    androidVersion: z.string().trim().max(LIMITE_DA_VERSAO).nullish(),
  })
  .strict();

const ESQUEMA_DA_RESPOSTA = {
  type: 'object',
  required: ['androidUrl', 'androidVersion', 'updatedAt'],
  properties: {
    androidUrl: { type: 'string', nullable: true },
    androidVersion: { type: 'string', nullable: true },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

function paraDto(linha: InstaladorAndroid | null) {
  return {
    androidUrl: linha?.androidUrl ?? null,
    androidVersion: linha?.androidVersion ?? null,
    updatedAt: linha?.updatedAt.toISOString() ?? null,
  };
}

@Controller('api/v1/app-distribution')
export class AppDistributionController {
  constructor(
    private readonly instalador: AppDistributionRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('student.read')
  @ApiOkResponse({ schema: ESQUEMA_DA_RESPOSTA })
  async obter() {
    return paraDto(await this.instalador.obter(this.contexto.require()));
  }

  @Put()
  @RequirePermissions('user.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_RESPOSTA })
  async salvar(@Body() corpo: unknown) {
    const dados = esquemaDoInstalador.parse(corpo);

    // O valor da URL NUNCA entra na mensagem: e dado da academia, mas log de
    // erro com link colado vira vazamento quando alguem cola o link errado.
    if (!urlDeInstaladorValida(dados.androidUrl)) {
      throw new BadRequestException({ code: 'APP_DISTRIBUTION_URL_INVALID' });
    }

    const salvo = await this.instalador.salvar(this.contexto.require(), {
      androidUrl: dados.androidUrl,
      androidVersion: dados.androidVersion ? dados.androidVersion : null,
    });

    return paraDto(salvo);
  }
}
```

- [ ] **Step 4: Module e registro**

```ts
import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AppDistributionController } from './app-distribution.controller.js';
import { AppDistributionRepository } from './app-distribution.repository.js';

@Module({
  controllers: [AppDistributionController],
  providers: [AppDistributionRepository, TenantContextService],
  exports: [AppDistributionRepository],
})
export class AppDistributionModule {}
```

Em `app.module.ts`: `import { AppDistributionModule } from './modules/app-distribution/app-distribution.module.js';` e `AppDistributionModule,` em `imports`.

- [ ] **Step 5: Run, expect PASS; regenerar OpenAPI**

Run: `pnpm test:integration -- app-distribution.int-spec` (PASS), depois
`ATUALIZAR_OPENAPI=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects integration test/integration/openapi.int-spec.ts`
(PowerShell: `$env:ATUALIZAR_OPENAPI=1`), acrescentar a rota na lista em prosa e rodar `pnpm test:integration -- openapi` sem a variavel. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api packages/api-contracts
git commit -m "feat(api): GET/PUT /app-distribution (refs #534)"
```

---

### Task 5: `appAndroid` no `kiosk/config`

**Files:**
- Modify: `apps/api/src/modules/kiosk/kiosk.controller.ts` (rota `config`, ~l.138-167: injetar `AppDistributionRepository`, anexar depois de `resolverMidias`, atualizar o schema do `@ApiOkResponse`)
- Modify: `apps/api/src/modules/kiosk/kiosk.module.ts` (importar `AppDistributionModule`)
- Modify: `packages/api-contracts/openapi/arenahub-v1.json` (regenerar)
- Test: `apps/api/test/integration/kiosk-config-app-android.int-spec.ts` (ou o int-spec existente do `kiosk/config`, se houver; copiar o setup dele)

**Interfaces:**
- Consumes: `AppDistributionRepository.obter` (Task 3).
- Produces: resposta de `GET /api/v1/kiosk/config` = `{ version, config, appAndroid: { url: string, version: string | null } | null }`.

- [ ] **Step 1: Write the failing test** (reusar o setup assinado por HMAC do int-spec do totem existente)

```ts
it('devolve appAndroid da propria academia', async () => {
  await db.tenantAppDistribution.create({ data: { tenantId, androidUrl: 'https://expo.dev/a.apk', androidVersion: '0.1.0' } });
  const r = await chamarConfigDoTotem();
  expect(r.body.appAndroid).toEqual({ url: 'https://expo.dev/a.apk', version: '0.1.0' });
});

it('devolve appAndroid null sem configuracao', async () => {
  const r = await chamarConfigDoTotem();
  expect(r.body.appAndroid).toBeNull();
});

it('nao mistura com a linha de outra academia', async () => {
  await db.tenantAppDistribution.create({ data: { tenantId: outroTenantId, androidUrl: 'https://expo.dev/x.apk' } });
  const r = await chamarConfigDoTotem();
  expect(r.body.appAndroid).toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL** (`appAndroid` indefinido)

- [ ] **Step 3: Implement**

```ts
@Get('config')
@ApiOkResponse({ schema: { /* schema atual */ ,
  properties: { /* atuais, mais: */
    appAndroid: {
      type: 'object', nullable: true, required: ['url', 'version'],
      properties: { url: { type: 'string' }, version: { type: 'string', nullable: true } },
    },
  } } })
async obterConfig(@Req() requisicao: Request) {
  const contexto = this.contexto(requisicao);
  const resolvida = await this.config.resolverParaDispositivo(contexto);
  const comMidias = await this.midia.resolverMidias(contexto, resolvida);
  // FORA do `resolverMidias`: ele reconstroi `{ version, config }` e
  // descartaria qualquer campo de topo que este controller acrescentasse antes.
  const instalador = await this.instalador.obter(contexto);

  return {
    ...comMidias,
    appAndroid: instalador
      ? { url: instalador.androidUrl, version: instalador.androidVersion }
      : null,
  };
}
```

(`contexto` do totem ja satisfaz `TenantContext` -- se o tipo nao casar, montar `{ tenantId: contexto.tenantId } as TenantContext` como os outros metodos do controller fazem.)

- [ ] **Step 4: Run, expect PASS; regenerar OpenAPI** (mesmo procedimento da Task 4, Step 5).

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/api-contracts
git commit -m "feat(api): kiosk/config devolve appAndroid da academia (refs #534)"
```

---

### Task 6: Pagina "Aplicativo" no painel

**Files:**
- Create: `apps/admin-web/app/(protected)/app/page.tsx`
- Create: `apps/admin-web/app/(protected)/app/formulario-do-instalador.tsx`
- Create: `apps/admin-web/app/(protected)/app/copiar-link.tsx`
- Create: `apps/admin-web/app/actions/instalador-android.ts`
- Modify: `apps/admin-web/app/(protected)/layout.tsx` (item no array `NAVEGACAO`)
- Test: `apps/admin-web/app/(protected)/app/page.test.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/v1/app-distribution` (Task 4), `GET /api/v1/auth/me` (`permissions?: string[]`).
- Produces: rota `/app`.

- [ ] **Step 1: Write the failing test** (molde: `operations/biometric-term/page.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));
vi.mock('../../actions/instalador-android', () => ({ salvarInstaladorAndroid: vi.fn() }));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDoAplicativo from './page';

function responder(instalador: object, permissoes: string[]) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) =>
    Promise.resolve(
      caminho.endsWith('/auth/me')
        ? { ok: true, dados: { permissions: permissoes }, cookiesDaApi: [] }
        : { ok: true, dados: instalador, cookiesDaApi: [] },
    ),
  );
}

const CONFIGURADO = { androidUrl: 'https://expo.dev/a.apk', androidVersion: '0.1.0', updatedAt: '2026-10-02T12:00:00.000Z' };
const VAZIO = { androidUrl: null, androidVersion: null, updatedAt: null };

async function renderizar() {
  return render(<ToastProvider>{await PaginaDoAplicativo()}</ToastProvider>);
}

describe('pagina do aplicativo', () => {
  it('mostra QR, versao e link quando configurado', async () => {
    responder(CONFIGURADO, ['student.read']);
    await renderizar();
    expect(screen.getByTestId('qr-do-instalador')).toBeTruthy();
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByTestId('copiar-link')).toBeTruthy();
  });

  it('sem link mostra o estado vazio e nenhum QR', async () => {
    responder(VAZIO, ['student.read']);
    await renderizar();
    expect(screen.getByTestId('sem-instalador')).toBeTruthy();
    expect(screen.queryByTestId('qr-do-instalador')).toBeNull();
  });

  it('formulario so aparece com user.manage', async () => {
    responder(CONFIGURADO, ['student.read']);
    const { unmount } = await renderizar();
    expect(screen.queryByTestId('formulario-do-instalador')).toBeNull();
    unmount();

    responder(CONFIGURADO, ['student.read', 'user.manage']);
    await renderizar();
    expect(screen.getByTestId('formulario-do-instalador')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @arenahub/admin-web exec vitest run app/\(protected\)/app` (ou filtro `aplicativo`/`app/page`).

- [ ] **Step 3: Action** (molde: `actions/termo-biometrico.ts`)

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

export interface EstadoDoInstalador {
  erro?: string;
  valores?: Record<string, string>;
  sucesso?: true;
}

const esquema = z.object({
  androidUrl: z.string().trim().min(1, 'Informe o link do instalador.'),
  androidVersion: z.string().trim().max(40, 'A versão aceita até 40 caracteres.'),
});

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  APP_DISTRIBUTION_URL_INVALID: 'O link precisa começar com https://.',
  FORBIDDEN: 'Você não tem permissão para alterar o instalador.',
};

export async function salvarInstaladorAndroid(
  _anterior: EstadoDoInstalador,
  formulario: FormData,
): Promise<EstadoDoInstalador> {
  const valores = {
    androidUrl: String(formulario.get('androidUrl') ?? ''),
    androidVersion: String(formulario.get('androidVersion') ?? ''),
  };
  const validado = esquema.safeParse(valores);
  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados.', valores };
  }

  const resposta = await chamarApi('/api/v1/app-distribution', {
    metodo: 'PUT',
    corpo: {
      androidUrl: validado.data.androidUrl,
      androidVersion: validado.data.androidVersion || null,
    },
  });

  if (!resposta.ok) {
    const codigo = resposta.erro?.code ?? '';
    return { erro: MENSAGEM[codigo] ?? `Não foi possível salvar (${codigo || 'erro'}).`, valores };
  }

  revalidatePath('/app');
  return { sucesso: true };
}
```

- [ ] **Step 4: Pagina, formulario, copiar**

`page.tsx` (server component):

```tsx
import type { Metadata } from 'next';
import QRCode from 'qrcode';

import { EmptyState, PageHeader, ProblemDetail, SectionCard } from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { CopiarLink } from './copiar-link';
import { FormularioDoInstalador } from './formulario-do-instalador';

export const metadata: Metadata = { title: 'Aplicativo — ArenaHub' };
export const dynamic = 'force-dynamic';

interface Instalador {
  androidUrl: string | null;
  androidVersion: string | null;
  updatedAt: string | null;
}

export default async function PaginaDoAplicativo() {
  const [instalador, perfil] = await Promise.all([
    chamarApi<Instalador>('/api/v1/app-distribution'),
    chamarApi<{ permissions?: string[] }>('/api/v1/auth/me'),
  ]);

  if (!instalador.ok || !instalador.dados) {
    return (
      <section aria-labelledby="titulo-aplicativo">
        <PageHeader id="titulo-aplicativo" title="Aplicativo" />
        <ProblemDetail
          testId="erro-do-instalador"
          problem={{
            ...(instalador.erro ?? { type: 'about:blank', status: 0, code: 'erro', correlationId: '' }),
            title: `Não foi possível carregar o instalador (${instalador.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const { androidUrl, androidVersion } = instalador.dados;
  const podeSalvar = perfil.dados?.permissions?.includes('user.manage') ?? false;
  const qrSvg = androidUrl
    ? await QRCode.toString(androidUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    : null;

  return (
    <section aria-labelledby="titulo-aplicativo">
      <PageHeader id="titulo-aplicativo" title="Aplicativo" />

      <SectionCard title="Instalador Android" summary="Mostre o QR ao aluno ou envie o link.">
        {androidUrl && qrSvg ? (
          <>
            <div data-testid="qr-do-instalador" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p>Versão: <strong>{androidVersion ?? 'não informada'}</strong></p>
            <p data-testid="link-do-instalador">{androidUrl}</p>
            <CopiarLink url={androidUrl} />
            <p>O celular precisa permitir “instalar apps desconhecidos” para abrir o APK.</p>
          </>
        ) : (
          <EmptyState
            testId="sem-instalador"
            title="Nenhum instalador configurado."
            hint="Quem administra a equipe cola aqui o link do build atual."
          />
        )}
      </SectionCard>

      {podeSalvar ? (
        <SectionCard title="Atualizar instalador" summary="Cole o link do build novo e a versão.">
          <FormularioDoInstalador androidUrl={androidUrl} androidVersion={androidVersion} />
        </SectionCard>
      ) : null}
    </section>
  );
}
```

(`dangerouslySetInnerHTML` aqui recebe SVG gerado pela lib a partir de string; mesmo uso de `configurar-2fa/page.tsx`. O `androidUrl` entra como dado do QR, nunca como HTML.)

`formulario-do-instalador.tsx` (client; molde `formulario-do-termo.tsx`): `useActionState(salvarInstaladorAndroid, {})`, `useToastDeErro(estado.erro, 'error', 'erro-do-instalador')`, `useToastDeErro(estado.sucesso ? 'Instalador atualizado.' : undefined, 'info', 'sucesso-do-instalador')`, `<form action={acao} data-testid="formulario-do-instalador">` com `Field name="androidUrl"` (`defaultValue={estado.valores?.['androidUrl'] ?? androidUrl ?? ''}`), `Field name="androidVersion"` (`maxLength={40}`) e botao `Salvar` com `useFormStatus`.

`copiar-link.tsx` (client): `<Button type="button" data-testid="copiar-link" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopiado(true))}>` com texto "Copiar link"/"Copiado" (try/catch: falha de clipboard nao derruba).

Menu em `layout.tsx`, array `NAVEGACAO`:

```ts
{ href: '/app', label: 'Aplicativo', exigePermissao: 'student.read' },
```

- [ ] **Step 5: Run, expect PASS; typecheck e lint**

Run: `pnpm --filter @arenahub/admin-web exec vitest run`, `pnpm --filter @arenahub/admin-web exec tsc --noEmit`, `pnpm --filter @arenahub/admin-web exec eslint "app/(protected)/app" app/actions/instalador-android.ts`.
Expected: verde. Se `navegacao.test.tsx` listar itens, atualizar a expectativa.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web
git commit -m "feat(admin-web): pagina Aplicativo com QR do instalador Android (refs #534)"
```

---

### Task 7: Botao e tela do QR no totem

**Files:**
- Modify: `apps/kiosk/package.json` (`qrcode`, `@types/qrcode`, mesmas versoes do admin-web)
- Modify: `apps/kiosk/lib/kiosk-client.ts` (`ConfigDoTotem.appAndroid`)
- Modify: `apps/kiosk/components/atrator.tsx` (prop `aoBaixarApp?`, botao)
- Create: `apps/kiosk/components/tela-do-app.tsx`
- Modify: `apps/kiosk/app/page.tsx` (estado `appAndroid`, etapa `'app'`)
- Test: `apps/kiosk/components/atrator-app.spec.tsx`, `apps/kiosk/components/tela-do-app.spec.tsx`

**Interfaces:**
- Consumes: `appAndroid: { url: string; version: string | null } | null` em `/api/kiosk/config` (Task 5).
- Produces: `Atrator` aceita `aoBaixarApp?: () => void` (botao so existe quando a prop existe); `TelaDoApp({ url, version, aoVoltar, tempoDeEsperaMs? })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/atrator-app.spec.tsx -- molde: atrator-toque.spec.tsx
it('sem aoBaixarApp nao mostra o botao', () => {
  render(<Atrator config={CONFIG} indicadores={SEM_INDICADORES} aoEntrar={vi.fn()} altoContraste={false} aoAlternarContraste={vi.fn()} />);
  expect(screen.queryByTestId('baixar-app')).toBeNull();
});

it('clicar em Baixar o app chama aoBaixarApp e NAO aoEntrar', () => {
  const aoEntrar = vi.fn();
  const aoBaixarApp = vi.fn();
  render(<Atrator config={CONFIG} indicadores={SEM_INDICADORES} aoEntrar={aoEntrar} aoBaixarApp={aoBaixarApp} altoContraste={false} aoAlternarContraste={vi.fn()} />);
  fireEvent.click(screen.getByTestId('baixar-app'));
  expect(aoBaixarApp).toHaveBeenCalledTimes(1);
  expect(aoEntrar).not.toHaveBeenCalled();
});
```

```tsx
// components/tela-do-app.spec.tsx
it('mostra o QR e a versao', async () => {
  render(<TelaDoApp url="https://expo.dev/a.apk" version="0.1.0" aoVoltar={vi.fn()} />);
  expect(await screen.findByTestId('qr-do-app')).toBeTruthy();
  expect(screen.getByText(/0\.1\.0/)).toBeTruthy();
});

it('Voltar chama aoVoltar', () => {
  const aoVoltar = vi.fn();
  render(<TelaDoApp url="https://expo.dev/a.apk" version={null} aoVoltar={aoVoltar} />);
  fireEvent.click(screen.getByTestId('voltar-do-app'));
  expect(aoVoltar).toHaveBeenCalled();
});

it('volta sozinha apos o tempo de espera', () => {
  vi.useFakeTimers();
  const aoVoltar = vi.fn();
  render(<TelaDoApp url="https://expo.dev/a.apk" version={null} aoVoltar={aoVoltar} tempoDeEsperaMs={60_000} />);
  vi.advanceTimersByTime(60_000);
  expect(aoVoltar).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter @arenahub/kiosk exec vitest run components/atrator-app.spec.tsx components/tela-do-app.spec.tsx`

- [ ] **Step 3: Implement**

`tela-do-app.tsx`:

```tsx
'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export const ESPERA_PADRAO_MS = 60_000;

export function TelaDoApp({
  url,
  version,
  aoVoltar,
  tempoDeEsperaMs = ESPERA_PADRAO_MS,
}: {
  url: string;
  version: string | null;
  aoVoltar: () => void;
  tempoDeEsperaMs?: number;
}) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    void QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then((dataUri) => {
      if (ativo) setQr(dataUri);
    });
    return () => {
      ativo = false;
    };
  }, [url]);

  // Sem toque, volta para a espera: o totem fica na parede, e uma tela de QR
  // esquecida aberta esconderia o fluxo de identificacao do proximo aluno.
  useEffect(() => {
    const temporizador = setTimeout(aoVoltar, tempoDeEsperaMs);
    return () => clearTimeout(temporizador);
  }, [aoVoltar, tempoDeEsperaMs]);

  return (
    <main className="telaDoApp" data-testid="tela-do-app">
      <h1>Baixe o app</h1>
      <p>Aponte a câmera do celular para o código.</p>
      {qr ? <img src={qr} alt="QR para baixar o app Android" width={640} height={640} data-testid="qr-do-app" /> : null}
      {version ? <p>Versão {version}</p> : null}
      <button type="button" className="ctaPrimario" onClick={aoVoltar} data-testid="voltar-do-app">
        Voltar
      </button>
    </main>
  );
}
```

`atrator.tsx`: nova prop `aoBaixarApp?: () => void`; no cabecalho, junto de "Alto contraste", `{aoBaixarApp ? (<button type="button" className="botaoDeContraste" data-testid="baixar-app" onClick={(evento) => { evento.stopPropagation(); aoBaixarApp(); }}>Baixar o app</button>) : null}`.

`lib/kiosk-client.ts`: `ConfigDoTotem` ganha `readonly appAndroid?: { readonly url: string; readonly version: string | null } | null`.

`app/page.tsx`: `Etapa = 'atrator' | 'cpf' | 'app'`; `const [appAndroid, setAppAndroid] = useState<ConfigDoTotem['appAndroid']>(null)`; em `carregarConfig().then(...)` fazer `setAppAndroid(resposta.appAndroid ?? null)`; passar `aoBaixarApp={appAndroid ? () => setEtapa('app') : undefined}` ao `Atrator`; quando `etapa === 'app' && appAndroid`, renderizar `<TelaDoApp url={appAndroid.url} version={appAndroid.version} aoVoltar={() => setEtapa('atrator')} />` (envolver `aoVoltar` em `useCallback` para nao reiniciar o temporizador a cada render).

Estilos: reusar tokens `--tt-*` em `globals.css` para `.telaDoApp` (centralizado, alvo de toque >= 88px no botao); sem hex literal.

- [ ] **Step 4: Run, expect PASS; typecheck e lint**

Run: `pnpm --filter @arenahub/kiosk test`, `pnpm --filter @arenahub/kiosk exec tsc --noEmit`, `pnpm --filter @arenahub/kiosk exec eslint components lib app`.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk pnpm-lock.yaml
git commit -m "feat(kiosk): botao Baixar o app e tela do QR do instalador (refs #534)"
```

---

### Task 8: Documentacao, gate local e PR

**Files:**
- Modify: `docs/DEVELOPMENT.md` (linha da entrega, no formato das vizinhas)
- Modify: `docs/TESTS.md` se o `test:report` pedir (ver `pnpm test:report`)

- [ ] **Step 1:** Registrar a entrega no `docs/DEVELOPMENT.md` (data, issue #534, resumo, PR preenchido apos o merge).
- [ ] **Step 2: Gate local** (raiz): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`. Se `test:integration` crashar no Windows depois de passar, rodar com `--maxWorkers=2` e registrar.
- [ ] **Step 3:** Push da branch, PR com `refs #534` (nunca `closes`), CI via `gh run watch <id> --exit-status` em background e conferir job a job.
- [ ] **Step 4:** Merge com CI verde, `proplan:done` e comentario na issue com o PR. Depois do deploy da Railway: conferir que `arenahub_app` tem acesso a `tenant_app_distribution` (`GET /api/v1/app-distribution` devolve 200, nao 500), abrir `/app` e o totem. Perguntar ao PI sobre `/graphify . --update`.
