import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { TeamController } from './team.controller.js';
import { TeamRepository } from './team.repository.js';

@Module({
  controllers: [TeamController],
  providers: [TeamRepository, TenantContextService],
  // Exportado porque `students` reusa a MESMA troca de profile (F82): e a
  // mesma tabela, e o endpoint espelho em `/students/:id/profile` nao pode
  // reimplementar a escrita por conta propria (regra de arquitetura 9 --
  // "modulo nao le tabela privada de outro modulo" nao se aplica aqui porque
  // ambos leem `Student`, mas a ESCRITA continua morando num lugar so).
  exports: [TeamRepository],
})
export class TeamModule {}
