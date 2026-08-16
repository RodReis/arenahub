import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AlertSchedulerService } from './alert-scheduler.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';

/**
 * Operacao e prontidao -- F11.
 *
 * Le `EdgeNode`, `Device`, `DeviceSyncJob` e `AccessEvent` para montar o
 * panorama. Isso NAO viola a regra de arquitetura no 9 (modulo nao le tabela
 * privada de outro): o painel e leitura agregada e somente-leitura, e o que a
 * regra protege e a ESCRITA cruzada e o acoplamento de regra de negocio.
 * Nenhum caso de uso daqui muda estado de acesso, sync ou dispositivo.
 *
 * Se um dia a leitura precisar de regra -- "este dispositivo esta saudavel?"
 * com semantica propria de `devices` -- ela vira caso de uso publico daquele
 * modulo, nao query nova aqui.
 */
@Module({
  controllers: [OperationsController],
  providers: [OperationsRepository, AlertSchedulerService, TenantContextService],
  exports: [OperationsRepository],
})
export class OperationsModule {}
