import { Injectable } from '@nestjs/common';
import type { ProviderCapability } from '@arenahub/database';

import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../../common/tenant/tenant-context.js';
import { PrismaService } from '../../../persistence/prisma.service.js';

/**
 * Resolve QUAL conta de provedor atende uma capacidade, para um tenant.
 *
 * POR QUE EXISTE (ADR-032): sao dois provedores -- Sicoob para PIX, Getnet
 * para cartao. Antes disso o codigo fazia
 * `findFirst({ tenantId, active: true })`, que devolve QUALQUER conta ativa:
 * com os dois cadastrados, a cobranca PIX sairia pela conta de cartao
 * dependendo da ordem de insercao no banco -- sem erro, sem log, e com o
 * dinheiro indo para o lugar errado.
 *
 * O ROTEAMENTO PERGUNTA PELA CAPACIDADE, NUNCA PELA MARCA. Nenhum caso de
 * uso menciona "sicoob" ou "getnet": eles pedem `PIX` ou `CARD`. Trocar de
 * PSP e escrever um adapter e atualizar a linha em `provider_accounts` --
 * nao ha `if (provider === 'sicoob')` para caçar depois.
 *
 * NAO E UM REGISTRY DE CAPACIDADES. Nao ha configuracao declarativa, fallback
 * entre provedores nem descoberta em runtime: a extensibilidade ja mora na
 * interface `PaymentProvider`, e maquinario a mais seria abstracao
 * especulativa contra provedores hipoteticos (`CLAUDE.md`). Quando o terceiro
 * provedor chegar, ele traz exigencia que ninguem previu -- e generalizar
 * com dois implementadores concretos e mais barato que adivinhar agora.
 */

export class ContaDoProvedorAusenteParaCapacidadeError extends ErroDeDominio {
  constructor(capacidade: ProviderCapability) {
    super(
      'PROVIDER_ACCOUNT_MISSING',
      409,
      capacidade === 'PIX'
        ? 'Tenant sem conta ativa de PIX; configure o provedor antes de cobrar'
        : 'Tenant sem conta ativa de cartao; configure o provedor antes de cobrar',
    );
  }
}

export interface ContaResolvida {
  readonly id: string;
  readonly provider: string;
  readonly externalAccountId: string;
}

@Injectable()
export class ProviderAccountResolver {
  constructor(private readonly db: PrismaService) {}

  /**
   * A conta ATIVA do tenant para esta capacidade.
   *
   * `findFirst` e nao `findUnique` porque a unicidade e PARCIAL
   * (`WHERE active`) e o Prisma nao modela unicidade condicional -- a
   * garantia de "no maximo uma" vive no indice
   * `provider_accounts_tenant_id_capability_active_key`, nao neste metodo.
   * Sem o indice, este `findFirst` seria justamente a escolha arbitraria que
   * a fatia veio consertar.
   *
   * Falha ALTO quando nao ha conta: cobrar sem provedor configurado nao tem
   * caminho degradado que faca sentido -- devolver `null` empurraria a
   * decisao para cada chamador, e um deles esqueceria de checar.
   */
  async resolver(
    contexto: TenantContext,
    capacidade: ProviderCapability,
  ): Promise<ContaResolvida> {
    const conta = await this.db.providerAccount.findFirst({
      where: { tenantId: contexto.tenantId, capability: capacidade, active: true },
      select: { id: true, provider: true, externalAccountId: true },
    });

    if (!conta) {
      throw new ContaDoProvedorAusenteParaCapacidadeError(capacidade);
    }

    return conta;
  }
}
