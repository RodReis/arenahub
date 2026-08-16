import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DeviceRepository } from './device.repository.js';
import { DevicesController } from './devices.controller.js';

/**
 * Inventario de dispositivos fisicos.
 *
 * Exporta o repositorio porque `biometrics` precisa da lista de alvos de
 * sync -- por provider publico, nunca lendo `db.device` de outro modulo
 * (regra de arquitetura no 9).
 */
@Module({
  controllers: [DevicesController],
  providers: [DeviceRepository, TenantContextService],
  exports: [DeviceRepository],
})
export class DevicesModule {}
