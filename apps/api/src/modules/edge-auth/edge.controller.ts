import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { PrismaService } from '../../persistence/prisma.service.js';
import { EdgeRoute } from './edge-route.decorator.js';

/**
 * Heartbeat do Edge.
 *
 * `.strict()` e deliberado: `tenantId` ou `gymUnitId` no corpo sao
 * RECUSADOS, nao ignorados. A identidade vem da credencial assinada (regra
 * de arquitetura no 2) -- aceitar os campos, mesmo que so para conferir,
 * criaria a duvida sobre qual dos dois vale.
 */
const esquemaDeHeartbeat = z
  .object({
    agentVersion: z.string().min(1).max(40),
    /** Relogio local do Edge, em ms desde a epoca. */
    localTimeMs: z.number().int().positive(),
    queueDepth: z.number().int().min(0).max(1_000_000),
    devices: z
      .array(
        z
          .object({
            serial: z.string().min(1).max(80),
            model: z.string().min(1).max(80),
            firmware: z.string().max(40).optional(),
            status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']),
            lastSyncAt: z.string().datetime().optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();

interface RespostaDeHeartbeat {
  /** Relogio do servidor, para o Edge medir a propria deriva. */
  serverTime: string;
  /** Deriva observada, em ms. Positivo: relogio do Edge adiantado. */
  clockOffsetMs: number;
  acknowledgedDevices: number;
}

@Controller('api/v1/edge')
export class EdgeController {
  constructor(private readonly db: PrismaService) {}

  /**
   * Sinal de vida do Edge, com estado dos dispositivos (INV-028).
   *
   * A ausencia do Edge e alerta operacional obrigatorio (INV-146): sem
   * operacao offline, Edge fora significa catraca parada, e a operacao
   * precisa saber no minuto em que acontece. Este endpoint e o que alimenta
   * esse alerta.
   */
  @Post('heartbeat')
  @EdgeRoute()
  async heartbeat(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<RespostaDeHeartbeat> {
    const dados = esquemaDeHeartbeat.parse(corpo);

    // Garantido pelo guard: rota marcada sem contexto nao chega aqui.
    const edge = requisicao.edgeContext!;

    const agora = new Date();
    const deriva = dados.localTimeMs - agora.getTime();

    await this.db.edgeNode.update({
      where: { id: edge.edgeNodeId },
      data: {
        agentVersion: dados.agentVersion,
        lastHeartbeat: agora,
        // Relogio torto e causa comum de 401 em campo; sem registrar a
        // deriva, vira caca ao fantasma.
        clockOffsetMs: deriva,
      },
    });

    let reconhecidos = 0;

    for (const dispositivo of dados.devices) {
      // `updateMany` com tenant no filtro: um Edge nao atualiza dispositivo
      // de outra academia nem mandando o serial certo.
      const alterados = await this.db.device.updateMany({
        where: {
          tenantId: edge.tenantId,
          gymUnitId: edge.gymUnitId,
          serial: dispositivo.serial,
        },
        data: {
          model: dispositivo.model,
          firmware: dispositivo.firmware ?? null,
          status: dispositivo.status,
          lastHeartbeat: agora,
          ...(dispositivo.lastSyncAt ? { lastSyncAt: new Date(dispositivo.lastSyncAt) } : {}),
        },
      });

      reconhecidos += alterados.count;
    }

    return {
      serverTime: agora.toISOString(),
      clockOffsetMs: deriva,
      acknowledgedDevices: reconhecidos,
    };
  }
}
