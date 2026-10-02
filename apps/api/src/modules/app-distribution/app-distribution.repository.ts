import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

export interface InstaladorAndroid {
  androidUrl: string;
  androidVersion: string | null;
  updatedAt: Date;
  /** `User` nao tem nome, so e-mail. Nulo se quem salvou saiu do sistema. */
  updatedByEmail: string | null;
  /** Perfil de quem salvou NESTA academia. */
  updatedByRole: string | null;
}

const SELECAO = {
  androidUrl: true,
  androidVersion: true,
  updatedAt: true,
  updatedByUserId: true,
} as const;

@Injectable()
export class AppDistributionRepository {
  constructor(private readonly db: PrismaService) {}

  obter(contexto: Pick<TenantContext, 'tenantId'>): Promise<InstaladorAndroid | null> {
    return this.db.comTenant(async (tx) => {
      const linha = await tx.tenantAppDistribution.findUnique({
        where: { tenantId: contexto.tenantId },
        select: SELECAO,
      });
      if (!linha) return null;

      const autor = linha.updatedByUserId
        ? await tx.user.findUnique({
            where: { id: linha.updatedByUserId },
            select: {
              email: true,
              userRoles: {
                where: { tenantId: contexto.tenantId },
                select: { role: { select: { name: true } } },
                take: 1,
              },
            },
          })
        : null;

      return {
        androidUrl: linha.androidUrl,
        androidVersion: linha.androidVersion,
        updatedAt: linha.updatedAt,
        updatedByEmail: autor?.email ?? null,
        updatedByRole: autor?.userRoles[0]?.role.name ?? null,
      };
    });
  }

  salvar(
    contexto: TenantContext,
    dados: { androidUrl: string; androidVersion: string | null },
  ): Promise<InstaladorAndroid> {
    return this.db
      .comTenant((tx) =>
        tx.tenantAppDistribution.upsert({
          where: { tenantId: contexto.tenantId },
          create: { tenantId: contexto.tenantId, ...dados, updatedByUserId: contexto.actorId ?? null },
          update: { ...dados, updatedByUserId: contexto.actorId ?? null },
          select: { tenantId: true },
        }),
      )
      .then(async () => {
        // Releitura pelo mesmo caminho do GET: a resposta do PUT e a do GET
        // nunca divergem em quem salvou.
        const salvo = await this.obter(contexto);
        if (!salvo) throw new Error('Instalador salvo e nao encontrado');
        return salvo;
      });
  }

  /** Idempotente: remover o que nao existe nao e erro. */
  async remover(contexto: TenantContext): Promise<void> {
    await this.db.comTenant((tx) =>
      tx.tenantAppDistribution.deleteMany({ where: { tenantId: contexto.tenantId } }),
    );
  }
}
