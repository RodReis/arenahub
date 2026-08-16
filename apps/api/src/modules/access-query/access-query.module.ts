import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AccessQueryController } from './access-query.controller.js';
import { AccessQueryRepository } from './access-query.repository.js';

/**
 * Consulta de eventos -- F11.
 *
 * Separado do modulo `access` de proposito: la e ESCRITA de decisao, no
 * caminho critico da catraca; aqui e LEITURA para investigacao. Juntar os
 * dois faria uma consulta pesada do painel dividir modulo com o codigo que
 * precisa responder em milissegundos.
 */
@Module({
  controllers: [AccessQueryController],
  providers: [AccessQueryRepository, TenantContextService],
  exports: [AccessQueryRepository],
})
export class AccessQueryModule {}
