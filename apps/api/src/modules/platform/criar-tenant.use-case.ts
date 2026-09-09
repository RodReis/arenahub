import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PERMISSOES_DO_OWNER } from '@arenahub/database';

import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

const CONVITE_VALIDO_POR_HORAS = 24;
const BYTES_DE_TOKEN = 32;

export interface EntradaDeTenant {
  slug: string;
  legalName: string;
  displayName: string;
  cnpj: string;
  timezone: string;
  responsavelNome: string;
  responsavelEmail: string;
  unidade: { code: string; name: string; timezone: string };
}

export interface TenantCriado {
  tenantId: string;
  gymUnitId: string;
  ownerInvitationToken: string;
}

/**
 * Cria o tenant inteiro numa transacao: tenant, primeira unidade, papel
 * OWNER com as permissoes, e o convite do dono.
 *
 * Parcial seria pior que nada -- tenant sem OWNER e academia sem ninguem que
 * possa entrar nela, e so o dono do SaaS conseguiria consertar.
 *
 * O e-mail do convite sai FORA daqui (ver `PlatformController`): provedor de
 * e-mail que recusa nao pode desfazer o tenant que ja foi criado.
 */
@Injectable()
export class CriarTenantUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async executar(
    contexto: PlatformContext,
    entrada: EntradaDeTenant,
    correlationId: string,
  ): Promise<TenantCriado> {
    // Token em claro existe UMA vez: o banco guarda so o SHA-256, mesma
    // regra do `InvitationService`.
    const token = randomBytes(BYTES_DE_TOKEN).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + CONVITE_VALIDO_POR_HORAS * 60 * 60 * 1000);

    const resultado = await this.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug: entrada.slug,
          legalName: entrada.legalName,
          displayName: entrada.displayName,
          cnpj: entrada.cnpj,
          timezone: entrada.timezone,
          responsavelNome: entrada.responsavelNome,
          responsavelEmail: entrada.responsavelEmail,
        },
      });

      const unidade = await tx.gymUnit.create({
        data: {
          tenantId: tenant.id,
          code: entrada.unidade.code,
          name: entrada.unidade.name,
          timezone: entrada.unidade.timezone,
          openingHours: {},
        },
      });

      const papel = await tx.role.create({
        data: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
      });

      // Fonte unica: `PERMISSOES_DO_OWNER`. Repetir a lista aqui ja produziu
      // OWNER real sem `access.read` em producao.
      //
      // `upsert` uma a uma porque o catalogo `Permission` e global e pode nao
      // ter o codigo ainda; o vinculo com o papel vai em lote so.
      const permissoes = [];

      for (const code of PERMISSOES_DO_OWNER) {
        permissoes.push(
          await tx.permission.upsert({ where: { code }, create: { code }, update: {} }),
        );
      }

      await tx.rolePermission.createMany({
        data: permissoes.map((permissao) => ({
          roleId: papel.id,
          permissionId: permissao.id,
        })),
      });

      await tx.invitation.create({
        data: {
          tenantId: tenant.id,
          email: entrada.responsavelEmail.trim().toLowerCase(),
          roleId: papel.id,
          /*
           * SEM `gymUnitId`, e nao por esquecimento.
           *
           * O convite carrega o `gymUnitId` para o `UserRole` que nasce ao
           * aceitar (`invitation.service.ts`), e o `AuthGuard` le `gymUnitId`
           * preenchido como "vale SO nesta unidade". Amarrar o dono a matriz
           * o deixaria sem enxergar a segunda unidade no dia em que ela
           * abrisse -- longe daqui, sem sintoma que aponte para ca.
           * `bootstrap-tenant.ts` sempre criou o OWNER assim.
           */
          tokenHash,
          expiresAt,
        },
      });

      await this.auditoria.registrar(
        contexto,
        {
          action: 'tenant.created',
          target: 'tenant',
          targetId: tenant.id,
          tenantId: tenant.id,
          // Sem PII: slug e codigo de unidade sao dado operacional. O e-mail
          // do responsavel NAO entra.
          metadata: { slug: tenant.slug, unitCode: unidade.code },
        },
        correlationId,
        tx,
      );

      return { tenantId: tenant.id, gymUnitId: unidade.id };
    });

    return { ...resultado, ownerInvitationToken: token };
  }
}
