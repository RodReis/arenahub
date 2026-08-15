import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Varredura de vazamento -- Step 2 da Task 7 do plano de apoio.
 *
 * Os testes anteriores provam que cada rota faz a coisa certa. Este prova o
 * que NENHUMA rota pode fazer: deixar credencial escapar por resposta ou
 * log. E o tipo de falha que nao quebra nada e so aparece quando alguem le
 * o log errado -- ou o le de proposito.
 */
describe('nada sensivel vaza', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const EMAIL = `vazamento-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-correta';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /** Tudo que a aplicacao escreveu em stdout/stderr durante o teste. */
  let escrito: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: `vaz-${sufixo}`, legalName: 'Vaz LTDA', displayName: 'Vaz' },
    });
    const user = await db.user.create({
      data: { email: EMAIL, passwordHash: await senhas.gerarHash(SENHA) },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id } });
  });

  afterAll(async () => {
    await app?.close();
  });

  const capturarSaida = async (acao: () => Promise<unknown>): Promise<string> => {
    escrito = [];

    const espioes = (['log', 'error', 'warn', 'info', 'debug'] as const).map((nivel) =>
      jest.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
        escrito.push(args.map((a) => String(a)).join(' '));
      }),
    );

    try {
      await acao();
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }

    return escrito.join('\n');
  };

  it('login bem-sucedido nao escreve a senha em log nenhum', async () => {
    const saida = await capturarSaida(() =>
      request(servidor()).post('/api/v1/auth/login').send({ email: EMAIL, password: SENHA }),
    );

    expect(saida).not.toContain(SENHA);
  });

  it('login com falha nao escreve a senha tentada', async () => {
    const senhaTentada = 'senha-secreta-que-nao-pode-vazar';

    const saida = await capturarSaida(() =>
      request(servidor())
        .post('/api/v1/auth/login')
        .send({ email: EMAIL, password: senhaTentada }),
    );

    // Senha errada em log e pior que senha certa: quase sempre e a senha
    // CERTA de outro sistema, digitada por engano.
    expect(saida).not.toContain(senhaTentada);
  });

  it('nenhuma resposta de erro carrega hash, token ou string de conexao', async () => {
    const chamadas = [
      await request(servidor()).post('/api/v1/auth/login').send({ email: EMAIL, password: 'x' }),
      await request(servidor()).get('/api/v1/units'),
      await request(servidor()).get('/api/v1/auth/me'),
      await request(servidor()).post('/api/v1/auth/refresh'),
      await request(servidor()).get('/rota-que-nao-existe'),
    ];

    for (const resposta of chamadas) {
      const corpo = JSON.stringify(resposta.body);

      expect(corpo).not.toMatch(/scrypt\$/);
      expect(corpo).not.toMatch(/postgres(ql)?:\/\//i);
      expect(corpo).not.toMatch(/BEGIN (RSA )?PRIVATE KEY/);
      // Stack trace entrega estrutura de diretorio e versao de biblioteca.
      expect(corpo).not.toMatch(/node_modules/);
      expect(corpo).not.toMatch(/\bat [A-Za-z].*\(.*:\d+:\d+\)/);
    }
  });

  it('erro interno nao vaza detalhe para a resposta', async () => {
    // Rota inexistente exercita o caminho do filtro sem precisar quebrar
    // nada de proposito.
    const resposta = await request(servidor()).get('/api/v1/rota-inexistente');

    expect(resposta.body).toMatchObject({
      type: expect.any(String),
      title: expect.any(String),
      status: expect.any(Number),
      code: expect.any(String),
      correlationId: expect.any(String),
    });

    // O corpo tem EXATAMENTE os cinco campos do problem+json. Campo extra e
    // informacao que ninguem decidiu publicar.
    expect(Object.keys(resposta.body as object).sort()).toEqual([
      'code',
      'correlationId',
      'status',
      'title',
      'type',
    ]);
  });

  it('a trilha de auditoria nao guarda PII em metadados', async () => {
    const registros = await db.auditLog.findMany({ take: 200 });

    for (const registro of registros) {
      const metadados = JSON.stringify(registro.metadata ?? {});

      // E-mail e CPF em log sao proibidos (`CLAUDE.md`, Convencoes). O
      // vinculo com a pessoa vive em `actorId`/`targetId`, que sao
      // identificadores opacos.
      expect(metadados).not.toMatch(/@[\w.-]+\.\w+/);
      expect(metadados).not.toMatch(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
    }
  });

  it('nenhuma sessao guarda o refresh token em claro', async () => {
    // So as sessoes que ESTA suite criou. O banco e compartilhado entre
    // suites, e o teste de constraint do `packages/database` grava
    // `tokenHash` sintetico de proposito -- varrer a tabela inteira faria
    // esta verificacao falhar por fixture alheia, nao por vazamento.
    const usuario = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const sessoes = await db.session.findMany({ where: { userId: usuario.id } });

    expect(sessoes.length).toBeGreaterThan(0);

    for (const sessao of sessoes) {
      // O campo e hash hexadecimal de 64 caracteres. Qualquer outra coisa
      // significa que alguem gravou o token.
      expect(sessao.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('nenhum convite guarda o token em claro', async () => {
    // So os convites emitidos pela aplicacao: o `.test` do dominio marca
    // o que este conjunto de suites criou.
    const convites = await db.invitation.findMany({
      where: { email: { endsWith: '@exemplo.test' } },
      take: 200,
    });

    for (const convite of convites) {
      expect(convite.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('nenhum usuario guarda senha ou segredo de MFA em claro', async () => {
    // Idem: `packages/database` grava `passwordHash` sintetico nos testes
    // de constraint, e varrer a tabela inteira acusaria fixture alheia.
    const usuarios = await db.user.findMany({
      where: { email: { endsWith: '@exemplo.test' } },
      take: 200,
    });

    expect(usuarios.length).toBeGreaterThan(0);

    for (const usuario of usuarios) {
      expect(usuario.passwordHash).toMatch(/^scrypt\$v=1\$/);

      if (usuario.mfaSecretCiphertext) {
        // Segredo TOTP e base32 legivel; se o ciphertext contiver so
        // caracteres do alfabeto base32, nao foi cifrado.
        const texto = Buffer.from(usuario.mfaSecretCiphertext).toString('utf8');

        expect(/^[A-Z2-7]+$/.test(texto)).toBe(false);
        expect(usuario.mfaSecretIv).toBeTruthy();
        expect(usuario.mfaSecretTag).toBeTruthy();
      }
    }
  });
});
