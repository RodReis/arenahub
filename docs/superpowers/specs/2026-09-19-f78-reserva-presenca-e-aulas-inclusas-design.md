# F78 — Reserva, presença/no-show e "aulas inclusas" no plano — design

| campo | valor |
|---|---|
| **Fatia** | F78 |
| **Spec** | [SPEC-078](../../specs/SPEC-078-reserva-presenca-e-aulas-inclusas-no-plano.md) |
| **Decisões** | [ADR-061](../../DECISIONS.md#adr-061), [ADR-062](../../DECISIONS.md#adr-062) |
| **Card** | [#368](https://github.com/RodReis/arenahub/issues/368) |
| **Depende de** | F77 (`Class`, `ClassException`, `resolverOcorrencia`) — em código (5fb45dc), issue #367 ainda sem aceite do PI |

## Decisões que fecham o escopo (ADR-062)

- Sem teto de reservas simultâneas por aluno.
- Sem janela de cancelamento.
- `PlanClassEntitlement` vincula `Plan` × `GymUnitModality` (modalidade), não `Plan` × `Class`.

## Schema

```prisma
model PlanClassEntitlement {
  id         String @id @default(uuid()) @db.Uuid
  tenantId   String @map("tenant_id") @db.Uuid
  planId     String @map("plan_id") @db.Uuid
  modalityId String @map("modality_id") @db.Uuid

  plan     Plan            @relation(fields: [planId], references: [id], onDelete: Cascade)
  modality GymUnitModality @relation(fields: [modalityId], references: [id], onDelete: Restrict)
  tenant   Tenant          @relation(fields: [tenantId], references: [id])

  createdAt DateTime @default(now())

  @@unique([planId, modalityId])
  @@index([tenantId, planId])
  @@map("plan_class_entitlements")
}

enum ReservationStatus {
  RESERVED
  CANCELLED
}

enum AttendanceStatus {
  PRESENT
  NO_SHOW
}

model ClassReservation {
  id             String            @id @default(uuid()) @db.Uuid
  tenantId       String            @map("tenant_id") @db.Uuid
  classId        String            @map("class_id") @db.Uuid
  studentId      String            @map("student_id") @db.Uuid
  occurrenceDate DateTime          @map("occurrence_date") @db.Date
  status         ReservationStatus @default(RESERVED)
  overriddenById String?           @map("overridden_by_id") @db.Uuid
  overriddenAt   DateTime?         @map("overridden_at")
  cancelledById  String?           @map("cancelled_by_id") @db.Uuid
  cancelledAt    DateTime?         @map("cancelled_at")
  createdAt      DateTime          @default(now())

  tenant     Tenant            @relation(fields: [tenantId], references: [id])
  class      Class             @relation(fields: [classId], references: [id], onDelete: Restrict)
  student    Student           @relation(fields: [studentId], references: [id], onDelete: Restrict)
  attendance ClassAttendance?

  @@unique([classId, occurrenceDate, studentId])
  @@index([tenantId, classId, occurrenceDate])
  @@map("class_reservations")
}

model ClassAttendance {
  id            String           @id @default(uuid()) @db.Uuid
  tenantId      String           @map("tenant_id") @db.Uuid
  reservationId String           @unique @map("reservation_id") @db.Uuid
  status        AttendanceStatus
  markedById    String           @map("marked_by_id") @db.Uuid
  markedAt      DateTime         @default(now())

  reservation ClassReservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)

  @@map("class_attendances")
}
```

Notas:
- `ClassReservation` referencia `Class` com `Restrict` — segue o aviso já deixado no schema pela
  F77 ("F78 vai gravar reserva apontando para aqui"): `Class.isActive=false` não afeta reservas
  passadas, e apagar uma `Class` com histórico é bloqueado pelo banco, não por `if` no código.
- `@@unique([classId, occurrenceDate, studentId])` é a idempotência de "uma reserva ativa por
  aluno/ocorrência" — cancelamento não libera o slot da constraint porque `status` não entra nela;
  reservar de novo depois de cancelar exige checar o registro cancelado e reabri-lo (ou, mais
  simples: permitir nova linha só se a única existente estiver `CANCELLED`, resolvido em código
  dentro da transação, não por constraint composta com `status`).
- `ClassAttendance` é 1:1 com `ClassReservation` — só existe presença para quem reservou (decisão
  nº 6 do ADR-061: só a recepção marca, e só marca quem já está na lista).
- Sem outbox: nenhum consumidor downstream existe (lista de espera/notificação depende do card
  #345, fora de escopo). Mesma escolha que a F77 já fez.

## Casos de uso (`apps/api/src/modules/class-reservations/`)

1. **`reservar.use-case.ts`**
   - Entrada: `TenantContext`, `classId`, `studentId`, `occurrenceDate`, `overriddenById?`.
   - Resolve a ocorrência com `resolverOcorrencia` (reuso da F77) — recusa se a aula está cancelada
     naquele dia (`CLASS_OCCURRENCE_CANCELLED`).
   - Checa entitlement: se `PlanClassEntitlement` existe para o plano ativo do aluno e a modalidade
     da `Class` **não** está na lista, recusa com `CLASS_NOT_INCLUDED_IN_PLAN` — a menos que
     `overriddenById` tenha sido informado (recepção liberou na hora); nesse caso grava
     `overriddenById`/`overriddenAt` e segue.
   - Dentro da mesma transação: conta `ClassReservation` com `status=RESERVED` para
     `(classId, occurrenceDate)`; se `>= Class.capacity`, recusa com `CLASS_FULL`.
   - Grava a reserva. Reserva existente `CANCELLED` para o mesmo `(class, ocorrência, aluno)` é
     reaberta (`status=RESERVED`, limpa `cancelledAt/cancelledById`) em vez de duplicar linha.

2. **`cancelar-reserva.use-case.ts`** — muda `status=CANCELLED`, grava `cancelledById/cancelledAt`.
   Idempotente: cancelar uma reserva já cancelada é no-op (mesmo efeito, sem erro).

3. **`marcar-presenca.use-case.ts`**
   - Entrada: `TenantContext`, `classId`, `occurrenceDate`, lista de `studentId` presentes,
     `markedById`.
   - Para cada reserva `RESERVED` da ocorrência: grava `ClassAttendance(PRESENT)` para quem está na
     lista, `ClassAttendance(NO_SHOW)` para quem não está — tudo na mesma transação, tudo no mesmo
     request (a recepção marca de uma vez ao fim da aula).
   - Idempotente: reexecutar com a mesma lista não duplica (upsert por `reservationId`, que é
     `@unique`).

## Erros de domínio novos

```ts
export class OcorrenciaCanceladaError extends ErroDeDominio {
  constructor() { super('CLASS_OCCURRENCE_CANCELLED', 409, 'Esta aula foi cancelada nesta data'); }
}
export class AulaNaoInclusaNoPlanoError extends ErroDeDominio {
  constructor() { super('CLASS_NOT_INCLUDED_IN_PLAN', 422, 'O plano do aluno não inclui esta modalidade'); }
}
export class AulaLotadaError extends ErroDeDominio {
  constructor() { super('CLASS_FULL', 409, 'Não há vagas para esta aula nesta data'); }
}
```

## Teste estrutural (regra de arquitetura nº 1)

Estender `apps/api/src/modules/classes/agenda-nao-decide-acesso.spec.ts` (ou duplicar como
`class-reservations/reserva-nao-decide-acesso.spec.ts`) para também recusar `ClassReservation`/
`ClassAttendance` referenciadas em `access`/`access-query`. Prova em código da decisão nº 2 do
ADR-061.

## admin-web

Nova aba/rota em `apps/admin-web/app/(protected)/classes/[classId]/reservations/`: escolhe data,
lista reservas da ocorrência (nome do aluno, status), botão reservar (com aviso de "fora do plano —
liberar?" quando recusado), cancelar, e marcar presença em lote. Server Actions em
`app/actions/class-reservations.ts`, mesmo padrão de tradução de `code` → mensagem PT-BR da F77.

Tela de edição de `Plan` ganha um multi-select de modalidades incluídas (vazio = todas).

## Escopo negativo (reforçado, não repetir na review)

- Motor de acesso não muda em nenhum caminho.
- Sem outbox, sem lista de espera, sem cobrança de avulsa, sem app do aluno/totem.
- Sem teto de reservas, sem janela de cancelamento (ADR-062).

## Testes

- Integração (`apps/api/test/integration/f78-reservas.int-spec.ts`): reservar dentro do plano;
  recusar fora do plano; liberar manualmente e conferir `overriddenById`; lotar capacidade e
  recusar a próxima; marcar presença e conferir `NO_SHOW` para quem não veio; cancelar e
  reservar de novo (idempotência); isolamento entre dois tenants.
- Unitário: `resolverOcorrencia` já testado pela F77; cobrir a decisão pura de
  "aula está no entitlement do plano?" (lista vazia = tudo liberado) sem banco.
- Prova da decisão nº 2: teste que o motor de acesso aceita aluno com e sem reserva igualmente
  (aceite operacional da spec §5).
