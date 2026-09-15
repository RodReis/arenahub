import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F29 -- caixa de avisos e telemetria, pela porta HTTP.
 *
 * DOIS ALUNOS, e a razao e o teste central: o aviso do aluno A nao pode
 * aparecer nem ser marcado como lido pelo aluno B. Com um aluno so, o filtro
 * por `studentId` poderia sumir do `where` e tudo continuaria verde -- que e
 * exatamente o defeito que a suite existe para pegar.
 */
describe('F29 -- avisos e telemetria', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const SLUG = `f29-${sufixo}`;
  const SENHA = 'senha-de-teste-longa';
  const CPF_A = '11144477735';
  const CPF_B = '52998224725';

  let tenantId: string;
  let alunoA: string;
  let avisoDeA: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  interface Aviso {
    id: string;
    tipo: string;
    titulo: string;
    corpo: string;
    rota: string | null;
    lido: boolean;
    criadoEm: string;
  }

  interface CorpoDaCaixa {
    asOf: string;
    avisos: Aviso[];
    naoLidos: number;
  }

  const entrar = async (cpf: string): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/mobile/auth/login')
      .send({ tenantSlug: SLUG, cpf, senha: SENHA });

    return (resposta.body as { accessToken: string }).accessToken;
  };

  const criarAluno = async (
    identifier: string,
    nome: string,
    matricula: string,
    gymUnitId: string,
  ): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `${matricula}-${sufixo}`,
        fullName: nome,
        birthDate: new Date('1990-01-01'),
      },
    });

    await db.studentAccount.create({
      data: {
        tenantId,
        studentId: aluno.id,
        identifier,
        passwordHash: await senhas.gerarHash(SENHA),
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });

    return aluno.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: SLUG, legalName: 'Academia F29 LTDA', displayName: 'Academia F29' },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `F29-${sufixo}`,
        name: 'Unidade F29',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    alunoA = await criarAluno(CPF_A, 'Ana Silva', 'F29A', unidade.id);
    // O id do B nao e usado: o teste entra como ele pelo CPF. O aluno
    // precisa EXISTIR para a sessao dele ser valida -- e e com sessao valida
    // que ele nao pode ver a caixa do A.
    await criarAluno(CPF_B, 'Bruno Costa', 'F29B', unidade.id);

    const aviso = await db.studentNotification.create({
      data: {
        tenantId,
        studentId: alunoA,
        kind: 'BILLING',
        title: 'Fatura em aberto',
        body: 'Voce tem uma fatura aguardando pagamento.',
        action: 'OPEN_INVOICE',
        actionTargetId: randomUUID(),
      },
    });
    avisoDeA = aviso.id;

    // Expirado: existe no banco, nao aparece na tela.
    await db.studentNotification.create({
      data: {
        tenantId,
        studentId: alunoA,
        kind: 'GENERAL',
        title: 'Aviso vencido',
        body: 'Isto ja passou.',
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });
  });

  afterAll(async () => {
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await app?.close();
  });

  describe('caixa de avisos', () => {
    it('devolve o aviso do proprio aluno com a rota resolvida', async () => {
      const acesso = await entrar(CPF_A);

      const resposta = await request(servidor())
        .get('/api/v1/mobile/avisos')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDaCaixa;
      const aviso = corpo.avisos.find((a) => a.id === avisoDeA);

      expect(aviso).toBeDefined();
      // A rota vem PRONTA do servidor, como caminho local -- nunca URL.
      expect(aviso?.rota).toMatch(/^\/financeiro\?invoice=/);
    });

    it('esconde o aviso expirado, sem apaga-lo do banco', async () => {
      const acesso = await entrar(CPF_A);

      const resposta = await request(servidor())
        .get('/api/v1/mobile/avisos')
        .set('Authorization', `Bearer ${acesso}`);

      expect((resposta.body as CorpoDaCaixa).avisos.map((a) => a.titulo)).not.toContain(
        'Aviso vencido',
      );

      // A linha continua la: "o aluno foi avisado?" e a primeira pergunta
      // quando ele contesta uma cobranca.
      const noBanco = await db.studentNotification.count({
        where: { studentId: alunoA, title: 'Aviso vencido' },
      });
      expect(noBanco).toBe(1);
    });

    /**
     * O TESTE CENTRAL DA SUITE.
     *
     * O aluno B tem sessao perfeitamente valida. Sem o `studentId` no `where`,
     * ele leria a caixa do aluno A -- e nada no sistema acusaria.
     */
    it('o aluno B nao ve o aviso do aluno A', async () => {
      const acesso = await entrar(CPF_B);

      const resposta = await request(servidor())
        .get('/api/v1/mobile/avisos')
        .set('Authorization', `Bearer ${acesso}`);

      const corpo = resposta.body as CorpoDaCaixa;
      expect(corpo.avisos).toHaveLength(0);
      expect(JSON.stringify(corpo)).not.toContain('Fatura em aberto');
    });

    it('o aluno B nao marca como lido o aviso do aluno A', async () => {
      const acesso = await entrar(CPF_B);

      const resposta = await request(servidor())
        .post(`/api/v1/mobile/avisos/${avisoDeA}/lido`)
        .set('Authorization', `Bearer ${acesso}`)
        .send({});

      // 404, nunca 403: "existe, mas nao e seu" confirmaria a existencia do
      // recurso para quem sonda ids.
      expect(resposta.status).toBe(404);

      const aviso = await db.studentNotification.findUnique({ where: { id: avisoDeA } });
      expect(aviso?.readAt).toBeNull();
    });

    it('marca como lido e a contagem cai', async () => {
      const acesso = await entrar(CPF_A);

      const antes = await request(servidor())
        .get('/api/v1/mobile/avisos')
        .set('Authorization', `Bearer ${acesso}`);

      await request(servidor())
        .post(`/api/v1/mobile/avisos/${avisoDeA}/lido`)
        .set('Authorization', `Bearer ${acesso}`)
        .send({})
        .expect(201);

      const depois = await request(servidor())
        .get('/api/v1/mobile/avisos')
        .set('Authorization', `Bearer ${acesso}`);

      expect((depois.body as CorpoDaCaixa).naoLidos).toBe(
        (antes.body as CorpoDaCaixa).naoLidos - 1,
      );
    });

    // Idempotente: a segunda marcacao nao move o instante, senao apagaria
    // quando o aviso foi visto de fato.
    it('marcar duas vezes nao move o instante de leitura', async () => {
      const acesso = await entrar(CPF_A);

      await request(servidor())
        .post(`/api/v1/mobile/avisos/${avisoDeA}/lido`)
        .set('Authorization', `Bearer ${acesso}`)
        .send({});

      const primeiro = await db.studentNotification.findUnique({ where: { id: avisoDeA } });

      await request(servidor())
        .post(`/api/v1/mobile/avisos/${avisoDeA}/lido`)
        .set('Authorization', `Bearer ${acesso}`)
        .send({});

      const segundo = await db.studentNotification.findUnique({ where: { id: avisoDeA } });

      expect(segundo?.readAt?.toISOString()).toBe(primeiro?.readAt?.toISOString());
    });

    it('sem token responde 401', async () => {
      await request(servidor()).get('/api/v1/mobile/avisos').expect(401);
    });
  });

  describe('telemetria', () => {
    const evento = {
      event: 'LOGIN_FAILED',
      appVersion: '1.4.0',
      platform: 'IOS',
      traceId: randomUUID(),
    };

    it('aceita o evento declarado', async () => {
      const acesso = await entrar(CPF_A);

      await request(servidor())
        .post('/api/v1/mobile/telemetria')
        .set('Authorization', `Bearer ${acesso}`)
        .send(evento)
        .expect(204);
    });

    it('recusa evento fora da lista', async () => {
      const acesso = await entrar(CPF_A);

      await request(servidor())
        .post('/api/v1/mobile/telemetria')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ ...evento, event: 'EVENTO_INVENTADO' })
        .expect(400);
    });

    /**
     * O campo a mais e DESCARTADO, nao recusado -- e o evento segue valido.
     *
     * A distincao importa: recusar por campo extra faria uma versao nova do
     * app perder toda a telemetria contra um servidor antigo; descartar
     * mantem a metrica e nao deixa o dado vazar.
     */
    it('descarta PII e aceita o evento mesmo assim', async () => {
      const acesso = await entrar(CPF_A);

      await request(servidor())
        .post('/api/v1/mobile/telemetria')
        .set('Authorization', `Bearer ${acesso}`)
        .send({
          ...evento,
          email: 'aluno@exemplo.test',
          cpf: '39053344705',
          studentId: alunoA,
          stack: 'at Object.<anonymous> (/app/src/secreto.ts:42)',
        })
        .expect(204);
    });

    it('recusa versao malformada', async () => {
      const acesso = await entrar(CPF_A);

      await request(servidor())
        .post('/api/v1/mobile/telemetria')
        .set('Authorization', `Bearer ${acesso}`)
        .send({ ...evento, appVersion: 'aluno@exemplo.test' })
        .expect(400);
    });

    it('sem token responde 401', async () => {
      await request(servidor())
        .post('/api/v1/mobile/telemetria')
        .send(evento)
        .expect(401);
    });
  });
});
