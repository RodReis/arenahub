# F50 — Configuração do totem: painel e publicação versionada

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O gerente altera marca, cor e sessão do totem no `admin-web`, publica, e o totem reflete a mudança sem interromper aluno em sessão — com *Descartar* restaurando o publicado.

**Architecture:** Módulo `kiosk-admin` novo na API (autenticado por sessão de gerente, separado do `kiosk` que é HMAC de dispositivo) escreve rascunho e publica versão imutável em `kiosk_configurations` — tabela que a F49 já criou com `version` e `publishedAt`. O painel em `/operations/kiosks` edita a camada de dispositivo em três abas. O `apps/kiosk` compara o `configVersion` que o heartbeat já devolve com a versão do boot e reinicia fora de sessão.

**Tech Stack:** NestJS + Prisma + Zod (API), Next.js App Router + Server Actions (admin-web), Next.js PWA (kiosk), Jest (api), Vitest + Testing Library (web), Playwright (E2E).

**Spec:** [`docs/superpowers/specs/2026-08-26-f50-configuracao-do-totem-design.md`](../specs/2026-08-26-f50-configuracao-do-totem-design.md)

## Global Constraints

- **Sem migração de tabela nova.** `kiosk_configurations` já existe (F49). A única alteração de schema é o índice parcial de rascunho único da Task 1.
- **`tenantId` vem da identidade autenticada**, nunca do corpo, query ou parâmetro (Regra de arquitetura 2). Nas rotas admin sai de `TenantContextService.require()`.
- **Device de outro tenant responde 404**, nunca 403 — quem não pode ver não deve saber que existe.
- **Permissões reusadas:** `device.read` para ler, `device.manage` para escrever/publicar/descartar. Não se cria permissão nova — totem é dispositivo.
- **Publicar nunca altera a linha publicada.** `publish` faz INSERT de versão nova e DELETE do rascunho.
- **Accent é escolha entre quatro** (`AZUL`, `VERDE`, `LARANJA`, `ROXO`), nunca hex livre (ADR-042, Decisão 6).
- **`incrementoSegundos` (30) e `tetoSegundos` (99) são `z.literal`** no contrato — na tela aparecem como texto fixo, nunca como campo editável.
- **Alto contraste:** o interruptor do painel é o **padrão de boot da unidade**; o botão do totem é do aluno e **sempre vence**.
- Idioma: identificadores em inglês, textos de UI e comentários em pt-BR.
- `Toast` para retorno ao usuário, nunca `Alert` (convenção do projeto).
- Dinheiro é inteiro — não aplicável nesta fatia, mas nenhum campo novo pode violar.
- Nunca logar payload de configuração com dado de aluno — a configuração não contém PII, e não pode passar a conter.

---

### Task 1: Índice parcial — no máximo um rascunho por camada

Sem esta invariante, *Descartar* fica ambíguo (qual rascunho?) e *Publicar* não sabe qual linha promover. A garantia vai no banco, não em `if` na aplicação.

**Files:**
- Create: `packages/database/prisma/migrations/<timestamp>_kiosk_config_rascunho_unico/migration.sql`
- Test: `apps/api/test/integration/kiosk-admin-config.int-spec.ts`

**Interfaces:**
- Consumes: modelo `KioskConfiguration` (F49) — `tenantId`, `gymUnitId?`, `kioskDeviceId?`, `version`, `publishedAt?`, `payload`
- Produces: índice `kiosk_configurations_rascunho_unico` — a Task 3 depende dele para o `PUT` ser idempotente por camada

- [ ] **Step 1: Escrever os dois testes que provam as duas direções**

O risco conhecido é índice parcial escrito no lado errado: recusa o caso legítimo e o teste passa pelo motivo errado. Por isso **duas** asserções, não uma.

```ts
// apps/api/test/integration/kiosk-admin-config.int-spec.ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';

describe('F50 -- rascunho unico por camada', () => {
  let db: PrismaService;
  let tenantId = '';
  let gymUnitId = '';
  let kioskDeviceId = '';
  let outroDeviceId = '';

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = modulo.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: { name: `T-${sufixo}`, slug: `t-${sufixo}`, document: sufixo.padEnd(14, '0') },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: { tenantId, name: `U-${sufixo}`, timezone: 'America/Sao_Paulo' },
    });
    gymUnitId = unidade.id;

    const device = await db.kioskDevice.create({
      data: { tenantId, gymUnitId, code: `K1-${sufixo}` },
    });
    kioskDeviceId = device.id;

    const outro = await db.kioskDevice.create({
      data: { tenantId, gymUnitId, code: `K2-${sufixo}` },
    });
    outroDeviceId = outro.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  const rascunho = (deviceId: string | null, version: number) =>
    db.kioskConfiguration.create({
      data: {
        tenantId,
        gymUnitId: deviceId === null ? gymUnitId : gymUnitId,
        kioskDeviceId: deviceId,
        version,
        publishedAt: null,
        payload: CONFIG_PADRAO_DO_TOTEM as unknown as object,
      },
    });

  it('recusa dois rascunhos da MESMA camada', async () => {
    await rascunho(kioskDeviceId, 1);

    await expect(rascunho(kioskDeviceId, 2)).rejects.toThrow();
  });

  it('aceita rascunhos de camadas DIFERENTES', async () => {
    // camada de outro dispositivo -- deve passar
    await expect(rascunho(outroDeviceId, 1)).resolves.toBeDefined();

    // camada de unidade (kiosk_device_id NULL) -- deve passar
    await expect(rascunho(null, 1)).resolves.toBeDefined();
  });

  it('aceita varias versoes PUBLICADAS da mesma camada', async () => {
    const publicada = (version: number) =>
      db.kioskConfiguration.create({
        data: {
          tenantId,
          gymUnitId,
          kioskDeviceId: outroDeviceId,
          version,
          publishedAt: new Date(),
          payload: CONFIG_PADRAO_DO_TOTEM as unknown as object,
        },
      });

    await expect(publicada(10)).resolves.toBeDefined();
    await expect(publicada(11)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- kiosk-admin-config`
