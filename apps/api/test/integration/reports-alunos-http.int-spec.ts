import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { apagarCenario, criarCenarioDeDiaria, type CenarioDeDiaria } from './helpers/cenario-de-diaria.js';

/**
 * O que SÓ o HTTP prova: a permissão `student.read` guarda as duas rotas, o
 * tenant vem da sessão (nunca de parâmetro), filtro lixo não vira 400, e o
 * arquivo sai com os cabeçalhos e o conteúdo certos.
 */
describe('F90 -- GET /reports/students e /reports/students/export', () => {
  let app: INestApplication;
  let db: PrismaService;
  let c: CenarioDeDiaria;
  let outro: CenarioDeDiaria;

  const SENHA = 'senha-de-teste-relatorio';
  const cookies = { leitor: '', semPermissao: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((x) => x.startsWith('arenahub_access=')) ?? '';
  };

  /** Baixa o corpo como bytes, sem o parser de texto do supertest. */
  const baixar = (rota: string) =>
    request(servidor())
      .get(rota)
      .set('Cookie', cookies.leitor)
      .buffer(true)
      .parse((res, cb) => {
        const pedacos: Buffer[] = [];
        res.on('data', (p: Buffer) => pedacos.push(p));
        res.on('end', () => cb(null, Buffer.concat(pedacos)));
      });

  async function usuarioCom(
    rotulo: string,
    tenant: CenarioDeDiaria,
    codigos: readonly string[],
  ): Promise<string> {
    const usuario = await db.user.create({
      data: {
        email: `relatorio-http-${rotulo}-${tenant.sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash(SENHA),
      },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: tenant.tenantId, name: `PAPEL_${rotulo}_${tenant.sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({ where: { code }, create: { code }, update: {} });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({
      data: { tenantId: tenant.tenantId, userId: usuario.id, roleId: papel.id },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: SENHA });

    return cookieDeAcesso(login);
  }

  async function aluno(tenant: CenarioDeDiaria, nome: string): Promise<void> {
    await db.student.create({
      data: {
        tenantId: tenant.tenantId,
        gymUnitId: tenant.unidadeId,
        membershipNumber: `F90H-${randomUUID().slice(0, 8)}`,
        fullName: nome,
        birthDate: new Date('1990-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    c = await criarCenarioDeDiaria(db, app.get(PasswordService));
    outro = await criarCenarioDeDiaria(db, app.get(PasswordService));
    await db.tenant.update({ where: { id: c.tenantId }, data: { cnpj: '12345678000195' } });

    await aluno(c, 'Ana do Tenant');
    await aluno(c, '=HYPERLINK("http://x")');
    await aluno(outro, 'Eva de Outro Tenant');

    cookies.leitor = await usuarioCom('leitor', c, ['student.read']);
    cookies.semPermissao = await usuarioCom('sem', c, ['plan.read']);
  });

  afterAll(async () => {
    await apagarCenario(db, c);
    await apagarCenario(db, outro);
    await db.user.deleteMany({ where: { email: { contains: 'relatorio-http-' } } });
    await app.close();
  });

  it('sem student.read: 403 nas duas rotas', async () => {
    for (const rota of ['/api/v1/reports/students', '/api/v1/reports/students/export?format=csv']) {
      const resposta = await request(servidor()).get(rota).set('Cookie', cookies.semPermissao);

      expect(resposta.status).toBe(403);
    }
  });

  it('sem sessão: 401', async () => {
    expect((await request(servidor()).get('/api/v1/reports/students')).status).toBe(401);
  });

  it('lista só o tenant da sessão e devolve o envelope', async () => {
    const resposta = await request(servidor()).get('/api/v1/reports/students').set('Cookie', cookies.leitor);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ total: 2, proximoCursor: null });
    expect((resposta.body as { linhas: { fullName: string }[] }).linhas.map((l) => l.fullName)).toEqual([
      '=HYPERLINK("http://x")',
      'Ana do Tenant',
    ]);
  });

  it('paginação por cursor: limit=1 devolve um e aponta o próximo', async () => {
    const primeira = await request(servidor())
      .get('/api/v1/reports/students?limit=1')
      .set('Cookie', cookies.leitor);
    const corpo = primeira.body as { linhas: { studentId: string }[]; proximoCursor: string | null };

    expect(corpo.linhas).toHaveLength(1);
    expect(corpo.proximoCursor).toBe(corpo.linhas[0]?.studentId);

    const segunda = await request(servidor())
      .get(`/api/v1/reports/students?limit=1&cursor=${corpo.proximoCursor}`)
      .set('Cookie', cookies.leitor);

    expect((segunda.body as { linhas: unknown[] }).linhas).toHaveLength(1);
    expect((segunda.body as { proximoCursor: string | null }).proximoCursor).toBeNull();
  });

  it('filtro e cursor lixo não viram 400: ignorados, e `tenantId` de parâmetro é ignorado', async () => {
    const resposta = await request(servidor())
      .get(
        `/api/v1/reports/students?status=XYZ&gymUnitId=abc&cursor=lixo&limit=banana&tenantId=${outro.tenantId}`,
      )
      .set('Cookie', cookies.leitor);

    expect(resposta.status).toBe(200);
    expect((resposta.body as { total: number }).total).toBe(2);
  });

  it('CSV: tipo, nome do arquivo, BOM, dados da academia, aluno e fórmula neutralizada', async () => {
    const resposta = await baixar('/api/v1/reports/students/export?format=csv');
    const bytes = resposta.body as Buffer;
    const texto = bytes.toString('utf8');

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toContain('text/csv');
    expect(resposta.headers['content-disposition']).toMatch(
      /attachment; filename="relatorio-alunos-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(texto).toContain('CNPJ;12.345.678/0001-95');
    expect(texto).toContain('Total de alunos;2');
    expect(texto).toContain('Ana do Tenant');
    expect(texto).toContain(`'=HYPERLINK(`);
    expect(texto).not.toContain('Eva de Outro Tenant');
  });

  it('PDF: tipo, nome do arquivo e assinatura %PDF', async () => {
    const resposta = await baixar('/api/v1/reports/students/export?format=pdf');

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toContain('application/pdf');
    expect(resposta.headers['content-disposition']).toMatch(
      /filename="relatorio-alunos-\d{4}-\d{2}-\d{2}\.pdf"/,
    );
    expect((resposta.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('format ausente ou inválido: 400 com código estável', async () => {
    for (const rota of [
      '/api/v1/reports/students/export',
      '/api/v1/reports/students/export?format=xlsx',
    ]) {
      const resposta = await request(servidor()).get(rota).set('Cookie', cookies.leitor);

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('REPORT_FORMAT_INVALID');
    }
  });

  it('a exportação respeita o filtro (arquivo = tela)', async () => {
    const resposta = await request(servidor())
      .get('/api/v1/reports/students/export?format=csv&status=BLOCKED')
      .set('Cookie', cookies.leitor);

    expect(resposta.status).toBe(200);
    expect(resposta.text).toContain('Total de alunos;0');
    expect(resposta.text).toContain('Situação: Bloqueado');
  });
});
