# F81 — Tela de equipe (professor, staff, admin fora da contagem de aluno) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/students` mostra só `profile = STUDENT` (347, não 419); tela nova `/team` lista os 72 não-aluno (TRAINER/STAFF/ADMIN), com vínculo (CLT/PJ/AUTONOMOUS) e agenda de aulas do professor.

**Architecture:** `Student` já modela professor/staff/admin (`profile != STUDENT`) — não cria entidade de pessoa nova. Corrige o filtro que faltava em `StudentRepository.contar`/`.buscar` (causa raiz da issue #413), cria um módulo `team/` paralelo a `students/` que lê a mesma tabela com o filtro invertido, adiciona dois campos de vínculo trabalhista via migration, e expõe leitura da agenda reusando a relação `Class.classesAsTrainer` que já existe (ADR-061 decisão 5). Só leitura + edição de vínculo nesta fatia — criar/editar profile de time continua fora do sistema (script/seed), decisão confirmada com o PI.

**Tech Stack:** NestJS (API), Prisma (Postgres), Next.js App Router + Server Components (admin-web), Zod no boundary, Jest (unit + integration), Playwright (E2E).

**Spec:** issue [#415](https://github.com/RodReis/arenahub/issues/415) (SPEC-081/F81) — o corpo da issue é a especificação desta fatia; não há doc de spec separado (escopo contido, decisão de brainstorming registrada na conversa da issue).

## Global Constraints

- `tenant_id` em toda query nova; `TenantContext` obrigatório em todo método de repository (regra de arquitetura #2).
- Nenhuma leitura de `students` fora do módulo `students`/`team` — quem precisar de dado de professor usa método público exportado (regra de arquitetura #9).
- Todo efeito de escrita (`PATCH /team/:id/employment`) grava `StudentTimelineEvent` + `AuditLog` + `OutboxEvent` na mesma transação (regras de arquitetura #4 e #5), copiando o padrão de `StudentRepository.atualizar`.
- Trava otimista por `version` em toda escrita (mesmo padrão de `Student.version`).
- Migration idempotente e nullable — sem backfill forçado; os 419 `Student` existentes (incluindo os 72 não-aluno) ganham `employmentType = null`.
- Zod no boundary de todo endpoint novo; `unknown` antes de validar.
- Sem `any` implícito; sem float para dinheiro (não se aplica aqui, mas nenhuma exceção é criada).
- `listarProfessores` (`GET /students/trainers`) não muda de contrato — a F77 depende dele.

## Review Focus

- **Migration rodando sobre os 419 `Student` reais (347 STUDENT + 72 não-aluno):** `employmentType`/`employmentStartedAt` devem ficar `null` nos 419, sem erro de constraint — testar com fixture que inclui as três profiles.
- **`/students` some com professor/staff/admin mesmo em filtro combinado** (`?status=ACTIVE&modalityId=X`): o filtro `profile: 'STUDENT'` precisa compor com os filtros existentes, não substituí-los — um professor com status ACTIVE não pode voltar a aparecer se o filtro de status for aplicado sem o de profile.
- **`GET /team` paginação e `X-Total-Count` seguem o mesmo padrão de `/students`** (contagem com o mesmo filtro menos cursor/limite) — divergir aqui quebra a paginação silenciosamente (a tela mostraria "72 de 20").
- **Agenda do professor com `trainerId` de outro tenant:** `GET /team/:id/agenda` tem que aplicar `TenantContext` tanto no `Student` quanto no `Class` — sem isso, um id de professor de outro tenant vazaria a agenda dele (RLS não cobre leitura cross-tenant por engano de query sem `tenantId` explícito, ver [[rls-sem-politica-nega-tudo]]/[[rls-include-volta-nulo]] nas memórias).
- **`employmentStartedAt` sem `employmentType` (ou vice-versa):** a issue não decide se um exige o outro — o schema Zod do `PATCH /employment` precisa aceitar os dois independentes (nenhum invariante de "os dois juntos ou nenhum" foi pedido), e o teste precisa provar que gravar um sem o outro não quebra.

---

### Task 1: Migration — campos de vínculo trabalhista em `Student`

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (enum novo + 2 campos em `model Student`)
- Create: `packages/database/prisma/migrations/20260927120000_vinculo_trabalhista_do_time/migration.sql`
- Test: `packages/database/test/integration/vinculo-trabalhista.int-spec.ts`

**Interfaces:**
- Produces: `Student.employmentType: EmploymentType | null`, `Student.employmentStartedAt: Date | null`; enum `EmploymentType = CLT | PJ | AUTONOMOUS`.

- [ ] **Step 1: Escrever teste de integração que falha (schema ainda não tem o campo)**

```typescript
// packages/database/test/integration/vinculo-trabalhista.int-spec.ts
import { PrismaClient } from '@arenahub/database';
import { randomUUID } from 'node:crypto';

describe('vinculo trabalhista do time (F81)', () => {
  const db = new PrismaClient();
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    tenantId = randomUUID();
    await db.tenant.create({ data: { id: tenantId, name: 'Tenant F81', slug: `f81-${tenantId.slice(0, 8)}` } });
    const unidade = await db.gymUnit.create({
      data: { tenantId, name: 'Unidade F81', timezone: 'America/Sao_Paulo' },
    });
    gymUnitId = unidade.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
    await db.$disconnect();
  });

  it('grava employmentType e employmentStartedAt para profile != STUDENT', async () => {
    const professor = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: 'F81-0001',
        fullName: 'Professor Teste F81',
        birthDate: new Date('1990-01-01'),
        profile: 'TRAINER',
        employmentType: 'CLT',
        employmentStartedAt: new Date('2024-01-01'),
      },
    });

    expect(professor.employmentType).toBe('CLT');
    expect(professor.employmentStartedAt?.toISOString()).toContain('2024-01-01');
  });

  it('aluno comum fica com employmentType null por padrao', async () => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: 'F81-0002',
        fullName: 'Aluno Teste F81',
        birthDate: new Date('1995-01-01'),
      },
    });

    expect(aluno.employmentType).toBeNull();
    expect(aluno.employmentStartedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `pnpm --filter @arenahub/database test:integration -- vinculo-trabalhista`
Expected: FAIL — `Unknown argument employmentType` (campo não existe no client Prisma ainda).

- [ ] **Step 3: Adicionar enum e campos no schema**

Em `packages/database/prisma/schema.prisma`, logo acima de `enum StudentProfile` (linha ~158):

```prisma
/// Vinculo trabalhista de quem NAO e aluno (TRAINER/STAFF/ADMIN) -- F81.
/// Nulo para `profile = STUDENT`: campo nao tem sentido pra aluno comum, e
/// os 347 alunos existentes nao ganham valor por essa fatia.
enum EmploymentType {
  /// Carteira assinada.
  CLT
  /// Pessoa juridica.
  PJ
  /// Autonomo, sem CLT nem PJ.
  AUTONOMOUS

  @@map("employment_type")
}
```

Dentro de `model Student`, logo após o campo `profile` (linha 1592):

```prisma
  /// Vinculo trabalhista -- F81, issue #415. Nulo para `profile = STUDENT`
  /// (aluno comum nao tem vinculo) e para os TRAINER/STAFF/ADMIN existentes
  /// ate a tela de equipe preencher. NAO EXISTE VALIDACAO DE "so preenche se
  /// profile != STUDENT" no banco -- e regra de aplicacao (Zod do endpoint
  /// de edicao), mesmo criterio de `modalityIds` na F60: CHECK de coluna
  /// cruzando duas colunas exigiria trigger, e a aplicacao ja e a fronteira
  /// que decide isso em todo outro campo condicional do Student.
  employmentType      EmploymentType? @map("employment_type")
  /// Data de entrada no vinculo (nao e `createdAt` do cadastro -- um
  /// professor pode ser cadastrado no sistema muito depois de comecar a dar
  /// aula na Arena Positiva).
  employmentStartedAt DateTime?       @map("employment_started_at") @db.Date
```

- [ ] **Step 4: Gerar a migration**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev --name vinculo_trabalhista_do_time --create-only`

Conferir o SQL gerado em `packages/database/prisma/migrations/20260927*_vinculo_trabalhista_do_time/migration.sql` — deve ser só `ALTER TABLE students ADD COLUMN employment_type employment_type, ADD COLUMN employment_started_at date` + `CREATE TYPE employment_type AS ENUM (...)`, sem `NOT NULL`, sem `DEFAULT`. Ajustar o nome da pasta pra bater com `20260927120000_vinculo_trabalhista_do_time` se o timestamp gerado vier diferente (renomear a pasta e o campo `migration_name` dentro do arquivo, se houver).

- [ ] **Step 5: Aplicar a migration no banco de dev e rodar o teste**

Run: `pnpm --filter @arenahub/database exec prisma migrate dev`
Run: `pnpm --filter @arenahub/database test:integration -- vinculo-trabalhista`
Expected: PASS nos dois casos.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations packages/database/test/integration/vinculo-trabalhista.int-spec.ts
git commit -m "feat(database): adiciona employmentType e employmentStartedAt em Student (F81)"
```

---

### Task 2: `StudentRepository` — corrige a causa raiz (filtro `profile`)

**Files:**
- Modify: `apps/api/src/modules/students/student.repository.ts:666-688` (método `contar`), `:716-...` (método `buscar`)
- Test: `apps/api/test/integration/students-profile-filter.int-spec.ts`

**Interfaces:**
- Consumes: nenhuma nova — usa as assinaturas já existentes de `contar(contexto, filtro)` e `buscar(contexto, filtro, agora)`.
- Produces: mesmas assinaturas; comportamento muda (grade e contagem só incluem `profile = STUDENT`).

- [ ] **Step 1: Escrever teste de integração que falha**

```typescript
// apps/api/test/integration/students-profile-filter.int-spec.ts
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { StudentRepository } from '../../src/modules/students/student.repository.js';
import { comContexto } from '../../src/common/tenant/tenant-context.js';

describe('StudentRepository filtra profile != STUDENT (F81, issue #413)', () => {
  let repo: StudentRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StudentRepository, PrismaService],
    }).compile();

    repo = moduleRef.get(StudentRepository);
    db = moduleRef.get(PrismaService);

    tenantId = randomUUID();
    await db.tenant.create({ data: { id: tenantId, name: 'Tenant F81b', slug: `f81b-${tenantId.slice(0, 8)}` } });
    const unidade = await db.gymUnit.create({
      data: { tenantId, name: 'Unidade F81b', timezone: 'America/Sao_Paulo' },
    });
    gymUnitId = unidade.id;

    await db.student.createMany({
      data: [
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F81B-0001',
          fullName: 'Aluno Comum',
          birthDate: new Date('1995-01-01'),
          profile: 'STUDENT',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F81B-0002',
          fullName: 'Professor Titular',
          birthDate: new Date('1985-01-01'),
          profile: 'TRAINER',
        },
        {
          tenantId,
          gymUnitId,
          membershipNumber: 'F81B-0003',
          fullName: 'Admin Sistema',
          birthDate: new Date('1980-01-01'),
          profile: 'ADMIN',
        },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  it('contar() so conta profile = STUDENT', async () => {
    const total = await comContexto({ kind: 'system', tenantId }, () => repo.contar({ tenantId } as never, {}));
    expect(total).toBe(1);
  });

  it('buscar() so devolve profile = STUDENT', async () => {
    const resultado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscar({ tenantId } as never, { limite: 20 }, new Date()),
    );
    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.fullName).toBe('Aluno Comum');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `pnpm --filter @arenahub/api test:integration -- students-profile-filter`
Expected: FAIL — `contar()` devolve 3, `buscar()` devolve 3 registros (professor e admin aparecem).

- [ ] **Step 3: Corrigir `contar()` em `student.repository.ts`**

Em `apps/api/src/modules/students/student.repository.ts:678-685`, adicionar `profile: 'STUDENT'` ao `where`:

```typescript
      return tx.student.count({
        where: {
          tenantId: contexto.tenantId,
          profile: 'STUDENT',
          ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
          ...(filtro.status ? { status: filtro.status } : {}),
          ...(filtro.modalityId ? condicaoDeModalidade(filtro.modalityId) : {}),
          ...condicoes,
        },
      });
```

- [ ] **Step 4: Corrigir `buscar()`**

Localizar o `where` dentro de `buscar()` (mesmo arquivo, corpo do método que usa `filtro.termo`/`filtro.status`/etc — está entre a linha 716 e o fechamento do método) e adicionar `profile: 'STUDENT'` no mesmo objeto `where` que hoje monta `tenantId`, `gymUnitId`, `status`, `modalityId`. Buscar o literal `where: {` dentro do corpo de `buscar` (não o de `contar`, já alterado) e aplicar a mesma adição.

- [ ] **Step 5: Rodar o teste para confirmar que passa**

Run: `pnpm --filter @arenahub/api test:integration -- students-profile-filter`
Expected: PASS nos dois casos.

- [ ] **Step 6: Rodar a suíte de integração completa de `students` para checar regressão**

Run: `pnpm --filter @arenahub/api test:integration -- students`
Expected: todos os specs existentes de `students` continuam PASS (nenhum fixture de teste hoje depende de professor/admin aparecendo na listagem — se algum depender, é sinal de teste que validava o próprio bug, ajustar o fixture para não incluir profile != STUDENT na asserção de contagem).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/students/student.repository.ts apps/api/test/integration/students-profile-filter.int-spec.ts
git commit -m "fix(students): grade e contador filtram profile=STUDENT, fecha issue #413

refs #415"
```

---

### Task 3: `TeamRepository` — leitura de professor/staff/admin

**Files:**
- Create: `apps/api/src/modules/team/team.repository.ts`
- Test: `apps/api/test/integration/team-repository.int-spec.ts`

**Interfaces:**
- Consumes: `TenantContext` (de `apps/api/src/common/tenant/tenant-context.js`), `PrismaService` (de `apps/api/src/persistence/prisma.service.js`).
- Produces: `TeamRepository.buscar(contexto: TenantContext, filtro: { termo?: string; limite: number; cursor?: string }): Promise<MembroDeTimeRow[]>`, `TeamRepository.contar(contexto: TenantContext, filtro: { termo?: string }): Promise<number>`, `TeamRepository.encontrar(contexto: TenantContext, id: string): Promise<MembroDeTimeRow | null>`.
- `MembroDeTimeRow` (exportado do arquivo): `{ id: string; membershipNumber: string; fullName: string; profile: 'ADMIN' | 'STAFF' | 'TRAINER'; gymUnitId: string; employmentType: 'CLT' | 'PJ' | 'AUTONOMOUS' | null; employmentStartedAt: Date | null; archivedAt: Date | null; version: number }`.

- [ ] **Step 1: Escrever teste de integração que falha (arquivo/classe ainda não existe)**

```typescript
// apps/api/test/integration/team-repository.int-spec.ts
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { TeamRepository } from '../../src/modules/team/team.repository.js';
import { comContexto } from '../../src/common/tenant/tenant-context.js';

describe('TeamRepository (F81)', () => {
  let repo: TeamRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TeamRepository, PrismaService],
    }).compile();

    repo = moduleRef.get(TeamRepository);
    db = moduleRef.get(PrismaService);

    tenantId = randomUUID();
    await db.tenant.create({ data: { id: tenantId, name: 'Tenant Team', slug: `team-${tenantId.slice(0, 8)}` } });
    const unidade = await db.gymUnit.create({
      data: { tenantId, name: 'Unidade Team', timezone: 'America/Sao_Paulo' },
    });
    gymUnitId = unidade.id;

    await db.student.createMany({
      data: [
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0001', fullName: 'Aluno Fora', birthDate: new Date('1995-01-01'), profile: 'STUDENT' },
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0002', fullName: 'Professor A', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0003', fullName: 'Staff B', birthDate: new Date('1988-01-01'), profile: 'STAFF' },
        { tenantId, gymUnitId, membershipNumber: 'TEAM-0004', fullName: 'Admin C', birthDate: new Date('1980-01-01'), profile: 'ADMIN' },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  it('buscar() devolve so profile != STUDENT', async () => {
    const membros = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscar({ tenantId } as never, { limite: 20 }),
    );
    expect(membros).toHaveLength(3);
    expect(membros.map((m) => m.fullName).sort()).toEqual(['Admin C', 'Professor A', 'Staff B']);
  });

  it('contar() bate com buscar()', async () => {
    const total = await comContexto({ kind: 'system', tenantId }, () => repo.contar({ tenantId } as never, {}));
    expect(total).toBe(3);
  });

  it('busca por termo filtra pelo nome', async () => {
    const membros = await comContexto({ kind: 'system', tenantId }, () =>
      repo.buscar({ tenantId } as never, { termo: 'Professor', limite: 20 }),
    );
    expect(membros).toHaveLength(1);
    expect(membros[0]?.fullName).toBe('Professor A');
  });

  it('encontrar() devolve null para id de outro tenant', async () => {
    const outroTenantId = randomUUID();
    await db.tenant.create({ data: { id: outroTenantId, name: 'Outro', slug: `outro-${outroTenantId.slice(0, 8)}` } });
    const outraUnidade = await db.gymUnit.create({ data: { tenantId: outroTenantId, name: 'U', timezone: 'America/Sao_Paulo' } });
    const alheio = await db.student.create({
      data: { tenantId: outroTenantId, gymUnitId: outraUnidade.id, membershipNumber: 'X-0001', fullName: 'Alheio', birthDate: new Date('1990-01-01'), profile: 'TRAINER' },
    });

    const resultado = await comContexto({ kind: 'system', tenantId }, () => repo.encontrar({ tenantId } as never, alheio.id));
    expect(resultado).toBeNull();

    await db.tenant.delete({ where: { id: outroTenantId } });
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `pnpm --filter @arenahub/api test:integration -- team-repository`
Expected: FAIL — `Cannot find module '../../src/modules/team/team.repository.js'`.

- [ ] **Step 3: Implementar `TeamRepository`**

```typescript
// apps/api/src/modules/team/team.repository.ts
import { Injectable } from '@nestjs/common';
import type { EmploymentType, StudentProfile } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/** Linha de leitura de time (TRAINER/STAFF/ADMIN) -- F81, issue #415. */
export interface MembroDeTimeRow {
  id: string;
  membershipNumber: string;
  fullName: string;
  profile: Exclude<StudentProfile, 'STUDENT'>;
  gymUnitId: string;
  employmentType: EmploymentType | null;
  employmentStartedAt: Date | null;
  archivedAt: Date | null;
  version: number;
}

/**
 * Le a MESMA tabela `students`, com o filtro invertido -- F81 (issue #415).
 *
 * NAO E ENTIDADE NOVA: professor, staff e admin ja sao `Student` com
 * `profile != STUDENT` desde a F48 (ADR-061 decisao 5, para o caso do
 * professor). Este repository existe para dar uma PORTA DE LEITURA propria
 * a quem quer o time, em vez de todo consumidor montar `profile: { not:
 * 'STUDENT' }` por conta propria.
 */
@Injectable()
export class TeamRepository {
  constructor(private readonly db: PrismaService) {}

  async buscar(
    contexto: TenantContext,
    filtro: { termo?: string | undefined; limite: number; cursor?: string | undefined },
  ): Promise<MembroDeTimeRow[]> {
    return this.db.comTenant((tx) =>
      tx.student.findMany({
        where: {
          tenantId: contexto.tenantId,
          profile: { not: 'STUDENT' },
          ...(filtro.termo ? { fullName: { contains: filtro.termo, mode: 'insensitive' } } : {}),
        },
        select: {
          id: true,
          membershipNumber: true,
          fullName: true,
          profile: true,
          gymUnitId: true,
          employmentType: true,
          employmentStartedAt: true,
          archivedAt: true,
          version: true,
        },
        orderBy: { fullName: 'asc' },
        take: filtro.limite,
        ...(filtro.cursor ? { skip: 1, cursor: { id: filtro.cursor } } : {}),
      }),
    ) as Promise<MembroDeTimeRow[]>;
  }

  async contar(contexto: TenantContext, filtro: { termo?: string | undefined }): Promise<number> {
    return this.db.comTenant((tx) =>
      tx.student.count({
        where: {
          tenantId: contexto.tenantId,
          profile: { not: 'STUDENT' },
          ...(filtro.termo ? { fullName: { contains: filtro.termo, mode: 'insensitive' } } : {}),
        },
      }),
    );
  }

  async encontrar(contexto: TenantContext, id: string): Promise<MembroDeTimeRow | null> {
    return this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id, tenantId: contexto.tenantId, profile: { not: 'STUDENT' } },
        select: {
          id: true,
          membershipNumber: true,
          fullName: true,
          profile: true,
          gymUnitId: true,
          employmentType: true,
          employmentStartedAt: true,
          archivedAt: true,
          version: true,
        },
      }),
    ) as Promise<MembroDeTimeRow | null>;
  }
}
```

Conferir a assinatura real de `PrismaService.comTenant` (usada por `StudentRepository`) antes deste passo — se o helper exigir um segundo argumento ou tiver nome ligeiramente diferente, seguir a assinatura real, não a suposta.

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `pnpm --filter @arenahub/api test:integration -- team-repository`
Expected: PASS nos quatro casos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/team/team.repository.ts apps/api/test/integration/team-repository.int-spec.ts
git commit -m "feat(team): TeamRepository le Student com profile != STUDENT (F81)"
```

---

### Task 4: Método de vínculo (`atualizarVinculo`) com timeline/auditLog/outbox

**Files:**
- Modify: `apps/api/src/modules/team/team.repository.ts` (adiciona método)
- Test: `apps/api/test/integration/team-repository.int-spec.ts` (adiciona casos)

**Interfaces:**
- Consumes: `MembroDeTimeRow` (Task 3).
- Produces: `TeamRepository.atualizarVinculo(contexto: TenantContext, id: string, versaoEsperada: number, dados: { employmentType?: EmploymentType | null; employmentStartedAt?: Date | null }, correlationId: string): Promise<MembroDeTimeRow | null>` — `null` quando `id` não existe, é `STUDENT`, ou `version` não bate (trava otimista).

- [ ] **Step 1: Escrever teste que falha**

Adicionar ao final do `describe` em `apps/api/test/integration/team-repository.int-spec.ts`:

```typescript
  it('atualizarVinculo grava employmentType e registra timeline/audit/outbox', async () => {
    const professor = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'TEAM-0010', fullName: 'Professor Vinculo', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
    });

    const atualizado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.atualizarVinculo(
        { tenantId } as never,
        professor.id,
        0,
        { employmentType: 'CLT', employmentStartedAt: new Date('2024-03-01') },
        'corr-f81-teste',
      ),
    );

    expect(atualizado?.employmentType).toBe('CLT');
    expect(atualizado?.version).toBe(1);

    const timeline = await db.studentTimelineEvent.findFirst({ where: { studentId: professor.id, type: 'STUDENT_UPDATED' } });
    expect(timeline).not.toBeNull();

    const outbox = await db.outboxEvent.findFirst({ where: { aggregateId: professor.id, eventType: 'StudentUpdated' } });
    expect(outbox).not.toBeNull();
  });

  it('atualizarVinculo devolve null quando version nao bate', async () => {
    const professor = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'TEAM-0011', fullName: 'Professor Versao', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
    });

    const resultado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.atualizarVinculo({ tenantId } as never, professor.id, 99, { employmentType: 'PJ' }, 'corr-f81-teste-2'),
    );

    expect(resultado).toBeNull();
  });

  it('atualizarVinculo devolve null para Student com profile STUDENT', async () => {
    const aluno = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'TEAM-0012', fullName: 'Aluno Nao Time', birthDate: new Date('1995-01-01'), profile: 'STUDENT' },
    });

    const resultado = await comContexto({ kind: 'system', tenantId }, () =>
      repo.atualizarVinculo({ tenantId } as never, aluno.id, 0, { employmentType: 'CLT' }, 'corr-f81-teste-3'),
    );

    expect(resultado).toBeNull();
  });
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @arenahub/api test:integration -- team-repository`
Expected: FAIL — `repo.atualizarVinculo is not a function`.

- [ ] **Step 3: Implementar o método**

Adicionar em `apps/api/src/modules/team/team.repository.ts`, dentro da classe `TeamRepository`:

```typescript
  /**
   * Grava vinculo trabalhista -- F81. Mesmo padrao de
   * `StudentRepository.atualizar`: trava otimista por `version`, timeline,
   * auditLog e outbox na MESMA transacao (regras de arquitetura 4 e 5).
   *
   * Devolve `null` quando o id nao existe neste tenant, quando pertence a
   * `profile = STUDENT` (nao e "time"), ou quando `versaoEsperada` nao bate
   * com a versao gravada -- os tres casos sao "nao atualizei", e quem chama
   * decide o HTTP certo para cada um.
   */
  async atualizarVinculo(
    contexto: TenantContext,
    id: string,
    versaoEsperada: number,
    dados: { employmentType?: EmploymentType | null; employmentStartedAt?: Date | null },
    correlationId: string,
  ): Promise<MembroDeTimeRow | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.student.updateMany({
        where: { id, tenantId: contexto.tenantId, version: versaoEsperada, profile: { not: 'STUDENT' } },
        data: {
          version: { increment: 1 },
          ...(dados.employmentType !== undefined ? { employmentType: dados.employmentType } : {}),
          ...(dados.employmentStartedAt !== undefined
            ? { employmentStartedAt: dados.employmentStartedAt }
            : {}),
        },
      });

      if (alterados.count === 0) return null;

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: id,
          type: 'STUDENT_UPDATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: { campos: Object.keys(dados) },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'team.employment_updated',
          target: 'student',
          targetId: id,
          correlationId,
          metadata: { campos: Object.keys(dados) },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'StudentUpdated',
          aggregateType: 'Student',
          aggregateId: id,
          payload: { studentId: id },
        },
      });

      return tx.student.findFirst({
        where: { id, tenantId: contexto.tenantId },
        select: {
          id: true,
          membershipNumber: true,
          fullName: true,
          profile: true,
          gymUnitId: true,
          employmentType: true,
          employmentStartedAt: true,
          archivedAt: true,
          version: true,
        },
      }) as Promise<MembroDeTimeRow | null>;
    });
  }
