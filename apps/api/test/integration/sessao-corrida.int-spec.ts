import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { NaoAutenticadoError } from '../../src/common/http/erro-de-dominio.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Refresh em voo x revogacao de sessao -- issue #558.
 *
 * `refresh()` le a sessao e so DEPOIS rotaciona, sem lock. Se a revogacao
 * (troca de senha, logout) cai entre as duas coisas, o refresh em voo precisa
 * perder -- senao a sessao que devia cair sobrevive com refresh valido.
 *
 * Os testes montam o intercalamento a mao, segurando uma transacao aberta, em
 * vez de disparar requisicoes em paralelo e torcer: corrida de milissegundos
 * nao e reproduzivel, e o que se afirma aqui e o INVARIANTE (nenhum elo
 * ACTIVE na familia revogada), nao a ordem.
 */
describe('refresh em voo x revogacao', () => {
  let app: INestApplication;
  let db: PrismaService;
  let sessoes: SessionRepository;
  let senhas: PasswordService;
  const tenants: string[] = [];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDe = (resposta: request.Response, nome: string): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return (lista.find((c) => c.startsWith(`${nome}=`)) ?? '').split(';')[0] ?? '';
  };

  const criarUsuario = async (): Promise<{ userId: string; tenantId: string; email: string }> => {
    const sufixo = randomUUID().slice(0, 8);
    const tenant = await db.tenant.create({
      data: { slug: `corrida-${sufixo}`, legalName: 'Corrida LTDA', displayName: 'Corrida' },
    });
    tenants.push(tenant.id);
    const email = `corrida-${sufixo}@exemplo.test`;
    const usuario = await db.user.create({
      data: { email, passwordHash: await senhas.gerarHash('senha-de-teste-correta') },
    });
    await db.tenantMembership.create({ data: { tenantId: tenant.id, userId: usuario.id } });

    return { userId: usuario.id, tenantId: tenant.id, email };
  };

  const abrirSessao = (
    dados: { userId: string; tenantId: string },
    familyId = randomUUID(),
    status: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
  ) =>
    db.session.create({
      data: {
        userId: dados.userId,
        tenantId: dados.tenantId,
        tokenHash: randomUUID(),
        familyId,
        status,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

  /**
   * Um refresh em voo: rotaciona o elo e insere o novo, e SEGURA a transacao
   * aberta ate `soltar()`. Enquanto isso, `acao()` roda e fica bloqueada no
   * lock da linha do elo antigo -- que e exatamente o intercalamento que
   * perde o elo novo no snapshot da revogacao.
   */
  const comRefreshEmVoo = async (
    dados: { userId: string; tenantId: string; familyId: string; eloAntigoId: string },
    acao: () => Promise<void>,
  ): Promise<void> => {
    let soltar: () => void = () => undefined;
    let travou: () => void = () => undefined;
    const portao = new Promise<void>((resolve) => (soltar = resolve));
    const aviso = new Promise<void>((resolve) => (travou = resolve));

    const refresh = db.$transaction(
      async (tx) => {
        await tx.session.updateMany({
          where: { id: dados.eloAntigoId },
          data: { status: 'ROTATED', rotatedAt: new Date() },
        });
        await tx.session.create({
          data: {
            userId: dados.userId,
            tenantId: dados.tenantId,
            tokenHash: randomUUID(),
            familyId: dados.familyId,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });
        travou();
        await portao;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );

    await aviso;
    const revogacao = acao();
    // Deixa a revogacao chegar ao lock. Se ela ainda nao chegou quando o
    // refresh comitar, o resultado e o mesmo e o teste passa -- o invariante
    // nao depende da ordem, so o poder de FALHAR depende desta pausa.
    await new Promise((resolve) => setTimeout(resolve, 400));
    soltar();
    await refresh;
    await revogacao;
  };

  const ativosNa = (familyId: string): Promise<number> =>
    db.session.count({ where: { familyId, status: 'ACTIVE' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    sessoes = app.get(SessionRepository);
    senhas = app.get(PasswordService);
  });

  afterAll(async () => {
    if (db) {
      await db.session.deleteMany({ where: { tenantId: { in: tenants } } });
      await db.tenant.deleteMany({ where: { id: { in: tenants } } });
    }
    await app?.close();
  });

  it('a rotacao nao ressuscita um elo ja revogado', async () => {
    const usuario = await criarUsuario();
    const revogado = await abrirSessao(usuario, undefined, 'REVOKED');

    await expect(
      sessoes.rotacionar({
        sessaoAtualId: revogado.id,
        familyId: revogado.familyId,
        userId: usuario.userId,
        tenantId: usuario.tenantId,
        novoTokenHash: randomUUID(),
        validoAte: new Date(Date.now() + 60 * 60 * 1000),
      }),
    ).rejects.toBeInstanceOf(NaoAutenticadoError);

    // O elo continua revogado e nenhum elo novo nasceu na familia.
    expect((await db.session.findUniqueOrThrow({ where: { id: revogado.id } })).status).toBe(
      'REVOKED',
    );
    expect(await ativosNa(revogado.familyId)).toBe(0);
  });

  it('revogar a familia pega o elo inserido por um refresh em voo', async () => {
    const usuario = await criarUsuario();
    const antigo = await abrirSessao(usuario);

    await comRefreshEmVoo(
      { ...usuario, familyId: antigo.familyId, eloAntigoId: antigo.id },
      () => sessoes.revogarFamilia(antigo.familyId, 'logout'),
    );

    expect(await ativosNa(antigo.familyId)).toBe(0);
  });

  it('revogar as outras familias pega o elo inserido por um refresh em voo', async () => {
    const usuario = await criarUsuario();
    const mantida = await abrirSessao(usuario);
    const outra = await abrirSessao(usuario);

    await comRefreshEmVoo(
      { ...usuario, familyId: outra.familyId, eloAntigoId: outra.id },
      () =>
        db.$transaction(async (tx) => {
          await sessoes.revogarOutrasFamilias(tx, usuario.userId, mantida.familyId, 'password_changed');
        }),
    );

    expect(await ativosNa(outra.familyId)).toBe(0);
    // A mantida segue de pe.
    expect(await ativosNa(mantida.familyId)).toBe(1);
  });

  it('dois refresh simultaneos do MESMO token continuam respondendo 200', async () => {
    // O `proxy.ts` do painel APAGA os dois cookies quando o refresh e
    // recusado: rejeitar a rotacao concorrente de um token legitimo viraria
    // loteria de logout entre duas navegacoes simultaneas. So o elo REVOGADO
    // pode ser recusado.
    const { email } = await criarUsuario();
    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: 'senha-de-teste-correta' });
    const refresh = cookieDe(login, 'arenahub_refresh');

    const [a, b] = await Promise.all([
      request(servidor()).post('/api/v1/auth/refresh').set('Cookie', refresh),
      request(servidor()).post('/api/v1/auth/refresh').set('Cookie', refresh),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
  });
});
