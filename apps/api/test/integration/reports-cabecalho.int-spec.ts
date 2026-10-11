import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { montarChaveDeIdentidade } from '../../src/modules/platform/domain/identidade-visual.js';
import { CabecalhoDaAcademiaService } from '../../src/modules/reports/cabecalho-da-academia.service.js';
import { lerFiltro } from '../../src/modules/reports/domain/filtro-do-relatorio-de-alunos.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  apagarCenario,
  contextoDe,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/** Storage em memória: o teste é do cabeçalho, não do S3 (mesmo recurso de `access-query-export`). */
const objetos = new Map<string, { body: Buffer; contentType: string }>();
const storageFalso = {
  getPrivateObject: (key: string) => {
    const achado = objetos.get(key);

    return achado ? Promise.resolve(achado) : Promise.reject(new Error('NoSuchKey'));
  },
};

describe('F90 -- cabeçalho da academia no relatório', () => {
  let db: PrismaService;
  let servico: CabecalhoDaAcademiaService;
  let c: CenarioDeDiaria;
  let ctx: TenantContext;

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();
    db = moduleRef.get(PrismaService);
    servico = comContextoDeTenant(moduleRef.get(CabecalhoDaAcademiaService, { strict: false }));

    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));
    ctx = contextoDe(c);
  });

  afterAll(async () => {
    await apagarCenario(db, c);
  });

  async function definirTenant(dados: Record<string, unknown>): Promise<void> {
    await db.tenant.update({ where: { id: c.tenantId }, data: dados });
  }

  it('traz nome, razão social, CNPJ, endereço e telefone do cadastro', async () => {
    await definirTenant({
      cnpj: '12345678000195',
      addressLine: 'Rua A, 10',
      addressCity: 'Curitiba',
      addressState: 'PR',
      addressZip: '80000000',
      phone: '4133334444',
    });

    const cabecalho = await servico.carregar(ctx, undefined);

    expect(cabecalho).toMatchObject({
      nome: `Diaria ${c.sufixo}`,
      razaoSocial: `Diaria ${c.sufixo} LTDA`,
      cnpj: '12345678000195',
      endereco: 'Rua A, 10, Curitiba - PR, CEP 80000000',
      telefone: '4133334444',
      logo: null,
    });
  });

  it('sem fuso no tenant usa o fuso da primeira unidade; com unidade escolhida usa o dela', async () => {
    await definirTenant({ timezone: null });
    expect((await servico.carregar(ctx, undefined)).fuso).toBe('America/Sao_Paulo');

    const manaus = await db.gymUnit.create({
      data: {
        tenantId: c.tenantId,
        code: 'MAO',
        name: 'Manaus',
        timezone: 'America/Manaus',
        openingHours: {},
      },
    });

    expect((await servico.carregar(ctx, manaus.id)).fuso).toBe('America/Manaus');
  });

  it('tenant sem endereço/CNPJ/telefone devolve null, não texto vazio inventado', async () => {
    await definirTenant({
      cnpj: null,
      addressLine: null,
      addressCity: null,
      addressState: null,
      addressZip: null,
      phone: null,
    });

    const cabecalho = await servico.carregar(ctx, undefined);

    expect(cabecalho).toMatchObject({ cnpj: null, endereco: null, telefone: null });
  });

  it('lê o logo do storage quando a chave é do próprio tenant', async () => {
    const chave = montarChaveDeIdentidade(c.tenantId, 'logo', 'image/png');
    objetos.set(chave, { body: PNG, contentType: 'image/png' });
    await definirTenant({ logoObjectKey: chave });

    const cabecalho = await servico.carregar(ctx, undefined);

    expect(cabecalho.logo?.contentType).toBe('image/png');
    expect(cabecalho.logo?.body.length).toBe(PNG.length);
  });

  it('chave de OUTRO tenant no campo do logo é ignorada (nunca serve o arquivo alheio)', async () => {
    const alheia = montarChaveDeIdentidade(randomUUID(), 'logo', 'image/png');
    objetos.set(alheia, { body: PNG, contentType: 'image/png' });
    await definirTenant({ logoObjectKey: alheia });

    expect((await servico.carregar(ctx, undefined)).logo).toBeNull();
  });

  it('objeto sumido do bucket vira cabeçalho sem logo, não erro', async () => {
    await definirTenant({ logoObjectKey: `tenants/${c.tenantId}/branding/logo-que-sumiu.png` });

    await expect(servico.carregar(ctx, undefined)).resolves.toMatchObject({ logo: null });
  });

  it('nomesDoFiltro resolve unidade e plano do PRÓPRIO tenant e ignora ids alheios', async () => {
    const planoId = await criarPlano(db, c, { nome: 'Mensal Fit', billingMode: 'ASSINATURA' });
    const filtro = lerFiltro({ gymUnitId: c.unidadeId, planId: planoId });

    expect(await servico.nomesDoFiltro(ctx, filtro)).toEqual({ unidade: 'Matriz', plano: 'Mensal Fit' });
    expect(
      await servico.nomesDoFiltro(ctx, lerFiltro({ gymUnitId: randomUUID(), planId: randomUUID() })),
    ).toEqual({ unidade: undefined, plano: undefined });
  });
});
