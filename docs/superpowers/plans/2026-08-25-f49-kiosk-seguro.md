# F49 — Kiosk seguro, provisionamento e sessão efêmera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer nascer a superfície `apps/kiosk` com dispositivo provisionado, configuração lida desde o primeiro commit e sessão de aluno que expira e limpa tudo — provando que dado do aluno A nunca chega ao totem do aluno B.

**Architecture:** O provisionamento do totem é **cópia estrutural** do `edge-auth` (HMAC assinado, janela de relógio, nonce anti-replay, revogação imediata), já provado em campo na F8/F11. Sobre ele, uma sessão de aluno curta e opaca, cuja chave de busca (`cpfHash`) é escopada por tenant — o isolamento A/B sai por construção, não por checagem. A superfície Next.js lê `KioskConfiguration` desde o primeiro commit (ADR-042, Decisão 0) e nunca fixa valor em tela.

**Tech Stack:** NestJS + Prisma (API), Next.js PWA (kiosk), Jest (unit e integração), Playwright (E2E), `packages/ui` (tokens e accent).

**Spec:** [`docs/superpowers/specs/2026-08-25-f49-kiosk-seguro-design.md`](../specs/2026-08-25-f49-kiosk-seguro-design.md)

## Global Constraints

- **Idioma:** documentação, commits e texto de interface em **pt-BR**; código e identificadores em **inglês**. Comentário de código em pt-BR sem acento (padrão do `edge-auth`).
- **`tenant_id` em toda entidade de negócio; `gym_unit_id` quando o dado é físico.** O tenant vem **da credencial autenticada**, nunca do corpo da requisição (Regra de arquitetura 2).
- **Proibido hex literal em código de UI.** O `Totem.dc.html` é protótipo (ADR-026); cor sai de token em `packages/ui/tokens` ou de `resolveAccent()`.
- **Proibido `any` implícito; `unknown` antes de validar dado externo; Zod no boundary.**
- **Nunca logar CPF, template biométrico, token de pagamento ou PII em erro.**
- **Dinheiro é inteiro na menor unidade monetária** — o valor da fatura trafega em centavos.
- **Contraste mínimo 7:1** no totem (`DS-TOTEM.md` §11.3), contra os 4.5 do painel.
- **Alvo de toque mínimo 88 px; texto mínimo 19 px; bordas de 2 px** (`DS-TOTEM.md` §2.4, §2.2, §2.3).
- **Antes de todo commit:** `pnpm lint`, `pnpm typecheck` e `pnpm test:report` (o `pnpm test` sozinho **não** roda integração).
- **Toda mensagem ao usuário via Toast**, nunca `Alert`.

---

### Task 1: Modelos de dados do kiosk

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_kiosk/migration.sql` (gerada)
- Modify: `packages/database/prisma/seed.ts`

**Interfaces:**
- Consumes: `Tenant`, `GymUnit`, `Student` (já existem no schema)
- Produces: modelos `KioskDevice`, `KioskCredential`, `KioskConfiguration`, `KioskReplayNonce`, `KioskSession` e enum `KioskDeviceStatus`; o seed passa a criar um `KioskDevice` de código `TOTEM01` com uma `KioskConfiguration` publicada `version: 1`

- [ ] **Step 1: Acrescentar os modelos ao schema**

Em `packages/database/prisma/schema.prisma`, ao lado dos modelos de Edge (por volta da linha 1525):

```prisma
enum KioskDeviceStatus {
  ACTIVE
  SUSPENDED
}

/// Totem de autoatendimento na recepcao. Dado fisico: exige `gym_unit_id`
/// (regra de arquitetura no 2).
model KioskDevice {
  id                String            @id @default(uuid()) @db.Uuid
  tenantId          String            @map("tenant_id") @db.Uuid
  gymUnitId         String            @map("gym_unit_id") @db.Uuid
  /// Identificador estavel escolhido na instalacao. Aparece no painel.
  code              String
  status            KioskDeviceStatus @default(ACTIVE)
  agentVersion      String?           @map("agent_version")
  lastHeartbeat     DateTime?         @map("last_heartbeat")
  /// Diferenca entre o relogio do totem e o da nuvem, em ms. Mesma razao do
  /// `EdgeNode`: relogio torto e causa comum de 401 em campo.
  clockOffsetMs     Int?              @map("clock_offset_ms")
  /// Versao de configuracao carregada no boot. O heartbeat compara com a
  /// publicada para decidir reinicio (ADR-042, Decisao 3 -- usado pela F50).
  bootConfigVersion Int?              @map("boot_config_version")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")

  tenant      Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  credentials KioskCredential[]
  sessions    KioskSession[]

  @@unique([tenantId, code])
  @@index([tenantId, gymUnitId])
  @@map("kiosk_devices")
}

/// Credencial HMAC do totem. Espelha `EdgeCredential` -- mesmo mecanismo,
/// tabela propria: totem e Edge tem ciclo de vida e revogacao independentes.
model KioskCredential {
  id              String    @id @default(uuid()) @db.Uuid
  tenantId        String    @map("tenant_id") @db.Uuid
  kioskDeviceId   String    @map("kiosk_device_id") @db.Uuid
  /// Vai no header `X-Kiosk-Key-Id`. Publico: identifica, nao autentica.
  keyId           String    @unique @map("key_id")
  /// Segredo cifrado. NUNCA em log, nem mascarado.
  encryptedSecret String    @map("encrypted_secret")
  activeFrom      DateTime  @map("active_from")
  expiresAt       DateTime? @map("expires_at")
  /// Revogacao e IMEDIATA: preenchido, a credencial para de valer no ato.
  revokedAt       DateTime? @map("revoked_at")
  createdAt       DateTime  @default(now()) @map("created_at")

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kioskDevice KioskDevice @relation(fields: [kioskDeviceId], references: [id], onDelete: Cascade)

  @@index([kioskDeviceId])
  @@map("kiosk_credentials")
}

/// Configuracao do totem em tres camadas (ADR-042, Decisao 8): a mais
/// especifica vence. A nulabilidade E a camada -- linha de tenant tem os dois
/// ids nulos; de unidade, so `kiosk_device_id` nulo; de dispositivo, ambos.
///
/// `version` e `published_at` nascem AQUI mesmo sem a F49 escrever: rascunho
/// e a versao sem `published_at`, e acrescentar coluna depois obrigaria
/// migracao de dado ja publicado.
model KioskConfiguration {
  id            String    @id @default(uuid()) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  gymUnitId     String?   @map("gym_unit_id") @db.Uuid
  kioskDeviceId String?   @map("kiosk_device_id") @db.Uuid
  version       Int
  publishedAt   DateTime? @map("published_at")
  payload       Json
  createdAt     DateTime  @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, gymUnitId, kioskDeviceId, version])
  @@index([tenantId, publishedAt])
  @@map("kiosk_configurations")
}

/// Nonce de replay do totem. Tabela propria: `ReplayNonce` prende
/// `edge_node_id` com FK obrigatoria, e totem nao e Edge.
model KioskReplayNonce {
  id        String   @id @default(uuid()) @db.Uuid
  keyId     String   @map("key_id")
  /// SHA-256 do nonce recebido. O valor bruto nao precisa ser guardado.
  nonceHash String   @map("nonce_hash")
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([keyId, nonceHash])
  @@index([expiresAt])
  @@map("kiosk_replay_nonces")
}

/// Sessao efemera do aluno no totem.
///
/// Guarda o HASH do token, nao o token: sessao de 60 s que precisa morrer no
/// ato do "Encerrar" nao combina com JWT auto-contido, que seguiria valido
/// ate expirar mesmo depois de encerrada.
model KioskSession {
  id            String    @id @default(uuid()) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  kioskDeviceId String    @map("kiosk_device_id") @db.Uuid
  studentId     String    @map("student_id") @db.Uuid
  tokenHash     String    @unique @map("token_hash")
  expiresAt     DateTime  @map("expires_at")
  endedAt       DateTime? @map("ended_at")
  /// `MANUAL`, `TIMEOUT`, `ERROR` ou `FOCUS_LOST` (`M4-FR-019`).
  endedReason   String?   @map("ended_reason")
  createdAt     DateTime  @default(now()) @map("created_at")

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kioskDevice KioskDevice @relation(fields: [kioskDeviceId], references: [id], onDelete: Cascade)
  student     Student     @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@index([kioskDeviceId, endedAt])
  @@map("kiosk_sessions")
}
```

Acrescentar às listas de relação existentes:

```prisma
// dentro de model Tenant, junto das outras relacoes:
  kioskDevices        KioskDevice[]
  kioskCredentials    KioskCredential[]
  kioskConfigurations KioskConfiguration[]
  kioskSessions       KioskSession[]

// dentro de model Student:
  kioskSessions KioskSession[]
```

- [ ] **Step 2: Gerar a migration e conferir que ela aplica**

```bash
pnpm --filter @arenahub/database exec prisma migrate dev --name kiosk --create-only
pnpm --filter @arenahub/database exec prisma migrate deploy
```

Esperado: quatro tabelas criadas, sem erro. **Não** usar `migrate reset` — o Prisma exige consentimento humano para isso.

- [ ] **Step 3: Semear um totem e a configuração padrão**

Em `packages/database/prisma/seed.ts`, depois do bloco que cria o Edge Node, acrescentar:

```ts
const totem = await db.kioskDevice.upsert({
  where: { tenantId_code: { tenantId: tenant.id, code: 'TOTEM01' } },
  update: {},
  create: {
    tenantId: tenant.id,
    gymUnitId: unidade.id,
    code: 'TOTEM01',
  },
});

