import { Controller, Get, Query } from '@nestjs/common';
import type { DeviceSyncJob } from '@arenahub/database';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DeviceSyncRepository } from './device-sync.repository.js';
import { acaoRecomendada } from './domain/retentativa.js';

/**
 * Job de sync como a operacao ve.
 *
 * NUNCA carrega foto, template nem chave de objeto (INV-022): o painel
 * precisa saber o que falhou e o que fazer, nao o conteudo biometrico.
 */
interface JobDto {
  id: string;
  deviceId: string;
  identityId: string;
  operation: string;
  state: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  errorCode: string | null;
  /** Frase acionavel para a recepcao. */
  recommendedAction: string | null;
}

@Controller('api/v1/device-sync-jobs')
export class DeviceSyncController {
  constructor(
    private readonly sync: DeviceSyncRepository,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Painel de pendencia.
   *
   * Job em dead letter (`FAILED`) aparece aqui como qualquer outro -- sumir
   * e o que faz a operacao descobrir o problema pelo aluno reclamando na
   * catraca.
   */
  @Get()
  @RequirePermissions('device.read')
  async listar(
    @Query('deviceId') deviceId?: string,
    @Query('identityId') identityId?: string,
    @Query('state') state?: string,
    @Query('limit') limite?: string,
    @Query('cursor') cursor?: string,
  ): Promise<JobDto[]> {
    const take = Math.min(Number(limite) || 50, 100);

    const jobs = await this.sync.listarJobs(this.contexto.require(), {
      deviceId,
      identityId,
      state,
      limite: take,
      cursor,
    });

    return jobs.map((job) => this.paraDto(job));
  }

  private paraDto(job: DeviceSyncJob): JobDto {
    return {
      id: job.id,
      deviceId: job.deviceId,
      identityId: job.identityId,
      operation: job.operation,
      state: job.state,
      attempts: job.attempts,
      lastAttemptAt: job.lastAttemptAt?.toISOString() ?? null,
      nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
      errorCode: job.errorCode,
      recommendedAction: acaoRecomendada(job.errorCode),
    };
  }
}
