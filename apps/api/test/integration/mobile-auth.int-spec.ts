import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';

/**
 * As rotas do canal mobile pela porta HTTP.
 *
 * O que esta suite existe para pegar, e a de servico nao pega: token do
 * ALUNO abrindo rota do PAINEL (e vice-versa). Os dois sao assinados pela
 * MESMA chave, entao a verificacao de assinatura aprova ambos -- o que separa
 * os sujeitos e o claim `canal`, e claim so se testa atravessando o guard.
 */
describe('F23 -- rotas do canal mobile', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;
  let tokens: TokenService;

  const sufixo = randomUUID().slice(0, 8);
  const SLUG = `f23http-${sufixo}`;
  const EMAIL = `aluno-http-${sufixo}@exemplo.test`;
  const EMAIL_DO_PAINEL = `dono-http-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-longa';

  const NOME_DO_ALUNO = 'Ana Souza Http';
  const CPF_DO_ALUNO = '52998224725';

  let tenantId: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /** O corpo que o login devolve. `supertest` tipa `body` como `any`. */
  interface CorpoDaSessao {
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    expiraEm: number;
  }

  const logar = async () =>
    request(servidor())
      .post('/api/v1/mobile/auth/login')
      .send({ tenantSlug: SLUG, identificador: EMAIL, senha: SENHA });

  /** Loga e devolve o corpo ja estreitado, para nao espalhar `any` nos testes. */
  const logarComCorpo = async (): Promise<CorpoDaSessao> => {
    const resposta = await logar();
    return resposta.body as CorpoDaSessao;
  };

  /** O `problem+json` do filtro de erro. */
  const problema = (resposta: request.Response): { code?: string } =>
    resposta.body as { code?: string };

  const sessaoDe = (resposta: request.Response): CorpoDaSessao =>
    resposta.body as CorpoDaSessao;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);
    tokens = app.get(TokenService);

    const tenant = await db.tenant.create({
      data: { slug: SLUG, legalName: 'Academia HTTP LTDA', displayName: 'Academia HTTP' },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `HTTP-${sufixo}`,
        name: 'Unidade HTTP',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidade.id,
        membershipNumber: `HTTP-${sufixo}`,
        fullName: NOME_DO_ALUNO,
        cpf: CPF_DO_ALUNO,
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

    // Usuario do PAINEL, para o teste de canal cruzado.
    const usuario = await db.user.create({
      data: { email: EMAIL_DO_PAINEL, passwordHash: await senhas.gerarHash(SENHA) },
    });
    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });
  });

  afterAll(async () => {
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await db.user.deleteMany({ where: { email: EMAIL_DO_PAINEL } }).catch(() => undefined);
    await app?.close();
  });

  describe('login', () => {
    it('abre sessao e devolve o par de tokens NO CORPO', async () => {
      const resposta = await logar();

      expect(resposta.status).toBe(200);
      expect(sessaoDe(resposta).accessToken).toBeTruthy();
      expect(sessaoDe(resposta).refreshToken).toBeTruthy();

      // O app nao tem cookie jar: devolver cookie seria dar uma credencial
      // que ele nao sabe guardar. Aqui, ao contrario do painel, corpo e o
      // lugar certo -- e o `set-cookie` tem de estar AUSENTE.
      expect(resposta.headers['set-cookie']).toBeUndefined();
    });

    it('senha errada responde problem+json sem revelar existencia', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/mobile/auth/login')
        .send({ tenantSlug: SLUG, identificador: EMAIL, senha: 'senha-errada-longa' });

      expect(resposta.status).toBe(401);
      expect(resposta.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(JSON.stringify(resposta.body)).not.toMatch(/existe|cadastrad|encontrad/i);
    });

    it('identificador inexistente responde IGUAL a senha errada', async () => {
      const senhaErrada = await request(servidor())
        .post('/api/v1/mobile/auth/login')
        .send({ tenantSlug: SLUG, identificador: EMAIL, senha: 'senha-errada-longa' });

      const inexistente = await request(servidor())
        .post('/api/v1/mobile/auth/login')
        .send({
          tenantSlug: SLUG,
          identificador: `fantasma-${sufixo}@exemplo.test`,
          senha: SENHA,
        });

      expect(inexistente.status).toBe(senhaErrada.status);
      expect(problema(inexistente).code).toBe(problema(senhaErrada).code);
    });

    it('academia inexistente responde IGUAL -- nao enumera tenant', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/mobile/auth/login')
        .send({ tenantSlug: `nao-existe-${sufixo}`, identificador: EMAIL, senha: SENHA });

      expect(resposta.status).toBe(401);
      expect(problema(resposta).code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('recusa campo desconhecido no corpo', async () => {
      // `.strict()` na pratica: aceitar extra abriria caminho para alguem, um
      // dia, ler o tenant do corpo -- o que a regra de arquitetura 2 proibe.
      const resposta = await request(servidor())
        .post('/api/v1/mobile/auth/login')
        .send({ tenantSlug: SLUG, identificador: EMAIL, senha: SENHA, tenantId: 'forjado' });

      expect(resposta.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('separacao de canais', () => {
    it('o access token do ALUNO nao carrega PII', async () => {
      const body = await logarComCorpo();
      const payload: unknown = JSON.parse(
        Buffer.from(body.accessToken.split('.')[1] ?? '', 'base64url').toString(),
      );
      const texto = JSON.stringify(payload);

      // Um JWT vai para o disco do aparelho e para todo log de proxy no
      // caminho. Nome e CPF nele nao voltam atras.
      for (const proibido of [NOME_DO_ALUNO, CPF_DO_ALUNO, EMAIL]) {
        expect(texto).not.toContain(proibido);
      }
    });

    it('o access token do aluno NAO abre rota do painel', async () => {
      const body = await logarComCorpo();

      const resposta = await request(servidor())
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${body.accessToken}`);

      expect(resposta.status).toBe(401);
    });

    it('o access token do aluno NAO abre rota do painel nem por COOKIE', async () => {
      // O guard do painel le cookie. Sem a checagem de `canal`, bastaria o
      // token viajar nesse transporte para atravessar -- e transporte e
      // acidente, nao garantia.
      const body = await logarComCorpo();

      const resposta = await request(servidor())
        .get('/api/v1/students')
        .set('Cookie', `arenahub_access=${body.accessToken}`);

      expect(resposta.status).toBe(401);
    });

    it('o token do PAINEL nao abre rota mobile', async () => {
      const doPainel = tokens.emitirAcesso({
        sub: randomUUID(),
        tenantId,
        sessionId: randomUUID(),
        permissions: ['students.read'],
        mfa: true,
      });

      const resposta = await request(servidor())
        .get('/api/v1/mobile/sessions')
        .set('Authorization', `Bearer ${doPainel}`);

      expect(resposta.status).toBe(401);
    });

    it('token de painel COM studentId ainda nao abre rota mobile', async () => {
      /*
       * O caso adversarial, e ele nasceu de um canario: removendo a checagem
       * de `canal` do guard mobile, o teste acima continuava VERDE. Ele
       * passava pelo motivo errado -- o token de painel era recusado por nao
       * ter `studentId`, nao por ser de outro canal.
       *
       * Aqui o token traz tudo o que o guard usa, e SO o `canal` o separa. Se
       * um dia alguem acrescentar `studentId` a um token de painel (para
       * "saber qual aluno o funcionario esta vendo", por exemplo), o teste
       * anterior passaria a aprovar o que deveria barrar. Este nao.
       */
      const sessaoReal = await logar();

      const forjado = tokens.emitirAcesso({
        sub: randomUUID(),
        tenantId,
        sessionId: (sessaoReal.body as CorpoDaSessao).sessionId,
        permissions: ['students.read'],
        mfa: true,
        studentId: randomUUID(),
        // `canal` AUSENTE = painel, por compatibilidade com token anterior a F23.
      });

      const resposta = await request(servidor())
        .get('/api/v1/mobile/sessions')
        .set('Authorization', `Bearer ${forjado}`);

      expect(resposta.status).toBe(401);
    });
  });

  describe('sessoes', () => {
    it('rota protegida sem token responde 401', async () => {
      const resposta = await request(servidor()).get('/api/v1/mobile/sessions');
      expect(resposta.status).toBe(401);
    });

    it('lista as sessoes do proprio aluno', async () => {
      const body = await logarComCorpo();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/sessions')
        .set('Authorization', `Bearer ${body.accessToken}`);

      expect(resposta.status).toBe(200);
      expect(Array.isArray(resposta.body)).toBe(true);
    });

    it('revogar a propria sessao faz o refresh parar de valer -- M4-AC-002', async () => {
      const body = await logarComCorpo();

      const revogacao = await request(servidor())
        .delete(`/api/v1/mobile/sessions/${body.sessionId}`)
        .set('Authorization', `Bearer ${body.accessToken}`);
      expect(revogacao.status).toBe(200);

      const renovacao = await request(servidor())
        .post('/api/v1/mobile/auth/refresh')
        .send({ refreshToken: body.refreshToken });

      expect(renovacao.status).toBe(401);
      expect(problema(renovacao).code).toBe('SESSAO_REVOGADA');
    });
  });

  describe('tenant do token x tenant da sessao', () => {
    it('token com tenant DIFERENTE do da sessao nao passa', async () => {
      /*
       * A sessao e a autoridade sobre a que tenant ela pertence -- nao o
       * claim. Este teste existe porque a guarda que ele protege NAO e
       * exploravel hoje: nenhuma rota do modulo le `ctx.tenantId`, todas
       * usam `accountId` vindo do banco.
       *
       * Sem o teste, a guarda parece codigo morto e o proximo a passar por
       * aqui a remove com razao aparente. Com ele, a remocao falha -- e o
       * dia em que alguma rota do aluno filtrar por `ctx.tenantId` (o padrao
       * do resto do repositorio), o tenant que ela usar sera o da sessao.
       */
      const body = await logarComCorpo();

      const deOutroTenant = tokens.emitirAcesso({
        sub: randomUUID(),
        tenantId: randomUUID(), // tenant que nao e o da sessao
        sessionId: body.sessionId,
        permissions: [],
        mfa: false,
        canal: 'MOBILE',
        studentId: randomUUID(),
      });

      const resposta = await request(servidor())
        .get('/api/v1/mobile/sessions')
        .set('Authorization', `Bearer ${deOutroTenant}`);

      expect(resposta.status).toBe(401);
    });
  });

  describe('step-up pelo HTTP -- M4-FR-005', () => {
    /**
     * O teste de revogacao acima NAO prova step-up, e um achado de revisao
     * mostrou por que: o login preenche `reauthenticatedAt` com o agora, e a
     * chamada seguinte sempre cai dentro da janela de 5 minutos. Removendo a
     * guarda inteira do servico, aquele teste continuaria verde.
     *
     * Aqui a autenticacao e ENVELHECIDA no banco antes da chamada, que e o
     * unico jeito de exercitar a guarda pela porta HTTP.
     */
    const envelhecerAutenticacao = async (sessionId: string): Promise<void> => {
      await db.studentSession.update({
        where: { id: sessionId },
        data: { reauthenticatedAt: new Date(Date.now() - 60 * 60_000) },
      });
    };

    it('recusa revogar quando a autenticacao ficou velha', async () => {
      const body = await logarComCorpo();
      await envelhecerAutenticacao(body.sessionId);

      const resposta = await request(servidor())
        .delete(`/api/v1/mobile/sessions/${body.sessionId}`)
        .set('Authorization', `Bearer ${body.accessToken}`);

      expect(resposta.status).toBe(403);
      expect(problema(resposta).code).toBe('REAUTENTICACAO_NECESSARIA');
    });

    it('confirmar a senha pelo HTTP libera a revogacao', async () => {
      const body = await logarComCorpo();
      await envelhecerAutenticacao(body.sessionId);

      const confirmacao = await request(servidor())
        .post('/api/v1/mobile/auth/reauthenticate')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ senha: SENHA });
      expect(confirmacao.status).toBe(200);

      const resposta = await request(servidor())
        .delete(`/api/v1/mobile/sessions/${body.sessionId}`)
        .set('Authorization', `Bearer ${body.accessToken}`);

      expect(resposta.status).toBe(200);
    });

    it('senha errada na reautenticacao nao libera nada', async () => {
      const body = await logarComCorpo();
      await envelhecerAutenticacao(body.sessionId);

      const confirmacao = await request(servidor())
        .post('/api/v1/mobile/auth/reauthenticate')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ senha: 'senha-errada-porem-longa' });
      expect(confirmacao.status).toBe(401);

      const resposta = await request(servidor())
        .delete(`/api/v1/mobile/sessions/${body.sessionId}`)
        .set('Authorization', `Bearer ${body.accessToken}`);

      expect(resposta.status).toBe(403);
    });
  });

  describe('jornada completa -- M4-AC-001', () => {
    it('o aluno volta ao app sem digitar senha enquanto a sessao vale', async () => {
      const body = await logarComCorpo();

      // Reabrir o app = trocar o refresh guardado por um par novo, sem senha.
      const volta = await request(servidor())
        .post('/api/v1/mobile/auth/refresh')
        .send({ refreshToken: body.refreshToken });

      expect(volta.status).toBe(200);
      expect(sessaoDe(volta).accessToken).toBeTruthy();
      expect(sessaoDe(volta).refreshToken).not.toBe(body.refreshToken);
    });
  });
});
