import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { EngagementModule } from '../engagement/engagement.module.js';
import { AlertSchedulerService } from './alert-scheduler.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardRepository } from './dashboard.repository.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';

/**
 * Operacao e prontidao -- F11. Dashboard operacional -- F57.
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
 *
 * O que existe de verdade e o `OperationalAlert`, que NAO e projecao: ele
 * guarda historico (quando comecou, quem reconheceu) que nao da para derivar
 * do estado atual.
 *
 * `EngagementModule` entra como IMPORT, e nao como query direta em
 * `RankingEntry`/`Challenge`: placar e desafio tem regra propria (exposicao,
 * status, coorte minima), e ali a regra 9 vale integralmente -- o dashboard
 * consome `EngagementRankingService` e `EngagementChallengesService` como
 * caso de uso publico, exatamente como o KioskModule ja faz.
 */
@Module({
  imports: [EngagementModule],
  controllers: [OperationsController, DashboardController],
  providers: [
    OperationsRepository,
    DashboardRepository,
    AlertSchedulerService,
    TenantContextService,
  ],
  exports: [OperationsRepository],
})
export class OperationsModule {}
