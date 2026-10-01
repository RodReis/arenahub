import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DeviceRepository } from './device.repository.js';
import { DeviceReaderNumberRepository } from './device-reader-number.repository.js';
import { DevicesController } from './devices.controller.js';

/**
 * Inventario de dispositivos fisicos.
 *
 * Exporta os repositorios porque `biometrics` precisa da lista de alvos de
 * sync e do registro de numeros do leitor -- por provider publico, nunca
 * lendo `db.device`/`db.deviceReaderNumber` de outro modulo (regra de
 * arquitetura no 9).
 */
@Module({
  controllers: [DevicesController],
  providers: [DeviceRepository, DeviceReaderNumberRepository, TenantContextService],
  exports: [DeviceRepository, DeviceReaderNumberRepository],
})
export class DevicesModule {}
