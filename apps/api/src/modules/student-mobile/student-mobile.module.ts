import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { StudentIdentityModule } from '../student-identity/student-identity.module.js';
import { MobileHomeController } from './mobile-home.controller.js';
import { MobileHomeService } from './mobile-home.service.js';

/**
 * O que o APP LE -- separado do modulo de identidade, que cuida de quem o
 * aluno e.
 *
 * As Slices 4.2 a 4.4 penduram aqui carteirinha, financeiro e avaliacoes. Por
 * enquanto so a Home.
 *
 * Importa `StudentIdentityModule` pelo `StudentSessionGuard`, e `AuthModule`
 * porque o guard depende do `TokenService`.
 */
@Module({
  imports: [AuthModule, StudentIdentityModule],
  controllers: [MobileHomeController],
  providers: [MobileHomeService],
})
export class StudentMobileModule {}
