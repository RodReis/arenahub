import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { ExpirarAssinaturasVencidasUseCase } from '../../src/modules/billing/expirar-assinaturas-vencidas.use-case.js';
import { MembershipRepository } from '../../src/modules/membership/membership.repository.js';
import { VenderDiariaUseCase } from '../../src/modules/membership/vender-diaria.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  AGORA,
  FIM_DO_DIA,
  apagarCenario,
  contextoDe,
  criarAluno,
  criarCenarioDeDiaria,
  criarPlano,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * Diaria avulsa no balcao (F86, issue #616): o aluno sem plano paga R$ 30,00 e
 * usa a academia ate 23:59. Contra banco de verdade (`docs/TESTING.md` 3): a
 * atomicidade, a trava do aluno e a promocao pelo pagamento sao comportamento
 * do Postgres -- dublar o banco provaria so a sintaxe do TypeScript.
 */
describe('F86 -- diaria avulsa no balcao', () => {
  let db: PrismaService;
  let membership: MembershipRepository;
  let billing: BillingRepository;
  let venderDiaria: VenderDiariaUseCase;
  let membershipCru: MembershipRepository;
  let expirar: ExpirarAssinaturasVencidasUseCase;
  let c: CenarioDeDiaria;
  let semConfiguracao: CenarioDeDiaria;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    membership = comContextoDeTenant(moduleRef.get(MembershipRepository));
    billing = comContextoDeTenant(moduleRef.get(BillingRepository));
    venderDiaria = comContextoDeTenant(moduleRef.get(VenderDiariaUseCase));
    membershipCru = moduleRef.get(MembershipRepository);
    expirar = moduleRef.get(ExpirarAssinaturasVencidasUseCase);
    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));
    semConfiguracao = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService), {
      comConfiguracaoFinanceira: false,
    });
  });

  afterAll(async () => {
    await apagarCenario(db, c);
    await apagarCenario(db, semConfiguracao);
  });

  it('persiste plano com a modalidade DIARIA', async () => {
    const plano = await membership.criarPlano(
      contextoDe(c),
      {
        name: `Diaria ${c.sufixo}`,
        gymUnitIds: [c.unidadeId],
        janelas: [{ gymUnitId: c.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 }],
        amountMinor: 3000,
        billingMode: 'DIARIA',
      },
      'corr-f86',
      AGORA,
    );

    expect(plano.billingMode).toBe('DIARIA');
  });

  describe('abrirInvoiceDoPeriodo -- vencimento', () => {
    /** Assinatura direta no banco: o que se testa aqui e a invoice, nao a venda. */
    async function assinaturaDe(planId: string): Promise<string> {
      const studentId = await criarAluno(db, c);
      const assinatura = await db.subscription.create({
        data: {
          tenantId: c.tenantId,
          studentId,
          planId,
          status: 'ACTIVE',
          startsAt: AGORA,
          endsAt: FIM_DO_DIA,
        },
        select: { id: true },
      });

      return assinatura.id;
    }

    it('usa o vencimento informado, sem tocar no dia de vencimento do tenant', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria venc ${c.sufixo}` });
      const subscriptionId = await assinaturaDe(planId);

      const invoice = await billing.abrirInvoiceDoPeriodo(contextoDe(c), {
        subscriptionId,
        emQue: AGORA,
        vencimento: { dueAt: AGORA, blockAt: FIM_DO_DIA },
      });

      expect(invoice.dueAt.toISOString()).toBe(AGORA.toISOString());
      expect(invoice.blockAt?.toISOString()).toBe(FIM_DO_DIA.toISOString());
      expect(invoice.totalMinor).toBe(3000);
      expect(invoice.status).toBe('OPEN');
    });

    it('sem vencimento informado, mantem o ciclo mensal (dia 9 + 3 dias de carencia)', async () => {
      const planId = await criarPlano(db, c, {
        nome: `Mensal venc ${c.sufixo}`,
        billingMode: 'AVULSO',
        amountMinor: 15000,
      });
      const subscriptionId = await assinaturaDe(planId);

      const invoice = await billing.abrirInvoiceDoPeriodo(contextoDe(c), {
        subscriptionId,
        emQue: AGORA,
      });

      expect(invoice.dueAt.toISOString()).toBe('2026-10-09T00:00:00.000Z');
      expect(invoice.blockAt?.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    });
  });

  describe('VenderDiariaUseCase', () => {
    const venda = (
      studentId: string,
      planId: string,
      mais: Partial<{
        expectedTotalMinor: number;
        receivedAmountMinor: number;
        channel: 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO';
      }> = {},
    ) => ({
      studentId,
      planId,
      channel: 'DINHEIRO' as const,
      expectedTotalMinor: 3000,
      ...mais,
    });

    const linhasDo = async (studentId: string) => ({
      assinaturas: await db.subscription.count({ where: { tenantId: c.tenantId, studentId } }),
      direitos: await db.entitlement.count({ where: { tenantId: c.tenantId, studentId } }),
      invoices: await db.invoice.count({ where: { tenantId: c.tenantId, studentId } }),
      pagamentos: await db.payment.count({
        where: { tenantId: c.tenantId, invoice: { studentId } },
      }),
    });

    const NADA = { assinaturas: 0, direitos: 0, invoices: 0, pagamentos: 0 };

    it('vende: assinatura, direito, invoice e pagamento nascem juntos e o acesso vale ate a meia-noite', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria feliz ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      const vendida = await venderDiaria.executar(
        contextoDe(c),
        venda(studentId, planId),
        'corr-1',
        AGORA,
      );

      expect(vendida.startsAt.toISOString()).toBe(AGORA.toISOString());
      expect(vendida.endsAt.toISOString()).toBe(FIM_DO_DIA.toISOString());

      const assinatura = await db.subscription.findUniqueOrThrow({
        where: { id: vendida.subscriptionId },
      });
      expect(assinatura.status).toBe('ACTIVE');
      expect(assinatura.endsAt?.toISOString()).toBe(FIM_DO_DIA.toISOString());

      const direito = await db.entitlement.findFirstOrThrow({
        where: { subscriptionId: vendida.subscriptionId },
      });
      expect(direito.status).toBe('ACTIVE');
      expect(direito.source).toBe('SUBSCRIPTION');
      expect(direito.endsAt.toISOString()).toBe(FIM_DO_DIA.toISOString());

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: vendida.invoiceId } });
      expect(invoice.status).toBe('PAID');
      expect(invoice.totalMinor).toBe(3000);
      expect(invoice.dueAt.toISOString()).toBe(AGORA.toISOString());

      const pagamento = await db.payment.findUniqueOrThrow({ where: { id: vendida.paymentId } });
      expect(pagamento.status).toBe('CONFIRMED');
      expect(pagamento.method).toBe('MANUAL');
      expect(pagamento.receivedVia).toBe('DINHEIRO');
      expect(pagamento.amountMinor).toBe(3000);
    });

    it('o repositorio cria a diaria ESPERANDO o pagamento: PENDING e SCHEDULED', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria pendente ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      const plano = await membershipCru.encontrarPlano(contextoDe(c), planId);

      class Desfazer extends Error {}

      await expect(
        db.$transaction(async (tx) => {
          const criada = await membershipCru.criarDiariaPendente(
            tx,
            contextoDe(c),
            { studentId, plano: plano!, startsAt: AGORA, endsAt: FIM_DO_DIA },
            'corr-pendente',
          );

          expect(criada.subscription.status).toBe('PENDING');
          expect(criada.entitlement.status).toBe('SCHEDULED');

          throw new Desfazer();
        }),
      ).rejects.toBeInstanceOf(Desfazer);

      expect(await linhasDo(studentId)).toEqual(NADA);
    });

    it('troco: valor recebido maior vira credito do aluno', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria troco ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await venderDiaria.executar(
        contextoDe(c),
        venda(studentId, planId, { receivedAmountMinor: 5000 }),
        'corr-troco',
        AGORA,
      );

      const credito = await db.accountCredit.findFirstOrThrow({
        where: { tenantId: c.tenantId, studentId },
      });
      expect(credito.amountMinor).toBe(2000);
    });

    it('valor recebido menor que o preco: recusa e NADA fica gravado', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria parcial ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await expect(
        venderDiaria.executar(
          contextoDe(c),
          venda(studentId, planId, { receivedAmountMinor: 1000 }),
          'corr-parcial',
          AGORA,
        ),
      ).rejects.toThrow();

      expect(await linhasDo(studentId)).toEqual(NADA);
    });

    it('tenant sem configuracao financeira: recusa e NADA fica gravado', async () => {
      const planId = await criarPlano(db, semConfiguracao, { nome: `Diaria sem cfg ${c.sufixo}` });
      const studentId = await criarAluno(db, semConfiguracao);

      await expect(
        venderDiaria.executar(
          contextoDe(semConfiguracao),
          venda(studentId, planId),
          'corr-sem-cfg',
          AGORA,
        ),
      ).rejects.toMatchObject({ code: 'BILLING_SETTINGS_MISSING' });

      expect(
        await db.subscription.count({ where: { tenantId: semConfiguracao.tenantId, studentId } }),
      ).toBe(0);
      expect(
        await db.entitlement.count({ where: { tenantId: semConfiguracao.tenantId, studentId } }),
      ).toBe(0);
    });

    it('aluno com plano vigente: 409', async () => {
      const mensal = await criarPlano(db, c, {
        nome: `Mensal vigente ${c.sufixo}`,
        billingMode: 'AVULSO',
        amountMinor: 15000,
      });
      const diaria = await criarPlano(db, c, { nome: `Diaria barrada ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      await db.subscription.create({
        data: { tenantId: c.tenantId, studentId, planId: mensal, status: 'ACTIVE', startsAt: AGORA },
      });

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, diaria), 'corr-vigente', AGORA),
      ).rejects.toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
    });

    it('depois de vendida, a segunda diaria no mesmo dia e recusada', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria dupla ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-d1', AGORA);

      await expect(
        venderDiaria.executar(
          contextoDe(c),
          venda(studentId, planId),
          'corr-d2',
          new Date(AGORA.getTime() + 3_600_000),
        ),
      ).rejects.toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
    });

    it('duas vendas AO MESMO TEMPO para o mesmo aluno: uma passa, a outra recebe 409, um so pagamento', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria corrida ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      const resultados = await Promise.allSettled([
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-a', AGORA),
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-b', AGORA),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejeitada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejeitada.reason).toMatchObject({ code: 'STUDENT_HAS_ACTIVE_SUBSCRIPTION' });
      expect(await linhasDo(studentId)).toEqual({
        assinaturas: 1,
        direitos: 1,
        invoices: 1,
        pagamentos: 1,
      });
    });

    it('no dia seguinte, depois de a diaria expirar, o aluno compra outra', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria retorno ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      await venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-r1', AGORA);

      const amanha = new Date(AGORA.getTime() + 24 * 3_600_000);
      await expirar.executar(c.tenantId, amanha);

      const segunda = await venderDiaria.executar(
        contextoDe(c),
        venda(studentId, planId),
        'corr-r2',
        amanha,
      );
      expect(segunda.endsAt.toISOString()).toBe('2026-10-09T03:00:00.000Z');
      expect(await db.subscription.count({ where: { tenantId: c.tenantId, studentId } })).toBe(2);
    });

    it('reajuste no MEIO do mes: vende e cobra o preco vigente na compra, nao o da competencia', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria reajustada ${c.sufixo}` });
      // R$ 35,00 vigente desde 00:00Z de hoje (07/10), dia 7 do mes: a tela mostra 3500.
      await db.planPrice.create({
        data: {
          tenantId: c.tenantId,
          planId,
          amountMinor: 3500,
          validFrom: new Date('2026-10-07T00:00:00.000Z'),
        },
      });
      const studentId = await criarAluno(db, c);

      await expect(
        venderDiaria.executar(
          contextoDe(c),
          venda(studentId, planId, { expectedTotalMinor: 3000 }),
          'corr-reajuste-velho',
          AGORA,
        ),
      ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });

      const vendida = await venderDiaria.executar(
        contextoDe(c),
        venda(studentId, planId, { expectedTotalMinor: 3500 }),
        'corr-reajuste-novo',
        AGORA,
      );

      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: vendida.invoiceId } });
      expect(invoice.totalMinor).toBe(3500);
    });

    it('preco mudou depois de a tela abrir: 409 PRICE_CHANGED', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria preco ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await expect(
        venderDiaria.executar(
          contextoDe(c),
          venda(studentId, planId, { expectedTotalMinor: 2500 }),
          'corr-preco',
          AGORA,
        ),
      ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    });

    it('plano mensal ou inativo nao e diaria: 422', async () => {
      const mensal = await criarPlano(db, c, {
        nome: `Mensal nao diaria ${c.sufixo}`,
        billingMode: 'AVULSO',
      });
      const inativa = await criarPlano(db, c, { nome: `Diaria inativa ${c.sufixo}`, ativo: false });
      const studentId = await criarAluno(db, c);

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, mensal), 'corr-m', AGORA),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_INVALID' });
      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, inativa), 'corr-i', AGORA),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_INVALID' });
    });

    it('domingo, com plano que so abre de segunda a sexta: 422 e nada gravado', async () => {
      const planId = await criarPlano(db, c, {
        nome: `Diaria dia util ${c.sufixo}`,
        diasComJanela: [1, 2, 3, 4, 5],
      });
      const studentId = await criarAluno(db, c);
      const domingo = new Date('2026-10-11T15:00:00.000Z');

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-dom', domingo),
      ).rejects.toMatchObject({ code: 'DAY_PASS_CLOSED_TODAY' });

      expect(await linhasDo(studentId)).toEqual(NADA);
    });

    it('aluno bloqueado: STUDENT_NOT_ELIGIBLE e nada gravado', async () => {
      const planId = await criarPlano(db, c, { nome: `Diaria bloqueado ${c.sufixo}` });
      const studentId = await criarAluno(db, c, 'BLOCKED');

      await expect(
        venderDiaria.executar(contextoDe(c), venda(studentId, planId), 'corr-bloq', AGORA),
      ).rejects.toMatchObject({ code: 'STUDENT_NOT_ELIGIBLE' });

      expect(await linhasDo(studentId)).toEqual(NADA);
    });

    it('aluno ou plano de OUTRO tenant: 404', async () => {
      const planoDeFora = await criarPlano(db, semConfiguracao, {
        nome: `Diaria de fora ${c.sufixo}`,
      });
      const alunoDeFora = await criarAluno(db, semConfiguracao);
      const planoDeDentro = await criarPlano(db, c, { nome: `Diaria de dentro ${c.sufixo}` });

      await expect(
        venderDiaria.executar(
          contextoDe(c),
          venda(await criarAluno(db, c), planoDeFora),
          'corr-x1',
          AGORA,
        ),
      ).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
      await expect(
        venderDiaria.executar(
          contextoDe(c),
          venda(alunoDeFora, planoDeDentro),
          'corr-x2',
          AGORA,
        ),
      ).rejects.toMatchObject({ code: 'STUDENT_NOT_FOUND' });
    });
  });

  describe('plano de diaria nao se atribui nem se troca', () => {
    it('POST /subscriptions (ativarAssinatura) com plano DIARIA: 422 e nada gravado', async () => {
      const diaria = await criarPlano(db, c, { nome: `Diaria nao atribuivel ${c.sufixo}` });
      const studentId = await criarAluno(db, c);

      await expect(
        membership.ativarAssinatura(
          contextoDe(c),
          {
            studentId,
            planId: diaria,
            startsAt: AGORA,
            endsAt: new Date('2027-10-07T00:00:00Z'),
            reason: 'tentativa de acesso gratis',
          },
          'corr-guarda-1',
        ),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_NOT_ASSIGNABLE' });

      expect(await db.subscription.count({ where: { tenantId: c.tenantId, studentId } })).toBe(0);
    });

    it('agendar troca para plano DIARIA: 422', async () => {
      const mensal = await criarPlano(db, c, {
        nome: `Mensal origem ${c.sufixo}`,
        billingMode: 'AVULSO',
        amountMinor: 15000,
      });
      const diaria = await criarPlano(db, c, { nome: `Diaria destino ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      const assinatura = await db.subscription.create({
        data: { tenantId: c.tenantId, studentId, planId: mensal, status: 'ACTIVE', startsAt: AGORA },
      });

      await expect(
        membership.agendarTrocaDePlano(
          contextoDe(c),
          assinatura.id,
          { planId: diaria, versaoEsperada: assinatura.version, reason: 'tentativa' },
          'corr-guarda-2',
          AGORA,
        ),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_NOT_ASSIGNABLE' });
    });

    it('trocar plano no ato para plano DIARIA: 422', async () => {
      const mensal = await criarPlano(db, c, {
        nome: `Mensal origem agora ${c.sufixo}`,
        billingMode: 'AVULSO',
        amountMinor: 15000,
      });
      const diaria = await criarPlano(db, c, { nome: `Diaria destino agora ${c.sufixo}` });
      const studentId = await criarAluno(db, c);
      const assinatura = await db.subscription.create({
        data: { tenantId: c.tenantId, studentId, planId: mensal, status: 'ACTIVE', startsAt: AGORA },
      });

      await expect(
        membership.trocarPlanoDaAssinatura(
          contextoDe(c),
          assinatura.id,
          { planId: diaria, versaoEsperada: assinatura.version, reason: 'tentativa' },
          'corr-guarda-3',
          AGORA,
          () => Promise.reject(new Error('nao deveria chegar a reabrir parcela')),
        ),
      ).rejects.toMatchObject({ code: 'DAY_PASS_PLAN_NOT_ASSIGNABLE' });
    });
  });
});