Expected: FAIL — o primeiro teste falha porque **sem o índice o segundo rascunho é aceito** (`resolves` em vez de `rejects`).

- [ ] **Step 3: Escrever a migração**

`NULL` não colide com `NULL` num índice único comum no Postgres — e aqui a coluna nula **é** parte da identidade da camada. Por isso `COALESCE` com um UUID sentinela, não as colunas cruas.

```sql
-- packages/database/prisma/migrations/<timestamp>_kiosk_config_rascunho_unico/migration.sql

-- No maximo UM rascunho por camada (ADR-042, Decisao 8 + F50).
--
-- Rascunho e a linha com `published_at IS NULL`. Sem esta garantia,
-- "Descartar" fica ambiguo (qual rascunho?) e "Publicar" nao sabe qual
-- linha promover.
--
-- COALESCE e obrigatorio: `gym_unit_id` e `kiosk_device_id` sao NULL de
-- proposito na camada de tenant e de unidade, e NULL nao colide com NULL
-- em indice unico comum -- a camada de tenant aceitaria N rascunhos.
CREATE UNIQUE INDEX kiosk_configurations_rascunho_unico
  ON kiosk_configurations (
    tenant_id,
    COALESCE(gym_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(kiosk_device_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE published_at IS NULL;
```

Declarar no schema Prisma como índice não gerenciado — Prisma não expressa `COALESCE` em índice parcial, então a migração é a fonte e o schema ganha só o comentário:

```prisma
// packages/database/prisma/schema.prisma -- dentro de model KioskConfiguration,
// junto dos outros @@index:

  /// Rascunho unico por camada vive em INDICE PARCIAL com COALESCE
  /// (`kiosk_configurations_rascunho_unico`), escrito a mao na migracao:
  /// Prisma nao expressa `WHERE` nem `COALESCE` em @@unique.
```

- [ ] **Step 4: Aplicar a migração e rodar os testes**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name kiosk_config_rascunho_unico`
Run: `pnpm --filter @arenahub/api test:integration -- kiosk-admin-config`
Expected: PASS nos três testes.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma apps/api/test/integration/kiosk-admin-config.int-spec.ts
git commit -m "feat(kiosk): rascunho unico por camada em indice parcial

COALESCE nas colunas de camada porque NULL nao colide com NULL em indice
unico comum -- sem isso a camada de tenant aceitaria N rascunhos.

refs #151"
```

---

### Task 2: Serviço de configuração administrativa — promoção e estado

O coração da fatia: promover rascunho a versão publicada sem tocar na publicada anterior, e dizer se o totem está ocupado.

**Files:**
- Create: `apps/api/src/modules/kiosk-admin/kiosk-admin-config.service.ts`
- Create: `apps/api/src/modules/kiosk-admin/kiosk-admin-config.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`; `resolverConfig`, `kioskConfigSchema`, `CONFIG_PADRAO_DO_TOTEM`, `type KioskConfig` de `@arenahub/api-contracts`; `TenantContext` de `../../common/tenant/tenant-context.service.js`
- Produces:
  - `interface EstadoDaConfiguracao { publicada: { version: number; config: KioskConfig } | null; rascunho: { config: KioskConfig } | null; efetiva: KioskConfig; configVersion: number; totemEmSessao: boolean }`
  - `class KioskAdminConfigService` com `obterEstado(ctx, kioskDeviceId): Promise<EstadoDaConfiguracao>`, `salvarRascunho(ctx, kioskDeviceId, config): Promise<void>`, `publicar(ctx, kioskDeviceId, agora): Promise<{ version: number }>`, `descartarRascunho(ctx, kioskDeviceId): Promise<void>`
  - A Task 3 consome todos os quatro; a Task 4 consome `EstadoDaConfiguracao` como forma de resposta.

- [ ] **Step 1: Escrever os testes de unidade**

`totemEmSessao` e a numeração de versão são a lógica que erra fácil. Sessão **expirada** não conta como ocupada — senão um aluno que abandonou o totem travaria a publicação para sempre.

```ts
// apps/api/src/modules/kiosk-admin/kiosk-admin-config.service.spec.ts
import { describe, expect, it } from '@jest/globals';
import { proximaVersao, totemOcupado } from './kiosk-admin-config.service.js';

describe('proximaVersao', () => {
  it('comeca em 1 quando a camada nunca publicou', () => {
    expect(proximaVersao([])).toBe(1);
  });

  it('avanca a partir do maior version da camada', () => {
    expect(proximaVersao([1, 2, 5])).toBe(6);
  });

  it('ignora buraco na sequencia -- o que importa e nunca reusar numero', () => {
    expect(proximaVersao([1, 7])).toBe(8);
  });
});

describe('totemOcupado', () => {
  const agora = new Date('2026-08-26T12:00:00.000Z');

  it('sessao aberta e no prazo ocupa o totem', () => {
    const sessoes = [{ endedAt: null, expiresAt: new Date('2026-08-26T12:00:30.000Z') }];

    expect(totemOcupado(sessoes, agora)).toBe(true);
  });

  it('sessao encerrada NAO ocupa', () => {
    const sessoes = [
      { endedAt: new Date('2026-08-26T11:59:00.000Z'), expiresAt: new Date('2026-08-26T12:00:30.000Z') },
    ];

    expect(totemOcupado(sessoes, agora)).toBe(false);
  });

  it('sessao EXPIRADA mas nao encerrada NAO ocupa -- aluno abandonou o totem', () => {
    const sessoes = [{ endedAt: null, expiresAt: new Date('2026-08-26T11:59:00.000Z') }];

    expect(totemOcupado(sessoes, agora)).toBe(false);
  });

  it('sem sessao nenhuma NAO ocupa', () => {
    expect(totemOcupado([], agora)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test -- kiosk-admin-config`
Expected: FAIL — "Cannot find module './kiosk-admin-config.service.js'".

- [ ] **Step 3: Implementar o serviço**

