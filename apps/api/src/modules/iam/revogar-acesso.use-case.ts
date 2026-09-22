import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/** Mesmo minimo da elevacao de suporte e da F79: nao aceita "ok" nem ".". */
const MOTIVO_MINIMO = 10;

export class MotivoObrigatorioError extends ErroDeDominio {
  constructor() {
    super('MOTIVO_OBRIGATORIO', 400, 'Escreva o motivo da revogacao');
  }
}

export class UsuarioNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('USER_NOT_FOUND', 404, 'Este usuario nao tem acesso a esta academia');
  }
}

/**
 * Trancar-se fora exigiria OUTRO dono para desfazer -- e num tenant de um
 * dono so, ninguem desfaz: sobra abrir chamado para o Super Admin.
 */
export class NaoRevogaASiMesmoError extends ErroDeDominio {
  constructor() {
    super('NAO_REVOGA_A_SI_MESMO', 409, 'Voce nao pode revogar o proprio acesso');
  }
}

/**
 * Academia sem dono nao tem quem convide ninguem: `user.manage` so existe no
 * OWNER (provado em `permissoes.spec.ts`), entao o ultimo dono levaria a
 * gestao de equipe embora junto com ele.
 */
export class UltimoDonoError extends ErroDeDominio {
  constructor() {
    super('ULTIMO_DONO', 409, 'Este e o unico dono da academia; promova outro antes de revogar');
  }
}

/**
 * Tira o acesso de alguem ao painel da academia -- F80.
 *
 * DOIS REGISTROS GOVERNAM O ACESSO, e o `AuthGuard` le os dois: `UserRole`
 * (o que a pessoa pode) e `TenantMembership` (se ela pertence ao tenant).
 * Apagar so um deixaria acesso que nao morre -- e o sintoma seria uma pessoa
 * revogada continuando a entrar, longe daqui.
 *
 * O USUARIO NAO E APAGADO: identidade e global (a mesma pessoa pode ser aluna
 * de outra academia), e o vinculo e que e por tenant.
 */
@Injectable()
export class RevogarAcessoUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(
    contexto: TenantContext,
    userId: string,
    motivo: string,
    correlationId: string,
  ): Promise<void> {
    const justificativa = motivo.trim();

    if (justificativa.length < MOTIVO_MINIMO) throw new MotivoObrigatorioError();

    // Antes de qualquer leitura de banco: o ator e o alvo sao a mesma pessoa?
    if (userId === contexto.actorId) throw new NaoRevogaASiMesmoError();

    const { tenantId } = contexto;

    const vinculo = await this.db.tenantMembership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE' },
      select: { id: true },
    });

    if (!vinculo) throw new UsuarioNaoEncontradoError();

    const papeisDoAlvo = await this.db.userRole.findMany({
      where: { tenantId, userId },
      select: { role: { select: { name: true } } },
    });

    const alvoEhDono = papeisDoAlvo.some((p) => p.role.name === 'OWNER');

    if (alvoEhDono) {
      /*
       * CONTA DONOS COM VINCULO ATIVO, nao linhas de `UserRole`.
       *
       * Um dono cujo `TenantMembership` ja foi revogado nao segura a
       * academia: ele nao entra. Contar a linha dele deixaria o ultimo dono
       * de verdade ser revogado, que e exatamente o que esta guarda existe
       * para impedir.
       */
      const donos = await this.db.userRole.findMany({
        where: {
          tenantId,
          role: { name: 'OWNER' },
          user: { memberships: { some: { tenantId, status: 'ACTIVE' } } },
        },
        select: { userId: true },
      });

      // `Set`: a mesma pessoa pode ter OWNER em duas linhas (uma por unidade)
      // e nao e por isso que a academia tem dois donos.
      const donosDistintos = new Set(donos.map((d) => d.userId));

      if (donosDistintos.size <= 1) throw new UltimoDonoError();
    }

    await this.db.$transaction(async (tx) => {
      /*
       * `status: 'ACTIVE'` no `where` e a exclusao mutua: duas revogacoes
       * simultaneas do mesmo usuario so podem ganhar uma vez, e a segunda
       * nao grava auditoria de um ato que nao aconteceu.
       */
      const revogados = await tx.tenantMembership.updateMany({
        where: { id: vinculo.id, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });

      if (revogados.count === 0) throw new UsuarioNaoEncontradoError();

      await tx.userRole.deleteMany({ where: { tenantId, userId } });

      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'user.access_revoked',
          target: 'user',
          targetId: userId,
          correlationId,
          // Sem PII: o e-mail do revogado nao entra, so o motivo e o papel
          // que ele tinha -- que e o que uma auditoria precisa responder.
          metadata: { motivo: justificativa, papeis: papeisDoAlvo.map((p) => p.role.name) },
        },
      });
    });
  }
}
