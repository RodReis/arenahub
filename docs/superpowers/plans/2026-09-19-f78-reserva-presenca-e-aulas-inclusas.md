# F78 — Reserva, presença/no-show e "aulas inclusas" no plano — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recepção reserva aluno numa ocorrência de aula (respeitando "aulas inclusas" do plano e
capacidade), cancela reserva, marca presença/falta, e o campo novo em `Plan` restringe por
modalidade — sem tocar em nenhum caminho do motor de decisão de acesso.

**Architecture:** Módulo novo `apps/api/src/modules/class-reservations/` (controller + repository +
domain puro), reusando `resolverOcorrencia`/`validarGrade` de `classes/domain/class.ts`. Duas
tabelas novas (`ClassReservation`, `ClassAttendance`) e uma tabela de junção
(`PlanClassEntitlement`, `Plan` × `GymUnitModality`). Tela nova no admin-web sob a rota de aulas
existente.

**Tech Stack:** NestJS, Prisma (Postgres), Zod, Next.js Server Actions, Jest + supertest
(integração), Vitest (se houver unitário de domínio puro no front — não é o caso aqui).

**Spec:**
[SPEC-078](../../specs/SPEC-078-reserva-presenca-e-aulas-inclusas-no-plano.md),
[design F78](../specs/2026-09-19-f78-reserva-presenca-e-aulas-inclusas-design.md),
[ADR-061](../../DECISIONS.md#adr-061), [ADR-062](../../DECISIONS.md#adr-062)

## Global Constraints

- `tenant_id` em toda tabela nova (regra de arquitetura nº 2, `CLAUDE.md`). Todo método de
  repositório recebe `TenantContext` como primeiro parâmetro (INV-003).
- Motor de decisão de acesso não muda em nenhum caminho (regra de arquitetura nº 1). Nenhum código
  novo desta fatia é referenciado por `apps/api/src/modules/access` ou `access-query` — prova via
  teste estrutural (Task 8).
- Sem teto de reservas simultâneas, sem janela de cancelamento (ADR-062).
- `PlanClassEntitlement` vincula `Plan` × `GymUnitModality` — sem linha para um plano = autoriza
  todas as modalidades (mesma regra do `DEFAULT true` da F69).
- Cancelamento e no-show só registram: sem consumo de aula, sem bloqueio, sem penalidade
  automática, sem outbox/evento de domínio (nenhum consumidor downstream existe ainda).
- Unicidade de banco, não de `SELECT` prévio, para toda regra de concorrência (mesmo padrão de
  `ClassException`/`@@unique`).
- Erro de domínio: classe própria `extends ErroDeDominio(code, status, title)`, resposta
  `application/problem+json`.
- Migration: `<timestamp>_f78_<slug-curto-em-portugues>`, no padrão de
  `20260918160000_f77_agenda_de_aulas`.
- Teste de integração bate na porta da frente (supertest + cookie de sessão via
  `montarAcademia`/helpers existentes), não chama repositório direto.

---

### Task 1: Schema Prisma — `PlanClassEntitlement`, `ClassReservation`, `ClassAttendance`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
  - Inserir `PlanClassEntitlement` logo após `ClassException` (linha 1013, antes do comentário
    `/// Vinculo aluno <-> modalidade -- F60.` na linha 1015).
  - Inserir `ClassReservation` e `ClassAttendance` (com os enums `ClassReservationStatus` e
    `AttendanceStatus`) logo após `PlanClassEntitlement`.
  - Adicionar `classEntitlements PlanClassEntitlement[]` na relação de `model Plan` (linha 1728,
    junto de `benefits PlanBenefit[]`).
  - Adicionar `reservations ClassReservation[]` na relação de `model Class` (linha 972, junto de
    `exceptions ClassException[]`).
  - Adicionar `classReservations ClassReservation[]` na relação de `model Student` (aluno que
    reserva — procurar bloco de relações do `Student`, próximo de `subscriptions Subscription[]`).
  - Adicionar `classes PlanClassEntitlement[]` na relação de `model GymUnitModality` (linha 914,
    junto de `classes  Class[]`).

**Interfaces:**
- Produces: tipos Prisma `PlanClassEntitlement`, `ClassReservation`, `ClassAttendance`,
  `ClassReservationStatus` (`'RESERVED' | 'CANCELLED'`), `AttendanceStatus`
  (`'PRESENT' | 'NO_SHOW'`), exportados por `@arenahub/database` depois do `prisma generate`.

- [ ] **Step 1: Escrever os modelos no schema**

Inserir exatamente isto após a linha 1013 (fim de `model ClassException { ... }`):

```prisma
/// Vinculo Plan <-> modalidade de aula -- F78 (SPEC-078, ADR-061/ADR-062).
///
/// "AULAS INCLUSAS" E QUALITATIVO E APONTA PARA MODALIDADE, NAO PARA A AULA
/// ESPECIFICA -- decisao do PI em 19/09/2026 (ADR-062), que emenda a decisao
/// no 1 do ADR-060 (que havia escolhido vinculo com aula especifica antes de
/// `Class`/`GymUnitModality` existirem no desenho concreto).
///
/// AUSENCIA DE LINHA PARA UM PLANO AUTORIZA TODAS AS MODALIDADES -- mesma
/// regra do `DEFAULT true` da F69: nenhum plano em producao hoje tem
/// entitlement cadastrado, e nascer restritivo recusaria reserva para a base
/// inteira no dia do deploy.
model PlanClassEntitlement {
  id         String @id @default(uuid()) @db.Uuid
  tenantId   String @map("tenant_id") @db.Uuid
  planId     String @map("plan_id") @db.Uuid
  modalityId String @map("modality_id") @db.Uuid

  createdAt DateTime @default(now()) @map("created_at")

  tenant   Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan     Plan            @relation(fields: [planId], references: [id], onDelete: Cascade)
  modality GymUnitModality @relation(fields: [modalityId], references: [id], onDelete: Restrict)

  /// UMA linha por par plano/modalidade -- duplicata nao muda o
  /// comportamento (autoriza do mesmo jeito), so polui a listagem.
  @@unique([planId, modalityId])
  @@index([tenantId, planId])
  @@map("plan_class_entitlements")
}

enum ClassReservationStatus {
  RESERVED
  CANCELLED

  @@map("class_reservation_status")
}

enum AttendanceStatus {
  PRESENT
  NO_SHOW

  @@map("attendance_status")
}

/// Reserva de aluno numa ocorrencia de aula -- F78 (SPEC-078, ADR-061).
///
/// NAO DECIDE ACESSO -- ADR-061 decisao no 2, igual `Class`/`ClassException`.
/// A catraca nao consulta esta tabela; ha teste estrutural que prova isso
/// (`reserva-nao-decide-acesso.spec.ts`).
///
/// CANCELAMENTO E NO-SHOW SO REGISTRAM -- ADR-061 decisao no 3: sem consumo
/// de aula, sem bloqueio de reserva futura, sem penalidade automatica.
model ClassReservation {
  id             String                 @id @default(uuid()) @db.Uuid
  tenantId       String                 @map("tenant_id") @db.Uuid
  classId        String                 @map("class_id") @db.Uuid
  studentId      String                 @map("student_id") @db.Uuid
  /// Dia de CALENDARIO da ocorrencia reservada, mesmo eixo de
  /// `ClassException.occurrenceDate`.
  occurrenceDate DateTime               @map("occurrence_date") @db.Date
  status         ClassReservationStatus @default(RESERVED)
  /// Preenchidos SO quando a reserva foi aceita apesar de a modalidade nao
  /// estar no `PlanClassEntitlement` do aluno -- ADR-061 decisao no 8: quem
  /// liberou e quando ficam gravados.
  overriddenById String?                @map("overridden_by_id") @db.Uuid
  overriddenAt   DateTime?              @map("overridden_at")
  cancelledById  String?                @map("cancelled_by_id") @db.Uuid
  cancelledAt    DateTime?              @map("cancelled_at")

  createdAt DateTime @default(now()) @map("created_at")

  tenant        Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  class         Class             @relation(fields: [classId], references: [id], onDelete: Restrict)
  student       Student           @relation(fields: [studentId], references: [id], onDelete: Restrict)
  overriddenBy  User?             @relation("ClassReservationOverriddenBy", fields: [overriddenById], references: [id], onDelete: SetNull)
  cancelledBy   User?             @relation("ClassReservationCancelledBy", fields: [cancelledById], references: [id], onDelete: SetNull)
  attendance    ClassAttendance?

  /// UMA linha por aluno/ocorrencia -- reabrir depois de cancelar reusa esta
  /// linha (Task 3), nunca duplica.
  @@unique([classId, occurrenceDate, studentId])
  @@index([tenantId, classId, occurrenceDate])
  @@map("class_reservations")
}

/// Presenca ou falta de UMA reserva -- F78 (SPEC-078, ADR-061).
///
/// 1:1 COM `ClassReservation`: so existe registro para quem reservou (ADR-061
/// decisao no 6 -- so a recepcao marca, e so marca quem ja esta na lista).
model ClassAttendance {
  id            String           @id @default(uuid()) @db.Uuid
  tenantId      String           @map("tenant_id") @db.Uuid
  reservationId String           @unique @map("reservation_id") @db.Uuid
  status        AttendanceStatus
  markedById    String           @map("marked_by_id") @db.Uuid
  markedAt      DateTime         @default(now()) @map("marked_at")

  tenant      Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  reservation ClassReservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  markedBy    User             @relation("ClassAttendanceMarkedBy", fields: [markedById], references: [id], onDelete: Restrict)

  @@index([tenantId, reservationId])
  @@map("class_attendances")
}
```

- [ ] **Step 2: Adicionar relações inversas**

Em `model Plan` (linha ~1728), ao lado de `benefits PlanBenefit[]`, adicionar:

```prisma
  classEntitlements PlanClassEntitlement[]
```

Em `model Class` (linha ~972), ao lado de `exceptions ClassException[]`, adicionar:

```prisma
  reservations ClassReservation[]
```

Em `model GymUnitModality` (linha ~914), ao lado de `classes  Class[]`, adicionar:

```prisma
  planEntitlements PlanClassEntitlement[]
```

Em `model Student`, no bloco de relações (perto de `subscriptions Subscription[]`), adicionar:

```prisma
  classReservations ClassReservation[]
```

Em `model Tenant`, no bloco de relações (perto de `auditLogs AuditLog[]` ou qualquer relação de
lista existente, elas ficam todas juntas), adicionar as quatro relações inversas de tenant:

```prisma
  planClassEntitlements PlanClassEntitlement[]
  classReservations     ClassReservation[]
  classAttendances      ClassAttendance[]
```

Em `model User`, no bloco de relações, adicionar:

```prisma
  overriddenClassReservations ClassReservation[] @relation("ClassReservationOverriddenBy")
  cancelledClassReservations  ClassReservation[] @relation("ClassReservationCancelledBy")
  markedClassAttendances      ClassAttendance[]  @relation("ClassAttendanceMarkedBy")
```

- [ ] **Step 3: Gerar e revisar a migration**

```bash
pnpm --filter @arenahub/database exec prisma migrate dev --name f78_reserva_presenca_e_aulas_inclusas --create-only
```

Renomear a pasta gerada para o padrão `<timestamp>_f78_reserva_presenca_e_aulas_inclusas` se o
Prisma não usar esse slug exato. Abrir o `migration.sql` gerado e conferir: `CREATE TYPE` para os
dois enums antes das tabelas, `tenant_id UUID NOT NULL`, FKs com `ON DELETE CASCADE` para
`tenant_id`/`plan_id`, `ON DELETE RESTRICT` para `class_id`/`student_id`/`modality_id`, `ON DELETE
SET NULL` para `overridden_by_id`/`cancelled_by_id`, `ON DELETE RESTRICT` para `marked_by_id`.

- [ ] **Step 4: Aplicar a migration e gerar o client**

```bash
pnpm --filter @arenahub/database exec prisma migrate dev
pnpm --filter @arenahub/database exec prisma generate
```

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat: F78 -- schema de reserva, presenca e aulas inclusas no plano (SPEC-078, ADR-061/062)"
```

---

### Task 2: Domínio puro — checar entitlement do plano

**Files:**
- Create: `apps/api/src/modules/class-reservations/domain/entitlement.ts`
- Test: `apps/api/src/modules/class-reservations/domain/entitlement.spec.ts`

**Interfaces:**
- Consumes: nada (função pura, sem banco, sem `Date.now()`).
- Produces: `modalidadeAutorizada(modalidadesDoPlano: readonly string[], modalityId: string): boolean`,
  usado pela Task 4 (`reservar.use-case.ts`).

- [ ] **Step 1: Escrever o teste**

```typescript
import { describe, expect, it } from 'vitest';

import { modalidadeAutorizada } from './entitlement.js';

describe('modalidadeAutorizada', () => {
  it('autoriza tudo quando o plano nao tem nenhum entitlement cadastrado', () => {
    expect(modalidadeAutorizada([], 'modalidade-x')).toBe(true);
  });

  it('autoriza a modalidade que esta na lista', () => {
    expect(modalidadeAutorizada(['yoga-id', 'cross-id'], 'yoga-id')).toBe(true);
  });

  it('recusa a modalidade que nao esta na lista quando a lista nao e vazia', () => {
    expect(modalidadeAutorizada(['yoga-id'], 'cross-id')).toBe(false);
  });
});
```

Nota: se o projeto usa Jest em vez de Vitest para `apps/api` (confirmar em
`apps/api/package.json` / `jest.config`), trocar o import de `vitest` para `@jest/globals` ou
remover o import (Jest expõe `describe`/`it`/`expect` globalmente, sem import). Seguir o que os
outros arquivos `*.spec.ts` de `apps/api/src` já fazem.

- [ ] **Step 2: Rodar e verificar que falha**

```bash
pnpm --filter @arenahub/api test -- entitlement.spec.ts
```

Esperado: FAIL, `entitlement.ts` não existe.

- [ ] **Step 3: Implementar**

```typescript
/**
 * "Aulas inclusas" no plano -- F78 (SPEC-078, ADR-061, ADR-062).
 *
 * Funcao pura: sem banco. LISTA VAZIA AUTORIZA TUDO -- mesma regra do
 * `DEFAULT true` da F69: plano sem nenhum `PlanClassEntitlement` cadastrado
 * nao restringe nada.
 */
export function modalidadeAutorizada(
  modalidadesDoPlano: readonly string[],
  modalityId: string,
): boolean {
  if (modalidadesDoPlano.length === 0) return true;

  return modalidadesDoPlano.includes(modalityId);
}
```

- [ ] **Step 4: Rodar e verificar que passa**

```bash
pnpm --filter @arenahub/api test -- entitlement.spec.ts
```

Esperado: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/class-reservations/domain/entitlement.ts apps/api/src/modules/class-reservations/domain/entitlement.spec.ts
git commit -m "feat: F78 -- regra pura de aulas inclusas no plano (SPEC-078)"
```

---

### Task 3: Erros de domínio da reserva

**Files:**
- Create: `apps/api/src/modules/class-reservations/class-reservation.errors.ts`

**Interfaces:**
- Consumes: `ErroDeDominio` de `apps/api/src/common/http/erro-de-dominio.ts`.
- Produces: `OcorrenciaCanceladaError`, `AulaNaoInclusaNoPlanoError`, `AulaLotadaError`,
  `AlunoSemAssinaturaAtivaError`, `ReservaNaoEncontradaError`, usados pelas Tasks 4-6.

- [ ] **Step 1: Escrever o arquivo** (sem teste dedicado — classes triviais; cobertas pelos testes
  de integração das Tasks 4-6, que afirmam `code`/`status` na resposta HTTP)

```typescript
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';

/**
 * Erros de dominio de reserva/presenca -- F78 (SPEC-078, ADR-061).
 */
export class OcorrenciaCanceladaError extends ErroDeDominio {
  constructor() {
    super('CLASS_OCCURRENCE_CANCELLED', 409, 'Esta aula foi cancelada nesta data');
  }
}

export class AulaNaoInclusaNoPlanoError extends ErroDeDominio {
  constructor() {
    super('CLASS_NOT_INCLUDED_IN_PLAN', 422, 'O plano do aluno nao inclui esta modalidade');
  }
}

export class AulaLotadaError extends ErroDeDominio {
  constructor() {
    super('CLASS_FULL', 409, 'Nao ha vagas para esta aula nesta data');
  }
}

export class AlunoSemAssinaturaAtivaError extends ErroDeDominio {
  constructor() {
    super('STUDENT_HAS_NO_ACTIVE_SUBSCRIPTION', 422, 'Aluno nao tem assinatura ativa');
  }
}

export class ReservaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('CLASS_RESERVATION_NOT_FOUND', 404, 'Reserva nao encontrada');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/class-reservations/class-reservation.errors.ts
git commit -m "feat: F78 -- erros de dominio de reserva e presenca (SPEC-078)"
```

---

### Task 4: Repositório — reservar e cancelar

**Files:**
- Create: `apps/api/src/modules/class-reservations/class-reservation.repository.ts`
- Test: `apps/api/test/integration/f78-reservas.int-spec.ts` (criado nesta task, expandido nas
  Tasks 5-7)

**Interfaces:**
- Consumes: `resolverOcorrencia`, `Excecao` de `../classes/domain/class.js`; `modalidadeAutorizada`
  de `./domain/entitlement.js`; erros da Task 3; `TenantContext` de
  `../../common/tenant/tenant-context.js`; `PrismaService` de `../../persistence/prisma.service.js`.
- Produces:
  - `reservar(contexto: TenantContext, entrada: { classId: string; studentId: string; occurrenceDate: Date; overriddenById?: string }, correlationId: string): Promise<ClassReservation>`
  - `cancelar(contexto: TenantContext, reservationId: string, cancelledById: string, correlationId: string): Promise<ClassReservation | null>`
  - `listarPorOcorrencia(contexto: TenantContext, classId: string, occurrenceDate: Date): Promise<ClassReservation[]>`
  Usados pela Task 6 (controller) e reusados pela Task 5 (presença).

- [ ] **Step 1: Escrever o teste de integração (reservar dentro do plano)**

Criar `apps/api/test/integration/f78-reservas.int-spec.ts`. Reaproveitar os helpers
`montarAcademia`, `criarProfessor`, `criarModalidade`, `gerarCpfValido` de
`apps/api/test/integration/classes.int-spec.ts` — se eles não estiverem exportados, extraí-los para
`apps/api/test/integration/helpers/agenda.ts` nesta mesma task (mover, não duplicar) e importar dos
dois arquivos.

```typescript
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../../src/app.module.js';
import { montarAcademia, criarModalidade, criarProfessor, gerarCpfValido } from './helpers/agenda.js';

describe('F78 -- reserva, presenca e aulas inclusas no plano', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reserva um aluno numa aula cuja modalidade esta incluida no plano dele', async () => {
    const conta = await montarAcademia(app);
    const modalidade = await criarModalidade(app, conta, 'Yoga');

    const aula = await request(app.getHttpServer())
      .post(`/api/v1/units/${conta.unitId}/classes`)
      .set('Cookie', conta.cookie)
      .send({ modalityId: modalidade.id, dayOfWeek: 1, startMinute: 480, durationMinutes: 60, capacity: 10 })
      .expect(201);

    const aluno = await conta.criarAlunoComAssinatura(modalidade.planId);

    const resposta = await request(app.getHttpServer())
      .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: aluno.id, occurrenceDate: '2026-09-28' })
      .expect(201);

    expect(resposta.body.status).toBe('RESERVED');
    expect(resposta.body.overriddenById).toBeNull();
  });
});
```

Nota para quem implementa: o helper `criarAlunoComAssinatura` ainda não existe — criá-lo no mesmo
arquivo de helpers, encapsulando: criar `Student`, criar `Plan` com `PlanClassEntitlement` para a
modalidade recebida, criar `Subscription` `ACTIVE` ligando os dois. Sem esse encadeamento o teste
não tem como provar "aula incluída no plano".

- [ ] **Step 2: Rodar e verificar que falha**

```bash
pnpm --filter @arenahub/api test:integration -- f78-reservas.int-spec.ts
```

Esperado: FAIL, rota `/reservations` não existe (404) — o controller ainda não foi criado
(Task 6 cria a rota; por ora o teste falha por falta de rota, o que é esperado nesta etapa
intermediária. Se preferir, adicione um `.skip` temporário até a Task 6 e volte para rodar depois —
mas escreva o teste agora, antes do repositório, para guiar a interface).

- [ ] **Step 3: Implementar o repositório**

```typescript
import { Injectable } from '@nestjs/common';
import type { Class, ClassReservation } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { resolverOcorrencia, type Excecao } from '../classes/domain/class.js';
import { modalidadeAutorizada } from './domain/entitlement.js';
import {
  AlunoSemAssinaturaAtivaError,
  AulaLotadaError,
  AulaNaoInclusaNoPlanoError,
  OcorrenciaCanceladaError,
} from './class-reservation.errors.js';
import { AulaNaoEncontradaError } from '../classes/class.repository.js';

export interface DadosDeReserva {
  classId: string;
  studentId: string;
  occurrenceDate: Date;
  overriddenById?: string | undefined;
}

/**
 * Reserva, cancelamento e presenca -- F78 (SPEC-078, ADR-061).
 *
 * NAO CONSULTADO PELO MOTOR DE ACESSO -- ADR-061 decisao no 2, mesmo
 * principio de `ClassRepository`.
 */
@Injectable()
export class ClassReservationRepository {
  constructor(private readonly db: PrismaService) {}

  async reservar(
    contexto: TenantContext,
    entrada: DadosDeReserva,
    correlationId: string,
  ): Promise<ClassReservation> {
    const aula = await this.db.class.findFirst({
      where: { id: entrada.classId, tenantId: contexto.tenantId },
    });
    if (!aula) throw new AulaNaoEncontradaError();

    const excecoes = await this.db.classException.findMany({
      where: { tenantId: contexto.tenantId, classId: entrada.classId },
    });

    const ocorrencia = resolverOcorrencia(
      aula.trainerId,
      entrada.occurrenceDate,
      excecoes as unknown as Excecao[],
    );
    if (!ocorrencia.ocorre) throw new OcorrenciaCanceladaError();

    if (!entrada.overriddenById) {
      await this.validarEntitlement(contexto, entrada.studentId, aula.modalityId);
    }

    return this.db.$transaction(async (tx) => {
      const ativas = await tx.classReservation.count({
        where: {
          tenantId: contexto.tenantId,
          classId: entrada.classId,
          occurrenceDate: entrada.occurrenceDate,
          status: 'RESERVED',
        },
      });
      if (ativas >= aula.capacity) throw new AulaLotadaError();

      const existente = await tx.classReservation.findUnique({
        where: {
          classId_occurrenceDate_studentId: {
            classId: entrada.classId,
            occurrenceDate: entrada.occurrenceDate,
            studentId: entrada.studentId,
          },
        },
      });

      const dadosComuns = {
        status: 'RESERVED' as const,
        overriddenById: entrada.overriddenById ?? null,
        overriddenAt: entrada.overriddenById ? new Date() : null,
        cancelledById: null,
        cancelledAt: null,
      };

      const reserva = existente
        ? await tx.classReservation.update({ where: { id: existente.id }, data: dadosComuns })
        : await tx.classReservation.create({
            data: {
              tenantId: contexto.tenantId,
              classId: entrada.classId,
              studentId: entrada.studentId,
              occurrenceDate: entrada.occurrenceDate,
              ...dadosComuns,
            },
          });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: aula.gymUnitId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'class_reservation.created',
          target: 'class_reservation',
          targetId: reserva.id,
          correlationId,
          metadata: { classId: entrada.classId, overridden: Boolean(entrada.overriddenById) },
        },
      });

      return reserva;
    });
  }

  async cancelar(
    contexto: TenantContext,
    reservationId: string,
    cancelledById: string,
    correlationId: string,
  ): Promise<ClassReservation | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.classReservation.updateMany({
        where: { id: reservationId, tenantId: contexto.tenantId, status: 'RESERVED' },
        data: { status: 'CANCELLED', cancelledById, cancelledAt: new Date() },
      });

      // Idempotente: se ja estava CANCELLED, `alterados.count` e 0, mas a
      // linha existe -- devolve o estado atual em vez de 404.
      const atual = await tx.classReservation.findFirst({
        where: { id: reservationId, tenantId: contexto.tenantId },
      });
      if (!atual) return null;

      if (alterados.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId: contexto.tenantId,
            actorType: 'USER',
            actorId: contexto.actorId,
            action: 'class_reservation.cancelled',
            target: 'class_reservation',
            targetId: reservationId,
            correlationId,
            metadata: {},
          },
        });
      }

      return atual;
    });
  }

  async listarPorOcorrencia(
    contexto: TenantContext,
    classId: string,
    occurrenceDate: Date,
  ): Promise<ClassReservation[]> {
    return this.db.classReservation.findMany({
      where: { tenantId: contexto.tenantId, classId, occurrenceDate },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * `comTenant`: `students`/`subscriptions` tem politica RLS -- mesma
   * armadilha das issues #302/#306 ja documentada em `ClassRepository`.
   */
  private async validarEntitlement(
    contexto: TenantContext,
    studentId: string,
    modalityId: string,
  ): Promise<void> {
    const assinatura = await this.db.comTenant((tx) =>
      tx.subscription.findFirst({
        where: { studentId, tenantId: contexto.tenantId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
        orderBy: { startsAt: 'desc' },
        select: { planId: true },
      }),
    );
    if (!assinatura) throw new AlunoSemAssinaturaAtivaError();

    const entitlements = await this.db.planClassEntitlement.findMany({
      where: { tenantId: contexto.tenantId, planId: assinatura.planId },
      select: { modalityId: true },
    });

    const autorizado = modalidadeAutorizada(
      entitlements.map((e) => e.modalityId),
      modalityId,
    );
    if (!autorizado) throw new AulaNaoInclusaNoPlanoError();
  }
}
```

- [ ] **Step 4: Registrar o repositório no módulo (arquivo criado na Task 6) e rodar o teste**

Esta etapa depende do módulo/controller da Task 6 para expor a rota HTTP. Ordem de execução real:
implemente Tasks 4, 5 e 6 em sequência antes de rodar o teste desta task pela primeira vez — o
teste em si já está escrito e serve de guia para as três.

```bash
pnpm --filter @arenahub/api test:integration -- f78-reservas.int-spec.ts
```

Esperado, após a Task 6: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/class-reservations/class-reservation.repository.ts apps/api/test/integration/f78-reservas.int-spec.ts apps/api/test/integration/helpers/agenda.ts
git commit -m "feat: F78 -- repositorio de reserva com checagem de entitlement e capacidade (SPEC-078)"
```

---

### Task 5: Repositório — marcar presença/falta

**Files:**
- Modify: `apps/api/src/modules/class-reservations/class-reservation.repository.ts`
- Modify: `apps/api/test/integration/f78-reservas.int-spec.ts`

**Interfaces:**
- Consumes: `ClassReservationRepository` (Task 4).
- Produces: `marcarPresenca(contexto: TenantContext, entrada: { classId: string; occurrenceDate: Date; presentStudentIds: string[]; markedById: string }, correlationId: string): Promise<ClassAttendance[]>`

- [ ] **Step 1: Escrever o teste (presença e falta)**

Adicionar ao `f78-reservas.int-spec.ts`:

```typescript
it('marca presenca de quem veio e falta de quem reservou e nao apareceu', async () => {
  const conta = await montarAcademia(app);
  const modalidade = await criarModalidade(app, conta, 'Cross');
  const aula = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes`)
    .set('Cookie', conta.cookie)
    .send({ modalityId: modalidade.id, dayOfWeek: 2, startMinute: 600, durationMinutes: 60, capacity: 10 })
    .expect(201);

  const veio = await conta.criarAlunoComAssinatura(modalidade.planId);
  const faltou = await conta.criarAlunoComAssinatura(modalidade.planId);

  for (const aluno of [veio, faltou]) {
    await request(app.getHttpServer())
      .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: aluno.id, occurrenceDate: '2026-09-29' })
      .expect(201);
  }

  const resposta = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/attendance`)
    .set('Cookie', conta.cookie)
    .send({ occurrenceDate: '2026-09-29', presentStudentIds: [veio.id] })
    .expect(201);

  const porAluno = new Map(resposta.body.map((r: { studentId: string; status: string }) => [r.studentId, r.status]));
  expect(porAluno.get(veio.id)).toBe('PRESENT');
  expect(porAluno.get(faltou.id)).toBe('NO_SHOW');
});
```

- [ ] **Step 2: Rodar e verificar que falha**

```bash
pnpm --filter @arenahub/api test:integration -- f78-reservas.int-spec.ts
```

Esperado: FAIL, `marcarPresenca`/rota `/attendance` não existem.

- [ ] **Step 3: Implementar `marcarPresenca` no repositório**

Adicionar ao `ClassReservationRepository`:

```typescript
  async marcarPresenca(
    contexto: TenantContext,
    entrada: {
      classId: string;
      occurrenceDate: Date;
      presentStudentIds: string[];
      markedById: string;
    },
    correlationId: string,
  ): Promise<ClassAttendance[]> {
    return this.db.$transaction(async (tx) => {
      const reservas = await tx.classReservation.findMany({
        where: {
          tenantId: contexto.tenantId,
          classId: entrada.classId,
          occurrenceDate: entrada.occurrenceDate,
          status: 'RESERVED',
        },
      });

      const presentes = new Set(entrada.presentStudentIds);
      const registros: ClassAttendance[] = [];

      for (const reserva of reservas) {
        const status = presentes.has(reserva.studentId) ? 'PRESENT' : 'NO_SHOW';

        const registro = await tx.classAttendance.upsert({
          where: { reservationId: reserva.id },
          create: {
            tenantId: contexto.tenantId,
            reservationId: reserva.id,
            status,
            markedById: entrada.markedById,
          },
          update: { status, markedById: entrada.markedById, markedAt: new Date() },
        });

        registros.push(registro);
      }

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'class_attendance.marked',
          target: 'class',
          targetId: entrada.classId,
          correlationId,
          metadata: { occurrenceDate: entrada.occurrenceDate.toISOString().slice(0, 10) },
        },
      });

      return registros;
    });
  }
