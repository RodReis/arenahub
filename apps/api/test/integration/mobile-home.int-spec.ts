import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';

/**
 * A Home pela porta HTTP.
 *
 * ESTA SUITE EXISTE POR CAUSA DE UM DEFEITO QUE SO A TELA REVELOU: a Home
 * respondia `UNAVAILABLE` com sessao perfeitamente valida, porque `students`
 * tem RLS com FORCE e a consulta rodava fora de transacao com contexto -- o
 * Postgres devolve ZERO LINHAS sob o role restrito, sem erro e sem log.
 *
 * Os 41 testes de integracao que ja existiam passavam: eles criam o aluno na
 * propria suite, com o contexto ja aberto. O que faltava era exercitar o
 * caminho HTTP inteiro, do guard ao banco -- que e o que esta aqui.
 */
describe('F23 -- Home do app', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const SLUG = `f23home-${sufixo}`;
  const EMAIL = `aluno-home-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-longa';
  const NOME_COMPLETO = 'Mariana Alves Pereira';

  let tenantId: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  interface CorpoDaHome {
    asOf: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
    saudacao: string;
    versionPolicy: { state: string; updateUrl: string | null };
  }

  const entrar = async (): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/mobile/auth/login')
      .send({ tenantSlug: SLUG, identificador: EMAIL, senha: SENHA });

    return (resposta.body as { accessToken: string }).accessToken;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: SLUG, legalName: 'Academia Home LTDA', displayName: 'Academia Home' },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `HOME-${sufixo}`,
        name: 'Unidade Home',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidade.id,
        membershipNumber: `HOME-${sufixo}`,
        fullName: NOME_COMPLETO,
        birthDate: new Date('1990-01-01'),
      },
    });

    await db.studentAccount.create({
      data: {
        tenantId,
        studentId: aluno.id,
        identifier: EMAIL,
        passwordHash: await senhas.gerarHash(SENHA),
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await app?.close();
  });

  it('responde AVAILABLE para sessao valida -- e nao UNAVAILABLE por RLS', async () => {
    /*
     * O teste que o defeito produziu. `UNAVAILABLE` aqui significa que a
     * consulta voltou vazia -- e sob RLS ela volta vazia SEM ERRO, entao
     * nada mais no sistema acusaria.
     */
    const acesso = await entrar();

    const resposta = await request(servidor())
      .get('/api/v1/mobile/home')
      .set('Authorization', `Bearer ${acesso}`);

    expect(resposta.status).toBe(200);
    expect((resposta.body as CorpoDaHome).status).toBe('AVAILABLE');
  });

  it('saúda com o PRIMEIRO nome, nunca o completo', async () => {
    // A Home fica aberta na mao do aluno dentro da academia, a vista de quem
    // estiver ao lado. Nome completo ali e PII exposta sem necessidade.
    const acesso = await entrar();

    const resposta = await request(servidor())
      .get('/api/v1/mobile/home')
      .set('Authorization', `Bearer ${acesso}`);

    const corpo = resposta.body as CorpoDaHome;
    expect(corpo.saudacao).toMatch(/Mariana/);
    expect(corpo.saudacao).not.toContain('Alves');
    expect(corpo.saudacao).not.toContain('Pereira');
  });

  it('sem token responde 401', async () => {
    await request(servidor()).get('/api/v1/mobile/home').expect(401);
  });

  it('a resposta nao carrega dado de negocio -- Slices 4.2 e 4.3', async () => {
    // Antecipar plano, fatura ou frequencia aqui criaria um contrato que
    // aquelas fatias teriam de honrar ou quebrar.
    const acesso = await entrar();

    const resposta = await request(servidor())
      .get('/api/v1/mobile/home')
      .set('Authorization', `Bearer ${acesso}`);

    const texto = JSON.stringify(resposta.body);
    for (const proibido of ['plano', 'fatura', 'invoice', 'frequencia', 'entitlement']) {
      expect(texto.toLowerCase()).not.toContain(proibido);
    }
  });
});