// Configuracao de UNIDADE, versao 1, ja publicada: e o padrao que a F49 le
// enquanto a F50 nao existe para escrever (ADR-042, Decisao 0).
await db.kioskConfiguration.upsert({
  where: {
    tenantId_gymUnitId_kioskDeviceId_version: {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      kioskDeviceId: null,
      version: 1,
    },
  },
  update: {},
  create: {
    tenantId: tenant.id,
    gymUnitId: unidade.id,
    version: 1,
    publishedAt: new Date(),
    payload: CONFIG_PADRAO_DO_TOTEM,
  },
});
```

`CONFIG_PADRAO_DO_TOTEM` vem da Task 2 — importar de `@arenahub/api-contracts`.

- [ ] **Step 4: Rodar o seed e conferir**

```bash
pnpm --filter @arenahub/database seed
```

Esperado: sem erro; `TOTEM01` criado com uma configuração publicada.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations packages/database/prisma/seed.ts
git commit -m "feat(database): modelos de kiosk — dispositivo, credencial, configuracao e sessao (refs #150)"
```

---

### Task 2: Contrato de configuração do totem

**Files:**
- Create: `packages/api-contracts/src/kiosk-config.ts`
- Create: `packages/api-contracts/src/kiosk-config.spec.ts`
- Modify: `packages/api-contracts/src/index.ts`

**Interfaces:**
- Consumes: Zod (já é dependência do pacote)
- Produces:
  - `kioskConfigSchema: z.ZodType<KioskConfig>`
  - `type KioskConfig`
  - `CONFIG_PADRAO_DO_TOTEM: KioskConfig`
  - `resolverConfig(camadas: KioskConfigLayers): KioskConfig` — função **pura**
  - `type KioskConfigLayers = { tenant?: unknown; unidade?: unknown; dispositivo?: unknown }`

O contrato cobre o `DS-TOTEM.md` §7.2 **inteiro**, mesmo que a F49 só leia: a F50 escreve nele sem reabrir a tabela.

- [ ] **Step 1: Escrever o teste que falha**

Criar `packages/api-contracts/src/kiosk-config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { CONFIG_PADRAO_DO_TOTEM, resolverConfig } from './kiosk-config.js';

describe('resolverConfig -- tres camadas, a mais especifica vence', () => {
  it('devolve o padrao quando nenhuma camada existe', () => {
    expect(resolverConfig({})).toEqual(CONFIG_PADRAO_DO_TOTEM);
  });

  it('a unidade sobrescreve o tenant', () => {
    const resultado = resolverConfig({
      tenant: { sessao: { duracaoSegundos: 45 } },
      unidade: { sessao: { duracaoSegundos: 90 } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(90);
  });

  it('o dispositivo sobrescreve a unidade', () => {
    const resultado = resolverConfig({
      unidade: { sessao: { duracaoSegundos: 90 } },
      dispositivo: { sessao: { duracaoSegundos: 120 } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(120);
  });

  it('campo ausente na camada especifica NAO apaga o da camada de baixo', () => {
    const resultado = resolverConfig({
      unidade: { marca: { nomeDaAcademia: 'Arena Centro' } },
      dispositivo: { sessao: { duracaoSegundos: 120 } },
    });

    // O dispositivo falou so de sessao -- a marca da unidade sobrevive.
    expect(resultado.marca.nomeDaAcademia).toBe('Arena Centro');
    expect(resultado.sessao.duracaoSegundos).toBe(120);
  });

  it('camada invalida e IGNORADA, nao derruba a resolucao', () => {
    const resultado = resolverConfig({
      unidade: { sessao: { duracaoSegundos: 'noventa' } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(
      CONFIG_PADRAO_DO_TOTEM.sessao.duracaoSegundos,
    );
  });

  it('nenhum modulo vem habilitado na F49', () => {
    expect(CONFIG_PADRAO_DO_TOTEM.modulos).toEqual({
      pagamento: false,
      historicoDePagamentos: false,
      avaliacao: false,
      evolucao: false,
      historicoDeAvaliacoes: false,
      ranking: false,
    });
  });

  it('o unico metodo de identificacao habilitado e o CPF', () => {
    expect(CONFIG_PADRAO_DO_TOTEM.identificacao).toEqual({
      cpf: true,
      facial: false,
      qrCodeDoApp: false,
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
pnpm --filter @arenahub/api-contracts test -- kiosk-config
```

Esperado: FAIL — `Cannot find module './kiosk-config.js'`.

- [ ] **Step 3: Implementar o contrato**

Criar `packages/api-contracts/src/kiosk-config.ts`:

```ts
import { z } from 'zod';

/**
 * Contrato de configuracao do totem.
 *
 * Cobre o `DS-TOTEM.md` §7.2 INTEIRO, embora a F49 so leia: a F50 escreve
 * nele, e um contrato parcial obrigaria a reabrir a tabela (ADR-042,
 * Decisao 0).
 *
 * O que NAO entra aqui e tao importante quanto o que entra -- a lista
 * fechada do nao-configuravel esta na Decisao 6 do ADR-042: tipografia,
 * escala, alvo de toque, contraste 7:1, light mode, comportamento de
 * encerramento, a frase publica de DENY, a assinatura do ArenaHub.
 */

/** Escolha entre quatro, nunca hex livre (ADR-042, Decisao 6). */
export const ACCENTS_DO_TOTEM = ['AZUL', 'VERDE', 'LARANJA', 'ROXO'] as const;

export const kioskConfigSchema = z.object({
  marca: z.object({
    nomeDaAcademia: z.string().min(1),
    nomeDaUnidade: z.string().min(1),
    slogan: z.string(),
    logotipoUrl: z.string().url().nullable(),
  }),
  aparencia: z.object({
    accent: z.enum(ACCENTS_DO_TOTEM),
    /** Padrao de BOOT da unidade. O botao do aluno vence durante a sessao. */
    altoContrastePadrao: z.boolean(),
  }),
  sessao: z.object({
    duracaoSegundos: z.union([
      z.literal(45),
      z.literal(60),
      z.literal(90),
      z.literal(120),
    ]),
    incrementoSegundos: z.literal(30),
    tetoSegundos: z.literal(99),
    avisoSonoroNaRecusa: z.boolean(),
  }),
  identificacao: z.object({
    cpf: z.boolean(),
    facial: z.boolean(),
    qrCodeDoApp: z.boolean(),
  }),
  modulos: z.object({
    pagamento: z.boolean(),
    historicoDePagamentos: z.boolean(),
    avaliacao: z.boolean(),
    evolucao: z.boolean(),
    historicoDeAvaliacoes: z.boolean(),
    ranking: z.boolean(),
  }),
});

export type KioskConfig = z.infer<typeof kioskConfigSchema>;

/**
 * O padrao que a F49 entrega enquanto a F50 nao existe para escrever.
 *
 * Modulo desligado nao e omissao: e a Decisao 5 do ADR-042 (trava 2) --
 * modulo cuja fatia de origem nao entregou NAO aparece. Na F49 nenhum
 * entregou. `facial` e `qrCodeDoApp` estao desligados por decisao do PI de
 * 25/08/2026.
 */
export const CONFIG_PADRAO_DO_TOTEM: KioskConfig = {
  marca: {
    nomeDaAcademia: 'ArenaHub',
    nomeDaUnidade: 'Unidade',
    slogan: '',
    logotipoUrl: null,
  },
  aparencia: {
    accent: 'AZUL',
    altoContrastePadrao: false,
  },
  sessao: {
    duracaoSegundos: 60,
    incrementoSegundos: 30,
    tetoSegundos: 99,
    avisoSonoroNaRecusa: true,
  },
  identificacao: {
    cpf: true,
    facial: false,
    qrCodeDoApp: false,
  },
  modulos: {
    pagamento: false,
    historicoDePagamentos: false,
    avaliacao: false,
    evolucao: false,
    historicoDeAvaliacoes: false,
    ranking: false,
  },
};

export interface KioskConfigLayers {
  readonly tenant?: unknown;
  readonly unidade?: unknown;
  readonly dispositivo?: unknown;
}

/** Mescla um nivel de profundidade: `sessao` inteira nao apaga `marca`. */
function mesclar(base: KioskConfig, camada: unknown): KioskConfig {
  const parcial = kioskConfigSchema.deepPartial().safeParse(camada);

  // Camada invalida e IGNORADA em vez de derrubar a resolucao: um payload
  // torto no banco nao pode apagar a tela do totem.
  if (!parcial.success) return base;

  const dados = parcial.data;

  return {
    marca: { ...base.marca, ...dados.marca },
    aparencia: { ...base.aparencia, ...dados.aparencia },
    sessao: { ...base.sessao, ...dados.sessao },
    identificacao: { ...base.identificacao, ...dados.identificacao },
    modulos: { ...base.modulos, ...dados.modulos },
  };
}

/**
 * Resolve as tres camadas (ADR-042, Decisao 8) -- a mais especifica vence.
 *
 * PURA: sem banco, sem relogio, sem rede.
 */
export function resolverConfig(camadas: KioskConfigLayers): KioskConfig {
  return [camadas.tenant, camadas.unidade, camadas.dispositivo].reduce<KioskConfig>(
    (acumulado, camada) => (camada === undefined ? acumulado : mesclar(acumulado, camada)),
    CONFIG_PADRAO_DO_TOTEM,
  );
}
```

