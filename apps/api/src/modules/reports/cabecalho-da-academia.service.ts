import { Inject, Injectable } from '@nestjs/common';

import { OBJECT_STORAGE, type ObjectStoragePort } from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { chaveDeIdentidadePertenceA } from '../platform/domain/identidade-visual.js';
import type { CabecalhoDaAcademia } from './domain/dados-do-relatorio.js';
import type { FiltroDoRelatorioDeAlunos, NomesDoFiltro } from './domain/filtro-do-relatorio-de-alunos.js';

/**
 * Quem emite o relatório: dados cadastrais e logo da academia, mais os NOMES
 * (não os ids) que o cabeçalho mostra nos filtros.
 */
@Injectable()
export class CabecalhoDaAcademiaService {
  constructor(
    private readonly db: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /**
   * `gymUnitId` escolhido no filtro define o fuso; sem ele vale o fuso do
   * tenant e, na falta, o da primeira unidade. A hora impressa é a da
   * academia, não a do servidor.
   */
  async carregar(contexto: TenantContext, gymUnitId: string | undefined): Promise<CabecalhoDaAcademia> {
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: contexto.tenantId },
      select: {
        displayName: true,
        legalName: true,
        cnpj: true,
        timezone: true,
        phone: true,
        addressLine: true,
        addressCity: true,
        addressState: true,
        addressZip: true,
        logoObjectKey: true,
      },
    });

    const unidade = await this.db.comTenant((tx) =>
      tx.gymUnit.findFirst({
        where: { tenantId: contexto.tenantId, ...(gymUnitId ? { id: gymUnitId } : {}) },
        orderBy: { code: 'asc' },
        select: { timezone: true },
      }),
    );

    return {
      nome: tenant.displayName,
      razaoSocial: tenant.legalName,
      cnpj: tenant.cnpj,
      endereco: montarEndereco(tenant),
      telefone: tenant.phone,
      fuso:
        (gymUnitId ? unidade?.timezone : undefined) ??
        tenant.timezone ??
        unidade?.timezone ??
        'America/Sao_Paulo',
      logo: await this.lerLogo(contexto.tenantId, tenant.logoObjectKey),
    };
  }

  async nomesDoFiltro(contexto: TenantContext, filtro: FiltroDoRelatorioDeAlunos): Promise<NomesDoFiltro> {
    return this.db.comTenant(async (tx) => {
      const unidade = filtro.gymUnitId
        ? await tx.gymUnit.findFirst({
            where: { id: filtro.gymUnitId, tenantId: contexto.tenantId },
            select: { name: true },
          })
        : null;
      const plano = filtro.planId
        ? await tx.plan.findFirst({
            where: { id: filtro.planId, tenantId: contexto.tenantId },
            select: { name: true },
          })
        : null;

      return { unidade: unidade?.name, plano: plano?.name };
    });
  }

  /**
   * Logo ausente, de outro tenant, sumido do bucket ou ilegível => `null`, e o
   * cabeçalho cai para texto. O relatório vale mais que o enfeite. A checagem
   * de pertencimento é a mesma de `BrandingService.lerArquivo`: a chave sai de
   * uma coluna, e servir o que a coluna disser entregaria arquivo alheio.
   */
  private async lerLogo(tenantId: string, chave: string | null): Promise<CabecalhoDaAcademia['logo']> {
    if (chave === null || !chaveDeIdentidadePertenceA(chave, tenantId)) return null;

    try {
      return await this.storage.getPrivateObject(chave);
    } catch {
      return null;
    }
  }
}

function montarEndereco(t: {
  addressLine: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}): string | null {
  const cidade = [t.addressCity, t.addressState].filter(Boolean).join(' - ');
  const partes = [t.addressLine, cidade, t.addressZip ? `CEP ${t.addressZip}` : null].filter(
    (p): p is string => p !== null && p !== '',
  );

  return partes.length > 0 ? partes.join(', ') : null;
}
