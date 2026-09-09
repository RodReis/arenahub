import { Module } from '@nestjs/common';

import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { IamController } from './iam.controller.js';
import { EmailDeConviteService } from './email-de-convite.service.js';
import { InvitationService } from './invitation.service.js';
import { MembershipRepository } from './membership.repository.js';

@Module({
  imports: [AuthModule],
  controllers: [IamController],
  providers: [
    InvitationService,
    // Envio do convite por e-mail (issue #277). Sem `RESEND_API_KEY` ele
    // nao envia e nao quebra -- ver o proprio servico.
    EmailDeConviteService,
    MembershipRepository,
    TenantContextService,
  ],
  // `MembershipRepository`: exportado para o `students` validar o consultor
  // responsavel por caso de uso publico, e nao lendo `tenant_memberships`
  // direto (regra no 9).
  //
  // `EmailDeConviteService`: exportado para o `platform` mandar o convite do
  // OWNER no tenant recem-criado. UM servico de envio de convite, nao dois --
  // duplicar o corpo do e-mail faria as duas telas divergirem calado.
  exports: [MembershipRepository, EmailDeConviteService],
})
export class IamModule {}
