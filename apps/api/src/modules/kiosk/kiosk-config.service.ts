import { Injectable } from '@nestjs/common';
import { resolverConfig, type KioskConfig } from '@arenahub/api-contracts';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';

export interface ConfiguracaoResolvida {
  readonly version: number;
  readonly config: KioskConfig;
}

/** Dados que o proprio totem informa no heartbeat. */
export interface DadosDoHeartbeat {
  readonly agentVersion: string;
  /** Relogio local do totem em ms. Zero significa "nao informado". */
  readonly localTimeMs: number;
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

    const daCamada = (gymUnitId: string | null, kioskDeviceId: string | null): unknown =>
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

  /**
   * Carimba o heartbeat do dispositivo. Fica no servico (nao no controller)
   * porque controller so valida e delega -- nao fala com banco (convencao do
   * projeto, `CLAUDE.md`).
   */
  async registrarHeartbeat(
    contexto: ContextoDoKiosk,
    dados: DadosDoHeartbeat,
    agora: Date,
  ): Promise<void> {
    await this.db.kioskDevice.update({
      where: { id: contexto.kioskDeviceId },
      data: {
        lastHeartbeat: agora,
        agentVersion: dados.agentVersion,
        clockOffsetMs: dados.localTimeMs === 0 ? null : dados.localTimeMs - agora.getTime(),
      },
    });
  }
}
