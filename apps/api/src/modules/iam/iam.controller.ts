import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
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

/*
 * MINIMO DE 8 -- decisao do PI em 05/09/2026 (issue #281), olhando a tela de
 * aceite em producao: os 12 anteriores nao vinham de requisito nenhum (nao ha
 * NFR, ADR nem linha de PRD sobre tamanho de senha), eram escolha do codigo
 * feita quando a rota nasceu.
 *
 * A REGRA VIVE AQUI, e a tela a espelha para dar a frase certa sem
 * round-trip. Mudou aqui, muda em `apps/admin-web/app/actions/usuarios.ts` e
 * na dica do formulario de aceite -- os tres numeros sao o mesmo numero.
 *
 * O LOGIN CONTINUA SEM VALIDAR TAMANHO (`min(1)`), tambem por decisao do PI:
 * ele so confere a senha contra o hash, e exigir tamanho la trancaria para
 * fora quem ja tem senha menor -- sem tela de recuperacao no produto, isso
 * seria irreversivel pelo painel.
 */
const esquemaDeAceite = z
  .object({
    token: z.string().min(1).max(512),
    password: z.string().min(8).max(1024),
  })
  .strict();

const esquemaDeCodigo = z.object({ code: z.string().length(6) }).strict();

/*
 * Schema de resposta de `GET /roles` -- declarado, e nao adicionado a
 * `OPERACOES_SEM_SCHEMA_DE_RESPOSTA`: aquela lista e divida herdada e so pode
 * ENCOLHER (ver `openapi-divida-de-schema.ts`).
 *
 * Objeto simples SEM `as const`: com ele, `required` vira `readonly string[]`
 * e o `SchemaObject` do Swagger recusa (`string[]`), e o tipo so e exportado
 * de um caminho interno do pacote.
 */
const ESQUEMA_DO_PAPEL = {
  type: 'object',
  required: ['id', 'name', 'isSystem'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    isSystem: { type: 'boolean' },
  },
};

const ESQUEMA_DA_LISTA_DE_PAPEIS = { type: 'array', items: ESQUEMA_DO_PAPEL };

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

  /**
   * Papeis do tenant -- issue #274.
   *
   * A tela de convite precisa escolher UM, e ate aqui nao havia como
   * lista-los: o `POST /users/invitations` exige `roleId`, e quem chamava
   * tinha de descobrir o UUID por fora (consulta ao banco, na pratica).
   *
   * `user.manage`, a mesma permissao do convite: quem nao pode convidar nao
   * tem o que fazer com a lista de papeis.
   *
   * DTO explicito -- `select` e nao o objeto inteiro, pelo mesmo motivo do
   * `GET /users` acima. `isSystem` sai porque a tela usa: o papel de sistema
   * (`OWNER`) nao pode ser editado nem apagado, e a interface precisa saber
   * disso antes de oferecer a acao.
   */
  @Get('roles')
  @RequirePermissions('user.manage')
  @ApiOkResponse({ schema: ESQUEMA_DA_LISTA_DE_PAPEIS })
  async listarPapeis(): Promise<Array<{ id: string; name: string; isSystem: boolean }>> {
    return this.db.role.findMany({
      where: { tenantId: this.contexto.require().tenantId },
      select: { id: true, name: true, isSystem: true },
      orderBy: { name: 'asc' },
    });
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
