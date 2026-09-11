import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import {
  AderirARecorrenciaUseCase,
  AdesaoJaEmAndamentoError,
} from '../../src/modules/billing/aderir-a-recorrencia.use-case.js';
import { AdesaoInvalidaError } from '../../src/modules/billing/domain/assinatura-mensal.js';
import { CancelarRecorrenciaUseCase } from '../../src/modules/billing/cancelar-recorrencia.use-case.js';
import { FakePaymentProvider } from '../../src/modules/billing/provider/fake-payment-provider.adapter.js';
import { PAYMENT_PROVIDER } from '../../src/modules/billing/provider/payment-provider.port.js';
import { RegistrarMetodoDePagamentoUseCase } from '../../src/modules/billing/registrar-metodo-de-pagamento.use-case.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F56 -- plano com assinatura mensal (`SPEC-056`; ADR-043, Decisoes 2 e 5).
 *
 * Contra banco de verdade (`docs/TESTING.md` 3): a adesao concorrente e
 * barrada por um `updateMany` condicionado e por um indice unico PARCIAL do
 * Postgres. Dublar o banco provaria o `where` do TypeScript, nao a garantia
 * -- e foi esse tipo de teste que deixou a F53 cobrar em dobro.
 *
 * AS ASSERCOES OLHAM O ESTADO NO PROVEDOR (`recorrenciasInstaladas`,
 * `temRecorrenciaViva`), nao o id devolvido: o id diz o que voltou daquela
 * chamada; o que cobra o aluno no mes seguinte e o que ficou de pe.
 */