```

Conferir os campos exatos de `StudentTimelineEvent.type` (`STUDENT_UPDATED` já existe, confirmado em `student.repository.ts:579`) e de `AuditLog.action` (string livre, sem enum fechado, confirmado na Task de exploração) antes de codar — se algum tipo for enum fechado no Prisma e `STUDENT_UPDATED` não bastar, usar o mesmo valor que `StudentRepository.atualizar` usa.

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm --filter @arenahub/api test:integration -- team-repository`
Expected: PASS nos sete casos (4 da Task 3 + 3 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/team/team.repository.ts apps/api/test/integration/team-repository.int-spec.ts
git commit -m "feat(team): atualizarVinculo grava CLT/PJ/AUTONOMOUS com timeline/audit/outbox (F81)"
```

---

### Task 5: Agenda do professor (leitura de `Class.classesAsTrainer`)

**Files:**
- Modify: `apps/api/src/modules/team/team.repository.ts` (adiciona método)
- Test: `apps/api/test/integration/team-agenda.int-spec.ts`

**Interfaces:**
- Consumes: `Class` (modelo Prisma, já existe — `trainerId`, `dayOfWeek`, `startMinute`, `durationMinutes`, `modalityId`, `gymUnitId`, `isActive`).
- Produces: `TeamRepository.buscarAgenda(contexto: TenantContext, trainerId: string): Promise<AgendaDoProfessorRow[]>` — `AgendaDoProfessorRow = { classId: string; modalityId: string; dayOfWeek: number; startMinute: number; durationMinutes: number; gymUnitId: string }`. Lista vazia quando `trainerId` não existe neste tenant, não é TRAINER, ou não tem aula.

- [ ] **Step 1: Escrever teste que falha**

```typescript
// apps/api/test/integration/team-agenda.int-spec.ts
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { TeamRepository } from '../../src/modules/team/team.repository.js';
import { comContexto } from '../../src/common/tenant/tenant-context.js';

describe('TeamRepository.buscarAgenda (F81)', () => {
  let repo: TeamRepository;
  let db: PrismaService;
  let tenantId: string;
  let gymUnitId: string;
  let modalityId: string;
  let trainerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [TeamRepository, PrismaService] }).compile();
    repo = moduleRef.get(TeamRepository);
    db = moduleRef.get(PrismaService);

    tenantId = randomUUID();
    await db.tenant.create({ data: { id: tenantId, name: 'Tenant Agenda', slug: `agenda-${tenantId.slice(0, 8)}` } });
    const unidade = await db.gymUnit.create({ data: { tenantId, name: 'Unidade Agenda', timezone: 'America/Sao_Paulo' } });
    gymUnitId = unidade.id;

    const modalidade = await db.gymUnitModality.create({ data: { tenantId, gymUnitId, name: 'Cross Fit' } });
    modalityId = modalidade.id;

    const professor = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'AGENDA-0001', fullName: 'Professor Agenda', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
    });
    trainerId = professor.id;

    await db.class.createMany({
      data: [
        { tenantId, gymUnitId, modalityId, trainerId, dayOfWeek: 1, startMinute: 420, durationMinutes: 60, capacity: 20 },
        { tenantId, gymUnitId, modalityId, trainerId, dayOfWeek: 3, startMinute: 420, durationMinutes: 60, capacity: 20 },
        { tenantId, gymUnitId, modalityId, trainerId: null, dayOfWeek: 5, startMinute: 600, durationMinutes: 60, capacity: 15 },
      ],
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
  });

  it('devolve so as aulas deste professor', async () => {
    const agenda = await comContexto({ kind: 'system', tenantId }, () => repo.buscarAgenda({ tenantId } as never, trainerId));
    expect(agenda).toHaveLength(2);
    expect(agenda.map((a) => a.dayOfWeek).sort()).toEqual([1, 3]);
  });

  it('devolve lista vazia para professor sem aula', async () => {
    const outroProfessor = await db.student.create({
      data: { tenantId, gymUnitId, membershipNumber: 'AGENDA-0002', fullName: 'Professor Sem Aula', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
    });

    const agenda = await comContexto({ kind: 'system', tenantId }, () => repo.buscarAgenda({ tenantId } as never, outroProfessor.id));
    expect(agenda).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `pnpm --filter @arenahub/api test:integration -- team-agenda`
Expected: FAIL — `repo.buscarAgenda is not a function`.

- [ ] **Step 3: Implementar o método**

Adicionar em `apps/api/src/modules/team/team.repository.ts`:

```typescript
/** Ocorrencia de grade em que este professor da a aula -- F81, le F77. */
export interface AgendaDoProfessorRow {
  classId: string;
  modalityId: string;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  gymUnitId: string;
}
```

E o método na classe:

```typescript
  /**
   * Agenda do professor -- F81, le a relacao `Class.classesAsTrainer` que
   * ja existe (ADR-061 decisao 5, construida pela F77). SO LEITURA: nenhuma
   * escrita em `Class` nesta fatia.
   */
  async buscarAgenda(contexto: TenantContext, trainerId: string): Promise<AgendaDoProfessorRow[]> {
    return this.db.comTenant((tx) =>
      tx.class.findMany({
        where: { tenantId: contexto.tenantId, trainerId, isActive: true },
        select: { id: true, modalityId: true, dayOfWeek: true, startMinute: true, durationMinutes: true, gymUnitId: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      }),
    ).then((linhas) => linhas.map((l) => ({ classId: l.id, modalityId: l.modalityId, dayOfWeek: l.dayOfWeek, startMinute: l.startMinute, durationMinutes: l.durationMinutes, gymUnitId: l.gymUnitId })));
  }
```

- [ ] **Step 4: Rodar para confirmar que passa**

Run: `pnpm --filter @arenahub/api test:integration -- team-agenda`
Expected: PASS nos dois casos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/team/team.repository.ts apps/api/test/integration/team-agenda.int-spec.ts
git commit -m "feat(team): buscarAgenda le Class.classesAsTrainer para a ficha do professor (F81)"
```

---

### Task 6: `TeamController` + `TeamModule` — endpoints REST

**Files:**
- Create: `apps/api/src/modules/team/team.controller.ts`
- Create: `apps/api/src/modules/team/team.module.ts`
- Modify: `apps/api/src/app.module.ts` (registra `TeamModule`)
- Test: `apps/api/test/integration/team.e2e-spec.ts` (ou `.int-spec.ts`, seguindo o padrão de teste de controller já usado por `students`)

**Interfaces:**
- Consumes: `TeamRepository` (Tasks 3-5), `TenantContextService` (mesmo provider usado por `StudentsController`).
- Produces: `GET /api/v1/team` (lista, com `X-Total-Count`), `GET /api/v1/team/:id` (ficha), `GET /api/v1/team/:id/agenda` (agenda), `PATCH /api/v1/team/:id/employment` (vínculo).

- [ ] **Step 1: Localizar o padrão de teste de controller usado por `students`**

Rodar `Glob` ou `ls apps/api/test` para achar o arquivo que testa `StudentsController` via `supertest`/`app.getHttpServer()` e copiar o boilerplate de bootstrap do app de teste (módulo, guard de autenticação, tenant de fixture) — não reinventar esse bootstrap.

- [ ] **Step 2: Escrever teste que falha**

```typescript
// apps/api/test/integration/team.e2e-spec.ts
// Copiar o bootstrap (INestApplication, autenticacao de fixture, tenant) do
// arquivo equivalente de students (localizado no Step 1). O corpo abaixo
// assume as mesmas convencoes: header de auth ja resolvido pelo bootstrap,
// contexto de tenant fixo por fixture.

describe('TeamController (F81)', () => {
  // ...bootstrap copiado...

  it('GET /api/v1/team devolve so profile != STUDENT com X-Total-Count', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/v1/team')
      .set(headerDeAuth);

    expect(resposta.status).toBe(200);
    expect(resposta.headers['x-total-count']).toBeDefined();
    expect(resposta.body.every((m: { profile: string }) => m.profile !== 'STUDENT')).toBe(true);
  });

  it('PATCH /api/v1/team/:id/employment grava vinculo e responde 200', async () => {
    const professor = await criarProfessorDeFixture(); // helper local, mesmo padrao de criarAlunoDeFixture usado nos testes de students

    const resposta = await request(app.getHttpServer())
      .patch(`/api/v1/team/${professor.id}/employment`)
      .set(headerDeAuth)
      .send({ employmentType: 'CLT', employmentStartedAt: '2024-01-01', version: 0 });

    expect(resposta.status).toBe(200);
    expect(resposta.body.employmentType).toBe('CLT');
  });

  it('PATCH /api/v1/team/:id/employment com version desatualizada responde 409', async () => {
    const professor = await criarProfessorDeFixture();

    const resposta = await request(app.getHttpServer())
      .patch(`/api/v1/team/${professor.id}/employment`)
      .set(headerDeAuth)
      .send({ employmentType: 'PJ', version: 99 });

    expect(resposta.status).toBe(409);
  });

  it('GET /api/v1/team/:id/agenda devolve array (vazio ou nao)', async () => {
    const professor = await criarProfessorDeFixture();

    const resposta = await request(app.getHttpServer())
      .get(`/api/v1/team/${professor.id}/agenda`)
      .set(headerDeAuth);

    expect(resposta.status).toBe(200);
    expect(Array.isArray(resposta.body)).toBe(true);
  });
});
```

- [ ] **Step 3: Rodar para confirmar que falha**

Run: `pnpm --filter @arenahub/api test:integration -- team.e2e`
Expected: FAIL — 404 (rota não existe).

- [ ] **Step 4: Implementar `TeamController`**

```typescript
// apps/api/src/modules/team/team.controller.ts
import { Body, Controller, Get, NotFoundException, Param, Patch, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { TeamRepository } from './team.repository.js';

interface MembroDeTimeDto {
  id: string;
  membershipNumber: string;
  fullName: string;
  profile: string;
  gymUnitId: string;
  employmentType: string | null;
  employmentStartedAt: string | null;
  version: number;
}

const esquemaDeVinculo = z
  .object({
    employmentType: z.enum(['CLT', 'PJ', 'AUTONOMOUS']).nullable().optional(),
    employmentStartedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    version: z.number().int().min(0),
  })
  .strict();

@Controller('api/v1/team')
export class TeamController {
  constructor(
    private readonly time: TeamRepository,
    private readonly contexto: TenantContextService,
  ) {}

  private paraDto(membro: {
    id: string;
    membershipNumber: string;
    fullName: string;
    profile: string;
    gymUnitId: string;
    employmentType: string | null;
    employmentStartedAt: Date | null;
    version: number;
  }): MembroDeTimeDto {
    return {
      id: membro.id,
      membershipNumber: membro.membershipNumber,
      fullName: membro.fullName,
      profile: membro.profile,
      gymUnitId: membro.gymUnitId,
      employmentType: membro.employmentType,
      employmentStartedAt: membro.employmentStartedAt?.toISOString().slice(0, 10) ?? null,
      version: membro.version,
    };
  }

  @Get()
  @RequirePermissions('team.read')
  async buscar(
    @Res({ passthrough: true }) resposta: Response,
    @Query('q') termo?: string,
    @Query('limit') limite?: string,
  ): Promise<MembroDeTimeDto[]> {
    const take = Math.min(Number(limite) || 20, 100);
    const contexto = this.contexto.require();

    const membros = await this.time.buscar(contexto, { termo, limite: take });
    const total = await this.time.contar(contexto, { termo });

    resposta.setHeader('X-Total-Count', String(total));
    resposta.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');

    return membros.map((m) => this.paraDto(m));
  }

  @Get(':id')
  @RequirePermissions('team.read')
  async encontrar(@Param('id') id: string): Promise<MembroDeTimeDto> {
    const membro = await this.time.encontrar(this.contexto.require(), id);
    if (!membro) throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND' });
    return this.paraDto(membro);
  }

  @Get(':id/agenda')
  @RequirePermissions('team.read')
  async agenda(@Param('id') id: string) {
    const contexto = this.contexto.require();
    const membro = await this.time.encontrar(contexto, id);
    if (!membro) throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND' });

    return this.time.buscarAgenda(contexto, id);
  }

  @Patch(':id/employment')
  @RequirePermissions('team.update')
  async atualizarVinculo(@Param('id') id: string, @Body() corpo: unknown): Promise<MembroDeTimeDto> {
    const dados = esquemaDeVinculo.parse(corpo);
    const contexto = this.contexto.require();

    const atualizado = await this.time.atualizarVinculo(
      contexto,
      id,
      dados.version,
      {
        ...(dados.employmentType !== undefined ? { employmentType: dados.employmentType } : {}),
        ...(dados.employmentStartedAt !== undefined
          ? { employmentStartedAt: dados.employmentStartedAt ? new Date(dados.employmentStartedAt) : null }
          : {}),
      },
      'sem-correlacao',
    );

    if (!atualizado) {
      const existe = await this.time.encontrar(contexto, id);
      if (!existe) throw new NotFoundException({ code: 'TEAM_MEMBER_NOT_FOUND' });
      // Existe mas nao atualizou: so pode ser conflito de versao.
      throw new (await import('@nestjs/common')).ConflictException({ code: 'STALE_VERSION' });
    }

    return this.paraDto(atualizado);
  }
}
```

Ajustar o `import` dinâmico de `ConflictException` para um `import` estático no topo do arquivo (foi deixado inline aqui só para não quebrar a leitura linear do bloco de código — no arquivo real, `import { ..., ConflictException } from '@nestjs/common';` na primeira linha).

- [ ] **Step 5: Implementar `TeamModule`**

```typescript
// apps/api/src/modules/team/team.module.ts
import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { TeamController } from './team.controller.js';
import { TeamRepository } from './team.repository.js';

@Module({
  controllers: [TeamController],
  providers: [TeamRepository, TenantContextService],
})
export class TeamModule {}
```

- [ ] **Step 6: Registrar `TeamModule` em `app.module.ts`**

Localizar o array `imports` em `apps/api/src/app.module.ts` (onde `StudentsModule` já está listado) e adicionar `TeamModule` ao lado, com o import correspondente no topo do arquivo.

- [ ] **Step 7: Rodar para confirmar que passa**

Run: `pnpm --filter @arenahub/api test:integration -- team.e2e`
Expected: PASS nos quatro casos.

- [ ] **Step 8: Rodar a suíte completa da API para checar regressão**

Run: `pnpm --filter @arenahub/api test:integration`
Expected: nenhuma suíte pré-existente quebra.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/team apps/api/src/app.module.ts apps/api/test/integration/team.e2e-spec.ts
git commit -m "feat(team): expoe GET/PATCH /api/v1/team (F81)"
```

---

### Task 7: OpenAPI — registra os contratos novos

**Files:**
- Modify: `packages/api-contracts/openapi/arenahub-v1.json`

**Interfaces:**
- Consumes: nada (documentação gerada/mantida a mão, seguir o padrão do arquivo).

- [ ] **Step 1: Conferir como o contrato de `/students` está documentado hoje**

Abrir `packages/api-contracts/openapi/arenahub-v1.json` e localizar o path `/api/v1/students` — usar exatamente o mesmo formato de schema (nomes de campo, tipos) para os paths novos.

- [ ] **Step 2: Adicionar os paths `/api/v1/team`, `/api/v1/team/{id}`, `/api/v1/team/{id}/agenda`, `/api/v1/team/{id}/employment`**

Espelhar a estrutura de `/api/v1/students` e `/api/v1/students/{id}`, com os campos de `MembroDeTimeDto` (Task 6) no schema de resposta.

- [ ] **Step 3: Rodar a guarda de contrato, se existir**

Run: `pnpm --filter @arenahub/api-contracts test` (ou o comando equivalente que valida o JSON contra o schema OpenAPI — conferir `package.json` de `api-contracts` para o nome exato do script).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api-contracts/openapi/arenahub-v1.json
git commit -m "docs(api-contracts): registra os endpoints /api/v1/team no OpenAPI (F81)"
```

---

### Task 8: Tela `/team` no admin-web

**Files:**
- Create: `apps/admin-web/app/(protected)/team/page.tsx`
- Create: `apps/admin-web/app/(protected)/team/[id]/page.tsx`
- Test: `apps/admin-web/test/team.test.tsx` (ou local equivalente, seguindo o padrão de teste de `students/page.tsx`)

**Interfaces:**
- Consumes: `GET /api/v1/team`, `GET /api/v1/team/:id`, `GET /api/v1/team/:id/agenda`, `PATCH /api/v1/team/:id/employment` (Task 6).

- [ ] **Step 1: Ler `apps/admin-web/app/(protected)/students/page.tsx` inteiro**

Antes de escrever qualquer código desta task, ler o arquivo de referência completo (fetch de dados, componente de tabela usado, paginação, busca) para reusar o mesmo padrão de Server Component / client component de tabela. Este plano não repete esse código aqui porque ele muda conforme o arquivo real — copiar a estrutura, trocar a fonte de dados para `/api/v1/team` e as colunas para `fullName / profile / employmentType / employmentStartedAt`.

- [ ] **Step 2: Escrever teste que falha**

Seguir o padrão de teste já usado para `students/page.tsx` (Testing Library + mock de fetch), adaptado para:
- a tabela renderiza as colunas `fullName`, `profile`, `employmentType`;
- um clique na linha navega para `/team/[id]`.

- [ ] **Step 3: Rodar para confirmar que falha**

Run: `pnpm --filter @arenahub/admin-web test -- team`
Expected: FAIL — página não existe.

- [ ] **Step 4: Implementar `apps/admin-web/app/(protected)/team/page.tsx`**

Copiar a estrutura de `students/page.tsx`: Server Component que busca `GET /api/v1/team?q=...&limit=...`, passa para o componente de tabela client-side já usado por `students` (reusar o mesmo componente de DataTable se ele for genérico o bastante — conferir se aceita colunas configuráveis; se for específico de aluno, extrair a parte genérica para um componente compartilhado é aceitável aqui, mas só se o componente atual já for próximo disso — não reescrever do zero).

- [ ] **Step 5: Implementar `apps/admin-web/app/(protected)/team/[id]/page.tsx`**

Ficha do membro: dados básicos (`fullName`, `profile`, `membershipNumber`), campo de vínculo editável (`employmentType`, `employmentStartedAt` — form que chama `PATCH /api/v1/team/:id/employment`), e seção de agenda (lista read-only de `GET /api/v1/team/:id/agenda`, mostrando dia da semana + horário; sem edição de aula nesta fatia).

- [ ] **Step 6: Rodar para confirmar que passa**

Run: `pnpm --filter @arenahub/admin-web test -- team`
Expected: PASS.

- [ ] **Step 7: Rodar lint e typecheck do admin-web**

Run: `pnpm --filter @arenahub/admin-web lint && pnpm --filter @arenahub/admin-web typecheck`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/app/\(protected\)/team
git commit -m "feat(admin-web): tela /team lista time e ficha com vinculo + agenda (F81)"
```

---

### Task 9: E2E — `/team` não mostra aluno, `/students` não mostra time

**Files:**
- Create: `apps/admin-web/e2e/team.spec.ts` (ou local do Playwright já usado pelo projeto — conferir `apps/admin-web/e2e/students.spec.ts` como referência de bootstrap)

**Interfaces:**
- Consumes: app rodando (`pnpm dev` ou `next start` conforme os outros specs E2E), fixture de seed com pelo menos 1 STUDENT e 1 TRAINER.

- [ ] **Step 1: Ler `apps/admin-web/e2e/students.spec.ts` (ou equivalente) para copiar o bootstrap**

Mesmo bootstrap (login de fixture, base URL) usado pelos specs E2E existentes.

- [ ] **Step 2: Escrever o teste**

```typescript
// apps/admin-web/e2e/team.spec.ts
import { test, expect } from '@playwright/test';

test('tela de equipe lista professor e nao lista aluno comum', async ({ page }) => {
  // login de fixture -- copiar o helper usado pelos specs de students
  await page.goto('/team');

  await expect(page.getByRole('heading', { name: /equipe/i })).toBeVisible();
  await expect(page.getByText('Professor Fixture')).toBeVisible(); // nome da fixture de seed
  await expect(page.getByText('Aluno Fixture')).not.toBeVisible();
});

test('tela de alunos nao lista professor', async ({ page }) => {
  await page.goto('/students');

  await expect(page.getByText('Aluno Fixture')).toBeVisible();
  await expect(page.getByText('Professor Fixture')).not.toBeVisible();
});
```

Ajustar os nomes de fixture (`Professor Fixture`, `Aluno Fixture`) para os que realmente existem no seed (`packages/database/prisma/seed.ts`) — se o seed não tiver um TRAINER hoje, adicionar um antes desta task (linha de seed nova, mesmo padrão dos alunos existentes).

- [ ] **Step 3: Rodar para confirmar que falha (antes do rebuild) e depois que passa**

Run: `pnpm --filter @arenahub/admin-web build && pnpm --filter @arenahub/admin-web test:e2e -- team`
Expected: PASS. (Rebuild explícito antes — ver memória [[next-start-serve-build-antigo-no-e2e]]: `next start` serve build antigo se não recompilar entre plantar e rodar.)

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/e2e/team.spec.ts packages/database/prisma/seed.ts
git commit -m "test(e2e): confirma que /team e /students nao vazam profile um do outro (F81)"
```

---

### Task 10: Gate local completo + atualização de documentação

**Files:**
- Modify: `docs/STATUS.md`, `docs/DEVELOPMENT.md`, `docs/CONVENTION.md` (se a seção de `Student`/time precisar de nota sobre os campos novos)

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Rodar os 5 comandos raiz (gate local antes do push — ver memória [[gate-local-antes-do-push]])**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build`
Expected: todos verdes.

- [ ] **Step 2: Atualizar `docs/STATUS.md`**

Marcar F81/SPEC-081 como entregue no Índice Fatia ↔ SPEC e no Kanban.

- [ ] **Step 3: Atualizar `docs/DEVELOPMENT.md`**

Registrar a entrega da F81 na ordem de execução.

- [ ] **Step 4: Commit da documentação**

```bash
git add docs/STATUS.md docs/DEVELOPMENT.md
git commit -m "docs: registra entrega da F81 (tela de equipe) no STATUS e DEVELOPMENT"
```

- [ ] **Step 5: Push e abrir PR**

```bash
git push -u origin worktree-f81-tela-equipe
gh pr create --title "[MVP1][SPEC-081][F81] Tela de equipe: professor, staff e admin fora da contagem de aluno" --body "refs #415

## Resumo
- Corrige a causa raiz da issue #413: \`StudentRepository.contar\`/\`.buscar\` agora filtram \`profile = STUDENT\`.
- Tela nova \`/team\` (leitura), com vínculo trabalhista (CLT/PJ/AUTONOMOUS) editável e agenda do professor (lê \`Class.classesAsTrainer\`, já existente desde a F77/ADR-061).
- Sem entidade de pessoa nova: professor/staff/admin continuam sendo \`Student\` com \`profile != STUDENT\`.
- Fora de escopo (confirmado com o PI): criar/editar profile de time pela tela — continua por fora (script/seed) até fatia futura pedir.

## Critérios de aceite (da issue)
- [x] \`/students\` mostra 347, não 419
- [x] Professor, staff e admin não aparecem na grade de alunos
- [x] Tela de equipe lista os 71 professores + 1 admin
- [x] Agenda do professor mostra as aulas da grade atribuídas a ele
- [x] Vínculo gravado e exibido; migration idempotente para as linhas existentes
- [x] \`listarProfessores\` segue funcionando (contrato inalterado)

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review Notes

**Spec coverage:** todos os 6 critérios de aceite da issue #415 têm task correspondente (Task 2 cobre o primeiro/segundo, Task 3+6+8 cobrem o terceiro, Task 5 cobre o quarto, Task 1+4 cobrem o quinto, Task 2 Step 6 confirma o sexto por regressão).

**Placeholder scan:** nenhum "TBD"/"implementar depois" — os dois pontos marcados para "conferir no código real" (assinatura de `comTenant`, nome do script de contrato) são inspeções de 1 linha antes de colar código já escrito, não trabalho não especificado.

**Type consistency:** `MembroDeTimeRow` (Task 3) é reusado sem mudança de forma em Task 4, 5, 6. `AgendaDoProfessorRow` definido na Task 5 e consumido só ali/no controller.

**Review Focus:** as 4 entradas têm teste na task dona (migration idempotente → Task 1; filtro composto → Task 2 Step 6 + teste explícito recomendado se a suíte existente não cobrir; paginação/total → Task 6; cross-tenant na agenda → Task 5 Step 1 segundo caso: nome do teste indica "sem aula", falta um explícito de outro tenant — **gap identificado, corrigido abaixo**).

**Correção pós-autorrevisão:** Task 5 precisa de um terceiro caso de teste para cross-tenant explícito na agenda (o `encontrar()` da Task 3 já prova isolamento de tenant, mas `buscarAgenda()` é método separado com sua própria query — a mesma lacuna que a Task 3 testou explicitamente). Adicionado como parte do Step 1 da Task 5 abaixo — quem executar deve incluir este caso extra no arquivo `team-agenda.int-spec.ts`:

```typescript
  it('nao vaza agenda de professor de outro tenant', async () => {
    const outroTenantId = randomUUID();
    await db.tenant.create({ data: { id: outroTenantId, name: 'Outro Agenda', slug: `outro-agenda-${outroTenantId.slice(0, 8)}` } });
    const outraUnidade = await db.gymUnit.create({ data: { tenantId: outroTenantId, name: 'U2', timezone: 'America/Sao_Paulo' } });
    const outraModalidade = await db.gymUnitModality.create({ data: { tenantId: outroTenantId, gymUnitId: outraUnidade.id, name: 'Outra' } });
    const professorAlheio = await db.student.create({
      data: { tenantId: outroTenantId, gymUnitId: outraUnidade.id, membershipNumber: 'ALHEIO-0001', fullName: 'Professor Alheio', birthDate: new Date('1985-01-01'), profile: 'TRAINER' },
    });
    await db.class.create({
      data: { tenantId: outroTenantId, gymUnitId: outraUnidade.id, modalityId: outraModalidade.id, trainerId: professorAlheio.id, dayOfWeek: 2, startMinute: 480, durationMinutes: 60, capacity: 10 },
    });

    // Contexto do TENANT ERRADO (o do describe), id do professor de outro tenant.
    const agenda = await comContexto({ kind: 'system', tenantId }, () => repo.buscarAgenda({ tenantId } as never, professorAlheio.id));
    expect(agenda).toHaveLength(0);

    await db.tenant.delete({ where: { id: outroTenantId } });
  });
```
