import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { Public } from '../../common/security/public.decorator.js';
import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { MfaService } from '../auth/mfa.service.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { InvitationService } from './invitation.service.js';

const esquemaDeConvite = z
  .object({
    email: z.string().email().max(320),
    roleId: z.string().uuid(),
    gymUnitId: z.string().uuid().optional(),
  })
  .strict();

const esquemaDeAceite = z
  .object({
    token: z.string().min(1).max(512),
    password: z.string().min(12).max(1024),
  })
  .strict();

const esquemaDeCodigo = z.object({ code: z.string().length(6) }).strict();

@Controller('api/v1')
export class IamController {
  constructor(
    private readonly convites: InvitationService,
    private readonly mfa: MfaService,
    private readonly contexto: TenantContextService,
    private readonly db: PrismaService,
  ) {}

  @Post('users/invitations')
  @RequirePermissions('user.manage')
  async convidar(@Body() corpo: unknown, @Req() requisicao: Request) {
    const dados = esquemaDeConvite.parse(corpo);

    const { convite, token } = await this.convites.convidar(
      this.contexto.require(),
      dados,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    // O token aparece UMA VEZ. Depois disso nem o suporte recupera -- o
    // banco so tem o hash.
    return { id: convite.id, expiresAt: convite.expiresAt, token };
  }

  @Public()
  @Post('users/invitations/accept')
  @HttpCode(200)
  async aceitar(@Body() corpo: unknown, @Req() requisicao: Request) {
    // Publica de proposito: quem aceita convite ainda nao tem conta.
    const dados = esquemaDeAceite.parse(corpo);

    await this.convites.aceitar(
      dados.token,
      dados.password,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {};
  }

  @Get('users')
  @RequirePermissions('user.manage')
  // Tipo anotado a mao: o inferido pelo Prisma nao e nomeavel de fora do
  // pacote (TS2742). Tambem serve de DTO explicito -- so estes quatro
  // campos saem.
  async listar(): Promise<
    Array<{ id: string; email: string; status: string; mfaStatus: string }>
  > {
    const contexto = this.contexto.require();

    const vinculos = await this.db.tenantMembership.findMany({
      where: { tenantId: contexto.tenantId },
      // `select` explicito: sem ele o objeto traria `passwordHash` e os
      // campos de MFA para uma resposta HTTP.
      select: { user: { select: { id: true, email: true, status: true, mfaStatus: true } } },
    });

    return vinculos.map((v) => v.user);
  }

  @Post('auth/mfa/setup')
  async iniciarMfa() {
    const contexto = this.contexto.require();

    const usuario = await this.db.user.findUniqueOrThrow({
      where: { id: contexto.actorId },
      select: { email: true },
    });

    return this.mfa.iniciarInscricao(contexto.actorId, usuario.email);
  }

  @Post('auth/mfa/confirm')
  @HttpCode(204)
  async confirmarMfa(@Body() corpo: unknown) {
    const dados = esquemaDeCodigo.parse(corpo);

    await this.mfa.confirmarInscricao(this.contexto.require().actorId, dados.code);
  }
}