Em `packages/api-contracts/src/index.ts`, exportar junto dos demais:

```ts
export {
  ACCENTS_DO_TOTEM,
  CONFIG_PADRAO_DO_TOTEM,
  kioskConfigSchema,
  resolverConfig,
} from './kiosk-config.js';
export type { KioskConfig, KioskConfigLayers } from './kiosk-config.js';
```

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
pnpm --filter @arenahub/api-contracts test -- kiosk-config
```

Esperado: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add packages/api-contracts/src/kiosk-config.ts packages/api-contracts/src/kiosk-config.spec.ts packages/api-contracts/src/index.ts
git commit -m "feat(contracts): contrato de configuracao do totem em tres camadas (refs #150)"
```

---

### Task 3: Autenticação do dispositivo por HMAC

**Files:**
- Create: `apps/api/src/modules/kiosk-auth/kiosk-auth.service.ts`
- Create: `apps/api/src/modules/kiosk-auth/kiosk-auth.guard.ts`
- Create: `apps/api/src/modules/kiosk-auth/kiosk-route.decorator.ts`
- Create: `apps/api/src/modules/kiosk-auth/kiosk-auth.module.ts`
- Test: `apps/api/test/integration/kiosk-auth.int-spec.ts`

**Interfaces:**
- Consumes: `assinar`, `assinaturaConfere`, `calcularHashDoNonce`, `timestampEstaNaJanela` de `@arenahub/api-contracts`; `CifradorDeSegredo` de `../auth/segredo-cifrado.js`; `PrismaService`
- Produces:
  - `interface ContextoDoKiosk { tenantId: string; gymUnitId: string; kioskDeviceId: string; keyId: string }`
  - `KioskAuthService.verificar(recebida, agora): Promise<ResultadoDaVerificacao>`
  - `KioskAuthService.cifrarSegredo(segredo: string): string`
  - `@KioskRoute()` — decorator de rota
  - `request.kioskContext` preenchido pelo guard
  - `CABECALHOS_DO_KIOSK = { keyId: 'x-kiosk-key-id', timestamp: 'x-kiosk-timestamp', nonce: 'x-kiosk-nonce', signature: 'x-kiosk-signature' }`

**Nota de reuso:** o mecanismo é o mesmo do `edge-auth`; a tabela e os headers são próprios porque totem e Edge têm ciclo de vida e revogação independentes. Ler `apps/api/src/modules/edge-auth/edge-auth.service.ts` antes de escrever — **a ordem das checagens não é estética** e deve ser preservada.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/integration/kiosk-auth.int-spec.ts`. Usar `apps/api/test/integration/edge-auth.int-spec.ts` como molde de montagem (dois tenants, A e B):

```ts
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F49, Task 3 -- assinatura do totem.
 *
 * Cada teste e um ATAQUE. O caminho feliz e um; os outros seis sao o motivo
 * de o mecanismo existir.
 */
