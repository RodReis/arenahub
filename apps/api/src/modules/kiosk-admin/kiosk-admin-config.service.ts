import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CONFIG_PADRAO_DO_TOTEM,
  resolverConfig,
  kioskConfigSchema,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

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
        data: { payload: config },
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
        payload: config,
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
          payload: rascunho.payload as unknown as object,
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
