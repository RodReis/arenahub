import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CABECALHOS, assinar } from '@arenahub/api-contracts';
import { comContexto } from '@arenahub/database';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { BiometricIdentityRepository } from '../../src/modules/biometrics/biometric-identity.repository.js';
import { VincularCadastroLegadoUseCase } from '../../src/modules/biometrics/vincular-cadastro-legado.use-case.js';
import { DeviceRepository } from '../../src/modules/devices/device.repository.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * #468 -- vinculo dos alunos legados, Arena Positiva, 30/09/2026.
 *
 * O leitor ja tem os cadastros faciais do sistema anterior. O numero de
 * cada aluno no leitor esta em `StudentCredential.externalId` (coluna
 * CATRACA da lista de alunos) -- mas a decisao de acesso resolve por
 * `DeviceUser` (INV-026), e nada ligava um ao outro. Todo aluno legado
 * caia em `UNKNOWN_EXTERNAL_USER`.
 *
 * Decisoes do PI (30/09/2026): importar o vinculo a partir do que o leitor
 * tem; o consentimento que a identidade exige nasce marcado como LEGADO.
 *
 * O que este arquivo defende:
 *   - vincula so quando o numero aponta para UM aluno -- numero repetido
 *     entre dois alunos nao abre catraca para ninguem;
 *   - nenhum comando vai para o leitor: o cadastro ja esta la, e um UPSERT
 *     sem foto apagaria a face;
 *   - reenviar a mesma base e inofensivo (regra de arquitetura no 4);
 *   - o leitor so e achado no escopo do Edge que assinou (regra no 2).
 */
