import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { calcularHashDeCpf } from '../../src/modules/students/domain/identificacao.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F52 -- area do aluno no totem.
 *
 * O ACEITE DA F49 SOBE DE NIVEL AQUI. La ele valia sobre a saudacao e o
 * estado do plano; agora vale sobre DADO DE SAUDE E FINANCEIRO -- avaliacao,
 * fatura, valor e data de pagamento. As tres travas que sustentam isso sao
 * o que esta suite mede:
 *
 *  1. Modulo desligado responde 404 (ADR-042, Decisao 5, trava 1).
 *  2. Nenhum endpoint aceita id de aluno nem de fatura -- o aluno sai da
 *     SESSAO, e a fatura e a mais antiga em aberto DELE.
 *  3. Tentativa de pagamento de outro aluno responde 404, nunca o estado.
 */
describe('F52 -- area do aluno no totem', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);

  type Totem = {
    tenantId: string;
    gymUnitId: string;
    kioskDeviceId: string;
    keyId: string;
    segredo: string;
  };

  const totem: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

  const CPF_DO_ALUNO_A = '52998224725';
  const CPF_DO_ALUNO_B = '11144477735';

  let alunoB = '';
  let invoiceDeB = '';
  let tentativaDeB = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const assinarPedido = (
    corpo: unknown,
    caminho: string,
    metodo: 'GET' | 'POST' | 'DELETE' = 'POST',
    tokenDeSessao?: string,
  ): Record<string, string> => {
    const body = metodo === 'GET' || corpo === '' ? '' : JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();

    const cabecalhos: Record<string, string> = {
      'x-kiosk-key-id': totem.keyId,
      'x-kiosk-timestamp': String(timestamp),
      'x-kiosk-nonce': nonce,
      'x-kiosk-signature': assinar(
        { keyId: totem.keyId, timestamp, nonce, method: metodo, pathAndQuery: caminho, body },
        totem.segredo,
      ),
    };

    if (tokenDeSessao !== undefined) cabecalhos['x-session-token'] = tokenDeSessao;

    return cabecalhos;
  };

  /** Publica a config do tenant com os modulos que o caso pede. */
  const publicarConfig = async (modulos: Record<string, boolean>, versao: number): Promise<void> => {
    await db.kioskConfiguration.create({
      data: {
        tenantId: totem.tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: versao,
        publishedAt: new Date(),
        payload: {
          sessao: { duracaoSegundos: 60, incrementoSegundos: 30, tetoSegundos: 99 },
          modulos,
        },
      },
    });
  };

  const criarAluno = async (cpf: string, nome: string): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId: totem.tenantId,
        gymUnitId: totem.gymUnitId,
        membershipNumber: `AP-2026-${randomUUID().replace(/\D/g, '').slice(0, 8)}`,
        fullName: nome,
        birthDate: new Date('2000-01-01'),
        cpf,
        cpfHash: calcularHashDeCpf(totem.tenantId, cpf),
        status: 'ACTIVE',
      },
    });

    return aluno.id;
  };

  /** Abre sessao pelo CPF e devolve o par que autoriza as chamadas seguintes. */
  const abrirSessao = async (cpf: string): Promise<{ sessionId: string; token: string }> => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido({ cpf }, '/api/v1/kiosk/sessions'))
      .send({ cpf })
      .expect(201);

    const corpo = resposta.body as { sessionId: string; token: string };

    return { sessionId: corpo.sessionId, token: corpo.token };
  };

  const buscar = (caminho: string, token: string) =>
    request(servidor()).get(caminho).set(assinarPedido('', caminho, 'GET', token));

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-area-${sufixo}`,
        legalName: `Kiosk Area LTDA`,
        displayName: `Kiosk Area`,
      },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const dispositivo = await db.kioskDevice.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-AREA-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-area-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId: tenant.id,
        kioskDeviceId: dispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
        expiresAt: null,
      },
    });

    Object.assign(totem, {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      kioskDeviceId: dispositivo.id,
      keyId,
      segredo,
    });

    // Todos ligados MENOS `evolucao` -- e o desligado que prova a trava 1.
    await publicarConfig(
      {
        pagamento: true,
        historicoDePagamentos: true,
        avaliacao: true,
        evolucao: false,
        historicoDeAvaliacoes: true,
        ranking: false,
      },
      1,
    );

    await criarAluno(CPF_DO_ALUNO_A, 'Aluno A');
    alunoB = await criarAluno(CPF_DO_ALUNO_B, 'Aluno B');

    // Fatura em aberto do aluno B, com tentativa -- o alvo que o aluno A
    // NAO pode alcancar. Plano e assinatura existem porque `Invoice` exige
    // `subscriptionId`: a cadeia do MVP 2 e Plano -> Subscription -> Invoice.
    const plano = await db.plan.create({
      data: { tenantId: totem.tenantId, name: `Mensal ${sufixo}` },
    });

    const assinatura = await db.subscription.create({
      data: {
        tenantId: totem.tenantId,
        studentId: alunoB,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-08-01'),
      },
    });

    const invoice = await db.invoice.create({
      data: {
        tenantId: totem.tenantId,
        subscriptionId: assinatura.id,
        studentId: alunoB,
        number: 900_001,
        status: 'OPEN',
        billingPeriod: new Date('2026-08-01'),
        dueAt: new Date('2026-08-10'),
        subtotalMinor: 18_990,
        totalMinor: 18_990,
        currency: 'BRL',
      },
    });

    invoiceDeB = invoice.id;

    const tentativa = await db.paymentAttempt.create({
      data: {
        tenantId: totem.tenantId,
        invoiceId: invoice.id,
        method: 'PIX',
        status: 'PROCESSING',
        idempotencyKey: `area-${sufixo}-b`,
      },
    });

    tentativaDeB = tentativa.id;
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: totem.tenantId } });
    await app.close();
  });

  describe('trava 1 — módulo desligado responde 404', () => {
    it('recusa o endpoint do módulo desligado, com sessão válida', async () => {
      // ADR-042, Decisao 5: desligar e no SERVIDOR. Um kiosk com devtools
      // aberto nao reabilita nada -- a config diz `evolucao: false`, e o
      // endpoint deixa de existir para ESTE dispositivo.
      const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO_A);

      await buscar(`/api/v1/kiosk/sessions/${sessionId}/evolution`, token).expect(404);
    });

    it('atende o endpoint do módulo ligado, na mesma sessão', async () => {
      // O par com o teste acima e o que prova que o 404 vem do MODULO, e
      // nao de a sessao estar quebrada ou a rota nao existir.
      const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO_A);

      await buscar(`/api/v1/kiosk/sessions/${sessionId}/assessment`, token).expect(200);
    });

    it('devolve o MESMO 404 para módulo desligado e sessão inexistente', async () => {
      // Quem sonda de fora nao pode distinguir os dois: o par de status
      // (401 vs 404) diria qual dos dois falhou.
      const { token } = await abrirSessao(CPF_DO_ALUNO_A);
      const inexistente = randomUUID();

      const desligado = await buscar(
        `/api/v1/kiosk/sessions/${inexistente}/evolution`,
        token,
      ).expect(404);

      const semSessao = await buscar(
        `/api/v1/kiosk/sessions/${inexistente}/assessment`,
        token,
      ).expect(404);

      expect(desligado.status).toBe(semSessao.status);
    });
  });

  describe('trava 2 — o aluno sai da sessão, nunca da URL', () => {
    it('recusa a sessão de outro aluno com token trocado', async () => {
      const a = await abrirSessao(CPF_DO_ALUNO_A);
      const b = await abrirSessao(CPF_DO_ALUNO_B);

      // O `sessionId` de B com o token de A: sem a conferencia do hash do
      // token, o UUID da URL sozinho autorizaria.
      await buscar(`/api/v1/kiosk/sessions/${b.sessionId}/assessment`, a.token).expect(404);
    });

    it('cobra a fatura DO ALUNO DA SESSÃO — não há como pedir outra', async () => {
      // O aluno A nao tem fatura em aberto; o B tem. Se o endpoint aceitasse
      // `invoiceId`, A cobraria a fatura de B e o pagador seria o errado.
      // Como nao aceita, a resposta e "voce nao tem fatura em aberto".
      const a = await abrirSessao(CPF_DO_ALUNO_A);
      const caminho = `/api/v1/kiosk/sessions/${a.sessionId}/payments/pix`;

      const resposta = await request(servidor())
        .post(caminho)
        .set(assinarPedido('', caminho, 'POST', a.token))
        .send();

      expect(resposta.status).toBe(404);
      expect((resposta.body as { code?: string }).code).toBe('KIOSK_NO_OPEN_INVOICE');
    });

    it('não expõe a tentativa de pagamento de outro aluno', async () => {
      // `ConsultarTentativaUseCase` escopa por TENANT, nao por aluno --
      // correto no balcao, vazamento no totem. Sem a amarra pela invoice, o
      // aluno A saberia se a fatura de B foi paga, e quando.
      const a = await abrirSessao(CPF_DO_ALUNO_A);

      await buscar(
        `/api/v1/kiosk/sessions/${a.sessionId}/payments/${tentativaDeB}`,
        a.token,
      ).expect(404);
    });

    it('o histórico de um aluno não traz a fatura do outro', async () => {
      const a = await abrirSessao(CPF_DO_ALUNO_A);

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${a.sessionId}/payments`,
        a.token,
      ).expect(200);

      const linhas = resposta.body as { invoiceId: string }[];

      expect(linhas.some((l) => l.invoiceId === invoiceDeB)).toBe(false);
    });

    it('o aluno B vê a própria fatura no histórico', async () => {
      // O par do teste acima: sem ele, um endpoint que devolvesse SEMPRE
      // lista vazia passaria os dois.
      const b = await abrirSessao(CPF_DO_ALUNO_B);

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${b.sessionId}/payments`,
        b.token,
      ).expect(200);

      const linhas = resposta.body as { invoiceId: string; emAberto: boolean }[];

      expect(linhas.some((l) => l.invoiceId === invoiceDeB && l.emAberto)).toBe(true);
    });
  });

  describe('sessão encerrada não autoriza mais nada', () => {
    it('recusa depois do encerramento', async () => {
      const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO_A);
      const caminho = `/api/v1/kiosk/sessions/${sessionId}`;

      await request(servidor())
        .delete(caminho)
        .set(assinarPedido('', caminho, 'DELETE', token))
        .expect(204);

      await buscar(`/api/v1/kiosk/sessions/${sessionId}/assessment`, token).expect(404);
    });

    it('exige o token do aluno — o sessionId sozinho não autoriza', async () => {
      const { sessionId } = await abrirSessao(CPF_DO_ALUNO_A);
      const caminho = `/api/v1/kiosk/sessions/${sessionId}/assessment`;

      await request(servidor())
        .get(caminho)
        .set(assinarPedido('', caminho, 'GET'))
        .expect(400);
    });
  });
});
