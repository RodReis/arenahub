import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { HealthModule } from '../health/health.module.js';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { StudentIdentityModule } from '../student-identity/student-identity.module.js';
import { MobileAvaliacoesController } from './mobile-avaliacoes.controller.js';
import { MobileAvaliacoesService } from './mobile-avaliacoes.service.js';
import { MobileConsentimentosController } from './mobile-consentimentos.controller.js';
import { MobileConsentimentosService } from './mobile-consentimentos.service.js';
import { MobileExportacoesController } from './mobile-exportacoes.controller.js';
import { MobileFinanceiroController } from './mobile-financeiro.controller.js';
import { MobileFinanceiroService } from './mobile-financeiro.service.js';
import { MobileFrequenciaController } from './mobile-frequencia.controller.js';
import { MobileFrequenciaService } from './mobile-frequencia.service.js';
import { PoliticaDeCanalService } from './politica-de-canal.service.js';
import { MobileAvisosController } from './mobile-avisos.controller.js';
import { MobileAvisosService } from './mobile-avisos.service.js';
import { FakePushProviderAdapter } from './provider/fake-push-provider.adapter.js';
import { PUSH_PROVIDER } from './provider/push-provider.port.js';
import { MobileHomeController } from './mobile-home.controller.js';
import { MobileHomeService } from './mobile-home.service.js';
import { MobilePlanoController } from './mobile-plano.controller.js';
import { MobilePlanoService } from './mobile-plano.service.js';

/**
 * O que o APP LE -- separado do modulo de identidade, que cuida de quem o
 * aluno e.
 *
 * A Slice 4.3 (F25) pendurou aqui o financeiro e a 4.4 (F26) as avaliacoes,
 * os consentimentos e a exportacao do historico. A 4.2
 * entrou SEM carteirinha e sem QR: foram cortados por decisao do PI em
 * 12/09/2026, e voltam quando ele decidir quem escaneia o QR.
 *
 * Importa `StudentIdentityModule` pelo `StudentSessionGuard`, `AuthModule`
 * porque o guard depende do `TokenService`, `HealthModule` pelo
 * `AttendanceService` -- a frequencia e derivada la desde a F18, e este
 * modulo so a traduz para o app (`M4-FR-008`) --, e `BillingModule` pelos
 * casos de uso de PIX/checkout/tentativa/recibo que a F25 reusa (regra de
 * arquitetura no 9: nunca a tabela do outro modulo).
 */
@Module({
  imports: [AuthModule, StudentIdentityModule, HealthModule, BillingModule, PrivacyModule],
  controllers: [
    MobileHomeController,
    MobilePlanoController,
    MobileFrequenciaController,
    MobileFinanceiroController,
    MobileAvaliacoesController,
    MobileConsentimentosController,
    MobileExportacoesController,
    MobileAvisosController,
  ],
  providers: [
    MobileHomeService,
    MobilePlanoService,
    MobileFrequenciaService,
    MobileFinanceiroService,
    MobileAvaliacoesService,
    MobileConsentimentosService,
    MobileAvisosService,
    PoliticaDeCanalService,
    FakePushProviderAdapter,
    /**
     * Real com credencial, dublê sem ela -- mesmo criterio de `AI_PROVIDER` e
     * `DOCUMENT_EXTRACTOR`. O adapter do OneSignal (provedor escolhido pelo PI
     * em 14/09/2026) entra quando as credenciais existirem; ate la o dublê
     * atende, e `PUSH_NOTIFICATIONS` fica desligado.
     *
     * Sem provedor o aluno NAO perde aviso: a caixa interna e a entrega, e
     * push e so um atalho ate ela.
     */
    { provide: PUSH_PROVIDER, useExisting: FakePushProviderAdapter },
  ],
})
export class StudentMobileModule {}
