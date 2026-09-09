import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PERMISSOES_DO_OWNER } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

const CONVITE_VALIDO_POR_HORAS = 24;
const BYTES_DE_TOKEN = 32;

/**
 * O `slug` e identificador publico usado em URL (a F62 fara login por ele),
 * entao repeti-lo e erro de quem preencheu -- 409, nao 500. Sem este codigo a
 * tela so poderia dizer "erro interno", que nao diz a ninguem o que corrigir.
 */
export class SlugEmUsoError extends ErroDeDominio {
  constructor() {
    super('TENANT_SLUG_TAKEN', 409, 'Ja existe uma academia com este identificador');
  }
}

/**
 * Violacao de unicidade do Prisma (P2002).
 *
 * So o `code`: no Prisma 7 com adapter-pg o nome da constraint nao chega em
 * `meta.target`, so em texto livre que muda de forma. Quem precisa saber QUAL
 * coluna colidiu delimita o `catch`, como este caso de uso faz.
 */
function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}

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
      /*
       * O `catch` envolve SO o `create` do tenant.
       *
       * Ha duas colunas unicas nesta transacao -- o `slug` do tenant e o
       * `code` da unidade -- e no Prisma 7 com adapter-pg o nome da constraint
       * nao vem em `meta.target`, so em texto livre. Capturar por POSICAO em
       * vez de por nome e o que torna a origem inequivoca: aqui dentro, P2002
       * so pode ser o slug.
       */
      const tenant = await tx.tenant
        .create({
          data: {
            slug: entrada.slug,
            legalName: entrada.legalName,
            displayName: entrada.displayName,
            cnpj: entrada.cnpj,
            timezone: entrada.timezone,
            responsavelNome: entrada.responsavelNome,
            responsavelEmail: entrada.responsavelEmail,
          },
        })
        .catch((erro: unknown) => {
          if (ehViolacaoDeUnicidade(erro)) throw new SlugEmUsoError();

          throw erro;
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
