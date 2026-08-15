import { Module } from '@nestjs/common';

import { carregarConfig } from '../../config/env.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionRepository } from './session.repository.js';
import { CONFIG_DE_TOKEN, TokenService } from './token.service.js';

@Module({
  imports: [PersistenceModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionRepository,
    TokenService,
    {
      provide: CONFIG_DE_TOKEN,
      useFactory: () => carregarConfig().jwt,
    },
  ],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
