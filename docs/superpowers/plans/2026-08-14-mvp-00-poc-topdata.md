# MVP 0 POC Topdata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a fundação reproduzível do Edge Agent, validar o ciclo facial/catraca com simuladores, comprovar persistência offline e estabelecer um stop gate objetivo antes da integração com o SDK Topdata real.

**Architecture:** O Edge Agent será um processo Node.js sem interface gráfica, com portas de domínio independentes do fabricante, um bridge externo por JSON Lines para isolar SDK/DLL e SQLite embutido para estado e outbox. Os mesmos adapters serão executados contra um bridge simulador no CI e contra o bridge Topdata real no laboratório; o código específico do SDK só será planejado depois que modelo, firmware, DLL e exemplos oficiais passarem pelo gate de hardware.

**Tech Stack:** Node.js 24.15.0, TypeScript 5.9.3, pnpm 10.33.2, Turborepo 2.10.9, `node:sqlite`, Zod 4.4.3, Pino 10.3.1, Jest 29.7.0, ts-jest 29.4.12, ESLint 9.39.5.

---

## 1. Escopo executável e stop gate

Este plano implementa integralmente:

- Slice 0.1, bancada reproduzível;
- contratos e adapters das Slices 0.2 e 0.3;
- bridge simulador executável no CI;
- persistência e reconciliação da Slice 0.4;
- suíte automatizada dos critérios `M0-AC-001` a `M0-AC-007` usando simuladores;
- diagnóstico, runbook, captura de evidências e cálculo da recomendação da Slice 0.5.

Este plano **não inventa chamadas EasyInner ou protocolo facial**. A implementação do executável bridge real fica bloqueada no `HW-GATE-01`. Ao final da Task 12, o agente deve parar e gerar um plano complementar com base nos artefatos reais. Sem esse gate, `M0-AC-008` a `M0-AC-010` e a decisão final do MVP permanecem impossíveis de comprovar.

## 2. Mapa de arquivos

```text
/.gitignore                                  artefatos, segredos e bancos locais ignorados
/.nvmrc                                     versão do Node
/package.json                               scripts e versões do monorepo
/pnpm-workspace.yaml                        workspaces
/turbo.json                                 grafo de tarefas
/tsconfig.base.json                         TypeScript estrito comum
/eslint.config.mjs                          lint comum

/apps/edge-agent/package.json               pacote e comandos do Edge
/apps/edge-agent/tsconfig.json               build do Edge
/apps/edge-agent/jest.config.cjs             testes Jest/ts-jest
/apps/edge-agent/src/config/env.ts           validação e mascaramento da configuração
/apps/edge-agent/src/observability/logger.ts logger estruturado e redaction
/apps/edge-agent/src/domain/contracts.ts      tipos e portas de dispositivos/collector
/apps/edge-agent/src/domain/errors.ts         erros estáveis e classificação de retry
/apps/edge-agent/src/bridge/json-line-client.ts cliente do bridge por stdin/stdout
/apps/edge-agent/src/bridge/simulator.ts      processo bridge simulado
/apps/edge-agent/src/adapters/facial-adapter.ts adapter facial independente do SDK
/apps/edge-agent/src/adapters/turnstile-adapter.ts adapter de catraca e idempotência
/apps/edge-agent/src/persistence/database.ts  conexão, migração e transação SQLite
/apps/edge-agent/src/persistence/repositories.ts device users, permissões e outbox
/apps/edge-agent/src/application/access-policy.ts decisão determinística ALLOW/DENY
/apps/edge-agent/src/application/access-orchestrator.ts reconhecimento até passagem
/apps/edge-agent/src/application/delivery-worker.ts entrega idempotente da outbox
/apps/edge-agent/src/transport/http-collector.ts cliente HMAC do coletor
/apps/edge-agent/src/transport/collector-simulator.ts coletor local para queda/retorno
/apps/edge-agent/src/http/health-server.ts    health check local
/apps/edge-agent/src/cli/diagnose.ts          diagnóstico sem segredos
/apps/edge-agent/src/main.ts                  composition root e shutdown gracioso

/apps/edge-agent/test/unit/*.test.ts          regras e adapters isolados
/apps/edge-agent/test/integration/*.test.ts   SQLite real em diretório temporário
/apps/edge-agent/test/simulator/*.test.ts     bridge e jornadas completas
/apps/edge-agent/test/acceptance/*.test.ts    critérios automáticos do PRD

/apps/edge-agent/config/lab-inventory.schema.json valida inventário real
/apps/edge-agent/config/lab-inventory.simulator.json exemplo não sensível
/apps/edge-agent/config/lab-env.simulator.ps1 variáveis não sensíveis do simulador
/apps/edge-agent/scripts/validate-lab-gate.mjs valida o HW-GATE-01
/apps/edge-agent/scripts/generate-lab-report.mjs consolida métricas e recomendação

/docs/lab/topdata/README.md                   entrada do laboratório e segurança
/docs/lab/topdata/runbook.md                  instalação, execução e rollback
/docs/lab/topdata/decision-policy.md           critérios GO/GO_WITH_CONSTRAINTS/NO_GO
/docs/lab/topdata/simulator-network.txt        topologia não física usada no CI
/docs/adr/0001-edge-runtime-and-bridge.md       decisão Node + bridge externo
```

## Task 1: Bootstrap reproduzível do monorepo e Edge Agent

**Files:**
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `apps/edge-agent/package.json`
- Create: `apps/edge-agent/tsconfig.json`
- Create: `apps/edge-agent/jest.config.cjs`
- Create: `apps/edge-agent/src/version.ts`
- Test: `apps/edge-agent/test/unit/version.test.ts`

- [ ] **Step 1: Create the pinned workspace manifests**

Create `.nvmrc`:

```text
24.15.0
```

Create `package.json`:

```json
{
  "name": "arenahub",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "engines": { "node": "24.15.x", "pnpm": "10.33.x" },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "test:e2e": "turbo run test:simulator"
  },
  "devDependencies": {
    "@types/jest": "29.5.14",
    "@types/node": "24.13.3",
    "eslint": "9.39.5",
    "jest": "29.7.0",
    "pino-pretty": "13.1.3",
    "ts-jest": "29.4.12",
    "tsx": "4.23.12",
    "turbo": "2.10.9",
    "typescript": "5.9.3",
    "typescript-eslint": "8.67.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Create `turbo.json`:

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "lint": { "dependsOn": ["^lint"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "dependsOn": ["typecheck"], "outputs": ["coverage/**"] },
    "test:integration": { "dependsOn": ["build"], "cache": false },
    "test:simulator": { "dependsOn": ["build"], "cache": false },
    "dev": { "cache": false, "persistent": true }
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
```

Create `eslint.config.mjs`:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/.arena/**'] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error'
    }
  }
);
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.turbo/
.arena/
*.sqlite
*.sqlite-shm
*.sqlite-wal
.env
.env.*
!.env.example
apps/edge-agent/config/lab-inventory.local.json
apps/edge-agent/config/lab-env.local.ps1
apps/edge-agent/evidence/
vendor/topdata/
```

- [ ] **Step 2: Create the Edge package and test configuration**

Create `apps/edge-agent/package.json`:

```json
{
  "name": "edge-agent",
  "version": "0.0.0",
  "private": true,
  "main": "dist/src/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/main.ts",
    "start": "node dist/src/main.js",
    "lint": "eslint src test",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "jest --runInBand",
    "test:coverage": "jest --runInBand --coverage",
    "test:integration": "jest --runInBand test/integration",
    "test:simulator": "jest --runInBand test/simulator test/acceptance",
    "lab:diagnose": "tsx src/cli/diagnose.ts",
    "lab:collector": "node dist/src/transport/collector-simulator.js",
    "lab:run": "node dist/src/main.js"
  },
  "dependencies": {
    "pino": "10.3.1",
    "zod": "4.4.3"
  }
}
```

Create `apps/edge-agent/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "jest"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `apps/edge-agent/jest.config.cjs`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 }
  }
};
```

- [ ] **Step 3: Install once and write the failing version test**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` is created and install exits `0`.

Create `apps/edge-agent/test/unit/version.test.ts`:

```ts
import { EDGE_AGENT_VERSION } from '../../src/version';

describe('edge agent version', () => {
  it('exposes the package version used by health and diagnostics', () => {
    expect(EDGE_AGENT_VERSION).toBe('0.0.0');
  });
});
```

- [ ] **Step 4: Run the test and implement the minimum version module**

Run: `pnpm --filter edge-agent test -- version.test.ts`

Expected: FAIL with `Cannot find module '../../src/version'`.

Create `apps/edge-agent/src/version.ts`:

```ts
export const EDGE_AGENT_VERSION = '0.0.0' as const;
```

Run: `pnpm --filter edge-agent test -- version.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Verify and commit the bootstrap**

Run:

```bash
pnpm --filter edge-agent lint
pnpm --filter edge-agent typecheck
pnpm --filter edge-agent build
```

Expected: all commands exit `0` and `apps/edge-agent/dist/src/version.js` exists.

Commit:

```bash
git add .gitignore .nvmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs apps/edge-agent
git commit -m "build(edge): bootstrap reproducible edge agent workspace"
```

## Task 2: Validated configuration and secret-safe logger

**Files:**
- Create: `apps/edge-agent/src/config/env.ts`
- Create: `apps/edge-agent/src/observability/logger.ts`
- Test: `apps/edge-agent/test/unit/env.test.ts`
- Test: `apps/edge-agent/test/unit/logger.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Create `apps/edge-agent/test/unit/env.test.ts`:

```ts
import { parseEnv, safeConfigView } from '../../src/config/env';

const valid = {
  EDGE_ID: 'edge-lab-01',
  EDGE_UNIT_ID: 'unit-lab-01',
  EDGE_FACIAL_DEVICE_ID: 'facial-lab-01',
  EDGE_TURNSTILE_DEVICE_ID: 'turnstile-lab-01',
  EDGE_INVENTORY_PATH: 'config/lab-inventory.simulator.json',
  EDGE_DB_PATH: '.arena/edge.sqlite',
  EDGE_BRIDGE_EXECUTABLE: 'node',
  EDGE_BRIDGE_ARGS_JSON: '["dist/src/bridge/simulator.js"]',
  EDGE_COLLECTOR_URL: 'http://127.0.0.1:4010/events',
  EDGE_SHARED_SECRET: '0123456789abcdef',
  EDGE_HEALTH_PORT: '4011'
};

describe('parseEnv', () => {
  it('parses a valid lab configuration', () => {
    expect(parseEnv(valid).healthPort).toBe(4011);
  });

  it('rejects a short secret', () => {
    expect(() => parseEnv({ ...valid, EDGE_SHARED_SECRET: 'short' })).toThrow();
  });

  it('never exposes the shared secret in diagnostics', () => {
    expect(JSON.stringify(safeConfigView(parseEnv(valid)))).not.toContain(valid.EDGE_SHARED_SECRET);
  });
});
```

- [ ] **Step 2: Run the configuration test to verify failure**

Run: `pnpm --filter edge-agent test -- env.test.ts`

Expected: FAIL with `Cannot find module '../../src/config/env'`.

- [ ] **Step 3: Implement configuration parsing and masking**

Create `apps/edge-agent/src/config/env.ts`:

```ts
import { z } from 'zod';

const envSchema = z.object({
  EDGE_ID: z.string().min(3),
  EDGE_UNIT_ID: z.string().min(3),
  EDGE_FACIAL_DEVICE_ID: z.string().min(3),
  EDGE_TURNSTILE_DEVICE_ID: z.string().min(3),
  EDGE_INVENTORY_PATH: z.string().min(1),
  EDGE_DB_PATH: z.string().min(1),
  EDGE_BRIDGE_EXECUTABLE: z.string().min(1),
  EDGE_BRIDGE_ARGS_JSON: z.string().transform((value, context) => {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed;
    } catch { /* converted to a Zod issue below */ }
    context.addIssue({ code: 'custom', message: 'EDGE_BRIDGE_ARGS_JSON must be a JSON string array' });
    return z.NEVER;
  }),
  EDGE_COLLECTOR_URL: z.url(),
  EDGE_SHARED_SECRET: z.string().min(16),
  EDGE_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4011)
});

export interface EdgeConfig {
  edgeId: string;
  unitId: string;
  facialDeviceId: string;
  turnstileDeviceId: string;
  inventoryPath: string;
  dbPath: string;
  bridgeExecutable: string;
  bridgeArgs: string[];
  collectorUrl: URL;
  sharedSecret: string;
  healthPort: number;
}

export function parseEnv(env: NodeJS.ProcessEnv | Record<string, string>): EdgeConfig {
  const value = envSchema.parse(env);
  return {
    edgeId: value.EDGE_ID,
    unitId: value.EDGE_UNIT_ID,
    facialDeviceId: value.EDGE_FACIAL_DEVICE_ID,
    turnstileDeviceId: value.EDGE_TURNSTILE_DEVICE_ID,
    inventoryPath: value.EDGE_INVENTORY_PATH,
    dbPath: value.EDGE_DB_PATH,
    bridgeExecutable: value.EDGE_BRIDGE_EXECUTABLE,
    bridgeArgs: value.EDGE_BRIDGE_ARGS_JSON,
    collectorUrl: new URL(value.EDGE_COLLECTOR_URL),
    sharedSecret: value.EDGE_SHARED_SECRET,
    healthPort: value.EDGE_HEALTH_PORT
  };
}

