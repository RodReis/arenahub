import { Injectable } from '@nestjs/common';
import { comContexto, type Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { slugDoLinkValido } from './domain/instalador-android.js';

export interface InstaladorAndroid {
  androidUrl: string;
  androidVersion: string | null;
  updatedAt: Date;
  /** `User` nao tem nome, so e-mail. Nulo se quem salvou saiu do sistema. */
  updatedByEmail: string | null;
  /** Perfil de quem salvou NESTA academia. */
  updatedByRole: string | null;
  /** Nulo = o texto padrao do painel (#538). */
  messageTemplate: string | null;
}

/** O que a tela precisa mesmo sem instalador: nome, sugestao e link reservado. */
export interface IdentidadeDoApp {
  academia: string;
  /** Nulo quando o identificador da academia nao cabe na regra do final. */
  slugSugerido: string | null;
  shortSlug: string | null;
}

/** O final do link ja pertence a outra academia (#538). */
export class SlugDoLinkEmUsoError extends Error {
  constructor() {
    super('APP_LINK_SLUG_TAKEN');
    this.name = 'SlugDoLinkEmUsoError';
  }
}

const SELECAO = {
  androidUrl: true,
  androidVersion: true,
  updatedAt: true,
  updatedByUserId: true,
  messageTemplate: true,
} as const;

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && 'code' in erro && erro.code === 'P2002';
}

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
        messageTemplate: linha.messageTemplate,
      };
    });
  }

  /**
   * Nome da academia (para a mensagem), identificador (sugestao do final do
   * link) e o final ja reservado, se houver. Le `tenants` so para nome e
   * slug -- os mesmos dois campos que a tela de login por slug ja expoe.
   */
  identidade(contexto: Pick<TenantContext, 'tenantId'>): Promise<IdentidadeDoApp> {
    return this.db.comTenant(async (tx) => {
      const [tenant, link] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: contexto.tenantId },
          select: { displayName: true, slug: true },
        }),
        tx.appShortLink.findFirst({
          where: { tenantId: contexto.tenantId, isPrimary: true },
          select: { slug: true },
        }),
      ]);

      return {
        academia: tenant.displayName,
        // Sugestao que a propria API recusaria trava o salvamento do APK na
        // tela -- melhor nao sugerir nada.
        slugSugerido: slugDoLinkValido(tenant.slug) ? tenant.slug : null,
        shortSlug: link?.slug ?? null,
      };
    });
  }

  /**
   * Grava instalador, mensagem e final do link NA MESMA transacao: um final
   * recusado (de outra academia) desfaz tudo, e a tela nunca fica com o APK
   * novo e o link velho sem dizer por que.
   */
  async salvar(
    contexto: TenantContext,
    dados: {
      androidUrl: string;
      androidVersion: string | null;
      messageTemplate?: string | null;
      shortSlug?: string;
    },
  ): Promise<InstaladorAndroid> {
    const { shortSlug, messageTemplate, ...instalador } = dados;
    const autor = contexto.actorId ?? null;

    try {
      await this.db.comTenant(async (tx) => {
        await tx.tenantAppDistribution.upsert({
          where: { tenantId: contexto.tenantId },
          create: {
            tenantId: contexto.tenantId,
            ...instalador,
            ...(messageTemplate !== undefined ? { messageTemplate } : {}),
            updatedByUserId: autor,
          },
          update: {
            ...instalador,
            ...(messageTemplate !== undefined ? { messageTemplate } : {}),
            updatedByUserId: autor,
          },
          select: { tenantId: true },
        });

        if (shortSlug !== undefined) {
          await this.definirFinalPrincipal(tx, contexto.tenantId, shortSlug);
        }
      });
    } catch (erro) {
      // PK do `app_short_links` e o proprio slug: a unica unicidade que um
      // PUT pode violar aqui e o final ja usado por outra academia.
      if (erro instanceof SlugDoLinkEmUsoError) throw erro;
      if (ehViolacaoDeUnicidade(erro)) throw new SlugDoLinkEmUsoError();
      throw erro;
    }

    // Releitura pelo mesmo caminho do GET: a resposta do PUT e a do GET
    // nunca divergem em quem salvou.
    const salvo = await this.obter(contexto);
    if (!salvo) throw new Error('Instalador salvo e nao encontrado');
    return salvo;
  }

  /**
   * Troca o final PRINCIPAL sem soltar o antigo: ele vira apelido da mesma
   * academia e continua resolvendo -- o QR ja impresso nao muda de dono
   * (achado da revisao). Final de OUTRA academia (principal ou apelido)
   * recusa; o PK do slug fecha a corrida de duas academias criando o mesmo.
   */
  private async definirFinalPrincipal(
    tx: Prisma.TransactionClient,
    tenantId: string,
    slug: string,
  ): Promise<void> {
    const atual = await tx.appShortLink.findFirst({
      where: { tenantId, isPrimary: true },
      select: { slug: true },
    });
    if (atual?.slug === slug) return;

    const existente = await tx.appShortLink.findUnique({
      where: { slug },
      select: { tenantId: true },
    });
    if (existente && existente.tenantId !== tenantId) throw new SlugDoLinkEmUsoError();

    // Rebaixa ANTES de promover: o indice parcial so admite um principal.
    if (atual) {
      await tx.appShortLink.update({ where: { slug: atual.slug }, data: { isPrimary: false } });
    }

    if (existente) {
      await tx.appShortLink.update({ where: { slug }, data: { isPrimary: true } });
    } else {
      await tx.appShortLink.create({ data: { slug, tenantId, isPrimary: true } });
    }
  }

  /**
   * Idempotente. O final do link FICA reservado: um QR impresso com ele volta
   * a funcionar quando um APK novo for colado.
   */
  async remover(contexto: TenantContext): Promise<void> {
    await this.db.comTenant((tx) =>
      tx.tenantAppDistribution.deleteMany({ where: { tenantId: contexto.tenantId } }),
    );
  }

  /**
   * Link publico (`/baixar/<slug>`): sem login, sem tenant conhecido. O slug
   * resolve a academia numa tabela SEM RLS (so slug -> tenant); o destino e
   * lido JA dentro do contexto dessa academia, sob a politica de
   * `tenant_app_distribution`.
   */
  async destinoDoLink(slug: string): Promise<string | null> {
    const link = await this.db.appShortLink.findUnique({
      where: { slug },
      select: { tenantId: true },
    });
    if (!link) return null;

    const instalador = await comContexto({ kind: 'tenant', tenantId: link.tenantId }, () =>
      this.db.comTenant((tx) =>
        tx.tenantAppDistribution.findUnique({
          where: { tenantId: link.tenantId },
          select: { androidUrl: true },
        }),
      ),
    );

    return instalador?.androidUrl ?? null;
  }
}
