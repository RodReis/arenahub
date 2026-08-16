import { Injectable } from '@nestjs/common';
import type { DeviceCommand, DeviceSyncJob } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { decidirRetentativa } from './domain/retentativa.js';

/** Lease de comando: 60 s, renovavel. */
export const LEASE_EM_SEGUNDOS = 60;

export interface FiltroDeJobs {
  deviceId?: string | undefined;
  identityId?: string | undefined;
  state?: string | undefined;
  limite: number;
  cursor?: string | undefined;
}

/**
 * Fila de sincronizacao e comandos duraveis.
 *
 * O comando e PERSISTIDO antes de qualquer notificacao. O WebSocket so avisa
 * que ha trabalho; se o socket cair, o comando continua aqui e o Edge o
 * busca por REST assinado. Notificacao perdida nao e comando perdido -- e a
 * razao de a fila viver no Postgres e nao so no Redis.
 */
@Injectable()
export class DeviceSyncRepository {
  constructor(private readonly db: PrismaService) {}

  async listarJobs(contexto: TenantContext, filtro: FiltroDeJobs): Promise<DeviceSyncJob[]> {
    return this.db.deviceSyncJob.findMany({
      where: {
        tenantId: contexto.tenantId,
        ...(filtro.deviceId ? { deviceId: filtro.deviceId } : {}),
        ...(filtro.identityId ? { identityId: filtro.identityId } : {}),
        ...(filtro.state
          ? { state: filtro.state as DeviceSyncJob['state'] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filtro.limite,
      ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
    });
  }

  /**
   * Materializa comandos duraveis para os jobs pendentes de um Edge.
   *
   * Roda numa transacao por job: um comando que falha ao ser criado nao
   * impede os outros. `sequence` cresce por Edge e da ordem estavel para o
   * `GET /edge/commands?after=`.
   *
   * O `upsert` pela chave de idempotencia e o que torna reprocessar seguro
   * (regra de arquitetura no 4): o mesmo trabalho logico nunca vira dois
   * comandos.
   */
  async materializarComandos(
    edgeNodeId: string,
    tenantId: string,
    agora: Date,
  ): Promise<number> {
    const pendentes = await this.db.deviceSyncJob.findMany({
      where: {
        tenantId,
        state: { in: ['PENDING', 'RETRYING'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: agora } }],
        device: { edgeNodeId },
      },
      include: {
        device: { select: { id: true, serial: true } },
        identity: { select: { id: true, enrollmentObjectKey: true } },
      },
      take: 100,
    });

    let criados = 0;

    for (const job of pendentes) {
      const cadastro = await this.db.deviceUser.findFirst({
        where: { deviceId: job.deviceId, identityId: job.identityId },
        select: { externalUserId: true },
      });

      if (!cadastro) continue;

      await this.db.$transaction(async (tx) => {
        const ultimo = await tx.deviceCommand.findFirst({
          where: { edgeNodeId },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        });

        const proxima = (ultimo?.sequence ?? 0n) + 1n;

        await tx.deviceCommand.upsert({
          where: { idempotencyKey: job.idempotencyKey },
          create: {
            tenantId,
            edgeNodeId,
            sequence: proxima,
            type: job.operation === 'UPSERT' ? 'DEVICE_USER_UPSERT' : 'DEVICE_USER_DELETE',
            // NUNCA template bruto: leva a referencia do objeto, e o Edge
            // busca a imagem por URL assinada quando precisar.
            payload: {
              deviceSerial: job.device.serial,
              externalUserId: cadastro.externalUserId,
              identityId: job.identityId,
              ...(job.operation === 'UPSERT'
                ? { enrollmentObjectKey: job.identity.enrollmentObjectKey }
                : {}),
            },
            idempotencyKey: job.idempotencyKey,
            correlationId: job.correlationId,
          },
          // Ja existe: o comando anterior continua valendo. Retentar nao
          // cria comando novo, so o devolve para AVAILABLE.
          update: { state: 'AVAILABLE', leasedAt: null, leaseExpiresAt: null },
        });

        await tx.deviceSyncJob.update({
          where: { id: job.id },
          data: { state: 'PROCESSING', lastAttemptAt: agora },
        });

        criados += 1;
      });
    }

    return criados;
  }

  /**
   * Comandos disponiveis para o Edge, apos uma sequencia.
   *
   * Devolve tambem o que esta `LEASED` com lease EXPIRADO: Edge que morreu
   * no meio da execucao nao pode travar a fila para sempre.
   */
  async listarComandosDisponiveis(
    edgeNodeId: string,
    depoisDaSequencia: bigint,
    limite: number,
    agora: Date,
  ): Promise<DeviceCommand[]> {
    return this.db.deviceCommand.findMany({
      where: {
        edgeNodeId,
        sequence: { gt: depoisDaSequencia },
        OR: [
          { state: 'AVAILABLE' },
          { state: 'LEASED', leaseExpiresAt: { lt: agora } },
        ],
      },
      orderBy: { sequence: 'asc' },
      take: limite,
    });
  }

  /**
   * Arrenda o comando por 60 s.
   *
   * `updateMany` com o estado no filtro: dois Edges (ou duas instancias do
   * mesmo) pedindo o mesmo comando fazem o segundo receber `count: 0` em vez
   * de os dois acharem que ganharam.
   */
  async arrendarComando(
    edgeNodeId: string,
    commandId: string,
    agora: Date,
  ): Promise<boolean> {
    const alterados = await this.db.deviceCommand.updateMany({
      where: {
        id: commandId,
        edgeNodeId,
        OR: [
          { state: 'AVAILABLE' },
          { state: 'LEASED', leaseExpiresAt: { lt: agora } },
        ],
      },
      data: {
        state: 'LEASED',
        leasedAt: agora,
        leaseExpiresAt: new Date(agora.getTime() + LEASE_EM_SEGUNDOS * 1000),
      },
    });

    return alterados.count === 1;
  }

  /**
   * Aplica o resultado que o Edge reportou.
   *
   * IDEMPOTENTE: resultado repetido IDENTICO e sucesso silencioso; resultado
   * DIFERENTE para o mesmo comando ja reconhecido e recusado. O Edge pode
   * ter executado no leitor e morrido antes de reportar -- reenviar precisa
   * ser seguro, mas mudar a historia nao.
   *
   * Devolve `null` quando o comando nao existe ou o resultado conflita.
   */
  async aplicarResultado(
    edgeNodeId: string,
    resultado: {
      commandId: string;
      success: boolean;
      errorCode?: string | undefined;
      deviceTimestamp: string;
    },
    agora: Date,
  ): Promise<{ aplicado: boolean; conflito: boolean }> {
    return this.db.$transaction(async (tx) => {
      const comando = await tx.deviceCommand.findFirst({
        where: { id: resultado.commandId, edgeNodeId },
      });

      if (!comando) return { aplicado: false, conflito: false };

      if (comando.state === 'ACKNOWLEDGED' || comando.state === 'FAILED') {
        const jaTinhaSucesso = comando.state === 'ACKNOWLEDGED';

        // Mesmo resultado de novo: sucesso silencioso. Diferente: conflito.
        return { aplicado: jaTinhaSucesso === resultado.success, conflito: jaTinhaSucesso !== resultado.success };
      }

      const job = await tx.deviceSyncJob.findFirst({
        where: { idempotencyKey: comando.idempotencyKey },
      });

      await tx.deviceCommand.update({
        where: { id: comando.id },
        data: {
          state: resultado.success ? 'ACKNOWLEDGED' : 'FAILED',
          acknowledgedAt: agora,
        },
      });

      if (!job) return { aplicado: true, conflito: false };

      if (resultado.success) {
        await tx.deviceSyncJob.update({
          where: { id: job.id },
          data: {
            state: job.operation === 'DELETE' ? 'REMOVED' : 'SYNCED',
            attempts: { increment: 1 },
            lastAttemptAt: agora,
            errorCode: null,
          },
        });

        await tx.deviceUser.updateMany({
          where: { deviceId: job.deviceId, identityId: job.identityId },
          data:
            job.operation === 'DELETE'
              ? { state: 'REMOVED', removedAt: agora }
              : { state: 'SYNCED', syncedAt: agora },
        });

        await tx.device.update({
          where: { id: job.deviceId },
          data: { lastSyncAt: agora },
        });
      } else {
        const decisao = decidirRetentativa(
          job.attempts + 1,
          resultado.errorCode ?? 'UNKNOWN',
          agora,
        );

        await tx.deviceSyncJob.update({
          where: { id: job.id },
          data: {
            state: decisao.estado,
            attempts: { increment: 1 },
            lastAttemptAt: agora,
            // Codigo estavel, nunca a mensagem crua do SDK -- ela carrega
            // caminho de arquivo e, as vezes, dado do usuario.
            errorCode: resultado.errorCode ?? 'UNKNOWN',
            nextAttemptAt: decisao.estado === 'RETRYING' ? decisao.proximaTentativaEm : null,
          },
        });

        // Dead letter marca o cadastro como FAILED. Ele NAO some do painel:
        // sumir e o que faz a operacao descobrir o problema pelo aluno
        // reclamando na catraca.
        if (decisao.estado === 'FAILED') {
          await tx.deviceUser.updateMany({
            where: { deviceId: job.deviceId, identityId: job.identityId },
            data: { state: 'FAILED' },
          });
        }
      }

      return { aplicado: true, conflito: false };
    });
  }

  /**
   * Fecha a identidade quando nenhum dispositivo tem mais o cadastro.
   *
   * Roda apos cada resultado de DELETE. `FAILED` IMPEDE o fechamento de
   * proposito: a exclusao nao aconteceu naquele leitor, e declarar `DELETED`
   * esconderia biometria viva em equipamento que ninguem foi conferir
   * (INV-027).
   */
  async reconciliarExclusao(identityId: string, agora: Date): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const identidade = await tx.biometricIdentity.findUnique({
        where: { id: identityId },
        select: { tenantId: true, state: true, studentId: true },
      });

      if (!identidade || identidade.state !== 'DELETION_PENDING') return false;

      const pendentes = await tx.deviceUser.count({
        where: {
          identityId,
          state: { in: ['PENDING', 'SYNCED', 'REMOVAL_PENDING', 'FAILED'] },
        },
      });

      if (pendentes > 0) return false;

      await tx.biometricIdentity.update({
        where: { id: identityId },
        data: { state: 'DELETED', deletedAt: agora },
      });

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: identidade.tenantId,
          studentId: identidade.studentId,
          type: 'BIOMETRIC_IDENTITY_DELETED',
          actorType: 'SYSTEM',
          correlationId: `reconciliacao-${identityId}`,
          payload: {},
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: identidade.tenantId,
          actorType: 'SYSTEM',
          action: 'biometric.identity_deleted',
          target: 'biometric_identity',
          targetId: identityId,
          correlationId: `reconciliacao-${identityId}`,
          metadata: {},
        },
      });

      return true;
    });
  }

  /** Identidade de um comando, para a reconciliacao saber o que fechar. */
  async identidadeDoComando(commandId: string): Promise<string | null> {
    const comando = await this.db.deviceCommand.findUnique({
      where: { id: commandId },
      select: { payload: true },
    });

    const payload = comando?.payload as { identityId?: string } | null;

    return payload?.identityId ?? null;
  }
}
