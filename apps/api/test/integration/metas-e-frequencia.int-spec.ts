import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F20 -- metas e frequencia, pela porta da frente.
 *
 * O que este arquivo prova, e que teste de funcao pura NAO alcanca:
 *
 *   - so passagem CONFIRMADA vira frequencia (`M3-BR-007`): ALLOW sem giro
 *     nao e treino, e DENY nunca conta;
 *   - multiplas entradas no mesmo dia contam UMA sessao, e os eventos brutos
 *     continuam todos no banco (`M3-BR-008`, `M3-AC-006`);
 *   - reprojetar e IDEMPOTENTE -- consultar duas vezes nao dobra a
 *     frequencia, e a garantia e a chave unica do banco;
 *   - o dia e o LOCAL da unidade: passagem as 23h de Sao Paulo nao vira o dia
 *     seguinte so porque em UTC ja virou;
 *   - progresso usa a baseline CONGELADA da meta, nao a medicao original;
 *   - isolamento entre tenants nas rotas novas (INV-006);
 *   - granularidade invalida responde 400 em vez de cair num padrao.
 */
describe('F20 -- metas e frequencia', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: { email: `f20-a-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
    b: { email: `f20-b-${sufixo}@exemplo.test`, tenantId: '', gymUnitId: '', cookie: '' },
  };

  const PERMISSOES = ['student.create', 'student.read', 'health.read', 'health.assess'];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (
    conta: (typeof contas)['a'],
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
    conta.gymUnitId = unidade.id;
    conta.cookie = cookieDeAcesso(login);
  };

  const criarAluno = async (conta: (typeof contas)['a']): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno De Teste',
        birthDate: '1990-05-10',
        gymUnitId: conta.gymUnitId,
        // Obrigatorio desde o ADR-043 Decisao 3; este arquivo nao testa CPF,
        // entao um valor fixo e valido basta.
        cpf: '52998224725',
        contacts: [],
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  /**
   * Grava um evento de acesso com (ou sem) passagem.
   *
   * Direto no banco de proposito: a rota de evento pertence ao MVP 1 e exige
   * o Edge. O que a F20 precisa provar e como ela LE esse dado, e montar a
   * fixture pela porta do MVP 1 testaria o MVP 1.
   */
  const gravarEvento = async (
    conta: (typeof contas)['a'],
    studentId: string,
    occurredAt: string,
    opcoes: {
      passagem?: 'CONFIRMED' | 'PENDING' | 'TIMED_OUT';
      outcome?: 'ALLOW' | 'DENY';
    } = {},
  ): Promise<string> => {
    const evento = await db.accessEvent.create({
      data: {
        tenantId: conta.tenantId,
        gymUnitId: conta.gymUnitId,
        studentId,
        outcome: opcoes.outcome ?? 'ALLOW',
        reason: opcoes.outcome === 'DENY' ? 'NO_ENTITLEMENT' : 'ACTIVE_ENTITLEMENT',
        policyVersion: '1.1.0',
        mode: 'ONLINE',
        method: 'FACIAL',
        occurredAt: new Date(occurredAt),
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        detail: {},
      },
    });

    if (opcoes.passagem) {
      await db.accessPassage.create({
        data: { tenantId: conta.tenantId, accessEventId: evento.id, state: opcoes.passagem },
      });
    }

    return evento.id;
  };

  interface FrequenciaResposta {
    studentId: string;
    period: string;
    granularity: string;
    timezone: string;
    policyVersion: string;
    dataQuality: string;
    totalSessions: number;
    totalPassages: number;
    buckets: { label: string; sessions: number; passages: number }[];
    consistency: { weeksWithSession: number; eligibleWeeks: number; ratio: number | null };
    sessions: {
      date: string;
      gymUnitId: string;
      passages: number;
      passageIds: string[];
    }[];
  }

  const frequencia = async (
    conta: (typeof contas)['a'],
    studentId: string,
    query = 'period=ALL',
  ): Promise<request.Response> =>
    request(servidor())
      .get(`/api/v1/students/${studentId}/attendance?${query}`)
      .set('Cookie', conta.cookie);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f20-academia-a-${sufixo}`);
    await montarAcademia(contas.b, `f20-academia-b-${sufixo}`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('elegibilidade (M3-BR-007)', () => {
    it('passagem CONFIRMADA vira sessao', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', { passagem: 'CONFIRMED' });

      const resposta = await frequencia(contas.a, aluno);
      const corpo = resposta.body as FrequenciaResposta;

      expect(resposta.status).toBe(200);
      expect(corpo.totalSessions).toBe(1);
      expect(corpo.dataQuality).toBe('CONFIRMADA');
    });

    /**
     * O caso que o `M3-BR-007` existe para cobrir: a pessoa recebeu ALLOW e
     * desistiu na porta. Contar isso como treino inflaria a frequencia de
     * quem nunca entrou.
     */
    it('ALLOW sem giro confirmado NAO e treino', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', { passagem: 'PENDING' });
      await gravarEvento(contas.a, aluno, '2026-08-18T12:00:00.000Z', { passagem: 'TIMED_OUT' });
      await gravarEvento(contas.a, aluno, '2026-08-19T12:00:00.000Z');

      const corpo = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      expect(corpo.totalSessions).toBe(0);
      // Zero sessao com fonte incerta NAO e o mesmo que "faltou": a tela
      // precisa distinguir para nao cobrar presenca de quem esteve la.
      expect(corpo.dataQuality).toBe('SEM_FONTE_CONFIRMADA');
    });

    it('DENY nunca conta, mesmo com passagem confirmada', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', {
        passagem: 'CONFIRMED',
        outcome: 'DENY',
      });

      expect((await frequencia(contas.a, aluno)).body).toMatchObject({ totalSessions: 0 });
    });
  });

  describe('agrupamento por dia civil (M3-BR-008, M3-AC-006)', () => {
    it('tres entradas no mesmo dia sao UMA sessao, e os tres eventos ficam no banco', async () => {
      const aluno = await criarAluno(contas.a);
      const ids = [
        await gravarEvento(contas.a, aluno, '2026-08-17T11:00:00.000Z', { passagem: 'CONFIRMED' }),
        await gravarEvento(contas.a, aluno, '2026-08-17T15:00:00.000Z', { passagem: 'CONFIRMED' }),
        await gravarEvento(contas.a, aluno, '2026-08-17T21:00:00.000Z', { passagem: 'CONFIRMED' }),
      ];

      const corpo = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      expect(corpo.totalSessions).toBe(1);
      expect(corpo.totalPassages).toBe(3);

      // "sem apagar eventos brutos": os tres continuam la, intactos.
      const brutos = await db.accessEvent.count({ where: { id: { in: ids } } });
      expect(brutos).toBe(3);

      const passagens = await db.accessPassage.count({
        where: { accessEventId: { in: ids } },
      });
      expect(passagens).toBe(3);
    });

    it('a sessao aponta para as passagens que a formaram', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T11:00:00.000Z', { passagem: 'CONFIRMED' });
      await gravarEvento(contas.a, aluno, '2026-08-17T15:00:00.000Z', { passagem: 'CONFIRMED' });

      const corpo = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      // Sem os ids, reprojetar teria de confiar no agregado que ele mesmo
      // quer refazer.
      expect(corpo.sessions[0]!.passageIds).toHaveLength(2);
    });

    it('nao devolve duracao nem tempo de permanencia', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T11:00:00.000Z', { passagem: 'CONFIRMED' });
      await gravarEvento(contas.a, aluno, '2026-08-17T21:00:00.000Z', { passagem: 'CONFIRMED' });

      const corpo = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      // A Slice 3.4 proibe inferir duracao sem saida confiavel, e hoje nao ha
      // saida nenhuma: a catraca opera liberada nos dois sentidos (ADR-029).
      expect(corpo.sessions[0]).not.toHaveProperty('duration');
      expect(corpo.sessions[0]).not.toHaveProperty('durationMinutes');
      expect(corpo).not.toHaveProperty('averageDuration');
    });
  });

  describe('o dia e o LOCAL da unidade', () => {
    /**
     * 2026-08-18T02:00Z ainda e 17/08 as 23:00 em Sao Paulo. Agrupar por dia
     * UTC diria que o aluno treinou dois dias -- inflando a frequencia de
     * quem treina a noite, que e a maioria.
     */
    it('23h em Sao Paulo nao vira o dia seguinte so porque em UTC virou', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T22:00:00.000Z', { passagem: 'CONFIRMED' });
      await gravarEvento(contas.a, aluno, '2026-08-18T02:00:00.000Z', { passagem: 'CONFIRMED' });

      const corpo = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      expect(corpo.totalSessions).toBe(1);
      expect(corpo.sessions[0]!.date).toBe('2026-08-17');
      expect(corpo.timezone).toBe('America/Sao_Paulo');
    });
  });

  describe('idempotencia da reprojecao', () => {
    /**
     * Consultar e projetar. Consultar duas vezes NAO pode dobrar a frequencia
     * -- a garantia e a chave unica `(tenant, aluno, dia, unidade, politica)`
     * no banco, nao um `if` no servico: guarda que le antes de escrever perde
     * a corrida por construcao (licao da F14, F17 e F18).
     */
    it('consultar tres vezes nao dobra a frequencia', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', { passagem: 'CONFIRMED' });

      const primeira = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;
      const segunda = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;
      const terceira = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      expect(primeira.totalSessions).toBe(1);
      expect(segunda.totalSessions).toBe(1);
      expect(terceira.totalSessions).toBe(1);

      const linhas = await db.studentAttendanceSession.count({
        where: { tenantId: contas.a.tenantId, studentId: aluno },
      });
      expect(linhas).toBe(1);
    });

    it('evento atrasado do mesmo dia atualiza a sessao em vez de criar outra', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', { passagem: 'CONFIRMED' });

      expect(((await frequencia(contas.a, aluno)).body as FrequenciaResposta).totalPassages).toBe(1);

      // Chega depois, referente ao MESMO dia.
      await gravarEvento(contas.a, aluno, '2026-08-17T20:00:00.000Z', { passagem: 'CONFIRMED' });

      const depois = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      expect(depois.totalSessions).toBe(1);
      expect(depois.totalPassages).toBe(2);
    });
  });

  describe('agregados e consistencia', () => {
    it('agrupa por semana, mes e ano conforme a granularidade', async () => {
      const aluno = await criarAluno(contas.a);
      // Datas no PASSADO em relacao ao "agora" real: a consulta corta em
      // `agora`, e passagem futura nao existe -- ninguem treinou amanha.
      await gravarEvento(contas.a, aluno, '2026-08-10T12:00:00.000Z', { passagem: 'CONFIRMED' });
      await gravarEvento(contas.a, aluno, '2026-08-12T12:00:00.000Z', { passagem: 'CONFIRMED' });
      await gravarEvento(contas.a, aluno, '2026-08-18T12:00:00.000Z', { passagem: 'CONFIRMED' });

      const semanal = (await frequencia(contas.a, aluno, 'period=ALL&granularity=SEMANAL'))
        .body as FrequenciaResposta;
      const mensal = (await frequencia(contas.a, aluno, 'period=ALL&granularity=MENSAL'))
        .body as FrequenciaResposta;

      expect(semanal.buckets).toEqual([
        { label: '2026-W33', sessions: 2, passages: 2 },
        { label: '2026-W34', sessions: 1, passages: 1 },
      ]);
      expect(mensal.buckets).toEqual([{ label: '2026-08', sessions: 3, passages: 3 }]);
    });

    it('devolve a versao da politica que formou os numeros', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', { passagem: 'CONFIRMED' });

      const corpo = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      // Sem a versao, comparar dois numeros de politicas diferentes seria
      // comparar coisas diferentes sem saber.
      expect(corpo.policyVersion).toBe('dia-civil-local@1');
    });

    it('granularidade invalida responde 400 em vez de cair num padrao', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await frequencia(contas.a, aluno, 'granularity=DIARIA');

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('HEALTH_INVALID_GRANULARITY');
    });

    it('aluno sem passagem nenhuma nao quebra, e diz que a fonte falta', async () => {
      const aluno = await criarAluno(contas.a);

      const corpo = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;

      expect(corpo.totalSessions).toBe(0);
      expect(corpo.buckets).toEqual([]);
      expect(corpo.dataQuality).toBe('SEM_FONTE_CONFIRMADA');
      // Sem periodo elegivel a proporcao e `null`, nao `0` nem `NaN`.
      expect(corpo.consistency.ratio).toBeNull();
    });
  });

  describe('progresso da meta (Slice 3.4)', () => {
    const criarMeta = async (
      conta: (typeof contas)['a'],
      studentId: string,
      corpo: Record<string, unknown>,
    ): Promise<request.Response> =>
      request(servidor())
        .post(`/api/v1/students/${studentId}/health-goals`)
        .set('Cookie', conta.cookie)
        .send(corpo);

    const publicar = async (
      conta: (typeof contas)['a'],
      studentId: string,
      assessedAt: string,
      valor: number,
    ): Promise<void> => {
      const rascunho = await request(servidor())
        .post(`/api/v1/students/${studentId}/assessments`)
        .set('Cookie', conta.cookie)
        .send({
          assessedAt,
          measurements: [{ type: 'WEIGHT', value: valor, unit: 'kg' }],
        });

      expect(rascunho.status).toBe(201);

      const publicacao = await request(servidor())
        .post(`/api/v1/assessments/${(rascunho.body as { id: string }).id}/publish`)
        .set('Cookie', conta.cookie)
        .send({});

      expect(publicacao.status).toBe(201);
    };

    interface MetaProgressoResposta {
      id: string;
      type: string;
      progress: {
        baseline: number;
        target: number;
        current: number | null;
        fraction: number | null;
        state: string;
        overdue: boolean;
      };
    }

    const progresso = async (
      conta: (typeof contas)['a'],
      studentId: string,
    ): Promise<request.Response> =>
      request(servidor())
        .get(`/api/v1/students/${studentId}/health-goals/progress`)
        .set('Cookie', conta.cookie);

    it('calcula a fracao do caminho andada contra a baseline congelada', async () => {
      const aluno = await criarAluno(contas.a);

      await publicar(contas.a, aluno, '2026-01-10T12:00:00.000Z', 100);
      const meta = await criarMeta(contas.a, aluno, {
        type: 'WEIGHT',
        baselineValue: 100,
        targetValue: 90,
        unit: 'kg',
        deadline: '2026-12-31',
      });
      expect(meta.status).toBe(201);

      await publicar(contas.a, aluno, '2026-06-10T12:00:00.000Z', 95);

      const corpo = (await progresso(contas.a, aluno)).body as MetaProgressoResposta[];

      expect(corpo).toHaveLength(1);
      expect(corpo[0]!.progress).toMatchObject({
        baseline: 100,
        target: 90,
        current: 95,
        fraction: 0.5,
        state: 'EM_PROGRESSO',
      });
    });

    it('meta sem medicao posterior nao vira progresso zero', async () => {
      const aluno = await criarAluno(contas.a);

      const criada = await criarMeta(contas.a, aluno, {
        type: 'BODY_FAT_PERCENT',
        baselineValue: 25,
        targetValue: 18,
        unit: 'percent',
        deadline: '2026-12-31',
      });
      expect(criada.status).toBe(201);

      const corpo = (await progresso(contas.a, aluno)).body as MetaProgressoResposta[];
      expect(corpo).toHaveLength(1);

      // Zero afirmaria "mediu e nao saiu do lugar" (INV-104).
      expect(corpo[0]!.progress.fraction).toBeNull();
      expect(corpo[0]!.progress.state).toBe('SEM_MEDICAO');
      expect(corpo[0]!.progress.current).toBeNull();
    });

    /**
     * A correcao da avaliacao de partida NAO pode mover a baseline: se
     * movesse, o percentual de hoje mudaria sozinho e a meta passaria a
     * significar outra coisa retroativamente (INV-102).
     */
    it('corrigir a avaliacao original nao move a baseline da meta', async () => {
      const aluno = await criarAluno(contas.a);

      const rascunho = await request(servidor())
        .post(`/api/v1/students/${aluno}/assessments`)
        .set('Cookie', contas.a.cookie)
        .send({
          assessedAt: '2026-01-10T12:00:00.000Z',
          measurements: [{ type: 'WEIGHT', value: 100, unit: 'kg' }],
        });
      const originalId = (rascunho.body as { id: string }).id;
      await request(servidor())
        .post(`/api/v1/assessments/${originalId}/publish`)
        .set('Cookie', contas.a.cookie)
        .send({});

      await criarMeta(contas.a, aluno, {
        type: 'WEIGHT',
        baselineValue: 100,
        targetValue: 90,
        unit: 'kg',
        deadline: '2026-12-31',
      });

      // A original estava errada: eram 102 kg, nao 100.
      const correcao = await request(servidor())
        .post(`/api/v1/assessments/${originalId}/corrections`)
        .set('Cookie', contas.a.cookie)
        .send({
          assessedAt: '2026-01-10T12:00:00.000Z',
          measurements: [{ type: 'WEIGHT', value: 102, unit: 'kg' }],
        });
      expect(correcao.status).toBe(201);

      const corpo = (await progresso(contas.a, aluno)).body as MetaProgressoResposta[];

      // A baseline continua 100 -- o valor combinado quando a meta nasceu.
      expect(corpo[0]!.progress.baseline).toBe(100);
    });

    it('nao edita avaliacao nenhuma ao calcular', async () => {
      const aluno = await criarAluno(contas.a);
      await publicar(contas.a, aluno, '2026-01-10T12:00:00.000Z', 100);
      await criarMeta(contas.a, aluno, {
        type: 'WEIGHT',
        baselineValue: 100,
        targetValue: 90,
        unit: 'kg',
        deadline: '2026-12-31',
      });

      const antes = await db.bodyAssessment.findMany({
        where: { tenantId: contas.a.tenantId, studentId: aluno },
        orderBy: { id: 'asc' },
      });

      await progresso(contas.a, aluno);
      await progresso(contas.a, aluno);

      const depois = await db.bodyAssessment.findMany({
        where: { tenantId: contas.a.tenantId, studentId: aluno },
        orderBy: { id: 'asc' },
      });

      // "progresso calculado, SEM editar avaliacoes" -- literal na Slice 3.4.
      expect(depois).toEqual(antes);
    });
  });

  describe('isolamento entre tenants (INV-006)', () => {
    it('a academia B nao ve a frequencia do aluno da academia A', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', { passagem: 'CONFIRMED' });

      const resposta = await frequencia(contas.b, aluno);

      // 404 e nao 403: 403 vazaria que aquele id existe em algum lugar.
      expect(resposta.status).toBe(404);
      expect((resposta.body as { code: string }).code).toBe('STUDENT_NOT_FOUND');
    });

    it('a academia B nao ve o progresso das metas do aluno da academia A', async () => {
      const aluno = await criarAluno(contas.a);

      const resposta = await request(servidor())
        .get(`/api/v1/students/${aluno}/health-goals/progress`)
        .set('Cookie', contas.b.cookie);

      expect(resposta.status).toBe(404);
    });

    it('a projecao da academia A nao conta passagem gravada pela B', async () => {
      const aluno = await criarAluno(contas.a);
      await gravarEvento(contas.a, aluno, '2026-08-17T12:00:00.000Z', { passagem: 'CONFIRMED' });

      const alunoB = await criarAluno(contas.b);
      await gravarEvento(contas.b, alunoB, '2026-08-17T12:00:00.000Z', { passagem: 'CONFIRMED' });

      const a = (await frequencia(contas.a, aluno)).body as FrequenciaResposta;
      const b = (await frequencia(contas.b, alunoB)).body as FrequenciaResposta;

      expect(a.totalSessions).toBe(1);
      expect(b.totalSessions).toBe(1);
    });
  });
});