export function safeConfigView(config: EdgeConfig) {
  return {
    edgeId: config.edgeId,
    unitId: config.unitId,
    facialDeviceId: config.facialDeviceId,
    turnstileDeviceId: config.turnstileDeviceId,
    inventoryPath: config.inventoryPath,
    dbPath: config.dbPath,
    bridgeExecutable: config.bridgeExecutable,
    bridgeArgs: config.bridgeArgs,
    collectorOrigin: config.collectorUrl.origin,
    sharedSecret: '[REDACTED]',
    healthPort: config.healthPort
  } as const;
}
```

Run: `pnpm --filter edge-agent test -- env.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 4: Write and satisfy the logger redaction test**

Create `apps/edge-agent/test/unit/logger.test.ts`:

```ts
import { Writable } from 'node:stream';
import { createLogger } from '../../src/observability/logger';

describe('createLogger', () => {
  it('redacts secrets and preserves correlationId', () => {
    let output = '';
    const destination = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
    const logger = createLogger(destination);
    logger.info({ correlationId: 'corr-1', sharedSecret: 'secret-value' }, 'connected');
    expect(output).toContain('corr-1');
    expect(output).not.toContain('secret-value');
  });
});
```

Run: `pnpm --filter edge-agent test -- logger.test.ts`

Expected: FAIL with `Cannot find module '../../src/observability/logger'`.

Create `apps/edge-agent/src/observability/logger.ts`:

```ts
import pino, { type DestinationStream, type Logger } from 'pino';

export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      base: { service: 'edge-agent' },
      redact: {
        paths: ['sharedSecret', '*.sharedSecret', 'authorization', '*.authorization'],
        censor: '[REDACTED]'
      }
    },
    destination
  );
}
```

Run: `pnpm --filter edge-agent test -- logger.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Verify and commit configuration**

Run: `pnpm --filter edge-agent lint && pnpm --filter edge-agent typecheck && pnpm --filter edge-agent test -- env.test.ts logger.test.ts`

Expected: all commands exit `0`.

Commit:

```bash
git add apps/edge-agent/src/config apps/edge-agent/src/observability apps/edge-agent/test/unit
git commit -m "feat(edge): validate config and redact secrets"
```

## Task 3: SQLite lifecycle and strict schema

**Files:**
- Create: `apps/edge-agent/src/persistence/database.ts`
- Create: `apps/edge-agent/src/persistence/schema.ts`
- Test: `apps/edge-agent/test/integration/database.test.ts`

- [ ] **Step 1: Write the failing migration and durability tests**

Create `apps/edge-agent/test/integration/database.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEdgeDatabase } from '../../src/persistence/database';

describe('edge sqlite database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'arenahub-edge-'));
  const path = join(directory, 'edge.sqlite');

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('creates the complete strict schema once', () => {
    const db = openEdgeDatabase(path);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    expect(tables).toEqual(expect.arrayContaining([
      { name: 'lab_access_events' },
      { name: 'lab_access_permissions' },
      { name: 'lab_device_users' },
      { name: 'lab_devices' },
      { name: 'schema_migrations' }
    ]));
    db.close();
  });

  it('keeps committed rows after close and reopen', () => {
    let db = openEdgeDatabase(path);
    db.prepare('INSERT OR REPLACE INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('device-1', 'Topdata', 'SIMULATOR', 'SIM-001', 'sim-1', 'SIMULATOR', 'hash-1');
    db.close();
    db = openEdgeDatabase(path);
    expect(db.prepare('SELECT id FROM lab_devices WHERE id = ?').get('device-1')).toEqual({ id: 'device-1' });
    db.close();
  });
});
```

- [ ] **Step 2: Run the integration test to verify failure**

Run: `pnpm --filter edge-agent test:integration -- database.test.ts`

Expected: FAIL with `Cannot find module '../../src/persistence/database'`.

- [ ] **Step 3: Define the strict schema**

Create `apps/edge-agent/src/persistence/schema.ts`:

```ts
export const migrations = [{
  version: 1,
  sql: `
    CREATE TABLE IF NOT EXISTS lab_devices (
      id TEXT PRIMARY KEY,
      manufacturer TEXT NOT NULL,
      model TEXT NOT NULL,
      serial_number TEXT NOT NULL UNIQUE,
      firmware TEXT NOT NULL,
      adapter_type TEXT NOT NULL,
      configuration_fingerprint TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS lab_device_users (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES lab_devices(id),
      internal_subject_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      sync_status TEXT NOT NULL CHECK (sync_status IN ('PENDING','SYNCED','FAILED','REMOVED')),
      last_error_code TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(device_id, external_user_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS lab_access_permissions (
      internal_subject_id TEXT PRIMARY KEY,
      outcome TEXT NOT NULL CHECK (outcome IN ('ALLOW','DENY')),
      valid_until TEXT NOT NULL,
      cache_version INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS lab_access_events (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL REFERENCES lab_devices(id),
      external_user_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('ALLOW','DENY')),
      reason TEXT NOT NULL,
      passage_state TEXT NOT NULL CHECK (passage_state IN ('NOT_APPLICABLE','PENDING','CONFIRMED','TIMED_OUT')),
      occurred_at TEXT NOT NULL,
      received_at TEXT,
      delivered_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      dead_lettered_at TEXT
    ) STRICT;
  `
}] as const;
```

- [ ] **Step 4: Implement migration, WAL and safe connection defaults**

Create `apps/edge-agent/src/persistence/database.ts`:

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './schema';

export function openEdgeDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5_000, enableForeignKeyConstraints: true, defensive: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;');
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number };
  for (const migration of migrations) {
    if (migration.version <= current.version) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
```

Run: `pnpm --filter edge-agent test:integration -- database.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Verify and commit SQLite foundation**

Run: `pnpm --filter edge-agent lint && pnpm --filter edge-agent typecheck && pnpm --filter edge-agent test:integration`

Expected: all commands exit `0`; no SQLite file exists outside the test temp directory.

Commit:

```bash
git add apps/edge-agent/src/persistence apps/edge-agent/test/integration/database.test.ts
git commit -m "feat(edge): add durable sqlite schema"
```

## Task 4: Stable domain contracts and retryable errors

**Files:**
- Create: `apps/edge-agent/src/domain/contracts.ts`
- Create: `apps/edge-agent/src/domain/errors.ts`
- Test: `apps/edge-agent/test/unit/errors.test.ts`

- [ ] **Step 1: Write the failing error-classification test**

Create `apps/edge-agent/test/unit/errors.test.ts`:

```ts
import { EdgeError, isRetryable } from '../../src/domain/errors';

