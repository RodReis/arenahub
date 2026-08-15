import { Module } from '@nestjs/common';

import { carregarConfig, type ConfigDaApi } from '../../config/env.js';
import { PersistenceModule } from '../../persistence/persistence.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CIFRADOR_DE_MFA, MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { CifradorDeSegredo } from './segredo-cifrado.js';
import { SessionRepository } from './session.repository.js';
import { CONFIG_DE_TOKEN, TokenService } from './token.service.js';
import { TotpService } from './totp.service.js';

const CONFIG_DA_API = Symbol('CONFIG_DA_API');

@Module({
  imports: [PersistenceModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionRepository,
    TokenService,
    TotpService,
    MfaService,
    // UMA carga so de config, compartilhada. Chamar `carregarConfig()` em
    // cada factory geraria pares RSA e chaves de MFA DIFERENTES fora de
    // producao -- o token emitido por um provider nao seria verificavel
    // pelo outro, e o bug so apareceria em runtime.
    { provide: CONFIG_DA_API, useFactory: () => carregarConfig() },
    {
      provide: CONFIG_DE_TOKEN,
      inject: [CONFIG_DA_API],
      useFactory: (config: ConfigDaApi) => config.jwt,
    },
    {
      provide: CIFRADOR_DE_MFA,
      inject: [CONFIG_DA_API],
      useFactory: (config: ConfigDaApi) => new CifradorDeSegredo(config.mfa.chave),
    },
  ],
  exports: [PasswordService, TokenService, TotpService, MfaService],
})
export class AuthModule {}
