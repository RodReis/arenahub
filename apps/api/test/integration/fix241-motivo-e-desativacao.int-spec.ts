import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Issue #241 -- as tres mudancas de API, provadas contra o banco.
 *
 * O que estas suites existem para pegar:
 *
 *   1. `PATCH /units/:id` recusava `status` (schema `.strict()`): inativar uma
 *      unidade so era possivel por `UPDATE` direto no banco.
 *   2. `PATCH /devices/:id` aposentava sem exigir motivo -- e o motivo, mesmo
 *      informado, nao ia para lugar nenhum.
 *   3. `PATCH /students/:id/status` aceitava so `{status, version}`: a grid
 *      dizia "Bloqueado" e nao dizia por que.
 *
 * E a invariante que amarra a terceira: motivo existe se, e somente se, o
 * aluno esta `SUSPENDED` ou `BLOCKED`. Os dois lados sao testados -- o que
 * exige e o que LIMPA.
 */
const SENHA = 'SenhaForte#2026';

describe('#241 -- motivo de situacao e desativacao por status', () => {
  let app: INestApplication;
  let db: PrismaService;
  let tenantId = '';
  let gymUnitId = '';
  let cookie = '';

  /** `getHttpServer()` devolve `any`; o helper prende o tipo num lugar so. */
  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    const sufixo = randomUUID().slice(0, 8);

    const tenant = await db.tenant.create({
      data: { slug: `t-${sufixo}`, legalName: `T-${sufixo} LTDA`, displayName: `T-${sufixo}` },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `U-${sufixo}`,
        name: `U-${sufixo}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    const email = `admin-${sufixo}@arenahub.test`;

    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: 'ADMIN DE TESTE', isSystem: false },
    });

    /*
     * As permissoes que ESTE arquivo exercita, uma a uma. Faltando qualquer
     * delas, a rota responde 403 e o teste passaria (ou falharia) pelo motivo
     * errado: recusa por permissao e recusa por schema sao indistinguiveis
     * quando so se olha o status HTTP.
     */
    for (const codigo of [
      'unit.read',
      'unit.update',
      'device.read',
      'device.manage',
      'student.read',
      'student.update',
    ]) {
      const permissao = await db.permission.upsert({
        where: { code: codigo },
        create: { code: codigo },
        update: {},
      });

      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });

    const cabecalho: unknown = login.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    cookie = lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  describe('unidade', () => {
    it('inativa a unidade e guarda o motivo na auditoria', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/units/${gymUnitId}`)
        .set('cookie', cookie)
        .send({ status: 'INACTIVE', reason: 'unidade fechada para reforma estrutural' });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { status: string }).status).toBe('INACTIVE');

      const auditoria = await db.auditLog.findFirst({
        where: { tenantId, target: 'gym_unit', targetId: gymUnitId },
        orderBy: { occurredAt: 'desc' },
      });

      // O motivo tem de estar GRAVADO. Coletar e descartar seria teatro de
      // auditoria -- pior que nao pedir, porque parece que alguem responde.
      expect(auditoria?.metadata).toMatchObject({
        motivo: 'unidade fechada para reforma estrutural',
      });
    });

    it('recusa inativar sem motivo', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/units/${gymUnitId}`)
        .set('cookie', cookie)
        .send({ status: 'INACTIVE' });

      expect(resposta.status).toBe(400);
    });

    it('reativa sem exigir motivo', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/units/${gymUnitId}`)
        .set('cookie', cookie)
        .send({ status: 'ACTIVE' });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { status: string }).status).toBe('ACTIVE');
    });

    it('recusa status fora do enum', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/units/${gymUnitId}`)
        .set('cookie', cookie)
        .send({ status: 'DELETED', reason: 'tentativa de excluir de verdade' });

      expect(resposta.status).toBe(400);
    });
  });

  describe('dispositivo', () => {
    let deviceId = '';

    beforeAll(async () => {
      const dispositivo = await db.device.create({
        data: {
          tenantId,
          gymUnitId,
          kind: 'FACIAL_READER',
          model: 'Inner Fit',
          serial: `S-${randomUUID().slice(0, 8)}`,
          status: 'ACTIVE',
        },
      });
      deviceId = dispositivo.id;
    });

    it('recusa aposentar sem motivo', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/devices/${deviceId}`)
        .set('cookie', cookie)
        .send({ status: 'RETIRED' });

      expect(resposta.status).toBe(400);
    });

    it('aceita manutencao sem motivo -- e movimento rotineiro', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/devices/${deviceId}`)
        .set('cookie', cookie)
        .send({ status: 'MAINTENANCE' });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { status: string }).status).toBe('MAINTENANCE');
    });

    it('aposenta com motivo e o grava na auditoria', async () => {
      const resposta = await request(servidor())
        .patch(`/api/v1/devices/${deviceId}`)
        .set('cookie', cookie)
        .send({ status: 'RETIRED', reason: 'leitor queimado apos descarga eletrica' });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { status: string }).status).toBe('RETIRED');

      const auditoria = await db.auditLog.findFirst({
        where: { tenantId, target: 'device', targetId: deviceId },
        orderBy: { occurredAt: 'desc' },
      });

      expect(auditoria?.metadata).toMatchObject({
        motivo: 'leitor queimado apos descarga eletrica',
      });
    });
  });

  describe('situacao do aluno', () => {
    let studentId = '';
    let versao = 0;

    beforeAll(async () => {
      const aluno = await db.student.create({
        data: {
          tenantId,
          gymUnitId,
          membershipNumber: `AP-2026-${randomUUID().slice(0, 8)}`,
          fullName: 'Aluno de Teste',
          birthDate: new Date('1990-01-01'),
          status: 'ACTIVE',
        },
      });
      studentId = aluno.id;
      versao = aluno.version;
    });

    const alterar = (corpo: Record<string, unknown>) =>
      request(servidor())
        .patch(`/api/v1/students/${studentId}/status`)
        .set('cookie', cookie)
        .send(corpo);

    it('recusa bloquear sem motivo', async () => {
      const resposta = await alterar({ status: 'BLOCKED', version: versao });

      expect(resposta.status).toBe(400);
      // CODIGO, nao so status: `400` sozinho nao distingue "falta o motivo"
      // de qualquer outra recusa de schema, e a tela traduz por codigo.
      expect((resposta.body as { code: string }).code).toBe('STUDENT_STATUS_REASON_REQUIRED');
    });

    /*
     * A ORDEM DOS ERROS IMPORTA, e este teste existe para prende-la.
     *
     * A regra do motivo nasceu num `.refine()` do schema Zod, e por isso
     * rodava ANTES de `transicionarAluno`: `LEAD -> SUSPENDED` -- transicao
     * que nao existe -- respondia "falta o motivo" em vez de dizer que o
     * caminho nao e permitido. Quem recebe a mensagem corrige a coisa errada:
     * preenche o motivo e leva outra recusa.
     *
     * Dois testes de integracao da F7 pegaram isso. Este prende a ordem no
     * lado de ca tambem, para a regressao nao depender de teste alheio.
     */
    it('recusa a TRANSICAO antes de cobrar o motivo, quando as duas falham', async () => {
      const novo = await db.student.create({
        data: {
          tenantId,
          gymUnitId,
          membershipNumber: `AP-2026-${randomUUID().slice(0, 8)}`,
          fullName: 'Aluno Interessado',
          birthDate: new Date('1990-01-01'),
          status: 'LEAD',
        },
      });

      // LEAD -> SUSPENDED nao esta na tabela de transicoes, E vai sem motivo.
      const resposta = await request(servidor())
        .patch(`/api/v1/students/${novo.id}/status`)
        .set('cookie', cookie)
        .send({ status: 'SUSPENDED', version: novo.version });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('STUDENT_INVALID_TRANSITION');
    });

    it('recusa observacao sem motivo -- ela detalha a razao, nao a substitui', async () => {
      const resposta = await alterar({
        status: 'BLOCKED',
        version: versao,
        reasonNote: 'devendo desde julho',
      });

      expect(resposta.status).toBe(400);
    });

    it('bloqueia com motivo e devolve a razao no DTO', async () => {
      const resposta = await alterar({
        status: 'BLOCKED',
        version: versao,
        reason: 'DELINQUENCY',
        reasonNote: 'tres mensalidades em aberto',
      });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { status: string }).status).toBe('BLOCKED');
      expect((resposta.body as { statusReason: string }).statusReason).toBe('DELINQUENCY');
      expect((resposta.body as { statusReasonNote: string }).statusReasonNote).toBe(
        'tres mensalidades em aberto',
      );

      versao = (resposta.body as { version: number }).version;
    });

    it('guarda o motivo na timeline, que nao e reescrita', async () => {
      const evento = await db.studentTimelineEvent.findFirst({
        where: { tenantId, studentId, type: 'STUDENT_STATUS_CHANGED' },
        orderBy: { occurredAt: 'desc' },
      });

      expect(evento?.payload).toMatchObject({
        status: 'BLOCKED',
        reason: 'DELINQUENCY',
      });
    });

    it('recusa motivo em transicao que nao o comporta', async () => {
      /*
       * NAO E PREGUICA DE VALIDAR -- e o contrario. Aceitar e descartar
       * deixaria o chamador convicto de ter gravado uma razao que nao existe
       * em lugar nenhum; gravar derrubaria a transacao no `CHECK` do banco,
       * com erro de constraint que nao diz a ninguem o que fazer.
       */
      const resposta = await alterar({
        status: 'ACTIVE',
        version: versao,
        reason: 'MEDICAL',
      });

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('STUDENT_STATUS_REASON_NOT_APPLICABLE');
    });

    it('LIMPA o motivo ao voltar para ativo', async () => {
      const resposta = await alterar({ status: 'ACTIVE', version: versao });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { status: string }).status).toBe('ACTIVE');

      /*
       * O CASO QUE O `CHECK` DO BANCO PEGA, e que a aplicacao tem de evitar
       * antes: sem limpar, o aluno volta a treinar carregando "inadimplencia"
       * no cadastro -- e a proxima pessoa que abrir a ficha le um motivo que
       * nao vale mais.
       */
      expect((resposta.body as { statusReason: string | null }).statusReason).toBeNull();
      expect((resposta.body as { statusReasonNote: string | null }).statusReasonNote).toBeNull();

      const gravado = await db.student.findFirstOrThrow({ where: { id: studentId } });

      expect(gravado.statusReason).toBeNull();
      expect(gravado.statusReasonNote).toBeNull();
    });
  });
});
