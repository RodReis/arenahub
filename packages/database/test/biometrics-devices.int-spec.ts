import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaClient, type PrismaClientArenaHub } from '../src/index.js';

/**
 * Constraints da F8 -- consentimento, biometria e sincronizacao.
 *
 * Estes testes protegem as garantias que a ANPD cobrou no caso da rede
 * estadual do PR (04/08/2026) e que o ADR-008 fixou. Garantia que so vive no
 * caso de uso e promessa: um `create` esquecido a quebra em silencio.
 * Constraint no banco falha alto, na hora.
 */
describe('constraints de biometria e dispositivos', () => {
  let db: PrismaClientArenaHub;

  const sufixo = randomUUID().slice(0, 8);

  /** Tenant + unidade + aluno + termo, o minimo para exercitar a fatia. */
  const montarCenario = async (
    rotulo: string,
  ): Promise<{
    tenantId: string;
    gymUnitId: string;
    studentId: string;
    documentId: string;
  }> => {
    const tenant = await db.tenant.create({
      data: {
        slug: `${rotulo}-${sufixo}`,
        legalName: `${rotulo} LTDA`,
        displayName: rotulo,
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

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        membershipNumber: `AP-2026-${randomUUID().slice(0, 8)}`,
        fullName: 'Aluno de Teste',
        birthDate: new Date('2000-01-01T00:00:00.000Z'),
      },
    });

    const documento = await db.consentDocument.create({
      data: {
        tenantId: tenant.id,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para acesso a academia',
        content: 'Termo de consentimento biometrico, versao 1.',
        contentSha256: 'a'.repeat(64),
        effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      },
    });

    return {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      studentId: aluno.id,
      documentId: documento.id,
    };
  };

  /** Consentimento aceito, pronto para autorizar uma identidade. */
  const registrarConsentimento = async (cenario: {
    tenantId: string;
    studentId: string;
    documentId: string;
  }): Promise<string> => {
    const registro = await db.consentRecord.create({
      data: {
        tenantId: cenario.tenantId,
        studentId: cenario.studentId,
        documentId: cenario.documentId,
        decision: 'ACCEPTED',
        subjectKind: 'STUDENT',
        subjectAgeYears: 26,
        occurredAt: new Date(),
      },
    });

    return registro.id;
  };

  beforeAll(() => {
    db = criarPrismaClient();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe('ConsentDocument', () => {
    it('recusa a mesma versao repetida para o mesmo tipo e tenant', async () => {
      const cenario = await montarCenario('consent-dup');

      // Versao e a identidade juridica do termo. Repetir a versao com texto
      // diferente faria "v1" significar duas coisas -- e a prova do que a
      // pessoa aceitou evaporaria.
      await expect(
        db.consentDocument.create({
          data: {
            tenantId: cenario.tenantId,
            type: 'BIOMETRIC',
            version: 1,
            purpose: 'Outra finalidade',
            content: 'Texto diferente com a mesma versao.',
            contentSha256: 'b'.repeat(64),
            effectiveFrom: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('aceita versao nova, e a anterior continua existindo', async () => {
      const cenario = await montarCenario('consent-v2');

      await db.consentDocument.create({
        data: {
          tenantId: cenario.tenantId,
          type: 'BIOMETRIC',
          version: 2,
          purpose: 'Identificacao facial para acesso a academia',
          content: 'Termo de consentimento biometrico, versao 2.',
          contentSha256: 'c'.repeat(64),
          effectiveFrom: new Date(),
        },
      });

      const versoes = await db.consentDocument.findMany({
        where: { tenantId: cenario.tenantId, type: 'BIOMETRIC' },
      });

      // Versao aposentada nao morre: ha consentimento vivo apontando para ela.
      expect(versoes).toHaveLength(2);
    });
  });

  describe('BiometricIdentity', () => {
    it('nao tem coluna de template nem de imagem (INV-020)', async () => {
      const colunas = await db.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'biometric_identities'
      `;

      const nomes = colunas.map((c) => c.column_name);

      // A garantia central da fatia: a nuvem NAO acumula biometria bruta. O
      // template vive no leitor; a imagem, no object storage privado. Esta
      // assercao existe para quebrar o dia em que alguem "so precisar
      // guardar a foto aqui para facilitar".
      expect(nomes).not.toContain('template');
      expect(nomes).not.toContain('template_data');
      expect(nomes).not.toContain('biometric_data');
      expect(nomes).not.toContain('photo');
      expect(nomes).not.toContain('image');
      // Guarda a REFERENCIA, nao o dado.
      expect(nomes).toContain('enrollment_object_key');
    });

    it('nenhuma coluna da fatia usa tipo binario', async () => {
      const binarias = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_name IN (
          'biometric_identities', 'consent_records', 'device_users',
          'device_sync_jobs', 'device_commands'
        )
        AND data_type = 'bytea'
      `;

      // `bytea` numa destas tabelas so pode significar uma coisa: template
      // ou imagem entrou no banco.
      expect(binarias).toEqual([]);
    });

    it('exige consentimento existente para nascer (INV-017)', async () => {
      const cenario = await montarCenario('identidade-sem-consent');

      await expect(
        db.biometricIdentity.create({
          data: {
            tenantId: cenario.tenantId,
            studentId: cenario.studentId,
            // Consentimento que nao existe: a FK barra.
            consentRecordId: randomUUID(),
          },
        }),
      ).rejects.toThrow();
    });

    it('nasce ACTIVE quando ha consentimento', async () => {
      const cenario = await montarCenario('identidade-ok');
      const consentimento = await registrarConsentimento(cenario);

      const identidade = await db.biometricIdentity.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          consentRecordId: consentimento,
        },
      });

      expect(identidade.state).toBe('ACTIVE');
      expect(identidade.deletedAt).toBeNull();
    });
  });

  describe('ConsentRecord', () => {
    it('registra recusa como decisao valida (INV-022b)', async () => {
      const cenario = await montarCenario('consent-recusa');

      const recusa = await db.consentRecord.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          documentId: cenario.documentId,
          decision: 'REFUSED',
          subjectKind: 'STUDENT',
          subjectAgeYears: 30,
          occurredAt: new Date(),
        },
      });

      // Recusar e escolha registrada, nao ausencia de resposta. Sem esta
      // linha, "nao consta" seria indistinguivel de "nunca perguntamos" --
      // e o consentimento deixaria de ser demonstravelmente livre.
      expect(recusa.decision).toBe('REFUSED');

      // E o aluno continua cadastrado: recusar biometria nao nega matricula.
      const aluno = await db.student.findUnique({ where: { id: cenario.studentId } });
      expect(aluno).not.toBeNull();
    });

    it('guarda quem prestou o consentimento por menor de 18 (INV-143)', async () => {
      const cenario = await montarCenario('consent-menor');

      const registro = await db.consentRecord.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          documentId: cenario.documentId,
          decision: 'ACCEPTED',
          subjectKind: 'LEGAL_GUARDIAN',
          guardianName: 'Responsavel de Teste',
          guardianRelation: 'MAE',
          // Idade CONGELADA na data da decisao: e o que permite saber quando
          // a revalidacao na virada dos 18 vence.
          subjectAgeYears: 16,
          occurredAt: new Date(),
        },
      });

      expect(registro.subjectKind).toBe('LEGAL_GUARDIAN');
      expect(registro.guardianName).toBe('Responsavel de Teste');
      expect(registro.subjectAgeYears).toBe(16);
    });

    it('revogacao cria linha nova em vez de reescrever a decisao', async () => {
      const cenario = await montarCenario('consent-revoga');
      const aceite = await registrarConsentimento(cenario);

      const revogacao = await db.consentRecord.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          documentId: cenario.documentId,
          decision: 'REFUSED',
          subjectKind: 'STUDENT',
          subjectAgeYears: 26,
          occurredAt: new Date(),
          revokesRecordId: aceite,
        },
      });

      const original = await db.consentRecord.findUnique({ where: { id: aceite } });

      // O aceite continua ACCEPTED: apagar a decisao apagaria a prova de que
      // houve consentimento no periodo em que a biometria funcionou -- que e
      // exatamente o que uma fiscalizacao pede para ver.
      expect(original?.decision).toBe('ACCEPTED');
      expect(revogacao.revokesRecordId).toBe(aceite);
    });
  });

  describe('DeviceUser', () => {
    const montarDispositivo = async (
      cenario: { tenantId: string; gymUnitId: string },
      serial: string,
    ): Promise<string> => {
      const dispositivo = await db.device.create({
        data: {
          tenantId: cenario.tenantId,
          gymUnitId: cenario.gymUnitId,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial,
        },
      });

      return dispositivo.id;
    };

    it('recusa o mesmo external_user_id duas vezes no mesmo dispositivo (INV-025)', async () => {
      const cenario = await montarCenario('deviceuser-dup');
      const consentimento = await registrarConsentimento(cenario);
      const deviceId = await montarDispositivo(cenario, `SER-${sufixo}-1`);

      const primeira = await db.biometricIdentity.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          consentRecordId: consentimento,
        },
      });

      const segunda = await db.biometricIdentity.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          consentRecordId: consentimento,
        },
      });

      await db.deviceUser.create({
        data: {
          tenantId: cenario.tenantId,
          deviceId,
          studentId: cenario.studentId,
          identityId: primeira.id,
          externalUserId: '1001',
        },
      });

      // `enrollid` repetido no mesmo leitor faria duas pessoas colidirem no
      // equipamento -- a catraca abriria para a errada.
      await expect(
        db.deviceUser.create({
          data: {
            tenantId: cenario.tenantId,
            deviceId,
            studentId: cenario.studentId,
            identityId: segunda.id,
            externalUserId: '1001',
          },
        }),
      ).rejects.toThrow();
    });

    it('recusa a mesma identidade duas vezes no mesmo dispositivo (INV-024)', async () => {
      const cenario = await montarCenario('deviceuser-identidade');
      const consentimento = await registrarConsentimento(cenario);
      const deviceId = await montarDispositivo(cenario, `SER-${sufixo}-2`);

      const identidade = await db.biometricIdentity.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          consentRecordId: consentimento,
        },
      });

      await db.deviceUser.create({
        data: {
          tenantId: cenario.tenantId,
          deviceId,
          studentId: cenario.studentId,
          identityId: identidade.id,
          externalUserId: '2001',
        },
      });

      await expect(
        db.deviceUser.create({
          data: {
            tenantId: cenario.tenantId,
            deviceId,
            studentId: cenario.studentId,
            identityId: identidade.id,
            externalUserId: '2002',
          },
        }),
      ).rejects.toThrow();
    });

    it('nao usa CPF como identificador de dispositivo (INV-012)', async () => {
      const colunas = await db.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'device_users'
      `;

      const nomes = colunas.map((c) => c.column_name);

      // `external_user_id` e gerado por dispositivo. CPF no leitor exporia
      // documento a quem tiver acesso fisico ao equipamento.
      expect(nomes).not.toContain('cpf');
      expect(nomes).not.toContain('cpf_hash');
      expect(nomes).toContain('external_user_id');
    });
  });

  describe('Device', () => {
    it('recusa serial repetido dentro do tenant', async () => {
      const cenario = await montarCenario('device-serial');
      const serial = `SER-UNICO-${sufixo}`;

      const dados = {
        tenantId: cenario.tenantId,
        gymUnitId: cenario.gymUnitId,
        kind: 'FACIAL_READER' as const,
        model: 'Inner Fit',
        serial,
      };

      await db.device.create({ data: dados });

      // O mesmo leitor cadastrado duas vezes viraria dois alvos de sync para
      // um equipamento so -- e a identidade nunca ficaria "entregue a todos".
      await expect(db.device.create({ data: dados })).rejects.toThrow();
    });
  });

  describe('DeviceSyncJob', () => {
    it('recusa chave de idempotencia repetida', async () => {
      const cenario = await montarCenario('syncjob-idem');
      const consentimento = await registrarConsentimento(cenario);

      const dispositivo = await db.device.create({
        data: {
          tenantId: cenario.tenantId,
          gymUnitId: cenario.gymUnitId,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial: `SER-JOB-${sufixo}`,
        },
      });

      const identidade = await db.biometricIdentity.create({
        data: {
          tenantId: cenario.tenantId,
          studentId: cenario.studentId,
          consentRecordId: consentimento,
        },
      });

      const chave = `${identidade.id}:${dispositivo.id}:UPSERT`;

      const dados = {
        tenantId: cenario.tenantId,
        deviceId: dispositivo.id,
        identityId: identidade.id,
        operation: 'UPSERT' as const,
        idempotencyKey: chave,
        correlationId: randomUUID(),
      };

      await db.deviceSyncJob.create({ data: dados });

      // Outbox reprocessado nao pode virar dois jobs para o mesmo trabalho
      // logico (regra de arquitetura no 4).
      await expect(db.deviceSyncJob.create({ data: dados })).rejects.toThrow();
    });
  });

  describe('ReplayNonce', () => {
    it('recusa o mesmo nonce duas vezes para a mesma chave', async () => {
      const cenario = await montarCenario('nonce-replay');

      const edge = await db.edgeNode.create({
        data: {
          tenantId: cenario.tenantId,
          gymUnitId: cenario.gymUnitId,
          code: 'EDGE-01',
        },
      });

      const dados = {
        edgeNodeId: edge.id,
        keyId: `key-${sufixo}`,
        nonceHash: 'd'.repeat(64),
        expiresAt: new Date(Date.now() + 300_000),
      };

      await db.replayNonce.create({ data: dados });

      // A unicidade E o mecanismo anti-replay: o INSERT acontece dentro da
      // transacao da requisicao, e a violacao vira `EDGE_REPLAY_DETECTED`.
      // Checar antes e inserir depois deixaria a corrida aberta.
      await expect(db.replayNonce.create({ data: dados })).rejects.toThrow();
    });
  });

  describe('TenantPrivacySettings', () => {
    it('usa 30 dias como padrao de expurgo, e o prazo e parametro (INV-142)', async () => {
      const cenario = await montarCenario('privacidade');

      const politica = await db.tenantPrivacySettings.create({
        data: { tenantId: cenario.tenantId },
      });

      expect(politica.purgeAfterDays).toBe(30);

      // Parametro do cliente, nao constante: quem decide o prazo e a
      // academia controladora (art. 39) -- e o que sustenta nossa posicao de
      // operador contra reclassificacao pela ANPD.
      const ajustada = await db.tenantPrivacySettings.update({
        where: { tenantId: cenario.tenantId },
        data: { purgeAfterDays: 15 },
      });

      expect(ajustada.purgeAfterDays).toBe(15);
    });
  });

  describe('isolamento entre tenants', () => {
    it('identidade de um tenant nao aparece na consulta do outro', async () => {
      const primeiro = await montarCenario('iso-a');
      const segundo = await montarCenario('iso-b');
      const consentimento = await registrarConsentimento(primeiro);

      await db.biometricIdentity.create({
        data: {
          tenantId: primeiro.tenantId,
          studentId: primeiro.studentId,
          consentRecordId: consentimento,
        },
      });

      const vistasPeloSegundo = await db.biometricIdentity.findMany({
        where: { tenantId: segundo.tenantId },
      });

      expect(vistasPeloSegundo).toHaveLength(0);
    });
  });
});
