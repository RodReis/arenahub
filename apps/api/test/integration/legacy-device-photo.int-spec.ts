import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CABECALHOS, assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { OBJECT_STORAGE } from '../../src/common/storage/object-storage.port.js';
import { EdgeAuthService } from '../../src/modules/edge-auth/edge-auth.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * #503 -- foto do aluno a partir do leitor facial (pedido do PI, 01/10/2026).
 *
 * O que este arquivo defende:
 *   - so numero VINCULADO a aluno entra na lista de pendentes, e so quem
 *     ainda nao tem foto;
 *   - a foto do leitor NUNCA sobrescreve a que o aluno ja tem;
 *   - o tipo sai dos BYTES (o leitor manda Base64 cru), e o que nao e JPEG
 *     nem PNG e recusado;
 *   - numero sem vinculo nao vira foto de ninguem;
 *   - a identidade vem da assinatura do Edge, nunca do corpo (regra no 2).
 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

describe('#503 -- foto do aluno vinda do leitor facial', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const serial = `SER-FOTO-${sufixo}`;
  const ctx = { tenantId: '', gymUnitId: '', keyId: '', segredo: '' };

  const gravados = new Map<string, { body: Buffer; contentType: string }>();

  /** Roda DEPOIS de gravar no bucket -- simula a recepcao no meio do caminho. */
  let aposGravar: ((key: string) => Promise<void>) | null = null;

  const storageFalso = {
    putPrivateObject: async (entrada: { key: string; body: Buffer; contentType: string }) => {
      gravados.set(entrada.key, {
        body: entrada.body,
        contentType: entrada.contentType,
      });

      await aposGravar?.(entrada.key);
    },
    getPrivateObject: (key: string) => {
      const objeto = gravados.get(key);

      return objeto ? Promise.resolve(objeto) : Promise.reject(new Error('nao encontrado'));
    },
    deletePrivateObject: (key: string) => {
      gravados.delete(key);

      return Promise.resolve();
    },
  };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const postar = (caminho: string, corpo: Record<string, unknown>): Promise<request.Response> => {
    const texto = JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('base64url');
    const assinatura = assinar(
      {
        keyId: ctx.keyId,
        timestamp,
        nonce,
        method: 'POST',
        pathAndQuery: caminho,
        body: texto,
      },
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

  const pendentes = (): Promise<request.Response> =>
    postar('/api/v1/edge/device-users/photos/pending', {
      deviceSerial: serial,
    });

  const enviarFoto = (externalUserId: string, imageBase64: string): Promise<request.Response> =>
    postar('/api/v1/edge/device-users/photos', {
      deviceSerial: serial,
      externalUserId,
      imageBase64,
    });

  /** Aluno com o numero na coluna CATRACA, ja VINCULADO ao leitor (#468). */
  const alunoVinculado = async (rotulo: string, numero: string): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId: ctx.tenantId,
        gymUnitId: ctx.gymUnitId,
        membershipNumber: `FOTO-${rotulo}-${sufixo}`,
        fullName: `Aluno ${rotulo}`,
        birthDate: new Date('1990-06-15T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    await db.studentCredential.create({
      data: {
        tenantId: ctx.tenantId,
        studentId: aluno.id,
        kind: 'TURNSTILE_CARD',
        externalId: numero,
      },
    });

    const vinculo = await postar('/api/v1/edge/device-users/legacy-links', {
      deviceSerial: serial,
      externalUserIds: [numero],
    });
    expect(vinculo.body).toMatchObject({ linked: 1 });

    return aluno.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storageFalso)
      .compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);

    const tenant = await db.tenant.create({
      data: {
        slug: `foto-${sufixo}`,
        legalName: 'Foto LTDA',
        displayName: 'Foto',
      },
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
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        code: `EDGE-FOTO-${sufixo}`,
      },
    });

    ctx.segredo = randomBytes(32).toString('base64url');
    ctx.keyId = `key-foto-${sufixo}`;

    await db.edgeCredential.create({
      data: {
        tenantId: tenant.id,
        edgeNodeId: node.id,
        keyId: ctx.keyId,
        encryptedSecret: app.get(EdgeAuthService).cifrarSegredo(ctx.segredo),
        activeFrom: new Date(Date.now() - 60_000),
      },
    });

    await db.device.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        edgeNodeId: node.id,
        kind: 'FACIAL_READER',
        model: 'AiFace',
        serial,
      },
    });

    await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo biometrico. '.repeat(5),
        contentSha256: 'f'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lista como pendente so o numero vinculado de quem nao tem foto, e importa a foto', async () => {
    const semFoto = await alunoVinculado('A', '1001');
    const comFoto = await alunoVinculado('B', '1002');
    await db.student.update({
      where: { id: comFoto },
      data: {
        photoObjectKey: `tenants/${ctx.tenantId}/students/${comFoto}/photo.png`,
      },
    });

    const antes = await pendentes();

    expect(antes.status).toBe(200);
    expect((antes.body as { externalUserIds: string[] }).externalUserIds).toEqual(['1001']);

    const resposta = await enviarFoto('1001', JPEG.toString('base64'));

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ result: 'IMPORTED' });

    const aluno = await db.student.findUniqueOrThrow({
      where: { id: semFoto },
    });
    expect(aluno.photoObjectKey).toBe(
      `tenants/${ctx.tenantId}/students/${semFoto}/photo-leitor.jpg`,
    );
    expect(gravados.get(aluno.photoObjectKey!)?.contentType).toBe('image/jpeg');
    expect(gravados.get(aluno.photoObjectKey!)?.body.equals(JPEG)).toBe(true);

    const depois = await pendentes();
    expect((depois.body as { externalUserIds: string[] }).externalUserIds).toEqual([]);
  });

  it('NAO sobrescreve a foto que o aluno ja tem', async () => {
    const alunoId = await alunoVinculado('C', '1003');
    const chave = `tenants/${ctx.tenantId}/students/${alunoId}/photo.png`;
    gravados.set(chave, { body: PNG, contentType: 'image/png' });
    await db.student.update({
      where: { id: alunoId },
      data: { photoObjectKey: chave },
    });

    const resposta = await enviarFoto('1003', JPEG.toString('base64'));

    expect(resposta.body).toEqual({ result: 'ALREADY_HAS_PHOTO' });
    expect((await db.student.findUniqueOrThrow({ where: { id: alunoId } })).photoObjectKey).toBe(
      chave,
    );
    expect(gravados.get(chave)?.body.equals(PNG)).toBe(true);
  });

  it('aceita o prefixo data:image/...;base64, e tira o tipo dos bytes', async () => {
    const alunoId = await alunoVinculado('D', '1004');

    const resposta = await enviarFoto('1004', `data:image/jpeg;base64,${PNG.toString('base64')}`);

    expect(resposta.body).toEqual({ result: 'IMPORTED' });
    expect((await db.student.findUniqueOrThrow({ where: { id: alunoId } })).photoObjectKey).toMatch(
      /photo-leitor\.png$/,
    );
  });

  it('recusa o que nao e JPEG nem PNG -- e nada vai para o storage', async () => {
    const alunoId = await alunoVinculado('E', '1005');
    const antes = gravados.size;

    const resposta = await enviarFoto('1005', Buffer.from('nao e imagem').toString('base64'));

    expect(resposta.status).toBe(400);
    expect(resposta.body).toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(gravados.size).toBe(antes);
    expect(
      (await db.student.findUniqueOrThrow({ where: { id: alunoId } })).photoObjectKey,
    ).toBeNull();
  });

  it('recepcao enviando no meio da importacao: a foto dela fica, intacta (#601)', async () => {
    const alunoId = await alunoVinculado('F', '1006');
    const chaveDaRecepcao = `tenants/${ctx.tenantId}/students/${alunoId}/photo.jpg`;

    // Entre a conferencia "sem foto" e a gravacao do leitor, a recepcao grava
    // a dela -- o mesmo formato (JPEG) que antes dividia o nome do arquivo.
    aposGravar = async (key) => {
      if (!key.includes(alunoId)) return;
      aposGravar = null;
      gravados.set(chaveDaRecepcao, { body: PNG, contentType: 'image/jpeg' });
      await db.student.update({ where: { id: alunoId }, data: { photoObjectKey: chaveDaRecepcao } });
    };

    const resposta = await enviarFoto('1006', JPEG.toString('base64'));

    expect(resposta.body).toEqual({ result: 'ALREADY_HAS_PHOTO' });
    expect((await db.student.findUniqueOrThrow({ where: { id: alunoId } })).photoObjectKey).toBe(
      chaveDaRecepcao,
    );
    expect(gravados.get(chaveDaRecepcao)?.body.equals(PNG)).toBe(true);
    // O arquivo do leitor nao fica orfao no bucket.
    expect([...gravados.keys()].some((k) => k.includes(`${alunoId}/photo-leitor`))).toBe(false);
  });

  it('numero sem vinculo nao vira foto de ninguem -- 404', async () => {
    const resposta = await enviarFoto('9999001', JPEG.toString('base64'));

    expect(resposta.status).toBe(404);
    expect(resposta.body).toMatchObject({ code: 'DEVICE_USER_NOT_LINKED' });
  });

  it('recusa tenantId no corpo -- identidade vem da assinatura', async () => {
    const resposta = await postar('/api/v1/edge/device-users/photos/pending', {
      deviceSerial: serial,
      tenantId: ctx.tenantId,
    });

    expect(resposta.status).toBe(400);
  });
});