```ts
// apps/api/src/modules/kiosk-admin/kiosk-admin-config.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CONFIG_PADRAO_DO_TOTEM,
  resolverConfig,
  kioskConfigSchema,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.service.js';

export interface EstadoDaConfiguracao {
  readonly publicada: { version: number; config: KioskConfig } | null;
  readonly rascunho: { config: KioskConfig } | null;
  /** O que o totem exibe HOJE -- tres camadas resolvidas, so publicadas. */
  readonly efetiva: KioskConfig;
  /** A soma que o heartbeat devolve e o totem compara com a do boot. */
  readonly configVersion: number;
  readonly totemEmSessao: boolean;
}

/** Sessao expirada NAO ocupa: aluno que abandonou o totem nao trava publicacao. */
export function totemOcupado(
  sessoes: readonly { endedAt: Date | null; expiresAt: Date }[],
  agora: Date,
): boolean {
  return sessoes.some((s) => s.endedAt === null && s.expiresAt.getTime() > agora.getTime());
}

/**
 * Proximo numero da camada. Nunca reusa numero, mesmo com buraco na
 * sequencia: o heartbeat compara igualdade, e numero reusado faria o totem
 * concluir "nada mudou" depois de uma despublicacao seguida de publicacao.
 */
export function proximaVersao(versoesDaCamada: readonly number[]): number {
  return versoesDaCamada.reduce((maior, v) => (v > maior ? v : maior), 0) + 1;
}

@Injectable()
export class KioskAdminConfigService {
  constructor(private readonly db: PrismaService) {}

  async obterEstado(contexto: TenantContext, kioskDeviceId: string): Promise<EstadoDaConfiguracao> {
    const device = await this.exigirDevice(contexto, kioskDeviceId);

    const linhas = await this.db.kioskConfiguration.findMany({
      where: {
        tenantId: contexto.tenantId,
        OR: [
          { gymUnitId: null, kioskDeviceId: null },
          { gymUnitId: device.gymUnitId, kioskDeviceId: null },
          { gymUnitId: device.gymUnitId, kioskDeviceId: device.id },
        ],
      },
      orderBy: [{ version: 'asc' }],
    });

    const publicadasDa = (gymUnitId: string | null, deviceId: string | null) =>
      linhas
        .filter(
          (l) => l.gymUnitId === gymUnitId && l.kioskDeviceId === deviceId && l.publishedAt !== null,
        )
        .at(-1);

    const camadaTenant = publicadasDa(null, null);
    const camadaUnidade = publicadasDa(device.gymUnitId, null);
    const camadaDispositivo = publicadasDa(device.gymUnitId, device.id);

    const rascunhoDoDispositivo = linhas.find(
      (l) => l.gymUnitId === device.gymUnitId && l.kioskDeviceId === device.id && l.publishedAt === null,
    );

    const efetiva = resolverConfig({
      tenant: camadaTenant?.payload,
      unidade: camadaUnidade?.payload,
      dispositivo: camadaDispositivo?.payload,
    });

    // Mesma soma do `kiosk-config.service.ts` (F49): cada camada tem
    // contador proprio pela unique constraint, entao so o maior numero
    // estagnaria quando uma camada nova publicasse com version baixa.
    const configVersion =
      (camadaTenant?.version ?? 0) + (camadaUnidade?.version ?? 0) + (camadaDispositivo?.version ?? 0);

    const sessoes = await this.db.kioskSession.findMany({
      where: { kioskDeviceId: device.id, endedAt: null },
      select: { endedAt: true, expiresAt: true },
    });

    return {
      publicada: camadaDispositivo
        ? { version: camadaDispositivo.version, config: this.lerPayload(camadaDispositivo.payload) }
        : null,
      rascunho: rascunhoDoDispositivo
        ? { config: this.lerPayload(rascunhoDoDispositivo.payload) }
        : null,
      efetiva,
      configVersion,
      totemEmSessao: totemOcupado(sessoes, new Date()),
    };
  }

  async salvarRascunho(
    contexto: TenantContext,
    kioskDeviceId: string,
    config: KioskConfig,
  ): Promise<void> {
    const device = await this.exigirDevice(contexto, kioskDeviceId);

    const existente = await this.db.kioskConfiguration.findFirst({
      where: {
        tenantId: contexto.tenantId,
        gymUnitId: device.gymUnitId,
        kioskDeviceId: device.id,
        publishedAt: null,
      },
    });

    if (existente) {
      await this.db.kioskConfiguration.update({
        where: { id: existente.id },
        data: { payload: config as unknown as object },
      });

      return;
    }

    // Rascunho nasce com version 0: numero de verdade so na publicacao.
    // Guardar aqui o numero futuro daria versao a algo que pode ser
    // descartado, e furaria a sequencia.
    await this.db.kioskConfiguration.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: device.gymUnitId,
        kioskDeviceId: device.id,
        version: 0,
        publishedAt: null,
        payload: config as unknown as object,
      },
    });
  }

  /**
   * Promove o rascunho: INSERT de versao nova + DELETE do rascunho, numa
   * transacao. A linha publicada anterior NAO e tocada -- e o que torna a
   * operacao reversivel e da ao heartbeat um numero que so anda pra frente.
   */
  async publicar(
    contexto: TenantContext,
    kioskDeviceId: string,
    agora: Date,
  ): Promise<{ version: number }> {
    const device = await this.exigirDevice(contexto, kioskDeviceId);

    return this.db.$transaction(async (tx) => {
      const rascunho = await tx.kioskConfiguration.findFirst({
        where: {
          tenantId: contexto.tenantId,
          gymUnitId: device.gymUnitId,
          kioskDeviceId: device.id,
          publishedAt: null,
        },
      });

      if (!rascunho) {
        throw new NotFoundException({ code: 'KIOSK_CONFIG_DRAFT_NOT_FOUND' });
      }

      const publicadas = await tx.kioskConfiguration.findMany({
        where: {
          tenantId: contexto.tenantId,
          gymUnitId: device.gymUnitId,
          kioskDeviceId: device.id,
          publishedAt: { not: null },
        },
        select: { version: true },
      });

      const version = proximaVersao(publicadas.map((p) => p.version));

      await tx.kioskConfiguration.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: device.gymUnitId,
          kioskDeviceId: device.id,
          version,
          publishedAt: agora,
          payload: rascunho.payload,
        },
      });

      await tx.kioskConfiguration.delete({ where: { id: rascunho.id } });

      return { version };
    });
  }

  async descartarRascunho(contexto: TenantContext, kioskDeviceId: string): Promise<void> {
    const device = await this.exigirDevice(contexto, kioskDeviceId);

    await this.db.kioskConfiguration.deleteMany({
      where: {
        tenantId: contexto.tenantId,
        gymUnitId: device.gymUnitId,
        kioskDeviceId: device.id,
        publishedAt: null,
      },
    });
  }

  /**
   * Device de OUTRO tenant responde 404, nunca 403: quem nao pode ver nao
   * deve nem saber que existe. O `tenantId` vem do contexto autenticado.
   */
  private async exigirDevice(
    contexto: TenantContext,
    kioskDeviceId: string,
  ): Promise<{ id: string; gymUnitId: string }> {
    const device = await this.db.kioskDevice.findFirst({
      where: { id: kioskDeviceId, tenantId: contexto.tenantId },
      select: { id: true, gymUnitId: true },
    });

    if (!device) {
      throw new NotFoundException({ code: 'KIOSK_DEVICE_NOT_FOUND' });
    }

    return device;
  }

  /** Payload torto no banco vira o padrao, nunca derruba a tela do painel. */
  private lerPayload(payload: unknown): KioskConfig {
    const parsed = kioskConfigSchema.safeParse(payload);

    return parsed.success ? parsed.data : CONFIG_PADRAO_DO_TOTEM;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test -- kiosk-admin-config`