describe('F56 -- plano com assinatura mensal', () => {
  let db: PrismaService;
  let aderir: AderirARecorrenciaUseCase;
  let cancelar: CancelarRecorrenciaUseCase;
  let registrarMetodo: RegistrarMetodoDePagamentoUseCase;
  let fake: FakePaymentProvider;

  const sufixo = randomUUID().slice(0, 8);
  const contexto: TenantContext = {
    tenantId: '',
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set(),
    allowedUnitIds: 'ALL',
  };

  const AGORA = new Date('2026-08-25T12:00:00.000Z');

  let unidadeId = '';
  let planoAssinatura = '';
  let planoAvulso = '';

  /** Aluno novo por caso: metodo de pagamento e CPF sao por aluno. */
  async function novoAluno(opcoes: { cpf?: string | null } = {}): Promise<string> {
    const marca = randomUUID().slice(0, 8);
    const aluno = await db.student.create({
      data: {
        tenantId: contexto.tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `M56-${marca}`,
        fullName: 'Aluno F56',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
        cpf: opcoes.cpf === undefined ? '52998224725' : opcoes.cpf,
      },
      select: { id: true },
    });

    return aluno.id;
  }

  async function novaAssinatura(
    studentId: string,
    planId: string,
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' = 'ACTIVE',
  ): Promise<string> {
    const assinatura = await db.subscription.create({
      data: {
        tenantId: contexto.tenantId,
        studentId,
        planId,
        status,
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

  /** Aluno com CPF, cartao e assinatura de plano ASSINATURA -- o caso feliz. */
  async function alunoPronto(): Promise<string> {
    const studentId = await novoAluno();
    await comCartao(studentId);

    return novaAssinatura(studentId, planoAssinatura);
  }

  function adesao(subscriptionId: string, aceitou = true) {
    return aderir.executar(contexto, {
      subscriptionId,
      aceitouRecorrencia: aceitou,
      actorId: contexto.actorId,
      emQue: AGORA,
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    aderir = comContextoDeTenant(moduleRef.get(AderirARecorrenciaUseCase));
    cancelar = moduleRef.get(CancelarRecorrenciaUseCase);
    registrarMetodo = comContextoDeTenant(moduleRef.get(RegistrarMetodoDePagamentoUseCase));
    fake = moduleRef.get(PAYMENT_PROVIDER);

    const tenant = await db.tenant.create({
      data: {
        slug: `f56-${sufixo}`,
        legalName: `F56 ${sufixo} LTDA`,
        displayName: `F56 ${sufixo}`,
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
        name: `Assinatura F56 ${sufixo}`,
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

    const avulso = await db.plan.create({
      data: { tenantId: tenant.id, name: `Avulso F56 ${sufixo}` },
      select: { id: true },
    });
    planoAvulso = avulso.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: contexto.tenantId } });
  });

  describe('modalidade do plano', () => {
    /*
     * O DEFAULT E `AVULSO`, e isso nao e detalhe de migration: qualquer outro
     * cobraria, no proximo ciclo, aluno de plano ja vendido que nunca
     * autorizou recorrencia.
     */
    it('plano nasce AVULSO quando ninguem escolhe', async () => {
      const plano = await db.plan.findUniqueOrThrow({
        where: { id: planoAvulso },
        select: { billingMode: true },
      });

      expect(plano.billingMode).toBe('AVULSO');
    });
  });

  describe('adesao', () => {
    it('instala UMA recorrencia e registra o aceite', async () => {
      const subscriptionId = await alunoPronto();
      const antes = fake.recorrenciasInstaladas;

      const resultado = await adesao(subscriptionId);

      // ESTADO NO PROVEDOR, nao o id devolvido.
      expect(fake.recorrenciasInstaladas).toBe(antes + 1);

      const assinatura = await db.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        select: {
          externalSubscriptionId: true,
          recurrenceConsentAt: true,
          recurrenceConsentActorId: true,
          status: true,
        },
      });

      expect(assinatura.externalSubscriptionId).toBe(resultado.externalSubscriptionId);
      expect(assinatura.recurrenceConsentAt).toEqual(AGORA);
      expect(assinatura.recurrenceConsentActorId).toBe(contexto.actorId);
      // A ADESAO NAO MUDA O STATUS: ela autoriza cobranca, nao concede acesso.
      expect(assinatura.status).toBe('ACTIVE');
    });

    it('devolve o preco vigente e o dia de vencimento do tenant', async () => {
      const subscriptionId = await alunoPronto();

      const resultado = await adesao(subscriptionId);

      expect(resultado.amountMinor).toBe(15000);
      expect(resultado.currency).toBe('BRL');
      expect(resultado.dueDay).toBe(10);
    });

    it('recusa plano avulso, e NAO chama o provedor', async () => {
      const studentId = await novoAluno();
      await comCartao(studentId);
      const subscriptionId = await novaAssinatura(studentId, planoAvulso);
      const antes = fake.recorrenciasInstaladas;

      await expect(adesao(subscriptionId)).rejects.toThrow(AdesaoInvalidaError);

      /*
       * Recusar DEPOIS de chamar o provedor deixaria uma recorrencia viva sem
       * nada apontando para ela -- o defeito da Decisao 5, por outra porta.
       */
      expect(fake.recorrenciasInstaladas).toBe(antes);
    });

    it('recusa aluno sem CPF (ADR-043, Decisao 3)', async () => {
      const studentId = await novoAluno({ cpf: null });
      await comCartao(studentId);
      const subscriptionId = await novaAssinatura(studentId, planoAssinatura);

      await expect(adesao(subscriptionId)).rejects.toMatchObject({
        code: 'STUDENT_CPF_REQUIRED',
      });
    });

    it('recusa aluno sem cartao ativo', async () => {
      const studentId = await novoAluno();
      const subscriptionId = await novaAssinatura(studentId, planoAssinatura);

      await expect(adesao(subscriptionId)).rejects.toMatchObject({
        code: 'PAYMENT_METHOD_MISSING',
      });
    });

    it('recusa sem aceite explicito: debito surpresa e o que gera contestacao', async () => {
      const subscriptionId = await alunoPronto();

      await expect(adesao(subscriptionId, false)).rejects.toMatchObject({
        code: 'RECURRENCE_CONSENT_REQUIRED',
      });
    });

    it('aceita adesao de assinatura em ATRASO -- e quem se quer de volta ao dia', async () => {
      const studentId = await novoAluno();
      await comCartao(studentId);
      const subscriptionId = await novaAssinatura(studentId, planoAssinatura, 'PAST_DUE');

      await expect(adesao(subscriptionId)).resolves.toMatchObject({ subscriptionId });
    });

    it('aderir duas vezes NAO instala a segunda recorrencia', async () => {
      const subscriptionId = await alunoPronto();

      await adesao(subscriptionId);
      const depoisDaPrimeira = fake.recorrenciasInstaladas;

      await expect(adesao(subscriptionId)).rejects.toMatchObject({
        code: 'RECURRENCE_ALREADY_ACTIVE',
      });

      expect(fake.recorrenciasInstaladas).toBe(depoisDaPrimeira);
    });

    /*
     * A F53 cobrou o aluno em dobro porque a exclusao vivia num `if` que lia
     * antes de escrever. Aqui as duas chamadas passam pela validacao (leem o
     * mesmo estado) e chegam juntas ao provedor -- que devolve o MESMO id
     * pela chave idempotente. Quem perde a corrida bate no `updateMany`
     * condicionado a `externalSubscriptionId: null`.
     */
    it('duas adesoes CONCORRENTES instalam uma recorrencia so', async () => {
      const subscriptionId = await alunoPronto();
      const antes = fake.recorrenciasInstaladas;

      const resultados = await Promise.allSettled([
        adesao(subscriptionId),
        adesao(subscriptionId),
      ]);

      const sucessos = resultados.filter((r) => r.status === 'fulfilled');
      const falhas = resultados.filter((r) => r.status === 'rejected');

      expect(sucessos).toHaveLength(1);
      expect(fake.recorrenciasInstaladas).toBe(antes + 1);

      /*
       * O TIPO do erro da perdedora, nao so "falhou": `sucessos: 1` sozinho e
       * satisfeito por qualquer falha, inclusive FK quebrada -- foi assim que
       * o teste de concorrencia da F53 passou verde sem medir nada.
       */
      const perdedora = falhas[0];
      expect(perdedora?.status === 'rejected' && perdedora.reason).toBeInstanceOf(
        AdesaoJaEmAndamentoError,
      );

      const assinatura = await db.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        select: { externalSubscriptionId: true },
      });
      expect(assinatura.externalSubscriptionId).not.toBeNull();
    });
    /*
     * A JANELA ENTRE O PROVEDOR E O BANCO -- achado da revisao deste PR.
     *
     * A adesao chama o provedor ANTES de gravar (ordem oposta a da cobranca,
     * onde gravar antes protege dinheiro que sai sem registro). Se o processo
     * morrer no meio, fica uma recorrencia viva no provedor sem nada no
     * ArenaHub apontando para ela: cobra o aluno todo mes e ninguem consegue
     * cancelar -- o defeito da Decisao 5, por outra porta.
     *
     * O que fecha a janela e a chave `sub:<id>` ser derivada da ASSINATURA, e
     * nao de contagem ou de relogio: a proxima tentativa reenvia a MESMA
     * chave, o provedor devolve o MESMO id e a gravacao completa. Sem
     * instalar a segunda recorrencia.
     */
    it('recupera a adesao interrompida entre o provedor e o banco', async () => {
      const subscriptionId = await alunoPronto();
      const antes = fake.recorrenciasInstaladas;

      // Primeira adesao completa...
      const primeira = await adesao(subscriptionId);

      // ...e o banco perde a gravacao, simulando a morte do processo no meio.
      await db.subscription.update({
        where: { id: subscriptionId },
        data: {
          externalSubscriptionId: null,
          recurrenceConsentAt: null,
          recurrenceConsentActorId: null,
        },
      });

      const segunda = await adesao(subscriptionId);

      // MESMO id: nenhuma segunda recorrencia foi instalada no provedor.
      expect(segunda.externalSubscriptionId).toBe(primeira.externalSubscriptionId);
      expect(fake.recorrenciasInstaladas).toBe(antes + 1);

      const assinatura = await db.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        select: { externalSubscriptionId: true },
      });
      expect(assinatura.externalSubscriptionId).toBe(primeira.externalSubscriptionId);
    });
  });

  describe('cancelamento', () => {
    it('cancela no provedor E limpa a fonte local', async () => {
      const subscriptionId = await alunoPronto();
      const { externalSubscriptionId } = await adesao(subscriptionId);

      expect(fake.temRecorrenciaViva(externalSubscriptionId)).toBe(true);

      const resultado = await cancelar.executar(contexto, { subscriptionId });

      expect(resultado.canceladasNoProvedor).toBe(1);
      /*
       * O ESTADO NO PROVEDOR: recorrencia viva depois do cancelamento e
       * cobranca que ninguem autorizou.
       */
      expect(fake.temRecorrenciaViva(externalSubscriptionId)).toBe(false);

      const assinatura = await db.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        select: { externalSubscriptionId: true, recurrenceConsentAt: true, status: true },
      });
      expect(assinatura.externalSubscriptionId).toBeNull();
      expect(assinatura.recurrenceConsentAt).toBeNull();
      /*
       * CANCELAR A RECORRENCIA NAO CANCELA A ASSINATURA: o acesso ja pago
       * vale ate o fim do periodo (`SPEC-056` 2.4).
       */
      expect(assinatura.status).toBe('ACTIVE');
    });

    it('cancelar de novo devolve zero, sem erro', async () => {
      const subscriptionId = await alunoPronto();
      await adesao(subscriptionId);

      await cancelar.executar(contexto, { subscriptionId });
      const segunda = await cancelar.executar(contexto, { subscriptionId });

      expect(segunda.canceladasNoProvedor).toBe(0);
    });

    it('depois de cancelar, o aluno pode aderir de novo', async () => {
      const subscriptionId = await alunoPronto();
      await adesao(subscriptionId);
      await cancelar.executar(contexto, { subscriptionId });

      await expect(adesao(subscriptionId)).resolves.toMatchObject({ subscriptionId });
    });
  });
});
