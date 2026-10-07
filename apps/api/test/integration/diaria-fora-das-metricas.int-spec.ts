import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { ConsultarInadimplenciaUseCase } from '../../src/modules/billing/consultar-inadimplencia.use-case.js';
import { ConsultarResumoFinanceiroUseCase } from '../../src/modules/billing/consultar-resumo-financeiro.use-case.js';
import {
  PORTA_DE_PRAZO,
  type PortaDePrazo,
} from '../../src/modules/notifications/notification-deadline.repository.js';
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
 * CANARIO (F86): a diaria existe no cenario e o indicador NAO se mexe. Cada
 * `expect` abaixo falha se o filtro `plan.billingMode != DIARIA` sair do leitor --
 * e todos passariam por acaso num cenario sem diaria, que e o que o canario evita.
 */
describe('F86 -- diaria fora das metricas', () => {
  let db: PrismaService;
  let c: CenarioDeDiaria;
  let resumo: ConsultarResumoFinanceiroUseCase;
  let inadimplencia: ConsultarInadimplenciaUseCase;
  let prazos: PortaDePrazo;
  let assinaturaMensalId = '';
  let assinaturaDiariaId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    resumo = comContextoDeTenant(moduleRef.get(ConsultarResumoFinanceiroUseCase));
    inadimplencia = comContextoDeTenant(moduleRef.get(ConsultarInadimplenciaUseCase));
    prazos = moduleRef.get<PortaDePrazo>(PORTA_DE_PRAZO);
    const billing = comContextoDeTenant(moduleRef.get(BillingRepository));

    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));

    const mensal = await criarPlano(db, c, {
      nome: `Mensal ${c.sufixo}`,
      billingMode: 'AVULSO',
      amountMinor: 15000,
    });
    const diaria = await criarPlano(db, c, { nome: `Diaria ${c.sufixo}` });

    // Aluno A: mensalista, com a parcela de setembro em atraso (OPEN, vencida em 09/09).
    const alunoMensal = await criarAluno(db, c);
    const mensalSub = await db.subscription.create({
      data: {
        tenantId: c.tenantId,
        studentId: alunoMensal,
        planId: mensal,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2026-10-09T12:00:00Z'), // vence em ~2 dias de AGORA: entra na janela do aviso
      },
    });
    assinaturaMensalId = mensalSub.id;
    await billing.abrirInvoiceDoPeriodo(contextoDe(c), {
      subscriptionId: mensalSub.id,
      emQue: new Date('2026-09-15T12:00:00Z'),
    });

    // Aluno B: so diaria, ACTIVE e vencendo hoje a meia-noite (tambem na janela do aviso).
    const alunoDiaria = await criarAluno(db, c);
    const diariaSub = await db.subscription.create({
      data: {
        tenantId: c.tenantId,
        studentId: alunoDiaria,
        planId: diaria,
        status: 'ACTIVE',
        startsAt: AGORA,
        endsAt: FIM_DO_DIA,
      },
    });
    assinaturaDiariaId = diariaSub.id;
  });

  afterAll(async () => {
    await apagarCenario(db, c);
  });

  it('alunos ativos e receita esperada contam so a mensalidade', async () => {
    const r = await resumo.executar(contextoDe(c), {
      de: new Date('2026-10-01T00:00:00Z'),
      ate: new Date('2026-10-07T00:00:00Z'),
      agora: AGORA,
    });

    expect(r.alunosAtivos).toBe(1);
    expect(r.receitaEsperadaMinor).toBe(15000);
  });

  it('a taxa de inadimplencia nao ganha pagante por causa da diaria', async () => {
    const painel = await inadimplencia.executar(contextoDe(c), AGORA);

    // 1 aluno inadimplente / 1 pagante = 100%. Com a diaria contada, seria 1/2 = 50%.
    expect(painel.resumo.taxaDeInadimplencia).toBe(100);
  });

  it('quem pagou a diaria NAO recebe "plano vence em breve" -- a mensalidade que vence continua avisada', async () => {
    const ids = (await prazos.assinaturasAtivasSemAvisoDeVencimento(AGORA)).map((s) => s.id);

    expect(ids).toContain(assinaturaMensalId); // controle: a consulta enxerga o que deve
    expect(ids).not.toContain(assinaturaDiariaId);
  });
});