Expected: PASS nos sete testes de unidade.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk-admin/
git commit -m "feat(kiosk-admin): promocao de rascunho a versao publicada

Publicar faz INSERT de versao nova e DELETE do rascunho numa transacao --
a linha publicada anterior nunca e tocada. Sessao expirada nao conta como
totem ocupado: aluno que abandonou nao pode travar publicacao.

refs #151"
```

---

### Task 3: Rotas administrativas

Cinco rotas sob sessão de gerente. Módulo **separado** do `kiosk`: aquele é HMAC de dispositivo, e misturar os regimes é como um totem acaba escrevendo a própria configuração.

**Files:**
- Create: `apps/api/src/modules/kiosk-admin/kiosk-admin.controller.ts`
- Create: `apps/api/src/modules/kiosk-admin/kiosk-admin.module.ts`
- Modify: `apps/api/src/app.module.ts` — registrar `KioskAdminModule`
- Test: `apps/api/test/integration/kiosk-admin-config.int-spec.ts` (criado na Task 1)

**Interfaces:**
- Consumes: `KioskAdminConfigService` (Task 2) — `obterEstado`, `salvarRascunho`, `publicar`, `descartarRascunho`; `EstadoDaConfiguracao`
- Produces: as cinco rotas HTTP que a Task 5 consome do `admin-web`:
  - `GET /api/v1/admin/kiosk-devices` → `{ id, code, gymUnitId, lastHeartbeat, bootConfigVersion, configVersion }[]`
  - `GET /api/v1/admin/kiosk-devices/:id/config` → `EstadoDaConfiguracao`
  - `PUT /api/v1/admin/kiosk-devices/:id/config` (corpo `KioskConfig`) → 204
  - `POST /api/v1/admin/kiosk-devices/:id/config/publish` → `{ version }`
  - `DELETE /api/v1/admin/kiosk-devices/:id/config/draft` → 204

- [ ] **Step 1: Escrever os testes de integração das rotas**

Acrescentar ao arquivo da Task 1. O teste que mais importa é o de isolamento — e ele precisa provar que o `tenantId` **sai da identidade**, não que a rota devolve o resultado feliz.

```ts
// apps/api/test/integration/kiosk-admin-config.int-spec.ts -- novo describe

