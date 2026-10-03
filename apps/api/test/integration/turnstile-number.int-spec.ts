import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { comContexto } from '@arenahub/database';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { TurnstileNumberService } from '../../src/modules/students/turnstile-number.service.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Numero de catraca automatico (spec 2026-10-03): o aluno ja nasce com a
 * credencial `FACIAL_ENROLL_ID`, e gerar de novo nunca troca o numero.
 */
describe('numero de catraca automatico', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = { email: `tn-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' };
  const vizinha = { email: `tn-viz-${sufixo}@exemplo.test`, tenantId: '', unidadeId: '', cookie: '' };
  // Numeros do leitor deste run: o sufixo evita colisao entre execucoes.
  const numeroDoLeitor = (n: number): string => `${parseInt(sufixo, 16) % 1_000_000}${String(n).padStart(6, '0')}`;
  let leitorId = '';

  const PERMISSOES = ['student.create', 'student.read', 'student.update'];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (
    conta: { email: string; tenantId: string; unidadeId: string; cookie: string },
    slug: string,
  ): Promise<void> => {
    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
    });

    const user = await db.user.create({
      data: { email: conta.email, passwordHash: await senhas.gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id } });

    const papel = await db.role.create({
      data: { tenantId: tenant.id, name: 'OWNER', isSystem: true },
    });

    const permissoes = await Promise.all(
      PERMISSOES.map((code) =>
        db.permission.upsert({ where: { code }, create: { code }, update: {} }),
      ),
    );

    await db.rolePermission.createMany({
      data: permissoes.map((p) => ({ roleId: papel.id, permissionId: p.id })),
    });

    await db.userRole.create({
      data: { tenantId: tenant.id, userId: user.id, roleId: papel.id },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: `Centro ${slug}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: conta.email, password: SENHA });

    conta.tenantId = tenant.id;
    conta.unidadeId = unidade.id;
    conta.cookie = cookieDeAcesso(login);
  };

  let proximoCpf = 1;
  const gerarCpfValido = (): string => {
    const base = String(100000000 + ((proximoCpf * 97) % 899999999)).padStart(9, '0');
    proximoCpf += 1;

    const digitos = base.split('').map(Number);
    const verificador = (ate: number, seq: number[]): number => {
      let soma = 0;
      for (let i = 0; i < ate; i += 1) soma += seq[i]! * (ate + 1 - i);
      const resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    };
    const d1 = verificador(9, digitos);
    const d2 = verificador(10, [...digitos, d1]);

    return `${base}${d1}${d2}`;
  };

  const criarAluno = async (c: typeof conta): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', c.cookie)
      .send({
        fullName: 'Aluno De Teste',
        birthDate: '2000-05-10',
        gymUnitId: c.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  // Chamada direta ao service, fora de requisicao: abre o escopo de RLS.
  const como = <T>(fn: () => Promise<T>): Promise<T> =>
    comContexto({ kind: 'tenant', tenantId: conta.tenantId }, fn);

  const contextoDe = (tenantId: string): TenantContext => ({
    tenantId,
    actorId: 'teste',
    sessionId: 'teste',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(conta, `tn-${sufixo}`);
    await montarAcademia(vizinha, `tn-viz-${sufixo}`);

    const node = await db.edgeNode.create({
      data: { tenantId: conta.tenantId, gymUnitId: conta.unidadeId, code: `EDGE-TN-${sufixo}` },
    });
    const leitor = await db.device.create({
      data: {
        tenantId: conta.tenantId,
        gymUnitId: conta.unidadeId,
        edgeNodeId: node.id,
        kind: 'FACIAL_READER',
        model: 'AiFace',
        serial: `TN-${sufixo}`,
      },
    });
    leitorId = leitor.id;

    // Sem termo biometrico vigente o vinculo imediato nao nasce.
    await db.consentDocument.create({
      data: {
        tenantId: conta.tenantId,
        type: 'BIOMETRIC',
        version: 1,
        purpose: 'Identificacao facial para controle de acesso',
        content: 'Termo biometrico. '.repeat(5),
        contentSha256: 'c'.repeat(64),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    // Suite que cria tenant apaga o tenant: o cascade leva alunos e credenciais.
    for (const c of [conta, vizinha]) {
      if (c.tenantId) {
        await db.tenant.delete({ where: { id: c.tenantId } }).catch(() => undefined);
      }
    }
    await db.user.deleteMany({ where: { email: { in: [conta.email, vizinha.email] } } });
    await app?.close();
  });

  it('cadastro do aluno ja nasce com numero de catraca na faixa', async () => {
    const id = await criarAluno(conta);
    const r = await request(servidor())
      .get(`/api/v1/students/${id}/credentials`)
      .set('Cookie', conta.cookie);
    const facial = (r.body as { kind: string; externalId: string }[]).find(
      (c) => c.kind === 'FACIAL_ENROLL_ID',
    );
    expect(facial).toBeDefined();
    expect(Number(facial!.externalId)).toBeGreaterThanOrEqual(100_000_000_000);
  });

  it('gerar de novo para o mesmo aluno devolve o mesmo numero', async () => {
    const id = await criarAluno(conta);
    const servico = app.get(TurnstileNumberService);
    const ctx = contextoDe(conta.tenantId);
    const primeiro = await como(() => servico.gerar(ctx, id));
    const segundo = await como(() => servico.gerar(ctx, id));
    expect(segundo).toEqual({ externalId: primeiro.externalId, created: false });
  });

  it('duas geracoes em paralelo para alunos diferentes nao repetem numero', async () => {
    const [a, b] = await Promise.all([criarAluno(conta), criarAluno(conta)]);
    // O cadastro ja gerou numero; limpa para o `gerar` abaixo ser a primeira
    // geracao dos dois e disputar de fato o mesmo menor numero livre.
    await db.studentCredential.deleteMany({ where: { studentId: { in: [a, b] } } });
    const servico = app.get(TurnstileNumberService);
    const ctx = contextoDe(conta.tenantId);
    const [ra, rb] = await Promise.all([
      como(() => servico.gerar(ctx, a)),
      como(() => servico.gerar(ctx, b)),
    ]);
    expect(ra.externalId).not.toBe(rb.externalId);
  });

  it('cinco geracoes em paralelo para alunos diferentes: todas criam, distintas, na faixa e persistidas', async () => {
    const ids = await Promise.all(Array.from({ length: 5 }, () => criarAluno(conta)));
    // Limpa o numero do cadastro para as cinco disputarem o mesmo menor livre.
    await db.studentCredential.deleteMany({ where: { studentId: { in: ids } } });
    const servico = app.get(TurnstileNumberService);
    const ctx = contextoDe(conta.tenantId);

    const resultados = await Promise.all(ids.map((id) => como(() => servico.gerar(ctx, id))));

    expect(resultados.every((r) => r.created)).toBe(true);
    const numeros = resultados.map((r) => r.externalId);
    expect(new Set(numeros).size).toBe(5);
    for (const n of numeros) {
      expect(Number(n)).toBeGreaterThanOrEqual(100_000_000_000);
      expect(Number(n)).toBeLessThanOrEqual(999_999_999_999);
    }
    const gravadas = await db.studentCredential.findMany({
      where: { studentId: { in: ids }, kind: 'FACIAL_ENROLL_ID' },
    });
    expect(gravadas.map((c) => c.externalId).sort()).toEqual([...numeros].sort());
  });

  it('se a geracao do numero falha, o cadastro ainda responde 201 e o aluno fica sem numero', async () => {
    const servico = app.get(TurnstileNumberService);
    const espiao = jest.spyOn(servico, 'gerar').mockRejectedValue(new Error('falha simulada'));
    try {
      const id = await criarAluno(conta); // criarAluno ja afirma 201
      const existe = await db.student.findUnique({ where: { id } });
      expect(existe).not.toBeNull();
      const creds = await db.studentCredential.findMany({
        where: { studentId: id, kind: 'FACIAL_ENROLL_ID' },
      });
      expect(creds).toHaveLength(0);
      expect(espiao).toHaveBeenCalledTimes(1);
    } finally {
      espiao.mockRestore();
    }
  });

  describe('rotas da acao da lista', () => {
    const postar = (id: string, corpo: object, c = conta): request.Test =>
      request(servidor())
        .post(`/api/v1/students/${id}/turnstile-number`)
        .set('Cookie', c.cookie)
        .send(corpo);

    it('POST sem numero gera e devolve o numero do aluno', async () => {
      const id = await criarAluno(conta);
      await db.studentCredential.deleteMany({ where: { studentId: id } });
      const r = await postar(id, {});
      expect(r.status).toBe(200);
      const corpo = r.body as { externalId: string; linkedReaders: number };
      expect(Number(corpo.externalId)).toBeGreaterThanOrEqual(100_000_000_000);
      expect(corpo.linkedReaders).toBe(0);
    });

    it('POST com numero do leitor grava e vincula na hora', async () => {
      const numero = numeroDoLeitor(1);
      await db.deviceReaderNumber.create({
        data: { tenantId: conta.tenantId, deviceId: leitorId, externalUserId: numero, seenAt: new Date(), readerName: 'MARIA S' },
      });
      const id = await criarAluno(conta);
      const r = await postar(id, { externalId: numero });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ externalId: numero, linkedReaders: 1 });
    });

    it('POST com numero que ja e de outro aluno da 409', async () => {
      const dono = await criarAluno(conta);
      const credenciais = await request(servidor())
        .get(`/api/v1/students/${dono}/credentials`)
        .set('Cookie', conta.cookie);
      const ocupado = (credenciais.body as { externalId: string }[])[0]!.externalId;
      const outro = await criarAluno(conta);
      const r = await postar(outro, { externalId: ocupado });
      expect(r.status).toBe(409);
      expect((r.body as { code: string }).code).toBe('CREDENTIAL_ALREADY_ASSIGNED');
    });

    it('POST com numero ocupado no leitor da 409 sem vincular e sem gravar nada', async () => {
      const ocupado = numeroDoLeitor(50);
      await db.deviceReaderNumber.create({
        data: { tenantId: conta.tenantId, deviceId: leitorId, externalUserId: ocupado, seenAt: new Date() },
      });
      const dono = await criarAluno(conta);
      await db.studentCredential.deleteMany({ where: { studentId: dono } });
      await db.studentCredential.create({
        data: { tenantId: conta.tenantId, studentId: dono, kind: 'FACIAL_ENROLL_ID', externalId: ocupado },
      });
      const outro = await criarAluno(conta);
      await db.studentCredential.deleteMany({ where: { studentId: outro } });

      const r = await postar(outro, { externalId: ocupado });

      expect(r.status).toBe(409);
      expect((r.body as { code: string }).code).toBe('CREDENTIAL_ALREADY_ASSIGNED');
      expect(await db.deviceUser.count({ where: { deviceId: leitorId, externalUserId: ocupado } })).toBe(0);
      expect(await db.studentCredential.count({ where: { studentId: outro } })).toBe(0);
    });

    it('POST com numero que e CARTAO de outro aluno da 409 e nao grava o facial', async () => {
      const cartao = numeroDoLeitor(51);
      const dono = await criarAluno(conta);
      await db.studentCredential.create({
        data: { tenantId: conta.tenantId, studentId: dono, kind: 'TURNSTILE_CARD', externalId: cartao },
      });
      const outro = await criarAluno(conta);
      const antes = await db.studentCredential.findMany({ where: { studentId: outro } });

      const r = await postar(outro, { externalId: cartao });

      expect(r.status).toBe(409);
      expect((r.body as { code: string }).code).toBe('CREDENTIAL_ALREADY_ASSIGNED');
      expect(await db.studentCredential.count({ where: { studentId: outro, externalId: cartao } })).toBe(0);
      expect(await db.studentCredential.findMany({ where: { studentId: outro } })).toEqual(antes);
    });

    it('POST com numero igual ao proprio cartao do aluno nao e conflito', async () => {
      const cartao = numeroDoLeitor(52);
      const id = await criarAluno(conta);
      await db.studentCredential.create({
        data: { tenantId: conta.tenantId, studentId: id, kind: 'TURNSTILE_CARD', externalId: cartao },
      });

      const r = await postar(id, { externalId: cartao });

      expect(r.status).toBe(200);
      expect((r.body as { externalId: string }).externalId).toBe(cartao);
    });

    it('POST sem numero duas vezes devolve o mesmo numero', async () => {
      const id = await criarAluno(conta);
      await db.studentCredential.deleteMany({ where: { studentId: id } });

      const primeira = await postar(id, {});
      const segunda = await postar(id, {});

      expect(primeira.status).toBe(200);
      expect(segunda.status).toBe(200);
      expect((segunda.body as { externalId: string }).externalId).toBe(
        (primeira.body as { externalId: string }).externalId,
      );
    });

    it('POST de aluno inexistente da 404', async () => {
      const r = await postar(randomUUID(), {});
      expect(r.status).toBe(404);
      expect((r.body as { code: string }).code).toBe('STUDENT_NOT_FOUND');
    });

    it('POST recusa campo extra e numero malformado (tenant nunca vem do corpo)', async () => {
      const id = await criarAluno(conta);
      expect((await postar(id, { tenantId: vizinha.tenantId })).status).toBe(400);
      expect((await postar(id, { externalId: '12ab' })).status).toBe(400);
      expect((await postar(id, { externalId: '1234567890123' })).status).toBe(400);
    });

    it('GET unlinked lista so numero de leitor sem aluno, com nome, ordenado', async () => {
      const livreB = numeroDoLeitor(99);
      const livreA = numeroDoLeitor(98);
      for (const [numero, nome] of [[livreB, 'JOAO P'], [livreA, null]] as const) {
        await db.deviceReaderNumber.create({
          data: { tenantId: conta.tenantId, deviceId: leitorId, externalUserId: numero, seenAt: new Date(), readerName: nome },
        });
      }
      const r = await request(servidor())
        .get('/api/v1/device-reader-numbers/unlinked')
        .set('Cookie', conta.cookie);
      expect(r.status).toBe(200);
      const lista = r.body as { externalId: string; readerName: string | null; deviceSerial: string }[];
      expect(lista).toContainEqual({ externalId: livreB, readerName: 'JOAO P', deviceSerial: `TN-${sufixo}` });
      expect(lista).toContainEqual({ externalId: livreA, readerName: null, deviceSerial: `TN-${sufixo}` });
      // Vinculado ao aluno no teste anterior: nao e mais "sem aluno".
      expect(lista.map((l) => l.externalId)).not.toContain(numeroDoLeitor(1));
      const ids = lista.map((l) => l.externalId);
      expect(ids).toEqual([...ids].sort());
    });

    it('GET unlinked nao mostra numero de leitor de outro tenant', async () => {
      // Garante que o vazio abaixo nao e por falta de dado: o dono tem numeros.
      const doDono = await request(servidor())
        .get('/api/v1/device-reader-numbers/unlinked')
        .set('Cookie', conta.cookie);
      expect((doDono.body as unknown[]).length).toBeGreaterThan(0);

      const r = await request(servidor())
        .get('/api/v1/device-reader-numbers/unlinked')
        .set('Cookie', vizinha.cookie);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });
  });
});
