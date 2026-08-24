import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { BillingRepository } from '../../src/modules/billing/billing.repository.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { StudentRepository } from '../../src/modules/students/student.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F7 -- aluno, plano e entitlement manual, provados pela porta da
 * frente.
 *
 * O que este arquivo existe para provar, e que teste unitario nao alcanca:
 *
 *   - matricula unica sob CONCORRENCIA real (20 criacoes simultaneas);
 *   - isolamento entre tenants em cada rota nova (INV-006);
 *   - atomicidade: transicao recusada nao deixa timeline nem outbox;
 *   - derivacao assinatura -> entitlement na mesma transacao (INV-062).
 */
describe('F7 -- aluno, plano e entitlement', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: {
      email: `f7-a-${sufixo}@exemplo.test`,
      tenantId: '',
      userId: '',
      unidadeId: '',
      cookie: '',
    },
    b: {
      email: `f7-b-${sufixo}@exemplo.test`,
      tenantId: '',
      userId: '',
      unidadeId: '',
      cookie: '',
    },
  };

  const PERMISSOES = [
    'student.create',
    'student.read',
    'student.update',
    'plan.manage',
    'plan.read',
    'subscription.manage',
  ];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (
    conta: {
      email: string;
      tenantId: string;
      userId: string;
      unidadeId: string;
      cookie: string;
    },
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
    conta.userId = user.id;
    conta.unidadeId = unidade.id;
    conta.cookie = cookieDeAcesso(login);
  };

  /*
   * CPF valido e DIFERENTE a cada chamada (ADR-043 Decisao 3 tornou o campo
   * obrigatorio no `POST /students`). Contador simples, nao aleatorio: teste
   * tem de ser deterministico.
   */
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

  const criarAluno = async (
    conta: (typeof contas)['a'],
    dados: Record<string, unknown> = {},
  ): Promise<request.Response> =>
    request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno De Teste',
        birthDate: '2000-05-10',
        // Obrigatorio desde a F45: unidade de ORIGEM, nunca controle de
        // acesso. Cada chamada pode sobrescrever pelo `...dados`.
        gymUnitId: conta.unidadeId,
        // Obrigatorio desde o ADR-043 Decisao 3. Cada chamada pode
        // sobrescrever pelo `...dados`.
        cpf: gerarCpfValido(),
        contacts: [],
        ...dados,
      });

  /** Plano de segunda a sexta, 06:00-22:00 (360 a 1320), com preco de R$ 150,00. */
  const criarPlano = async (conta: (typeof contas)['a']): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/plans')
      .set('Cookie', conta.cookie)
      .send({
        name: `Mensal ${randomUUID().slice(0, 6)}`,
        gymUnitIds: [conta.unidadeId],
        janelas: [1, 2, 3, 4, 5].map((dia) => ({
          gymUnitId: conta.unidadeId,
          dayOfWeek: dia,
          startMinute: 360,
          endMinute: 1320,
        })),
        amountMinor: 15000,
      });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f7-rede-a-${sufixo}`);
    await montarAcademia(contas.b, `f7-rede-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('matricula', () => {
    /**
     * O teste que justifica o `FOR UPDATE`. 20 criacoes disparadas juntas:
     * se o lock nao existisse, duas leriam o mesmo `next_value` e o
     * `@@unique([tenantId, membershipNumber])` derrubaria uma delas -- ou,
     * pior, um contador sem constraint geraria matricula repetida.
     *
     * PELO REPOSITORIO, E NAO PELA ROTA HTTP, de proposito. A concorrencia
     * que importa aqui e a do BANCO: 20 transacoes disputando a mesma linha
     * de contador. Passar por HTTP acrescentaria 20 conexoes simultaneas
     * disputando um pool `pg` de 10 -- e o que quebrou no CI foi isso
     * (`read ECONNRESET` no runner lento), nao o lock. O teste media o
     * transporte junto com a regra, e o transporte era a parte fragil.
     *
     * A cobertura HTTP da mesma rota continua nos outros testes deste
     * arquivo; o que sai daqui e so a disputa de socket.
     */
    it('gera matricula unica e sequencial sob 20 criacoes concorrentes', async () => {
      const alunos = app.get(StudentRepository);

      const contexto: TenantContext = {
        tenantId: contas.a.tenantId,
        actorId: contas.a.userId,
        sessionId: randomUUID(),
        permissions: new Set(['student.create']),
        allowedUnitIds: 'ALL',
      };

      const criados = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          alunos.criar(
            contexto,
            {
              fullName: `Concorrente ${i}`,
              birthDate: new Date('2000-05-10T00:00:00.000Z'),
              gymUnitId: contas.a.unidadeId,
              contacts: [],
            },
            `corrida-${i}`,
            2026,
          ),
        ),
      );

      const matriculas = criados.map((a) => a.membershipNumber);

      expect(new Set(matriculas).size).toBe(20);
      expect(matriculas.every((m) => /^AP-\d{4}-\d{8}$/.test(m))).toBe(true);

      // Sequencial de verdade: 20 numeros consecutivos, sem buraco nem
      // repeticao. Só `Set.size` provaria unicidade, mas nao ordem.
      const sequenciais = matriculas
        .map((m) => Number(m.split('-')[2]))
        .sort((a, b) => a - b);

      expect(sequenciais[19]! - sequenciais[0]!).toBe(19);
    });

    /** INV-009, INV-011: a matricula nunca deriva do CPF. */
    it('nao usa o CPF na matricula', async () => {
      const resposta = await criarAluno(contas.a, { cpf: '529.982.247-25' });

      expect(resposta.status).toBe(201);

      const corpo = resposta.body as { membershipNumber: string };

      expect(corpo.membershipNumber).not.toContain('529');
      expect(corpo.membershipNumber).not.toContain('725');
    });

    /** Sequencia e POR TENANT: o volume de um nao vaza para o outro. */
    it('mantem contadores independentes por tenant', async () => {
      const primeiro = await criarAluno(contas.b, { fullName: 'Primeiro Da Rede B' });

      expect(primeiro.status).toBe(201);
      expect((primeiro.body as { membershipNumber: string }).membershipNumber).toMatch(
        /^AP-\d{4}-00000001$/,
      );
    });
  });

  describe('CPF', () => {
    it('recusa CPF com digito verificador invalido', async () => {
      const resposta = await criarAluno(contas.a, { cpf: '11111111111' });

      expect(resposta.status).toBe(400);
    });

    /**
     * ADR-034: o CPF completo volta na resposta e fica no banco em claro.
     * `cpfHash` continua gravado -- e o indice que a deteccao de duplicata
     * usa, sem precisar varrer a tabela em texto claro.
     */
    it('devolve e persiste o CPF completo (ADR-034)', async () => {
      const resposta = await criarAluno(contas.a, {
        fullName: 'Com Documento',
        cpf: '529.982.247-25',
      });

      expect((resposta.body as { cpf: string }).cpf).toBe('529.982.247-25');

      const gravado = await db.student.findUniqueOrThrow({
        where: { id: (resposta.body as { id: string }).id },
      });

      expect(gravado.cpf).toBe('529.982.247-25');
      expect(gravado.cpfHash).not.toContain('52998224725');
    });

    /** INV-014: avisa, nao bloqueia. */
    it('aponta duplicata por CPF sem impedir o cadastro', async () => {
      const cpf = '168.995.350-09';

      const primeiro = await criarAluno(contas.a, { fullName: 'Original', cpf });
      expect(primeiro.status).toBe(201);

      const segundo = await criarAluno(contas.a, { fullName: 'Repetido', cpf });

      expect(segundo.status).toBe(201);

      const candidatos = (segundo.body as { duplicateCandidates: { motivo: string }[] })
        .duplicateCandidates;

      expect(candidatos.some((c) => c.motivo === 'CPF')).toBe(true);
    });

    /** O mesmo CPF em OUTRO tenant nao e duplicata: sao bases separadas. */
    it('nao aponta duplicata de CPF entre tenants diferentes', async () => {
      const cpf = '529.982.247-25';

      await criarAluno(contas.a, { fullName: 'Da Rede A', cpf });
      const naRedeB = await criarAluno(contas.b, { fullName: 'Da Rede B', cpf });

      expect(naRedeB.status).toBe(201);
      expect(
        (naRedeB.body as { duplicateCandidates: unknown[] }).duplicateCandidates,
      ).toHaveLength(0);
    });
  });

  describe('isolamento entre tenants', () => {
    it('nao lista aluno de outro tenant', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Exclusivo Da Rede A' });
      const id = (criado.body as { id: string }).id;

      const resposta = await request(servidor())
        .get('/api/v1/students')
        .set('Cookie', contas.b.cookie);

      expect((resposta.body as { id: string }[]).map((a) => a.id)).not.toContain(id);
    });

    /** 404, nunca 403: 403 confirmaria que o recurso existe. */
    it('devolve 404 ao detalhar aluno de outro tenant', async () => {
      const criado = await criarAluno(contas.a);
      const id = (criado.body as { id: string }).id;

      const resposta = await request(servidor())
        .get(`/api/v1/students/${id}`)
        .set('Cookie', contas.b.cookie);

      expect(resposta.status).toBe(404);
    });

    it('recusa plano com unidade de outro tenant', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/plans')
        .set('Cookie', contas.a.cookie)
        .send({
          name: `Invasor ${sufixo}`,
          gymUnitIds: [contas.b.unidadeId],
          janelas: [
            {
              gymUnitId: contas.b.unidadeId,
              dayOfWeek: 1,
              startMinute: 360,
              endMinute: 1320,
            },
          ],
          amountMinor: 15000,
        });

      expect(resposta.status).toBe(422);
    });

    it('recusa assinatura para aluno de outro tenant', async () => {
      const criado = await criarAluno(contas.a);
      const planoDaRedeB = await criarPlano(contas.b);

      const resposta = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.b.cookie)
        .send({
          studentId: (criado.body as { id: string }).id,
          planId: planoDaRedeB,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-09-01T00:00:00.000Z',
          reason: 'teste de isolamento',
        });

      expect(resposta.status).toBe(404);
    });
  });

  describe('ciclo de vida do aluno', () => {
    it('recusa transicao invalida sem deixar rastro parcial', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Para Transicao' });
      const id = (criado.body as { id: string }).id;

      const eventosAntes = await db.studentTimelineEvent.count({ where: { studentId: id } });
      const outboxAntes = await db.outboxEvent.count({ where: { aggregateId: id } });

      // LEAD -> SUSPENDED nao esta na tabela de transicoes.
      const resposta = await request(servidor())
        .patch(`/api/v1/students/${id}/status`)
        .set('Cookie', contas.a.cookie)
        .send({ status: 'SUSPENDED', version: 0 });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('STUDENT_INVALID_TRANSITION');

      // Nada foi escrito: o erro sobe antes de a transacao comecar.
      expect(await db.studentTimelineEvent.count({ where: { studentId: id } })).toBe(
        eventosAntes,
      );
      expect(await db.outboxEvent.count({ where: { aggregateId: id } })).toBe(outboxAntes);
    });

    it('recusa comando com versao desatualizada', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Concorrencia Otimista' });
      const id = (criado.body as { id: string }).id;

      const primeira = await request(servidor())
        .patch(`/api/v1/students/${id}/status`)
        .set('Cookie', contas.a.cookie)
        .send({ status: 'ACTIVE', version: 0 });

      expect(primeira.status).toBe(200);

      // Mesma versao de novo: o estado ja mudou.
      const segunda = await request(servidor())
        .patch(`/api/v1/students/${id}/status`)
        .set('Cookie', contas.a.cookie)
        .send({ status: 'SUSPENDED', version: 0 });

      expect(segunda.status).toBe(404);
    });

    /** INV-013: arquivar preserva historico e suspende os direitos. */
    it('arquiva suspendendo entitlements e preservando a timeline', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Para Arquivar' });
      const id = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: id,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura para o teste de arquivamento',
        });

      const arquivar = await request(servidor())
        .patch(`/api/v1/students/${id}/status`)
        .set('Cookie', contas.a.cookie)
        .send({ status: 'ARCHIVED', version: 0 });

      expect(arquivar.status).toBe(200);
      expect((arquivar.body as { archivedAt: string | null }).archivedAt).not.toBeNull();

      const entitlements = await db.entitlement.findMany({ where: { studentId: id } });

      expect(entitlements).toHaveLength(1);
      expect(entitlements[0]!.status).toBe('SUSPENDED');

      // Historico preservado: arquivar nao apaga nada.
      expect(await db.studentTimelineEvent.count({ where: { studentId: id } })).toBeGreaterThan(
        0,
      );
      expect(await db.subscription.count({ where: { studentId: id } })).toBe(1);
    });

    /**
     * A JANELA DE CORRIDA que a rechecagem dentro da transacao fecha.
     *
     * A ativacao le o aluno antes de abrir a transacao. Se o arquivamento
     * acontecer entre a leitura e a escrita, sem o `FOR UPDATE` o
     * entitlement nasceria ACTIVE para um aluno ARCHIVED -- e o
     * `alterarStatus`, que suspende os direitos existentes, nao veria o que
     * ainda nao foi criado.
     *
     * O teste dispara as duas operacoes juntas. Qualquer ordem de commit e
     * aceitavel; o que NAO pode existir, em ordem nenhuma, e aluno arquivado
     * com direito ativo (INV-033).
     */
    it('nunca deixa aluno arquivado com entitlement ativo, mesmo sob corrida', async () => {
      const planId = await criarPlano(contas.a);

      // Varias rodadas: a corrida nao acontece toda vez, e uma unica
      // tentativa passaria verde por sorte.
      for (let rodada = 0; rodada < 8; rodada += 1) {
        const criado = await criarAluno(contas.a, { fullName: `Corrida ${rodada}` });
        const id = (criado.body as { id: string }).id;

        await Promise.allSettled([
          request(servidor())
            .post('/api/v1/subscriptions')
            .set('Cookie', contas.a.cookie)
            .send({
              studentId: id,
              planId,
              startsAt: '2026-08-01T00:00:00.000Z',
              endsAt: '2027-08-01T00:00:00.000Z',
              reason: 'ativacao concorrente ao arquivamento',
            }),
          request(servidor())
            .patch(`/api/v1/students/${id}/status`)
            .set('Cookie', contas.a.cookie)
            .send({ status: 'ARCHIVED', version: 0 }),
        ]);

        const aluno = await db.student.findUniqueOrThrow({ where: { id } });

        if (aluno.status === 'ARCHIVED') {
          const ativos = await db.entitlement.count({
            where: { studentId: id, status: { in: ['ACTIVE', 'SCHEDULED'] } },
          });

          expect(ativos).toBe(0);
        }
      }
    });

    it('recusa nova assinatura para aluno arquivado', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Arquivado Sem Assinatura' });
      const id = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      await request(servidor())
        .patch(`/api/v1/students/${id}/status`)
        .set('Cookie', contas.a.cookie)
        .send({ status: 'ARCHIVED', version: 0 });

      const resposta = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: id,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'nao deveria passar',
        });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('STUDENT_NOT_ELIGIBLE');
    });
  });

  describe('plano', () => {
    it('recusa janelas sobrepostas', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/plans')
        .set('Cookie', contas.a.cookie)
        .send({
          name: `Sobreposto ${sufixo}`,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 720 },
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 600, endMinute: 900 },
          ],
          amountMinor: 15000,
        });

      expect(resposta.status).toBe(422);
      expect((resposta.body as { code: string }).code).toBe('PLAN_INVALID_ACCESS_WINDOW');
    });

    it('recusa janela apontando para unidade fora do plano', async () => {
      const outra = await db.gymUnit.create({
        data: {
          tenantId: contas.a.tenantId,
          code: `EXTRA-${sufixo}`,
          name: 'Extra',
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });

      const resposta = await request(servidor())
        .post('/api/v1/plans')
        .set('Cookie', contas.a.cookie)
        .send({
          name: `Janela Orfa ${sufixo}`,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: outra.id, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
          ],
          amountMinor: 15000,
        });

      expect(resposta.status).toBe(422);
    });

    it('recusa plano sem preco', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/plans')
        .set('Cookie', contas.a.cookie)
        .send({
          name: `Sem Preco ${sufixo}`,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
          ],
        });

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('VALIDATION_FAILED');
    });

    it('recusa preco fracionario ou negativo', async () => {
      const fracionario = await request(servidor())
        .post('/api/v1/plans')
        .set('Cookie', contas.a.cookie)
        .send({
          name: `Preco Fracionario ${sufixo}`,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
          ],
          amountMinor: 150.5,
        });

      expect(fracionario.status).toBe(400);

      const negativo = await request(servidor())
        .post('/api/v1/plans')
        .set('Cookie', contas.a.cookie)
        .send({
          name: `Preco Negativo ${sufixo}`,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
          ],
          amountMinor: -100,
        });

      expect(negativo.status).toBe(400);
    });

    it('cria a primeira linha de preco na mesma transacao do plano', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/plans')
        .set('Cookie', contas.a.cookie)
        .send({
          name: `Com Preco ${sufixo}`,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
          ],
          amountMinor: 19900,
        });

      expect(resposta.status).toBe(201);

      const planId = (resposta.body as { id: string }).id;
      const precos = await db.planPrice.findMany({ where: { planId } });

      expect(precos).toHaveLength(1);
      expect(precos[0]!.amountMinor).toBe(19900);
      expect(precos[0]!.currency).toBe('BRL');
    });

    it('devolve o preco vigente e o historico de vigencias em GET /plans/:id', async () => {
      const planId = await criarPlano(contas.a);

      const resposta = await request(servidor())
        .get(`/api/v1/plans/${planId}`)
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as {
        currentPrice: { amountMinor: number; currency: string } | null;
        prices: { amountMinor: number; validFrom: string }[];
      };

      expect(corpo.currentPrice).not.toBeNull();
      expect(corpo.currentPrice!.amountMinor).toBe(15000);
      expect(corpo.prices).toHaveLength(1);
    });

    it('devolve o preco vigente na listagem GET /plans', async () => {
      await criarPlano(contas.a);

      const resposta = await request(servidor())
        .get('/api/v1/plans')
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as { currentPrice: { amountMinor: number } | null }[];

      expect(corpo.length).toBeGreaterThan(0);
      expect(corpo.every((p) => p.currentPrice !== null)).toBe(true);
    });
  });

  describe('ativacao de plano', () => {
    /**
     * PLANO NAO SE APAGA, SE DESATIVA (decisao do PI, 24/08/2026): apagar
     * deixaria invoice e timeline antigas citando um plano inexistente, e o
     * historico financeiro e auditado.
     */
    it('desativa o plano que ninguem esta usando', async () => {
      const planId = await criarPlano(contas.a);

      const resposta = await request(servidor())
        .patch(`/api/v1/plans/${planId}/activation`)
        .set('Cookie', contas.a.cookie)
        .send({ isActive: false });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { isActive: boolean }).isActive).toBe(false);
    });

    /**
     * A GUARDA QUE PROTEGE ACESSO: desativar plano com aluno usando o
     * tiraria da lista de escolha enquanto alguem ainda depende dele -- e a
     * recepcao descobriria na catraca, nao na tela.
     */
    it('recusa desativar plano com assinatura em vigor', async () => {
      const planId = await criarPlano(contas.a);
      const aluno = await criarAluno(contas.a, { fullName: 'Com Plano Ativo' });
      const alunoId = (aluno.body as { id: string }).id;

      await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-01-01T06:00:00.000Z',
          endsAt: '2027-01-01T22:00:00.000Z',
          reason: 'matricula de bancada',
        })
        .expect(201);

      const resposta = await request(servidor())
        .patch(`/api/v1/plans/${planId}/activation`)
        .set('Cookie', contas.a.cookie)
        .send({ isActive: false });

      expect(resposta.status).toBe(409);
      expect((resposta.body as { code: string }).code).toBe('PLAN_IN_USE');
    });

    /**
     * REATIVAR NUNCA E RECUSADO: devolver um plano a lista de escolha nao
     * tira acesso de ninguem. So o desligamento tem guarda.
     */
    it('reativa sem exigir nada, mesmo com assinatura', async () => {
      const planId = await criarPlano(contas.a);

      await request(servidor())
        .patch(`/api/v1/plans/${planId}/activation`)
        .set('Cookie', contas.a.cookie)
        .send({ isActive: false })
        .expect(200);

      const resposta = await request(servidor())
        .patch(`/api/v1/plans/${planId}/activation`)
        .set('Cookie', contas.a.cookie)
        .send({ isActive: true });

      expect(resposta.status).toBe(200);
      expect((resposta.body as { isActive: boolean }).isActive).toBe(true);
    });

    it('plano de outro tenant responde 404, exigindo o codigo', async () => {
      const planId = await criarPlano(contas.a);

      const resposta = await request(servidor())
        .patch(`/api/v1/plans/${planId}/activation`)
        .set('Cookie', contas.b.cookie)
        .send({ isActive: false });

      expect(resposta.status).toBe(404);
      expect((resposta.body as { code: string }).code).toBe('PLAN_NOT_FOUND');
    });
  });

  describe('reajuste de preco', () => {
    /**
     * O teste que fecha a lacuna da F53: plano criado pela API ja nasce
     * cobravel, sem precisar de seed nem passo manual no banco.
     */
    it('plano criado pela API ja nasce cobravel -- a cobranca funciona', async () => {
      await db.billingSettings.upsert({
        where: { tenantId: contas.a.tenantId },
        create: { tenantId: contas.a.tenantId, dueDay: 10, graceDays: 5 },
        update: {},
      });

      const criado = await criarAluno(contas.a, { fullName: 'Cobravel De Cara' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'plano nasce cobravel',
        });

      expect(assinatura.status).toBe(201);

      const billing = app.get(BillingRepository);
      const invoice = await billing.abrirInvoiceDoPeriodo(
        {
          tenantId: contas.a.tenantId,
          actorId: contas.a.userId,
          sessionId: randomUUID(),
          permissions: new Set(['subscription.manage']),
          allowedUnitIds: 'ALL',
        },
        {
          subscriptionId: (assinatura.body as { subscriptionId: string }).subscriptionId,
          // Competencia FUTURA em relacao ao relogio real: o plano nasce com
          // `validFrom = agora` (momento da criacao pela API), entao a
          // competencia cobrada precisa ser posterior a isso.
          emQue: new Date('2027-10-05T00:00:00.000Z'),
        },
      );

      expect(invoice.status).toBe('OPEN');
      expect(invoice.totalMinor).toBe(15000);
    });

    it('cria nova vigencia sem alterar invoice ja emitida (INV-068)', async () => {
      await db.billingSettings.upsert({
        where: { tenantId: contas.a.tenantId },
        create: { tenantId: contas.a.tenantId, dueDay: 10, graceDays: 5 },
        update: {},
      });

      const criado = await criarAluno(contas.a, { fullName: 'Reajuste Sem Efeito Retroativo' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura antes do reajuste',
        });

      const billing = app.get(BillingRepository);
      const contexto = {
        tenantId: contas.a.tenantId,
        actorId: contas.a.userId,
        sessionId: randomUUID(),
        permissions: new Set(['subscription.manage']),
        allowedUnitIds: 'ALL' as const,
      };

      // Competencias FUTURAS em relacao ao relogio real: o plano nasce com
      // `validFrom = agora` (momento da criacao pela API).
      const invoiceDeOutubro = await billing.abrirInvoiceDoPeriodo(contexto, {
        subscriptionId: (assinatura.body as { subscriptionId: string }).subscriptionId,
        emQue: new Date('2027-10-05T00:00:00.000Z'),
      });

      expect(invoiceDeOutubro.totalMinor).toBe(15000);

      // Reajuste com vigencia em novembro -- nao pode tocar a invoice de
      // outubro, ja aberta e com valor congelado.
      const reajuste = await request(servidor())
        .post(`/api/v1/plans/${planId}/prices`)
        .set('Cookie', contas.a.cookie)
        .send({ amountMinor: 18000, validFrom: '2027-11-01T00:00:00.000Z' });

      expect(reajuste.status).toBe(201);

      const invoiceDeOutubroDeNovo = await db.invoice.findUniqueOrThrow({
        where: { id: invoiceDeOutubro.id },
      });

      expect(invoiceDeOutubroDeNovo.totalMinor).toBe(15000);

      const invoiceDeNovembro = await billing.abrirInvoiceDoPeriodo(contexto, {
        subscriptionId: (assinatura.body as { subscriptionId: string }).subscriptionId,
        emQue: new Date('2027-11-05T00:00:00.000Z'),
      });

      expect(invoiceDeNovembro.totalMinor).toBe(18000);

      const precos = await db.planPrice.findMany({
        where: { planId },
        orderBy: { validFrom: 'asc' },
      });

      expect(precos).toHaveLength(2);
    });

    it('validFrom duplicado responde 409 com codigo estavel, nao 500', async () => {
      const planId = await criarPlano(contas.a);

      const primeiro = await request(servidor())
        .post(`/api/v1/plans/${planId}/prices`)
        .set('Cookie', contas.a.cookie)
        .send({ amountMinor: 18000, validFrom: '2026-09-01T00:00:00.000Z' });

      expect(primeiro.status).toBe(201);

      const duplicado = await request(servidor())
        .post(`/api/v1/plans/${planId}/prices`)
        .set('Cookie', contas.a.cookie)
        .send({ amountMinor: 20000, validFrom: '2026-09-01T00:00:00.000Z' });

      expect(duplicado.status).toBe(409);
      expect((duplicado.body as { code: string }).code).toBe('PLAN_PRICE_VALID_FROM_TAKEN');
    });

    /**
     * Decisao registrada no relatorio da fatia: reajuste retroativo e
     * RECUSADO. `validFrom` no passado mudaria o preco de competencias que
     * ainda nao foram cobradas sem o operador escolher isso de proposito --
     * o "agora" so entra por parametro no caso de uso, nunca dentro da
     * regra, e e ele que decide o corte.
     */
    it('recusa reajuste com validFrom no passado', async () => {
      const planId = await criarPlano(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/plans/${planId}/prices`)
        .set('Cookie', contas.a.cookie)
        .send({ amountMinor: 18000, validFrom: '2020-01-01T00:00:00.000Z' });

      expect(resposta.status).toBe(422);
      expect((resposta.body as { code: string }).code).toBe('PLAN_PRICE_RETROACTIVE');
    });

    /**
     * FRONTEIRA do retroativo: HOJE nao e passado.
     *
     * A comparacao era instante contra instante, e `validFrom` vem de um
     * `<input type="date">` -- ou seja, meia-noite. Depois das 00:00:01 o
     * proprio dia corrente caia como "retroativo", e a recepcao nao
     * conseguia dar preco vigente hoje ao plano: so a partir de amanha.
     *
     * O teste acima nao pegava isso porque usa passado distante (2020) --
     * qualquer uma das duas comparacoes o recusa. So a data de hoje separa
     * a regra certa da errada.
     */
    it('aceita reajuste com validFrom hoje -- hoje nao e passado', async () => {
      const planId = await criarPlano(contas.a);

      const hoje = new Date();
      const meiaNoiteDeHoje = new Date(
        Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()),
      );

      const resposta = await request(servidor())
        .post(`/api/v1/plans/${planId}/prices`)
        .set('Cookie', contas.a.cookie)
        .send({ amountMinor: 18000, validFrom: meiaNoiteDeHoje.toISOString() });

      expect(resposta.status).toBe(201);
    });

    it('plano de outro tenant responde 404 ao reajustar, exigindo o codigo', async () => {
      const planId = await criarPlano(contas.a);

      const resposta = await request(servidor())
        .post(`/api/v1/plans/${planId}/prices`)
        .set('Cookie', contas.b.cookie)
        .send({ amountMinor: 18000, validFrom: '2026-09-01T00:00:00.000Z' });

      expect(resposta.status).toBe(404);
      expect((resposta.body as { code: string }).code).toBe('PLAN_NOT_FOUND');
    });
  });

  describe('derivacao de entitlement', () => {
    /** INV-062 e regra de arquitetura no 1. */
    it('deriva entitlement da assinatura na mesma transacao, com snapshot', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Com Assinatura' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const resposta = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'matricula presencial na recepcao',
        });

      expect(resposta.status).toBe(201);

      const corpo = resposta.body as {
        subscriptionId: string;
        entitlement: { status: string; source: string; janelas: unknown[] };
      };

      expect(corpo.entitlement.status).toBe('ACTIVE');
      expect(corpo.entitlement.source).toBe('SUBSCRIPTION');
      expect(corpo.entitlement.janelas).toHaveLength(5);

      // O snapshot foi congelado no banco.
      const gravado = await db.entitlement.findFirstOrThrow({
        where: { subscriptionId: corpo.subscriptionId },
      });

      expect((gravado.policySnapshot as { planId: string }).planId).toBe(planId);
      expect((gravado.policySnapshot as { snapshotVersion: number }).snapshotVersion).toBe(1);

      // Os dois eventos de dominio sairam na mesma transacao (INV-084).
      const eventos = await db.outboxEvent.findMany({
        where: { aggregateId: { in: [corpo.subscriptionId, gravado.id] } },
      });

      expect(eventos.map((e) => e.eventType).sort()).toEqual([
        'EntitlementActivated',
        'SubscriptionActivated',
      ]);
    });

    /**
     * O snapshot e imutavel: editar o plano depois NAO altera o direito ja
     * concedido. E o que impede reescrever retroativamente quem podia entrar.
     */
    it('mantem o snapshot intacto quando o plano muda depois', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Snapshot Congelado' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'para testar o snapshot',
        });

      const entitlementId = (assinatura.body as { entitlement: { id: string } }).entitlement.id;

      await db.planAccessWindow.deleteMany({ where: { planId } });
      await db.plan.update({ where: { id: planId }, data: { name: 'Nome Trocado' } });

      const depois = await db.entitlement.findUniqueOrThrow({ where: { id: entitlementId } });
      const janelas = await db.entitlementUnitWindow.count({ where: { entitlementId } });

      expect((depois.policySnapshot as { planName: string }).planName).not.toBe('Nome Trocado');
      expect(janelas).toBe(5);
    });

    it('pausa e retoma propagando ao entitlement', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Pausa E Retoma' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const subscriptionId = (assinatura.body as { subscriptionId: string }).subscriptionId;

      const pausar = await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionId}/actions`)
        .set('Cookie', contas.a.cookie)
        .send({ action: 'PAUSE', version: 0, reason: 'viagem do aluno' });

      expect(pausar.status).toBe(201);

      const suspenso = await db.entitlement.findFirstOrThrow({ where: { subscriptionId } });
      expect(suspenso.status).toBe('SUSPENDED');
      expect(suspenso.suspendedAt).not.toBeNull();

      const retomar = await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionId}/actions`)
        .set('Cookie', contas.a.cookie)
        .send({ action: 'RESUME', version: 1, reason: 'aluno voltou' });

      expect(retomar.status).toBe(201);

      const reativado = await db.entitlement.findFirstOrThrow({ where: { subscriptionId } });
      expect(reativado.status).toBe('ACTIVE');
      expect(reativado.suspendedAt).toBeNull();
    });

    it('cancela revogando o entitlement', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Para Cancelar' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const subscriptionId = (assinatura.body as { subscriptionId: string }).subscriptionId;

      await request(servidor())
        .post(`/api/v1/subscriptions/${subscriptionId}/actions`)
        .set('Cookie', contas.a.cookie)
        .send({ action: 'CANCEL', version: 0, reason: 'aluno desistiu' });

      const revogado = await db.entitlement.findFirstOrThrow({ where: { subscriptionId } });

      expect(revogado.status).toBe('REVOKED');
      expect(revogado.revokedAt).not.toBeNull();
    });

    it('exige razao em toda alteracao de assinatura', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Sem Razao' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura inicial',
        });

      const resposta = await request(servidor())
        .post(
          `/api/v1/subscriptions/${(assinatura.body as { subscriptionId: string }).subscriptionId}/actions`,
        )
        .set('Cookie', contas.a.cookie)
        .send({ action: 'PAUSE', version: 0 });

      expect(resposta.status).toBe(400);
    });
  });

  describe('cortesia', () => {
    /** INV-063: razao, responsavel e validade. */
    it('concede cortesia com razao e responsavel, sem assinatura', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Com Cortesia' });
      const alunoId = (criado.body as { id: string }).id;

      const resposta = await request(servidor())
        .post('/api/v1/entitlements/courtesy')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
          ],
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-08-08T00:00:00.000Z',
          reason: 'aula experimental oferecida pela gerencia',
        });

      expect(resposta.status).toBe(201);

      const corpo = resposta.body as {
        source: string;
        subscriptionId: string | null;
        reason: string;
      };

      expect(corpo.source).toBe('COURTESY');
      expect(corpo.subscriptionId).toBeNull();
      expect(corpo.reason).toContain('aula experimental');

      const gravado = await db.entitlement.findFirstOrThrow({
        where: { studentId: alunoId, source: 'COURTESY' },
      });

      expect(gravado.grantedById).not.toBeNull();
    });

    it('recusa cortesia sem razao', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Cortesia Sem Razao' });

      const resposta = await request(servidor())
        .post('/api/v1/entitlements/courtesy')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: (criado.body as { id: string }).id,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 },
          ],
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-08-08T00:00:00.000Z',
        });

      expect(resposta.status).toBe(400);
    });

    /**
     * Cortesia sobreposta NAO altera o direito normal: sao independentes, e
     * o motor de F9 resolve pela regra mais restritiva (INV-034).
     */
    it('nao altera silenciosamente um entitlement normal sobreposto', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Dois Direitos' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      const assinatura = await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'assinatura normal',
        });

      const normalId = (assinatura.body as { entitlement: { id: string } }).entitlement.id;

      await request(servidor())
        .post('/api/v1/entitlements/courtesy')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          gymUnitIds: [contas.a.unidadeId],
          janelas: [
            { gymUnitId: contas.a.unidadeId, dayOfWeek: 6, startMinute: 480, endMinute: 720 },
          ],
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-08-08T00:00:00.000Z',
          reason: 'sabado de cortesia',
        });

      const normal = await db.entitlement.findUniqueOrThrow({ where: { id: normalId } });

      expect(normal.status).toBe('ACTIVE');
      expect(await db.entitlement.count({ where: { studentId: alunoId } })).toBe(2);
    });
  });

  describe('timeline', () => {
    it('devolve eventos do aluno em ordem decrescente com cursor', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Com Timeline' });
      const alunoId = (criado.body as { id: string }).id;
      const planId = await criarPlano(contas.a);

      await request(servidor())
        .post('/api/v1/subscriptions')
        .set('Cookie', contas.a.cookie)
        .send({
          studentId: alunoId,
          planId,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2027-08-01T00:00:00.000Z',
          reason: 'para a timeline',
        });

      const primeira = await request(servidor())
        .get(`/api/v1/students/${alunoId}/timeline?limit=2`)
        .set('Cookie', contas.a.cookie);

      expect(primeira.status).toBe(200);

      const corpo = primeira.body as {
        items: { id: string; type: string }[];
        nextCursor: string | null;
      };

      expect(corpo.items).toHaveLength(2);
      expect(corpo.nextCursor).not.toBeNull();

      const segunda = await request(servidor())
        .get(`/api/v1/students/${alunoId}/timeline?limit=2&cursor=${corpo.nextCursor}`)
        .set('Cookie', contas.a.cookie);

      const idsPrimeira = corpo.items.map((i) => i.id);
      const idsSegunda = (segunda.body as { items: { id: string }[] }).items.map((i) => i.id);

      // Sem repeticao entre paginas: o cursor `(occurredAt, id)` desempata
      // eventos gravados no mesmo instante pela mesma transacao.
      expect(idsSegunda.filter((id) => idsPrimeira.includes(id))).toHaveLength(0);
    });

    it('nao devolve timeline de aluno de outro tenant', async () => {
      const criado = await criarAluno(contas.a, { fullName: 'Timeline Privada' });

      const resposta = await request(servidor())
        .get(`/api/v1/students/${(criado.body as { id: string }).id}/timeline`)
        .set('Cookie', contas.b.cookie);

      expect((resposta.body as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  describe('permissoes', () => {
    it('recusa criacao de aluno sem permissao', async () => {
      const senhas = app.get(PasswordService);

      const user = await db.user.create({
        data: {
          email: `sem-permissao-${sufixo}@exemplo.test`,
          passwordHash: await senhas.gerarHash(SENHA),
        },
      });

      await db.tenantMembership.create({
        data: { tenantId: contas.a.tenantId, userId: user.id },
      });

      const papel = await db.role.create({
        data: { tenantId: contas.a.tenantId, name: `VISITANTE-${sufixo}` },
      });

      await db.userRole.create({
        data: { tenantId: contas.a.tenantId, userId: user.id, roleId: papel.id },
      });

      const login = await request(servidor())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: SENHA });

      const resposta = await request(servidor())
        .post('/api/v1/students')
        .set('Cookie', cookieDeAcesso(login))
        .send({ fullName: 'Nao Deveria Entrar', birthDate: '2000-01-01', contacts: [] });

      expect(resposta.status).toBe(403);
    });
  });
});