describe('F50 -- rotas administrativas de configuracao', () => {
  // ... setup com dois tenants (A e B), cada um com um KioskDevice,
  // e tokens de sessao de gerente para cada um (mesmo molde de
  // `operations.int-spec.ts`).

  it('GET config devolve o padrao quando nada foi publicado', async () => {
    const resposta = await request(servidor())
      .get(`/api/v1/admin/kiosk-devices/${deviceA}/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const corpo = resposta.body as EstadoDaConfiguracao;

    expect(corpo.publicada).toBeNull();
    expect(corpo.rascunho).toBeNull();
    expect(corpo.efetiva.aparencia.accent).toBe('AZUL');
    expect(corpo.configVersion).toBe(0);
  });

  it('device de OUTRO tenant responde 404, nunca 403', async () => {
    await request(servidor())
      .get(`/api/v1/admin/kiosk-devices/${deviceB}/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('tenantId do CORPO e ignorado -- vem da identidade', async () => {
    // Se a rota lesse tenantId do corpo, este PUT escreveria no tenant B.
    await request(servidor())
      .put(`/api/v1/admin/kiosk-devices/${deviceA}/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...CONFIG_PADRAO_DO_TOTEM, tenantId: tenantB })
      .expect(204);

    // A prova e o ESTADO NO BANCO, nao o que a rota devolveu.
    const linhas = await db.kioskConfiguration.findMany({ where: { tenantId: tenantB } });

    expect(linhas).toHaveLength(0);
  });

  it('publicar cria versao nova e NAO altera a publicada anterior', async () => {
    const salvarEPublicar = async (accent: 'AZUL' | 'VERDE') => {
      await request(servidor())
        .put(`/api/v1/admin/kiosk-devices/${deviceA}/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...CONFIG_PADRAO_DO_TOTEM, aparencia: { accent, altoContrastePadrao: false } })
        .expect(204);

      const r = await request(servidor())
        .post(`/api/v1/admin/kiosk-devices/${deviceA}/config/publish`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(201);

      return (r.body as { version: number }).version;
    };

    const v1 = await salvarEPublicar('AZUL');
    const v2 = await salvarEPublicar('VERDE');

    expect(v2).toBe(v1 + 1);

    const publicadas = await db.kioskConfiguration.findMany({
      where: { kioskDeviceId: deviceA, publishedAt: { not: null } },
      orderBy: { version: 'asc' },
    });

    expect(publicadas).toHaveLength(2);
    // A v1 continua AZUL: publicar nunca reescreve versao anterior.
    expect((publicadas[0].payload as { aparencia: { accent: string } }).aparencia.accent).toBe('AZUL');
    expect((publicadas[1].payload as { aparencia: { accent: string } }).aparencia.accent).toBe('VERDE');
  });

  it('descartar rascunho restaura o publicado', async () => {
    await request(servidor())
      .put(`/api/v1/admin/kiosk-devices/${deviceA}/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...CONFIG_PADRAO_DO_TOTEM, marca: { ...CONFIG_PADRAO_DO_TOTEM.marca, slogan: 'rascunho' } })
      .expect(204);

    await request(servidor())
      .delete(`/api/v1/admin/kiosk-devices/${deviceA}/config/draft`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);

    const resposta = await request(servidor())
      .get(`/api/v1/admin/kiosk-devices/${deviceA}/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((resposta.body as EstadoDaConfiguracao).rascunho).toBeNull();
  });

  it('GET /api/v1/kiosk/config do TOTEM nunca serve rascunho', async () => {
    await request(servidor())
      .put(`/api/v1/admin/kiosk-devices/${deviceA}/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ...CONFIG_PADRAO_DO_TOTEM, marca: { ...CONFIG_PADRAO_DO_TOTEM.marca, slogan: 'so rascunho' } })
      .expect(204);

    // Rota do totem, assinada por HMAC (mesmo helper de `kiosk-config.int-spec.ts`).
    const resposta = await pedirConfigDoTotem(totemA);

    expect(resposta.config.marca.slogan).not.toBe('so rascunho');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/api test:integration -- kiosk-admin-config`
Expected: FAIL — 404 em todas as rotas novas (não registradas).

- [ ] **Step 3: Implementar o controller e o módulo**

```ts
// apps/api/src/modules/kiosk-admin/kiosk-admin.controller.ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { kioskConfigSchema } from '@arenahub/api-contracts';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  KioskAdminConfigService,
  type EstadoDaConfiguracao,
} from './kiosk-admin-config.service.js';
import { PrismaService } from '../../persistence/prisma.service.js';

interface TotemDto {
  id: string;
  code: string;
  gymUnitId: string;
  lastHeartbeat: string | null;
  bootConfigVersion: number | null;
}

/**
 * Personalizacao do totem -- F50.
 *
 * Modulo SEPARADO do `kiosk`: aquele autentica por HMAC de DISPOSITIVO
 * (`@KioskRoute()`), estas rotas pela sessao do GERENTE. Misturar os dois
 * regimes no mesmo controller e como um totem acaba conseguindo escrever a
 * propria configuracao.
 *
 * Permissao reusa `device.read` / `device.manage`: totem e dispositivo, nao
 * merece familia de permissao propria.
 */
@Controller('api/v1/admin/kiosk-devices')
export class KioskAdminController {
  constructor(
    private readonly config: KioskAdminConfigService,
    private readonly contexto: TenantContextService,
    private readonly db: PrismaService,
  ) {}

  @Get()
  @RequirePermissions('device.read')
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  async listar(): Promise<TotemDto[]> {
    const ctx = this.contexto.require();

    const devices = await this.db.kioskDevice.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ code: 'asc' }],
      select: {
        id: true,
        code: true,
        gymUnitId: true,
        lastHeartbeat: true,
        bootConfigVersion: true,
      },
    });

    return devices.map((d) => ({
      id: d.id,
      code: d.code,
      gymUnitId: d.gymUnitId,
      lastHeartbeat: d.lastHeartbeat?.toISOString() ?? null,
      bootConfigVersion: d.bootConfigVersion,
    }));
  }

  @Get(':id/config')
  @RequirePermissions('device.read')
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['publicada', 'rascunho', 'efetiva', 'configVersion', 'totemEmSessao'],
      properties: {
        publicada: { type: 'object', nullable: true },
        rascunho: { type: 'object', nullable: true },
        efetiva: { type: 'object' },
        configVersion: { type: 'integer' },
        totemEmSessao: { type: 'boolean' },
      },
    },
  })
  async obter(@Param('id') id: string): Promise<EstadoDaConfiguracao> {
    return this.config.obterEstado(this.contexto.require(), id);
  }

  @Put(':id/config')
  @HttpCode(204)
  @RequirePermissions('device.manage')
  @ApiNoContentResponse({
    schema: { type: 'object', nullable: true, description: 'Sem corpo.' },
  })
  async salvar(@Param('id') id: string, @Body() corpo: unknown): Promise<void> {
    // `unknown` antes de validar. O parse tambem DESCARTA campo estranho no
    // corpo -- e por isso que um `tenantId` enviado pelo cliente nao chega
    // a lugar nenhum.
    const config = kioskConfigSchema.parse(corpo);

    await this.config.salvarRascunho(this.contexto.require(), id, config);
  }

  @Post(':id/config/publish')
  @HttpCode(201)
  @RequirePermissions('device.manage')
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['version'],
      properties: { version: { type: 'integer' } },
    },
  })
  async publicar(@Param('id') id: string): Promise<{ version: number }> {
    return this.config.publicar(this.contexto.require(), id, new Date());
  }

  @Delete(':id/config/draft')
  @HttpCode(204)
  @RequirePermissions('device.manage')
  @ApiNoContentResponse({
    schema: { type: 'object', nullable: true, description: 'Sem corpo.' },
  })
  async descartar(@Param('id') id: string): Promise<void> {
    await this.config.descartarRascunho(this.contexto.require(), id);
  }
}
```

```ts
// apps/api/src/modules/kiosk-admin/kiosk-admin.module.ts
import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { KioskAdminConfigService } from './kiosk-admin-config.service.js';
import { KioskAdminController } from './kiosk-admin.controller.js';

@Module({
  imports: [PersistenceModule],
  controllers: [KioskAdminController],
  providers: [KioskAdminConfigService],
})
export class KioskAdminModule {}
```

Registrar no `app.module.ts` junto dos outros módulos (seguir a ordem alfabética existente ou a convenção do arquivo).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/api test:integration -- kiosk-admin-config`
Expected: PASS. Se o teste do `tenantId` no corpo falhar, o `kioskConfigSchema.parse` não está descartando o campo estranho — conferir se o schema é `.strict()` ou se o parse devolve só as chaves conhecidas.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk-admin/ apps/api/src/app.module.ts apps/api/test/integration/kiosk-admin-config.int-spec.ts
git commit -m "feat(kiosk-admin): cinco rotas de configuracao sob sessao de gerente

Modulo separado do kiosk: aquele e HMAC de dispositivo, este e sessao de
gerente. Device de outro tenant responde 404, nunca 403.

refs #151"
```

---

### Task 4: Reinício da superfície no totem

O heartbeat já devolve `configVersion` (F49). Falta o totem comparar e reiniciar — **fora de sessão**.

**Files:**
- Modify: `apps/kiosk` — o módulo que faz o heartbeat (localizar com `grep -rn "heartbeat" apps/kiosk --include=*.ts --include=*.tsx`)
- Create: `apps/kiosk/src/config/reinicio.ts`
- Create: `apps/kiosk/src/config/reinicio.test.ts`

**Interfaces:**
- Consumes: resposta do heartbeat `{ configVersion: number; serverTime: string }` (F49)
- Produces: `decidirReinicio({ versaoDoBoot, versaoAtual, emSessao }): 'nada' | 'reiniciar' | 'aguardar'` — a Task 6 (E2E) verifica o comportamento resultante

- [ ] **Step 1: Escrever o teste da decisão pura**

A decisão é pura — sem `window`, sem relógio, sem rede. Testar a função em vez do efeito é o que torna isto verificável.

```ts
// apps/kiosk/src/config/reinicio.test.ts
import { describe, expect, it } from 'vitest';
import { decidirReinicio } from './reinicio';

describe('decidirReinicio', () => {
  it('versao igual: nada acontece', () => {
    expect(decidirReinicio({ versaoDoBoot: 3, versaoAtual: 3, emSessao: false })).toBe('nada');
  });

  it('versao diferente e SEM sessao: reinicia', () => {
    expect(decidirReinicio({ versaoDoBoot: 3, versaoAtual: 4, emSessao: false })).toBe('reiniciar');
  });

  it('versao diferente e COM sessao: aguarda o encerramento', () => {
    expect(decidirReinicio({ versaoDoBoot: 3, versaoAtual: 4, emSessao: true })).toBe('aguardar');
  });

  it('versao do boot ainda desconhecida: nada -- nao reinicia por nao saber', () => {
    expect(decidirReinicio({ versaoDoBoot: null, versaoAtual: 4, emSessao: false })).toBe('nada');
  });

  it('versao que RECUOU tambem reinicia -- despublicacao muda a config efetiva', () => {
    expect(decidirReinicio({ versaoDoBoot: 5, versaoAtual: 4, emSessao: false })).toBe('reiniciar');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/kiosk test -- reinicio`
Expected: FAIL — "Cannot find module './reinicio'".

- [ ] **Step 3: Implementar**

```ts
// apps/kiosk/src/config/reinicio.ts

export type DecisaoDeReinicio = 'nada' | 'reiniciar' | 'aguardar';

export interface EntradaDeReinicio {
  /** Versao carregada no boot. `null` enquanto o primeiro heartbeat nao voltou. */
  readonly versaoDoBoot: number | null;
  readonly versaoAtual: number;
  readonly emSessao: boolean;
}

/**
 * ADR-042, Decisao 3: publicar cria versao nova e REINICIA a superficie --
 * nunca aplica em runtime. E o que mantem verdadeira a regra do `DS-TOTEM`
 * de accent resolvido no boot.
 *
 * PURA: sem `window`, sem relogio, sem rede.
 *
 * Compara por DESIGUALDADE, nao por "maior que": despublicar uma camada faz
 * o numero recuar, e isso tambem e mudanca real na configuracao efetiva.
 */
export function decidirReinicio(entrada: EntradaDeReinicio): DecisaoDeReinicio {
  // Sem versao de boot ainda, nao ha o que comparar. Reiniciar aqui daria
  // laco de reinicio no primeiro heartbeat de toda inicializacao.
  if (entrada.versaoDoBoot === null) return 'nada';

  if (entrada.versaoDoBoot === entrada.versaoAtual) return 'nada';

  return entrada.emSessao ? 'aguardar' : 'reiniciar';
}
```

Ligar no ciclo de heartbeat existente: guardar `versaoDoBoot` na primeira resposta, chamar `decidirReinicio` a cada heartbeat, e:
- `'reiniciar'` → `window.location.reload()`
- `'aguardar'` → marcar a intenção e chamar `window.location.reload()` no encerramento da sessão

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/kiosk test -- reinicio`
Expected: PASS nos cinco testes.

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/config/
git commit -m "feat(kiosk): reinicia a superficie quando a config publicada muda

Compara por desigualdade, nao por maior que: despublicar faz o numero
recuar e isso tambem e mudanca real. Com sessao aberta, aguarda o
encerramento -- aluno nao e interrompido.

refs #151"
```

---

### Task 5: Painel — lista de totens e três abas

**Files:**
- Create: `apps/admin-web/app/(protected)/operations/kiosks/page.tsx` — lista
- Create: `apps/admin-web/app/(protected)/operations/kiosks/[id]/page.tsx` — configuração
- Create: `apps/admin-web/app/(protected)/operations/kiosks/[id]/formulario-de-configuracao.tsx`
- Create: `apps/admin-web/app/(protected)/operations/kiosks/[id]/formulario-de-configuracao.test.tsx`
- Create: `apps/admin-web/app/actions/kiosk-config.ts` — Server Actions
- Modify: `apps/admin-web/app/(protected)/navegacao.tsx` — item *Totens* no grupo Operação
- Modify: `apps/admin-web/app/(protected)/navegacao.test.tsx` — o teste de navegação cobre os itens

**Interfaces:**
- Consumes: as cinco rotas da Task 3; `kioskConfigSchema`, `ACCENTS_DO_TOTEM`, `type KioskConfig` de `@arenahub/api-contracts`
- Produces: nada que tasks posteriores consumam além do E2E da Task 6, que navega por `/operations/kiosks`

- [ ] **Step 1: Escrever os testes de componente**

Três coisas que a tela erra fácil e que o design exige explicitamente.

```tsx
// apps/admin-web/app/(protected)/operations/kiosks/[id]/formulario-de-configuracao.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';
import { FormularioDeConfiguracao } from './formulario-de-configuracao';

const estado = {
  publicada: { version: 2, config: CONFIG_PADRAO_DO_TOTEM },
  rascunho: null,
  efetiva: CONFIG_PADRAO_DO_TOTEM,
  configVersion: 2,
  totemEmSessao: false,
};

describe('FormularioDeConfiguracao', () => {
  it('oferece as quatro cores como escolha, nunca campo de hex', () => {
    render(<FormularioDeConfiguracao estado={estado} kioskDeviceId="k1" />);

    for (const accent of ['AZUL', 'VERDE', 'LARANJA', 'ROXO']) {
      expect(screen.getByRole('radio', { name: new RegExp(accent, 'i') })).toBeInTheDocument();
    }

    expect(screen.queryByLabelText(/hex|cor personalizada/i)).not.toBeInTheDocument();
  });

  it('incremento e teto aparecem como texto fixo, nao como campo', () => {
    render(<FormularioDeConfiguracao estado={estado} kioskDeviceId="k1" />);

    expect(screen.getByText(/30 s/)).toBeInTheDocument();
    expect(screen.getByText(/99 s/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /incremento|teto/i })).not.toBeInTheDocument();
  });

  it('diz que o botao do aluno vence o padrao da unidade', () => {
    render(<FormularioDeConfiguracao estado={estado} kioskDeviceId="k1" />);

    expect(screen.getByText(/vence|prevalece/i)).toBeInTheDocument();
  });

  it('com totem em sessao, avisa que a publicacao aguarda', () => {
    render(
      <FormularioDeConfiguracao
        estado={{ ...estado, totemEmSessao: true, rascunho: { config: CONFIG_PADRAO_DO_TOTEM } }}
        kioskDeviceId="k1"
      />,
    );

    expect(screen.getByText(/aguardando o totem ficar livre/i)).toBeInTheDocument();
  });

  it('sem rascunho, nao oferece publicar nem descartar', () => {
    render(<FormularioDeConfiguracao estado={estado} kioskDeviceId="k1" />);

    expect(screen.queryByRole('button', { name: /publicar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /descartar/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @arenahub/admin-web test -- formulario-de-configuracao`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar as telas**

Seguir o padrão de `apps/admin-web/app/(protected)/operations/devices/` (lista) e de um formulário existente com Server Action, p.ex. `students/novo`. Pontos obrigatórios:

- **Três abas:** Marca (nome da academia, nome da unidade, slogan, logotipo URL), Aparência (accent como quatro amostras via `radiogroup`, interruptor de alto contraste), Sessão (duração 45/60/90/120 como escolha; incremento e teto como texto).
- **Barra de estado fixa** com: *sem alterações* · *rascunho não publicado* · *aguardando o totem ficar livre*.
- **Publicar e Descartar só quando há rascunho.** Descartar pede confirmação — é destrutivo e sem desfazer.
- **Herança visível:** campo não sobrescrito nesta camada mostra o valor herdado e de onde vem.
- **Design `DS-PAINEL.md`**, não `DS-TOTEM` — os tokens de 7:1 e alvo de 88 px são do `apps/kiosk`.
- **`Toast`** para retorno, nunca `Alert`.
- Sem hex literal — usar tokens (ADR-026, e a lint proíbe).

Server Actions em `app/actions/kiosk-config.ts`: `salvarRascunhoAction`, `publicarAction`, `descartarAction` — cada uma chamando a rota correspondente e revalidando o path.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @arenahub/admin-web test -- formulario-de-configuracao navegacao`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin-web/app/(protected)/operations/kiosks" apps/admin-web/app/actions/kiosk-config.ts "apps/admin-web/app/(protected)/navegacao.tsx" "apps/admin-web/app/(protected)/navegacao.test.tsx"
git commit -m "feat(admin-web): painel Personalizacao do totem em /operations/kiosks

Tres abas -- Marca, Aparencia e Sessao. Accent e escolha entre quatro,
nunca hex livre; incremento e teto sao literais do contrato e aparecem
como texto. O botao de alto contraste do aluno vence o padrao da unidade,
e a tela diz isso.

refs #151"
```

---

### Task 6: E2E do aceite

**Files:**
- Create: `apps/admin-web/tests/e2e/personalizacao-do-totem.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 5

- [ ] **Step 1: Escrever o E2E**

O aceite literal da issue: *"o gerente altera marca, cor e sessão, publica, e o totem reflete a mudança sem interromper aluno em sessão. Descartar restaura o publicado."*

```ts
// apps/admin-web/tests/e2e/personalizacao-do-totem.spec.ts
import { expect, test } from '@playwright/test';

test.describe('F50 -- personalizacao do totem', () => {
  test('altera, publica e o totem passa a servir a versao nova', async ({ page, request }) => {
    await page.goto('/operations/kiosks');
    await page.getByRole('link', { name: /TOTEM-1/i }).click();

    await page.getByRole('tab', { name: /marca/i }).click();
    await page.getByLabel(/slogan/i).fill('Treine com a gente');

    await page.getByRole('tab', { name: /aparencia/i }).click();
    await page.getByRole('radio', { name: /verde/i }).check();

    await page.getByRole('button', { name: /salvar/i }).click();
    await expect(page.getByText(/rascunho nao publicado/i)).toBeVisible();

    await page.getByRole('button', { name: /publicar/i }).click();
    await expect(page.getByText(/publicad/i)).toBeVisible();

    // A prova real: a rota do TOTEM passa a servir o que foi publicado.
    // (helper de assinatura HMAC, mesmo molde do E2E da F49)
    const config = await pedirConfigDoTotem(request);

    expect(config.config.marca.slogan).toBe('Treine com a gente');
    expect(config.config.aparencia.accent).toBe('VERDE');
  });

  test('descartar restaura o publicado', async ({ page }) => {
    await page.goto('/operations/kiosks');
    await page.getByRole('link', { name: /TOTEM-1/i }).click();

    await page.getByRole('tab', { name: /marca/i }).click();
    await page.getByLabel(/slogan/i).fill('rascunho que sera jogado fora');
    await page.getByRole('button', { name: /salvar/i }).click();

    await page.getByRole('button', { name: /descartar/i }).click();
    await page.getByRole('button', { name: /confirmar/i }).click();

    await expect(page.getByText(/sem alteracoes/i)).toBeVisible();
    await expect(page.getByLabel(/slogan/i)).not.toHaveValue('rascunho que sera jogado fora');
  });

  test('com totem em sessao, a publicacao aguarda', async ({ page, request }) => {
    // Abre uma sessao no totem pela rota do kiosk antes de publicar.
    await abrirSessaoNoTotem(request);

    await page.goto('/operations/kiosks');
    await page.getByRole('link', { name: /TOTEM-1/i }).click();
    await page.getByRole('tab', { name: /sessao/i }).click();
    await page.getByRole('radio', { name: /90/ }).check();
    await page.getByRole('button', { name: /salvar/i }).click();
    await page.getByRole('button', { name: /publicar/i }).click();

    await expect(page.getByText(/aguardando o totem ficar livre/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Rodar**

Run: `pnpm --filter @arenahub/admin-web test:e2e -- personalizacao-do-totem`
Expected: PASS. Depende do seed ter um `KioskDevice` de código `TOTEM-1` — se não tiver, acrescentar ao `packages/database/prisma/seed.ts` (ADR-020: dado de desenvolvimento vem de seed).

- [ ] **Step 3: Commit**

```bash
git add apps/admin-web/tests/e2e/personalizacao-do-totem.spec.ts packages/database/prisma/seed.ts
git commit -m "test(e2e): aceite da F50 -- altera, publica, descarta restaura

refs #151"
```

---

### Task 7: Documentação e fechamento

**Files:**
- Modify: `docs/design/DS-TOTEM.md` §7.2 — a mecânica da Decisão 3
- Modify: `docs/DEVELOPMENT.md` — seção MVP 3.5, o que a F50 cumpriu
- Modify: `docs/STATUS.md` — linha da F50 no Índice Fatia ↔ SPEC + a discrepância do DS-TOTEM
- Modify: `docs/TESTING.md` — evidência da SPEC-050

- [ ] **Step 1: DS-TOTEM §7.2**

Acrescentar ao fim de §7.2, **sem inventar §11**:

```markdown
### Publicar cria versão nova e reinicia a superfície

Configuração publicada **não é aplicada em runtime**: `publish` cria uma versão nova e imutável, o
heartbeat devolve `configVersion`, e o totem que detecta divergência **reinicia** — fora de sessão,
ou logo que a sessão em curso encerra. É o que mantém verdadeiro o princípio de resolver accent e
moldura uma vez, no boot ([ADR-042](../DECISIONS.md#adr-042), Decisão 3).

Custo aceito: a mudança não é instantânea. Com aluno usando o totem, o painel mostra *"aguardando o
totem ficar livre"* — estado de publicação, não erro.
```

- [ ] **Step 2: Registrar a discrepância no STATUS.md**

Uma nota curta, no lugar onde o STATUS registra pendências de documentação:

```markdown
⚠️ **O ADR-042 referencia seções que o `DS-TOTEM.md` não tem.** O ADR declara *"Alcança
`docs/design/DS-TOTEM.md` §11 regra 9 e §12 pendências 1 e 4"* e cita ainda §9.1, §11.2, §11.3,
§11.5 a §11.8 e §11.10 — mas o arquivo vai de §1 a §8. Na F50 (26/08/2026) o PI decidiu **registrar
e não editar**: a mecânica da Decisão 3 entrou em **§7.2**, que é a seção real de configuração, e
nenhuma seção foi inventada. Alinhar ADR e documento é tarefa do Cowork.
```

- [ ] **Step 3: DEVELOPMENT.md e TESTING.md**

Tabela do que a F50 cumpriu, no molde da F49. Evidência por SPEC-050 no `TESTING.md` (a linha do PR nasce com `—` e é preenchida **depois** do merge).

- [ ] **Step 4: Gate local completo**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`
Expected: tudo verde. `pnpm test` **não** roda integração — os dois comandos são obrigatórios.

- [ ] **Step 5: Commit e PR**

```bash
git add docs/
git commit -m "docs: F50 -- mecanica de publicacao no DS-TOTEM 7.2 e registro da discrepancia

refs #151"
```

PR com `refs #151` (nunca `closes` — forjaria o aceite do PI).

---

## Self-Review

**Cobertura da spec:** §3 modelo → Task 1. §4 API → Tasks 2 e 3. §5 reinício → Task 4. §6 painel → Task 5. §7 testes → distribuídos, com o E2E na Task 6. §8 aceite → Task 6. §9 riscos → Task 1 (índice nas duas direções), Task 2 (sessão expirada), Task 3 (módulo separado), Task 7 (discrepância registrada). Decisão 1 do PI → Task 7. Decisões 2 e 3 → escopo e rota, refletidos em todas as tasks.

**Tipos consistentes:** `EstadoDaConfiguracao` definida na Task 2 e consumida com o mesmo nome nas Tasks 3 e 5. `decidirReinicio` com a mesma assinatura na Task 4. `proximaVersao` e `totemOcupado` exportadas na Task 2 e testadas lá mesmo.

**Sem placeholders:** todo passo de código tem código. A Task 5 descreve a tela em requisitos em vez de JSX completo — deliberado: o JSX depende dos componentes de `packages/ui` e do padrão de formulário existente, que o implementador lê no repositório; os testes da Task 5 fixam o comportamento exigido, que é o que não pode variar.
