import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import {
  ContaDoProvedorAusenteParaCapacidadeError,
  ProviderAccountResolver,
} from '../../src/modules/billing/provider/provider-account.resolver.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F14 -- roteamento por capacidade (ADR-032).
 *
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR: ate 19/08/2026 o caso de
 * uso de PIX resolvia a conta com `findFirst({ tenantId, active: true })`.
 * Com um provedor so, correto. Com Sicoob e Getnet cadastrados no MESMO
 * tenant, ele devolve a conta de CARTAO metade das vezes -- dependendo da
 * ordem de insercao no banco, sem erro e sem log, com a cobranca PIX indo
 * para o lugar errado.
 *
 * CONTRA BANCO DE VERDADE, nao dublado (`docs/TESTING.md` 3): a garantia de
 * "no maximo uma conta ativa por capacidade" e um INDICE PARCIAL do
 * Postgres. Testa-la com repositorio em memoria provaria o `where` do
 * TypeScript, nao a constraint -- e e a constraint que impede o estado
 * ambiguo de existir.
 */
describe('F14 -- roteamento de provedor por capacidade', () => {
  let db: PrismaService;
  let resolver: ProviderAccountResolver;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    resolver = moduleRef.get(ProviderAccountResolver);

    const tenant = await db.tenant.create({
      data: {
        slug: `rot-${sufixo}`,
        legalName: `Roteamento ${sufixo} LTDA`,
        displayName: `Roteamento ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    /**
     * OS DOIS PROVEDORES, no mesmo tenant -- que e exatamente o cenario que
     * nao existia quando o `findFirst` foi escrito. O de cartao entra
     * PRIMEIRO de proposito: assim, se o roteamento voltar a ignorar a
     * capacidade, `findFirst` devolve a Getnet para uma cobranca PIX e o
     * teste falha em vez de passar por sorte de ordenacao.
     */
    await db.providerAccount.create({
      data: {
        tenantId: tenant.id,
        provider: 'getnet',
        capability: 'CARD',
        externalAccountId: `ACC-GETNET-${sufixo}`,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
    });

    await db.providerAccount.create({
      data: {
        tenantId: tenant.id,
        provider: 'sicoob',
        capability: 'PIX',
        externalAccountId: `ACC-SICOOB-${sufixo}`,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
    });
  });

  afterAll(async () => {
    await db.providerAccount.deleteMany({ where: { tenantId: contexto.tenantId } });
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  it('PIX resolve para o Sicoob, mesmo com a conta de cartao cadastrada antes', async () => {
    const conta = await resolver.resolver(contexto, 'PIX');

    expect(conta.provider).toBe('sicoob');
    expect(conta.externalAccountId).toBe(`ACC-SICOOB-${sufixo}`);
  });

  it('cartao resolve para a Getnet', async () => {
    const conta = await resolver.resolver(contexto, 'CARD');

    expect(conta.provider).toBe('getnet');
    expect(conta.externalAccountId).toBe(`ACC-GETNET-${sufixo}`);
  });

  it('o banco recusa uma SEGUNDA conta ativa da mesma capacidade', async () => {
    /**
     * A garantia mora no indice parcial, nao no codigo. Sem ela o resolvedor
     * escolheria por ordem de insercao -- o defeito de origem, movido de
     * lugar em vez de consertado.
     */
    await expect(
      db.providerAccount.create({
        data: {
          tenantId: contexto.tenantId,
          provider: 'asaas',
          capability: 'PIX',
          externalAccountId: `ACC-DUPLICADA-${sufixo}`,
          signingSecretEncrypted: 'nao-sai-deste-arquivo',
        },
      }),
    ).rejects.toThrow();
  });

  it('trocar de PSP e possivel: a conta antiga sobrevive INATIVA', async () => {
    /**
     * Por isso o indice e PARCIAL (`WHERE active`). Se a unicidade valesse
     * tambem para conta desativada, trocar de provedor seria impossivel --
     * e a conta antiga precisa continuar existindo para os eventos
     * historicos dela seguirem resolviveis.
     */
    await db.providerAccount.updateMany({
      where: { tenantId: contexto.tenantId, capability: 'PIX', active: true },
      data: { active: false },
    });

    const nova = await db.providerAccount.create({
      data: {
        tenantId: contexto.tenantId,
        provider: 'asaas',
        capability: 'PIX',
        externalAccountId: `ACC-ASAAS-${sufixo}`,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
    });

    const resolvida = await resolver.resolver(contexto, 'PIX');
    expect(resolvida.provider).toBe('asaas');

    const antiga = await db.providerAccount.findFirst({
      where: { tenantId: contexto.tenantId, externalAccountId: `ACC-SICOOB-${sufixo}` },
    });
    expect(antiga).not.toBeNull();
    expect(antiga?.active).toBe(false);

    // Restaura o cenario para nao vazar estado entre casos.
    await db.providerAccount.delete({ where: { id: nova.id } });
    await db.providerAccount.updateMany({
      where: { tenantId: contexto.tenantId, externalAccountId: `ACC-SICOOB-${sufixo}` },
      data: { active: true },
    });
  });

  it('tenant sem conta da capacidade falha ALTO, e nao devolve a conta errada', async () => {
    const outro = await db.tenant.create({
      data: {
        slug: `rot-vazio-${sufixo}`,
        legalName: `Vazio ${sufixo} LTDA`,
        displayName: `Vazio ${sufixo}`,
      },
    });

    try {
      await expect(
        resolver.resolver({ ...contexto, tenantId: outro.id }, 'CARD'),
      ).rejects.toBeInstanceOf(ContaDoProvedorAusenteParaCapacidadeError);
    } finally {
      await db.tenant.delete({ where: { id: outro.id } });
    }
  });

  it('nao atravessa tenant: a conta de um nao resolve para o outro', async () => {
    /**
     * Regra de arquitetura no 2. O `tenantId` no `where` nao e decoracao --
     * sem ele, uma academia cobraria pela conta bancaria de outra.
     */
    const vizinho = await db.tenant.create({
      data: {
        slug: `rot-viz-${sufixo}`,
        legalName: `Vizinho ${sufixo} LTDA`,
        displayName: `Vizinho ${sufixo}`,
      },
    });

    try {
      await expect(
        resolver.resolver({ ...contexto, tenantId: vizinho.id }, 'PIX'),
      ).rejects.toBeInstanceOf(ContaDoProvedorAusenteParaCapacidadeError);
    } finally {
      await db.tenant.delete({ where: { id: vizinho.id } });
    }
  });
});
