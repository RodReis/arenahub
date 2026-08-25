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
 * F49, Task 5 -- sessao efemera do aluno no totem.
 *
 * O ACEITE DA FATIA INTEIRA mora aqui: dado do aluno A nunca aparece para o
 * aluno B. Mesmo molde de dois tenants das tasks anteriores.
 */
describe('F49 -- sessao do totem', () => {
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

  const totemA: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };
  const totemB: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };
  // MESMO tenant do totemA -- caso real de uma academia com dois quiosques
  // no saguao. Sem isto, "sessao de um totem nao pode ser encerrada por
  // outro" media so o filtro de tenant (totemB esta noutro tenant) e nunca
  // exercitava o filtro de `kioskDeviceId`.
  const totemC: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

  const CPF_DO_ALUNO_A = '52998224725';
  const CPF_DO_ALUNO_B = '11144477735';

  /** Forma da resposta de `POST /api/v1/kiosk/sessions`, so o que os testes leem. */
  interface RespostaSessao {
    sessionId: string;
    token: string;
    nome: string;
  }

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const assinarPedido = (
    totem: Totem,
    corpo: unknown,
    caminho: string,
    metodo: 'GET' | 'POST' | 'DELETE' = 'POST',
    tokenDeSessao?: string,
  ): Record<string, string> => {
    // `corpo === ''` sinaliza requisicao sem corpo (GET, DELETE, ou POST de
    // acao sem payload como o /extend) -- o cru assinado tem que ser vazio
    // pois nada e mandado no `.send()`, nunca `'""'` de um JSON.stringify.
    const body = metodo === 'GET' || corpo === '' ? '' : JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();

    const cabecalhos: Record<string, string> = {
      'x-kiosk-key-id': totem.keyId,
      'x-kiosk-timestamp': String(timestamp),
      'x-kiosk-nonce': nonce,
      'x-kiosk-signature': assinar(
        {
          keyId: totem.keyId,
          timestamp,
          nonce,
          method: metodo,
          pathAndQuery: caminho,
          body,
        },
        totem.segredo,
      ),
    };

    // Credencial da SESSAO (do aluno), distinta da credencial HMAC do
    // dispositivo -- fora da assinatura de proposito, o guard nunca a le.
    if (tokenDeSessao !== undefined) {
      cabecalhos['x-session-token'] = tokenDeSessao;
    }

    return cabecalhos;
  };

  /** Monta tenant + unidade + dispositivo + credencial de totem, isolados por rotulo. */
  const montarTotem = async (alvo: Totem, rotulo: string): Promise<void> => {
    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-sess-${rotulo}-${sufixo}`,
        legalName: `Kiosk Sess ${rotulo} LTDA`,
        displayName: `Kiosk Sess ${rotulo}`,
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

    await publicarConfig(tenant.id);
    await montarDispositivoNoTenant(alvo, tenant.id, unidade.id, rotulo);
  };

  /** Monta so um dispositivo + credencial NUM TENANT JA EXISTENTE (segundo totem do mesmo tenant). */
  const montarDispositivoNoTenant = async (
    alvo: Totem,
    tenantId: string,
    gymUnitId: string,
    rotulo: string,
  ): Promise<void> => {
    const dispositivo = await db.kioskDevice.create({
      data: { tenantId, gymUnitId, code: `TOTEM-SESS-${rotulo}-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-sess-${rotulo}-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId,
        kioskDeviceId: dispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
        expiresAt: null,
      },
    });

    Object.assign(alvo, {
      tenantId,
      gymUnitId,
      kioskDeviceId: dispositivo.id,
      keyId,
      segredo,
    });
  };

  /** Publica a config do tenant -- necessaria para abrir sessao (duracao). */
  const publicarConfig = async (tenantId: string): Promise<void> => {
    await db.kioskConfiguration.create({
      data: {
        tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: 1,
        publishedAt: new Date(),
        payload: { sessao: { duracaoSegundos: 60, incrementoSegundos: 30, tetoSegundos: 99 } },
      },
    });
  };

  const criarAluno = async (
    tenantId: string,
    gymUnitId: string,
    cpf: string,
    nome: string,
  ): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `AP-2026-${randomUUID().replace(/\D/g, '').slice(0, 8)}`,
        fullName: nome,
        birthDate: new Date('2000-01-01'),
        cpf,
        cpfHash: calcularHashDeCpf(tenantId, cpf),
        status: 'ACTIVE',
      },
    });

    return aluno.id;
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    await montarTotem(totemA, 'a');
    await montarTotem(totemB, 'b');
    // totemC: segundo dispositivo do MESMO tenant e MESMA unidade do totemA.
    await montarDispositivoNoTenant(totemC, totemA.tenantId, totemA.gymUnitId, 'c');

    await criarAluno(totemA.tenantId, totemA.gymUnitId, CPF_DO_ALUNO_A, 'Aluno A');
    await criarAluno(totemB.tenantId, totemB.gymUnitId, CPF_DO_ALUNO_B, 'Aluno B');
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: totemA.tenantId } });
    await db.tenant.delete({ where: { id: totemB.tenantId } });
    await app.close();
  });

  it('identifica o aluno pelo CPF e abre sessao', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    const corpo = resposta.body as RespostaSessao;

    expect(corpo.nome).toBe('Aluno A');
    expect(typeof corpo.token).toBe('string');
  });

  it('a resposta NAO traz campo alem da jornada (M4-FR-018)', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    expect(Object.keys(resposta.body as object).sort()).toEqual(
      ['expiraEm', 'nome', 'plano', 'sessionId', 'token'].sort(),
    );

    const corpo = JSON.stringify(resposta.body);

    expect(corpo).not.toContain(CPF_DO_ALUNO_A);
    expect(corpo).not.toContain('@');
  });

  it('ACEITE DA FATIA -- o aluno do tenant B nao existe para o totem do tenant A, mas o do tenant A existe', async () => {
    // Ponta positiva: com hash sem escopo de tenant (busca quebrada para
    // todo mundo), o 404 abaixo tambem apareceria -- mas por ausencia de
    // RESULTADO, nao por ISOLAMENTO. Sem esta metade, o teste nao distingue
    // "nao vazou" de "nao funciona". As duas pontas amarradas e o aceite
    // fica impossivel de passar por acidente.
    const achaOProprio = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    expect((achaOProprio.body as RespostaSessao).nome).toBe('Aluno A');

    const naoAchaOOutro = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_B }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_B })
      .expect(404);

    expect((naoAchaOOutro.body as { code: string }).code).toBe('KIOSK_IDENTIFICATION_FAILED');
  });

  it('CPF inexistente e aluno de outro tenant devolvem a MESMA resposta', async () => {
    const inexistente = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: '00000000191' }, '/api/v1/kiosk/sessions'))
      .send({ cpf: '00000000191' })
      .expect(404);

    const deOutroTenant = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_B }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_B })
      .expect(404);

    // Decisao 4 do PI: mensagem unica e neutra. Distinguir aqui transformaria
    // o totem em oraculo de "fulano treina nesta academia". `correlationId`
    // e por requisicao (RFC 9457) e sempre diverge -- comparamos o resto.
    const { correlationId: _semRelevancia1, ...corpoInexistente } = inexistente.body as {
      correlationId: string;
    };
    const { correlationId: _semRelevancia2, ...corpoDeOutroTenant } = deOutroTenant.body as {
      correlationId: string;
    };

    expect(corpoInexistente).toEqual(corpoDeOutroTenant);
  });

  it('encerrar invalida o token no ATO', async () => {
    const aberta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    const { sessionId, token } = aberta.body as RespostaSessao;

    await request(servidor())
      .delete(`/api/v1/kiosk/sessions/${sessionId}`)
      .set(assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}`, 'DELETE', token))
      .expect(204);

    await request(servidor())
      .post(`/api/v1/kiosk/sessions/${sessionId}/extend`)
      .set(
        assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}/extend`, 'POST', token),
      )
      .expect(404);
  });

  /**
   * CRITICAL do fix round 1: prova que o TOKEN em maos, e nao so o
   * `sessionId` da URL, e o que autoriza. `estenderSessao` faz o SELECT por
   * `tokenHash` -- sem ele o token era gravado e nunca lido, e a garantia de
   * "encerrar invalida no ato" seria acidental (o teste acima passava so
   * porque `viva()` olhava `endedAt`, nunca o token).
   *
   * Prova por mutacao: comentar a checagem `sessao.expiresAt <= agora` em
   * `kiosk-session.service.ts` faz este teste ficar vermelho (a sessao
   * expirada voltaria a autorizar `/extend`).
   */
  it('sessao expirada nao autoriza -- o token em maos nao basta', async () => {
    const aberta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    const { sessionId, token } = aberta.body as RespostaSessao;

    // Forca a expiracao direto no banco -- sem esperar os 60s reais.
    await db.kioskSession.update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await request(servidor())
      .post(`/api/v1/kiosk/sessions/${sessionId}/extend`)
      .set(
        assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}/extend`, 'POST', token),
      )
      .expect(404);
  });

  /**
   * CRITICAL do fix round 1, segunda ponta: sessao encerrada por DELETE nao
   * volta a autorizar so porque o token continua em maos.
   *
   * Prova por mutacao: remover `endedAt: null` do `where` de `viva()` faz
   * este teste ficar vermelho (o token encerrado voltaria a autorizar).
   */
  it('sessao encerrada por DELETE nao autoriza -- mesmo com o token em maos', async () => {
    const aberta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    const { sessionId, token } = aberta.body as RespostaSessao;

    await request(servidor())
      .delete(`/api/v1/kiosk/sessions/${sessionId}`)
      .set(assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}`, 'DELETE', token))
      .expect(204);

    await request(servidor())
      .post(`/api/v1/kiosk/sessions/${sessionId}/extend`)
      .set(
        assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}/extend`, 'POST', token),
      )
      .expect(404);
  });

  it('sessao de um totem nao pode ser encerrada por outro (tenant diferente)', async () => {
    const aberta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    const { sessionId, token } = aberta.body as RespostaSessao;
    const rota = `/api/v1/kiosk/sessions/${sessionId}`;

    await request(servidor())
      .delete(rota)
      .set(assinarPedido(totemB, '', rota, 'DELETE', token))
      .expect(404);
  });

  /**
   * IMPORTANT do fix round 1: o caso REAL -- dois totens do MESMO tenant,
   * uma academia com dois quiosques no saguao. O teste acima (tenant
   * diferente) media so o filtro de `tenantId`; este exercita o de
   * `kioskDeviceId`.
   *
   * Prova por mutacao: remover `kioskDeviceId` do `where` de `viva()` faz
   * este teste ficar vermelho (totemC passaria a encerrar a sessao aberta
   * no totemA).
   */
  it('sessao de um totem nao pode ser encerrada por outro totem do MESMO tenant', async () => {
    const aberta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    const { sessionId, token } = aberta.body as RespostaSessao;
    const rota = `/api/v1/kiosk/sessions/${sessionId}`;

    await request(servidor())
      .delete(rota)
      .set(assinarPedido(totemC, '', rota, 'DELETE', token))
      .expect(404);
  });
});