describe('F49 -- assinatura do totem', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const CORPO = { agentVersion: '0.1.0', localTimeMs: 0 };

  const assinarPedido = (
    corpo: unknown,
    ajuste: { timestamp?: number; nonce?: string } = {},
  ): Record<string, string> => {
    const body = JSON.stringify(corpo);
    const timestamp = ajuste.timestamp ?? Math.floor(Date.now() / 1000);
    const nonce = ajuste.nonce ?? randomUUID();

    return {
      'x-kiosk-key-id': totem.keyId,
      'x-kiosk-timestamp': String(timestamp),
      'x-kiosk-nonce': nonce,
      'x-kiosk-signature': assinar(
        {
          keyId: totem.keyId,
          timestamp,
          nonce,
          method: 'POST',
          pathAndQuery: '/api/v1/kiosk/heartbeat',
          body,
        },
        totem.segredo,
      ),
    };
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-${sufixo}`,
        legalName: 'Kiosk LTDA',
        displayName: 'Kiosk',
      },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const dispositivo = await db.kioskDevice.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId: tenant.id,
        kioskDeviceId: dispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });

    Object.assign(totem, {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      kioskDeviceId: dispositivo.id,
      keyId,
      segredo,
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: totem.tenantId } });
    await app.close();
  });

  it('aceita requisicao assinada corretamente', async () => {
    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO))
      .send(CORPO)
      .expect(200);
  });

  it('recusa corpo adulterado depois de assinado', async () => {
    const cabecalhos = assinarPedido(CORPO);

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(cabecalhos)
      .send({ ...CORPO, agentVersion: '9.9.9' })
      .expect(401);
  });

  it('recusa relogio fora da janela', async () => {
    const antigo = Math.floor(Date.now() / 1000) - 400;

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, { timestamp: antigo }))
      .send(CORPO)
      .expect(401);
  });

  it('recusa nonce repetido', async () => {
    const nonce = randomUUID();

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, { nonce }))
      .send(CORPO)
      .expect(200);

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO, { nonce }))
      .send(CORPO)
      .expect(401);
  });

  it('recusa chave desconhecida', async () => {
    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set({ ...assinarPedido(CORPO), 'x-kiosk-key-id': 'nao-existe' })
      .send(CORPO)
      .expect(401);
  });

  it('recusa credencial revogada', async () => {
    await db.kioskCredential.updateMany({
      where: { keyId: totem.keyId },
      data: { revokedAt: new Date() },
    });

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(CORPO))
      .send(CORPO)
      .expect(401);

    await db.kioskCredential.updateMany({
      where: { keyId: totem.keyId },
      data: { revokedAt: null },
    });
  });

  it('recusa requisicao sem assinatura', async () => {
    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .send(CORPO)
      .expect(401);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @arenahub/api test:integration -- kiosk-auth
```

Esperado: FAIL — o módulo `kiosk-auth` não existe.

- [ ] **Step 3: Implementar o serviço, o guard e o decorator**

`apps/api/src/modules/kiosk-auth/kiosk-auth.service.ts` — copiar a estrutura de `edge-auth.service.ts`, trocando `edgeCredential` por `kioskCredential`, `edgeNode` por `kioskDevice` e o contexto:

```ts
import { Injectable } from '@nestjs/common';
import {
  assinar,
  assinaturaConfere,
  calcularHashDoNonce,
  timestampEstaNaJanela,
  type MotivoDeRecusa,
} from '@arenahub/api-contracts';

import { carregarConfig } from '../../config/env.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { CifradorDeSegredo } from '../auth/segredo-cifrado.js';

/** Identidade do totem, resolvida EXCLUSIVAMENTE da credencial. */
export interface ContextoDoKiosk {
  tenantId: string;
  gymUnitId: string;
  kioskDeviceId: string;
  keyId: string;
}

export type ResultadoDaVerificacao =
  | { ok: true; contexto: ContextoDoKiosk }
  | { ok: false; motivo: MotivoDeRecusa };

export interface RequisicaoAssinadaRecebida {
  keyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
  method: string;
  pathAndQuery: string;
  body: string;
}

/**
 * Verifica requisicao assinada do totem.
 *
 * MESMA ordem de checagem do `EdgeAuthService`, e ela NAO e estetica:
 *   1. formato e janela de relogio -- barato, descarta ruido antes do banco;
 *   2. credencial ativa;
 *   3. assinatura -- so depois de ter o segredo;
 *   4. nonce POR ULTIMO. Gravar antes de validar a assinatura deixaria
 *      qualquer um encher a tabela com lixo assinado por chave inventada.
 */
@Injectable()
export class KioskAuthService {
  private readonly cifrador: CifradorDeSegredo;

  constructor(private readonly db: PrismaService) {
    this.cifrador = new CifradorDeSegredo(carregarConfig().mfa.chave);
  }

  async verificar(
    recebida: RequisicaoAssinadaRecebida,
    agora: Date,
  ): Promise<ResultadoDaVerificacao> {
    if (!recebida.keyId || !recebida.signature || !recebida.nonce || !recebida.timestamp) {
      return { ok: false, motivo: 'EDGE_SIGNATURE_MISSING' };
    }

    const timestamp = Number(recebida.timestamp);

    if (!Number.isInteger(timestamp)) {
      return { ok: false, motivo: 'EDGE_SIGNATURE_INVALID' };
    }

    if (!timestampEstaNaJanela(timestamp, Math.floor(agora.getTime() / 1000))) {
      return { ok: false, motivo: 'EDGE_TIMESTAMP_OUT_OF_WINDOW' };
    }

    const credencial = await this.db.kioskCredential.findUnique({
      where: { keyId: recebida.keyId },
      include: {
        kioskDevice: { select: { id: true, tenantId: true, gymUnitId: true, status: true } },
      },
    });

    if (!credencial) return { ok: false, motivo: 'EDGE_KEY_UNKNOWN' };

    if (credencial.revokedAt !== null || credencial.kioskDevice.status !== 'ACTIVE') {
      return { ok: false, motivo: 'EDGE_KEY_REVOKED' };
    }

    if (credencial.activeFrom > agora) {
      return { ok: false, motivo: 'EDGE_KEY_UNKNOWN' };
    }

    if (credencial.expiresAt !== null && credencial.expiresAt <= agora) {
      return { ok: false, motivo: 'EDGE_KEY_REVOKED' };
    }

    const segredo = this.decifrarSegredo(credencial.encryptedSecret);

    const esperada = assinar(
      {
        keyId: recebida.keyId,
        timestamp,
        nonce: recebida.nonce,
        method: recebida.method,
        pathAndQuery: recebida.pathAndQuery,
        body: recebida.body,
      },
      segredo,
    );

    if (!assinaturaConfere(esperada, recebida.signature)) {
      return { ok: false, motivo: 'EDGE_SIGNATURE_INVALID' };
    }

    const inedito = await this.registrarNonce(recebida.keyId, recebida.nonce, agora);

    if (!inedito) return { ok: false, motivo: 'EDGE_REPLAY_DETECTED' };

    return {
      ok: true,
      contexto: {
        // Tenant e unidade saem da CREDENCIAL, nunca do corpo -- regra de
        // arquitetura no 2.
        tenantId: credencial.kioskDevice.tenantId,
        gymUnitId: credencial.kioskDevice.gymUnitId,
        kioskDeviceId: credencial.kioskDeviceId,
        keyId: recebida.keyId,
      },
    };
  }

  /**
   * O INSERT E a checagem: a unique constraint decide. Consultar antes e
   * inserir depois deixaria a corrida aberta.
   */
  private async registrarNonce(keyId: string, nonce: string, agora: Date): Promise<boolean> {
    try {
      await this.db.kioskReplayNonce.create({
        data: {
          keyId,
          nonceHash: calcularHashDoNonce(nonce),
          expiresAt: new Date(agora.getTime() + 300_000),
        },
      });

      return true;
    } catch {
      return false;
    }
  }

  private decifrarSegredo(guardado: string): string {
    const [iv, tag, ciphertext] = guardado.split(':');

    if (!iv || !tag || !ciphertext) {
      throw new Error('Credencial de totem com formato invalido.');
    }

    return this.cifrador
      .decifrar({
        iv: Buffer.from(iv, 'base64'),
        tag: Buffer.from(tag, 'base64'),
        ciphertext: Buffer.from(ciphertext, 'base64'),
      })
      .toString('utf8');
  }

  cifrarSegredo(segredo: string): string {
    const cifrado = this.cifrador.cifrar(Buffer.from(segredo, 'utf8'));

    return [
      cifrado.iv.toString('base64'),
      cifrado.tag.toString('base64'),
      cifrado.ciphertext.toString('base64'),
    ].join(':');
  }
}
```

`apps/api/src/modules/kiosk-auth/kiosk-auth.guard.ts` — espelho do `EdgeAuthGuard`:

```ts
import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { KioskAuthService, type ContextoDoKiosk } from './kiosk-auth.service.js';

export const ROTA_DE_KIOSK = 'rota-de-kiosk';

export const CABECALHOS_DO_KIOSK = {
  keyId: 'x-kiosk-key-id',
  timestamp: 'x-kiosk-timestamp',
  nonce: 'x-kiosk-nonce',
  signature: 'x-kiosk-signature',
} as const;

declare module 'express' {
  interface Request {
    /** Preenchido pelo `KioskAuthGuard`. Ausente em rota de usuario. */
    kioskContext?: ContextoDoKiosk;
  }
}

/**
 * Autentica o totem por assinatura HMAC.
 *
 * O corpo cru vem de `request.rawBody`: `JSON.parse` seguido de
 * `JSON.stringify` reordena chaves e o hash deixa de bater.
 */
@Injectable()
export class KioskAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly kiosk: KioskAuthService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const exigeKiosk = this.reflector.getAllAndOverride<boolean>(ROTA_DE_KIOSK, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!exigeKiosk) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();

    const resultado = await this.kiosk.verificar(
      {
        keyId: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.keyId),
        timestamp: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.timestamp),
        nonce: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.nonce),
        signature: this.cabecalho(requisicao, CABECALHOS_DO_KIOSK.signature),
        method: requisicao.method,
        pathAndQuery: requisicao.originalUrl,
        body: requisicao.rawBody ?? '',
      },
      new Date(),
    );

    if (!resultado.ok) {
      throw new UnauthorizedException({ code: resultado.motivo });
    }

    requisicao.kioskContext = resultado.contexto;

    return true;
  }

  private cabecalho(requisicao: Request, nome: string): string {
    const valor = requisicao.headers[nome];

    return typeof valor === 'string' ? valor : '';
  }
}
```

`apps/api/src/modules/kiosk-auth/kiosk-route.decorator.ts`:

```ts
import { SetMetadata, applyDecorators } from '@nestjs/common';

import { Public } from '../../common/security/public.decorator.js';
import { ROTA_DE_KIOSK } from './kiosk-auth.guard.js';

/**
 * Rota autenticada por assinatura de totem, nao por cookie.
 *
 * `@Public()` sozinho abriria a rota para qualquer um -- por isso os dois
 * andam juntos num decorator so, e nao soltos no controller onde alguem
 * esqueceria um deles.
 */
export const KioskRoute = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Public(), SetMetadata(ROTA_DE_KIOSK, true));
```

`apps/api/src/modules/kiosk-auth/kiosk-auth.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { KioskAuthService } from './kiosk-auth.service.js';

@Module({
  imports: [PersistenceModule],
  providers: [KioskAuthService],
  exports: [KioskAuthService],
})
export class KioskAuthModule {}
```

Registrar o `KioskAuthGuard` como guard global em `apps/api/src/app.module.ts`, ao lado do `EdgeAuthGuard` — seguir exatamente o mesmo padrão de `APP_GUARD` já usado ali.

- [ ] **Step 4: Rodar o teste**

```bash
pnpm --filter @arenahub/api test:integration -- kiosk-auth
```

Esperado: PASS, 7 testes. O primeiro (`aceita requisicao assinada`) só passa depois da Task 4, que cria o endpoint — **é esperado que ele falhe aqui com 404**. Se preferir ver tudo verde nesta task, criar o controller mínimo da Task 4 antes de rodar.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk-auth apps/api/test/integration/kiosk-auth.int-spec.ts apps/api/src/app.module.ts packages/database/prisma
git commit -m "feat(api): autenticacao do totem por assinatura HMAC (refs #150)"
```

---

### Task 4: Heartbeat e configuração

**Files:**
- Create: `apps/api/src/modules/kiosk/kiosk.controller.ts`
- Create: `apps/api/src/modules/kiosk/kiosk-config.service.ts`
- Create: `apps/api/src/modules/kiosk/kiosk.module.ts`
- Test: `apps/api/test/integration/kiosk-config.int-spec.ts`

**Interfaces:**
- Consumes: `ContextoDoKiosk` e `@KioskRoute()` (Task 3); `resolverConfig`, `KioskConfig` (Task 2)
- Produces:
  - `POST /api/v1/kiosk/heartbeat` → `{ configVersion: number; serverTime: string }`
  - `GET /api/v1/kiosk/config` → `{ version: number; config: KioskConfig }`
  - `KioskConfigService.resolverParaDispositivo(contexto): Promise<{ version: number; config: KioskConfig }>`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/test/integration/kiosk-config.int-spec.ts`. Montar dois tenants (A e B), cada um com seu totem, seguindo o molde da Task 3:

```ts
it('heartbeat devolve a versao publicada e carimba o dispositivo', async () => {
  const resposta = await request(servidor())
    .post('/api/v1/kiosk/heartbeat')
    .set(assinarPedido(totemA, CORPO, '/api/v1/kiosk/heartbeat'))
    .send(CORPO)
    .expect(200);

  expect(resposta.body).toMatchObject({ configVersion: 1 });
  expect(typeof resposta.body.serverTime).toBe('string');

  const dispositivo = await db.kioskDevice.findUniqueOrThrow({
    where: { id: totemA.kioskDeviceId },
  });

  expect(dispositivo.lastHeartbeat).not.toBeNull();
});

it('config devolve a camada da unidade resolvida sobre o padrao', async () => {
  const resposta = await request(servidor())
    .get('/api/v1/kiosk/config')
    .set(assinarPedido(totemA, '', '/api/v1/kiosk/config', 'GET'))
    .expect(200);

  expect(resposta.body.version).toBe(1);
  expect(resposta.body.config.sessao.duracaoSegundos).toBe(60);
  expect(resposta.body.config.identificacao).toEqual({
    cpf: true,
    facial: false,
    qrCodeDoApp: false,
  });
});

it('a configuracao do tenant B NAO vaza para o totem do tenant A', async () => {
  await db.kioskConfiguration.create({
    data: {
      tenantId: totemB.tenantId,
      gymUnitId: totemB.gymUnitId,
      version: 2,
      publishedAt: new Date(),
      payload: { marca: { nomeDaAcademia: 'SEGREDO DO B' } },
    },
  });

  const resposta = await request(servidor())
    .get('/api/v1/kiosk/config')
    .set(assinarPedido(totemA, '', '/api/v1/kiosk/config', 'GET'))
    .expect(200);

  expect(JSON.stringify(resposta.body)).not.toContain('SEGREDO DO B');
});

it('rascunho (sem published_at) NAO e servido ao totem', async () => {
  await db.kioskConfiguration.create({
    data: {
      tenantId: totemA.tenantId,
      gymUnitId: totemA.gymUnitId,
      version: 9,
      publishedAt: null,
      payload: { marca: { nomeDaAcademia: 'RASCUNHO' } },
    },
  });

  const resposta = await request(servidor())
    .get('/api/v1/kiosk/config')
    .set(assinarPedido(totemA, '', '/api/v1/kiosk/config', 'GET'))
    .expect(200);

  expect(resposta.body.version).toBe(1);
  expect(JSON.stringify(resposta.body)).not.toContain('RASCUNHO');
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @arenahub/api test:integration -- kiosk-config
```

Esperado: FAIL — 404 nas rotas.

- [ ] **Step 3: Implementar o serviço e o controller**

`apps/api/src/modules/kiosk/kiosk-config.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { resolverConfig, type KioskConfig } from '@arenahub/api-contracts';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';

export interface ConfiguracaoResolvida {
  readonly version: number;
  readonly config: KioskConfig;
}

@Injectable()
export class KioskConfigService {
  constructor(private readonly db: PrismaService) {}

  /**
   * Resolve as tres camadas (ADR-042, Decisao 8) para ESTE dispositivo.
   *
   * So versao PUBLICADA entra: rascunho e a linha sem `publishedAt`, e servir
   * rascunho ao totem tiraria da F50 a capacidade de descartar.
   *
   * O `tenantId` vem do contexto -- que vem da credencial. Nao ha caminho em
   * que o totem de um tenant leia a configuracao de outro.
   */
  async resolverParaDispositivo(contexto: ContextoDoKiosk): Promise<ConfiguracaoResolvida> {
    const publicadas = await this.db.kioskConfiguration.findMany({
      where: {
        tenantId: contexto.tenantId,
        publishedAt: { not: null },
        OR: [
          { gymUnitId: null, kioskDeviceId: null },
          { gymUnitId: contexto.gymUnitId, kioskDeviceId: null },
          { gymUnitId: contexto.gymUnitId, kioskDeviceId: contexto.kioskDeviceId },
        ],
      },
      // Ordem EXPLICITA: sem `orderBy`, a ordem fisica do Postgres muda apos
      // UPDATE e a ultima versao viraria loteria.
      orderBy: [{ version: 'asc' }],
    });

    const daCamada = (
      gymUnitId: string | null,
      kioskDeviceId: string | null,
    ): unknown | undefined =>
      publicadas.filter((c) => c.gymUnitId === gymUnitId && c.kioskDeviceId === kioskDeviceId).at(-1)
        ?.payload;

    const config = resolverConfig({
      tenant: daCamada(null, null),
      unidade: daCamada(contexto.gymUnitId, null),
      dispositivo: daCamada(contexto.gymUnitId, contexto.kioskDeviceId),
    });

    const version = publicadas.at(-1)?.version ?? 0;

    return { version, config };
  }
}
```

`apps/api/src/modules/kiosk/kiosk.controller.ts`:

```ts
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';

import { KioskRoute } from '../kiosk-auth/kiosk-route.decorator.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskConfigService } from './kiosk-config.service.js';

const heartbeatSchema = z.object({
  agentVersion: z.string().min(1),
  /** Relogio local do totem em ms, para medir a deriva. */
  localTimeMs: z.number().int(),
});

@Controller('api/v1/kiosk')
@KioskRoute()
export class KioskController {
  constructor(private readonly config: KioskConfigService) {}

  @Post('heartbeat')
  async heartbeat(
    @Req() requisicao: Request,
    @Body() corpo: unknown,
  ): Promise<{ configVersion: number; serverTime: string }> {
    const contexto = this.contexto(requisicao);
    const dados = heartbeatSchema.parse(corpo);
    const agora = new Date();

    const { version } = await this.config.resolverParaDispositivo(contexto);

    await this.db.kioskDevice.update({
      where: { id: contexto.kioskDeviceId },
      data: {
        lastHeartbeat: agora,
        agentVersion: dados.agentVersion,
        clockOffsetMs: dados.localTimeMs === 0 ? null : dados.localTimeMs - agora.getTime(),
      },
    });

    // `configVersion` nasce AQUI, na F49: a F50 declara este endpoint como
    // pre-existente e compara este numero com o do boot (ADR-042, Decisao 3).
    return { configVersion: version, serverTime: agora.toISOString() };
  }

  @Get('config')
  async obterConfig(@Req() requisicao: Request) {
    return this.config.resolverParaDispositivo(this.contexto(requisicao));
  }

  private contexto(requisicao: Request): ContextoDoKiosk {
    const contexto = requisicao.kioskContext;

    if (!contexto) {
      throw new Error('Rota de kiosk sem contexto -- o guard nao rodou.');
    }

    return contexto;
  }
}
```

**Nota:** o controller acima usa `this.db` no `heartbeat` — injetar `PrismaService` no construtor junto do `KioskConfigService`, ou mover o `update` para dentro do serviço. Preferir mover para o serviço: controller valida e delega, não fala com banco (convenção do projeto).

`apps/api/src/modules/kiosk/kiosk.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../persistence/persistence.module.js';
import { KioskAuthModule } from '../kiosk-auth/kiosk-auth.module.js';
import { KioskConfigService } from './kiosk-config.service.js';
import { KioskController } from './kiosk.controller.js';

@Module({
  imports: [PersistenceModule, KioskAuthModule],
  controllers: [KioskController],
  providers: [KioskConfigService],
})
export class KioskModule {}
```

Registrar `KioskModule` nos `imports` do `AppModule`.

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
pnpm --filter @arenahub/api test:integration -- kiosk-config kiosk-auth
```

Esperado: PASS — 4 testes de config e os 7 de assinatura.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/kiosk apps/api/test/integration/kiosk-config.int-spec.ts apps/api/src/app.module.ts
git commit -m "feat(api): heartbeat com configVersion e config resolvida em tres camadas (refs #150)"
```

---

### Task 5: Sessão efêmera do aluno

**Files:**
- Create: `apps/api/src/modules/kiosk/kiosk-session.service.ts`
- Create: `apps/api/src/modules/kiosk/domain/sessao.ts`
- Create: `apps/api/src/modules/kiosk/domain/sessao.spec.ts`
- Modify: `apps/api/src/modules/kiosk/kiosk.controller.ts`
- Modify: `apps/api/src/modules/kiosk/kiosk.module.ts`
- Test: `apps/api/test/integration/kiosk-session.int-spec.ts`

**Interfaces:**
- Consumes: `ContextoDoKiosk` (Task 3); `KioskConfigService` (Task 4); `calcularHashDeCpf(tenantId, cpf)` de `apps/api/src/modules/students/domain/identificacao.ts` — **não** confundir com o espelho homônimo em `packages/database/src/import-ativos/dominio.ts`, que existe para a importação da base legada
- Produces:
  - `calcularExpiracao(inicio: Date, duracaoSegundos: number): Date` — pura
  - `estender(expiraEm: Date, agora: Date, incremento: number, teto: number): Date` — pura
  - `POST /api/v1/kiosk/sessions` → `{ token, sessionId, nome, plano, expiraEm }`
  - `POST /api/v1/kiosk/sessions/:id/extend` → `{ expiraEm }`
  - `DELETE /api/v1/kiosk/sessions/:id` → `204`

- [ ] **Step 1: Escrever o teste unitário que falha**

Criar `apps/api/src/modules/kiosk/domain/sessao.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals';

import { calcularExpiracao, estender } from './sessao.js';

/** Funcao pura: o "agora" entra por parametro, nunca do relogio. */
describe('sessao do totem', () => {
  const INICIO = new Date('2026-08-25T10:00:00.000Z');

  it('expira em 60 s por padrao', () => {
    expect(calcularExpiracao(INICIO, 60)).toEqual(new Date('2026-08-25T10:01:00.000Z'));
  });

  it('estender soma 30 s ao que resta', () => {
    const agora = new Date('2026-08-25T10:00:40.000Z');
    const expiraEm = new Date('2026-08-25T10:01:00.000Z');

    // Restam 20 s; +30 = 50 s a partir de agora.
    expect(estender(expiraEm, agora, 30, 99)).toEqual(new Date('2026-08-25T10:01:30.000Z'));
  });

  it('estender respeita o teto de 99 s a partir de agora', () => {
    const agora = new Date('2026-08-25T10:00:00.000Z');
    const expiraEm = new Date('2026-08-25T10:01:30.000Z');

    // Restam 90 s; +30 daria 120, mas o teto e 99.
    expect(estender(expiraEm, agora, 30, 99)).toEqual(new Date('2026-08-25T10:01:39.000Z'));
  });

  it('estender sessao ja vencida nao ressuscita para o passado', () => {
    const agora = new Date('2026-08-25T10:02:00.000Z');
    const expiraEm = new Date('2026-08-25T10:01:00.000Z');

    expect(estender(expiraEm, agora, 30, 99).getTime()).toBeGreaterThan(agora.getTime());
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @arenahub/api test -- sessao
```

Esperado: FAIL — `Cannot find module './sessao.js'`.

- [ ] **Step 3: Implementar as funções puras**

Criar `apps/api/src/modules/kiosk/domain/sessao.ts`:

```ts
/**
 * Calculo de sessao do totem.
 *
 * PURO: sem banco, sem rede, sem relogio -- o "agora" entra por parametro
 * (convencao do projeto). Isso e o que torna o teto de 99 s testavel sem
 * esperar 99 segundos.
 */

export function calcularExpiracao(inicio: Date, duracaoSegundos: number): Date {
  return new Date(inicio.getTime() + duracaoSegundos * 1000);
}

/**
 * Soma o incremento ao que RESTA, limitado pelo teto contado a partir de
 * agora (`DS-TOTEM.md` §6: "soma 30 s, teto de 99").
 *
 * Sessao ja vencida nao volta para o passado: o piso e `agora`.
 */
export function estender(
  expiraEm: Date,
  agora: Date,
  incrementoSegundos: number,
  tetoSegundos: number,
): Date {
  const restanteMs = Math.max(0, expiraEm.getTime() - agora.getTime());
  const desejadoMs = restanteMs + incrementoSegundos * 1000;
  const tetoMs = tetoSegundos * 1000;

  return new Date(agora.getTime() + Math.min(desejadoMs, tetoMs));
}
```

- [ ] **Step 4: Rodar o unitário e ver passar**

```bash
pnpm --filter @arenahub/api test -- sessao
```

Esperado: PASS, 4 testes.

- [ ] **Step 5: Escrever o teste de integração que falha**

Criar `apps/api/test/integration/kiosk-session.int-spec.ts`. Montar **dois tenants com um aluno cada**, com CPFs distintos:

```ts
it('identifica o aluno pelo CPF e abre sessao', async () => {
  const resposta = await request(servidor())
    .post('/api/v1/kiosk/sessions')
    .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
    .send({ cpf: CPF_DO_ALUNO_A })
    .expect(201);

  expect(resposta.body.nome).toBe('Aluno A');
  expect(typeof resposta.body.token).toBe('string');
});

it('a resposta NAO traz campo alem da jornada (M4-FR-018)', async () => {
  const resposta = await request(servidor())
    .post('/api/v1/kiosk/sessions')
    .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
    .send({ cpf: CPF_DO_ALUNO_A })
    .expect(201);

  expect(Object.keys(resposta.body).sort()).toEqual(
    ['expiraEm', 'nome', 'plano', 'sessionId', 'token'].sort(),
  );

  const corpo = JSON.stringify(resposta.body);

  expect(corpo).not.toContain(CPF_DO_ALUNO_A);
  expect(corpo).not.toContain('@');
});

it('ACEITE DA FATIA -- o aluno do tenant B nao existe para o totem do tenant A', async () => {
  const resposta = await request(servidor())
    .post('/api/v1/kiosk/sessions')
    .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_B }, '/api/v1/kiosk/sessions'))
    .send({ cpf: CPF_DO_ALUNO_B })
    .expect(404);

  expect(resposta.body.code).toBe('KIOSK_IDENTIFICATION_FAILED');
});

it('CPF inexistente e aluno de outro tenant devolvem a MESMA resposta', async () => {
  const inexistente = await request(servidor())
    .post('/api/v1/kiosk/sessions')
    .set(assinarPedido(totemA, { cpf: '00000000191' }, '/api/v1/kiosk/sessions'))
    .send({ cpf: '00000000191' })
    .expect(404);

  const deOutroTenant = await request(servidor())
    .post('/api/v1/kiosk/sessions')
    .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_B }, '/api/v1/kiosk/sessions'))
    .send({ cpf: CPF_DO_ALUNO_B })
    .expect(404);

  // Decisao 4 do PI: mensagem unica e neutra. Distinguir aqui transformaria
  // o totem em oraculo de "fulano treina nesta academia".
  expect(inexistente.body).toEqual(deOutroTenant.body);
});

it('encerrar invalida o token no ATO', async () => {
  const aberta = await request(servidor())
    .post('/api/v1/kiosk/sessions')
    .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
    .send({ cpf: CPF_DO_ALUNO_A })
    .expect(201);

  const { sessionId } = aberta.body;

  await request(servidor())
    .delete(`/api/v1/kiosk/sessions/${sessionId}`)
    .set(assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}`, 'DELETE'))
    .expect(204);

  await request(servidor())
    .post(`/api/v1/kiosk/sessions/${sessionId}/extend`)
    .set(assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}/extend`, 'POST'))
    .send('')
    .expect(404);
});

it('sessao de um totem nao pode ser encerrada por outro', async () => {
  const aberta = await request(servidor())
    .post('/api/v1/kiosk/sessions')
    .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
    .send({ cpf: CPF_DO_ALUNO_A })
    .expect(201);

  const rota = `/api/v1/kiosk/sessions/${aberta.body.sessionId}`;

  await request(servidor())
    .delete(rota)
    .set(assinarPedido(totemB, '', rota, 'DELETE'))
    .expect(404);
});
```

