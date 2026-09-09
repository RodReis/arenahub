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
import { PlatformInvoiceSchedulerService } from '../../src/modules/platform/platform-invoice-scheduler.service.js';
import { PlatformInvoiceUseCase } from '../../src/modules/platform/platform-invoice.use-case.js';
import { SaasPlanUseCase } from '../../src/modules/platform/saas-plan.use-case.js';
import { TenantContractUseCase } from '../../src/modules/platform/tenant-contract.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatura da plataforma sobre o tenant -- F64, ADR-052.
 *
 * INTEGRACAO, e nao unitario: os quatro aceites da fatia dependem do banco.
 * A idempotencia e a chave unica `(tenant_id, competence)` -- um dublê
 * responderia o que quisessemos e o teste passaria pelo motivo errado. O
 * congelamento da contagem so se prova mexendo no status de um aluno DEPOIS
 * da emissao. A aritmetica pura ja esta coberta em
 * `domain/calculo-da-fatura.spec.ts`, e nao se repete aqui.
 */
describe('fatura da plataforma', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let planos: SaasPlanUseCase;
  let contratos: TenantContractUseCase;
  let indices: IndexValueUseCase;
  let faturas: PlatformInvoiceUseCase;
  let job: PlatformInvoiceSchedulerService;
  let criarTenant: CriarTenantUseCase;
  let contexto: PlatformContext;

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
        slug: `fatura-${randomUUID().slice(0, 8)}`,
        legalName: 'Academia da Fatura LTDA',
        displayName: 'Academia da Fatura',
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

  /** Contrato POR ALUNO vigente, com o preco pedido. */
  const contratoPorAlunoAtivo = async (
    tenantId: string,
    precoAtivo: number,
    precoInativo: number,
  ): Promise<string> => {
    const plano = await planos.criar(
      contexto,
      {
        name: `Por aluno ${randomUUID().slice(0, 6)}`,
        model: 'PER_STUDENT',
        activeStudentPriceMinor: precoAtivo,
        inactiveStudentPriceMinor: precoInativo,
      },
      `corr-${randomUUID()}`,
    );

    const contrato = await contratos.criar(
      contexto,
      {
        tenantId,
        planId: plano.id,
        baseDate: new Date('2026-01-01T00:00:00.000Z'),
        anniversaryDay: 1,
        anniversaryMonth: 1,
        issueDay: 1,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      `corr-${randomUUID()}`,
    );

    await contratos.ativar(contexto, contrato.id, `corr-${randomUUID()}`);

    return contrato.id;
  };

  /** Contrato FIXO vigente, data-base 01/03/2025 e aniversario em marco. */
  const contratoFixoAtivo = async (tenantId: string, valorMinor: number): Promise<string> => {
    const plano = await planos.criar(
      contexto,
      {
        name: `Fixo ${randomUUID().slice(0, 6)}`,
        model: 'FIXED_MONTHLY',
        fixedPriceMinor: valorMinor,
      },
      `corr-${randomUUID()}`,
    );

    const contrato = await contratos.criar(
      contexto,
      {
        tenantId,
        planId: plano.id,
        baseDate: new Date('2025-03-01T00:00:00.000Z'),
        anniversaryDay: 1,
        anniversaryMonth: 3,
        issueDay: 1,
        startsAt: new Date('2025-03-01T00:00:00.000Z'),
      },
      `corr-${randomUUID()}`,
    );

    await contratos.ativar(contexto, contrato.id, `corr-${randomUUID()}`);

    return contrato.id;
  };

  /**
   * Cria alunos com o status pedido.
   *
   * `membershipNumber` sempre novo: o tenant e reusado dentro de cada caso, e
   * repetir a matricula faria o `create` colidir -- ou, pior, casar com a
   * pessoa do caso anterior e o teste contar um aluno que ja existia.
   *
   * Escreve DIRETO na tabela, sem passar pelo caso de uso de cadastro: o que
   * esta fatia conta e `Student.status`, e o cadastro real arrastaria plano,
   * assinatura e consentimento para dentro de um teste de faturamento.
   */
  const criarAlunos = async (
    tenantId: string,
    status: 'ACTIVE' | 'LEAD' | 'CANCELLED' | 'ARCHIVED',
    quantos: number,
  ): Promise<void> => {
    const unidade = await db.gymUnit.findFirstOrThrow({ where: { tenantId } });

    for (let i = 0; i < quantos; i += 1) {
      await db.student.create({
        data: {
          tenantId,
          gymUnitId: unidade.id,
          membershipNumber: `F64-${randomUUID().slice(0, 12)}`,
          fullName: `Aluno ${status} ${randomUUID().slice(0, 8)}`,
          birthDate: new Date('1990-01-01T00:00:00.000Z'),
          status,
        },
      });
    }
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
    faturas = app.get(PlatformInvoiceUseCase);
    job = app.get(PlatformInvoiceSchedulerService);
    criarTenant = app.get(CriarTenantUseCase);

    const usuario = await db.user.create({
      data: {
        email: `super-fatura-${randomUUID().slice(0, 8)}@exemplo.test`,
        // Hash de verdade: a suite `vazamento` varre a tabela inteira.
        passwordHash: await senhas.gerarHash('senha-de-teste-correta'),
      },
    });

    const admin = await db.platformAdmin.create({ data: { userId: usuario.id } });

    contexto = { actorId: usuario.id, sessionId: randomUUID(), platformAdminId: admin.id };
  });

  /* O dublê guarda estado e a instancia e compartilhada pela suite. */
  beforeEach(() => {
    gravados.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('emissão', () => {
    it('conta ativos e inativos e cobra o preço de cada um', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);

      await criarAlunos(tenantId, 'ACTIVE', 3);
      await criarAlunos(tenantId, 'LEAD', 2);
      await criarAlunos(tenantId, 'CANCELLED', 1);

      const { fatura, criada } = await faturas.emitir(
        tenantId,
        new Date('2026-04-01T03:00:00.000Z'),
        contexto,
        `corr-${randomUUID()}`,
      );

      expect(criada).toBe(true);
      expect(fatura.activeCount).toBe(3);
      // LEAD e CANCELLED sao inativos -- ADR-052 §6, pendencia 1.
      expect(fatura.inactiveCount).toBe(3);
      expect(fatura.totalMinor).toBe(3 * 500 + 3 * 250);
      expect(fatura.status).toBe('OPEN');
      expect(fatura.competence.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    });

    it('rodar duas vezes na mesma competência gera UMA fatura', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 2);

      const agora = new Date('2026-05-01T03:00:00.000Z');
      const correlacao = `corr-${randomUUID()}`;

      const primeira = await faturas.emitir(tenantId, agora, contexto, correlacao);
      const segunda = await faturas.emitir(tenantId, agora, contexto, correlacao);

      expect(primeira.criada).toBe(true);
      expect(segunda.criada).toBe(false);
      expect(segunda.fatura.id).toBe(primeira.fatura.id);

      const todas = await db.platformInvoice.findMany({ where: { tenantId } });

      expect(todas).toHaveLength(1);
    });

    it('duas emissões SIMULTÂNEAS geram uma fatura só', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 4);

      const agora = new Date('2026-06-01T03:00:00.000Z');

      /*
       * As duas chamadas passam pela leitura antes de qualquer escrita -- e
       * exatamente o caso que um `if` de idempotencia nao cobre. Quem decide
       * e a chave unica do banco.
       */
      const [a, b] = await Promise.all([
        faturas.emitir(tenantId, agora, contexto, `corr-${randomUUID()}`),
        faturas.emitir(tenantId, agora, contexto, `corr-${randomUUID()}`),
      ]);

      expect(a.fatura.id).toBe(b.fatura.id);
      expect([a.criada, b.criada].filter(Boolean)).toHaveLength(1);

      const todas = await db.platformInvoice.findMany({ where: { tenantId } });

      expect(todas).toHaveLength(1);
    });

    it('contagem congelada não muda quando o aluno muda de status depois', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 5);

      const { fatura } = await faturas.emitir(
        tenantId,
        new Date('2026-07-01T03:00:00.000Z'),
        contexto,
        `corr-${randomUUID()}`,
      );

      expect(fatura.activeCount).toBe(5);
      expect(fatura.totalMinor).toBe(5 * 500);

      // Toda a base cancela DEPOIS da emissao.
      await db.student.updateMany({ where: { tenantId }, data: { status: 'CANCELLED' } });

      const relida = await faturas.porId(fatura.id);

      expect(relida.activeCount).toBe(5);
      expect(relida.inactiveCount).toBe(0);
      expect(relida.totalMinor).toBe(5 * 500);
    });

    it('preço de inativo zero gera fatura só com os ativos', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 0);

      await criarAlunos(tenantId, 'ACTIVE', 2);
      await criarAlunos(tenantId, 'ARCHIVED', 7);

      const { fatura } = await faturas.emitir(
        tenantId,
        new Date('2026-08-01T03:00:00.000Z'),
        contexto,
        `corr-${randomUUID()}`,
      );

      expect(fatura.totalMinor).toBe(2 * 500);
      // A contagem continua gravada: entraram no calculo, custando zero.
      expect(fatura.inactiveCount).toBe(7);
    });

    it('o modelo fixo usa o valor CORRIGIDO do contrato, não o do plano', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoFixoAtivo(tenantId, 100_000);

      // Alunos existem, e no modelo fixo nao entram na conta.
      await criarAlunos(tenantId, 'ACTIVE', 40);

      // Os doze meses entre 03/2025 e 03/2026, 1% ao mes.
      for (let mes = 3; mes <= 14; mes += 1) {
        const ano = mes <= 12 ? 2025 : 2026;
        const numero = mes <= 12 ? mes : mes - 12;

        await indices.registrar(
          contexto,
          {
            code: 'IPCA',
            competencia: `${ano}-${String(numero).padStart(2, '0')}`,
            variationBasisPoints: 1_000,
          },
          `corr-${randomUUID()}`,
        );
      }

      const { fatura } = await faturas.emitir(
        tenantId,
        new Date('2026-09-01T03:00:00.000Z'),
        contexto,
        `corr-${randomUUID()}`,
      );

      // Um aniversario vencido (01/03/2026), 12 meses a 1% acumulados.
      expect(fatura.totalMinor).toBeGreaterThan(100_000);
      expect(fatura.activeCount).toBe(0);
      expect(fatura.inactiveCount).toBe(0);
      expect(fatura.activeStudentPriceMinor).toBeNull();
    });

    it('academia sem contrato vigente não fatura', async () => {
      const tenantId = await criarTenantDeTeste();

      await expect(
        faturas.emitir(tenantId, new Date('2026-04-01T03:00:00.000Z'), contexto, 'corr-x'),
      ).rejects.toMatchObject({ code: 'TENANT_CONTRACT_NOT_ACTIVE' });
    });
  });

  describe('prévia', () => {
    it('acompanha a base ao vivo enquanto a competência não foi emitida', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 2);

      const agora = new Date('2026-10-05T12:00:00.000Z');
      const antes = await faturas.previa(tenantId, agora);

      expect(antes.jaEmitida).toBe(false);
      expect(antes.totalMinor).toBe(2 * 500);

      await criarAlunos(tenantId, 'ACTIVE', 1);

      const depois = await faturas.previa(tenantId, agora);

      expect(depois.totalMinor).toBe(3 * 500);
    });

    it('mostra o que a fatura GRAVOU quando a competência já foi emitida', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 4);

      const agora = new Date('2026-11-01T03:00:00.000Z');

      await faturas.emitir(tenantId, agora, contexto, `corr-${randomUUID()}`);

      // A base cresce depois da emissao -- a previa NAO pode segui-la, ou o
      // OWNER veria dois numeros diferentes para o mesmo mes.
      await criarAlunos(tenantId, 'ACTIVE', 10);

      const previa = await faturas.previa(tenantId, agora);

      expect(previa.jaEmitida).toBe(true);
      expect(previa.totalMinor).toBe(4 * 500);
    });
  });

  describe('pagamento', () => {
    it('registra o pagamento uma vez e recusa a segunda', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 1);

      const { fatura } = await faturas.emitir(
        tenantId,
        new Date('2026-04-01T03:00:00.000Z'),
        contexto,
        `corr-${randomUUID()}`,
      );

      const pagoEm = new Date('2026-04-03T14:00:00.000Z');
      const paga = await faturas.registrarPagamento(contexto, fatura.id, pagoEm, 'corr-p');

      expect(paga.status).toBe('PAID');
      expect(paga.paidAt?.toISOString()).toBe(pagoEm.toISOString());

      await expect(
        faturas.registrarPagamento(contexto, fatura.id, new Date(), 'corr-p2'),
      ).rejects.toMatchObject({ code: 'PLATFORM_INVOICE_ALREADY_PAID' });
    });
  });

  describe('vencimento', () => {
    it('marca OVERDUE a fatura aberta cujo vencimento passou, e não a paga', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 1);

      const { fatura } = await faturas.emitir(
        tenantId,
        new Date('2026-04-01T03:00:00.000Z'),
        contexto,
        `corr-${randomUUID()}`,
      );

      await faturas.marcarVencidas(new Date('2026-04-20T00:00:00.000Z'));

      expect((await faturas.porId(fatura.id)).status).toBe('OVERDUE');

      // Vencida ainda aceita pagamento -- a academia paga atrasado.
      await faturas.registrarPagamento(
        contexto,
        fatura.id,
        new Date('2026-04-21T10:00:00.000Z'),
        'corr-p',
      );

      await faturas.marcarVencidas(new Date('2026-05-30T00:00:00.000Z'));

      // Rodar de novo NAO desfaz o pagamento.
      expect((await faturas.porId(fatura.id)).status).toBe('PAID');
    });
  });

  describe('job de emissão', () => {
    it('emite só no dia de emissão do contrato, e é idempotente no dia', async () => {
      const tenantId = await criarTenantDeTeste();
      await contratoPorAlunoAtivo(tenantId, 500, 250);
      await criarAlunos(tenantId, 'ACTIVE', 2);

      // Dia 5 -- o contrato emite no dia 1.
      await job.executarCiclo(new Date('2026-04-05T03:00:00.000Z'));

      expect(await db.platformInvoice.count({ where: { tenantId } })).toBe(0);

      // Dia 1: emite.
      await job.executarCiclo(new Date('2026-04-01T03:00:00.000Z'));
      // E de novo no mesmo dia: nao duplica.
      await job.executarCiclo(new Date('2026-04-01T09:00:00.000Z'));

      expect(await db.platformInvoice.count({ where: { tenantId } })).toBe(1);
    });
  });
});
