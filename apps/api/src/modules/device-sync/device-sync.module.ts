import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { DeviceSyncController } from './device-sync.controller.js';
import { DeviceSyncRepository } from './device-sync.repository.js';
import { EdgeCommandsController } from './edge-commands.controller.js';

/**
 * Fila de sincronizacao e protocolo de comandos do Edge.
 *
 * Dois controllers com publicos opostos: `DeviceSyncController` atende a
 * operacao (cookie + permissao) e `EdgeCommandsController` atende o agente
 * (assinatura HMAC). Separados porque a autenticacao e diferente, e
 * misturar os dois num controller so faria a rota nova herdar o guard
 * errado por descuido.
 */
@Module({
  controllers: [DeviceSyncController, EdgeCommandsController],
  providers: [DeviceSyncRepository, TenantContextService],
  exports: [DeviceSyncRepository],
})
export class DeviceSyncModule {}
