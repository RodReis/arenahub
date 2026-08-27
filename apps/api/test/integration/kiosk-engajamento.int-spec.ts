import { createHash, randomBytes, randomUUID } from 'node:crypto';

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
 * F30, Task 6 -- preferencia de engajamento e identidade publica no totem.
 *
 * Mesmo padrao HMAC de `kiosk-area-do-aluno.int-spec.ts`: toda requisicao
 * assinada com a credencial do dispositivo, e `x-session-token` autoriza o
 * aluno. O que esta suite prova, alem do CRUD basico:
 *
 *  1. Modulo `ranking` desligado responde 404 (mesma trava das outras
 *     areas do aluno no totem).
 *  2. O `studentId` sai da SESSAO -- nao ha parametro de aluno na URL, e a
 *     sessao de um aluno nao le nem escreve a preferencia de outro.
 *  3. So `RANKING` existe no contrato desta fatia; `CHALLENGE` e as demais
 *     finalidades (dormentes na API, vivas no banco) sao recusadas com 400.
 */
describe('F30 -- preferencia de engajamento no totem', () => {
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

  const CPF_DO_ALUNO = '52998224725';
  const CPF_DO_OUTRO_ALUNO = '11144477735';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const assinarPedido = (
    corpo: unknown,
    caminho: string,
    metodo: 'GET' | 'POST' | 'PATCH' = 'POST',
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

  /** Documento de consentimento vigente do tenant -- sem ele, `registrarDecisao` recusa. */
  const publicarDocumento = async (type: 'RANKING'): Promise<void> => {
    const conteudo = `Termo de teste para ${type} -- ${sufixo}. `.repeat(3);
    const sha = createHash('sha256').update(conteudo, 'utf8').digest('hex');

    await db.consentDocument.create({
      data: {
        tenantId: totem.tenantId,
        type,
        version: 1,
        purpose: `Finalidade de teste ${type}`,
        content: conteudo,
        contentSha256: sha,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
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

  const atualizar = (caminho: string, token: string, corpo: Record<string, unknown>) =>
    request(servidor())
      .patch(caminho)
      .set(assinarPedido(corpo, caminho, 'PATCH', token))
      .send(corpo);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-engaj-${sufixo}`,
        legalName: `Kiosk Engajamento LTDA`,
        displayName: `Kiosk Engajamento`,
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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-ENGAJ-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-engaj-${sufixo}`;

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

    await publicarDocumento('RANKING');

    // `ranking: true` por padrao -- os testes de modulo desligado publicam
    // a propria config com `ranking: false` num dispositivo a parte
    // (`comModulo`), sem afetar os demais.
    await publicarConfig({ ranking: true }, 1);

    await criarAluno(CPF_DO_ALUNO, 'Aluno Engajamento');
    await criarAluno(CPF_DO_OUTRO_ALUNO, 'Outro Aluno');
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: totem.tenantId } });
    await app.close();
  });

  it('le a preferencia com o modulo ligado', async () => {
    const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO);

    const resposta = await buscar(
      `/api/v1/kiosk/sessions/${sessionId}/engajamento/preferencias`,
      token,
    ).expect(200);

    // Regime OPT-OUT (ADR-046): sem manifestacao, o aluno ja participa.
    const corpo = resposta.body as { finalidades: Record<string, boolean> };
    expect(corpo.finalidades['RANKING']).toBe(true);
  });

  it('sair do ranking devolve a preferencia atualizada', async () => {
    const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO);
    const caminho = `/api/v1/kiosk/sessions/${sessionId}/engajamento/preferencias`;

    const resposta = await atualizar(caminho, token, {
      finalidade: 'RANKING',
      participa: false,
      idempotencyKey: `k1-${sufixo}`,
    }).expect(200);

    const corpo = resposta.body as { finalidades: Record<string, boolean> };
    expect(corpo.finalidades['RANKING']).toBe(false);
  });

  it('toque duplo com a mesma idempotencyKey nao grava decisao nova', async () => {
    const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO);
    const caminho = `/api/v1/kiosk/sessions/${sessionId}/engajamento/preferencias`;
    const chave = `dedupe-${sufixo}`;
    const corpo = { finalidade: 'RANKING' as const, participa: false, idempotencyKey: chave };

    await atualizar(caminho, token, corpo).expect(200);
    await atualizar(caminho, token, corpo).expect(200);

    // Consulta o banco: so a contagem de linhas distingue dedupe (uma
    // linha) de regravação silenciosa (duas linhas com o mesmo resultado
    // aparente na resposta HTTP).
    const decisoes = await db.consentRecord.findMany({
      where: {
        tenantId: totem.tenantId,
        evidence: { path: ['idempotencyKey'], equals: chave },
      },
    });

    expect(decisoes).toHaveLength(1);
  });

  it('finalidade dormente e recusada pelo contrato', async () => {
    // CHALLENGE e ENGAGEMENT_PUSH existem no banco, nao na API desta fatia:
    // aceitar aqui criaria consentimento que nenhuma tela mostra e nenhum
    // consumidor le.
    const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO);
    const caminho = `/api/v1/kiosk/sessions/${sessionId}/engajamento/preferencias`;

    await atualizar(caminho, token, {
      finalidade: 'CHALLENGE',
      participa: false,
      idempotencyKey: `k2-${sufixo}`,
    }).expect(400);
  });

  it('define o alias publico e le de volta', async () => {
    const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO);
    const caminho = `/api/v1/kiosk/sessions/${sessionId}/engajamento/perfil-publico`;

    const resposta = await atualizar(caminho, token, {
      identityChoice: 'APELIDO',
      alias: 'Furacao',
      version: null,
    }).expect(200);

    const corpo = resposta.body as { identityChoice: string; alias: string | null };
    expect(corpo.identityChoice).toBe('APELIDO');
    expect(corpo.alias).toBe('Furacao');
  });

  it('modulo ranking desligado responde 404', async () => {
    // Dispositivo PROPRIO com `ranking: false` -- nao mexe na config do
    // dispositivo dos demais testes.
    const outroDispositivo = await db.kioskDevice.create({
      data: { tenantId: totem.tenantId, gymUnitId: totem.gymUnitId, code: `TOTEM-SEM-RANKING-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-sem-ranking-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId: totem.tenantId,
        kioskDeviceId: outroDispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
        expiresAt: null,
      },
    });

    await db.kioskConfiguration.create({
      data: {
        tenantId: totem.tenantId,
        // Camada de DISPOSITIVO: `gymUnitId` preenchido (o da unidade) E
        // `kioskDeviceId` preenchido -- e o par que `resolverParaDispositivo`
        // exige para casar com `camadaDispositivo`. `gymUnitId: null` aqui
        // cairia fora das tres camadas e nunca seria lido.
        gymUnitId: totem.gymUnitId,
        kioskDeviceId: outroDispositivo.id,
        version: 1,
        publishedAt: new Date(),
        payload: { modulos: { ranking: false } },
      },
    });

    const totemOriginal = { ...totem };
    Object.assign(totem, { kioskDeviceId: outroDispositivo.id, keyId, segredo });

    const { sessionId, token } = await abrirSessao(CPF_DO_ALUNO);

    await buscar(
      `/api/v1/kiosk/sessions/${sessionId}/engajamento/preferencias`,
      token,
    ).expect(404);

    Object.assign(totem, totemOriginal);
  });

  it('sessao de outro aluno nao le preferencia alheia', async () => {
    // Nao ha parametro de aluno na URL: o studentId sai da sessao. Este
    // teste guarda essa ausencia -- se alguem acrescentar `?studentId=`,
    // ele tem de continuar caindo aqui, porque o sessionId de um aluno com
    // o token de outro nunca resolve uma sessao viva.
    const meu = await abrirSessao(CPF_DO_ALUNO);
    const doOutro = await abrirSessao(CPF_DO_OUTRO_ALUNO);

    await buscar(
      `/api/v1/kiosk/sessions/${doOutro.sessionId}/engajamento/preferencias`,
      meu.token,
    ).expect(404);
  });
});
