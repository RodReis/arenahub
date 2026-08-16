import { Injectable } from '@nestjs/common';
import type { BiometricIdentity, Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/** Alvo de sincronizacao: um dispositivo que precisa receber a identidade. */
export interface AlvoDeSync {
  deviceId: string;
  externalUserId: string;
}

/**
 * Identidade biometrica e seu ciclo de vida.
 *
 * A regra que este arquivo existe para garantir e o INV-018: revogar
 * BLOQUEIA LOGICAMENTE NO COMMIT, mesmo com exclusao fisica pendente. O
 * leitor pode levar minutos ou horas para confirmar; a autorizacao acaba
 * agora.
 */
@Injectable()
export class BiometricIdentityRepository {
  constructor(private readonly db: PrismaService) {}

  async encontrar(contexto: TenantContext, id: string): Promise<BiometricIdentity | null> {
    return this.db.biometricIdentity.findFirst({
      where: { id, tenantId: contexto.tenantId },
    });
  }

  async listarDoAluno(
    contexto: TenantContext,
    studentId: string,
  ): Promise<BiometricIdentity[]> {
    return this.db.biometricIdentity.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Identidade utilizavel agora: existe e nao foi revogada (INV-018). */
  async encontrarAtiva(
    contexto: TenantContext,
    studentId: string,
  ): Promise<BiometricIdentity | null> {
    return this.db.biometricIdentity.findFirst({
      where: { tenantId: contexto.tenantId, studentId, state: 'ACTIVE' },
    });
  }

  /**
   * Cria a identidade e os jobs de sync, NUMA TRANSACAO SO.
   *
   * Um job por identidade E por dispositivo (INV-024): o protocolo facial
   * nao tem operacao em lote (INV-023), entao a fila e individual por
   * natureza, nao por escolha.
   *
   * O evento de dominio entra na MESMA transacao (regra de arquitetura no 5):
   * publicar antes de commitar produziria sync de identidade que nao existe.
   */
  async criarComSync(
    contexto: TenantContext,
    dados: {
      studentId: string;
      consentRecordId: string;
      enrollmentObjectKey: string;
      alvos: readonly AlvoDeSync[];
    },
    correlationId: string,
  ): Promise<BiometricIdentity> {
    return this.db.$transaction(async (tx) => {
      const identidade = await tx.biometricIdentity.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          consentRecordId: dados.consentRecordId,
          enrollmentObjectKey: dados.enrollmentObjectKey,
        },
      });

      for (const alvo of dados.alvos) {
        await tx.deviceUser.create({
          data: {
            tenantId: contexto.tenantId,
            deviceId: alvo.deviceId,
            studentId: dados.studentId,
            identityId: identidade.id,
            externalUserId: alvo.externalUserId,
          },
        });

        await tx.deviceSyncJob.create({
          data: {
            tenantId: contexto.tenantId,
            deviceId: alvo.deviceId,
            identityId: identidade.id,
            operation: 'UPSERT',
            // Chave logica: reprocessar o outbox nao vira job novo.
            idempotencyKey: `${identidade.id}:${alvo.deviceId}:UPSERT`,
            correlationId,
          },
        });
      }

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          type: 'BIOMETRIC_IDENTITY_CREATED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          // Sem chave de objeto nem referencia de imagem (INV-022).
          payload: { targetDevices: dados.alvos.length },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'biometric.identity_created',
          target: 'biometric_identity',
          targetId: identidade.id,
          correlationId,
          metadata: { targetDevices: dados.alvos.length },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'BiometricIdentityCreated',
          aggregateType: 'BiometricIdentity',
          aggregateId: identidade.id,
          payload: { studentId: dados.studentId, targetDevices: dados.alvos.length },
        },
      });

      return identidade;
    });
  }

  /**
   * Revoga: bloqueio logico IMEDIATO + fan-out de exclusao (INV-018, INV-019).
   *
   * A ordem dentro da transacao e a do INV-019: desativar a identidade ->
   * criar os jobs DELETE -> auditar. Tudo commitado junto. Depois do commit,
   * a identidade ja nao autoriza nada, mesmo que nenhum leitor tenha
   * confirmado a remocao ainda.
   *
   * `DELETION_PENDING`, e nao `DELETED`: so vira `DELETED` quando TODOS os
   * dispositivos-alvo confirmarem (INV-027). Dizer "excluido" antes disso
   * seria mentir na tela de auditoria.
   *
   * NAO reescreve o consentimento: apagar uma identidade nao apaga a decisao
   * que a autorizou -- sao fatos distintos, e o segundo e prova.
   */
  async revogar(
    contexto: TenantContext,
    identityId: string,
    motivo: string,
    correlationId: string,
    agora: Date,
  ): Promise<BiometricIdentity | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.biometricIdentity.updateMany({
        where: {
          id: identityId,
          tenantId: contexto.tenantId,
          // Revogar o que ja foi revogado nao e erro, mas tambem nao refaz o
          // fan-out: so ACTIVE transiciona.
          state: 'ACTIVE',
        },
        data: {
          state: 'DELETION_PENDING',
          revokedAt: agora,
          revokedReason: motivo,
          version: { increment: 1 },
        },
      });

      if (alterados.count === 0) return null;

      const identidade = await tx.biometricIdentity.findFirstOrThrow({
        where: { id: identityId, tenantId: contexto.tenantId },
      });

      // Alvos = onde a identidade REALMENTE chegou ou tentou chegar. Usar a
      // lista de dispositivos ativos aqui erraria: leitor que recebeu o
      // cadastro e depois entrou em manutencao ainda tem a biometria dentro.
      const cadastros = await tx.deviceUser.findMany({
        where: {
          tenantId: contexto.tenantId,
          identityId,
          state: { in: ['PENDING', 'SYNCED', 'FAILED'] },
        },
      });

      for (const cadastro of cadastros) {
        await tx.deviceUser.update({
          where: { id: cadastro.id },
          data: { state: 'REMOVAL_PENDING' },
        });

        await tx.deviceSyncJob.upsert({
          where: { idempotencyKey: `${identityId}:${cadastro.deviceId}:DELETE` },
          create: {
            tenantId: contexto.tenantId,
            deviceId: cadastro.deviceId,
            identityId,
            operation: 'DELETE',
            idempotencyKey: `${identityId}:${cadastro.deviceId}:DELETE`,
            correlationId,
          },
          // Retentar exclusao cria TENTATIVA nova para a mesma exclusao
          // logica, nao uma exclusao nova.
          update: { state: 'PENDING', nextAttemptAt: null, errorCode: null },
        });
      }

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: identidade.studentId,
          type: 'BIOMETRIC_IDENTITY_REVOKED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          payload: { pendingDevices: cadastros.length },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'biometric.identity_revoked',
          target: 'biometric_identity',
          targetId: identityId,
          correlationId,
          metadata: { pendingDevices: cadastros.length, reason: motivo },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId: contexto.tenantId,
          eventType: 'BiometricIdentityRevoked',
          aggregateType: 'BiometricIdentity',
          aggregateId: identityId,
          payload: { studentId: identidade.studentId, pendingDevices: cadastros.length },
        },
      });

      return identidade;
    });
  }

  /**
   * Marca `DELETED` quando nenhum dispositivo tem mais o cadastro (INV-027).
   *
   * Chamado pela reconciliacao, apos cada resultado do Edge. Devolve `true`
   * quando a identidade fechou o ciclo.
   *
   * Dispositivo em `FAILED` IMPEDE o fechamento de proposito: a exclusao nao
   * aconteceu naquele leitor, e declarar `DELETED` esconderia biometria viva
   * em equipamento que ninguem foi conferir.
   */
  async fecharSeExcluidaEmTodos(
    tx: Prisma.TransactionClient,
    tenantId: string,
    identityId: string,
    agora: Date,
  ): Promise<boolean> {
    const pendentes = await tx.deviceUser.count({
      where: {
        tenantId,
        identityId,
        state: { in: ['PENDING', 'SYNCED', 'REMOVAL_PENDING', 'FAILED'] },
      },
    });

    if (pendentes > 0) return false;

    await tx.biometricIdentity.updateMany({
      where: { id: identityId, tenantId, state: 'DELETION_PENDING' },
      data: { state: 'DELETED', deletedAt: agora },
    });

    return true;
  }

  /**
   * Apaga a referencia ao objeto de cadastro apos o expurgo (INV-142).
   *
   * A linha da identidade NAO morre: o historico de que houve identidade e o
   * que a auditoria consulta. O que some e o ponteiro para a imagem, junto
   * do carimbo que prova quando sumiu.
   */
  async registrarExpurgoDoObjeto(
    contexto: TenantContext,
    identityId: string,
    agora: Date,
  ): Promise<void> {
    await this.db.biometricIdentity.updateMany({
      where: { id: identityId, tenantId: contexto.tenantId },
      data: { enrollmentObjectKey: null, enrollmentPurgedAt: agora },
    });
  }

  /** Registra acesso a dado biometrico (ADR-008). */
  async registrarAcesso(
    contexto: TenantContext,
    dados: {
      identityId: string;
      kind: 'ENROLLMENT_IMAGE' | 'IDENTITY_METADATA';
      purpose: 'ENROLLMENT' | 'DEVICE_SYNC' | 'REVOCATION' | 'PURGE' | 'AUDIT';
      actorType: 'USER' | 'SYSTEM';
      actorIp?: string | undefined;
    },
    correlationId: string,
  ): Promise<void> {
    await this.db.biometricAccessLog.create({
      data: {
        tenantId: contexto.tenantId,
        identityId: dados.identityId,
        kind: dados.kind,
        purpose: dados.purpose,
        actorType: dados.actorType,
        actorId: dados.actorType === 'USER' ? contexto.actorId : null,
        actorIp: dados.actorIp ?? null,
        correlationId,
      },
    });
  }
}
