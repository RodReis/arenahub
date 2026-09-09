import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import type { PlatformContext } from '../../src/common/platform/platform-context.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { CriarTenantUseCase } from '../../src/modules/platform/criar-tenant.use-case.js';
import { IndexValueUseCase } from '../../src/modules/platform/index-value.use-case.js';
import { SaasPlanUseCase } from '../../src/modules/platform/saas-plan.use-case.js';
import { TenantContractUseCase } from '../../src/modules/platform/tenant-contract.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Plano SaaS e contrato do tenant -- F63, ADR-052 §5-§8.
 *
 * INTEGRACAO, e nao unitario, porque os tres aceites da fatia so existem
 * contra o banco de verdade: a copia dos valores no fechamento, o indice que
 * falta e o CHECK que recusa o contrato ativo sem PDF.
 */
describe('plano SaaS e contrato do tenant', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let planos: SaasPlanUseCase;
  let contratos: TenantContractUseCase;
  let indices: IndexValueUseCase;
  let criarTenant: CriarTenantUseCase;
  let contexto: PlatformContext;

  /** Objetos gravados pelo storage falso, por chave. */
  const gravados = new Map<string, { body: Buffer; contentType: string }>();

  const storageFalso = {
    createPrivateUpload: () =>
      Promise.resolve({ uploadUrl: 'https://storage.test/x', expiresAt: '' }),
    headPrivateObject: () => Promise.resolve({ size: 1, contentType: 'application/pdf' }),
    deletePrivateObject: (key: string) => {
      gravados.delete(key);

      return Promise.resolve();
    },
    putPrivateObject: (entrada: { key: string; body: Buffer; contentType: string }) => {
      gravados.set(entrada.key, { body: entrada.body, contentType: entrada.contentType });

      return Promise.resolve();
    },
    /* LANCA em chave ausente, como o S3 -- mesma razao do `identidade-visual`. */
    getPrivateObject: (key: string) => {
      const objeto = gravados.get(key);

      if (!objeto) return Promise.reject(new Error('NoSuchKey'));

      return Promise.resolve(objeto);
    },
    createPrivateDownload: () =>
      Promise.resolve({ downloadUrl: 'https://storage.test/x', expiresAt: '' }),
  };

  const criarTenantDeTeste = async (): Promise<string> => {
    const { tenantId } = await criarTenant.executar(
      contexto,
      {
        slug: `contrato-${randomUUID().slice(0, 8)}`,
        legalName: 'Academia do Contrato LTDA',
        displayName: 'Academia do Contrato',
        cnpj: '12345678000199',
        timezone: 'America/Sao_Paulo',
        responsavelNome: 'Fulano',
        responsavelEmail: `dono-${randomUUID().slice(0, 8)}@academia.local`,
        unidade: { code: 'MATRIZ', name: 'Matriz', timezone: 'America/Sao_Paulo' },
      },
      `corr-${randomUUID()}`,
    );

    return tenantId;
  };

  const criarPlanoFixo = async (valorMinor: number): Promise<string> => {
    const plano = await planos.criar(
      contexto,
      {
        name: `Fixo ${randomUUID().slice(0, 6)}`,
        model: 'FIXED_MONTHLY',
        fixedPriceMinor: valorMinor,
      },
      `corr-${randomUUID()}`,
    );

    return plano.id;
  };

  const criarPlanoPorAluno = async (): Promise<string> => {
    const plano = await planos.criar(
      contexto,
      {
        name: `Por aluno ${randomUUID().slice(0, 6)}`,
        model: 'PER_STUDENT',
        activeStudentPriceMinor: 500,
        inactiveStudentPriceMinor: 250,
      },
      `corr-${randomUUID()}`,
    );

    return plano.id;
  };

  /** Contrato fixo com data-base e aniversario em 1º de marco de 2025. */
  const contratoFixo = async (tenantId: string, planId: string): Promise<string> => {
    const contrato = await contratos.criar(
      contexto,
      {
        tenantId,
        planId,
        baseDate: new Date('2025-03-01T00:00:00.000Z'),
        anniversaryDay: 1,
        anniversaryMonth: 3,
        issueDay: 1,
        startsAt: new Date('2025-03-01T00:00:00.000Z'),
      },
      `corr-${randomUUID()}`,
    );

    return contrato.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    planos = app.get(SaasPlanUseCase);
    contratos = app.get(TenantContractUseCase);
    indices = app.get(IndexValueUseCase);
    criarTenant = app.get(CriarTenantUseCase);

    const usuario = await db.user.create({
      data: {
        email: `super-contrato-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira.
        passwordHash: await senhas.gerarHash('senha-de-teste-correta'),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    contexto = { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id };
  });

  /*
   * O dublê guarda estado, e a instancia e COMPARTILHADA pela suite: um PDF
   * gravado num teste continuaria visivel no proximo, e o teste do objeto
   * ausente passaria pelo motivo errado.
   */
  beforeEach(() => {
    gravados.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('o contrato copia os valores do plano', () => {
    it('alterar o preco do plano NAO altera contrato ativo', async () => {
      const tenantId = await criarTenantDeTeste();
      const planId = await criarPlanoFixo(100_000);
      const contratoId = await contratoFixo(tenantId, planId);

      await contratos.ativar(contexto, contratoId, `corr-${randomUUID()}`);

      // O catalogo sobe 50%. O contrato ja fechado nao pode se mexer.
      await planos.alterar(
        contexto,
        planId,
        { name: 'Fixo reajustado', model: 'FIXED_MONTHLY', fixedPriceMinor: 150_000 },
        `corr-${randomUUID()}`,
      );

      const depois = await contratos.porId(contratoId);

      expect(depois.fixedPriceMinor).toBe(100_000);
    });

    it('o PDF reproduz o valor do contrato, e nao o do plano atual', async () => {
      const tenantId = await criarTenantDeTeste();
      const planId = await criarPlanoFixo(100_000);
      const contratoId = await contratoFixo(tenantId, planId);

      /*
       * O catalogo sobe ENTRE o rascunho e a ativacao, e nao depois dela.
       *
       * Alterar o plano so depois de ativar nao provaria nada: o PDF ja
       * estaria gravado, e a leitura viva do catalogo passaria despercebida.
       * E a janela em que o gerador poderia ler o preco errado, e e nela que
       * o teste tem de bater.
       */
      await planos.alterar(
        contexto,
        planId,
        { name: 'Fixo reajustado', model: 'FIXED_MONTHLY', fixedPriceMinor: 150_000 },
        `corr-${randomUUID()}`,
      );

      await contratos.ativar(contexto, contratoId, `corr-${randomUUID()}`);

      const documento = await contratos.lerDocumento(contratoId);
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(documento.conteudo));
      const { text } = await extractText(pdf, { mergePages: true });
      const texto = Array.isArray(text) ? text.join(' ') : text;

      expect(texto).toContain('R$ 1.000,00');
      expect(texto).not.toContain('R$ 1.500,00');
    });

    it('plano arquivado nao aceita contrato novo, mas o contrato ja fechado fica', async () => {
      const tenantId = await criarTenantDeTeste();
      const planId = await criarPlanoFixo(100_000);
      const contratoId = await contratoFixo(tenantId, planId);

      await contratos.ativar(contexto, contratoId, `corr-${randomUUID()}`);
      await planos.arquivar(contexto, planId, `corr-${randomUUID()}`);

      const outroTenant = await criarTenantDeTeste();

      await expect(
        contratos.criar(
          contexto,
          {
            tenantId: outroTenant,
            planId,
            baseDate: new Date('2025-03-01T00:00:00.000Z'),
            anniversaryDay: 1,
            anniversaryMonth: 3,
            issueDay: 1,
            startsAt: new Date('2025-03-01T00:00:00.000Z'),
          },
          `corr-${randomUUID()}`,
        ),
      ).rejects.toMatchObject({ code: 'SAAS_PLAN_ARCHIVED' });

      const sobrevivente = await contratos.porId(contratoId);
      expect(sobrevivente.status).toBe('ACTIVE');
      expect(sobrevivente.fixedPriceMinor).toBe(100_000);
    });
  });

  describe('imutabilidade e exclusividade', () => {
    it('contrato ativo nao volta a ser alterado', async () => {
      const tenantId = await criarTenantDeTeste();
      const contratoId = await contratoFixo(tenantId, await criarPlanoFixo(100_000));

      await contratos.ativar(contexto, contratoId, `corr-${randomUUID()}`);

      await expect(
        contratos.ativar(contexto, contratoId, `corr-${randomUUID()}`),
      ).rejects.toMatchObject({ code: 'TENANT_CONTRACT_IMMUTABLE' });
    });

    it('a academia nao fica com dois contratos vigentes', async () => {
      const tenantId = await criarTenantDeTeste();
      const primeiro = await contratoFixo(tenantId, await criarPlanoFixo(100_000));
      const segundo = await contratoFixo(tenantId, await criarPlanoFixo(120_000));

      await contratos.ativar(contexto, primeiro, `corr-${randomUUID()}`);

      await expect(
        contratos.ativar(contexto, segundo, `corr-${randomUUID()}`),
      ).rejects.toMatchObject({ code: 'TENANT_CONTRACT_ALREADY_ACTIVE' });
    });

    it('o BANCO recusa dois contratos ativos, mesmo por fora do caso de uso', async () => {
      /*
       * O caso de uso ja recusa, mas ele nao e o unico caminho ate a tabela.
       * Este teste ataca o `UPDATE` direto -- import, seed, `psql` -- e prova
       * que o indice parcial `tenant_contracts_um_ativo_por_tenant` esta la.
       * Sem ele, a guarda viveria so no `if`.
       */
      const tenantId = await criarTenantDeTeste();
      const primeiro = await contratoFixo(tenantId, await criarPlanoFixo(100_000));
      const segundo = await contratoFixo(tenantId, await criarPlanoFixo(120_000));

      await contratos.ativar(contexto, primeiro, `corr-${randomUUID()}`);

      await expect(
        db.tenantContract.update({
          where: { id: segundo },
          data: { status: 'ACTIVE', documentObjectKey: `tenants/${tenantId}/contracts/x.pdf` },
        }),
      ).rejects.toThrow();
    });

    it('o BANCO recusa contrato ativo sem PDF', async () => {
      const tenantId = await criarTenantDeTeste();
      const contratoId = await contratoFixo(tenantId, await criarPlanoFixo(100_000));

      await expect(
        db.tenantContract.update({ where: { id: contratoId }, data: { status: 'ACTIVE' } }),
      ).rejects.toThrow();
    });

    it('encerrar libera a vaga para o contrato seguinte', async () => {
      const tenantId = await criarTenantDeTeste();
      const primeiro = await contratoFixo(tenantId, await criarPlanoFixo(100_000));
      const segundo = await contratoFixo(tenantId, await criarPlanoFixo(120_000));

      await contratos.ativar(contexto, primeiro, `corr-${randomUUID()}`);
      await contratos.encerrar(
        contexto,
        primeiro,
        new Date('2026-03-01T00:00:00.000Z'),
        `corr-${randomUUID()}`,
      );

      const ativado = await contratos.ativar(contexto, segundo, `corr-${randomUUID()}`);

      expect(ativado.status).toBe('ACTIVE');
      expect((await contratos.porId(primeiro)).status).toBe('TERMINATED');
    });
  });

  describe('correcao pelo indice', () => {
    /** Doze meses de 1% cada, a partir da competencia dada. */
    const cadastrarDozeMeses = async (
      code: string,
      anoInicial: number,
      mesInicial: number,
      basisPoints: number,
    ): Promise<void> => {
      for (let passo = 0; passo < 12; passo += 1) {
        const data = new Date(Date.UTC(anoInicial, mesInicial - 1 + passo, 1));
        const competencia = data.toISOString().slice(0, 7);

        await indices.registrar(
          contexto,
          { code, competencia, variationBasisPoints: basisPoints },
          `corr-${randomUUID()}`,
        );
      }
    };

    it('aniversario vencido aplica o acumulado do historico manual', async () => {
      const code = `IPCA-${randomUUID().slice(0, 6).toUpperCase()}`;
      await cadastrarDozeMeses(code, 2025, 3, 1000);

      const tenantId = await criarTenantDeTeste();
      const contrato = await contratos.criar(
        contexto,
        {
          tenantId,
          planId: await criarPlanoFixo(100_000),
          indexCode: code,
          baseDate: new Date('2025-03-01T00:00:00.000Z'),
          anniversaryDay: 1,
          anniversaryMonth: 3,
          issueDay: 1,
          startsAt: new Date('2025-03-01T00:00:00.000Z'),
        },
        `corr-${randomUUID()}`,
      );

      await contratos.ativar(contexto, contrato.id, `corr-${randomUUID()}`);

      const corrigido = await contratos.valorCorrigido(
        contrato.id,
        new Date('2026-03-01T00:00:00.000Z'),
      );

      // 1,01^12 = 1,126825... sobre R$ 1.000,00 -> R$ 1.126,83.
      expect(corrigido.aniversariosAplicados).toBe(1);
      expect(corrigido.valorMinor).toBe(112_683);
    });

    it('SEM valor cadastrado a correcao NAO roda, e diz o que falta', async () => {
      const code = `IPCA-${randomUUID().slice(0, 6).toUpperCase()}`;
      await cadastrarDozeMeses(code, 2025, 3, 1000);

      // Apaga um mes do meio: a janela deixa de estar completa.
      await db.indexValue.deleteMany({
        where: { code, referenceMonth: new Date('2025-07-01T00:00:00.000Z') },
      });

      const tenantId = await criarTenantDeTeste();
      const contrato = await contratos.criar(
        contexto,
        {
          tenantId,
          planId: await criarPlanoFixo(100_000),
          indexCode: code,
          baseDate: new Date('2025-03-01T00:00:00.000Z'),
          anniversaryDay: 1,
          anniversaryMonth: 3,
          issueDay: 1,
          startsAt: new Date('2025-03-01T00:00:00.000Z'),
        },
        `corr-${randomUUID()}`,
      );

      await expect(
        contratos.valorCorrigido(contrato.id, new Date('2026-03-01T00:00:00.000Z')),
      ).rejects.toMatchObject({ code: 'INDEX_VALUE_MISSING' });
    });

    it('antes do aniversario o valor fica intacto', async () => {
      const tenantId = await criarTenantDeTeste();
      const contratoId = await contratoFixo(tenantId, await criarPlanoFixo(100_000));

      const corrigido = await contratos.valorCorrigido(
        contratoId,
        new Date('2026-02-28T00:00:00.000Z'),
      );

      expect(corrigido).toEqual({ valorMinor: 100_000, aniversariosAplicados: 0 });
    });

    it('reimportar a mesma competencia corrige o valor em vez de somar outro mes', async () => {
      const code = `IPCA-${randomUUID().slice(0, 6).toUpperCase()}`;

      await indices.registrar(
        contexto,
        { code, competencia: '2025-04', variationBasisPoints: 1000 },
        `corr-${randomUUID()}`,
      );
      await indices.registrar(
        contexto,
        { code, competencia: '2025-04', variationBasisPoints: 440 },
        `corr-${randomUUID()}`,
      );

      const linhas = await db.indexValue.findMany({ where: { code } });

      expect(linhas).toHaveLength(1);
      expect(linhas[0]?.variationBasisPoints).toBe(440);
    });
  });

  describe('coerencia entre modelo e valores', () => {
    it('plano por aluno sem preco de ativo e recusado', async () => {
      await expect(
        planos.criar(
          contexto,
          { name: 'Incoerente', model: 'PER_STUDENT', inactiveStudentPriceMinor: 250 },
          `corr-${randomUUID()}`,
        ),
      ).rejects.toMatchObject({ code: 'SAAS_PLAN_VALUES_INVALID' });
    });

    it('preco zero no aluno inativo e valido -- e negociado por contrato', async () => {
      const plano = await planos.criar(
        contexto,
        {
          name: `Sem cobrar lead ${randomUUID().slice(0, 6)}`,
          model: 'PER_STUDENT',
          activeStudentPriceMinor: 500,
          inactiveStudentPriceMinor: 0,
        },
        `corr-${randomUUID()}`,
      );

      expect(plano.inactiveStudentPriceMinor).toBe(0);
    });

    it('contrato por aluno nao tem valor corrigido por indice', async () => {
      const tenantId = await criarTenantDeTeste();
      const contratoId = await contratoFixo(tenantId, await criarPlanoPorAluno());

      await expect(
        contratos.valorCorrigido(contratoId, new Date('2027-03-01T00:00:00.000Z')),
      ).rejects.toMatchObject({ code: 'TENANT_CONTRACT_NOT_FOUND' });
    });

    it('o BANCO recusa plano fixo com preco por aluno', async () => {
      await expect(
        db.saasPlan.create({
          data: {
            name: 'Pelos dois lados',
            model: 'FIXED_MONTHLY',
            fixedPriceMinor: 100_000,
            activeStudentPriceMinor: 500,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('leitura do PDF', () => {
    it('a chave adulterada na coluna nao serve outro objeto do bucket', async () => {
      /*
       * A chave sai de uma COLUNA. Se a leitura confiasse nela, escrever ali
       * o caminho da foto biometrica de um aluno -- que mora no mesmo bucket
       * -- serviria essa foto por esta rota.
       */
      const tenantId = await criarTenantDeTeste();
      const contratoId = await contratoFixo(tenantId, await criarPlanoFixo(100_000));

      await contratos.ativar(contexto, contratoId, `corr-${randomUUID()}`);

      await db.tenantContract.update({
        where: { id: contratoId },
        data: { documentObjectKey: 'tenants/outro-tenant/biometrics/rosto.jpg' },
      });

      await expect(contratos.lerDocumento(contratoId)).rejects.toMatchObject({
        code: 'TENANT_CONTRACT_NOT_FOUND',
      });
    });

    it('contrato em rascunho nao tem PDF para ler', async () => {
      const tenantId = await criarTenantDeTeste();
      const contratoId = await contratoFixo(tenantId, await criarPlanoFixo(100_000));

      await expect(contratos.lerDocumento(contratoId)).rejects.toMatchObject({
        code: 'TENANT_CONTRACT_NOT_FOUND',
      });
    });
  });
});