```

Adicionar `ClassAttendance` ao import de `@arenahub/database` no topo do arquivo.

- [ ] **Step 4: Rodar e verificar que passa** (após a Task 6 expor a rota)

```bash
pnpm --filter @arenahub/api test:integration -- f78-reservas.int-spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/class-reservations/class-reservation.repository.ts apps/api/test/integration/f78-reservas.int-spec.ts
git commit -m "feat: F78 -- marcar presenca e falta por ocorrencia (SPEC-078)"
```

---

### Task 6: Controller + módulo NestJS

**Files:**
- Create: `apps/api/src/modules/class-reservations/class-reservation.controller.ts`
- Create: `apps/api/src/modules/class-reservations/class-reservations.module.ts`
- Modify: `apps/api/src/app.module.ts` (registrar `ClassReservationsModule`)

**Interfaces:**
- Consumes: `ClassReservationRepository` (Tasks 4-5), `TenantContextService`
  (`../../common/tenant/tenant-context.service.js`), `RequirePermissions`
  (`../../common/security/permissions.decorator.js`).
- Produces: rotas HTTP consumidas pela Task 4/5 (testes) e pela Task 9 (admin-web):
  - `POST /api/v1/units/:unitId/classes/:classId/reservations`
  - `PATCH /api/v1/units/:unitId/classes/:classId/reservations/:reservationId/cancel`
  - `GET /api/v1/units/:unitId/classes/:classId/reservations?occurrenceDate=YYYY-MM-DD`
  - `POST /api/v1/units/:unitId/classes/:classId/attendance`

- [ ] **Step 1: Escrever o controller**

```typescript
import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { ClassAttendance, ClassReservation } from '@arenahub/database';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { ClassReservationRepository } from './class-reservation.repository.js';

