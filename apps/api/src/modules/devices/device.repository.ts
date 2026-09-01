import { Injectable } from '@nestjs/common';
import type { Device } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export interface DadosDeDispositivo {
  gymUnitId: string;
  edgeNodeId?: string | undefined;
  kind: 'FACIAL_READER' | 'TURNSTILE';
  model: string;
  firmware?: string | undefined;
  serial: string;
}

/**
 * Inventario de dispositivos fisicos.
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003.
 */
@Injectable()
export class DeviceRepository {
  constructor(private readonly db: PrismaService) {}

  async criar(
    contexto: TenantContext,
    dados: DadosDeDispositivo,
    correlationId: string,
  ): Promise<Device> {
    return this.db.$transaction(async (tx) => {
      const dispositivo = await tx.device.create({
        data: {
          tenantId: contexto.tenantId,
          gymUnitId: dados.gymUnitId,
          edgeNodeId: dados.edgeNodeId ?? null,
          kind: dados.kind,
          model: dados.model,
          firmware: dados.firmware ?? null,
          serial: dados.serial,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'device.created',
          target: 'device',
          targetId: dispositivo.id,
          correlationId,
          // Serial e dado de inventario, nao segredo -- mas modelo e
          // firmware bastam para auditar sem repetir a identificacao fisica.
          metadata: { kind: dados.kind, model: dados.model },
        },
      });

      return dispositivo;
    });
  }

  async listar(
    contexto: TenantContext,
    filtro: { gymUnitId?: string | undefined; limite: number },
  ): Promise<Device[]> {
    return this.db.device.findMany({
      where: {
        tenantId: contexto.tenantId,
        ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: filtro.limite,
    });
  }

  async encontrar(contexto: TenantContext, id: string): Promise<Device | null> {
    return this.db.device.findFirst({ where: { id, tenantId: contexto.tenantId } });
  }

  /**
   * Dispositivos-alvo de uma unidade: os que recebem cadastro biometrico.
   *
   * Somente `FACIAL_READER` `ACTIVE`. Leitor em manutencao nao entra na lista
   * de alvos -- e o que impede a identidade de ficar eternamente "pendente
   * em todos os dispositivos" (INV-027) por causa de um equipamento
   * desligado para conserto.
   */
  async listarAlvosDeSync(contexto: TenantContext, gymUnitId: string): Promise<Device[]> {
    return this.db.device.findMany({
      where: {
        tenantId: contexto.tenantId,
        gymUnitId,
        kind: 'FACIAL_READER',
        status: 'ACTIVE',
      },
    });
  }

  async atualizar(
    contexto: TenantContext,
    id: string,
    dados: {
      status?: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED' | undefined;
      firmware?: string | undefined;
    },
    correlationId: string,
    /*
     * MOTIVO E DO ATO, NAO DO DISPOSITIVO -- separado de `dados` e sem
     * coluna. Aposentar e acao sensivel (DS-PAINEL.md §5.1): exige motivo, e
     * motivo que nao e gravado em lugar nenhum e teatro de auditoria. Mora
     * no `metadata` do `AuditLog`, que ja e `Json?`.
     */
    motivo?: string,
  ): Promise<Device | null> {
    return this.db.$transaction(async (tx) => {
      const alterados = await tx.device.updateMany({
        where: { id, tenantId: contexto.tenantId },
        data: {
          ...(dados.status ? { status: dados.status } : {}),
          ...(dados.firmware !== undefined ? { firmware: dados.firmware } : {}),
        },
      });

      if (alterados.count === 0) return null;

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'device.updated',
          target: 'device',
          targetId: id,
          correlationId,
          metadata: {
            status: dados.status ?? null,
            ...(motivo === undefined ? {} : { motivo }),
          },
        },
      });

      return tx.device.findFirstOrThrow({ where: { id, tenantId: contexto.tenantId } });
    });
  }

  /**
   * Proximo `external_user_id` do dispositivo.
   *
   * `MAX + 1` dentro da transacao do chamador. A unicidade real e da
   * constraint `(deviceId, externalUserId)` -- este metodo escolhe um
   * candidato, e a constraint e quem decide. Duas criacoes simultaneas fazem
   * a segunda falhar e retentar, que e o comportamento correto.
   */
  async proximoExternalUserId(deviceId: string): Promise<number> {
    const usados = await this.db.deviceUser.findMany({
      where: { deviceId },
      select: { externalUserId: true },
    });

    const maior = usados.reduce((maximo, { externalUserId }) => {
      const numero = Number(externalUserId);

      return Number.isInteger(numero) && numero > maximo ? numero : maximo;
    }, 0);

    return maior + 1;
  }
}
