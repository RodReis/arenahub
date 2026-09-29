import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * `GET /api/v1/students?ordem=situacao` -- ordena pela situacao financeira
 * (`idsOrdenadosPorSituacaoFinanceira` no repository).
 *
 * A REGRA MORA EM DOIS LUGARES: `situacaoDeVencimento`
 * (`apps/admin-web/src/billing/vencimento.ts`) decide a coluna na tela, e o
 * SQL do repository decide a ordem. O ultimo `it` e o teste de paridade entre
 * as duas.
 *
 * SEM IMPORT de `vencimento.ts`: o `tsconfig` do `apps/api` fixa `rootDir: "."`
 * e o `tsc` recusa arquivo de outro app (TS6059). `situacaoEsperada` abaixo
 * replica os 4 ramos -- se `vencimento.ts` mudar, este arquivo muda junto.
 */
describe('GET /api/v1/students?ordem=situacao (integracao)', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';
  const FUSO = 'America/Sao_Paulo';

  const conta = { email: `situacao-${sufixo}@exemplo.test`, tenantId: '', planoId: '', cookie: '' };

  const PERMISSOES = ['student.read'];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /*
   * ATENCAO AO 'AGORA': o SQL usa `now()` do BANCO, que o teste nao controla.
   * Datas RELATIVAS a hoje, nunca literais -- data fixa envelhece e o CI fica
   * vermelho sozinho semanas depois.
   *
   * "Hoje" e o dia civil NO FUSO DA UNIDADE, nao o dia UTC: entre 21h e 0h em
   * Sao Paulo o dia UTC ja virou, e `emDias(0)` cairia amanha -- o aluno
   * "vence hoje" viraria "em dia" e o teste falharia so a noite.
   */
  const hojeNaUnidade = (): { ano: number; mes: number; dia: number } => {
    const [ano, mes, dia] = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO })
      .format(new Date())
      .split('-')
      .map(Number);

    return { ano: ano!, mes: mes!, dia: dia! };
  };

  /** Meia-noite UTC do dia `hoje + n` -- o formato em que o backend grava `dueAt`. */
  const emDias = (n: number): Date => {
    const { ano, mes, dia } = hojeNaUnidade();

    return new Date(Date.UTC(ano, mes - 1, dia + n));
  };

  type Situacao = 'BLOQUEIO_PROXIMO' | 'VENCIDA' | 'VENCE_EM_BREVE' | 'EM_DIA';

  const PRIORIDADE: Record<Situacao, number> = {
    BLOQUEIO_PROXIMO: 0,
    VENCIDA: 1,
    VENCE_EM_BREVE: 2,
    EM_DIA: 3,
  };

  /** Copia dos 4 ramos de `situacaoDeVencimento` (ver cabecalho). */
  const situacaoEsperada = (
    invoice: { status: string; dueAt: string; blockAt: string | null } | null,
    timezone: string | null,
  ): Situacao => {
    if (!invoice || !timezone) return 'EM_DIA';
    if (invoice.status !== 'OPEN' && invoice.status !== 'OVERDUE') return 'EM_DIA';

    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
      .format(new Date())
      .split('-')
      .map(Number);
    const hoje = Date.UTC(partes[0]!, partes[1]! - 1, partes[2]);
    const diaUtc = (iso: string): number => {
      const d = new Date(iso);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    };
    const DIA = 24 * 60 * 60 * 1000;
    const diasAteVencer = Math.round((diaUtc(invoice.dueAt) - hoje) / DIA);

    if (diasAteVencer > 0) return 'EM_DIA';
    if (diasAteVencer === 0) return 'VENCE_EM_BREVE';
    if (invoice.blockAt !== null && Math.round((diaUtc(invoice.blockAt) - hoje) / DIA) <= 0) {
      return 'BLOQUEIO_PROXIMO';
    }

    return 'VENCIDA';
  };

  type AlunoDaLista = {
    id: string;
    fullName: string;
    invoiceParaAviso: { status: string; dueAt: string; blockAt: string | null } | null;
    timezoneDaUnidade: string | null;
  };

  let proximaUnidade = 0;
  /** Unidade propria por `it`: isola os cenarios dentro do mesmo tenant. */
  const criarUnidade = async (): Promise<string> => {
    proximaUnidade += 1;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: conta.tenantId,
        code: `U${proximaUnidade}`,
        name: `Unidade ${proximaUnidade} ${sufixo}`,
        timezone: FUSO,
        openingHours: {},
      },
    });

    return unidade.id;
  };

  let proximoNumero = 0;
  const criarAluno = async (
    gymUnitId: string,
    fullName: string,
    opcoes: {
      status?: 'ACTIVE' | 'BLOCKED';
      invoice?: { status: 'OPEN' | 'OVERDUE'; dueAt: Date; blockAt: Date | null };
    } = {},
  ): Promise<string> => {
    proximoNumero += 1;

    const aluno = await db.student.create({
      data: {
        tenantId: conta.tenantId,
        gymUnitId,
        fullName,
        membershipNumber: `S-${sufixo}-${proximoNumero}`,
        birthDate: new Date('1990-05-20T00:00:00Z'),
        status: opcoes.status ?? 'ACTIVE',
      },
    });

    if (opcoes.invoice) {
      // A invoice pende de assinatura ACTIVE: e por ela que a listagem devolve
      // `invoiceParaAviso`, que o teste de paridade le.
      const assinatura = await db.subscription.create({
        data: {
          tenantId: conta.tenantId,
          studentId: aluno.id,
          planId: conta.planoId,
          status: 'ACTIVE',
          startsAt: emDias(-60),
        },
      });

      await db.invoice.create({
        data: {
          tenantId: conta.tenantId,
          subscriptionId: assinatura.id,
          studentId: aluno.id,
          billingPeriod: emDias(-30),
          number: proximoNumero,
          status: opcoes.invoice.status,
          currency: 'BRL',
          subtotalMinor: 10_000,
          totalMinor: 10_000,
          dueAt: opcoes.invoice.dueAt,
          blockAt: opcoes.invoice.blockAt,
        },
      });
    }

    return aluno.id;
  };

  /**
   * Os 4 estados, um aluno por estado. A letra do nome anda AO CONTRARIO da
   * gravidade (D = pior, A = em dia) e a ordem de cadastro nao bate com
   * nenhuma das duas: se o SQL empatar dois estados, o desempate por nome
   * inverte o par e o teste falha -- com as letras na mesma direcao da
   * gravidade, o empate passaria despercebido (verificado por mutacao).
   */
  const criarQuatroSituacoes = async (gymUnitId: string): Promise<void> => {
    await criarAluno(gymUnitId, 'A Em Dia', {
      invoice: { status: 'OPEN', dueAt: emDias(10), blockAt: null },
    });
    await criarAluno(gymUnitId, 'C Vencida', {
      invoice: { status: 'OVERDUE', dueAt: emDias(-5), blockAt: emDias(3) },
    });
    await criarAluno(gymUnitId, 'D Bloqueado', {
      invoice: { status: 'OVERDUE', dueAt: emDias(-10), blockAt: emDias(-2) },
    });
    await criarAluno(gymUnitId, 'B Vence Hoje', {
      invoice: { status: 'OPEN', dueAt: emDias(0), blockAt: null },
    });
  };

  const listar = async (parametros: Record<string, string>): Promise<AlunoDaLista[]> => {
    const resposta = await request(servidor())
      .get('/api/v1/students')
      .query({ ordem: 'situacao', ...parametros })
      .set('Cookie', conta.cookie);

    expect(resposta.status).toBe(200);

    return resposta.body as AlunoDaLista[];
  };

  const nomes = (alunos: AlunoDaLista[]): string[] => alunos.map((a) => a.fullName);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    const senhas = app.get(PasswordService);
    const slug = `situacao-rede-${sufixo}`;

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

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Plano ${slug}` },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: conta.email, password: SENHA });

    conta.tenantId = tenant.id;
    conta.planoId = plano.id;
    conta.cookie = cookieDeAcesso(login);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('ordena do mais grave para o menos grave em direcao=asc (o primeiro clique)', async () => {
    const gymUnitId = await criarUnidade();
    await criarQuatroSituacoes(gymUnitId);

    const alunos = await listar({ gymUnitId, status: 'ACTIVE', direcao: 'asc' });

    // `asc` traz o PIOR primeiro: o primeiro clique do `DataTable` e sempre
    // `asc`, e quem clica em "Situacao" quer achar quem esta devendo.
    expect(nomes(alunos)).toEqual(['D Bloqueado', 'C Vencida', 'B Vence Hoje', 'A Em Dia']);
  });

  it('direcao=desc inverte: em dia primeiro, bloqueado por ultimo', async () => {
    const gymUnitId = await criarUnidade();
    await criarQuatroSituacoes(gymUnitId);

    const alunos = await listar({ gymUnitId, status: 'ACTIVE', direcao: 'desc' });

    expect(nomes(alunos)).toEqual(['A Em Dia', 'B Vence Hoje', 'C Vencida', 'D Bloqueado']);
  });

  it('desempata por nome quando a situacao e a mesma', async () => {
    const gymUnitId = await criarUnidade();
    await criarAluno(gymUnitId, 'Carlos');
    await criarAluno(gymUnitId, 'Ana');
    await criarAluno(gymUnitId, 'Bruno');

    const primeira = await listar({ gymUnitId, status: 'ACTIVE', direcao: 'asc' });
    const segunda = await listar({ gymUnitId, status: 'ACTIVE', direcao: 'asc' });

    expect(nomes(primeira)).toEqual(['Ana', 'Bruno', 'Carlos']);
    // Estavel entre carregamentos -- sem desempate a ordem seria a fisica do
    // Postgres, que muda a cada UPDATE.
    expect(nomes(segunda)).toEqual(nomes(primeira));
  });

  it('paginacao por cursor nao pula nem repete aluno ordenado por situacao', async () => {
    const gymUnitId = await criarUnidade();
    await criarQuatroSituacoes(gymUnitId);
    await criarAluno(gymUnitId, 'E Outra Vencida', {
      invoice: { status: 'OVERDUE', dueAt: emDias(-3), blockAt: null },
    });

    const filtro = { gymUnitId, status: 'ACTIVE', direcao: 'asc' };

    const completa = await listar({ ...filtro, limit: '5' });
    const referencia = completa.map((a) => a.id);
    const pagina1 = (await listar({ ...filtro, limit: '2' })).map((a) => a.id);
    const pagina2 = (await listar({ ...filtro, limit: '2', cursor: pagina1.at(-1)! })).map(
      (a) => a.id,
    );

    // A referencia ja esta na ordem de gravidade -- o corte e sobre a ordem
    // por situacao, nao sobre a padrao. As duas vencidas empatam e desempatam
    // por nome.
    expect(nomes(completa)).toEqual([
      'D Bloqueado',
      'C Vencida',
      'E Outra Vencida',
      'B Vence Hoje',
      'A Em Dia',
    ]);
    expect(pagina1).toHaveLength(2);
    expect(pagina2).toHaveLength(2);
    expect(new Set([...pagina1, ...pagina2]).size).toBe(4);
    expect([...pagina1, ...pagina2]).toEqual(referencia.slice(0, 4));
  });

  it('aluno sem fatura em aberto aparece como EM_DIA, nao some da lista', async () => {
    const gymUnitId = await criarUnidade();
    // Criado ANTES: na ordem padrao (cadastro mais recente primeiro) o sem
    // fatura viria primeiro -- o teste nao passa por coincidencia.
    const vencida = await criarAluno(gymUnitId, 'Z Vencida', {
      invoice: { status: 'OVERDUE', dueAt: emDias(-5), blockAt: null },
    });
    const semFatura = await criarAluno(gymUnitId, 'A Sem Fatura');

    const alunos = await listar({ gymUnitId, status: 'ACTIVE', direcao: 'asc' });

    // O nome "A" poria o sem fatura primeiro se a ordem fosse so por nome --
    // ele vem por ULTIMO porque e prioridade 3. `JOIN` no lugar de
    // `LEFT JOIN` o faria sumir.
    expect(alunos.map((a) => a.id)).toEqual([vencida, semFatura]);
  });

  it('respeita o filtro de status junto com a ordenacao', async () => {
    const gymUnitId = await criarUnidade();
    const vencida = { status: 'OVERDUE' as const, dueAt: emDias(-5), blockAt: null };
    // "Dois" antes de "Um": a ordem padrao (cadastro recente primeiro) daria
    // o inverso do desempate por nome.
    const ativo2 = await criarAluno(gymUnitId, 'Ativo Dois', { invoice: vencida });
    const ativo1 = await criarAluno(gymUnitId, 'Ativo Um', { invoice: vencida });
    const bloqueado = await criarAluno(gymUnitId, 'Bloqueado', {
      status: 'BLOCKED',
      invoice: vencida,
    });

    const soAtivos = await listar({ gymUnitId, status: 'ACTIVE', direcao: 'asc' });
    const todos = await listar({ gymUnitId, direcao: 'asc' });

    expect(soAtivos.map((a) => a.id)).toEqual([ativo2, ativo1]);
    expect(soAtivos.map((a) => a.id)).not.toContain(bloqueado);
    // Contraprova: sem o filtro o BLOCKED aparece -- ele sumiu pelo filtro,
    // nao por outro motivo.
    expect(todos.map((a) => a.id)).toContain(bloqueado);
  });

  it('paridade TS/SQL: a ordem do servidor bate com situacaoDeVencimento', async () => {
    const gymUnitId = await criarUnidade();
    await criarQuatroSituacoes(gymUnitId);

    const alunos = await listar({ gymUnitId, status: 'ACTIVE', direcao: 'asc' });

    const situacoes = alunos.map((a) => situacaoEsperada(a.invoiceParaAviso, a.timezoneDaUnidade));
    const prioridades = situacoes.map((s) => PRIORIDADE[s]);

    // Nao-decrescente: a ordem do SQL concorda com o que a coluna mostra.
    expect(prioridades).toEqual([...prioridades].sort((a, b) => a - b));
    // E nao vacuamente: os 4 estados estao presentes, um por aluno.
    expect(situacoes).toEqual(['BLOQUEIO_PROXIMO', 'VENCIDA', 'VENCE_EM_BREVE', 'EM_DIA']);
  });
});
