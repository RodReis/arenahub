import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F78 (SPEC-078, ADR-061/062) -- reserva, presenca e aulas inclusas no
 * plano, provada pela porta da frente.
 *
 * Mesmo padrao de helpers inline de `classes.int-spec.ts` (F77): nao existe
 * `helpers/agenda.ts` compartilhado no repo real.
 */
describe('F78 -- reserva, presenca e aulas inclusas no plano', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = {
    email: `f78-a-${sufixo}@exemplo.test`,
    tenantId: '',
    userId: '',
    unidadeId: '',
    cookie: '',
  };

  const outraConta = {
    email: `f78-b-${sufixo}@exemplo.test`,
    tenantId: '',
    userId: '',
    unidadeId: '',
    cookie: '',
  };

  const PERMISSOES = [
    'student.create',
    'student.read',
    'unit.read',
    'unit.update',
    'class.manage',
    'class.read',
  ];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (alvo: typeof conta, slug: string): Promise<void> => {
    const senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
    });

    const user = await db.user.create({
      data: { email: alvo.email, passwordHash: await senhas.gerarHash(SENHA) },
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
      .send({ email: alvo.email, password: SENHA });

    alvo.tenantId = tenant.id;
    alvo.userId = user.id;
    alvo.unidadeId = unidade.id;
    alvo.cookie = cookieDeAcesso(login);
  };

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

  const criarModalidade = async (alvo: typeof conta, name: string): Promise<{ id: string }> => {
    const resposta = await request(servidor())
      .post(`/api/v1/units/${alvo.unidadeId}/modalities`)
      .set('Cookie', alvo.cookie)
      .send({ name: `${name} ${randomUUID().slice(0, 6)}` });

    expect(resposta.status).toBe(201);

    return { id: (resposta.body as { id: string }).id };
  };

  /**
   * Cria `Student` "aluno comum" + `Plan` (`AVULSO`) + `Subscription`
   * `ACTIVE` ligando os dois. Se `modalityId` for passado, cria tambem o
   * `PlanClassEntitlement` -- sem ele o plano fica sem nenhum, e a regra
   * "lista vazia autoriza tudo" (`domain/entitlement.ts`) libera qualquer
   * modalidade.
   */
  const criarAlunoComAssinatura = async (
    alvo: typeof conta,
    modalityId?: string,
  ): Promise<{ id: string }> => {
    const aluno = await db.student.create({
      data: {
        tenantId: alvo.tenantId,
        gymUnitId: alvo.unidadeId,
        membershipNumber: `F78-${randomUUID().slice(0, 8)}`,
        fullName: 'Aluno de teste',
        birthDate: new Date('2000-01-01T00:00:00Z'),
        status: 'ACTIVE',
        cpf: gerarCpfValido(),
      },
      select: { id: true },
    });

    const plano = await db.plan.create({
      data: {
        tenantId: alvo.tenantId,
        name: `Plano ${randomUUID().slice(0, 6)}`,
        billingMode: 'AVULSO',
      },
      select: { id: true },
    });

    if (modalityId) {
      await db.planClassEntitlement.create({
        data: { tenantId: alvo.tenantId, planId: plano.id, modalityId },
      });
    }

    await db.subscription.create({
      data: {
        tenantId: alvo.tenantId,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    return aluno;
  };

  const criarAula = async (
    alvo: typeof conta,
    modalityId: string,
    dados: { dayOfWeek: number; startMinute: number; capacity: number },
  ): Promise<{ id: string }> => {
    const resposta = await request(servidor())
      .post(`/api/v1/units/${alvo.unidadeId}/classes`)
      .set('Cookie', alvo.cookie)
      .send({
        gymUnitId: alvo.unidadeId,
        modalityId,
        dayOfWeek: dados.dayOfWeek,
        startMinute: dados.startMinute,
        durationMinutes: 60,
        capacity: dados.capacity,
      });

    expect(resposta.status).toBe(201);

    return { id: (resposta.body as { id: string }).id };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(conta, `f78-rede-a-${sufixo}`);
    await montarAcademia(outraConta, `f78-rede-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reserva um aluno numa aula cuja modalidade esta incluida no plano dele', async () => {
    const modalidade = await criarModalidade(conta, 'Yoga');
    const aula = await criarAula(conta, modalidade.id, {
      dayOfWeek: 1,
      startMinute: 480,
      capacity: 10,
    });
    const aluno = await criarAlunoComAssinatura(conta, modalidade.id);

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: aluno.id, occurrenceDate: '2026-09-28' });

    expect(resposta.status).toBe(201);
    const corpo = resposta.body as { status: string; overriddenById: string | null };
    expect(corpo.status).toBe('RESERVED');
    expect(corpo.overriddenById).toBeNull();
  });

  it('marca presenca de quem veio e falta de quem reservou e nao apareceu', async () => {
    const modalidade = await criarModalidade(conta, 'Cross');
    const aula = await criarAula(conta, modalidade.id, {
      dayOfWeek: 2,
      startMinute: 600,
      capacity: 10,
    });

    const veio = await criarAlunoComAssinatura(conta, modalidade.id);
    const faltou = await criarAlunoComAssinatura(conta, modalidade.id);

    for (const aluno of [veio, faltou]) {
      const reserva = await request(servidor())
        .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
        .set('Cookie', conta.cookie)
        .send({ studentId: aluno.id, occurrenceDate: '2026-09-29' });

      expect(reserva.status).toBe(201);
    }

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/attendance`)
      .set('Cookie', conta.cookie)
      .send({ occurrenceDate: '2026-09-29', presentStudentIds: [veio.id] });

    expect(resposta.status).toBe(201);

    const porAluno = new Map(
      (resposta.body as { studentId: string; status: string }[]).map((r) => [
        r.studentId,
        r.status,
      ]),
    );
    expect(porAluno.get(veio.id)).toBe('PRESENT');
    expect(porAluno.get(faltou.id)).toBe('NO_SHOW');
  });

  it('recusa reserva quando a modalidade da aula nao esta no plano do aluno', async () => {
    const modalidadeDaAula = await criarModalidade(conta, 'Pilates');
    const outraModalidade = await criarModalidade(conta, 'Natacao');
    const aula = await criarAula(conta, modalidadeDaAula.id, {
      dayOfWeek: 3,
      startMinute: 420,
      capacity: 10,
    });

    // Plano do aluno so inclui `outraModalidade` -- lista NAO vazia, entao
    // restringe (`domain/entitlement.ts`).
    const aluno = await criarAlunoComAssinatura(conta, outraModalidade.id);

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: aluno.id, occurrenceDate: '2026-09-30' });

    expect(resposta.status).toBe(422);
    expect((resposta.body as { code: string }).code).toBe('CLASS_NOT_INCLUDED_IN_PLAN');
  });

  it('aceita a reserva fora do plano quando overriddenById e enviado', async () => {
    const modalidadeDaAula = await criarModalidade(conta, 'Spinning');
    const outraModalidade = await criarModalidade(conta, 'Judo');
    const aula = await criarAula(conta, modalidadeDaAula.id, {
      dayOfWeek: 4,
      startMinute: 420,
      capacity: 10,
    });

    const aluno = await criarAlunoComAssinatura(conta, outraModalidade.id);

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({
        studentId: aluno.id,
        occurrenceDate: '2026-10-01',
        overriddenById: conta.userId,
      });

    expect(resposta.status).toBe(201);
    const corpo = resposta.body as { status: string; overriddenById: string | null };
    expect(corpo.status).toBe('RESERVED');
    expect(corpo.overriddenById).toBe(conta.userId);
  });

  it('recusa a reserva quando a capacidade da aula ja esta esgotada', async () => {
    const modalidade = await criarModalidade(conta, 'Lotada');
    const aula = await criarAula(conta, modalidade.id, {
      dayOfWeek: 5,
      startMinute: 420,
      capacity: 1,
    });

    const primeiro = await criarAlunoComAssinatura(conta, modalidade.id);
    const segundo = await criarAlunoComAssinatura(conta, modalidade.id);

    const primeiraReserva = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: primeiro.id, occurrenceDate: '2026-10-02' });

    expect(primeiraReserva.status).toBe(201);

    const segundaReserva = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: segundo.id, occurrenceDate: '2026-10-02' });

    expect(segundaReserva.status).toBe(409);
    expect((segundaReserva.body as { code: string }).code).toBe('CLASS_FULL');
  });

  it('cancela uma reserva e reserva de novo na mesma ocorrencia, reabrindo a mesma linha', async () => {
    const modalidade = await criarModalidade(conta, 'Reabertura');
    const aula = await criarAula(conta, modalidade.id, {
      dayOfWeek: 6,
      startMinute: 420,
      capacity: 5,
    });

    const aluno = await criarAlunoComAssinatura(conta, modalidade.id);

    const primeiraReserva = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: aluno.id, occurrenceDate: '2026-10-03' });

    expect(primeiraReserva.status).toBe(201);
    const reservationId = (primeiraReserva.body as { id: string }).id;

    const cancelamento = await request(servidor())
      .patch(
        `/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations/${reservationId}/cancel`,
      )
      .set('Cookie', conta.cookie);

    expect(cancelamento.status).toBe(200);
    expect((cancelamento.body as { status: string }).status).toBe('CANCELLED');

    const novaReserva = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${aula.id}/reservations`)
      .set('Cookie', conta.cookie)
      .send({ studentId: aluno.id, occurrenceDate: '2026-10-03' });

    expect(novaReserva.status).toBe(201);
    expect((novaReserva.body as { id: string }).id).toBe(reservationId);
    expect((novaReserva.body as { status: string }).status).toBe('RESERVED');
  });
});