describe('#468 -- vinculo legado do leitor', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const serial = `SER-LEG-${sufixo}`;

  const ctx = { tenantId: '', gymUnitId: '', edgeNodeId: '', deviceId: '', keyId: '', segredo: '' };
  /** Um segundo tenant, so para provar que o serial nao atravessa. */
  const vizinho = { serial: `SER-LEG-VIZ-${sufixo}` };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const postarAssinado = (
    caminho: string,
    corpo: Record<string, unknown>,
  ): Promise<request.Response> => {
    const texto = JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');
    const assinatura = assinar(
      { keyId: ctx.keyId, timestamp, nonce, method: 'POST', pathAndQuery: caminho, body: texto },
      ctx.segredo,
    );

    return request(servidor())
      .post(caminho)
      .set(CABECALHOS.keyId, ctx.keyId)
      .set(CABECALHOS.timestamp, String(timestamp))
      .set(CABECALHOS.nonce, nonce)
      .set(CABECALHOS.signature, assinatura)
      .set('Content-Type', 'application/json')
      .send(texto);
  };

  const vincular = (corpo: Record<string, unknown>): Promise<request.Response> =>
    postarAssinado('/api/v1/edge/device-users/legacy-links', corpo);

  const enviarNomes = (corpo: Record<string, unknown>): Promise<request.Response> =>
    postarAssinado('/api/v1/edge/device-users/reader-names', corpo);

  const criarAluno = async (
    rotulo: string,
    credenciais: { kind: 'TURNSTILE_CARD' | 'FACIAL_ENROLL_ID'; externalId: string }[],
  ): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId: ctx.tenantId,
        gymUnitId: ctx.gymUnitId,
        membershipNumber: `LEG-${rotulo}-${sufixo}`,
        fullName: `Aluno ${rotulo}`,
        birthDate: new Date('1990-06-15T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    for (const c of credenciais) {
      await db.studentCredential.create({
        data: { tenantId: ctx.tenantId, studentId: aluno.id, kind: c.kind, externalId: c.externalId },
      });
    }

    return aluno.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: { slug: `leg-${sufixo}`, legalName: 'Legado LTDA', displayName: 'Legado' },
    });
    ctx.tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    ctx.gymUnitId = unidade.id;

    const node = await db.edgeNode.create({
      data: { tenantId: tenant.id, gymUnitId: unidade.id, code: `EDGE-LEG-${sufixo}` },
    });
    ctx.edgeNodeId = node.id;

    ctx.segredo = randomBytes(32).toString('base64url');
    ctx.keyId = `key-leg-${sufixo}`;

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId: ctx.keyId,
        encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(ctx.segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });

    const leitor = await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: node.id,
        kind: 'FACIAL_READER',
        model: 'AiFace',
        serial,
      },
    });
    ctx.deviceId = leitor.id;

    // Termo biometrico vigente do tenant: o consentimento legado aponta para ele.
    await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo biometrico. '.repeat(5),
        contentSha256: 'c'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    // Leitor de OUTRO tenant: existe so para provar isolamento.
    const outro = await db.tenant.create({
      data: { slug: `leg-viz-${sufixo}`, legalName: 'Vizinho LTDA', displayName: 'Vizinho' },
    });
    const outraUnidade = await db.gymUnit.create({
      data: {
        tenantId: outro.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    await db.device.create({
      data: {
        tenantId: outro.id,
        gymUnitId: outraUnidade.id,
        kind: 'FACIAL_READER',
        model: 'AiFace',
        serial: vizinho.serial,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('vincula o aluno cujo numero da coluna CATRACA esta no leitor, com consentimento LEGADO', async () => {
    const alunoId = await criarAluno('A', [{ kind: 'TURNSTILE_CARD', externalId: '1491' }]);

    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['1491'] });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ linked: 1, alreadyLinked: 0 });

    const vinculo = await db.deviceUser.findUniqueOrThrow({
      where: { deviceId_externalUserId: { deviceId: ctx.deviceId, externalUserId: '1491' } },
      include: { identity: { include: { consentRecord: true } } },
    });

    expect(vinculo.studentId).toBe(alunoId);
    // Ja esta no leitor: nasce SYNCED, nunca PENDING -- PENDING pediria
    // sincronizacao, e um UPSERT sem foto apagaria a face cadastrada.
    expect(vinculo.state).toBe('SYNCED');
    expect(vinculo.identity.state).toBe('ACTIVE');
    expect(vinculo.identity.consentRecord.decision).toBe('ACCEPTED');
    expect(vinculo.identity.consentRecord.evidence).toMatchObject({
      origem: 'CADASTRO_FACIAL_LEGADO',
    });
  });

  it('aceita o numero guardado como FACIAL_ENROLL_ID tambem', async () => {
    const alunoId = await criarAluno('B', [{ kind: 'FACIAL_ENROLL_ID', externalId: '2002' }]);

    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['2002'] });

    expect(resposta.body).toMatchObject({ linked: 1 });

    const vinculo = await db.deviceUser.findUniqueOrThrow({
      where: { deviceId_externalUserId: { deviceId: ctx.deviceId, externalUserId: '2002' } },
    });
    expect(vinculo.studentId).toBe(alunoId);
  });

  it('NAO cria comando para o leitor -- o cadastro facial ja esta la', async () => {
    await criarAluno('C', [{ kind: 'TURNSTILE_CARD', externalId: '3003' }]);

    await vincular({ deviceSerial: serial, externalUserIds: ['3003'] });

    const jobs = await db.deviceSyncJob.count({ where: { deviceId: ctx.deviceId } });
    expect(jobs).toBe(0);
  });

  it('reenviar a mesma base e inofensivo: conta como ja vinculado, sem duplicar', async () => {
    await criarAluno('D', [{ kind: 'TURNSTILE_CARD', externalId: '4004' }]);

    await vincular({ deviceSerial: serial, externalUserIds: ['4004'] });
    const segunda = await vincular({ deviceSerial: serial, externalUserIds: ['4004'] });

    expect(segunda.body).toMatchObject({ linked: 0, alreadyLinked: 1 });

    const consentimentos = await db.consentRecord.count({
      where: { tenantId: ctx.tenantId, student: { membershipNumber: `LEG-D-${sufixo}` } },
    });
    expect(consentimentos).toBe(1);
  });

  it('devolve o numero sem aluno para a recepcao resolver, sem vincular', async () => {
    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['9999001'] });

    expect(resposta.body).toMatchObject({ linked: 0, withoutStudent: ['9999001'] });
  });

  /**
   * #475 -- pre-requisito para "proximo numero livre": o numero sem aluno
   * precisa ficar REGISTRADO, nao so devolvido na resposta. Sem isto, uma
   * segunda chamada a sugestao de numero colidiria com um cadastro que o
   * leitor ja tem mas a nuvem "esqueceu" assim que a resposta HTTP terminou.
   */
  it('registra o numero do leitor mesmo sem aluno -- #475', async () => {
    await vincular({ deviceSerial: serial, externalUserIds: ['9999002'] });

    const registro = await db.deviceReaderNumber.findUniqueOrThrow({
      where: { deviceId_externalUserId: { deviceId: ctx.deviceId, externalUserId: '9999002' } },
    });

    expect(registro.tenantId).toBe(ctx.tenantId);
  });

  it('reenviar o mesmo numero so atualiza seenAt -- nao duplica o registro', async () => {
    await vincular({ deviceSerial: serial, externalUserIds: ['9999003'] });
    await vincular({ deviceSerial: serial, externalUserIds: ['9999003'] });

    const registros = await db.deviceReaderNumber.findMany({
      where: { deviceId: ctx.deviceId, externalUserId: '9999003' },
    });

    expect(registros).toHaveLength(1);
  });

  /**
   * #475 -- numero que JA VIROU `DeviceUser` (vinculo confirmado) tambem
   * nao pode ser sugerido de novo. `DeviceReaderNumber` sozinho nao bastaria
   * aqui: o teste usa o fluxo real de vinculo para produzir um DeviceUser
   * de verdade, com identidade e consentimento, em vez de inserir a linha a
   * mao.
   */
  it('o numero que virou DeviceUser aparece na lista de numeros vinculados do tenant -- #475', async () => {
    await criarAluno('J475', [{ kind: 'TURNSTILE_CARD', externalId: '9999004' }]);

    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['9999004'] });
    expect(resposta.body).toMatchObject({ linked: 1 });

    const dispositivos = app.get(DeviceRepository);
    const vinculados = await dispositivos.listarNumerosVinculadosDoTenant(ctx.tenantId);

    expect(vinculados).toContain('9999004');
  });

  it('NAO vincula numero que aponta para dois alunos -- catraca nao abre para o errado', async () => {
    await criarAluno('E1', [{ kind: 'TURNSTILE_CARD', externalId: '5005' }]);
    await criarAluno('E2', [{ kind: 'FACIAL_ENROLL_ID', externalId: '5005' }]);

    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['5005'] });

    expect(resposta.body).toMatchObject({ linked: 0, ambiguous: ['5005'] });

    const vinculo = await db.deviceUser.findFirst({
      where: { deviceId: ctx.deviceId, externalUserId: '5005' },
    });
    expect(vinculo).toBeNull();
  });

  it('NAO vincula o segundo numero de um aluno que ja tem vinculo neste leitor', async () => {
    await criarAluno('F', [
      { kind: 'TURNSTILE_CARD', externalId: '6006' },
      { kind: 'FACIAL_ENROLL_ID', externalId: '6007' },
    ]);

    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['6006', '6007'] });

    expect(resposta.body).toMatchObject({ linked: 1, studentAlreadyLinked: ['6007'] });
  });

  /*
   * ADR-064 (decisao do PI, 01/10/2026): todo aluno da base do leitor entra
   * com consentimento ACEITO. Recusa registrada ou identidade encerrada nao
   * barram mais a importacao -- antes barravam (regra no 7, revogada).
   */
  const consentimento = async (studentId: string, decision: 'ACCEPTED' | 'REFUSED') => {
    const documento = await db.consentDocument.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, type: 'BIOMETRIC' },
    });

    return db.consentRecord.create({
      data: {
        tenantId: ctx.tenantId,
        studentId,
        documentId: documento.id,
        decision,
        subjectKind: 'STUDENT',
        subjectAgeYears: 36,
        occurredAt: new Date(),
      },
    });
  };

  it('vincula aluno que tinha recusado, com consentimento ACEITO vigente (ADR-064)', async () => {
    const alunoId = await criarAluno('G', [{ kind: 'TURNSTILE_CARD', externalId: '7007' }]);
    const recusa = await consentimento(alunoId, 'REFUSED');

    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['7007'] });

    expect(resposta.body).toMatchObject({ linked: 1, refusedOrRevoked: [] });

    const vinculo = await db.deviceUser.findUniqueOrThrow({
      where: { deviceId_externalUserId: { deviceId: ctx.deviceId, externalUserId: '7007' } },
      include: { identity: { include: { consentRecord: true } } },
    });
    expect(vinculo.identity.state).toBe('ACTIVE');
    expect(vinculo.identity.consentRecord.decision).toBe('ACCEPTED');

    // A recusa nao e apagada: fica no historico, substituida pelo aceite.
    const recusaAntiga = await db.consentRecord.findUniqueOrThrow({ where: { id: recusa.id } });
    expect(recusaAntiga.supersededAt).not.toBeNull();
  });

  it('vincula aluno com identidade revogada, com identidade nova ATIVA (ADR-064)', async () => {
    const alunoId = await criarAluno('H', [{ kind: 'TURNSTILE_CARD', externalId: '8008' }]);
    const aceito = await consentimento(alunoId, 'ACCEPTED');
    await db.biometricIdentity.create({
      data: {
        tenantId: ctx.tenantId,
        studentId: alunoId,
        consentRecordId: aceito.id,
        state: 'REVOKED',
      },
    });

    const resposta = await vincular({ deviceSerial: serial, externalUserIds: ['8008'] });

    expect(resposta.body).toMatchObject({ linked: 1, refusedOrRevoked: [] });

    const vinculo = await db.deviceUser.findUniqueOrThrow({
      where: { deviceId_externalUserId: { deviceId: ctx.deviceId, externalUserId: '8008' } },
      include: { identity: true },
    });
    expect(vinculo.identity.state).toBe('ACTIVE');
  });

  it('reusa o consentimento aceito que o aluno ja tem, sem criar o legado', async () => {
    const alunoId = await criarAluno('I', [{ kind: 'TURNSTILE_CARD', externalId: '9009' }]);
    const aceito = await consentimento(alunoId, 'ACCEPTED');

    await vincular({ deviceSerial: serial, externalUserIds: ['9009'] });

    const vinculo = await db.deviceUser.findUniqueOrThrow({
      where: { deviceId_externalUserId: { deviceId: ctx.deviceId, externalUserId: '9009' } },
      include: { identity: true },
    });
    expect(vinculo.identity.consentRecordId).toBe(aceito.id);
    expect(await db.consentRecord.count({ where: { studentId: alunoId } })).toBe(1);
  });

  it('nao acha leitor de outro tenant pelo serial -- 404, nada gravado', async () => {
    const antes = await db.deviceUser.count({ where: { tenantId: ctx.tenantId } });

    const resposta = await vincular({ deviceSerial: vizinho.serial, externalUserIds: ['1491'] });

    expect(resposta.status).toBe(404);
    expect(resposta.body).toMatchObject({ code: 'DEVICE_NOT_IN_SCOPE' });
    expect(await db.deviceUser.count({ where: { tenantId: ctx.tenantId } })).toBe(antes);
  });

  it('recusa tenantId no corpo -- identidade vem da assinatura', async () => {
    const resposta = await vincular({
      deviceSerial: serial,
      externalUserIds: ['1491'],
      tenantId: ctx.tenantId,
    });

    expect(resposta.status).toBe(400);
  });

  describe('nome gravado no leitor', () => {
    it('grava o nome do leitor so para numero que o leitor ja informou', async () => {
      const numero = '223450000001';
      await vincular({ deviceSerial: serial, externalUserIds: [numero] });

      const r = await enviarNomes({
        deviceSerial: serial,
        names: [
          { externalUserId: numero, name: 'ANA C' },
          { externalUserId: '223450009999', name: 'FANTASMA' },
        ],
      });

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ updated: 1 });
      const linha = await db.deviceReaderNumber.findFirst({
        where: { deviceId: ctx.deviceId, externalUserId: numero },
      });
      expect(linha?.readerName).toBe('ANA C');
      expect(await db.deviceReaderNumber.count({ where: { externalUserId: '223450009999' } })).toBe(
        0,
      );
    });

    it('recusa tenantId no corpo', async () => {
      const r = await enviarNomes({
        deviceSerial: serial,
        names: [{ externalUserId: '1', name: 'X' }],
        tenantId: ctx.tenantId,
      });

      expect(r.status).toBe(400);
    });

    it('nao acha leitor de outro tenant pelo serial -- 404', async () => {
      const r = await enviarNomes({
        deviceSerial: vizinho.serial,
        names: [{ externalUserId: '1', name: 'X' }],
      });

      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ code: 'DEVICE_NOT_IN_SCOPE' });
    });
  });

  const ESTADOS_NAO_REAPONTAVEIS = ['PENDING', 'REMOVAL_PENDING', 'FAILED', 'REMOVED'] as const;

  describe('vinculo imediato e troca de numero', () => {
    it('numero ja no leitor vincula na hora pelo caso de uso, sem o Edge reenviar', async () => {
      const numero = `7${sufixo.replace(/\D/g, '').padEnd(11, '1').slice(0, 11)}`;
      await vincular({ deviceSerial: serial, externalUserIds: [numero] }); // leitor informa: sem aluno
      const aluno = await criarAluno('IMEDIATO', [{ kind: 'FACIAL_ENROLL_ID', externalId: numero }]);

      // Chamada direta, fora de requisicao: abre o escopo de RLS.
      const r = await comContexto({ kind: 'tenant', tenantId: ctx.tenantId }, () =>
        app.get(VincularCadastroLegadoUseCase).vincularNumero(ctx.tenantId, numero, 'teste', new Date()),
      );

      expect(r.linkedReaders).toBe(1);
      const du = await db.deviceUser.findFirst({
        where: { deviceId: ctx.deviceId, externalUserId: numero },
      });
      expect(du?.studentId).toBe(aluno);
    });

    it('troca de numero reaponta o DeviceUser em vez de recusar', async () => {
      const antigo = `8${sufixo.replace(/\D/g, '').padEnd(11, '2').slice(0, 11)}`;
      const novo = `9${sufixo.replace(/\D/g, '').padEnd(11, '3').slice(0, 11)}`;
      const aluno = await criarAluno('TROCA', [{ kind: 'FACIAL_ENROLL_ID', externalId: antigo }]);
      await vincular({ deviceSerial: serial, externalUserIds: [antigo] });

      await db.studentCredential.updateMany({ where: { studentId: aluno }, data: { externalId: novo } });
      const r = await vincular({ deviceSerial: serial, externalUserIds: [novo] });

      expect(r.status).toBe(201);
      expect((r.body as { studentAlreadyLinked: string[] }).studentAlreadyLinked).toEqual([]);
      const doAluno = await db.deviceUser.findMany({
        where: { deviceId: ctx.deviceId, studentId: aluno },
      });
      expect(doAluno.map((d) => d.externalUserId)).toEqual([novo]);

      const auditorias = await db.auditLog.findMany({
        where: {
          tenantId: ctx.tenantId,
          action: 'biometric.number_repointed',
          targetId: doAluno[0]!.id,
        },
      });
      expect(auditorias).toHaveLength(1);
      expect(auditorias[0]!.metadata).toMatchObject({ deviceId: ctx.deviceId, from: antigo, to: novo });
    });

    it.each(ESTADOS_NAO_REAPONTAVEIS)(
      'troca de numero NAO reaponta vinculo %s -- devolve para a recepcao',
      async (estado) => {
        const antigo = `4${ESTADOS_NAO_REAPONTAVEIS.indexOf(estado)}${sufixo.replace(/\D/g, '').padEnd(10, '6').slice(0, 10)}`;
        const novo = `3${ESTADOS_NAO_REAPONTAVEIS.indexOf(estado)}${sufixo.replace(/\D/g, '').padEnd(10, '7').slice(0, 10)}`;
        const aluno = await criarAluno(`E-${estado}`, [
          { kind: 'FACIAL_ENROLL_ID', externalId: antigo },
        ]);
        await vincular({ deviceSerial: serial, externalUserIds: [antigo] });
        await db.deviceUser.updateMany({
          where: { deviceId: ctx.deviceId, studentId: aluno },
          data: { state: estado },
        });

        await db.studentCredential.updateMany({
          where: { studentId: aluno },
          data: { externalId: novo },
        });
        const r = await vincular({ deviceSerial: serial, externalUserIds: [novo] });

        expect(r.status).toBe(201);
        expect((r.body as { studentAlreadyLinked: string[] }).studentAlreadyLinked).toEqual([novo]);
        const linhas = await db.deviceUser.findMany({
          where: { deviceId: ctx.deviceId, studentId: aluno },
        });
        expect(linhas.map((d) => [d.externalUserId, d.state])).toEqual([[antigo, estado]]);
      },
    );

    it('aluno com linha morta e linha viva no mesmo leitor: troca nao reaponta e nao da 500', async () => {
      const antigo = `2${sufixo.replace(/\D/g, '').padEnd(11, '8').slice(0, 11)}`;
      const morto = `1${sufixo.replace(/\D/g, '').padEnd(11, '9').slice(0, 11)}`;
      const novo = `0${sufixo.replace(/\D/g, '').padEnd(11, '1').slice(0, 11)}`;
      const aluno = await criarAluno('MORTA', [{ kind: 'FACIAL_ENROLL_ID', externalId: antigo }]);
      await vincular({ deviceSerial: serial, externalUserIds: [antigo] });

      const viva = await db.deviceUser.findFirstOrThrow({
        where: { deviceId: ctx.deviceId, studentId: aluno },
      });
      const identidadeViva = await db.biometricIdentity.findUniqueOrThrow({
        where: { id: viva.identityId },
      });
      const identidadeMorta = await db.biometricIdentity.create({
        data: {
          tenantId: ctx.tenantId,
          studentId: aluno,
          consentRecordId: identidadeViva.consentRecordId,
          state: 'REVOKED',
        },
      });
      await db.deviceUser.create({
        data: {
          tenantId: ctx.tenantId,
          deviceId: ctx.deviceId,
          studentId: aluno,
          identityId: identidadeMorta.id,
          externalUserId: morto,
          state: 'REMOVED',
        },
      });

      await db.studentCredential.updateMany({
        where: { studentId: aluno },
        data: { externalId: novo },
      });
      const r = await vincular({ deviceSerial: serial, externalUserIds: [novo] });

      expect(r.status).toBe(201);
      expect((r.body as { studentAlreadyLinked: string[] }).studentAlreadyLinked).toEqual([novo]);
      const linhas = await db.deviceUser.findMany({
        where: { deviceId: ctx.deviceId, studentId: aluno },
        orderBy: { externalUserId: 'asc' },
      });
      expect(linhas.map((d) => [d.externalUserId, d.state])).toEqual([
        [morto, 'REMOVED'],
        [antigo, 'SYNCED'],
      ]);
    });

    it('colisao de unicidade ao reapontar conta como ja vinculado e nao derruba o lote', async () => {
      const antigo = `1${sufixo.replace(/\D/g, '').padEnd(11, '2').slice(0, 11)}`;
      const novo = `2${sufixo.replace(/\D/g, '').padEnd(11, '3').slice(0, 11)}`;
      const aluno = await criarAluno('CORRIDA', [{ kind: 'FACIAL_ENROLL_ID', externalId: antigo }]);
      await vincular({ deviceSerial: serial, externalUserIds: [antigo] });
      await db.studentCredential.updateMany({
        where: { studentId: aluno },
        data: { externalId: novo },
      });

      const espiao = jest
        .spyOn(app.get(BiometricIdentityRepository), 'reapontarNumero')
        .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
      try {
        const r = await vincular({ deviceSerial: serial, externalUserIds: [novo] });

        expect(r.status).toBe(201);
        expect(r.body).toMatchObject({ linked: 0, alreadyLinked: 1, studentAlreadyLinked: [] });
        expect(espiao).toHaveBeenCalledTimes(1);
      } finally {
        espiao.mockRestore();
      }
      const linhas = await db.deviceUser.findMany({
        where: { deviceId: ctx.deviceId, studentId: aluno },
      });
      expect(linhas.map((d) => d.externalUserId)).toEqual([antigo]);
    });

    it('vincularNumero NAO conta o leitor quando o numero esta vinculado a OUTRO aluno', async () => {
      const numero = `3${sufixo.replace(/\D/g, '').padEnd(11, '4').slice(0, 11)}`;
      const outroNumero = `4${sufixo.replace(/\D/g, '').padEnd(11, '5').slice(0, 11)}`;
      const b = await criarAluno('B-DEIXOU', [{ kind: 'FACIAL_ENROLL_ID', externalId: numero }]);
      await vincular({ deviceSerial: serial, externalUserIds: [numero] });
      // B perdeu o numero sem ninguem reapontar o vinculo dele.
      await db.studentCredential.updateMany({
        where: { studentId: b },
        data: { externalId: outroNumero },
      });
      const a = await criarAluno('A-RECEBEU', [{ kind: 'FACIAL_ENROLL_ID', externalId: numero }]);

      const r = await comContexto({ kind: 'tenant', tenantId: ctx.tenantId }, () =>
        app
          .get(VincularCadastroLegadoUseCase)
          .vincularNumero(ctx.tenantId, numero, 'teste', new Date()),
      );

      expect(r.linkedReaders).toBe(0);
      const du = await db.deviceUser.findMany({
        where: { deviceId: ctx.deviceId, externalUserId: numero },
      });
      expect(du.map((d) => d.studentId)).toEqual([b]);
      expect(await db.deviceUser.count({ where: { deviceId: ctx.deviceId, studentId: a } })).toBe(0);
    });

    it('vincularNumero com numero que nenhum leitor tem: zero e nada criado', async () => {
      const numero = `5${sufixo.replace(/\D/g, '').padEnd(11, '6').slice(0, 11)}`;
      const aluno = await criarAluno('SEM-LEITOR', [{ kind: 'FACIAL_ENROLL_ID', externalId: numero }]);

      const r = await comContexto({ kind: 'tenant', tenantId: ctx.tenantId }, () =>
        app
          .get(VincularCadastroLegadoUseCase)
          .vincularNumero(ctx.tenantId, numero, 'teste', new Date()),
      );

      expect(r.linkedReaders).toBe(0);
      expect(await db.deviceUser.count({ where: { studentId: aluno } })).toBe(0);
    });

    it('aluno com cartao e facial de numeros diferentes continua studentAlreadyLinked', async () => {
      const facial = `6${sufixo.replace(/\D/g, '').padEnd(11, '4').slice(0, 11)}`;
      const cartao = `5${sufixo.replace(/\D/g, '').padEnd(11, '5').slice(0, 11)}`;
      await criarAluno('DOIS', [
        { kind: 'FACIAL_ENROLL_ID', externalId: facial },
        { kind: 'TURNSTILE_CARD', externalId: cartao },
      ]);
      await vincular({ deviceSerial: serial, externalUserIds: [facial] });
      const r = await vincular({ deviceSerial: serial, externalUserIds: [cartao] });

      expect((r.body as { studentAlreadyLinked: string[] }).studentAlreadyLinked).toEqual([cartao]);
    });
  });
});
