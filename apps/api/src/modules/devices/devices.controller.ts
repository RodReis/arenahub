import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Device } from '@arenahub/database';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DeviceRepository } from './device.repository.js';
import { verificarHomologacao } from './domain/hardware-homologado.js';

// `.strict()`: `tenantId` no corpo e RECUSADO. O tenant vem da identidade
// autenticada (regra de arquitetura no 2).
const esquemaDeCriacao = z
  .object({
    gymUnitId: z.string().uuid(),
    edgeNodeId: z.string().uuid().optional(),
    kind: z.enum(['FACIAL_READER', 'TURNSTILE']),
    model: z.string().min(2).max(80),
    firmware: z.string().max(40).optional(),
    serial: z.string().min(1).max(80),
  })
  .strict();

const esquemaDeAtualizacao = z
  .object({
    status: z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED']).optional(),
    firmware: z.string().max(40).optional(),
  })
  .strict();

interface DispositivoDto {
  id: string;
  gymUnitId: string;
  edgeNodeId: string | null;
  kind: string;
  model: string;
  firmware: string | null;
  serial: string;
  status: string;
  lastHeartbeat: string | null;
  lastSyncAt: string | null;
}

@Controller('api/v1/devices')
export class DevicesController {
  constructor(
    private readonly dispositivos: DeviceRepository,
    private readonly contexto: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions('device.read')
  async listar(
    @Query('gymUnitId') gymUnitId?: string,
    @Query('limit') limite?: string,
  ): Promise<DispositivoDto[]> {
    const take = Math.min(Number(limite) || 50, 100);

    const encontrados = await this.dispositivos.listar(this.contexto.require(), {
      gymUnitId,
      limite: take,
    });

    return encontrados.map((d) => this.paraDto(d));
  }

  @Get(':id')
  @RequirePermissions('device.read')
  async detalhar(@Param('id') id: string): Promise<DispositivoDto> {
    const dispositivo = await this.dispositivos.encontrar(this.contexto.require(), id);

    if (!dispositivo) throw new NotFoundException({ code: 'DEVICE_NOT_FOUND' });

    return this.paraDto(dispositivo);
  }

  /**
   * Cadastra dispositivo.
   *
   * Hardware nao homologado responde `DEVICE_UNSUPPORTED_HARDWARE`, nunca
   * 500: quem esta instalando precisa saber que o modelo nao passou pela
   * bancada, e nao que "deu erro no servidor".
   */
  @Post()
  @RequirePermissions('device.manage')
  async criar(@Body() corpo: unknown, @Req() requisicao: Request): Promise<DispositivoDto> {
    const dados = esquemaDeCriacao.parse(corpo);

    const homologacao = verificarHomologacao(dados);

    if (!homologacao.homologado) {
      throw new BadRequestException({ code: homologacao.motivo });
    }

    const dispositivo = await this.dispositivos.criar(
      this.contexto.require(),
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return this.paraDto(dispositivo);
  }

  @Patch(':id')
  @RequirePermissions('device.manage')
  async atualizar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<DispositivoDto> {
    const dados = esquemaDeAtualizacao.parse(corpo);

    const dispositivo = await this.dispositivos.atualizar(
      this.contexto.require(),
      id,
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    if (!dispositivo) throw new NotFoundException({ code: 'DEVICE_NOT_FOUND' });

    return this.paraDto(dispositivo);
  }

  private paraDto(dispositivo: Device): DispositivoDto {
    return {
      id: dispositivo.id,
      gymUnitId: dispositivo.gymUnitId,
      edgeNodeId: dispositivo.edgeNodeId,
      kind: dispositivo.kind,
      model: dispositivo.model,
      firmware: dispositivo.firmware,
      serial: dispositivo.serial,
      status: dispositivo.status,
      lastHeartbeat: dispositivo.lastHeartbeat?.toISOString() ?? null,
      lastSyncAt: dispositivo.lastSyncAt?.toISOString() ?? null,
    };
  }
}