- [ ] **Step 6: Rodar e ver falhar**

```bash
pnpm --filter @arenahub/api test:integration -- kiosk-session
```

Esperado: FAIL — 404 nas rotas de sessão.

- [ ] **Step 7: Implementar o serviço de sessão**

Criar `apps/api/src/modules/kiosk/kiosk-session.service.ts`:

```ts
import { randomBytes, createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';

import { calcularHashDeCpf } from '../students/domain/identificacao.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskConfigService } from './kiosk-config.service.js';
import { calcularExpiracao, estender } from './domain/sessao.js';

export interface SessaoAberta {
  readonly sessionId: string;
  readonly token: string;
  readonly nome: string;
  readonly plano: { readonly ativo: boolean; readonly pendenciaEmCentavos: number | null };
  readonly expiraEm: string;
}

/**
 * Sessao efemera do aluno no totem.
 *
 * A busca e por `cpfHash` ESCOPADO POR TENANT, e o tenant vem da credencial
 * do dispositivo. E dai que sai o aceite da fatia: o totem de um tenant nao
 * consegue nem FORMULAR a pergunta sobre o aluno de outro -- a chave de busca
 * e diferente. Nao ha checagem a esquecer.
 */
@Injectable()
export class KioskSessionService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: KioskConfigService,
  ) {}

  async abrir(contexto: ContextoDoKiosk, cpf: string, agora: Date): Promise<SessaoAberta> {
    const { config } = await this.config.resolverParaDispositivo(contexto);

    const aluno = await this.db.student.findFirst({
      where: {
        tenantId: contexto.tenantId,
        cpfHash: calcularHashDeCpf(contexto.tenantId, cpf),
        status: { in: ['ACTIVE', 'DELINQUENT'] },
      },
      select: { id: true, fullName: true },
    });

    // Decisao 4 do PI: mensagem UNICA para nao-encontrado, cancelado e erro.
    // Distinguir aqui diria a qualquer um se fulano treina nesta academia.
    if (!aluno) {
      throw new NotFoundException({ code: 'KIOSK_IDENTIFICATION_FAILED' });
    }

    const token = randomBytes(32).toString('base64url');
    const expiraEm = calcularExpiracao(agora, config.sessao.duracaoSegundos);

    const sessao = await this.db.kioskSession.create({
      data: {
        tenantId: contexto.tenantId,
        kioskDeviceId: contexto.kioskDeviceId,
        studentId: aluno.id,
        tokenHash: this.hash(token),
        expiresAt: expiraEm,
      },
    });

    return {
      sessionId: sessao.id,
      token,
      nome: aluno.fullName,
      plano: await this.estadoDoPlano(contexto.tenantId, aluno.id),
      expiraEm: expiraEm.toISOString(),
    };
  }

  async estenderSessao(
    contexto: ContextoDoKiosk,
    sessionId: string,
    agora: Date,
  ): Promise<{ expiraEm: string }> {
    const { config } = await this.config.resolverParaDispositivo(contexto);
    const sessao = await this.viva(contexto, sessionId);

    const novo = estender(
      sessao.expiresAt,
      agora,
      config.sessao.incrementoSegundos,
      config.sessao.tetoSegundos,
    );

    await this.db.kioskSession.update({
      where: { id: sessao.id },
      data: { expiresAt: novo },
    });

    return { expiraEm: novo.toISOString() };
  }

  async encerrar(
    contexto: ContextoDoKiosk,
    sessionId: string,
    motivo: string,
    agora: Date,
  ): Promise<void> {
    const sessao = await this.viva(contexto, sessionId);

    await this.db.kioskSession.update({
      where: { id: sessao.id },
      data: { endedAt: agora, endedReason: motivo },
    });
  }

  /**
   * Sessao viva DESTE dispositivo. O `kioskDeviceId` no filtro nao e zelo:
   * sem ele, um totem encerraria ou estenderia a sessao de outro.
   */
  private async viva(contexto: ContextoDoKiosk, sessionId: string) {
    const sessao = await this.db.kioskSession.findFirst({
      where: {
        id: sessionId,
        tenantId: contexto.tenantId,
        kioskDeviceId: contexto.kioskDeviceId,
        endedAt: null,
      },
    });

    if (!sessao) {
      throw new NotFoundException({ code: 'KIOSK_SESSION_NOT_FOUND' });
    }

    return sessao;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async estadoDoPlano(
    tenantId: string,
    studentId: string,
  ): Promise<SessaoAberta['plano']> {
    const emAberto = await this.db.invoice.findFirst({
      where: { tenantId, studentId, status: 'OPEN' },
      orderBy: [{ dueDate: 'asc' }],
      select: { amountInCents: true },
    });

    return {
      ativo: emAberto === null,
      pendenciaEmCentavos: emAberto?.amountInCents ?? null,
    };
  }
}
```

