import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AplicarInadimplenciaUseCase } from '../../src/modules/billing/aplicar-inadimplencia.use-case.js';
import { ConsultarInadimplenciaUseCase } from '../../src/modules/billing/consultar-inadimplencia.use-case.js';
import { LiberacaoFinanceiraUseCase } from '../../src/modules/billing/liberacao-financeira.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F15 -- inadimplencia e acesso (Slice 2.4).
 *
 * ACEITE DA SLICE, palavra por palavra: "a linha do tempo vencimento ->
 * carencia -> bloqueio -> pagamento -> desbloqueio segue datas e politicas
 * configuradas".
 *
 * Contra banco de verdade (`docs/TESTING.md` 3): a idempotencia do job E o
 * filtro por estado de origem no `updateMany`, e o desbloqueio e uma transacao
 * escrita pelo webhook. Dublar o banco provaria o `where` do TypeScript.
 */
describe('F15 -- linha do tempo da inadimplencia', () => {
  let db: PrismaService;
  let aplicar: AplicarInadimplenciaUseCase;
  let consultar: ConsultarInadimplenciaUseCase;
  let liberar: LiberacaoFinanceiraUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  let studentId = '';
  let subscriptionId = '';
  let entitlementId = '';
  let invoiceId = '';
  let periodoDeCorrida = 0;

  /** Vence 10/08 as 14:00Z. Com carencia 3 e Sao Paulo, bloqueia 13/08 03:00Z. */
  const VENCIMENTO = new Date('2026-08-10T14:00:00.000Z');
  const DENTRO_DA_CARENCIA = new Date('2026-08-12T23:00:00.000Z');
  const JA_BLOQUEIA = new Date('2026-08-13T03:00:00.000Z');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    aplicar = comContextoDeTenant(moduleRef.get(AplicarInadimplenciaUseCase));
    consultar = moduleRef.get(ConsultarInadimplenciaUseCase);
    liberar = comContextoDeTenant(moduleRef.get(LiberacaoFinanceiraUseCase));

    const tenant = await db.tenant.create({
      data: {
        slug: `f15-${sufixo}`,
        legalName: `F15 ${sufixo} LTDA`,
        displayName: `F15 ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 10, graceDays: 3 },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MTZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        membershipNumber: `M-${sufixo}`,
        fullName: 'Aluno F15',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    studentId = aluno.id;

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano F15 ${sufixo}` },
      select: { id: true },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });
    subscriptionId = assinatura.id;

    const direito = await db.entitlement.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        subscriptionId: assinatura.id,
        source: 'SUBSCRIPTION',
        status: 'ACTIVE',
        policySnapshot: {},
        startsAt: new Date('2026-08-01T00:00:00Z'),
        endsAt: new Date('2026-09-30T23:59:59Z'),
      },
      select: { id: true },
    });
    entitlementId = direito.id;

    const invoice = await db.invoice.create({
      data: {
        tenantId: tenant.id,
        subscriptionId: assinatura.id,
        studentId: aluno.id,
        billingPeriod: new Date('2026-08-01T00:00:00Z'),
        number: 1,
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 12990,
        totalMinor: 12990,
        dueAt: VENCIMENTO,
      },
      select: { id: true },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  /** Tenant descartavel, para as tentativas de cruzamento (INV-006). */
  async function tenantVazio(slug: string): Promise<string> {
    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
      select: { id: true },
    });

    return tenant.id;
  }

  it('DENTRO da carencia o job nao toca em nada', async () => {
    /**
     * O aluno tem 11 e 12 livres (ADR-019). Bloquear aqui seria negar acesso
     * a quem esta no prazo combinado -- e isso acontece na frente do cliente.
     */
    const resultado = await aplicar.executar(contexto.tenantId, DENTRO_DA_CARENCIA);

    expect(resultado).toEqual({
      invoicesVencidas: 0,
      assinaturasEmAtraso: 0,
      direitosSuspensos: 0,
    });

    const direito = await db.entitlement.findUnique({
      where: { id: entitlementId },
      select: { status: true },
    });
    expect(direito?.status).toBe('ACTIVE');
  });

  it('a tela mostra EM_CARENCIA antes do bloqueio', async () => {
    const painel = await consultar.executar(contexto, DENTRO_DA_CARENCIA);

    expect(painel.linhas).toHaveLength(1);
    expect(painel.linhas[0]?.situacao).toBe('EM_CARENCIA');
    expect(painel.resumo.bloqueados).toBe(0);
    expect(painel.resumo.emAtrasoMinor).toBe(12990);
  });

  it('no PRIMEIRO INSTANTE do bloqueio, a cadeia inteira anda', async () => {
    /**
     * A REGRA No 1 EM ACAO: invoice -> assinatura -> entitlement. A catraca
     * nao aparece nesta cadeia -- ela le entitlement depois, como sempre.
     */
    const resultado = await aplicar.executar(contexto.tenantId, JA_BLOQUEIA);

    expect(resultado).toEqual({
      invoicesVencidas: 1,
      assinaturasEmAtraso: 1,
      direitosSuspensos: 1,
    });

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, blockAt: true },
    });
    expect(invoice?.status).toBe('OVERDUE');
    /** Congelado no primeiro bloqueio -- 13/08 00:00 em Sao Paulo = 03:00Z. */
    expect(invoice?.blockAt?.toISOString()).toBe('2026-08-13T03:00:00.000Z');

    const assinatura = await db.subscription.findUnique({
      where: { id: subscriptionId },
      select: { status: true },
    });
    expect(assinatura?.status).toBe('PAST_DUE');

    const direito = await db.entitlement.findUnique({
      where: { id: entitlementId },
      select: { status: true, suspendedAt: true },
    });
    expect(direito?.status).toBe('SUSPENDED');
    expect(direito?.suspendedAt).not.toBeNull();

    /** F73 §4.2: a transicao OPEN->OVERDUE publica InvoiceOverdue. */
    const eventos = await db.outboxEvent.findMany({
      where: { tenantId: contexto.tenantId, eventType: 'InvoiceOverdue', aggregateId: invoiceId },
    });
    expect(eventos).toHaveLength(1);
  });

  it('rodar o job DE NOVO nao muda nada -- idempotente (M2-FR-013)', async () => {
    /**
     * A idempotencia nao e um `if (jaProcessei)`: cada `updateMany` filtra
     * pelo estado de ORIGEM, entao a segunda execucao nao encontra nada.
     */
    const resultado = await aplicar.executar(contexto.tenantId, JA_BLOQUEIA);

    expect(resultado).toEqual({
      invoicesVencidas: 0,
      assinaturasEmAtraso: 0,
      direitosSuspensos: 0,
    });

    /** Nao reemite InvoiceOverdue: a invoice ja era OVERDUE, nao transicionou. */
    const eventos = await db.outboxEvent.findMany({
      where: { tenantId: contexto.tenantId, eventType: 'InvoiceOverdue', aggregateId: invoiceId },
    });
    expect(eventos).toHaveLength(1);

    const direito = await db.entitlement.findUnique({
      where: { id: entitlementId },
      select: { status: true },
    });
    expect(direito?.status).toBe('SUSPENDED');
  });

  it('a tela passa a mostrar BLOQUEADO', async () => {
    const painel = await consultar.executar(contexto, JA_BLOQUEIA);

    expect(painel.linhas[0]?.situacao).toBe('BLOQUEADO');
    expect(painel.resumo.bloqueados).toBe(1);
  });

  it('a liberacao financeira aparece na tela sem apagar a divida', async () => {
    /**
     * A pergunta que traz a recepcao a tela e "este aluno entra agora?" -- mas
     * o valor, o vencimento e os dias de atraso NAO mudam. A liberacao muda o
     * acesso, nao o financeiro.
     */
    const liberacao = await liberar.conceder(contexto, {
      studentId,
      reason: 'Aluno apresentou comprovante; PIX ainda nao compensou',
      agora: JA_BLOQUEIA,
    });

    expect(liberacao.expiresAt.toISOString()).toBe('2026-08-16T03:00:00.000Z');

    const painel = await consultar.executar(contexto, JA_BLOQUEIA);

    expect(painel.linhas[0]?.liberadoAte).not.toBeNull();
    /** A situacao subjacente continua BLOQUEADO -- quem traduz e a tela. */
    expect(painel.linhas[0]?.situacao).toBe('BLOQUEADO');
    expect(painel.resumo.emAtrasoMinor).toBe(12990);

    /** O entitlement NAO foi tocado: a liberacao nao paga a fatura. */
    const direito = await db.entitlement.findUnique({
      where: { id: entitlementId },
      select: { status: true },
    });
    expect(direito?.status).toBe('SUSPENDED');
  });

  it('a liberacao EXPIRA sozinha, sem job', async () => {
    const depoisDoPrazo = new Date('2026-08-17T00:00:00.000Z');

    const vigente = await liberar.liberacaoVigente(contexto.tenantId, studentId, depoisDoPrazo);

    expect(vigente).toBeNull();
  });

  it('revogar antes do prazo encerra na hora', async () => {
    const outra = await liberar.conceder(contexto, {
      studentId,
      reason: 'Segunda liberacao, para testar revogacao',
      agora: JA_BLOQUEIA,
    });

    await liberar.revogar(contexto, { overrideId: outra.id, agora: JA_BLOQUEIA });

    const vigente = await liberar.liberacaoVigente(contexto.tenantId, studentId, JA_BLOQUEIA);

    /**
     * A PRIMEIRA liberacao continua viva -- revogar uma nao derruba a outra.
     * Encerrar as duas encurtaria um prazo que alguem concedeu de proposito.
     */
    expect(vigente).not.toBeNull();
  });

  it('revogar duas vezes falha alto, em vez de fingir sucesso', async () => {
    const outra = await liberar.conceder(contexto, {
      studentId,
      reason: 'Terceira liberacao',
      agora: JA_BLOQUEIA,
    });

    await liberar.revogar(contexto, { overrideId: outra.id, agora: JA_BLOQUEIA });

    await expect(
      liberar.revogar(contexto, { overrideId: outra.id, agora: JA_BLOQUEIA }),
    ).rejects.toThrow();
  });

  it('o pagamento DESBLOQUEIA a cadeia inteira', async () => {
    /**
     * O ULTIMO ELO DO ACEITE. Este caminho ja existia desde a F13 -- o
     * webhook de pagamento faz `PAST_DUE -> ACTIVE` e `SUSPENDED -> ACTIVE`.
     * A F15 construiu a IDA; a volta ja estava pronta antes de haver quem
     * suspendesse.
     *
     * Simula o efeito da transacao do webhook, sem depender do provedor.
     */
    await db.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt: JA_BLOQUEIA },
      });

      await tx.subscription.updateMany({
        where: { id: subscriptionId, status: { in: ['PENDING', 'PAST_DUE'] } },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });

      await tx.entitlement.updateMany({
        where: { subscriptionId, status: { in: ['SCHEDULED', 'SUSPENDED'] } },
        data: { status: 'ACTIVE', suspendedAt: null, version: { increment: 1 } },
      });
    });

    const direito = await db.entitlement.findUnique({
      where: { id: entitlementId },
      select: { status: true, suspendedAt: true },
    });
    expect(direito?.status).toBe('ACTIVE');
    expect(direito?.suspendedAt).toBeNull();

    /** E a tela esvazia: invoice paga sai da lista de inadimplencia. */
    const painel = await consultar.executar(contexto, JA_BLOQUEIA);
    expect(painel.linhas).toHaveLength(0);
    expect(painel.resumo.emAtrasoMinor).toBe(0);
  });

  it('CORRIDA: pagamento entre a leitura e a escrita NAO e desfeito pelo job', async () => {
    /**
     * DEFEITO REAL, apontado pela revisao de codigo e REPRODUZIDO antes de
     * corrigir.
     *
     * Os `subscriptionIds` vinham da leitura PRE-TRANSACAO. Se o webhook de
     * pagamento comitasse na janela entre a leitura e a escrita, o job
     * suspendia de volta um entitlement que o pagamento acabara de reativar.
     * Medido: `invoicesVencidas: 0` (a invoice ja estava paga) e
     * `direitosSuspensos: 1` -- o aluno pagava e ficava bloqueado na catraca,
     * com `suspendedAt` gravado DEPOIS do pagamento e sem explicacao.
     *
     * A intercepcao de `candidatas` simula o commit do webhook exatamente na
     * janela. Sem ela, o cenario depende de temporizacao e o teste seria
     * intermitente -- que e pior que nao ter teste.
     */
    periodoDeCorrida += 1;
    const invoiceDaCorrida = await db.invoice.create({
      data: {
        tenantId: contexto.tenantId,
        subscriptionId,
        studentId,
        billingPeriod: new Date('2026-10-01T00:00:00Z'),
        number: 90 + periodoDeCorrida,
        status: 'OPEN',
        currency: 'BRL',
        subtotalMinor: 12990,
        totalMinor: 12990,
        dueAt: VENCIMENTO,
      },
      select: { id: true },
    });

    await db.entitlement.update({
      where: { id: entitlementId },
      data: { status: 'ACTIVE', suspendedAt: null },
    });
    await db.subscription.update({ where: { id: subscriptionId }, data: { status: 'ACTIVE' } });

    const original = (
      aplicar as unknown as { candidatas: (t: string, a: Date) => Promise<unknown[]> }
    ).candidatas.bind(aplicar);

    (aplicar as unknown as { candidatas: unknown }).candidatas = async (t: string, a: Date) => {
      const lidas = await original(t, a);

      // O webhook comita AQUI, no meio da janela.
      await db.invoice.update({
        where: { id: invoiceDaCorrida.id },
        data: { status: 'PAID', paidAt: a },
      });
      await db.subscription.update({ where: { id: subscriptionId }, data: { status: 'ACTIVE' } });
      await db.entitlement.update({
        where: { id: entitlementId },
        data: { status: 'ACTIVE', suspendedAt: null },
      });

      return lidas;
    };

    try {
      const resultado = await aplicar.executar(contexto.tenantId, JA_BLOQUEIA);

      expect(resultado.direitosSuspensos).toBe(0);

      const direito = await db.entitlement.findUnique({
        where: { id: entitlementId },
        select: { status: true },
      });
      expect(direito?.status).toBe('ACTIVE');
    } finally {
      (aplicar as unknown as { candidatas: unknown }).candidatas = original;
      await db.invoice.delete({ where: { id: invoiceDaCorrida.id } });
    }
  });

  it('a soma das faixas BATE com o total em atraso', async () => {
    /**
     * INVARIANTE DO GRAFICO, e ela nao e cosmetica: as barras ficam ao lado do
     * numero grande, e se uma fatura escapar da classificacao o grafico
     * contradiz o total -- quem confere perde a confianca na tela inteira.
     *
     * O caso que escapava, achado testando os limites: BLOQUEADO com
     * `diasEmAtraso === 0`. Parece impossivel ate lembrar que academia com
     * `graceDays = 0` bloqueia na meia-noite do dia do vencimento -- uma
     * fatura que venceu as 14h ja esta bloqueada as 20h, com zero dia INTEIRO
     * de atraso. O piso da primeira faixa era 0 e a linha sumia.
     */
    const painel = await consultar.executar(contexto, JA_BLOQUEIA);

    const somaDasFaixas = painel.faixas.reduce((soma, faixa) => soma + faixa.minorTotal, 0);
    const somaDasQuantidades = painel.faixas.reduce((soma, faixa) => soma + faixa.quantidade, 0);

    expect(somaDasFaixas).toBe(painel.resumo.emAtrasoMinor);
    expect(somaDasQuantidades).toBe(painel.linhas.length);
  });

  it('bloqueado com ZERO dia de atraso nao some do grafico', async () => {
    /**
     * O caso concreto: `graceDays = 0`, fatura vencida ha poucas horas. Antes
     * da correcao ela contava no total e nao aparecia em faixa nenhuma.
     */
    const tenantSemCarencia = await tenantVazio(`zerodia-${sufixo}`);

    try {
      await db.billingSettings.create({
        data: { tenantId: tenantSemCarencia, dueDay: 10, graceDays: 0 },
      });

      const unidade = await db.gymUnit.create({
        data: {
          tenantId: tenantSemCarencia,
          code: 'MTZ',
          name: 'Matriz',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const aluno = await db.student.create({
        data: {
          tenantId: tenantSemCarencia,
          gymUnitId: unidade.id,
          membershipNumber: `Z-${sufixo}`,
          fullName: 'Aluno Zero Dia',
          birthDate: new Date('2000-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });

      const plano = await db.plan.create({
        data: { tenantId: tenantSemCarencia, name: `Plano Z ${sufixo}` },
      });

      const assinatura = await db.subscription.create({
        data: {
          tenantId: tenantSemCarencia,
          studentId: aluno.id,
          planId: plano.id,
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
        },
      });

      /** Venceu as 14h; sao 20h do MESMO dia -- zero dia inteiro de atraso. */
      await db.invoice.create({
        data: {
          tenantId: tenantSemCarencia,
          subscriptionId: assinatura.id,
          studentId: aluno.id,
          billingPeriod: new Date('2026-08-01T00:00:00Z'),
          number: 1,
          status: 'OPEN',
          currency: 'BRL',
          subtotalMinor: 9990,
          totalMinor: 9990,
          dueAt: new Date('2026-08-10T14:00:00.000Z'),
        },
      });

      const painel = await consultar.executar(
        { ...contexto, tenantId: tenantSemCarencia },
        new Date('2026-08-10T23:00:00.000Z'),
      );

      expect(painel.linhas).toHaveLength(1);
      expect(painel.linhas[0]?.diasEmAtraso).toBe(0);
      expect(painel.linhas[0]?.situacao).toBe('BLOQUEADO');

      const somaDasFaixas = painel.faixas.reduce((soma, faixa) => soma + faixa.minorTotal, 0);
      expect(somaDasFaixas).toBe(9990);
    } finally {
      await db.tenant.delete({ where: { id: tenantSemCarencia } });
    }
  });

  it('a fila vem ordenada por URGENCIA, nao por data', async () => {
    /**
     * Quem trabalha esta fila tem meia hora entre um aluno e outro. Ordenar
     * por vencimento responde "quem venceu primeiro?", que ninguem pergunta.
     *
     * O peso e `valor x dias`, e quem esta EM CARENCIA vai para o fim sempre:
     * ainda entra na academia, e cobrar quem esta no prazo combinado queima a
     * relacao por nada.
     */
    const painel = await consultar.executar(contexto, JA_BLOQUEIA);

    const situacoes = painel.linhas.map((linha) => linha.situacao);
    const primeiroEmCarencia = situacoes.indexOf('EM_CARENCIA');

    if (primeiroEmCarencia !== -1) {
      expect(situacoes.slice(primeiroEmCarencia)).not.toContain('BLOQUEADO');
    }

    const bloqueados = painel.linhas.filter((l) => l.situacao === 'BLOQUEADO');
    const pesos = bloqueados.map((l) => l.amountMinor * Math.max(l.diasEmAtraso, 1));

    expect([...pesos].sort((a, b) => b - a)).toEqual(pesos);
  });

  it('INV-006: a CONSULTA nao ve o inadimplente de outro tenant', async () => {
    /**
     * `docs/TESTING.md` 5: "todo caso de uso multi-tenant critico tem teste
     * que TENTA CRUZAR TENANTS E FALHA". A consulta le nome de aluno, valor e
     * telefone -- vazamento aqui entrega a carteira de inadimplentes de uma
     * academia para a concorrente ao lado.
     */
    const vizinho = await tenantVazio(`consulta-${sufixo}`);

    try {
      const painel = await consultar.executar({ ...contexto, tenantId: vizinho }, JA_BLOQUEIA);

      expect(painel.linhas).toHaveLength(0);
      expect(painel.resumo.emAtrasoMinor).toBe(0);
    } finally {
      await db.tenant.delete({ where: { id: vizinho } });
    }
  });

  it('INV-006: a LIBERACAO nao alcanca aluno de outro tenant', async () => {
    /**
     * O caso mais perigoso dos tres: liberar acesso de aluno alheio abriria a
     * catraca de outra academia. `studentId` vem do corpo da requisicao, e o
     * `tenantId` do contexto autenticado -- e esta assimetria e exatamente
     * onde a regra no 2 costuma vazar.
     */
    const vizinho = await tenantVazio(`liberacao-${sufixo}`);

    try {
      await expect(
        liberar.conceder(
          { ...contexto, tenantId: vizinho },
          { studentId, reason: 'tentativa de cruzar tenant', agora: JA_BLOQUEIA },
        ),
      ).rejects.toThrow();
    } finally {
      await db.tenant.delete({ where: { id: vizinho } });
    }
  });

  it('INV-006: revogar liberacao de outro tenant falha', async () => {
    const liberacao = await liberar.conceder(contexto, {
      studentId,
      reason: 'liberacao para testar revogacao cruzada',
      agora: JA_BLOQUEIA,
    });

    const vizinho = await tenantVazio(`revoga-${sufixo}`);

    try {
      await expect(
        liberar.revogar(
          { ...contexto, tenantId: vizinho },
          { overrideId: liberacao.id, agora: JA_BLOQUEIA },
        ),
      ).rejects.toThrow();

      /** E a liberacao original continua viva -- nao foi tocada. */
      const viva = await db.financialAccessOverride.findUnique({
        where: { id: liberacao.id },
        select: { revokedAt: true },
      });
      expect(viva?.revokedAt).toBeNull();
    } finally {
      await db.tenant.delete({ where: { id: vizinho } });
    }
  });

  it('nao atravessa tenant: o job de um nao mexe no outro', async () => {
    /**
     * Regra de arquitetura no 2. Um job financeiro que vazasse entre tenants
     * suspenderia o acesso de alunos de OUTRA academia.
     */
    const vizinho = await db.tenant.create({
      data: {
        slug: `f15-viz-${sufixo}`,
        legalName: `Vizinho ${sufixo} LTDA`,
        displayName: `Vizinho ${sufixo}`,
      },
    });

    try {
      const resultado = await aplicar.executar(vizinho.id, JA_BLOQUEIA);

      expect(resultado).toEqual({
        invoicesVencidas: 0,
        assinaturasEmAtraso: 0,
        direitosSuspensos: 0,
      });
    } finally {
      await db.tenant.delete({ where: { id: vizinho.id } });
    }
  });
});
