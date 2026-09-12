import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { HealthModule } from '../health/health.module.js';
import { StudentIdentityModule } from '../student-identity/student-identity.module.js';
import { MobileFrequenciaController } from './mobile-frequencia.controller.js';
import { MobileFrequenciaService } from './mobile-frequencia.service.js';
import { MobileHomeController } from './mobile-home.controller.js';
import { MobileHomeService } from './mobile-home.service.js';
import { MobilePlanoController } from './mobile-plano.controller.js';
import { MobilePlanoService } from './mobile-plano.service.js';

/**
 * O que o APP LE -- separado do modulo de identidade, que cuida de quem o
 * aluno e.
 *
 * A Slice 4.3 pendura aqui o financeiro e a 4.4 as avaliacoes. A 4.2 entrou
 * SEM carteirinha e sem QR: foram cortados por decisao do PI em 12/09/2026, e
 * voltam quando ele decidir quem escaneia o QR.
 *
 * Importa `StudentIdentityModule` pelo `StudentSessionGuard`, `AuthModule`
 * porque o guard depende do `TokenService`, e `HealthModule` pelo
 * `AttendanceService` -- a frequencia e derivada la desde a F18, e este
 * modulo so a traduz para o app (`M4-FR-008`).
 */
@Module({
  imports: [AuthModule, StudentIdentityModule, HealthModule],
  controllers: [MobileHomeController, MobilePlanoController, MobileFrequenciaController],
  providers: [MobileHomeService, MobilePlanoService, MobileFrequenciaService],
})
export class StudentMobileModule {}