**Antes de implementar:** conferir os nomes reais em `schema.prisma` — o modelo de fatura e seus campos (`Invoice`, `status`, `amountInCents`, `dueDate`) e os valores de `StudentStatus`. Ajustar o `select` e o `where` ao que existir, sem inventar campo.

Acrescentar ao `kiosk.controller.ts` as três rotas, validando o corpo com Zod (`z.object({ cpf: z.string().regex(/^\d{11}$/) })`) e delegando ao serviço.

- [ ] **Step 8: Rodar os testes e ver passar**

```bash
pnpm --filter @arenahub/api test:integration -- kiosk-session
```

Esperado: PASS, 6 testes.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/kiosk apps/api/test/integration/kiosk-session.int-spec.ts
git commit -m "feat(api): sessao efemera do aluno no totem, isolada por tenant (refs #150)"
```

---

### Task 6: Tokens do totem e alvo de contraste 7:1

**Files:**
- Modify: `packages/ui/src/contrast.ts`
- Modify: `packages/ui/src/accent.spec.ts`
- Create: `packages/ui/tokens/totem.json`

**Interfaces:**
- Consumes: `resolveAccent(seedHex, surface)`, `RAMP_TONES`, `contrastRatio` (já existem)
- Produces: `AAA_TEXT = 7` exportado de `contrast.ts`; tokens de superfície do totem em `tokens/totem.json`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `packages/ui/src/accent.spec.ts`:

```ts
describe('accent do totem -- superficie escura, alvo 7:1', () => {
  const BG_BASE = '#0A0B0D';

  it('resolve o texto de acao com contraste >= 7 sobre o carbono', () => {
    const resolvido = resolveAccent('#4D7CFF', BG_BASE);

    expect(contrastRatio(resolvido.text, BG_BASE)).toBeGreaterThanOrEqual(AAA_TEXT);
  });

  it('vale para os quatro accents do totem, nao so para o azul', () => {
    for (const seed of ['#4D7CFF', '#3DDC84', '#F5A524', '#8B5CF6']) {
      const resolvido = resolveAccent(seed, BG_BASE);

      expect(contrastRatio(resolvido.text, BG_BASE)).toBeGreaterThanOrEqual(AAA_TEXT);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @arenahub/ui test -- accent
```

Esperado: FAIL — `AAA_TEXT is not defined`.

- [ ] **Step 3: Exportar o alvo e conferir a resolução**

Em `packages/ui/src/contrast.ts`, junto de `AA_TEXT`:

```ts
/**
 * Alvo do TOTEM (`DS-TOTEM.md` §11.3): 7:1.
 *
 * Mais alto que o `AA_TEXT` (4.5) do painel porque a tela fica em ambiente de
 * academia -- luz alta e reflexo -- e e lida a 60-100 cm, em pe.
 */
export const AAA_TEXT = 7;
```

Se algum dos quatro accents não atingir 7:1 com a rampa atual, **não** afrouxar o teste: `minToneWithContrast` já devolve o tom mais claro que atinge o alvo, e o comportamento de fallback ("devolve o tom mais escuro se nenhum atingir") precisa ser exercitado. Registrar no PR qual seed não atinge e por quê.

- [ ] **Step 4: Criar os tokens de superfície**

Criar `packages/ui/tokens/totem.json`, seguindo o formato dos arquivos vizinhos (`primitive.json`, `semantic.json`) — conferir a estrutura antes de escrever. Valores do `DS-TOTEM.md` §2.1:

```json
{
  "totem": {
    "bg": {
      "base": { "value": "#0A0B0D" },
      "surface": { "value": "#121417" }
    },
    "border": {
      "hairline": { "value": "#1A2032" },
      "default": { "value": "#232A3D" }
    },
    "text": {
      "primary": { "value": "#FFFFFF" },
      "secondary": { "value": "#A6AEB9" },
      "tertiary": { "value": "#565E69" }
    }
  }
}
```

**Estes hex vivem AQUI e só aqui.** É a fonte do token; código de UI consome o token, nunca o literal (ADR-026 e a lint da Regra 5).

- [ ] **Step 5: Rodar e ver passar**

```bash
pnpm --filter @arenahub/ui test -- accent
pnpm lint
```

Esperado: PASS; lint sem erro novo.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/contrast.ts packages/ui/src/accent.spec.ts packages/ui/tokens/totem.json
git commit -m "feat(ui): tokens do totem e alvo de contraste 7:1 (refs #150)"
```

---

### Task 7: Superfície `apps/kiosk` — atrator, CPF e Minha área

**Files:**
- Create: `apps/kiosk/package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.js`
- Create: `apps/kiosk/app/layout.tsx`, `apps/kiosk/app/page.tsx`, `apps/kiosk/app/globals.css`
- Create: `apps/kiosk/components/atrator.tsx`, `identificacao-cpf.tsx`, `minha-area.tsx`, `rodape-de-sessao.tsx`
- Create: `apps/kiosk/lib/kiosk-client.ts`, `apps/kiosk/lib/use-sessao.ts`
- Test: `apps/kiosk/lib/use-sessao.spec.ts`

**Interfaces:**
- Consumes: `GET /api/v1/kiosk/config`, `POST /api/v1/kiosk/sessions`, `.../extend`, `DELETE .../sessions/:id` (Tasks 4 e 5); tokens de `packages/ui`
- Produces: app Next.js na porta padrão, com os scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`

**Regra que não se negocia nesta task:** nenhuma tela fixa valor que a configuração define (ADR-042, Decisão 0). Marca, accent, duração de sessão e módulos vêm de `GET /api/v1/kiosk/config`, mesmo que hoje só exista o padrão do seed.

- [ ] **Step 1: Criar o app espelhando `apps/admin-web`**

Copiar a estrutura de configuração de `apps/admin-web` (mesmos `tsconfig`, `eslint.config.js`, scripts). `package.json`:

```json
{
  "name": "@arenahub/kiosk",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "start": "next start",
    "build": "next build",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "pretest:e2e": "node --env-file-if-exists=../../.env ../../scripts/preparar-banco-de-teste.mjs e2e"
  }
}
```

Dependências: as mesmas de `admin-web` (`next`, `react`, `react-dom`, `@arenahub/ui`, `@arenahub/api-contracts`).

- [ ] **Step 2: Escrever o teste do hook de sessão**

Criar `apps/kiosk/lib/use-sessao.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { limparEstadoDaSessao } from './use-sessao.js';

describe('limpeza de sessao (M4-BR-006)', () => {
  it('esvazia sessionStorage e localStorage', () => {
    sessionStorage.setItem('nome', 'Aluno A');
    localStorage.setItem('cpf', '00000000191');

    limparEstadoDaSessao();

    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('limpa o clipboard quando a API existe', async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);

    Object.assign(navigator, { clipboard: { writeText: escrever } });

    limparEstadoDaSessao();

    expect(escrever).toHaveBeenCalledWith('');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
pnpm --filter @arenahub/kiosk test
```

Esperado: FAIL — módulo inexistente.

- [ ] **Step 4: Implementar o cliente, o hook e as três telas**

`apps/kiosk/lib/use-sessao.ts` — a limpeza que o aceite exige:

```ts
/**
 * Limpeza de encerramento (`M4-FR-020`, `M4-BR-006`).
 *
 * O aceite da fatia mede exatamente isto: depois do encerramento, nada do
 * aluno permanece. `autocomplete="off"` nos campos e o que impede o autofill
 * de reoferecer o CPF do anterior -- vive no JSX, nao aqui.
 */
export function limparEstadoDaSessao(): void {
  sessionStorage.clear();
  localStorage.clear();

  // Clipboard e opcional no navegador; falhar nele nao pode travar o
  // encerramento, que precisa acontecer de qualquer jeito.
  void navigator.clipboard?.writeText('').catch(() => undefined);
}
```

As três telas seguem o `DS-TOTEM.md`:

- **Atrator** (§4, §3.2, §3.3, §3.8) — cabeçalho de marca com o nome vindo da config, hero, CTA "Entrar na minha área" de 116 px, assinatura ArenaHub no rodapé (§11.10). **Sem blocos, sem patrocínio** (F51): o §4 já cobre esse estado — hero e CTA se distribuem no espaço restante.
- **Identificação por CPF** (§3.19) — teclado 3×4 de teclas 132 px, campo em JetBrains Mono 52 px com máscara `000.000.000-00`, CTA travado (`#1A2032`, cursor `not-allowed`) até 11 dígitos. Campo com `autocomplete="off"` e `inputMode="none"` — o teclado é o da tela, não o do sistema.
- **Minha área** (§5.2, §3.11, §3.18) — saudação, faixa de estado do plano (pendência em `warning` com valor, ou plano ativo em `success`), barra de sessão no topo (6 px, `transition: width 1s linear`) e rodapé com contador, "Preciso de mais tempo" e "Encerrar". **Grade de módulos vazia** — nenhum módulo habilitado na config (Task 2).

Erro de identificação: **Toast** com a mensagem neutra única — *"Não foi possível entrar. Procure a recepção."* Nunca `Alert`.

- [ ] **Step 5: Rodar e ver passar**

```bash
pnpm --filter @arenahub/kiosk test
pnpm --filter @arenahub/kiosk typecheck
pnpm --filter @arenahub/kiosk build
```

Esperado: PASS nos três.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk
git commit -m "feat(kiosk): superficie do totem — atrator, identificacao por CPF e minha area (refs #150)"
```

---

### Task 8: E2E — a jornada e a prova de limpeza

**Files:**
- Create: `apps/kiosk/playwright.config.ts`
- Create: `apps/kiosk/e2e/jornada-do-totem.spec.ts`

**Interfaces:**
- Consumes: a superfície da Task 7 e a API das Tasks 4 e 5, com o banco de e2e preparado por `pretest:e2e`
- Produces: a evidência do aceite da fatia

- [ ] **Step 1: Escrever o teste**

Criar `apps/kiosk/e2e/jornada-do-totem.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const CPF_DO_ALUNO = '00000000191'; // do seed

test('atrator -> CPF -> minha area -> encerrar, sem deixar rastro', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: /entrar na minha área/i })).toBeVisible();
  await page.getByRole('button', { name: /entrar na minha área/i }).click();

  for (const digito of CPF_DO_ALUNO) {
    await page.getByRole('button', { name: digito, exact: true }).first().click();
  }

  await page.getByRole('button', { name: /continuar/i }).click();

  await expect(page.getByText(/minha área/i)).toBeVisible();

  const nome = await page.getByTestId('saudacao').textContent();

  expect(nome).toBeTruthy();

  await page.getByRole('button', { name: /encerrar/i }).click();

  // Voltou ao atrator.
  await expect(page.getByRole('button', { name: /entrar na minha área/i })).toBeVisible();

  // ACEITE DA FATIA: nada do aluno permanece.
  const resíduo = await page.evaluate(() => ({
    sessao: sessionStorage.length,
    local: localStorage.length,
    dom: document.body.innerText,
  }));

  expect(resíduo.sessao).toBe(0);
  expect(resíduo.local).toBe(0);
  expect(resíduo.dom).not.toContain(nome!.trim());
});

test('"Preciso de mais tempo" soma 30 s e respeita o teto', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /entrar na minha área/i }).click();

  for (const digito of CPF_DO_ALUNO) {
    await page.getByRole('button', { name: digito, exact: true }).first().click();
  }

  await page.getByRole('button', { name: /continuar/i }).click();

  const antes = Number(await page.getByTestId('contador-de-sessao').textContent());

  await page.getByRole('button', { name: /preciso de mais tempo/i }).click();

  const depois = Number(await page.getByTestId('contador-de-sessao').textContent());

  expect(depois).toBeGreaterThan(antes);
  expect(depois).toBeLessThanOrEqual(99);
});
```

Os `data-testid` (`saudacao`, `contador-de-sessao`) precisam existir no JSX da Task 7 — **acrescentar lá se ainda não existirem**, e não trocar depois: testid que muda quebra o teste sem quebrar a tela.

- [ ] **Step 2: Rodar e ver falhar, depois passar**

```bash
pnpm --filter @arenahub/kiosk test:e2e
```

Esperado: FAIL primeiro (sem `playwright.config.ts` ou sem os testids), PASS depois de configurar. O `pretest:e2e` prepara o banco.

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/e2e apps/kiosk/playwright.config.ts
git commit -m "test(kiosk): jornada do totem e prova de limpeza de sessao (refs #150)"
```

---

### Task 9: ADR do regime de identificação

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/prd/academia/MVP-04-app-totem.md` (emenda a `M4-BR-004`)

**Interfaces:**
- Consumes: as quatro decisões do PI registradas na §0 do spec
- Produces: ADR numerado (o próximo livre — conferir o fim do `DECISIONS.md`), citável por F52 e pelo MVP 4

- [ ] **Step 1: Descobrir o próximo número de ADR**

```bash
grep -oE "^## ADR-[0-9]+" docs/DECISIONS.md | tail -1
```

- [ ] **Step 2: Escrever o ADR**

Estrutura, seguindo o formato dos vizinhos (cabeçalho com data, status, o que emenda e o que **não** alcança):

- **Contexto** — o `DS-TOTEM.md` §5.1 desenha três caminhos de identificação; o PI decidiu em 25/08/2026 que só o CPF entra na F49.
- **Decisão 1** — facial vai para o backlog.
- **Decisão 2** — QR nesta superfície é PIX (pagamento), não carteirinha do app; o QR de identificação do §5.1 é MVP 4.
- **Decisão 3** — login é CPF sozinho, sem segundo fator. **Emenda `M4-BR-004`**, que dizia *"CPF no totem é localizador, não autenticador suficiente"*. Consequência escrita: quem sabe o CPF vê nome, estado do plano e valor da fatura em aberto. Risco aceito pelo PI.
- **Decisão 4** — falha de identificação usa mensagem única e neutra, **sem limite de tentativas**. Consequência: enumeração de CPF é barata — um por vez, o totem confirma quem é aluno da unidade. Risco aceito pelo PI.
- **Consequência para a F49** — não existindo autenticação forte, os módulos de saúde e o ranking ficam inalcançáveis; a área interna entrega zero dos seis módulos do DS §5.2.
- **Gatilho de revisão** — a primeira fatia que trouxer facial ou QR do app reabre a questão do segundo fator.

Na emenda ao `MVP-04`, acrescentar nota ao lado de `M4-BR-004` apontando o ADR — **não apagar a linha original**.

- [ ] **Step 3: Commit**

```bash
git add docs/DECISIONS.md docs/prd/academia/MVP-04-app-totem.md
git commit -m "docs: ADR do regime de identificacao do totem — CPF sozinho (refs #150)"
```

---

### Task 10: Fila de execução, status e evidência

**Files:**
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/TESTING.md`

**Interfaces:**
- Consumes: o resultado das Tasks 1–9
- Produces: documentação em dia — escopo obrigatório da entrega, não melhoria adjacente

- [ ] **Step 1: Reordenar a fila do `DEVELOPMENT.md`**

Tarefa que o **ADR-042 atribui explicitamente à F49**: a ordem canônica passa a ser

```
MVP 1 → MVP 2 → MVP 3 → MVP 3.5 (totem, F49–F52) → MVP 4 (app mobile, F23–F29) → MVP 5 → MVP 6
```

A §4 hoje para em `### MVP 4 a 6 · F23 a F41`. Acrescentar a seção do MVP 3.5 **antes** dela, citando o ADR-042, e incluir as fatias F42–F56 que faltam.

- [ ] **Step 2: Corrigir o `STATUS.md`**

Está defasado em 25/08/2026 — a §2 lista F53 em *Em Andamento* e F54/F55/F56 como `em-revisao`, mas as issues #156, #157 e #159 estão **fechadas e `proplan:finalizado`**. Corrigir a tabela de colunas, o Índice Fatia ↔ SPEC (linhas F53–F56) e mover a F49 para a coluna certa.

- [ ] **Step 3: Registrar a evidência no `TESTING.md`**

Acrescentar a linha da `SPEC-049` com os testes desta entrega. **O campo do PR nasce `—` e o `--check` não valida esse campo** — preencher depois do merge, com o número real.

- [ ] **Step 4: Rodar o gate completo**

```bash
pnpm lint && pnpm typecheck && pnpm test:report && pnpm test:guardas
```

Esperado: tudo verde. `pnpm test` sozinho **não** roda integração — usar `test:report`.

- [ ] **Step 5: Commit**

```bash
git add docs/DEVELOPMENT.md docs/STATUS.md docs/TESTING.md
git commit -m "docs: fila do MVP 3.5 antes do MVP 4, status corrigido e evidencia da SPEC-049 (refs #150)"
```

---

## Notas de execução

**Antes de abrir o PR:**

1. `pnpm lint && pnpm typecheck && pnpm test:report && pnpm test:guardas` — o gate local, sempre antes do push.
2. Mover a issue [#150](https://github.com/RodReis/arenahub/issues/150) para `proplan:doing` ao começar.
3. PR com **`refs #150`**, nunca `closes #150` — fechar forjaria o aceite do PI.
4. Depois do merge: aplicar `proplan:done`, preencher o número do PR na linha do `TESTING.md` e conferir se a issue **não** fechou sozinha.
5. Perguntar ao PI se roda `/graphify . --update`.

**Ordem das tasks:** 1 → 2 → 3 → 4 → 5 são sequenciais (cada uma consome a anterior). A 6 é independente e pode ir em paralelo. A 7 depende de 4, 5 e 6. A 8 depende da 7. As 9 e 10 fecham.