const esquemaDeReserva = z
  .object({
    studentId: z.uuid(),
    occurrenceDate: z.iso.date(),
    /** Presenca da recepcao liberando fora do plano -- ADR-061 decisao no 8. */
    overriddenById: z.uuid().optional(),
  })
  .strict();

const esquemaDePresenca = z
  .object({
    occurrenceDate: z.iso.date(),
    presentStudentIds: z.array(z.uuid()),
  })
  .strict();

function paraData(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

interface ReservaDto {
  id: string;
  classId: string;
  studentId: string;
  occurrenceDate: string;
  status: string;
  overriddenById: string | null;
  cancelledById: string | null;
}

interface PresencaDto {
  reservationId: string;
  studentId: string;
  status: string;
}

/**
 * Reserva, cancelamento e presenca -- F78 (SPEC-078, ADR-061).
 *
 * ANINHADO EM `/units/:unitId/classes/:classId`, mesmo padrao de
 * `ClassController`.
 */
@Controller('api/v1/units')
export class ClassReservationController {
  constructor(
    private readonly reservas: ClassReservationRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Post(':unitId/classes/:classId/reservations')
  @RequirePermissions('class.manage')
  @ApiCreatedResponse({ description: 'Reserva criada' })
  async reservar(
    @Param('classId') classId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ReservaDto> {
    const dados = esquemaDeReserva.parse(corpo);

    const reserva = await this.reservas.reservar(
      this.contexto.require(),
      {
        classId,
        studentId: dados.studentId,
        occurrenceDate: paraData(dados.occurrenceDate),
        overriddenById: dados.overriddenById,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return this.paraDto(reserva);
  }

  @Patch(':unitId/classes/:classId/reservations/:reservationId/cancel')
  @RequirePermissions('class.manage')
  @ApiOkResponse({ description: 'Reserva cancelada' })
  async cancelar(
    @Param('reservationId') reservationId: string,
    @Req() requisicao: Request,
  ): Promise<ReservaDto> {
    const contexto = this.contexto.require();
    const reserva = await this.reservas.cancelar(
      contexto,
      reservationId,
      contexto.actorId,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    if (!reserva) throw new NotFoundException({ code: 'CLASS_RESERVATION_NOT_FOUND' });

    return this.paraDto(reserva);
  }

  @Get(':unitId/classes/:classId/reservations')
  @RequirePermissions('class.read')
  @ApiOkResponse({ description: 'Reservas da ocorrencia' })
  async listar(
    @Param('classId') classId: string,
    @Query('occurrenceDate') occurrenceDate: string,
  ): Promise<ReservaDto[]> {
    const encontradas = await this.reservas.listarPorOcorrencia(
      this.contexto.require(),
      classId,
      paraData(z.iso.date().parse(occurrenceDate)),
    );

    return encontradas.map((r) => this.paraDto(r));
  }

  @Post(':unitId/classes/:classId/attendance')
  @RequirePermissions('class.manage')
  @ApiCreatedResponse({ description: 'Presenca registrada' })
  async marcarPresenca(
    @Param('classId') classId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<PresencaDto[]> {
    const dados = esquemaDePresenca.parse(corpo);
    const contexto = this.contexto.require();

    const registros = await this.reservas.marcarPresenca(
      contexto,
      {
        classId,
        occurrenceDate: paraData(dados.occurrenceDate),
        presentStudentIds: dados.presentStudentIds,
        markedById: contexto.actorId,
      },
      requisicao.correlationId ?? 'sem-correlacao',
    );

    const reservasDaOcorrencia = await this.reservas.listarPorOcorrencia(
      contexto,
      classId,
      paraData(dados.occurrenceDate),
    );
    const reservaPorId = new Map(reservasDaOcorrencia.map((r) => [r.id, r]));

    return registros.map((registro: ClassAttendance) => ({
      reservationId: registro.reservationId,
      studentId: reservaPorId.get(registro.reservationId)?.studentId ?? '',
      status: registro.status,
    }));
  }

  private paraDto(reserva: ClassReservation): ReservaDto {
    return {
      id: reserva.id,
      classId: reserva.classId,
      studentId: reserva.studentId,
      occurrenceDate: reserva.occurrenceDate.toISOString().slice(0, 10),
      status: reserva.status,
      overriddenById: reserva.overriddenById,
      cancelledById: reserva.cancelledById,
    };
  }
}
```

- [ ] **Step 2: Escrever o módulo**

```typescript
import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { ClassReservationController } from './class-reservation.controller.js';
import { ClassReservationRepository } from './class-reservation.repository.js';

/**
 * Reserva, cancelamento e presenca -- F78 (SPEC-078, ADR-061).
 */
@Module({
  controllers: [ClassReservationController],
  providers: [ClassReservationRepository, TenantContextService],
})
export class ClassReservationsModule {}
```

- [ ] **Step 3: Registrar no `AppModule`**

Abrir `apps/api/src/app.module.ts`, achar o import/registro de `ClassesModule` e adicionar
`ClassReservationsModule` na mesma lista de `imports`.

- [ ] **Step 4: Rodar os testes de integração das Tasks 4 e 5**

```bash
pnpm --filter @arenahub/api test:integration -- f78-reservas.int-spec.ts
```

Esperado: PASS (todos os `it` escritos até aqui).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/class-reservations/class-reservation.controller.ts apps/api/src/modules/class-reservations/class-reservations.module.ts apps/api/src/app.module.ts
git commit -m "feat: F78 -- rotas de reserva, cancelamento e presenca (SPEC-078)"
```

---

### Task 7: Testes de integração restantes — capacidade, recusa por plano, liberação, isolamento

**Files:**
- Modify: `apps/api/test/integration/f78-reservas.int-spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 4-6.

- [ ] **Step 1: Escrever os testes restantes**

```typescript
it('recusa reserva quando o plano do aluno nao inclui a modalidade', async () => {
  const conta = await montarAcademia(app);
  const modalidadeIncluida = await criarModalidade(app, conta, 'Yoga');
  const modalidadeDaAula = await criarModalidade(app, conta, 'Cross');

  const aula = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes`)
    .set('Cookie', conta.cookie)
    .send({ modalityId: modalidadeDaAula.id, dayOfWeek: 3, startMinute: 480, durationMinutes: 60, capacity: 5 })
    .expect(201);

  const aluno = await conta.criarAlunoComAssinatura(modalidadeIncluida.planId);

  const resposta = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', conta.cookie)
    .send({ studentId: aluno.id, occurrenceDate: '2026-09-30' })
    .expect(422);

  expect(resposta.body.code).toBe('CLASS_NOT_INCLUDED_IN_PLAN');
});

it('libera manualmente a reserva fora do plano e grava quem liberou', async () => {
  const conta = await montarAcademia(app);
  const modalidadeIncluida = await criarModalidade(app, conta, 'Yoga');
  const modalidadeDaAula = await criarModalidade(app, conta, 'Cross');

  const aula = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes`)
    .set('Cookie', conta.cookie)
    .send({ modalityId: modalidadeDaAula.id, dayOfWeek: 4, startMinute: 480, durationMinutes: 60, capacity: 5 })
    .expect(201);

  const aluno = await conta.criarAlunoComAssinatura(modalidadeIncluida.planId);

  const resposta = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', conta.cookie)
    .send({ studentId: aluno.id, occurrenceDate: '2026-10-01', overriddenById: conta.userId })
    .expect(201);

  expect(resposta.body.overriddenById).toBe(conta.userId);
});

it('recusa a proxima reserva quando a capacidade esta esgotada', async () => {
  const conta = await montarAcademia(app);
  const modalidade = await criarModalidade(app, conta, 'Pilates');

  const aula = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes`)
    .set('Cookie', conta.cookie)
    .send({ modalityId: modalidade.id, dayOfWeek: 5, startMinute: 480, durationMinutes: 60, capacity: 1 })
    .expect(201);

  const primeiro = await conta.criarAlunoComAssinatura(modalidade.planId);
  const segundo = await conta.criarAlunoComAssinatura(modalidade.planId);

  await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', conta.cookie)
    .send({ studentId: primeiro.id, occurrenceDate: '2026-10-02' })
    .expect(201);

  const resposta = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', conta.cookie)
    .send({ studentId: segundo.id, occurrenceDate: '2026-10-02' })
    .expect(409);

  expect(resposta.body.code).toBe('CLASS_FULL');
});

it('cancela e permite reservar de novo na mesma ocorrencia (idempotencia sem duplicar linha)', async () => {
  const conta = await montarAcademia(app);
  const modalidade = await criarModalidade(app, conta, 'Funcional');

  const aula = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes`)
    .set('Cookie', conta.cookie)
    .send({ modalityId: modalidade.id, dayOfWeek: 6, startMinute: 480, durationMinutes: 60, capacity: 5 })
    .expect(201);

  const aluno = await conta.criarAlunoComAssinatura(modalidade.planId);

  const primeira = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', conta.cookie)
    .send({ studentId: aluno.id, occurrenceDate: '2026-10-03' })
    .expect(201);

  await request(app.getHttpServer())
    .patch(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations/${primeira.body.id}/cancel`)
    .set('Cookie', conta.cookie)
    .expect(200);

  const segunda = await request(app.getHttpServer())
    .post(`/api/v1/units/${conta.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', conta.cookie)
    .send({ studentId: aluno.id, occurrenceDate: '2026-10-03' })
    .expect(201);

  expect(segunda.body.id).toBe(primeira.body.id);
  expect(segunda.body.status).toBe('RESERVED');
});

it('isola reservas entre tenants -- reserva de uma conta nao aparece na listagem de outra', async () => {
  const contaA = await montarAcademia(app);
  const contaB = await montarAcademia(app);
  const modalidadeA = await criarModalidade(app, contaA, 'Yoga');

  const aula = await request(app.getHttpServer())
    .post(`/api/v1/units/${contaA.unitId}/classes`)
    .set('Cookie', contaA.cookie)
    .send({ modalityId: modalidadeA.id, dayOfWeek: 0, startMinute: 480, durationMinutes: 60, capacity: 5 })
    .expect(201);

  const aluno = await contaA.criarAlunoComAssinatura(modalidadeA.planId);

  await request(app.getHttpServer())
    .post(`/api/v1/units/${contaA.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', contaA.cookie)
    .send({ studentId: aluno.id, occurrenceDate: '2026-09-27' })
    .expect(201);

  await request(app.getHttpServer())
    .get(`/api/v1/units/${contaA.unitId}/classes/${aula.body.id}/reservations`)
    .set('Cookie', contaB.cookie)
    .query({ occurrenceDate: '2026-09-27' })
    .expect(404);
});
```

Nota: o último teste assume que o middleware de tenant já recusa acesso a `unitId` de outro tenant
com 404 (mesmo comportamento de `UnidadeNaoEncontradaError`/isolamento já provado em
`classes.int-spec.ts`) — se o comportamento observado for diferente (ex.: lista vazia em vez de
404), ajuste a asserção para o que o restante do módulo `classes` já faz, sem inventar
comportamento novo aqui.

- [ ] **Step 2: Rodar a suíte completa e verificar que passa**

```bash
pnpm --filter @arenahub/api test:integration -- f78-reservas.int-spec.ts
```

Esperado: PASS, todos os `it`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration/f78-reservas.int-spec.ts
git commit -m "test: F78 -- capacidade, recusa por plano, liberacao manual e isolamento de tenant (SPEC-078)"
```

---

### Task 8: Teste estrutural — reserva não decide acesso

**Files:**
- Read: `apps/api/src/modules/classes/agenda-nao-decide-acesso.spec.ts`
- Create: `apps/api/src/modules/class-reservations/reserva-nao-decide-acesso.spec.ts`

**Interfaces:**
- Consumes: nenhuma — teste lê código-fonte via `fs`/`glob`, não importa módulos de produção.

- [ ] **Step 1: Ler o teste existente e replicar a estrutura**

Abrir `apps/api/src/modules/classes/agenda-nao-decide-acesso.spec.ts`, copiar a mesma lógica
(varredura de `apps/api/src/modules/access` e `access-query` por regex), trocando os termos
proibidos de `Class`/`ClassException`/`ClassRepository` para `ClassReservation`,
`ClassAttendance`, `ClassReservationRepository`, `PlanClassEntitlement`.

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Prova em codigo da decisao no 2 do ADR-061: reserva/presenca NAO entra no
 * motor de decisao de acesso. Mesmo mecanismo de
 * `classes/agenda-nao-decide-acesso.spec.ts` (F77), estendido para as
 * tabelas novas da F78.
 */

const TERMOS_PROIBIDOS = [
  'ClassReservation',
  'ClassAttendance',
  'ClassReservationRepository',
  'PlanClassEntitlement',
];

const PASTAS_DO_MOTOR = [
  join(process.cwd(), 'src', 'modules', 'access'),
  join(process.cwd(), 'src', 'modules', 'access-query'),
];

function listarArquivosTs(pasta: string): string[] {
  const entradas = readdirSync(pasta);
  const arquivos: string[] = [];

  for (const entrada of entradas) {
    const caminho = join(pasta, entrada);
    if (statSync(caminho).isDirectory()) {
      arquivos.push(...listarArquivosTs(caminho));
    } else if (caminho.endsWith('.ts')) {
      arquivos.push(caminho);
    }
  }

  return arquivos;
}

describe('reserva-nao-decide-acesso', () => {
  it('nenhum arquivo do motor de acesso referencia reserva, presenca ou entitlement de aula', () => {
    const violacoes: string[] = [];

    for (const pasta of PASTAS_DO_MOTOR) {
      for (const arquivo of listarArquivosTs(pasta)) {
        const conteudo = readFileSync(arquivo, 'utf-8');
        for (const termo of TERMOS_PROIBIDOS) {
          if (conteudo.includes(termo)) violacoes.push(`${arquivo} referencia ${termo}`);
        }
      }
    }

    expect(violacoes).toEqual([]);
  });
});
```

Ajustar imports/sintaxe (`node:fs`, caminho relativo a `process.cwd()`) para bater exatamente com o
que `agenda-nao-decide-acesso.spec.ts` já faz — copiar o cabeçalho de imports de lá em vez de
reinventar, caso o mecanismo real seja outro (glob, `readdirSync` recursivo customizado, etc.).

- [ ] **Step 2: Rodar e verificar que passa já na primeira execução**

```bash
pnpm --filter @arenahub/api test -- reserva-nao-decide-acesso.spec.ts
```

Esperado: PASS (nenhum código do motor de acesso foi tocado por esta fatia).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/class-reservations/reserva-nao-decide-acesso.spec.ts
git commit -m "test: F78 -- prova estrutural de que reserva nao decide acesso (ADR-061)"
```

---

### Task 9: admin-web — tela de reservas e presença

**Files:**
- Create: `apps/admin-web/app/actions/class-reservations.ts`
- Create: `apps/admin-web/app/(protected)/classes/[classId]/reservations/page.tsx`
- Create: `apps/admin-web/app/(protected)/classes/[classId]/reservations/lista-de-reservas.tsx`
- Read: `apps/admin-web/app/actions/classes.ts` (padrão de Server Action a seguir)
- Read: `apps/admin-web/app/(protected)/classes/page.tsx` (padrão de Server Component a seguir)

**Interfaces:**
- Consumes: `chamarApi` de `lib/api/server-client` (mesmo client HTTP usado por `classes.ts`);
  rotas da Task 6.
- Produces: Server Actions `reservarAluno`, `cancelarReserva`, `registrarPresenca` — consumidas
  pelos componentes client desta task.

- [ ] **Step 1: Escrever a Server Action**

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client.js';

/**
 * Reserva, cancelamento e presenca -- F78 (SPEC-078, ADR-061).
 *
 * A validacao aqui NAO substitui a da API -- Server Action e superficie
 * publica tanto quanto um endpoint, mesmo principio de `classes.ts`.
 */

const MENSAGEM: Record<string, string> = {
  CLASS_NOT_INCLUDED_IN_PLAN: 'O plano deste aluno nao inclui esta modalidade. Libere manualmente se for o caso.',
  CLASS_FULL: 'Esta aula esta lotada nesta data.',
  CLASS_OCCURRENCE_CANCELLED: 'Esta aula foi cancelada nesta data.',
  STUDENT_HAS_NO_ACTIVE_SUBSCRIPTION: 'Este aluno nao tem assinatura ativa.',
  CLASS_RESERVATION_NOT_FOUND: 'Reserva nao encontrada.',
};

function mensagemDeErro(codigo: string | undefined): string {
  if (codigo && MENSAGEM[codigo]) return MENSAGEM[codigo];

  return codigo ? `Erro inesperado (${codigo})` : 'Erro inesperado';
}

const esquemaDeReserva = z.object({
  unitId: z.uuid(),
  classId: z.uuid(),
  studentId: z.uuid(),
  occurrenceDate: z.iso.date(),
  liberarManualmente: z.boolean().optional(),
  overriddenById: z.uuid().optional(),
});

export interface ResultadoDaAcao {
  erro?: string;
  sucesso?: boolean;
}

export async function reservarAluno(entrada: unknown): Promise<ResultadoDaAcao> {
  const dados = esquemaDeReserva.parse(entrada);

  try {
    await chamarApi(`/api/v1/units/${dados.unitId}/classes/${dados.classId}/reservations`, {
      method: 'POST',
      body: {
        studentId: dados.studentId,
        occurrenceDate: dados.occurrenceDate,
        overriddenById: dados.liberarManualmente ? dados.overriddenById : undefined,
      },
    });
  } catch (erro) {
    return { erro: mensagemDeErro((erro as { code?: string }).code) };
  }

  revalidatePath(`/classes/${dados.classId}/reservations`);
  return { sucesso: true };
}

const esquemaDeCancelamento = z.object({
  unitId: z.uuid(),
  classId: z.uuid(),
  reservationId: z.uuid(),
});

export async function cancelarReserva(entrada: unknown): Promise<ResultadoDaAcao> {
  const dados = esquemaDeCancelamento.parse(entrada);

  try {
    await chamarApi(
      `/api/v1/units/${dados.unitId}/classes/${dados.classId}/reservations/${dados.reservationId}/cancel`,
      { method: 'PATCH' },
    );
  } catch (erro) {
    return { erro: mensagemDeErro((erro as { code?: string }).code) };
  }

  revalidatePath(`/classes/${dados.classId}/reservations`);
  return { sucesso: true };
}

const esquemaDePresenca = z.object({
  unitId: z.uuid(),
  classId: z.uuid(),
  occurrenceDate: z.iso.date(),
  presentStudentIds: z.array(z.uuid()),
});

export async function registrarPresenca(entrada: unknown): Promise<ResultadoDaAcao> {
  const dados = esquemaDePresenca.parse(entrada);

  try {
    await chamarApi(`/api/v1/units/${dados.unitId}/classes/${dados.classId}/attendance`, {
      method: 'POST',
      body: { occurrenceDate: dados.occurrenceDate, presentStudentIds: dados.presentStudentIds },
    });
  } catch (erro) {
    return { erro: mensagemDeErro((erro as { code?: string }).code) };
  }

  revalidatePath(`/classes/${dados.classId}/reservations`);
  return { sucesso: true };
}
```

Ajustar a assinatura de `chamarApi` (nome do parâmetro `body`, forma de tratar erro/`code`) para
bater exatamente com o que `classes.ts` já usa — ler esse arquivo antes de finalizar este passo e
copiar a convenção literal, não a reinventar.

- [ ] **Step 2: Escrever o Server Component da página**

```tsx
import { chamarApi } from '../../../../lib/api/server-client.js';
import { ListaDeReservas } from './lista-de-reservas.js';

interface Props {
  params: { classId: string };
  searchParams: { unidade?: string; data?: string };
}

/**
 * Reserva e presenca de uma ocorrencia -- F78 (SPEC-078, ADR-061).
 */
export default async function PaginaDeReservas({ params, searchParams }: Props) {
  const unitId = searchParams.unidade ?? '';
  const occurrenceDate = searchParams.data ?? new Date().toISOString().slice(0, 10);

  const reservas = unitId
    ? await chamarApi(
        `/api/v1/units/${unitId}/classes/${params.classId}/reservations?occurrenceDate=${occurrenceDate}`,
      )
    : [];

  return (
    <ListaDeReservas
      unitId={unitId}
      classId={params.classId}
      occurrenceDate={occurrenceDate}
      reservasIniciais={reservas}
    />
  );
}
```

- [ ] **Step 3: Escrever o componente client (formulário de reserva + lista + presença)**

```tsx
'use client';

import { useActionState, useState } from 'react';

import { cancelarReserva, registrarPresenca, reservarAluno } from '../../../actions/class-reservations.js';

interface Reserva {
  id: string;
  studentId: string;
  status: string;
  overriddenById: string | null;
}

interface Props {
  unitId: string;
  classId: string;
  occurrenceDate: string;
  reservasIniciais: Reserva[];
}

/**
 * F78 (SPEC-078): reservar, cancelar e marcar presenca pela recepcao.
 */
export function ListaDeReservas({ unitId, classId, occurrenceDate, reservasIniciais }: Props) {
  const [reservas, setReservas] = useState(reservasIniciais);
  const [presentes, setPresentes] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  async function aoReservar(formData: FormData) {
    const studentId = String(formData.get('studentId') ?? '');
    const resultado = await reservarAluno({ unitId, classId, occurrenceDate, studentId });

    if (resultado.erro) {
      setErro(resultado.erro);
      return;
    }

    setErro(null);
  }

  async function aoCancelar(reservationId: string) {
    const resultado = await cancelarReserva({ unitId, classId, reservationId });
    if (resultado.erro) setErro(resultado.erro);
  }

  async function aoConfirmarPresenca() {
    const resultado = await registrarPresenca({
      unitId,
      classId,
      occurrenceDate,
      presentStudentIds: Array.from(presentes),
    });
    if (resultado.erro) setErro(resultado.erro);
  }

  return (
    <div>
      {erro ? <p role="alert">{erro}</p> : null}

      <form action={aoReservar}>
        <input name="studentId" placeholder="ID do aluno" required />
        <button type="submit">Reservar</button>
      </form>

      <ul>
        {reservas.map((reserva) => (
          <li key={reserva.id}>
            {reserva.studentId} -- {reserva.status}
            {reserva.overriddenById ? ' (liberado manualmente)' : ''}
            <label>
              <input
                type="checkbox"
                onChange={(evento) => {
                  const proximo = new Set(presentes);
                  if (evento.target.checked) proximo.add(reserva.studentId);
                  else proximo.delete(reserva.studentId);
                  setPresentes(proximo);
                }}
              />
              Presente
            </label>
            <button type="button" onClick={() => aoCancelar(reserva.id)}>
              Cancelar
            </button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={aoConfirmarPresenca}>
        Confirmar presenca
      </button>
    </div>
  );
}
```

Nota: este componente é o esqueleto funcional mínimo. Ajustar para os componentes de UI do design
system (`@arenahub/ui`) já usados em `classes/page.tsx` (ex.: `PageHeader`, `EmptyState`,
`DataTable`) antes de considerar a task pronta — seguir `docs/design/DS-PAINEL.md` e a skill
`frontend-design`, não ficar no HTML cru acima.

- [ ] **Step 4: Testar manualmente no navegador**

```bash
pnpm --filter @arenahub/admin-web dev
```

Abrir `/classes/<id>/reservations?unidade=<unitId>`, reservar um aluno, confirmar que a recusa por
plano mostra a mensagem amigável, marcar presença, conferir que falta aparece para quem não foi
marcado.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/app/actions/class-reservations.ts apps/admin-web/app/\(protected\)/classes/\[classId\]/reservations
git commit -m "feat: F78 -- tela de reserva, cancelamento e presenca no admin-web (SPEC-078)"
```

---

### Task 10: Multi-select de modalidades no formulário de Plan

**Files:**
- Modify: arquivo de formulário de edição de `Plan` no admin-web (localizar com
  `grep -rl "guestPassesPerMonth" apps/admin-web` — provavelmente
  `apps/admin-web/app/(protected)/plans/formulario-de-plano.tsx` ou nome equivalente).
- Modify: Server Action de edição de `Plan` (localizar com `grep -rl "guestPassesPerMonth"
  apps/admin-web/app/actions`).
- Modify: endpoint de edição de `Plan` em `apps/api/src/modules/membership/` para aceitar
  `classModalityIds?: string[]` e persistir via `PlanClassEntitlement` (substituir todas as linhas
  do plano por transação: apagar as existentes, criar as novas — mesmo padrão simples de
  substituição total usado em outras listas de configuração do projeto; confirmar padrão real
  grepando `deleteMany` seguido de `createMany` em algum repositório de `membership`).

**Interfaces:**
- Consumes: `PlanClassEntitlement` (Task 1); lista de `GymUnitModality` da unidade (endpoint já
  existente, usado por `classes/page.tsx`).

- [ ] **Step 1: Localizar os arquivos exatos**

```bash
grep -rl "guestPassesPerMonth" apps/admin-web apps/api/src/modules/membership
```

Ler os arquivos encontrados antes de editar — esta task depende do padrão real de "campo opcional
de plano" que a F76 (`guestPassesPerMonth`) já deixou, e não deve reinventar a forma de submeter o
formulário.

- [ ] **Step 2: Escrever o teste de integração da edição de `Plan`**

Adicionar a `apps/api/test/integration/membership.int-spec.ts` (ou arquivo equivalente que já testa
edição de `Plan` — confirmar nome com
`grep -rl "guestPassesPerMonth" apps/api/test/integration`):

```typescript
it('salva as modalidades incluidas no plano e aula fora da lista passa a ser recusada', async () => {
  // seguir o padrao de setup do arquivo (montarAcademia/criarModalidade
  // equivalente do modulo membership), depois:
  //
  // 1. Editar o Plan com classModalityIds: [modalidadeIncluida.id]
  // 2. Reservar aluno com esse plano numa aula de outra modalidade -> 422
  //    CLASS_NOT_INCLUDED_IN_PLAN (reusa a rota da Task 6)
  // 3. Reservar aluno numa aula da modalidade incluida -> 201
});
```

- [ ] **Step 3: Rodar e verificar que falha**

```bash
pnpm --filter @arenahub/api test:integration -- membership
```

- [ ] **Step 4: Implementar a persistência de `classModalityIds` no endpoint de edição de `Plan`**

Dentro da transação de edição do plano (arquivo achado no Step 1), adicionar:

```typescript
if (dados.classModalityIds) {
  await tx.planClassEntitlement.deleteMany({ where: { planId: id, tenantId: contexto.tenantId } });

  if (dados.classModalityIds.length > 0) {
    await tx.planClassEntitlement.createMany({
      data: dados.classModalityIds.map((modalityId) => ({
        tenantId: contexto.tenantId,
        planId: id,
        modalityId,
      })),
    });
  }
}
```

Adicionar `classModalityIds: z.array(z.uuid()).optional()` ao schema Zod de edição de `Plan`.

- [ ] **Step 5: Rodar e verificar que passa**

```bash
pnpm --filter @arenahub/api test:integration -- membership
```

- [ ] **Step 6: Adicionar o multi-select no formulário do admin-web**

No arquivo de formulário achado no Step 1, adicionar um `<select multiple>` (ou componente
equivalente de `@arenahub/ui` já usado ali para listas de escolha múltipla) populado pelas
modalidades da unidade, submetendo `classModalityIds` junto do restante do formulário. Seguir a
mesma Server Action de edição de plano já existente — não criar uma nova só para este campo.

- [ ] **Step 7: Testar manualmente no navegador**

```bash
pnpm --filter @arenahub/admin-web dev
```

Editar um plano, marcar uma modalidade, salvar, conferir que a tela recarrega mostrando a seleção
persistida.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: F78 -- aulas inclusas no formulario de plano (SPEC-078, ADR-062)"
```

---

### Task 11: Atualizar CONVENTION.md e fechar a fatia

**Files:**
- Modify: `docs/CONVENTION.md` (linha ~603, seção "Aulas / `Class`")
- Modify: `docs/STATUS.md` (marcar F78 conforme o fluxo de 3 passos do `CLAUDE.md`)

**Interfaces:** nenhuma — só documentação.

- [ ] **Step 1: Atualizar `CONVENTION.md`**

Trocar "em construção pelas F77/F78" por "implementado (F77, F78)" na linha da tabela de features,
e substituir a frase sobre "aulas inclusas é qualitativo" para registrar explicitamente: campo
aponta para modalidade (não para `Class`), conforme ADR-062.

- [ ] **Step 2: Rodar a suíte completa do repo**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Todos verdes antes de abrir o PR (piso do `CLAUDE.md`).

- [ ] **Step 3: Abrir o PR**

```bash
git push -u origin <nome-do-branch>
gh pr create --title "feat: F78 -- reserva, presenca e aulas inclusas no plano (SPEC-078, ADR-061/062)" --body "refs #368"
```

Corpo do PR deve citar: ADR-062 (decisões do PI sobre teto/janela/modalidade), a prova estrutural
da Task 8, e o aceite operacional da SPEC-078 §5 como checklist de teste manual já executado.

- [ ] **Step 4: Após CI verde, mergear**

```bash
gh pr checks <numero> --watch
gh pr merge <numero> --squash
```

- [ ] **Step 5: Aplicar `proplan:done` na issue #368 com o link do PR** (fechamento fica para o PI,
  conforme `CLAUDE.md` — nunca usar `closes #368` no PR).
