import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AderirARecorrenciaUseCase } from '../../src/modules/billing/aderir-a-recorrencia.use-case.js';
import { RodarCicloDeAssinaturasUseCase } from '../../src/modules/billing/rodar-ciclo-de-assinaturas.use-case.js';
import { RegistrarMetodoDePagamentoUseCase } from '../../src/modules/billing/registrar-metodo-de-pagamento.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F56 -- o ciclo que GERA a invoice do periodo e COBRA sozinho
 * (`SPEC-056` 5.3).
 *
 * E o unico caminho do sistema que debita cartao sem ninguem clicar. O teste
 * mais importante deste arquivo nao e o caso feliz: e o que prova que quem
 * NAO aderiu nao e cobrado.
 *
 * Contra banco de verdade: a reexecucao depende de INV-066 (unico por
 * `(tenant, assinatura, competencia)`) e do indice parcial de cobranca em voo.
 * Nenhum dos dois existe num dublê de banco.
 */
describe('F56 -- ciclo mensal de assinaturas', () => {
  let db: PrismaService;
  let ciclo: RodarCicloDeAssinaturasUseCase;
  let aderir: AderirARecorrenciaUseCase;
  let registrarMetodo: RegistrarMetodoDePagamentoUseCase;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  /*
   * DEPOIS do vencimento (dia 10), para que a primeira tentativa de retry
   * (D+0) esteja liberada. Antes do vencimento o retry ainda nao autoriza
   * cobrar, e o ciclo pularia todo mundo por um motivo que nao e o testado.
   */
  const AGORA = new Date('2026-08-12T12:00:00.000Z');
  const COMPETENCIA = new Date('2026-08-01T00:00:00.000Z');

  let unidadeId = '';
  let planoAssinatura = '';
  let planoSemPreco = '';

  async function novoAluno(): Promise<string> {
    const marca = randomUUID().slice(0, 8);
    const aluno = await db.student.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `MC-${marca}`,
        fullName: 'Aluno ciclo',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
        cpf: '52998224725',
      },
      select: { id: true },
    });

    return aluno.id;
  }

  async function novaAssinatura(studentId: string, planId: string): Promise<string> {
    const assinatura = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId,
        planId,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01T00:00:00Z'),
      },
      select: { id: true },
    });

    return assinatura.id;
  }

  async function comCartao(studentId: string): Promise<void> {
    await registrarMetodo.executar(contexto, {
      studentId,
      externalTokenId: `tok_${randomUUID()}`,
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });
  }

  /** Assinatura de plano ASSINATURA que JA ADERIU -- entra no ciclo. */
  async function assinanteAderido(): Promise<string> {
    const studentId = await novoAluno();
    await comCartao(studentId);
    const subscriptionId = await novaAssinatura(studentId, planoAssinatura);

    await aderir.executar(contexto, {
      subscriptionId,
      aceitouRecorrencia: true,
      actorId: contexto.actorId,
      emQue: AGORA,
    });

    return subscriptionId;
  }

  /** Plano ASSINATURA, cartao cadastrado, mas SEM adesao -- fica de fora. */
  async function assinanteSemAdesao(): Promise<string> {
    const studentId = await novoAluno();
    await comCartao(studentId);

    return novaAssinatura(studentId, planoAssinatura);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    ciclo = moduleRef.get(RodarCicloDeAssinaturasUseCase);
    aderir = comContextoDeTenant(moduleRef.get(AderirARecorrenciaUseCase));
    registrarMetodo = comContextoDeTenant(moduleRef.get(RegistrarMetodoDePagamentoUseCase));

    const tenant = await db.tenant.create({
      data: {
        slug: `f56c-${sufixo}`,
        legalName: `F56 ciclo ${sufixo} LTDA`,
        displayName: `F56 ciclo ${sufixo}`,
      },
    });
    contexto.tenantId = tenant.id;

    await db.billingSettings.create({
      data: { tenantId: tenant.id, dueDay: 10, graceDays: 3 },
    });

    await db.providerAccount.create({
      data: {
        tenantId: tenant.id,
        provider: 'getnet',
        capability: 'CARD',
        externalAccountId: `ACC-CARD-${sufixo}`,
        signingSecretEncrypted: 'nao-sai-deste-arquivo',
      },
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
    unidadeId = unidade.id;

    const comPreco = await db.plan.create({
      data: {
        tenantId: tenant.id,
        name: `Assinatura ciclo ${sufixo}`,
        billingMode: 'ASSINATURA',
        prices: {
          create: [
            {
              tenantId: tenant.id,
              amountMinor: 15000,
              currency: 'BRL',
              validFrom: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        },
      },
      select: { id: true },
    });
    planoAssinatura = comPreco.id;

    const semPreco = await db.plan.create({
      data: {
        tenantId: tenant.id,
        name: `Assinatura sem preco ${sufixo}`,
        billingMode: 'ASSINATURA',
      },
      select: { id: true },
    });
    planoSemPreco = semPreco.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  /*
   * Cada caso limpa as invoices do tenant para contar do zero -- o ciclo roda
   * sobre TODAS as assinaturas aderidas, e casos anteriores deixariam suas
   * invoices no caminho.
   */
  async function limparInvoices(): Promise<void> {
    await db.paymentAttempt.deleteMany({ where: { tenantId: contexto.tenantId } });
    await db.invoiceItem.deleteMany({ where: { tenantId: contexto.tenantId } });
    await db.invoice.deleteMany({ where: { tenantId: contexto.tenantId } });
  }

  /** Tira as assinaturas dos casos anteriores do alcance do ciclo. */
  async function isolarCaso(): Promise<void> {
    await limparInvoices();
    await db.subscription.updateMany({
      where: { tenantId: contexto.tenantId },
      data: { status: 'CANCELLED' },
    });
  }

  it('gera a invoice do periodo e cobra, sem ninguem tocar em nada', async () => {
    await isolarCaso();
    const subscriptionId = await assinanteAderido();

    const resultado = await ciclo.executar(contexto, AGORA);

    expect(resultado.assinaturasConsideradas).toBe(1);
    expect(resultado.invoicesGeradas).toBe(1);
    expect(resultado.cobrancasDisparadas).toBe(1);
    expect(resultado.puladas).toHaveLength(0);

    const invoice = await db.invoice.findFirstOrThrow({
      where: { tenantId: contexto.tenantId, subscriptionId },
      select: { billingPeriod: true, totalMinor: true, status: true },
    });

    expect(invoice.billingPeriod).toEqual(COMPETENCIA);
    // Valor COPIADO do preco vigente (INV-068), nao referenciado.
    expect(invoice.totalMinor).toBe(15000);
    /*
     * A COBRANCA NAO CONFIRMA A INVOICE -- quem confirma e o webhook
     * (INV-076). Confirmar aqui criaria um segundo caminho de escrita para
     * "invoice paga", que e o que a idempotencia existe para impedir.
     */
    expect(invoice.status).toBe('OPEN');

    const tentativa = await db.paymentAttempt.findFirstOrThrow({
      where: { tenantId: contexto.tenantId },
      select: { method: true, status: true },
    });
    expect(tentativa.method).toBe('CARD');
    expect(tentativa.status).toBe('PROCESSING');
  });

  /*
   * O TESTE MAIS IMPORTANTE DESTE ARQUIVO.
   *
   * Cobrar quem nao aderiu e debitar cartao sem autorizacao. O aluno tem
   * plano ASSINATURA e cartao ativo -- tudo menos o consentimento --, entao um
   * filtro por MODALIDADE em vez de por ADESAO passaria em todos os outros
   * casos e falharia so aqui.
   */
  it('NAO cobra quem tem cartao mas nunca aderiu', async () => {
    await isolarCaso();
    const semAdesao = await assinanteSemAdesao();

    const resultado = await ciclo.executar(contexto, AGORA);

    expect(resultado.assinaturasConsideradas).toBe(0);
    expect(resultado.cobrancasDisparadas).toBe(0);

    const invoices = await db.invoice.count({
      where: { tenantId: contexto.tenantId, subscriptionId: semAdesao },
    });
    expect(invoices).toBe(0);
  });

  it('rodar duas vezes no mesmo mes nao gera nem cobra de novo', async () => {
    await isolarCaso();
    await assinanteAderido();

    const primeira = await ciclo.executar(contexto, AGORA);
    const segunda = await ciclo.executar(contexto, AGORA);

    expect(primeira.invoicesGeradas).toBe(1);
    expect(primeira.cobrancasDisparadas).toBe(1);

    /*
     * A segunda execucao NAO gera invoice (INV-066 devolve a mesma) e NAO
     * cobra: a tentativa da primeira ainda esta em voo, e o indice parcial
     * recusa a segunda. O motivo sobe em `puladas`, nao some.
     */
    expect(segunda.invoicesGeradas).toBe(0);
    expect(segunda.cobrancasDisparadas).toBe(0);
    expect(segunda.puladas).toHaveLength(1);
    expect(segunda.puladas[0]?.motivo).toBe('CARD_CHARGE_ALREADY_IN_FLIGHT');

    const invoices = await db.invoice.count({ where: { tenantId: contexto.tenantId } });
    expect(invoices).toBe(1);
  });

  it('uma assinatura problematica nao para o ciclo das outras', async () => {
    await isolarCaso();

    const studentSemPreco = await novoAluno();
    await comCartao(studentSemPreco);
    const quebrada = await novaAssinatura(studentSemPreco, planoSemPreco);
    /*
     * Adesao normal nao passa por plano sem preco (a validacao recusa), entao
     * a recorrencia entra direto -- o cenario simula o plano que PERDEU a
     * vigencia depois da adesao, que e como isso acontece de verdade.
     */
    await db.subscription.update({
      where: { id: quebrada },
      data: { externalSubscriptionId: `fake_sub_${randomUUID()}` },
    });

    const sadia = await assinanteAderido();

    const resultado = await ciclo.executar(contexto, AGORA);

    expect(resultado.assinaturasConsideradas).toBe(2);
    // A sadia foi cobrada mesmo com a quebrada na lista.
    expect(resultado.cobrancasDisparadas).toBe(1);
    expect(resultado.puladas).toHaveLength(1);
    expect(resultado.puladas[0]).toMatchObject({
      subscriptionId: quebrada,
      motivo: 'PLAN_WITHOUT_ACTIVE_PRICE',
    });

    const daSadia = await db.invoice.count({
      where: { tenantId: contexto.tenantId, subscriptionId: sadia },
    });
    expect(daSadia).toBe(1);
  });

  it('nao cobra invoice do periodo que ja foi paga', async () => {
    await isolarCaso();
    const subscriptionId = await assinanteAderido();

    await ciclo.executar(contexto, AGORA);
    await limparInvoicesEmVoo();

    await db.invoice.updateMany({
      where: { tenantId: contexto.tenantId, subscriptionId },
      data: { status: 'PAID', paidAt: AGORA },
    });

    const resultado = await ciclo.executar(contexto, AGORA);

    expect(resultado.cobrancasDisparadas).toBe(0);
    expect(resultado.puladas[0]?.motivo).toContain('PAID');

    /*
     * NENHUMA TENTATIVA NOVA no banco -- evidencia mais forte que um contador
     * do duble: `M2-BR-002` diz que invoice paga nao volta a aberta, e cobrar
     * de novo debitaria o aluno por algo que ele ja pagou.
     */
    const tentativas = await db.paymentAttempt.count({
      where: { tenantId: contexto.tenantId },
    });
    expect(tentativas).toBe(0);
  });

  /**
   * Tira a tentativa de voo para que o proximo caso nao seja barrado pelo
   * indice parcial -- o alvo dele e outro.
   */
  async function limparInvoicesEmVoo(): Promise<void> {
    await db.paymentAttempt.deleteMany({ where: { tenantId: contexto.tenantId } });
  }
});
