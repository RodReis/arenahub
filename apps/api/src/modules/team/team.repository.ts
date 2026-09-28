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

/** Ocorrencia de grade em que este professor da a aula -- F81, le F77. */
export interface AgendaDoProfessorRow {
  classId: string;
  modalityId: string;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  gymUnitId: string;
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
          payload: { campos: Object.keys(dados).filter((c) => dados[c as keyof typeof dados] !== undefined) },
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
          metadata: { campos: Object.keys(dados).filter((c) => dados[c as keyof typeof dados] !== undefined) },
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

  /**
   * Existe ESTE `Student` neste tenant, qualquer que seja o profile -- F82.
   *
   * `encontrar()` nao serve para o branch 404-vs-409 de `alterarPerfil`: ele
   * filtra `profile != STUDENT`, e um alvo que E `STUDENT` (o caso comum de
   * "promover aluno") pareceria inexistente mesmo estando la.
   */
  async existe(contexto: TenantContext, id: string): Promise<boolean> {
    const encontrado = await this.db.comTenant((tx) =>
      tx.student.findFirst({ where: { id, tenantId: contexto.tenantId }, select: { id: true } }),
    );
    return encontrado !== null;
  }

  /**
   * Troca o `profile` -- F82. Move a pessoa entre "aluno" e "time" (ou entre
   * papeis dentro do time), SEM filtro de profile no `where`: e o unico
   * caminho de escrita deste repository que precisa aceitar `profile =
   * STUDENT` de entrada, porque e exatamente o caso "promover aluno para
   * professor/staff/admin".
   *
   * Ao trocar PARA `STUDENT`, zera `employmentType`/`employmentStartedAt` --
   * vinculo trabalhista nao faz sentido para aluno comum (mesma regra do
   * schema, comentario de `Student.employmentType`) -- e SUSPENDE os
   * entitlements que nasceram do vinculo (`EMPLOYEE`/`PERSONAL_TRAINER`,
   * import F48 ou concedidos depois): o direito de acesso de professor/staff
   * nao sobrevive ao rebaixamento. Mesmo padrao de arquivar aluno
   * (`StudentRepository.alterarSituacao`) -- SUSPENDED, nao REVOKED, porque
   * e reversivel se a pessoa promover de volta. NAO mexe em entitlement de
   * assinatura (`subscriptionId` preenchido): perfil e vinculo trabalhista
   * sao independentes de o aluno pagar um plano por conta propria.
   */
  async alterarPerfil(
    contexto: TenantContext,
    id: string,
    versaoEsperada: number,
    novoPerfil: StudentProfile,
    correlationId: string,
    agora: Date,
  ): Promise<MembroDeTimeRow | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.student.updateMany({
        where: { id, tenantId: contexto.tenantId, version: versaoEsperada },
        data: {
          version: { increment: 1 },
          profile: novoPerfil,
          ...(novoPerfil === 'STUDENT'
            ? { employmentType: null, employmentStartedAt: null }
            : {}),
        },
      });

      if (alterados.count === 0) return null;

      if (novoPerfil === 'STUDENT') {
        await tx.entitlement.updateMany({
          where: {
            tenantId: contexto.tenantId,
            studentId: id,
            subscriptionId: null,
            source: { in: ['EMPLOYEE', 'PERSONAL_TRAINER'] },
            status: { in: ['SCHEDULED', 'ACTIVE'] },
          },
          data: { status: 'SUSPENDED', suspendedAt: agora },
        });
      }

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: id,
          type: 'STUDENT_UPDATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: { campos: ['profile'] },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'team.profile_changed',
          target: 'student',
          targetId: id,
          correlationId,
          metadata: { profile: novoPerfil },
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
    ).then((linhas) =>
      linhas.map((l) => ({
        classId: l.id,
        modalityId: l.modalityId,
        dayOfWeek: l.dayOfWeek,
        startMinute: l.startMinute,
        durationMinutes: l.durationMinutes,
        gymUnitId: l.gymUnitId,
      })),
    );
  }
}
