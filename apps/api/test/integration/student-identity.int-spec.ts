import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { StudentIdentityService } from '../../src/modules/student-identity/student-identity.service.js';
import type { StudentChannelContext } from '../../src/modules/student-identity/student-identity.service.js';
import { ErroDeDominio } from '../../src/common/http/erro-de-dominio.js';

/**
 * Cobre o que da para errar em silencio na identidade do ALUNO.
 *
 * Cada teste corresponde a uma forma conhecida de perder a conta de alguem:
 * token de convite que ativa duas vezes, resposta que revela quem tem
 * cadastro, refresh roubado que continua valendo, sessao revogada que renova,
 * e aluno que derruba a sessao de outro.
 */
describe('F23 -- identidade do aluno', () => {
  let app: INestApplication;
  let db: PrismaService;
  let servico: StudentIdentityService;
  let tokens: TokenService;

  const sufixo = randomUUID().slice(0, 8);
  const EMAIL = `aluno-${sufixo}@exemplo.test`;
  const EMAIL_DO_OUTRO = `outro-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-longa';
  const AGORA = () => new Date();

  let tenantId: string;
  let alunoId: string;
  let contaId: string;
  let outraContaId: string;

  /** O erro com o formato que o filtro de `problem+json` vai usar. */
  const capturar = async (acao: () => Promise<unknown>): Promise<ErroDeDominio> => {
    try {
      await acao();
      throw new Error('esperava falha, mas a acao passou');
    } catch (erro) {
      if (erro instanceof ErroDeDominio) return erro;
      throw erro;
    }
  };

  /**
   * Emite convite e devolve o token EM CLARO.
   *
   * O servico so devolve se o e-mail saiu; o token em claro nunca sai dele.
   * Aqui o teste precisa dele, entao gera o par do mesmo jeito que o servico
   * gera -- e grava o hash. Espelhar a geracao e o preco de nao expor o
   * token em claro na API so para facilitar teste.
   */
  const emitirToken = async (dados: {
    accountId: string;
    purpose: 'ACTIVATION' | 'PASSWORD_RESET';
    validoAte?: Date;
  }): Promise<string> => {
    const token = randomUUID() + randomUUID();
    await db.studentAccountToken.create({
      data: {
        tenantId,
        accountId: dados.accountId,
        purpose: dados.purpose,
        tokenHash: tokens.calcularHashDeRefresh(token),
        expiresAt: dados.validoAte ?? new Date(Date.now() + 3_600_000),
      },
    });

    return token;
  };

  const entrar = async (email = EMAIL) =>
    servico.entrar({
      tenantId,
      identificador: email,
      senha: SENHA,
      deviceLabel: 'Aparelho de teste',
      agora: AGORA(),
    });

  const contextoDe = async (sessaoId: string): Promise<StudentChannelContext> => {
    const sessao = await db.studentSession.findUniqueOrThrow({ where: { id: sessaoId } });
    return {
      tenantId: sessao.tenantId,
      studentId: alunoId,
      accountId: sessao.accountId,
      sessionId: sessao.id,
      reauthenticatedAt: sessao.reauthenticatedAt,
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    servico = app.get(StudentIdentityService);
    tokens = app.get(TokenService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f23-${sufixo}`,
        legalName: 'Academia F23 LTDA',
        displayName: 'Academia F23',
      },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `F23-${sufixo}`,
        name: 'Unidade F23',
        timezone: 'America/Sao_Paulo',
        // Vazio: esta suite nao testa janela de funcionamento, e a F23 nao a
        // consulta. O campo e obrigatorio no schema.
        openingHours: {},
      },
    });

    const criarAluno = async (nome: string, matricula: string) =>
      db.student.create({
        data: {
          tenantId,
          gymUnitId: unidade.id,
          membershipNumber: matricula,
          fullName: nome,
          birthDate: new Date('1990-01-01'),
        },
      });

    const aluno = await criarAluno('Aluno F23', `F23-${sufixo}-1`);
    alunoId = aluno.id;

    const outro = await criarAluno('Outro Aluno', `F23-${sufixo}-2`);

    const conta = await db.studentAccount.create({
      data: { tenantId, studentId: alunoId, identifier: EMAIL },
    });
    contaId = conta.id;

    const contaDoOutro = await db.studentAccount.create({
      data: { tenantId, studentId: outro.id, identifier: EMAIL_DO_OUTRO },
    });
    outraContaId = contaDoOutro.id;
  });

  afterAll(async () => {
    // APAGA o que a suite criou. Sem isto o tenant fica no banco e se soma
    // aos das execucoes anteriores -- ja virou timeout que parecia defeito
    // de codigo neste repositorio.
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await app?.close();
  });

  describe('ativacao', () => {
    it('ativa a conta com o token e permite entrar em seguida', async () => {
      const token = await emitirToken({ accountId: contaId, purpose: 'ACTIVATION' });

      await servico.ativar({ token, senha: SENHA, agora: AGORA() });

      const sessao = await entrar();
      expect(sessao.accessToken).toBeTruthy();
      expect(sessao.refreshToken).toBeTruthy();
    });

    it('recusa o MESMO token na segunda vez', async () => {
      const token = await emitirToken({ accountId: outraContaId, purpose: 'ACTIVATION' });
      await servico.ativar({ token, senha: SENHA, agora: AGORA() });

      const erro = await capturar(() =>
        servico.ativar({ token, senha: 'outra-senha-longa', agora: AGORA() }),
      );
      expect(erro.code).toBe('TOKEN_JA_USADO');
    });

    it('recusa token vencido', async () => {
      const token = await emitirToken({
        accountId: contaId,
        purpose: 'ACTIVATION',
        validoAte: new Date(Date.now() - 1_000),
      });

      const erro = await capturar(() =>
        servico.ativar({ token, senha: SENHA, agora: AGORA() }),
      );
      expect(erro.code).toBe('TOKEN_EXPIRADO');
    });

    it('recusa senha curta antes de consumir o token', async () => {
      const token = await emitirToken({ accountId: contaId, purpose: 'ACTIVATION' });

      const erro = await capturar(() =>
        servico.ativar({ token, senha: 'curta', agora: AGORA() }),
      );
      expect(erro.code).toBe('SENHA_FRACA');

      // O token tem de sobreviver: recusar a senha e gastar o convite deixaria
      // o aluno sem caminho nenhum, por um erro de digitacao.
      const registro = await db.studentAccountToken.findFirstOrThrow({
        where: { tokenHash: tokens.calcularHashDeRefresh(token) },
      });
      expect(registro.status).toBe('PENDING');
    });
  });

  describe('login', () => {
    it('responde IGUAL para identificador que existe e que nao existe', async () => {
      const conhecido = await capturar(() =>
        servico.entrar({
          tenantId,
          identificador: EMAIL,
          senha: 'senha-errada-porem-longa',
          deviceLabel: null,
          agora: AGORA(),
        }),
      );

      const desconhecido = await capturar(() =>
        servico.entrar({
          tenantId,
          identificador: `fantasma-${sufixo}@exemplo.test`,
          senha: 'senha-errada-porem-longa',
          deviceLabel: null,
          agora: AGORA(),
        }),
      );

      // A afirmacao e sobre INDISTINGUIBILIDADE: comparar os dois entre si
      // prova mais do que afirmar um valor fixo em cada um.
      expect(conhecido.code).toBe(desconhecido.code);
      expect(conhecido.status).toBe(desconhecido.status);
      expect(conhecido.title).toBe(desconhecido.title);
    });

    it('recusa conta que ainda nao foi ativada', async () => {
      const pendente = await db.studentAccount.create({
        data: {
          tenantId,
          studentId: (
            await db.student.create({
              data: {
                tenantId,
                gymUnitId: (await db.gymUnit.findFirstOrThrow({ where: { tenantId } })).id,
                membershipNumber: `F23-${sufixo}-3`,
                fullName: 'Nunca Ativou',
                birthDate: new Date('1990-01-01'),
              },
            })
          ).id,
          identifier: `pendente-${sufixo}@exemplo.test`,
        },
      });

      const erro = await capturar(() =>
        servico.entrar({
          tenantId,
          identificador: pendente.identifier,
          senha: SENHA,
          deviceLabel: null,
          agora: AGORA(),
        }),
      );
      expect(erro.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  describe('recuperacao', () => {
    it('aceita identificador inexistente sem revelar nada', async () => {
      await expect(
        servico.pedirRecuperacao({
          tenantId,
          identificador: `fantasma2-${sufixo}@exemplo.test`,
          agora: AGORA(),
        }),
      ).resolves.toEqual({ aceito: true });
    });

    it('trocar a senha revoga TODAS as sessoes abertas', async () => {
      const antiga = await entrar();
      const token = await emitirToken({ accountId: contaId, purpose: 'PASSWORD_RESET' });

      await servico.confirmarRecuperacao({
        token,
        senha: 'senha-nova-bem-longa',
        agora: AGORA(),
      });

      // Quem troca a senha esqueceu dela ou desconfia de acesso indevido --
      // nos dois casos, sessao viva em outro aparelho contraria o motivo.
      const erro = await capturar(() =>
        servico.renovar({ refreshToken: antiga.refreshToken, agora: AGORA() }),
      );
      expect(erro.code).toBe('SESSAO_REVOGADA');

      // Restaura a senha para nao contaminar os testes seguintes.
      const volta = await emitirToken({ accountId: contaId, purpose: 'PASSWORD_RESET' });
      await servico.confirmarRecuperacao({ token: volta, senha: SENHA, agora: AGORA() });
    });
  });

  describe('rotacao de sessao', () => {
    it('rotaciona o refresh e invalida o anterior', async () => {
      const primeira = await entrar();
      const renovada = await servico.renovar({
        refreshToken: primeira.refreshToken,
        agora: AGORA(),
      });

      expect(renovada.refreshToken).not.toBe(primeira.refreshToken);

      const erro = await capturar(() =>
        servico.renovar({ refreshToken: primeira.refreshToken, agora: AGORA() }),
      );
      expect(erro.code).toBe('AUTH_REFRESH_REUSED');
    });

    it('o replay derruba a FAMILIA -- o refresh BOM tambem para de valer', async () => {
      // Este e o ponto do modelo de familia. Sem esta assercao, um codigo que
      // apenas recusa o token velho passaria no teste anterior e deixaria o
      // ladrao seguir usando o token que roubou.
      const primeira = await entrar();
      const renovada = await servico.renovar({
        refreshToken: primeira.refreshToken,
        agora: AGORA(),
      });

      await capturar(() =>
        servico.renovar({ refreshToken: primeira.refreshToken, agora: AGORA() }),
      );

      const erro = await capturar(() =>
        servico.renovar({ refreshToken: renovada.refreshToken, agora: AGORA() }),
      );
      expect(erro.code).toBe('SESSAO_REVOGADA');
    });

    it('nao guarda o refresh em claro -- so o hash', async () => {
      const sessao = await entrar();
      const linha = await db.studentSession.findUniqueOrThrow({
        where: { id: sessao.sessionId },
      });

      expect(linha.tokenHash).not.toBe(sessao.refreshToken);
      expect(linha.tokenHash).toHaveLength(64);
    });

    it('logout e idempotente -- sair duas vezes nao e erro', async () => {
      const sessao = await entrar();

      await servico.sair({ refreshToken: sessao.refreshToken, agora: AGORA() });
      await expect(
        servico.sair({ refreshToken: sessao.refreshToken, agora: AGORA() }),
      ).resolves.toBeUndefined();
    });
  });

  describe('sessoes', () => {
    it('sessao revogada deixa de renovar -- M4-AC-002', async () => {
      const sessao = await entrar();
      const ctx = await contextoDe(sessao.sessionId);

      await servico.revogarSessao(ctx, sessao.sessionId, AGORA());

      const erro = await capturar(() =>
        servico.renovar({ refreshToken: sessao.refreshToken, agora: AGORA() }),
      );
      expect(erro.code).toBe('SESSAO_REVOGADA');
    });

    it('um aluno NAO revoga a sessao de outro', async () => {
      const minha = await entrar();
      const doOutro = await entrar(EMAIL_DO_OUTRO);
      const meuCtx = await contextoDe(minha.sessionId);

      const erro = await capturar(() =>
        servico.revogarSessao(meuCtx, doOutro.sessionId, AGORA()),
      );
      expect(erro.code).toBe('SESSAO_NAO_ENCONTRADA');

      // E a sessao do outro CONTINUA funcionando. Recusar sem vazar nao pode
      // significar "revogou mesmo assim, mas mentiu na resposta".
      await expect(
        servico.renovar({ refreshToken: doOutro.refreshToken, agora: AGORA() }),
      ).resolves.toBeTruthy();
    });

    it('lista so as sessoes ativas, marcando a atual', async () => {
      const sessao = await entrar();
      const ctx = await contextoDe(sessao.sessionId);

      const lista = await servico.listarSessoes(ctx, AGORA());
      const atual = lista.find((s) => s.id === sessao.sessionId);

      expect(atual?.atual).toBe(true);
      expect(atual?.deviceLabel).toBe('Aparelho de teste');
    });
  });

  describe('step-up -- M4-FR-005', () => {
    it('recusa acao sensivel quando a autenticacao nao e recente', async () => {
      const sessao = await entrar();
      const ctx = await contextoDe(sessao.sessionId);

      const muitoDepois = new Date(Date.now() + 10 * 60_000);
      const erro = await capturar(() =>
        servico.revogarSessao(ctx, sessao.sessionId, muitoDepois),
      );
      expect(erro.code).toBe('REAUTENTICACAO_NECESSARIA');
    });

    it('confirmar a senha libera a acao de novo', async () => {
      const sessao = await entrar();
      const ctx = await contextoDe(sessao.sessionId);

      const muitoDepois = new Date(Date.now() + 10 * 60_000);
      await servico.reautenticar(ctx, SENHA, muitoDepois);

      const renovado = await contextoDe(sessao.sessionId);
      await expect(
        servico.revogarSessao(renovado, sessao.sessionId, muitoDepois),
      ).resolves.toBeUndefined();
    });

    it('senha errada nao libera', async () => {
      const sessao = await entrar();
      const ctx = await contextoDe(sessao.sessionId);

      const erro = await capturar(() =>
        servico.reautenticar(ctx, 'senha-errada-porem-longa', AGORA()),
      );
      expect(erro.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });
});
