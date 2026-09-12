import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSOES_DO_OWNER } from '@arenahub/database';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { COOKIE_DE_ACESSO, lerCookie } from '../../modules/auth/cookies.js';
import { TokenService } from '../../modules/auth/token.service.js';
import type { PlatformContext } from '../platform/platform-context.js';
import type { TenantContext } from '../tenant/tenant-context.js';
import { ROTA_PUBLICA } from './public.decorator.js';

/**
 * Valida a credencial e monta o `TenantContext` da requisicao.
 *
 * GLOBAL de proposito: o padrao e "protegido", e liberar exige `@Public()`
 * explicito. Proteger rota a rota transformaria cada rota nova numa chance
 * de esquecer -- e esquecer, aqui, e expor dado de aluno.
 *
 * O `tenantId` sai do TOKEN, nunca da requisicao. E aqui que a regra de
 * arquitetura no 2 deixa de ser recomendacao e vira mecanismo.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: PrismaService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publica = this.reflector.getAllAndOverride<boolean>(ROTA_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (publica) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();
    const token = lerCookie(requisicao.headers.cookie, COOKIE_DE_ACESSO);

    if (!token) throw new NaoAutenticadoError();

    try {
      const claims = this.tokens.verificarAcesso(token);

      /*
       * Token do APP DO ALUNO nao abre rota de painel (F23).
       *
       * Os dois canais sao assinados pela MESMA chave, entao a verificacao de
       * assinatura aprova ambos -- sem esta checagem, o unico obstaculo seria
       * o transporte (o app manda por header, o painel le cookie), e isso e
       * acidente, nao garantia. Basta alguem passar a aceitar `Authorization`
       * aqui, ou o app gravar um cookie, para um token sem permissao nenhuma
       * atravessar o guard e cair no caminho de papeis.
       *
       * Ausente = PAINEL, por compatibilidade com token emitido antes da F23.
       */
      if (claims.canal === 'MOBILE') throw new NaoAutenticadoError();

      // Token SEM tenant = sessao de plataforma. E o unico caminho em que
      // nao existe `TenantContext`, e toda rota de tenant o rejeita.
      if (claims.tenantId === null || claims.tenantId === undefined) {
        requisicao.platformContext = await this.montarContextoDePlataforma(claims.sub, claims);
      } else {
        requisicao.tenantContext = await this.montarContexto(
          claims.sub,
          claims.tenantId,
          claims,
          requisicao,
        );
      }
    } catch (erro) {
      // "Elevacao expirada" e 403 e nao 401: a credencial vale, o que acabou
      // foi a autorizacao de entrar naquele tenant. Sem este repasse, o
      // `ForbiddenException` nascido aqui dentro viraria 401 calado.
      if (erro instanceof ForbiddenException) throw erro;

      // Token invalido, expirado, de outro tipo ou sessao revogada dao a
      // mesma resposta: quem sonda nao aprende qual dos casos ocorreu.
      throw new NaoAutenticadoError();
    }

    return true;
  }

  /**
   * Le permissoes do BANCO, nao do token.
   *
   * O access token vale dez minutos. Ler dele faria uma permissao revogada
   * continuar valendo por ate dez minutos -- e revogacao de acesso e
   * justamente o caso em que a demora importa.
   */
  private async montarContexto(
    userId: string,
    tenantId: string,
    claims: { sessionId: string },
    requisicao: Request,
  ): Promise<TenantContext> {
    const deSuporte = await this.montarElevacao(userId, tenantId, claims.sessionId, requisicao);

    if (deSuporte) return deSuporte;

    const papeis = await this.db.userRole.findMany({
      where: { userId, tenantId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const permissions = new Set<string>();
    const unidades = new Set<string>();
    let valeNoTenantInteiro = false;

    for (const atribuicao of papeis) {
      for (const ligacao of atribuicao.role.permissions) {
        permissions.add(ligacao.permission.code);
      }

      // `gymUnitId` nulo = papel vale no tenant inteiro.
      if (atribuicao.gymUnitId === null) valeNoTenantInteiro = true;
      else unidades.add(atribuicao.gymUnitId);
    }

    return {
      tenantId,
      actorId: userId,
      sessionId: claims.sessionId,
      permissions,
      allowedUnitIds: valeNoTenantInteiro ? 'ALL' : unidades,
    };
  }

  /**
   * Super Admin operando DENTRO de um tenant -- so vale com elevacao VIVA.
   *
   * Devolve `undefined` para todo mundo que nao e ator de plataforma, e ai o
   * caminho normal de papeis por tenant segue intocado. Quem tem
   * `TenantMembership` no tenant e usuario de verdade dele e tambem passa
   * direto: um Super Admin que por acaso e aluno da academia entra como
   * aluno, sem elevacao.
   */
  private async montarElevacao(
    userId: string,
    tenantId: string,
    sessionId: string,
    requisicao: Request,
  ): Promise<TenantContext | undefined> {
    const admin = await this.db.platformAdmin.findFirst({ where: { userId, revokedAt: null } });

    if (!admin) return undefined;

    const membro = await this.db.tenantMembership.findFirst({
      where: { userId, tenantId, status: 'ACTIVE' },
    });

    if (membro) return undefined;

    const elevacao = await this.db.supportElevation.findFirst({
      where: { sessionId, tenantId, endedAt: null, expiresAt: { gt: new Date() } },
    });

    // 403 e nao 401: a credencial vale, o que falta e a autorizacao de entrar
    // neste tenant. Este erro escapa do `catch` do `canActivate` de proposito.
    if (!elevacao) throw new ForbiddenException({ code: 'ELEVATION_REQUIRED' });

    // A rota de encerrar a elevacao mora no `PlatformController`, e o token
    // desta requisicao ja carrega tenant. Sem o contexto de plataforma aqui,
    // o `PlatformGuard` recusaria quem esta legitimamente elevado.
    requisicao.platformContext = { actorId: userId, sessionId, platformAdminId: admin.id };

    return {
      tenantId,
      actorId: userId,
      sessionId,
      // Sem `UserRole` no tenant alvo, `permissions` sairia vazio e toda rota
      // com `@RequirePermissions` recusaria -- suporte que nao enxerga nada
      // nao e suporte.
      permissions: new Set<string>(PERMISSOES_DO_OWNER),
      allowedUnitIds: 'ALL',
      // O gancho declarado em `tenant-context.ts`, morto desde a fatia que o
      // criou, finalmente e preenchido.
      supportElevation: { reason: elevacao.reason, expiresAt: elevacao.expiresAt },
    };
  }

  /**
   * Sessao de plataforma. Le `PlatformAdmin` ATIVO -- revogacao vale na
   * hora, pelo mesmo motivo que as permissoes de tenant vem do banco e nao
   * do token.
   */
  private async montarContextoDePlataforma(
    userId: string,
    claims: { sessionId: string },
  ): Promise<PlatformContext> {
    const admin = await this.db.platformAdmin.findFirst({
      where: { userId, revokedAt: null },
    });

    // Sem `PlatformAdmin` ativo, um token sem tenant nao autoriza nada.
    // Lancar aqui cai no `catch` do chamador e vira 401.
    if (!admin) throw new NaoAutenticadoError();

    return { actorId: userId, sessionId: claims.sessionId, platformAdminId: admin.id };
  }
}
