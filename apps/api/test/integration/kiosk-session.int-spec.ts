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
  ): Record<string, string> => {
    // `corpo === ''` sinaliza requisicao sem corpo (GET, DELETE, ou POST de
    // acao sem payload como o /extend) -- o cru assinado tem que ser vazio
    // pois nada e mandado no `.send()`, nunca `'""'` de um JSON.stringify.
    const body = metodo === 'GET' || corpo === '' ? '' : JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();

    return {
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

    const dispositivo = await db.kioskDevice.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-SESS-${rotulo}-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-sess-${rotulo}-${sufixo}`;

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

    // Publica a config do tenant -- necessaria para abrir sessao (duracao).
    await db.kioskConfiguration.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: null,
        kioskDeviceId: null,
        version: 1,
        publishedAt: new Date(),
        payload: { sessao: { duracaoSegundos: 60, incrementoSegundos: 30, tetoSegundos: 99 } },
      },
    });

    Object.assign(alvo, {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      kioskDeviceId: dispositivo.id,
      keyId,
      segredo,
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

  it('ACEITE DA FATIA -- o aluno do tenant B nao existe para o totem do tenant A', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_B }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_B })
      .expect(404);

    expect((resposta.body as { code: string }).code).toBe('KIOSK_IDENTIFICATION_FAILED');
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

    const { sessionId } = aberta.body as RespostaSessao;

    await request(servidor())
      .delete(`/api/v1/kiosk/sessions/${sessionId}`)
      .set(assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}`, 'DELETE'))
      .expect(204);

    await request(servidor())
      .post(`/api/v1/kiosk/sessions/${sessionId}/extend`)
      .set(assinarPedido(totemA, '', `/api/v1/kiosk/sessions/${sessionId}/extend`, 'POST'))
      .expect(404);
  });

  it('sessao de um totem nao pode ser encerrada por outro', async () => {
    const aberta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido(totemA, { cpf: CPF_DO_ALUNO_A }, '/api/v1/kiosk/sessions'))
      .send({ cpf: CPF_DO_ALUNO_A })
      .expect(201);

    const rota = `/api/v1/kiosk/sessions/${(aberta.body as RespostaSessao).sessionId}`;

    await request(servidor())
      .delete(rota)
      .set(assinarPedido(totemB, '', rota, 'DELETE'))
      .expect(404);
  });
});
