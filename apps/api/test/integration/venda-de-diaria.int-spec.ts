import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { MembershipRepository } from '../../src/modules/membership/membership.repository.js';
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
  let c: CenarioDeDiaria;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    membership = comContextoDeTenant(moduleRef.get(MembershipRepository));
    billing = comContextoDeTenant(moduleRef.get(BillingRepository));
    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));
  });

  afterAll(async () => {
    await apagarCenario(db, c);
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
});