describe('EdgeError', () => {
  it.each([
    ['BRIDGE_TIMEOUT', true],
    ['DEVICE_OFFLINE', true],
    ['INVALID_EVENT', false],
    ['USER_CONFLICT', false]
  ] as const)('classifies %s retryable=%s', (code, expected) => {
    expect(isRetryable(new EdgeError(code, code))).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter edge-agent test -- errors.test.ts`

Expected: FAIL with `Cannot find module '../../src/domain/errors'`.

- [ ] **Step 3: Implement errors and the complete device contracts**

Create `apps/edge-agent/src/domain/errors.ts`:

```ts
export type EdgeErrorCode =
  | 'BRIDGE_TIMEOUT'
  | 'BRIDGE_EXITED'
  | 'DEVICE_OFFLINE'
  | 'INVALID_EVENT'
  | 'USER_CONFLICT'
  | 'USER_NOT_FOUND'
  | 'COLLECTOR_UNAVAILABLE';

export class EdgeError extends Error {
  constructor(public readonly code: EdgeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EdgeError';
  }
}

const retryable = new Set<EdgeErrorCode>([
  'BRIDGE_TIMEOUT', 'BRIDGE_EXITED', 'DEVICE_OFFLINE', 'COLLECTOR_UNAVAILABLE'
]);

export function isRetryable(error: unknown): boolean {
  return error instanceof EdgeError && retryable.has(error.code);
}
```

Create `apps/edge-agent/src/domain/contracts.ts`:

```ts
export type Unsubscribe = () => void;
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

export interface DeviceHealth {
  deviceId: string;
  status: DeviceStatus;
  firmware: string;
  checkedAt: string;
  detail?: string;
}

export interface UpsertDeviceUser {
  correlationId: string;
  deviceId: string;
  internalSubjectId: string;
  externalUserId: string;
  displayName: string;
}

export interface DeleteDeviceUser {
  correlationId: string;
  deviceId: string;
  externalUserId: string;
}

export interface DeviceUserResult {
  externalUserId: string;
  status: 'SYNCED' | 'REMOVED';
}

export interface RecognitionEvent {
  eventId: string;
  deviceId: string;
  externalUserId: string;
  occurredAt: string;
}

export interface GrantPassage {
  correlationId: string;
  idempotencyKey: string;
  deviceId: string;
  externalUserId: string;
}

export interface GrantResult {
  commandId: string;
  accepted: boolean;
}

export interface PassageEvent {
  commandId: string;
  correlationId: string;
  deviceId: string;
  state: 'CONFIRMED' | 'TIMED_OUT';
  occurredAt: string;
}

export interface FacialDeviceAdapter {
  health(): Promise<DeviceHealth>;
  upsertUser(command: UpsertDeviceUser): Promise<DeviceUserResult>;
  deleteUser(command: DeleteDeviceUser): Promise<DeviceUserResult>;
  subscribeToRecognitions(handler: (event: RecognitionEvent) => void): Unsubscribe;
}

export interface TurnstileAdapter {
  health(): Promise<DeviceHealth>;
  grantPassage(command: GrantPassage): Promise<GrantResult>;
  subscribeToPassages(handler: (event: PassageEvent) => void): Unsubscribe;
}

export interface CollectorEvent {
  id: string;
  idempotencyKey: string;
  deviceId: string;
  externalUserId: string;
  decision: 'ALLOW' | 'DENY';
  reason: 'ACTIVE_PERMISSION' | 'NO_PERMISSION' | 'PERMISSION_EXPIRED' | 'EXPLICIT_DENY';
  passageState: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'TIMED_OUT';
  occurredAt: string;
}

export interface EventCollector {
  deliver(event: CollectorEvent): Promise<{ receivedAt: string }>;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter edge-agent test -- errors.test.ts && pnpm --filter edge-agent typecheck`

Expected: PASS and typecheck exits `0`.

- [ ] **Step 5: Commit domain contracts**

```bash
git add apps/edge-agent/src/domain apps/edge-agent/test/unit/errors.test.ts
git commit -m "feat(edge): define device and collector contracts"
```

## Task 5: JSON Lines bridge client and simulator process

**Files:**
- Create: `apps/edge-agent/src/bridge/protocol.ts`
- Create: `apps/edge-agent/src/bridge/json-line-client.ts`
- Create: `apps/edge-agent/src/bridge/simulator.ts`
- Test: `apps/edge-agent/test/simulator/bridge.test.ts`

- [ ] **Step 1: Define protocol types and write the failing bridge test**

Create `apps/edge-agent/src/bridge/protocol.ts`:

```ts
import type { DeviceHealth, PassageEvent, RecognitionEvent } from '../domain/contracts';

export type BridgeOperation =
  | 'health'
  | 'facial.user.upsert'
  | 'facial.user.delete'
  | 'simulator.configure'
  | 'simulator.recognize'
  | 'simulator.malformed'
  | 'turnstile.grant';

export interface BridgeRequest {
  id: string;
  operation: BridgeOperation;
  payload: Record<string, unknown>;
}

export type BridgeResponse =
  | { id: string; ok: true; result: Record<string, unknown> }
  | { id: string; ok: false; error: { code: string; message: string } };

export type BridgeEvent =
  | { event: 'facial.recognition'; payload: RecognitionEvent }
  | { event: 'turnstile.passage'; payload: PassageEvent }
  | { event: 'device.health'; payload: DeviceHealth };
```

Create `apps/edge-agent/test/simulator/bridge.test.ts`:

```ts
import { join } from 'node:path';
import { JsonLineBridgeClient } from '../../src/bridge/json-line-client';

describe('JSON Lines simulator bridge', () => {
  it('supports health, user lifecycle and recognition events', async () => {
    const bridge = new JsonLineBridgeClient(process.execPath, [join(process.cwd(), 'dist/src/bridge/simulator.js')]);
    await bridge.start();
    await expect(bridge.request('health', {})).resolves.toMatchObject({ status: 'ONLINE' });
    await bridge.request('facial.user.upsert', { externalUserId: '83714', displayName: 'Lab One' });
    await expect(bridge.request('facial.user.upsert', { externalUserId: '83714', displayName: 'Conflicting Person' }))
      .rejects.toThrow('USER_CONFLICT');
    const recognition = new Promise<string>((resolve) => {
      const unsubscribe = bridge.on('facial.recognition', (event) => {
        unsubscribe();
        resolve(String(event.externalUserId));
      });
    });
    await bridge.request('simulator.recognize', { externalUserId: '83714' });
    await expect(recognition).resolves.toBe('83714');
    await bridge.request('facial.user.delete', { externalUserId: '83714' });
    await expect(bridge.request('simulator.recognize', { externalUserId: '83714' })).rejects.toThrow('USER_NOT_FOUND');
    await bridge.stop();
    await expect(bridge.request('health', {})).rejects.toMatchObject({ code: 'BRIDGE_EXITED' });
  });

  it('emits an explicit passage timeout', async () => {
    const bridge = new JsonLineBridgeClient(process.execPath, [join(process.cwd(), 'dist/src/bridge/simulator.js')]);
    await bridge.start();
    await bridge.request('simulator.configure', { nextPassageState: 'TIMED_OUT' });
    const passage = new Promise<string>((resolve) => {
      const unsubscribe = bridge.on('turnstile.passage', (event) => { unsubscribe(); resolve(String(event.state)); });
    });
    await bridge.request('turnstile.grant', { idempotencyKey: 'timeout-1' });
    await expect(passage).resolves.toBe('TIMED_OUT');
    await bridge.stop();
  });

  it('reports malformed device output without crashing the process', async () => {
    const protocolError = jest.fn();
    const bridge = new JsonLineBridgeClient(process.execPath, [join(process.cwd(), 'dist/src/bridge/simulator.js')], 2_000, protocolError);
    await bridge.start();
    await bridge.request('simulator.malformed', {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(protocolError).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_EVENT' }));
    await bridge.stop();
  });
});
```

- [ ] **Step 2: Run build and verify the simulator test fails**

Run: `pnpm --filter edge-agent build && pnpm --filter edge-agent test:simulator -- bridge.test.ts`

Expected: FAIL with `Cannot find module '../../src/bridge/json-line-client'`.

- [ ] **Step 3: Implement the bridge client with timeout and process isolation**

Create `apps/edge-agent/src/bridge/json-line-client.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { EdgeError } from '../domain/errors';
import type { BridgeEvent, BridgeOperation, BridgeResponse } from './protocol';

type EventName = BridgeEvent['event'];
type Handler = (payload: Record<string, unknown>) => void;

export class JsonLineBridgeClient {
  private child?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private readonly handlers = new Map<EventName, Set<Handler>>();

  constructor(
    private readonly executable: string,
    private readonly args: string[],
    private readonly timeoutMs = 2_000,
    private readonly onProtocolError: (error: EdgeError) => void = () => undefined
  ) {}

  async start(): Promise<void> {
    if (this.child) return;
    this.child = spawn(this.executable, this.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => this.handleLine(line));
    this.child.once('exit', () => {
      for (const entry of this.pending.values()) entry.reject(new EdgeError('BRIDGE_EXITED', 'Vendor bridge exited'));
      this.pending.clear();
      this.child = undefined;
    });
    await new Promise<void>((resolve, reject) => {
      this.child?.once('spawn', resolve);
      this.child?.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  }

  request(operation: BridgeOperation, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.child) return Promise.reject(new EdgeError('BRIDGE_EXITED', 'Vendor bridge is not running'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EdgeError('BRIDGE_TIMEOUT', `Bridge request timed out: ${operation}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(`${JSON.stringify({ id, operation, payload })}\n`);
    });
  }

  on(event: EventName, handler: Handler): () => void {
    const listeners = this.handlers.get(event) ?? new Set<Handler>();
    listeners.add(handler);
    this.handlers.set(event, listeners);
    return () => listeners.delete(handler);
  }

  private handleLine(line: string): void {
    let message: BridgeResponse | BridgeEvent;
    try {
      message = JSON.parse(line) as BridgeResponse | BridgeEvent;
    } catch (error) {
      this.onProtocolError(new EdgeError('INVALID_EVENT', 'Vendor bridge emitted malformed JSON', { cause: error }));
      return;
    }
    if ('event' in message) {
      for (const handler of this.handlers.get(message.event) ?? []) handler(message.payload as unknown as Record<string, unknown>);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new EdgeError('INVALID_EVENT', `${message.error.code}: ${message.error.message}`));
  }
}
```

- [ ] **Step 4: Implement the deterministic simulator process**

Create `apps/edge-agent/src/bridge/simulator.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { BridgeRequest, BridgeResponse } from './protocol';

const users = new Map<string, string>();
let deviceStatus: 'ONLINE' | 'OFFLINE' = 'ONLINE';
let nextPassageState: 'CONFIRMED' | 'TIMED_OUT' = 'CONFIRMED';
const output = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = createInterface({ input: process.stdin });

lines.on('line', (line) => {
  const request = JSON.parse(line) as BridgeRequest;
  const externalUserId = String(request.payload.externalUserId ?? '');
  const ok = (result: Record<string, unknown>): BridgeResponse => ({ id: request.id, ok: true, result });
  const fail = (code: string, message: string): BridgeResponse => ({ id: request.id, ok: false, error: { code, message } });

  switch (request.operation) {
    case 'health': output(ok({ deviceId: 'simulator', status: deviceStatus, firmware: 'sim-1', checkedAt: new Date().toISOString() })); break;
    case 'facial.user.upsert': {
      const displayName = String(request.payload.displayName ?? '');
      if (users.has(externalUserId) && users.get(externalUserId) !== displayName) output(fail('USER_CONFLICT', externalUserId));
      else { users.set(externalUserId, displayName); output(ok({ externalUserId, status: 'SYNCED' })); }
      break;
    }
    case 'facial.user.delete': users.delete(externalUserId); output(ok({ externalUserId, status: 'REMOVED' })); break;
    case 'simulator.configure':
      if (request.payload.deviceStatus === 'OFFLINE' || request.payload.deviceStatus === 'ONLINE') deviceStatus = request.payload.deviceStatus;
      if (request.payload.nextPassageState === 'TIMED_OUT' || request.payload.nextPassageState === 'CONFIRMED') nextPassageState = request.payload.nextPassageState;
      output(ok({ configured: true }));
      break;
    case 'simulator.recognize':
      if (!users.has(externalUserId)) output(fail('USER_NOT_FOUND', externalUserId));
      else {
        output(ok({ accepted: true }));
        output({ event: 'facial.recognition', payload: { eventId: randomUUID(), deviceId: 'sim-facial-1', externalUserId, occurredAt: new Date().toISOString() } });
      }
      break;
    case 'simulator.malformed':
      output(ok({ accepted: true }));
      process.stdout.write('{malformed-json\n');
      break;
    case 'turnstile.grant': {
      const commandId = randomUUID();
      output(ok({ commandId, accepted: true }));
      const state = nextPassageState;
      nextPassageState = 'CONFIRMED';
      const correlationId = String(request.payload.correlationId ?? '');
      setTimeout(() => output({ event: 'turnstile.passage', payload: { commandId, correlationId, deviceId: 'sim-turnstile-1', state, occurredAt: new Date().toISOString() } }), 5);
      break;
    }
  }
});
```

Run: `pnpm --filter edge-agent build && pnpm --filter edge-agent test:simulator -- bridge.test.ts`

Expected: PASS, 1 test; child process exits cleanly.

- [ ] **Step 5: Verify and commit the bridge boundary**

Run: `pnpm --filter edge-agent lint && pnpm --filter edge-agent typecheck && pnpm --filter edge-agent test:simulator -- bridge.test.ts`

Expected: all commands exit `0`.

Commit:

```bash
git add apps/edge-agent/src/bridge apps/edge-agent/test/simulator/bridge.test.ts
git commit -m "feat(edge): add isolated vendor bridge protocol"
```

## Task 6: Device-user repository and facial adapter

**Files:**
- Create: `apps/edge-agent/src/persistence/repositories.ts`
- Create: `apps/edge-agent/src/adapters/facial-adapter.ts`
- Test: `apps/edge-agent/test/integration/facial-adapter.test.ts`

- [ ] **Step 1: Write the failing facial lifecycle test**

Create `apps/edge-agent/test/integration/facial-adapter.test.ts`:

```ts
import { openEdgeDatabase } from '../../src/persistence/database';
import { EdgeRepositories } from '../../src/persistence/repositories';
import { FacialBridgeAdapter } from '../../src/adapters/facial-adapter';

describe('FacialBridgeAdapter', () => {
  it('persists internal to external mapping and removal', async () => {
    const db = openEdgeDatabase(':memory:');
    db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('facial-1', 'Topdata', 'SIMULATOR', 'SIM-FACE', 'sim-1', 'FACIAL', 'hash');
    const bridge = {
      request: jest.fn().mockResolvedValueOnce({ externalUserId: '83714', status: 'SYNCED' })
        .mockResolvedValueOnce({ externalUserId: '83714', status: 'REMOVED' }),
      on: jest.fn().mockReturnValue(() => undefined)
    };
    const repositories = new EdgeRepositories(db);
    const adapter = new FacialBridgeAdapter('facial-1', bridge, repositories);
    await adapter.upsertUser({ correlationId: 'c1', deviceId: 'facial-1', internalSubjectId: 'subject-1', externalUserId: '83714', displayName: 'Lab One' });
    expect(repositories.findDeviceUser('facial-1', '83714')).toMatchObject({ internalSubjectId: 'subject-1', syncStatus: 'SYNCED' });
    await adapter.deleteUser({ correlationId: 'c2', deviceId: 'facial-1', externalUserId: '83714' });
    expect(repositories.findDeviceUser('facial-1', '83714')).toMatchObject({ syncStatus: 'REMOVED' });
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter edge-agent test:integration -- facial-adapter.test.ts`

Expected: FAIL because repository and adapter modules do not exist.

- [ ] **Step 3: Implement the repositories used by the facial lifecycle**

Create `apps/edge-agent/src/persistence/repositories.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CollectorEvent } from '../domain/contracts';

export class EdgeRepositories {
  constructor(private readonly db: DatabaseSync) {}

  saveDevice(input: { id: string; manufacturer: string; model: string; serialNumber: string; firmware: string; adapterType: 'FACIAL' | 'TURNSTILE'; configurationFingerprint: string }): void {
    this.db.prepare(`INSERT INTO lab_devices VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET manufacturer=excluded.manufacturer,model=excluded.model,
      serial_number=excluded.serial_number,firmware=excluded.firmware,adapter_type=excluded.adapter_type,
      configuration_fingerprint=excluded.configuration_fingerprint`)
      .run(input.id, input.manufacturer, input.model, input.serialNumber, input.firmware, input.adapterType, input.configurationFingerprint);
  }

  saveDeviceUser(input: { deviceId: string; internalSubjectId: string; externalUserId: string; syncStatus: 'SYNCED' | 'REMOVED'; lastErrorCode?: string }): void {
    this.db.prepare(`
      INSERT INTO lab_device_users(id, device_id, internal_subject_id, external_user_id, sync_status, last_error_code, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, external_user_id) DO UPDATE SET
        internal_subject_id=excluded.internal_subject_id, sync_status=excluded.sync_status,
        last_error_code=excluded.last_error_code, updated_at=excluded.updated_at
    `).run(randomUUID(), input.deviceId, input.internalSubjectId, input.externalUserId, input.syncStatus, input.lastErrorCode ?? null, new Date().toISOString());
  }

  findDeviceUser(deviceId: string, externalUserId: string) {
    return this.db.prepare(`SELECT internal_subject_id AS internalSubjectId, external_user_id AS externalUserId,
      sync_status AS syncStatus FROM lab_device_users WHERE device_id=? AND external_user_id=?`)
      .get(deviceId, externalUserId) as { internalSubjectId: string; externalUserId: string; syncStatus: string } | undefined;
  }

  savePermission(input: { internalSubjectId: string; outcome: 'ALLOW' | 'DENY'; validUntil: string; cacheVersion: number }): void {
    this.db.prepare(`INSERT INTO lab_access_permissions VALUES (?, ?, ?, ?)
      ON CONFLICT(internal_subject_id) DO UPDATE SET outcome=excluded.outcome, valid_until=excluded.valid_until, cache_version=excluded.cache_version`)
      .run(input.internalSubjectId, input.outcome, input.validUntil, input.cacheVersion);
  }

  findPermission(internalSubjectId: string) {
    return this.db.prepare(`SELECT outcome, valid_until AS validUntil, cache_version AS cacheVersion
      FROM lab_access_permissions WHERE internal_subject_id=?`).get(internalSubjectId) as
      { outcome: 'ALLOW' | 'DENY'; validUntil: string; cacheVersion: number } | undefined;
  }

  enqueueEvent(event: CollectorEvent): void {
    this.db.prepare(`INSERT OR IGNORE INTO lab_access_events
      (id,idempotency_key,device_id,external_user_id,decision,reason,passage_state,occurred_at,attempt_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(event.id, event.idempotencyKey, event.deviceId, event.externalUserId, event.decision, event.reason, event.passageState, event.occurredAt);
  }

  pendingEvents(limit = 100): CollectorEvent[] {
    return this.db.prepare(`SELECT id,idempotency_key AS idempotencyKey,device_id AS deviceId,
      external_user_id AS externalUserId,decision,reason,passage_state AS passageState,occurred_at AS occurredAt
      FROM lab_access_events WHERE delivered_at IS NULL AND dead_lettered_at IS NULL ORDER BY occurred_at LIMIT ?`).all(limit) as unknown as CollectorEvent[];
  }

  markAttempt(id: string): void { this.db.prepare('UPDATE lab_access_events SET attempt_count=attempt_count+1 WHERE id=?').run(id); }
  markFailure(id: string, errorCode: string, deadLetter: boolean): void {
    this.db.prepare('UPDATE lab_access_events SET last_error_code=?, dead_lettered_at=? WHERE id=?')
      .run(errorCode, deadLetter ? new Date().toISOString() : null, id);
  }
  countDeadLetters(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM lab_access_events WHERE dead_lettered_at IS NOT NULL').get() as { count: number };
    return row.count;
  }
  markDelivered(id: string, receivedAt: string): void {
    this.db.prepare('UPDATE lab_access_events SET received_at=?, delivered_at=? WHERE id=?').run(receivedAt, new Date().toISOString(), id);
  }
  updatePassage(commandId: string, state: 'CONFIRMED' | 'TIMED_OUT'): void {
    this.db.prepare('UPDATE lab_access_events SET passage_state=? WHERE id=?').run(state, commandId);
  }
}
```

- [ ] **Step 4: Implement the facial adapter against the bridge contract**

Create `apps/edge-agent/src/adapters/facial-adapter.ts`:

```ts
import type { DeleteDeviceUser, DeviceHealth, DeviceUserResult, FacialDeviceAdapter, RecognitionEvent, Unsubscribe, UpsertDeviceUser } from '../domain/contracts';
import type { EdgeRepositories } from '../persistence/repositories';

interface BridgePort {
  request(operation: 'health' | 'facial.user.upsert' | 'facial.user.delete', payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  on(event: 'facial.recognition', handler: (payload: Record<string, unknown>) => void): Unsubscribe;
}

export class FacialBridgeAdapter implements FacialDeviceAdapter {
  constructor(private readonly deviceId: string, private readonly bridge: BridgePort, private readonly repositories: EdgeRepositories) {}

  async health(): Promise<DeviceHealth> {
    return await this.bridge.request('health', { deviceId: this.deviceId }) as unknown as DeviceHealth;
  }

  async upsertUser(command: UpsertDeviceUser): Promise<DeviceUserResult> {
    const result = await this.bridge.request('facial.user.upsert', { ...command }) as unknown as DeviceUserResult;
    this.repositories.saveDeviceUser({ deviceId: command.deviceId, internalSubjectId: command.internalSubjectId, externalUserId: command.externalUserId, syncStatus: 'SYNCED' });
    return result;
  }

  async deleteUser(command: DeleteDeviceUser): Promise<DeviceUserResult> {
    const existing = this.repositories.findDeviceUser(command.deviceId, command.externalUserId);
    const result = await this.bridge.request('facial.user.delete', { ...command }) as unknown as DeviceUserResult;
    this.repositories.saveDeviceUser({ deviceId: command.deviceId, internalSubjectId: existing?.internalSubjectId ?? 'removed', externalUserId: command.externalUserId, syncStatus: 'REMOVED' });
    return result;
  }

  subscribeToRecognitions(handler: (event: RecognitionEvent) => void): Unsubscribe {
    return this.bridge.on('facial.recognition', (payload) => handler(payload as unknown as RecognitionEvent));
  }
}
```

Run: `pnpm --filter edge-agent test:integration -- facial-adapter.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Verify and commit facial lifecycle**

Run: `pnpm --filter edge-agent lint && pnpm --filter edge-agent typecheck && pnpm --filter edge-agent test:integration -- facial-adapter.test.ts`

Commit:

```bash
git add apps/edge-agent/src/adapters/facial-adapter.ts apps/edge-agent/src/persistence/repositories.ts apps/edge-agent/test/integration/facial-adapter.test.ts
git commit -m "feat(edge): persist facial device user lifecycle"
```

## Task 7: Deterministic access policy

**Files:**
- Create: `apps/edge-agent/src/application/access-policy.ts`
- Test: `apps/edge-agent/test/unit/access-policy.test.ts`

- [ ] **Step 1: Write complete failing policy scenarios**

Create `apps/edge-agent/test/unit/access-policy.test.ts`:

```ts
import { decideAccess } from '../../src/application/access-policy';

const now = new Date('2026-08-14T12:00:00.000Z');

describe('decideAccess', () => {
  it('allows an active explicit permission', () => {
    expect(decideAccess({ outcome: 'ALLOW', validUntil: '2026-08-15T00:00:00.000Z', cacheVersion: 1 }, now))
      .toEqual({ decision: 'ALLOW', reason: 'ACTIVE_PERMISSION' });
  });

  it('denies missing, expired and explicit deny permissions', () => {
    expect(decideAccess(undefined, now)).toEqual({ decision: 'DENY', reason: 'NO_PERMISSION' });
    expect(decideAccess({ outcome: 'ALLOW', validUntil: '2026-08-14T11:59:59.999Z', cacheVersion: 1 }, now))
      .toEqual({ decision: 'DENY', reason: 'PERMISSION_EXPIRED' });
    expect(decideAccess({ outcome: 'DENY', validUntil: '2026-08-15T00:00:00.000Z', cacheVersion: 1 }, now))
      .toEqual({ decision: 'DENY', reason: 'EXPLICIT_DENY' });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter edge-agent test -- access-policy.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the pure policy**

Create `apps/edge-agent/src/application/access-policy.ts`:

```ts
export interface CachedPermission {
  outcome: 'ALLOW' | 'DENY';
  validUntil: string;
  cacheVersion: number;
}

export type AccessDecision =
  | { decision: 'ALLOW'; reason: 'ACTIVE_PERMISSION' }
  | { decision: 'DENY'; reason: 'NO_PERMISSION' | 'PERMISSION_EXPIRED' | 'EXPLICIT_DENY' };

export function decideAccess(permission: CachedPermission | undefined, now: Date): AccessDecision {
  if (!permission) return { decision: 'DENY', reason: 'NO_PERMISSION' };
  if (Date.parse(permission.validUntil) < now.getTime()) return { decision: 'DENY', reason: 'PERMISSION_EXPIRED' };
  if (permission.outcome === 'DENY') return { decision: 'DENY', reason: 'EXPLICIT_DENY' };
  return { decision: 'ALLOW', reason: 'ACTIVE_PERMISSION' };
}
```

- [ ] **Step 4: Run unit suite and coverage**

Run: `pnpm --filter edge-agent test -- access-policy.test.ts --coverage`

Expected: PASS; `access-policy.ts` has 100% branch coverage.

- [ ] **Step 5: Commit access policy**

```bash
git add apps/edge-agent/src/application/access-policy.ts apps/edge-agent/test/unit/access-policy.test.ts
git commit -m "feat(edge): decide access from cached permission"
```

## Task 8: Durable turnstile command idempotency

**Files:**
- Modify: `apps/edge-agent/src/persistence/schema.ts`
- Modify: `apps/edge-agent/src/persistence/repositories.ts`
- Create: `apps/edge-agent/src/adapters/turnstile-adapter.ts`
- Test: `apps/edge-agent/test/integration/turnstile-adapter.test.ts`

- [ ] **Step 1: Write the failing duplicate-command test**

Create `apps/edge-agent/test/integration/turnstile-adapter.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEdgeDatabase } from '../../src/persistence/database';
import { EdgeRepositories } from '../../src/persistence/repositories';
import { TurnstileBridgeAdapter } from '../../src/adapters/turnstile-adapter';

describe('TurnstileBridgeAdapter', () => {
  it('sends one physical command after repeated call and database reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'turnstile-idempotency-'));
    const path = join(directory, 'edge.sqlite');
    const bridge = {
      request: jest.fn().mockResolvedValue({ commandId: 'vendor-command-1', accepted: true }),
      on: jest.fn().mockReturnValue(() => undefined)
    };
    const command = { correlationId: 'access-event-1', idempotencyKey: 'recognition-1', deviceId: 'turnstile-1', externalUserId: '83714' };
    let db = openEdgeDatabase(path);
    db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('turnstile-1','Topdata','SIM','T1','sim','TURNSTILE','h');
    let repositories = new EdgeRepositories(db);
    repositories.enqueueEvent({ id: 'access-event-1', idempotencyKey: 'recognition-1', deviceId: 'turnstile-1', externalUserId: '83714', decision: 'ALLOW', reason: 'ACTIVE_PERMISSION', passageState: 'PENDING', occurredAt: '2026-08-14T12:00:00.000Z' });
    await expect(new TurnstileBridgeAdapter('turnstile-1', bridge, repositories).grantPassage(command))
      .resolves.toEqual({ commandId: 'vendor-command-1', accepted: true });
    db.close();
    db = openEdgeDatabase(path);
    repositories = new EdgeRepositories(db);
    await expect(new TurnstileBridgeAdapter('turnstile-1', bridge, repositories).grantPassage(command))
      .resolves.toEqual({ commandId: 'vendor-command-1', accepted: true });
    expect(bridge.request).toHaveBeenCalledTimes(1);
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter edge-agent test:integration -- turnstile-adapter.test.ts`

Expected: FAIL because `TurnstileBridgeAdapter` does not exist.

- [ ] **Step 3: Add the command mapping migration and repository methods**

Replace the terminal `}] as const;` in `apps/edge-agent/src/persistence/schema.ts` with the following exact suffix:

```ts
},
{
  version: 2,
  sql: `
    CREATE TABLE IF NOT EXISTS lab_turnstile_commands (
      command_id TEXT PRIMARY KEY,
      access_event_id TEXT NOT NULL REFERENCES lab_access_events(id),
      idempotency_key TEXT NOT NULL UNIQUE,
      accepted INTEGER NOT NULL CHECK (accepted IN (0,1)),
      created_at TEXT NOT NULL
    ) STRICT;
  `
}
] as const;
```

Add these methods to `EdgeRepositories`:

```ts
saveTurnstileCommand(input: { commandId: string; accessEventId: string; idempotencyKey: string; accepted: boolean }): void {
  this.db.prepare(`INSERT OR IGNORE INTO lab_turnstile_commands
    (command_id,access_event_id,idempotency_key,accepted,created_at) VALUES (?,?,?,?,?)`)
    .run(input.commandId, input.accessEventId, input.idempotencyKey, input.accepted ? 1 : 0, new Date().toISOString());
}

findTurnstileCommandByKey(idempotencyKey: string) {
  return this.db.prepare(`SELECT command_id AS commandId, accepted FROM lab_turnstile_commands WHERE idempotency_key=?`)
    .get(idempotencyKey) as { commandId: string; accepted: 0 | 1 } | undefined;
}

findAccessEventIdByCommand(commandId: string): string | undefined {
  const row = this.db.prepare('SELECT access_event_id AS accessEventId FROM lab_turnstile_commands WHERE command_id=?')
    .get(commandId) as { accessEventId: string } | undefined;
  return row?.accessEventId;
}
```

- [ ] **Step 4: Implement the turnstile adapter**

Create `apps/edge-agent/src/adapters/turnstile-adapter.ts`:

```ts
import type { DeviceHealth, GrantPassage, GrantResult, PassageEvent, TurnstileAdapter, Unsubscribe } from '../domain/contracts';
import type { EdgeRepositories } from '../persistence/repositories';

interface BridgePort {
  request(operation: 'health' | 'turnstile.grant', payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  on(event: 'turnstile.passage', handler: (payload: Record<string, unknown>) => void): Unsubscribe;
}

export class TurnstileBridgeAdapter implements TurnstileAdapter {
  constructor(private readonly deviceId: string, private readonly bridge: BridgePort, private readonly repositories: EdgeRepositories) {}

  async health(): Promise<DeviceHealth> {
    return await this.bridge.request('health', { deviceId: this.deviceId }) as unknown as DeviceHealth;
  }

  async grantPassage(command: GrantPassage): Promise<GrantResult> {
    const existing = this.repositories.findTurnstileCommandByKey(command.idempotencyKey);
    if (existing) return { commandId: existing.commandId, accepted: existing.accepted === 1 };
    const result = await this.bridge.request('turnstile.grant', { ...command }) as unknown as GrantResult;
    this.repositories.saveTurnstileCommand({ commandId: result.commandId, accessEventId: command.correlationId, idempotencyKey: command.idempotencyKey, accepted: result.accepted });
    return result;
  }

  subscribeToPassages(handler: (event: PassageEvent) => void): Unsubscribe {
    return this.bridge.on('turnstile.passage', (payload) => handler(payload as unknown as PassageEvent));
  }
}
```

Run: `pnpm --filter edge-agent test:integration -- turnstile-adapter.test.ts`

Expected: PASS and `bridge.request` called once.

- [ ] **Step 5: Verify restart safety and commit**

Run: `pnpm --filter edge-agent test:integration -- turnstile-adapter.test.ts`

Expected: PASS; the file-backed reopen scenario calls `bridge.request` exactly once.

Commit:

```bash
git add apps/edge-agent/src/persistence apps/edge-agent/src/adapters/turnstile-adapter.ts apps/edge-agent/test/integration/turnstile-adapter.test.ts
git commit -m "feat(edge): make turnstile grants durable and idempotent"
```

## Task 9: Recognition-to-passage orchestration

**Files:**
- Modify: `apps/edge-agent/src/persistence/repositories.ts`
- Create: `apps/edge-agent/src/application/access-orchestrator.ts`
- Test: `apps/edge-agent/test/integration/access-orchestrator.test.ts`

- [ ] **Step 1: Write failing ALLOW and DENY orchestration tests**

Create `apps/edge-agent/test/integration/access-orchestrator.test.ts`:

```ts
import { openEdgeDatabase } from '../../src/persistence/database';
import { EdgeRepositories } from '../../src/persistence/repositories';
import { AccessOrchestrator } from '../../src/application/access-orchestrator';

describe('AccessOrchestrator', () => {
  function setup(outcome?: 'ALLOW' | 'DENY') {
    const db = openEdgeDatabase(':memory:');
    db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('facial-1','Topdata','SIM','F1','sim','FACIAL','h1');
    db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('turnstile-1','Topdata','SIM','T1','sim','TURNSTILE','h2');
    const repositories = new EdgeRepositories(db);
    repositories.saveDeviceUser({ deviceId: 'facial-1', internalSubjectId: 'subject-1', externalUserId: '83714', syncStatus: 'SYNCED' });
    if (outcome) repositories.savePermission({ internalSubjectId: 'subject-1', outcome, validUntil: '2026-08-15T00:00:00.000Z', cacheVersion: 1 });
    const turnstile = { grantPassage: jest.fn().mockResolvedValue({ commandId: 'cmd-1', accepted: true }) };
    const orchestrator = new AccessOrchestrator(repositories, turnstile, () => new Date('2026-08-14T12:00:00.000Z'));
    return { db, repositories, turnstile, orchestrator };
  }

  it('persists then grants an active permission', async () => {
    const { db, repositories, turnstile, orchestrator } = setup('ALLOW');
    await orchestrator.onRecognition({ eventId: 'rec-1', deviceId: 'facial-1', externalUserId: '83714', occurredAt: '2026-08-14T12:00:00.000Z' }, 'turnstile-1');
    expect(repositories.findAccessEventByKey('rec-1')).toMatchObject({ decision: 'ALLOW', passageState: 'PENDING' });
    expect(turnstile.grantPassage).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('persists denial without granting the turnstile', async () => {
    const { db, repositories, turnstile, orchestrator } = setup();
    await orchestrator.onRecognition({ eventId: 'rec-2', deviceId: 'facial-1', externalUserId: '83714', occurredAt: '2026-08-14T12:00:00.000Z' }, 'turnstile-1');
    expect(repositories.findAccessEventByKey('rec-2')).toMatchObject({ decision: 'DENY', reason: 'NO_PERMISSION', passageState: 'NOT_APPLICABLE' });
    expect(turnstile.grantPassage).not.toHaveBeenCalled();
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter edge-agent test:integration -- access-orchestrator.test.ts`

Expected: FAIL because orchestrator and query method are missing.

- [ ] **Step 3: Add event queries and passage correlation**

Add to `EdgeRepositories`:

```ts
findAccessEventByKey(idempotencyKey: string) {
  return this.db.prepare(`SELECT id,decision,reason,passage_state AS passageState
    FROM lab_access_events WHERE idempotency_key=?`).get(idempotencyKey) as
    { id: string; decision: 'ALLOW' | 'DENY'; reason: string; passageState: string } | undefined;
}

markPassage(accessEventId: string, state: 'CONFIRMED' | 'TIMED_OUT'): void {
  this.db.prepare('UPDATE lab_access_events SET passage_state=? WHERE id=?').run(state, accessEventId);
}
```

- [ ] **Step 4: Implement persistence-before-effect orchestration**

Create `apps/edge-agent/src/application/access-orchestrator.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { PassageEvent, RecognitionEvent } from '../domain/contracts';
import type { EdgeRepositories } from '../persistence/repositories';
import { decideAccess } from './access-policy';

interface TurnstilePort {
  grantPassage(command: { correlationId: string; idempotencyKey: string; deviceId: string; externalUserId: string }): Promise<{ commandId: string; accepted: boolean }>;
}

export class AccessOrchestrator {
  constructor(private readonly repositories: EdgeRepositories, private readonly turnstile: TurnstilePort, private readonly now: () => Date = () => new Date()) {}

  async onRecognition(event: RecognitionEvent, turnstileDeviceId: string): Promise<void> {
    if (this.repositories.findAccessEventByKey(event.eventId)) return;
    const mapping = this.repositories.findDeviceUser(event.deviceId, event.externalUserId);
    const permission = mapping ? this.repositories.findPermission(mapping.internalSubjectId) : undefined;
    const result = decideAccess(permission, this.now());
    const accessEventId = randomUUID();
    this.repositories.enqueueEvent({
      id: accessEventId,
      idempotencyKey: event.eventId,
      deviceId: turnstileDeviceId,
      externalUserId: event.externalUserId,
      decision: result.decision,
      reason: result.reason,
      passageState: result.decision === 'ALLOW' ? 'PENDING' : 'NOT_APPLICABLE',
      occurredAt: event.occurredAt
    });
    if (result.decision === 'ALLOW') {
      await this.turnstile.grantPassage({ correlationId: accessEventId, idempotencyKey: event.eventId, deviceId: turnstileDeviceId, externalUserId: event.externalUserId });
    }
  }

  onPassage(event: PassageEvent): void {
    this.repositories.markPassage(event.correlationId, event.state);
  }
}
```

Run: `pnpm --filter edge-agent test:integration -- access-orchestrator.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Add duplicate and passage cases, verify, and commit**

Append to `access-orchestrator.test.ts`:

```ts
it('deduplicates a repeated recognition event', async () => {
  const { db, turnstile, orchestrator } = setup('ALLOW');
  const recognition = { eventId: 'rec-duplicate', deviceId: 'facial-1', externalUserId: '83714', occurredAt: '2026-08-14T12:00:00.000Z' };
  await orchestrator.onRecognition(recognition, 'turnstile-1');
  await orchestrator.onRecognition(recognition, 'turnstile-1');
  expect(turnstile.grantPassage).toHaveBeenCalledTimes(1);
  db.close();
});

it('correlates a vendor command passage to the access event', async () => {
  const { db, repositories, orchestrator } = setup('ALLOW');
  await orchestrator.onRecognition({ eventId: 'rec-passage', deviceId: 'facial-1', externalUserId: '83714', occurredAt: '2026-08-14T12:00:00.000Z' }, 'turnstile-1');
  const accessEvent = repositories.findAccessEventByKey('rec-passage');
  repositories.saveTurnstileCommand({ commandId: 'cmd-1', accessEventId: accessEvent!.id, idempotencyKey: 'rec-passage', accepted: true });
  orchestrator.onPassage({ commandId: 'cmd-1', correlationId: accessEvent!.id, deviceId: 'turnstile-1', state: 'CONFIRMED', occurredAt: '2026-08-14T12:00:00.100Z' });
  expect(repositories.findAccessEventByKey('rec-passage')?.passageState).toBe('CONFIRMED');
  db.close();
});
```

Run: `pnpm --filter edge-agent test:integration -- access-orchestrator.test.ts`

Expected: PASS, 4 tests.

Commit:

```bash
git add apps/edge-agent/src/application/access-orchestrator.ts apps/edge-agent/src/persistence/repositories.ts apps/edge-agent/test/integration/access-orchestrator.test.ts
git commit -m "feat(edge): orchestrate recognition through passage"
```

## Task 10: Offline collector and idempotent delivery worker

**Files:**
- Create: `apps/edge-agent/src/transport/http-collector.ts`
- Create: `apps/edge-agent/src/transport/collector-simulator.ts`
- Create: `apps/edge-agent/src/application/delivery-worker.ts`
- Test: `apps/edge-agent/test/integration/delivery-worker.test.ts`

- [ ] **Step 1: Write the failing offline/recovery test**

Create `apps/edge-agent/test/integration/delivery-worker.test.ts`:

```ts
import { openEdgeDatabase } from '../../src/persistence/database';
import { EdgeRepositories } from '../../src/persistence/repositories';
import { DeliveryWorker } from '../../src/application/delivery-worker';
import { EdgeError } from '../../src/domain/errors';

describe('DeliveryWorker', () => {
  it('keeps events offline and delivers once after recovery', async () => {
    const db = openEdgeDatabase(':memory:');
    db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('turnstile-1','Topdata','SIM','T1','sim','TURNSTILE','h');
    const repositories = new EdgeRepositories(db);
    repositories.enqueueEvent({ id: 'e1', idempotencyKey: 'k1', deviceId: 'turnstile-1', externalUserId: '83714', decision: 'DENY', reason: 'NO_PERMISSION', passageState: 'NOT_APPLICABLE', occurredAt: '2026-08-14T12:00:00.000Z' });
    const collector = { deliver: jest.fn().mockRejectedValueOnce(new EdgeError('COLLECTOR_UNAVAILABLE', 'offline')).mockResolvedValue({ receivedAt: '2026-08-14T12:05:00.000Z' }) };
    const worker = new DeliveryWorker(repositories, collector);
    await expect(worker.runOnce()).resolves.toEqual({ delivered: 0, failed: 1 });
    expect(repositories.pendingEvents()).toHaveLength(1);
    await expect(worker.runOnce()).resolves.toEqual({ delivered: 1, failed: 0 });
    expect(repositories.pendingEvents()).toHaveLength(0);
    expect(collector.deliver).toHaveBeenCalledTimes(2);
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm --filter edge-agent test:integration -- delivery-worker.test.ts`

Expected: FAIL because `DeliveryWorker` is missing.

- [ ] **Step 3: Implement one bounded delivery iteration**

Create `apps/edge-agent/src/application/delivery-worker.ts`:

```ts
import type { EventCollector } from '../domain/contracts';
import { EdgeError, isRetryable } from '../domain/errors';
import type { EdgeRepositories } from '../persistence/repositories';

export class DeliveryWorker {
  constructor(private readonly repositories: EdgeRepositories, private readonly collector: EventCollector) {}

  async runOnce(limit = 100): Promise<{ delivered: number; failed: number }> {
    let delivered = 0;
    let failed = 0;
    for (const event of this.repositories.pendingEvents(limit)) {
      this.repositories.markAttempt(event.id);
      try {
        const receipt = await this.collector.deliver(event);
        this.repositories.markDelivered(event.id, receipt.receivedAt);
        delivered += 1;
      } catch (error) {
        const code = error instanceof EdgeError ? error.code : 'INVALID_EVENT';
        this.repositories.markFailure(event.id, code, !isRetryable(error));
        failed += 1;
      }
    }
    return { delivered, failed };
  }
}
```

- [ ] **Step 4: Implement authenticated HTTP delivery**

Create `apps/edge-agent/src/transport/http-collector.ts`:

```ts
import { createHmac } from 'node:crypto';
import type { CollectorEvent, EventCollector } from '../domain/contracts';
import { EdgeError } from '../domain/errors';

export class HttpEventCollector implements EventCollector {
  constructor(private readonly url: URL, private readonly deviceId: string, private readonly sharedSecret: string) {}

  async deliver(event: CollectorEvent): Promise<{ receivedAt: string }> {
    const body = JSON.stringify(event);
    const signature = createHmac('sha256', this.sharedSecret).update(body).digest('hex');
    let response: Response;
    try {
      response = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-edge-device-id': this.deviceId, 'x-edge-signature': signature, 'idempotency-key': event.idempotencyKey }, body, signal: AbortSignal.timeout(2_000) });
    } catch (error) {
      throw new EdgeError('COLLECTOR_UNAVAILABLE', 'Collector unavailable', { cause: error });
    }
    if (!response.ok) throw new EdgeError('COLLECTOR_UNAVAILABLE', `Collector returned ${response.status}`);
    return await response.json() as { receivedAt: string };
  }
}
```

Create `apps/edge-agent/src/transport/collector-simulator.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

export async function startCollectorSimulator(port: number, secret: string) {
  const seen = new Set<string>();
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/metrics') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ uniqueEvents: seen.size }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/events') { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_048_576) request.destroy(new Error('payload too large'));
      else chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'));
      const actual = Buffer.from(String(request.headers['x-edge-signature'] ?? ''));
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { response.writeHead(401).end(); return; }
      const idempotencyKey = String(request.headers['idempotency-key'] ?? '');
      if (!idempotencyKey) { response.writeHead(400).end(); return; }
      seen.add(idempotencyKey);
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ receivedAt: new Date().toISOString() }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Collector simulator has no TCP address');
  return { port: address.port, uniqueEvents: () => seen.size, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

if (require.main === module) {
  const secret = process.env.EDGE_SHARED_SECRET;
  if (!secret) throw new Error('EDGE_SHARED_SECRET is required');
  void startCollectorSimulator(Number(process.env.EDGE_COLLECTOR_PORT ?? 4010), secret).then((server) => {
    process.stdout.write(`${JSON.stringify({ status: 'READY', url: `http://127.0.0.1:${server.port}`, pid: process.pid })}\n`);
  });
}
```

Add imports to `delivery-worker.test.ts`:

```ts
import { HttpEventCollector } from '../../src/transport/http-collector';
import { startCollectorSimulator } from '../../src/transport/collector-simulator';
```

Append the authenticated duplicate-delivery scenario:

```ts
it('authenticates delivery and deduplicates at the collector boundary', async () => {
  const server = await startCollectorSimulator(0, '0123456789abcdef');
  try {
    const collector = new HttpEventCollector(new URL(`http://127.0.0.1:${server.port}/events`), 'edge-1', '0123456789abcdef');
    const event = { id: 'e-http', idempotencyKey: 'k-http', deviceId: 'turnstile-1', externalUserId: '83714', decision: 'DENY', reason: 'NO_PERMISSION', passageState: 'NOT_APPLICABLE', occurredAt: '2026-08-14T12:00:00.000Z' } as const;
    await collector.deliver(event);
    await collector.deliver(event);
    expect(server.uniqueEvents()).toBe(1);
  } finally { await server.close(); }
});
```

Run: `pnpm --filter edge-agent test:integration -- delivery-worker.test.ts`

Expected: PASS, 1 test.

Append the permanent-error scenario:

```ts
it('moves permanent delivery failures out of the retry queue', async () => {
  const db = openEdgeDatabase(':memory:');
  db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('turnstile-1','Topdata','SIM','T1','sim','TURNSTILE','h');
  const repositories = new EdgeRepositories(db);
  repositories.enqueueEvent({ id: 'bad-1', idempotencyKey: 'bad-key-1', deviceId: 'turnstile-1', externalUserId: '83714', decision: 'DENY', reason: 'NO_PERMISSION', passageState: 'NOT_APPLICABLE', occurredAt: '2026-08-14T12:00:00.000Z' });
  const collector = { deliver: jest.fn().mockRejectedValue(new EdgeError('INVALID_EVENT', 'invalid payload')) };
  await expect(new DeliveryWorker(repositories, collector).runOnce()).resolves.toEqual({ delivered: 0, failed: 1 });
  expect(repositories.pendingEvents()).toHaveLength(0);
  expect(repositories.countDeadLetters()).toBe(1);
  db.close();
});
```

- [ ] **Step 5: Add 100-event restart coverage and commit**

Append to `delivery-worker.test.ts`:

```ts
it('delivers 100 persisted events exactly once after database reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-restart-'));
  const path = join(directory, 'edge.sqlite');
  let db = openEdgeDatabase(path);
  db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('turnstile-1','Topdata','SIM','T1','sim','TURNSTILE','h');
  let repositories = new EdgeRepositories(db);
  for (let index = 0; index < 100; index += 1) {
    repositories.enqueueEvent({ id: `event-${index}`, idempotencyKey: `key-${index}`, deviceId: 'turnstile-1', externalUserId: `user-${index}`, decision: 'DENY', reason: 'NO_PERMISSION', passageState: 'NOT_APPLICABLE', occurredAt: new Date(1_723_636_800_000 + index).toISOString() });
  }
  db.close();
  db = openEdgeDatabase(path);
  repositories = new EdgeRepositories(db);
  const received = new Set<string>();
  const collector = { deliver: jest.fn(async (event: { idempotencyKey: string }) => { received.add(event.idempotencyKey); return { receivedAt: '2026-08-14T12:05:00.000Z' }; }) };
  const worker = new DeliveryWorker(repositories, collector);
  await expect(worker.runOnce()).resolves.toEqual({ delivered: 100, failed: 0 });
  await expect(worker.runOnce()).resolves.toEqual({ delivered: 0, failed: 0 });
  expect(received.size).toBe(100);
  expect(collector.deliver).toHaveBeenCalledTimes(100);
  expect(repositories.pendingEvents()).toHaveLength(0);
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
```

Add imports at the top of the file:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

Run: `pnpm --filter edge-agent test:integration -- delivery-worker.test.ts`

Expected: PASS, including 100-event durability case.

Commit:

```bash
git add apps/edge-agent/src/application/delivery-worker.ts apps/edge-agent/src/transport apps/edge-agent/test/integration/delivery-worker.test.ts
git commit -m "feat(edge): reconcile durable offline events"
```

## Task 11: Health endpoint, diagnostics and graceful lifecycle

**Files:**
- Create: `apps/edge-agent/src/http/health-server.ts`
- Create: `apps/edge-agent/src/cli/diagnose.ts`
- Create: `apps/edge-agent/src/main.ts`
- Test: `apps/edge-agent/test/integration/health-server.test.ts`
- Test: `apps/edge-agent/test/unit/lifecycle.test.ts`

- [ ] **Step 1: Write the failing health endpoint test**

Create `apps/edge-agent/test/integration/health-server.test.ts`:

```ts
import { startHealthServer } from '../../src/http/health-server';

describe('health server', () => {
  it('binds only to loopback and reports version, bridge and backlog', async () => {
    const server = await startHealthServer(0, async () => ({
      status: 'DEGRADED', version: '0.0.0', bridge: 'OFFLINE', pendingEvents: 3, checkedAt: '2026-08-14T12:00:00.000Z'
    }));
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'DEGRADED', pendingEvents: 3 });
    await server.close();
  });
});
```

- [ ] **Step 2: Run the health test to verify failure**

Run: `pnpm --filter edge-agent test:integration -- health-server.test.ts`

Expected: FAIL because `startHealthServer` is missing.

- [ ] **Step 3: Implement a loopback-only health server**

Create `apps/edge-agent/src/http/health-server.ts`:

```ts
import { createServer } from 'node:http';

export interface RuntimeHealth {
  status: 'OK' | 'DEGRADED';
  version: string;
  bridge: 'ONLINE' | 'OFFLINE';
  pendingEvents: number;
  checkedAt: string;
}

export async function startHealthServer(port: number, health: () => Promise<RuntimeHealth>) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const body = JSON.stringify(await health());
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Health server did not expose a TCP address');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
```

Run: `pnpm --filter edge-agent test:integration -- health-server.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 4: Implement diagnostics and an explicitly closable runtime**

Create `apps/edge-agent/src/main.ts`:

```ts
import { parseEnv } from './config/env';
import { JsonLineBridgeClient } from './bridge/json-line-client';
import { FacialBridgeAdapter } from './adapters/facial-adapter';
import { TurnstileBridgeAdapter } from './adapters/turnstile-adapter';
import { AccessOrchestrator } from './application/access-orchestrator';
import { DeliveryWorker } from './application/delivery-worker';
import { startHealthServer } from './http/health-server';
import { createLogger } from './observability/logger';
import { openEdgeDatabase } from './persistence/database';
import { EdgeRepositories } from './persistence/repositories';
import { HttpEventCollector } from './transport/http-collector';
import { EDGE_AGENT_VERSION } from './version';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function createShutdown(runtime: { close(): Promise<void> }, exit: (code: number) => void = (code) => process.exit(code)) {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= runtime.close().then(() => { exit(0); });
    return closing;
  };
}

export async function bootstrap(env: NodeJS.ProcessEnv = process.env) {
  const config = parseEnv(env);
  const logger = createLogger();
  const db = openEdgeDatabase(config.dbPath);
  const repositories = new EdgeRepositories(db);
  const inventory = JSON.parse(readFileSync(config.inventoryPath, 'utf8')) as { devices: Array<{ kind: 'FACIAL' | 'TURNSTILE'; manufacturer: string; model: string; serialNumber: string; firmware: string }> };
  for (const device of inventory.devices) {
    const id = device.kind === 'FACIAL' ? config.facialDeviceId : config.turnstileDeviceId;
    repositories.saveDevice({ ...device, id, adapterType: device.kind, configurationFingerprint: createHash('sha256').update(JSON.stringify(device)).digest('hex') });
  }
  const bridge = new JsonLineBridgeClient(config.bridgeExecutable, config.bridgeArgs, 2_000, (error) => logger.warn({ code: error.code }, error.message));
  await bridge.start();
  const facial = new FacialBridgeAdapter(config.facialDeviceId, bridge, repositories);
  const turnstile = new TurnstileBridgeAdapter(config.turnstileDeviceId, bridge, repositories);
  const orchestrator = new AccessOrchestrator(repositories, turnstile);
  const collector = new HttpEventCollector(config.collectorUrl, config.edgeId, config.sharedSecret);
  const worker = new DeliveryWorker(repositories, collector);
  const unsubscribeRecognition = facial.subscribeToRecognitions((event) => void orchestrator.onRecognition(event, config.turnstileDeviceId));
  const unsubscribePassage = turnstile.subscribeToPassages((event) => orchestrator.onPassage(event));
  const timer = setInterval(() => void worker.runOnce().catch((error: unknown) => logger.warn({ error }, 'delivery iteration failed')), 1_000);
  const healthServer = await startHealthServer(config.healthPort, async () => {
    let bridgeStatus: 'ONLINE' | 'OFFLINE' = 'OFFLINE';
    try { bridgeStatus = (await facial.health()).status === 'ONLINE' ? 'ONLINE' : 'OFFLINE'; } catch { bridgeStatus = 'OFFLINE'; }
    return { status: bridgeStatus === 'ONLINE' ? 'OK' : 'DEGRADED', version: EDGE_AGENT_VERSION, bridge: bridgeStatus, pendingEvents: repositories.pendingEvents(1_000_000).length, checkedAt: new Date().toISOString() };
  });
  return {
    async close() {
      clearInterval(timer);
      unsubscribeRecognition();
      unsubscribePassage();
      await healthServer.close();
      await bridge.stop();
      db.close();
    }
  };
}

if (require.main === module) {
  if (process.env.ARENAHUB_CONFIRM_PHYSICAL_LAB !== 'I_UNDERSTAND_PHYSICAL_MOVEMENT') {
    throw new Error('Physical lab confirmation is required');
  }
  void bootstrap().then((runtime) => {
    const shutdown = createShutdown(runtime);
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
  });
}
```

Create `apps/edge-agent/src/cli/diagnose.ts`:

```ts
import { parseEnv, safeConfigView } from '../config/env';
import { JsonLineBridgeClient } from '../bridge/json-line-client';
import { openEdgeDatabase } from '../persistence/database';

async function diagnose(): Promise<void> {
  const config = parseEnv(process.env);
  const db = openEdgeDatabase(config.dbPath);
  const bridge = new JsonLineBridgeClient(config.bridgeExecutable, config.bridgeArgs);
  try {
    await bridge.start();
    const bridgeHealth = await bridge.request('health', {});
    process.stdout.write(`${JSON.stringify({ ok: true, config: safeConfigView(config), bridgeHealth }, null, 2)}\n`);
  } finally {
    await bridge.stop();
    db.close();
  }
}

void diagnose().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' })}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 5: Test graceful close, verify and commit**

Create `apps/edge-agent/test/unit/lifecycle.test.ts`:

```ts
import { createShutdown } from '../../src/main';

describe('createShutdown', () => {
  it('closes runtime and exits exactly once under repeated signals', async () => {
    const runtime = { close: jest.fn().mockResolvedValue(undefined) };
    const exit = jest.fn();
    const shutdown = createShutdown(runtime, exit);
    await Promise.all([shutdown(), shutdown()]);
    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
```

Run:

```bash
pnpm --filter edge-agent lint
pnpm --filter edge-agent typecheck
pnpm --filter edge-agent test -- lifecycle.test.ts
pnpm --filter edge-agent test:integration -- health-server.test.ts
pnpm --filter edge-agent build
```

Expected: all commands exit `0`; Jest prints no open-handle warning.

Commit:

```bash
git add apps/edge-agent/src/http apps/edge-agent/src/cli apps/edge-agent/src/main.ts apps/edge-agent/test
git commit -m "feat(edge): expose health and graceful lifecycle"
```

## Task 12: Automated PRD acceptance suite and latency evidence

**Files:**
- Create: `apps/edge-agent/test/support/simulator-harness.ts`
- Create: `apps/edge-agent/test/acceptance/mvp0.test.ts`
- Create: `apps/edge-agent/src/observability/latency.ts`
- Test: `apps/edge-agent/test/unit/latency.test.ts`

- [ ] **Step 1: Write the failing percentile test**

Create `apps/edge-agent/test/unit/latency.test.ts`:

```ts
import { summarizeLatency } from '../../src/observability/latency';

describe('summarizeLatency', () => {
  it('reports p50, p95 and maximum deterministically', () => {
    expect(summarizeLatency([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({ p50Ms: 50, p95Ms: 100, maxMs: 100, samples: 10 });
  });
});
```

Run: `pnpm --filter edge-agent test -- latency.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 2: Implement latency summaries**

Create `apps/edge-agent/src/observability/latency.ts`:

```ts
function percentile(sorted: number[], ratio: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

export function summarizeLatency(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return { p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), maxMs: sorted.at(-1) ?? 0, samples: sorted.length } as const;
}
```

Run: `pnpm --filter edge-agent test -- latency.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 3: Create a reusable simulator harness**

Create `apps/edge-agent/test/support/simulator-harness.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonLineBridgeClient } from '../../src/bridge/json-line-client';
import { FacialBridgeAdapter } from '../../src/adapters/facial-adapter';
import { TurnstileBridgeAdapter } from '../../src/adapters/turnstile-adapter';
import { AccessOrchestrator } from '../../src/application/access-orchestrator';
import { openEdgeDatabase } from '../../src/persistence/database';
import { EdgeRepositories } from '../../src/persistence/repositories';

export async function createSimulatorHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'arenahub-acceptance-'));
  const dbPath = join(directory, 'edge.sqlite');
  const db = openEdgeDatabase(dbPath);
  db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('sim-facial-1','Topdata','SIM','F1','sim-1','FACIAL','h1');
  db.prepare('INSERT INTO lab_devices VALUES (?, ?, ?, ?, ?, ?, ?)').run('sim-turnstile-1','Topdata','SIM','T1','sim-1','TURNSTILE','h2');
  const repositories = new EdgeRepositories(db);
  const bridge = new JsonLineBridgeClient(process.execPath, [join(process.cwd(), 'dist/src/bridge/simulator.js')]);
  await bridge.start();
  const facial = new FacialBridgeAdapter('sim-facial-1', bridge, repositories);
  const turnstile = new TurnstileBridgeAdapter('sim-turnstile-1', bridge, repositories);
  const orchestrator = new AccessOrchestrator(repositories, turnstile);
  const offRecognition = facial.subscribeToRecognitions((event) => void orchestrator.onRecognition(event, 'sim-turnstile-1'));
  const offPassage = turnstile.subscribeToPassages((event) => orchestrator.onPassage(event));
  return {
    dbPath, bridge, facial, repositories,
    async waitUntil(predicate: () => boolean, timeoutMs = 2_000) {
      const started = Date.now();
      while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error('Simulator condition timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    async close() {
      offRecognition(); offPassage(); await bridge.stop(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  };
}
```

- [ ] **Step 4: Implement the executable acceptance scenarios**

Create `apps/edge-agent/test/acceptance/mvp0.test.ts`:

```ts
import { createSimulatorHarness } from '../support/simulator-harness';

describe('MVP 0 automated acceptance', () => {
  it('M0-AC-001/002 creates, recognizes and removes three users', async () => {
    const lab = await createSimulatorHarness();
    try {
      for (const [index, externalUserId] of ['83714','83715','83716'].entries()) {
        await lab.facial.upsertUser({ correlationId: `up-${index}`, deviceId: 'sim-facial-1', internalSubjectId: `subject-${index}`, externalUserId, displayName: `Lab ${index}` });
        lab.repositories.savePermission({ internalSubjectId: `subject-${index}`, outcome: 'ALLOW', validUntil: '2099-01-01T00:00:00.000Z', cacheVersion: 1 });
        await lab.bridge.request('simulator.recognize', { externalUserId });
      }
      await lab.waitUntil(() => lab.repositories.pendingEvents().length === 3);
      await lab.waitUntil(() => lab.repositories.pendingEvents().every((event) => event.passageState === 'CONFIRMED'));
      for (const externalUserId of ['83714','83715','83716']) {
        await lab.facial.deleteUser({ correlationId: `del-${externalUserId}`, deviceId: 'sim-facial-1', externalUserId });
        expect(lab.repositories.findDeviceUser('sim-facial-1', externalUserId)?.syncStatus).toBe('REMOVED');
      }
    } finally { await lab.close(); }
  });

  it('M0-AC-003/004 grants ten allows and denies an enrolled user without permission', async () => {
    const lab = await createSimulatorHarness();
    try {
      await lab.facial.upsertUser({ correlationId: 'up', deviceId: 'sim-facial-1', internalSubjectId: 'allowed', externalUserId: '90001', displayName: 'Allowed' });
      await lab.facial.upsertUser({ correlationId: 'up-denied', deviceId: 'sim-facial-1', internalSubjectId: 'denied', externalUserId: '90002', displayName: 'Denied' });
      lab.repositories.savePermission({ internalSubjectId: 'allowed', outcome: 'ALLOW', validUntil: '2099-01-01T00:00:00.000Z', cacheVersion: 1 });
      for (let index = 0; index < 10; index += 1) await lab.bridge.request('simulator.recognize', { externalUserId: '90001' });
      await lab.bridge.request('simulator.recognize', { externalUserId: '90002' });
      await lab.waitUntil(() => lab.repositories.pendingEvents().length === 11);
      const events = lab.repositories.pendingEvents();
      expect(events.filter((event) => event.decision === 'ALLOW')).toHaveLength(10);
      expect(events.filter((event) => event.decision === 'DENY')).toHaveLength(1);
    } finally { await lab.close(); }
  });
});
```

The offline 100-event and restart assertions remain in `delivery-worker.test.ts`; this acceptance file intentionally reuses that evidence instead of duplicating persistence logic.

- [ ] **Step 5: Run the full automated gate and commit**

Run:

```bash
pnpm --filter edge-agent build
pnpm --filter edge-agent test
pnpm --filter edge-agent test:coverage
pnpm --filter edge-agent test:integration
pnpm --filter edge-agent test:simulator
```

Expected: all suites PASS; coverage stays at or above 80%; no open child process or SQLite handle remains.

Commit:

```bash
git add apps/edge-agent/src/observability/latency.ts apps/edge-agent/test
git commit -m "test(edge): automate MVP zero simulator acceptance"
```

## Task 13: Hardware gate, lab evidence and decision generator

**Files:**
- Create: `apps/edge-agent/config/lab-inventory.schema.json`
- Create: `apps/edge-agent/config/lab-inventory.simulator.json`
- Create: `apps/edge-agent/config/lab-env.simulator.ps1`
- Create: `apps/edge-agent/scripts/validate-lab-gate.mjs`
- Create: `apps/edge-agent/scripts/generate-lab-report.mjs`
- Modify: `apps/edge-agent/package.json`
- Create: `docs/lab/topdata/README.md`
- Create: `docs/lab/topdata/runbook.md`
- Create: `docs/lab/topdata/decision-policy.md`
- Create: `docs/lab/topdata/simulator-network.txt`
- Create: `docs/adr/0001-edge-runtime-and-bridge.md`

- [ ] **Step 1: Create the machine-readable inventory contract**

Create `apps/edge-agent/config/lab-inventory.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["workstation", "network", "devices", "sdk", "safety", "consent"],
  "properties": {
    "workstation": { "type": "object", "required": ["os", "architecture"], "properties": { "os": { "const": "Windows" }, "architecture": { "enum": ["x64", "arm64"] } } },
    "network": { "type": "object", "required": ["isolated", "diagramPath"], "properties": { "isolated": { "const": true }, "diagramPath": { "type": "string", "minLength": 1 } } },
    "devices": { "type": "array", "minItems": 2, "items": { "type": "object", "required": ["kind", "manufacturer", "model", "serialNumber", "firmware"], "properties": { "kind": { "enum": ["FACIAL", "TURNSTILE"] }, "manufacturer": { "const": "Topdata" }, "model": { "type": "string", "minLength": 1 }, "serialNumber": { "type": "string", "minLength": 1 }, "firmware": { "type": "string", "minLength": 1 } } } },
    "sdk": { "type": "object", "required": ["name", "version", "architecture", "sha256", "examplesPath", "licenseConfirmed"], "properties": { "name": { "type": "string" }, "version": { "type": "string" }, "architecture": { "enum": ["x86", "x64", "any"] }, "sha256": { "type": "string", "pattern": "^[a-fA-F0-9]{64}$" }, "examplesPath": { "type": "string", "minLength": 1 }, "licenseConfirmed": { "const": true } } },
    "safety": { "type": "object", "required": ["emergencyStopProcedure", "responsiblePerson"], "properties": { "emergencyStopProcedure": { "type": "string", "minLength": 20 }, "responsiblePerson": { "type": "string", "minLength": 3 } } },
    "consent": { "type": "object", "required": ["documentVersion", "participantsApproved"], "properties": { "documentVersion": { "type": "string", "minLength": 1 }, "participantsApproved": { "const": true } } }
  }
}
```

Create `apps/edge-agent/config/lab-inventory.simulator.json`:

```json
{
  "workstation": { "os": "Windows", "architecture": "x64" },
  "network": { "isolated": true, "diagramPath": "docs/lab/topdata/simulator-network.txt" },
  "devices": [
    { "kind": "FACIAL", "manufacturer": "Topdata", "model": "SIMULATOR", "serialNumber": "SIM-FACIAL-001", "firmware": "sim-1" },
    { "kind": "TURNSTILE", "manufacturer": "Topdata", "model": "SIMULATOR", "serialNumber": "SIM-TURNSTILE-001", "firmware": "sim-1" }
  ],
  "sdk": {
    "name": "ArenaHub Simulator",
    "version": "1.0.0",
    "architecture": "any",
    "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
    "examplesPath": "apps/edge-agent/src/bridge/simulator.ts",
    "licenseConfirmed": true
  },
  "safety": {
    "emergencyStopProcedure": "No physical movement exists in simulator mode.",
    "responsiblePerson": "ArenaHub CI"
  },
  "consent": { "documentVersion": "SIMULATOR-NOT-APPLICABLE", "participantsApproved": true }
}
```

This file validates structure but is never accepted by the real gate because its filename is not `lab-inventory.local.json`.

Create `apps/edge-agent/config/lab-env.simulator.ps1`:

```powershell
$env:EDGE_ID='edge-simulator-01'
$env:EDGE_UNIT_ID='unit-simulator-01'
$env:EDGE_FACIAL_DEVICE_ID='sim-facial-1'
$env:EDGE_TURNSTILE_DEVICE_ID='sim-turnstile-1'
$env:EDGE_INVENTORY_PATH='config/lab-inventory.simulator.json'
$env:EDGE_DB_PATH='.arena/simulator.sqlite'
$env:EDGE_BRIDGE_EXECUTABLE=(Get-Command node).Source
$env:EDGE_BRIDGE_ARGS_JSON='["dist/src/bridge/simulator.js"]'
$env:EDGE_COLLECTOR_URL='http://127.0.0.1:4010/events'
$env:EDGE_SHARED_SECRET='simulator-secret-not-for-production'
$env:EDGE_HEALTH_PORT='4011'
```

For the physical lab, copy this file to ignored `config/lab-env.local.ps1`, replace every simulator value with inventoried values and a local secret, and never commit it.

- [ ] **Step 2: Implement a hard-failing gate validator**

Create `apps/edge-agent/scripts/validate-lab-gate.mjs`:

```js
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve('config/lab-inventory.local.json');
if (!existsSync(path)) {
  console.error('HW-GATE-01 BLOCKED: config/lab-inventory.local.json is missing');
  process.exit(2);
}
const inventory = JSON.parse(readFileSync(path, 'utf8'));
const errors = [];
if (inventory.workstation?.os !== 'Windows') errors.push('workstation.os must be Windows');
if (inventory.network?.isolated !== true) errors.push('network.isolated must be true');
for (const kind of ['FACIAL', 'TURNSTILE']) if (!inventory.devices?.some((device) => device.kind === kind)) errors.push(`missing ${kind} device`);
for (const device of inventory.devices ?? []) {
  for (const field of ['manufacturer', 'model', 'serialNumber', 'firmware']) {
    if (typeof device[field] !== 'string' || device[field].trim() === '') errors.push(`${device.kind ?? 'UNKNOWN'}.${field} is missing`);
  }
}
if (!['x86', 'x64', 'any'].includes(inventory.sdk?.architecture)) errors.push('SDK architecture is invalid');
for (const field of ['name', 'version', 'examplesPath']) if (typeof inventory.sdk?.[field] !== 'string' || inventory.sdk[field].trim() === '') errors.push(`sdk.${field} is missing`);
if (inventory.sdk?.licenseConfirmed !== true) errors.push('SDK license must be confirmed');
if (!/^[a-fA-F0-9]{64}$/.test(inventory.sdk?.sha256 ?? '')) errors.push('SDK sha256 is invalid');
if (inventory.consent?.participantsApproved !== true) errors.push('participant consent missing');
if ((inventory.safety?.emergencyStopProcedure ?? '').length < 20) errors.push('emergency stop procedure is incomplete');
if (errors.length > 0) {
  console.error(JSON.stringify({ gate: 'HW-GATE-01', status: 'BLOCKED', errors }, null, 2));
  process.exit(2);
}
console.log(JSON.stringify({ gate: 'HW-GATE-01', status: 'READY', devices: inventory.devices.map(({ kind, model, firmware }) => ({ kind, model, firmware })), sdk: { name: inventory.sdk.name, version: inventory.sdk.version, architecture: inventory.sdk.architecture, sha256: inventory.sdk.sha256 } }, null, 2));
```

Add scripts to `apps/edge-agent/package.json`:

```json
"lab:gate": "node scripts/validate-lab-gate.mjs",
"lab:report": "node scripts/generate-lab-report.mjs"
```

Run: `pnpm --filter edge-agent lab:gate`

Expected before real inventory: exit `2` with `HW-GATE-01 BLOCKED`; this is the correct result, not a test failure.

- [ ] **Step 3: Implement deterministic report recommendation**

Create `apps/edge-agent/scripts/generate-lab-report.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const evidence = JSON.parse(readFileSync(resolve('evidence/lab-results.json'), 'utf8'));
if (!Number.isInteger(evidence.latency?.samples) || evidence.latency.samples < 10) {
  throw new Error('At least 10 physical latency samples are required');
}
if (!Array.isArray(evidence.deviceResults) || evidence.deviceResults.length < 2) {
  throw new Error('Facial and turnstile physical results are required');
}
if (!Array.isArray(evidence.constraints) || typeof evidence.errorRate !== 'number') {
  throw new Error('Constraints and numeric errorRate are required');
}
const functional = evidence.userLifecyclePassed && evidence.allowDenyPassed && evidence.passagePassed && evidence.offlineRecoveryPassed;
const recommendation = !functional || evidence.safetyIncident
  ? 'NO_GO'
  : evidence.latency.p95Ms >= 300 || evidence.errorRate > 0 || evidence.constraints.length > 0
    ? 'GO_WITH_CONSTRAINTS'
    : 'GO';
const report = { generatedAt: new Date().toISOString(), recommendation, ...evidence };
writeFileSync(resolve('evidence/lab-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ recommendation, report: 'evidence/lab-report.json' }));
```

The lab runner must write `evidence/lab-results.json` once with this exact shape:

```json
{
  "userLifecyclePassed": true,
  "allowDenyPassed": true,
  "passagePassed": true,
  "offlineRecoveryPassed": true,
  "safetyIncident": false,
  "latency": { "p50Ms": 0, "p95Ms": 0, "maxMs": 0, "samples": 0 },
  "errorRate": 0,
  "constraints": [],
  "deviceResults": []
}
```

Zeros are permitted only in a hand-authored pre-run file; the generator rejects `samples < 10` and therefore cannot issue a recommendation from that file.

- [ ] **Step 4: Write runbook, policy and ADR with executable commands**

Create `docs/lab/topdata/README.md`:

```markdown
# Laboratório Topdata do ArenaHub

O laboratório comprova o MVP 0 com hardware inventariado. Simuladores validam software, mas não liberam o HW-GATE-01.

Não versionar SDK/DLL, credenciais, inventário local, evidências biométricas, bancos SQLite ou dados dos participantes. O operador confirma licença do SDK, consentimento, isolamento da rede e parada de emergência antes de energizar a catraca.

Fluxo obrigatório: validar simuladores → preencher inventário local → executar `lab:gate` → revisar runbook → executar sessão física assistida → excluir usuários do laboratório → gerar relatório → colher assinaturas técnica e operacional.
```

Create `docs/lab/topdata/simulator-network.txt`:

```text
[sim-facial-1] --JSON Lines--> [Edge Agent] --JSON Lines--> [sim-turnstile-1]
                                      |
                                      +--SQLite--> [.arena/edge.sqlite]
                                      |
                                      +--HTTP/HMAC--> [collector simulator]
```

Create `docs/lab/topdata/runbook.md`:

````markdown
# Runbook do laboratório Topdata

## Segurança antes da execução

1. Isole a alimentação antes de alterar cabos.
2. Confirme que a rede do laboratório não possui rota para produção.
3. Teste a parada de emergência antes de enviar qualquer comando.
4. Mantenha o operador responsável junto ao equipamento durante toda a sessão.
5. Confirme consentimento dos participantes e a rotina de exclusão biométrica.

## Preparação e diagnóstico

```powershell
node --version
pnpm --version
. .\apps\edge-agent\config\lab-env.local.ps1
pnpm install --frozen-lockfile
pnpm --filter edge-agent build
pnpm --filter edge-agent test:simulator
pnpm --filter edge-agent lab:gate
pnpm --filter edge-agent lab:diagnose
```

Node deve ser `v24.15.x`, pnpm `10.33.x` e `lab:gate` deve retornar `READY`; qualquer outro estado encerra a sessão.

## Execução física

Em um segundo PowerShell, carregue o mesmo arquivo de ambiente e inicie o coletor explicitamente:

```powershell
. .\apps\edge-agent\config\lab-env.local.ps1
pnpm --filter edge-agent lab:collector
```

O coletor permanece em primeiro plano e para com `Ctrl+C`. Para o cenário offline, pare o coletor, produza 100 eventos, reinicie o mesmo comando e confirme `uniqueEvents: 100` em `http://127.0.0.1:4010/metrics`.

```powershell
$env:ARENAHUB_CONFIRM_PHYSICAL_LAB='I_UNDERSTAND_PHYSICAL_MOVEMENT'
pnpm --filter edge-agent lab:run
pnpm --filter edge-agent lab:report
```

Registre modelo, firmware, versões, horários e códigos de erro sem copiar segredos. Ao encerrar, exclua os três usuários de laboratório em todos os leitores, confirme a ausência e execute `Remove-Item Env:ARENAHUB_CONFIRM_PHYSICAL_LAB`.

## Rollback

Interrompa o Edge Agent, acione a parada de emergência se houver movimento inesperado, isole a alimentação, preserve logs permitidos sem PII e restaure o executável anterior do bridge. Não apague o SQLite antes de copiar as evidências operacionais permitidas.
````

Create `docs/lab/topdata/decision-policy.md`:

```markdown
# Política de decisão do MVP 0

- `NO_GO`: falha em lifecycle, ALLOW/DENY, passagem ou recuperação offline; ou qualquer incidente de segurança.
- `GO_WITH_CONSTRAINTS`: funções críticas passam, mas p95 é maior ou igual a 300 ms, taxa de erro é maior que zero ou existe limitação de modelo, firmware ou topologia.
- `GO`: funções críticas passam, não há incidente, p95 é menor que 300 ms, taxa de erro é zero e não há restrição aberta.

O relatório exige no mínimo dez amostras físicas de latência. `GO` e `GO_WITH_CONSTRAINTS` só valem com assinatura técnica e operacional. Restrições são propagadas ao MVP 1. `NO_GO` bloqueia o planejamento físico do MVP 1.
```

Create `docs/adr/0001-edge-runtime-and-bridge.md`:

```markdown
# ADR 0001 — Runtime do Edge e isolamento do SDK

## Status

Aceito para a fundação simulada; binding físico condicionado ao HW-GATE-01.

## Decisão

Usar Node.js 24 LTS e `node:sqlite` no Edge Agent. Integrar SDKs do fabricante por executável separado e protocolo JSON Lines em stdin/stdout. O Node inicia o bridge com `shell: false`, valida mensagens e mantém regras de acesso fora do código do fabricante.

## Consequências

O CI usa o mesmo protocolo contra simulador. Arquitetura x86/x64, redistribuíveis e threading do SDK ficam confinados ao bridge. Falha do bridge degrada dispositivos, mas não corrompe a fila SQLite.

## Alternativa rejeitada

Carregar DLL Topdata diretamente no Node foi rejeitado por acoplar ABI e arquitetura desconhecidas ao processo responsável pela persistência offline. Reconsideração exige novo ADR apoiado em exemplos oficiais e evidência de compatibilidade.
```

- [ ] **Step 5: Verify documents, gate behavior and commit**

Run:

```bash
pnpm --filter edge-agent lint
pnpm --filter edge-agent typecheck
pnpm --filter edge-agent test
pnpm --filter edge-agent test:integration
pnpm --filter edge-agent test:simulator
pnpm --filter edge-agent lab:gate
```

Expected: code commands PASS; `lab:gate` exits `2` until the real local inventory exists. Confirm `git status --short` does not list local inventory, SDK, SQLite or evidence.

Commit:

```bash
git add apps/edge-agent/config/lab-inventory.schema.json apps/edge-agent/config/lab-inventory.simulator.json apps/edge-agent/config/lab-env.simulator.ps1 apps/edge-agent/scripts apps/edge-agent/package.json docs/lab docs/adr
git commit -m "docs(edge): define Topdata hardware gate and lab evidence"
```

## Task 14: Stop gate and hardware-specific follow-on plan

**Files:**
- Read: `apps/edge-agent/config/lab-inventory.local.json` (ignored, never commit)
- Read: `vendor/topdata/` (ignored, never commit)
- Create after gate: `docs/superpowers/plans/YYYY-MM-DD-mvp-00-topdata-physical-bridge.md`

- [ ] **Step 1: Execute the gate without bypasses**

Run: `pnpm --filter edge-agent lab:gate`

Expected: `READY` with exact model, firmware, SDK version, architecture and SHA-256. If exit code is `2`, stop. Do not stub, mock or infer the physical SDK.

- [ ] **Step 2: Inspect only the licensed SDK examples and record callable surfaces**

Record in a local evidence note:

```text
Facial: connect, health, user upsert, user delete, recognition callback
EasyInner: connect, health, grant passage, passage/turn callback
Runtime: supported OS, CPU architecture, required redistributables, threading model
Errors: documented codes, timeouts, reconnect behavior
```

Every item must cite the SDK example filename and symbol. Missing callable surfaces become constraints, not guessed implementations.

- [ ] **Step 3: Invoke writing-plans for the physical bridge**

The follow-on plan must choose C#, Java or another supported runtime from the evidence, define exact bridge project files, reference real SDK symbols, echo the request `correlationId` on every passage event, add contract tests against the Node simulator protocol and include hardware smoke commands. It must not modify the domain contracts unless the mismatch is first recorded as an ADR.

- [ ] **Step 4: Implement and execute the physical plan separately**

Required final evidence:

```text
M0-AC-001/002: 3 real user lifecycle runs
M0-AC-003: 10 real ALLOW runs with no duplicate grant
M0-AC-004: real DENY with no physical release
M0-AC-005: passage confirmed or timed out and correlated
M0-AC-006/007: 100 offline events plus process restart and recovery
M0-AC-008: p50, p95, max and error rate per device/firmware
M0-AC-009: participant biometric deletion evidence
M0-AC-010: signed technical and operational decision
```

- [ ] **Step 5: Update the PRD only from evidence**

Mark each MVP 0 checklist item with the commit, test command and evidence file. Propagate `GO_WITH_CONSTRAINTS` restrictions to `MVP-01-smart-access.md`; if `NO_GO`, set the MVP status to `BLOQUEADO` and do not plan MVP 1 hardware execution.

## 3. Requirement coverage matrix

| PRD requirement | Planned evidence |
|---|---|
| M0-FR-001 / M0-FR-010 | Tasks 2, 11 and 13 |
| M0-FR-002 / M0-FR-003 / M0-FR-004 | Tasks 5, 6 and 12; physical proof in Task 14 |
| M0-FR-005 | Tasks 7 and 9 |
| M0-FR-006 / M0-BR-002 | Tasks 8, 9 and 12 |
| M0-FR-007 | Tasks 8, 9 and 14 |
| M0-FR-008 / M0-FR-009 | Task 10 and Task 12 |
| M0-BR-001 | external IDs in Tasks 6 and 12; no CPF field exists |
| M0-BR-003 / M0-BR-004 | Tasks 7, 9 and 10 |
| M0-BR-005 / M0-BR-006 | Tasks 13 and 14 |
| M0-NFR-001 / M0-NFR-002 | Tasks 12 to 14 |
| M0-NFR-003 | Tasks 3, 8 and 10 |
| M0-NFR-004 / M0-NFR-005 | Tasks 2 and 11 |
| M0-NFR-006 | Tasks 5 and 12 |
| M0-NFR-007 | Task 11 |
| M0-AC-001 / M0-AC-002 / M0-AC-003 / M0-AC-004 / M0-AC-005 / M0-AC-006 / M0-AC-007 | automated in Tasks 8, 9, 10 and 12; repeated on hardware in Task 14 |
| M0-AC-008 / M0-AC-009 / M0-AC-010 | blocked until HW-GATE-01, then Task 14 |

## 4. Full pre-hardware verification

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter edge-agent test:coverage
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm --filter edge-agent lab:gate
```

Expected: all automated commands pass. `lab:gate` is the only allowed non-zero command before hardware artifacts exist and must exit `2` with `HW-GATE-01 BLOCKED`.
