import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F49, Task 3 -- assinatura do totem.
 *
 * Cada teste e um ATAQUE. O caminho feliz e um; os outros sao o motivo de o
 * mecanismo existir. Toda recusa asserta o `code` no corpo, nao so o status
 * HTTP -- sem isso, trocar o motivo por outro (ou desligar uma checagem que
 * ainda devolve 401 por acidente, como `activeFrom`/`expiresAt` caindo no
 * `EDGE_KEY_UNKNOWN` generico) passa despercebido.
 */
describe('F49 -- assinatura do totem', () => {
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

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const CORPO = { agentVersion: '0.1.0', localTimeMs: 0 };

  const assinarPedido = (
    totem: Totem,
    corpo: unknown,
    ajuste: { timestamp?: number; nonce?: string } = {},
  ): Record<string, string> => {
    const body = JSON.stringify(corpo);
    const timestamp = ajuste.timestamp ?? Math.floor(Date.now() / 1000);
    const nonce = ajuste.nonce ?? randomUUID();

    return {
      'x-kiosk-key-id': totem.keyId,
      'x-kiosk-timestamp': String(timestamp),
      'x-kiosk-nonce': nonce,
      'x-kiosk-signature': assinar(
        {
          keyId: totem.keyId,
          timestamp,
          nonce,
          method: 'POST',
          pathAndQuery: '/api/v1/kiosk/heartbeat',
          body,
        },
        totem.segredo,
      ),
    };
  };

  /** Monta tenant + unidade + dispositivo + credencial de totem, isolados por rotulo. */
  const montarTotem = async (
    alvo: Totem,
    rotulo: string,
    ajusteCredencial: { activeFrom?: Date; expiresAt?: Date } = {},
  ): Promise<void> => {
    const tenant = await db.tenant.create({
      data: {
        slug: `kiosk-${rotulo}-${sufixo}`,
        legalName: `Kiosk ${rotulo} LTDA`,
        displayName: `Kiosk ${rotulo}`,
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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `TOTEM-${rotulo}-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-${rotulo}-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId: tenant.id,
        kioskDeviceId: dispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: ajusteCredencial.activeFrom ?? new Date(Date.now() - 60_000),
        expiresAt: ajusteCredencial.expiresAt ?? null,
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

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    await montarTotem(totemA, 'a');
    await montarTotem(totemB, 'b');
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: totemA.tenantId } });
    await db.tenant.delete({ where: { id: totemB.tenantId } });
    await app.close();
  });

  it('aceita requisicao assinada corretamente', async () => {
    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, CORPO))
      .send(CORPO)
      .expect(200);
  });

  it('recusa corpo adulterado depois de assinado', async () => {
    const cabecalhos = assinarPedido(totemA, CORPO);

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(cabecalhos)
      .send({ ...CORPO, agentVersion: '9.9.9' })
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_SIGNATURE_INVALID' });
  });

  it('recusa relogio fora da janela', async () => {
    const antigo = Math.floor(Date.now() / 1000) - 400;

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, CORPO, { timestamp: antigo }))
      .send(CORPO)
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_TIMESTAMP_OUT_OF_WINDOW' });
  });

  it('recusa nonce repetido', async () => {
    const nonce = randomUUID();

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, CORPO, { nonce }))
      .send(CORPO)
      .expect(200);

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, CORPO, { nonce }))
      .send(CORPO)
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_REPLAY_DETECTED' });
  });

  it('recusa chave desconhecida', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set({ ...assinarPedido(totemA, CORPO), 'x-kiosk-key-id': 'nao-existe' })
      .send(CORPO)
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_KEY_UNKNOWN' });
  });

  it('recusa credencial revogada', async () => {
    await db.kioskCredential.updateMany({
      where: { keyId: totemA.keyId },
      data: { revokedAt: new Date() },
    });

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, CORPO))
      .send(CORPO)
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_KEY_REVOKED' });

    await db.kioskCredential.updateMany({
      where: { keyId: totemA.keyId },
      data: { revokedAt: null },
    });
  });

  it('recusa requisicao sem assinatura', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .send(CORPO)
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_SIGNATURE_MISSING' });
  });

  it('recusa credencial ainda nao vigente (activeFrom no futuro)', async () => {
    const futuro: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

    await montarTotem(futuro, `futuro-${randomUUID().slice(0, 8)}`, {
      activeFrom: new Date(Date.now() + 3_600_000),
    });

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(futuro, CORPO))
      .send(CORPO)
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_KEY_UNKNOWN' });

    await db.tenant.delete({ where: { id: futuro.tenantId } });
  });

  it('recusa credencial vencida (expiresAt no passado)', async () => {
    const vencido: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

    await montarTotem(vencido, `vencido-${randomUUID().slice(0, 8)}`, {
      expiresAt: new Date(Date.now() - 3_600_000),
    });

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(vencido, CORPO))
      .send(CORPO)
      .expect(401);

    expect(resposta.body).toMatchObject({ code: 'EDGE_KEY_REVOKED' });

    await db.tenant.delete({ where: { id: vencido.tenantId } });
  });

  /*
   * F68 -- superficie contratada.
   *
   * O contrato e montado DIRETO no banco, e nao pelo caso de uso: ativar pelo
   * `TenantContractUseCase` exigiria gerar PDF e escrever no bucket so para
   * ter uma linha `ACTIVE`. O que este teste prova e o comportamento do
   * `KioskAuthService` diante dessa linha.
   */
  const abrirContratoAtivo = async (
    tenantId: string,
    superficies: { mobileEnabled: boolean; kioskEnabled: boolean },
  ): Promise<string> => {
    const plano = await db.saasPlan.create({
      data: {
        name: `Plano F68 ${randomUUID().slice(0, 8)}`,
        model: 'PER_STUDENT',
        activeStudentPriceMinor: 500,
        inactiveStudentPriceMinor: 250,
      },
    });

    await db.tenantContract.create({
      data: {
        tenantId,
        planId: plano.id,
        model: 'PER_STUDENT',
        activeStudentPriceMinor: 500,
        inactiveStudentPriceMinor: 250,
        baseDate: new Date('2026-01-01T00:00:00.000Z'),
        anniversaryDay: 1,
        anniversaryMonth: 1,
        issueDay: 1,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
        documentObjectKey: `tenants/${tenantId}/contracts/f69.pdf`,
        ...superficies,
      },
    });

    /*
     * Devolve o PLANO, e nao o contrato: apagar o tenant cascateia o contrato,
     * mas o `SaasPlan` nao pendura em tenant nenhum e ficaria no catalogo para
     * sempre. Uma suite que roda no CI todo dia empilharia um plano por
     * execucao -- e o catalogo e a mesma lista onde se procura plano de
     * verdade.
     */
    return plano.id;
  };

  /** Apaga o tenant (cascateia o contrato) e, so entao, o plano orfao. */
  const limpar = async (tenantId: string, planoId: string): Promise<void> => {
    await db.tenant.delete({ where: { id: tenantId } });
    await db.saasPlan.delete({ where: { id: planoId } });
  };

  it('recusa o totem quando o contrato vigente nao inclui totem', async () => {
    const semTotem: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

    await montarTotem(semTotem, `sem-totem-${randomUUID().slice(0, 8)}`);

    const planoId = await abrirContratoAtivo(semTotem.tenantId, {
      mobileEnabled: true,
      kioskEnabled: false,
    });

    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(semTotem, CORPO))
      .send(CORPO)
      .expect(401);

    /*
     * O CODIGO, e nao so o 401: `EDGE_KEY_REVOKED` tambem da 401, e manda quem
     * opera emitir credencial nova -- acao que nao resolve nada aqui. Afirmar
     * so o status deixaria a troca de codigo passar despercebida.
     */
    expect(resposta.body).toMatchObject({ code: 'CONTRACT_KIOSK_DISABLED' });

    await limpar(semTotem.tenantId, planoId);
  });

  /*
   * O PAR do teste acima, e ele e o que da sentido ao outro: sem esta metade,
   * uma recusa que barrasse TODO totem com contrato ativo passaria verde no
   * teste de cima. Mesmo cenario, unica diferenca e a flag.
   */
  it('aceita o totem quando o contrato vigente inclui totem', async () => {
    const comTotem: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

    await montarTotem(comTotem, `com-totem-${randomUUID().slice(0, 8)}`);

    const planoId = await abrirContratoAtivo(comTotem.tenantId, {
      mobileEnabled: false,
      kioskEnabled: true,
    });

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(comTotem, CORPO))
      .send(CORPO)
      .expect(200);

    await limpar(comTotem.tenantId, planoId);
  });

  /*
   * ACADEMIA EM IMPLANTACAO. O totem e o primeiro equipamento testado, e o
   * contrato costuma fechar depois -- recusar aqui transformaria "contrato
   * ainda nao assinado" em "catraca nao funciona" no dia da instalacao.
   */
  it('aceita o totem da academia que ainda nao tem contrato vigente', async () => {
    const semContrato: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

    await montarTotem(semContrato, `sem-contrato-${randomUUID().slice(0, 8)}`);

    await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(semContrato, CORPO))
      .send(CORPO)
      .expect(200);

    await db.tenant.delete({ where: { id: semContrato.tenantId } });
  });

  it('nao autentica como o tenant do totem B usando a credencial do totem A', async () => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido(totemA, CORPO))
      .send(CORPO)
      .expect(200);

    // Task 4: o heartbeat agora devolve configVersion/serverTime. A prova de
    // isolamento real (tenantId/gymUnitId do contexto resolvido) vive em
    // `kiosk-config.int-spec.ts`. Aqui a rede de regressao e: a credencial
    // do A nunca autentica pelo keyId do B, e vice-versa -- exatamente o que
    // a proxima asserção prova.
    expect(typeof (resposta.body as { configVersion: number }).configVersion).toBe('number');

    const cabecalhosDoA = assinarPedido(totemA, CORPO);

    const cruzada = await request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set({ ...cabecalhosDoA, 'x-kiosk-key-id': totemB.keyId })
      .send(CORPO)
      .expect(401);

    // A assinatura foi calculada com o segredo do A, mas anunciada como se
    // fosse a chave do B: a credencial do B tem segredo diferente, entao a
    // assinatura nao confere -- isolamento entre tenants provado pelo
    // proprio mecanismo de assinatura, sem precisar do contexto exposto.
    expect(cruzada.body).toMatchObject({ code: 'EDGE_SIGNATURE_INVALID' });
  });
});
