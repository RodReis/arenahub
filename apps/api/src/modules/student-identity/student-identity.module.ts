import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EmailDeAtivacaoService } from './email-de-ativacao.service.js';
import { StudentAccountRepository } from './student-account.repository.js';
import { StudentAuthController } from './student-auth.controller.js';
import { StudentIdentityService } from './student-identity.service.js';
import { StudentSessionGuard } from './student-session.guard.js';
import { StudentSessionRepository } from './student-session.repository.js';
import { StudentSessionsController } from './student-sessions.controller.js';

/**
 * Identidade do ALUNO no aplicativo -- F23.
 *
 * Importa o `AuthModule` para reusar `PasswordService` e `TokenService` em vez
 * de instanciar copias: a politica de hash e a chave de assinatura sao as
 * mesmas do painel, e duas implementacoes divergiriam na primeira rotacao de
 * chave.
 */
@Module({
  imports: [AuthModule],
  controllers: [StudentAuthController, StudentSessionsController],
  providers: [
    StudentAccountRepository,
    StudentSessionRepository,
    StudentIdentityService,
    EmailDeAtivacaoService,
    StudentSessionGuard,
  ],
  exports: [StudentIdentityService, StudentSessionGuard, StudentSessionRepository],
})
export class StudentIdentityModule {}
