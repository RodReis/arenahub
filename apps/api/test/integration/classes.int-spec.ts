import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F77 (SPEC-077, ADR-061) -- agenda de aulas, provada pela porta da frente.
 *
 * Aceite operacional (SPEC-077 §5): a recepcao cadastra a grade de uma
 * semana real, ve a semana com professor e capacidade, cancela UMA
 * ocorrencia sem perder a grade, e troca o professor de UM dia sem alterar
 * os outros.
 */
describe('F77 -- agenda de aulas', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const conta = {
    email: `f77-a-${sufixo}@exemplo.test`,
    tenantId: '',
    userId: '',
    unidadeId: '',
    cookie: '',
  };

  const outraConta = {
    email: `f77-b-${sufixo}@exemplo.test`,
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

  /** Cria um `Student` com `profile = TRAINER` direto no banco. */
  const criarProfessor = async (alvo: typeof conta, nome: string): Promise<string> => {
    const professor = await db.student.create({
      data: {
        tenantId: alvo.tenantId,
        membershipNumber: `AP-2026-${randomUUID().slice(0, 8)}`,
        fullName: nome,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        cpf: gerarCpfValido(),
        gymUnitId: alvo.unidadeId,
        profile: 'TRAINER',
      },
    });

    return professor.id;
  };

  const criarModalidade = async (alvo: typeof conta, name: string): Promise<string> => {
    const resposta = await request(servidor())
      .post(`/api/v1/units/${alvo.unidadeId}/modalities`)
      .set('Cookie', alvo.cookie)
      .send({ name });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(PrismaService);

    await montarAcademia(conta, `f77-rede-a-${sufixo}`);
    await montarAcademia(outraConta, `f77-rede-b-${sufixo}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('cadastra a grade, ve a semana com professor e capacidade', async () => {
    const modalityId = await criarModalidade(conta, `Cross Fit ${randomUUID().slice(0, 6)}`);
    const trainerId = await criarProfessor(conta, 'Professor Um');

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        trainerId,
        dayOfWeek: 2,
        startMinute: 420,
        durationMinutes: 60,
        capacity: 15,
      });

    expect(resposta.status).toBe(201);
    const corpo = resposta.body as {
      id: string;
      trainerId: string;
      capacity: number;
      isActive: boolean;
    };
    expect(corpo.trainerId).toBe(trainerId);
    expect(corpo.capacity).toBe(15);
    expect(corpo.isActive).toBe(true);

    const semana = await request(servidor())
      .get(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie);

    expect(semana.status).toBe(200);
    expect((semana.body as { id: string }[]).some((a) => a.id === corpo.id)).toBe(true);
  });

  it('aceita aula sem professor definido -- quadra alugada', async () => {
    const modalityId = await criarModalidade(conta, `Quadra ${randomUUID().slice(0, 6)}`);

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        dayOfWeek: 6,
        startMinute: 600,
        durationMinutes: 120,
        capacity: 4,
      });

    expect(resposta.status).toBe(201);
    expect((resposta.body as { trainerId: string | null }).trainerId).toBeNull();
  });

  it('recusa aula que atravessa a virada do dia', async () => {
    const modalityId = await criarModalidade(conta, `Noturna ${randomUUID().slice(0, 6)}`);

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        dayOfWeek: 5,
        startMinute: 1410,
        durationMinutes: 90,
        capacity: 10,
      });

    expect(resposta.status).toBe(422);
    expect((resposta.body as { code: string }).code).toBe('CLASS_SCHEDULE_INVALID');
  });

  it('cancela uma ocorrencia sem desfazer a grade', async () => {
    const modalityId = await criarModalidade(conta, `Box ${randomUUID().slice(0, 6)}`);
    const trainerId = await criarProfessor(conta, 'Professor Cancelamento');

    const criada = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        trainerId,
        dayOfWeek: 3,
        startMinute: 480,
        durationMinutes: 60,
        capacity: 12,
      });

    const classId = (criada.body as { id: string }).id;

    const cancelamento = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${classId}/exceptions`)
      .set('Cookie', conta.cookie)
      .send({ occurrenceDate: '2026-09-23', type: 'CANCELLED' });

    expect(cancelamento.status).toBe(201);

    // A grade em si continua existindo e ativa -- so a ocorrencia sumiu.
    const grade = await request(servidor())
      .get(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie);

    const aindaExiste = (grade.body as { id: string; isActive: boolean }[]).find(
      (a) => a.id === classId,
    );
    expect(aindaExiste?.isActive).toBe(true);

    const excecoes = await request(servidor())
      .get(`/api/v1/units/${conta.unidadeId}/classes/${classId}/exceptions`)
      .set('Cookie', conta.cookie);

    expect(excecoes.status).toBe(200);
    expect((excecoes.body as { type: string }[]).map((e) => e.type)).toEqual(['CANCELLED']);
  });

  it('troca o professor de um dia especifico sem alterar os outros', async () => {
    const modalityId = await criarModalidade(conta, `Cross ${randomUUID().slice(0, 6)}`);
    const trainerTitular = await criarProfessor(conta, 'Professor Titular');
    const trainerSubstituto = await criarProfessor(conta, 'Professor Substituto');

    const criada = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        trainerId: trainerTitular,
        dayOfWeek: 4,
        startMinute: 420,
        durationMinutes: 60,
        capacity: 20,
      });

    const classId = (criada.body as { id: string }).id;

    const troca = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${classId}/exceptions`)
      .set('Cookie', conta.cookie)
      .send({
        occurrenceDate: '2026-09-24',
        type: 'TRAINER_OVERRIDE',
        overrideTrainerId: trainerSubstituto,
      });

    expect(troca.status).toBe(201);
    expect((troca.body as { overrideTrainerId: string }).overrideTrainerId).toBe(
      trainerSubstituto,
    );

    // A grade continua com o titular -- so aquele dia mudou.
    const grade = await request(servidor())
      .get(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie);

    const aula = (grade.body as { id: string; trainerId: string }[]).find(
      (a) => a.id === classId,
    );
    expect(aula?.trainerId).toBe(trainerTitular);
  });

  it('recusa duas excecoes para a mesma aula no mesmo dia', async () => {
    const modalityId = await criarModalidade(conta, `Duplicidade ${randomUUID().slice(0, 6)}`);

    const criada = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        dayOfWeek: 1,
        startMinute: 480,
        durationMinutes: 60,
        capacity: 10,
      });

    const classId = (criada.body as { id: string }).id;

    await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${classId}/exceptions`)
      .set('Cookie', conta.cookie)
      .send({ occurrenceDate: '2026-09-28', type: 'CANCELLED' });

    const segunda = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes/${classId}/exceptions`)
      .set('Cookie', conta.cookie)
      .send({ occurrenceDate: '2026-09-28', type: 'CANCELLED' });

    expect(segunda.status).toBe(409);
    expect((segunda.body as { code: string }).code).toBe('CLASS_EXCEPTION_ALREADY_EXISTS');
  });

  it('recusa professor que nao e TRAINER neste tenant', async () => {
    const modalityId = await criarModalidade(conta, `Invalido ${randomUUID().slice(0, 6)}`);

    // Aluno comum (profile default STUDENT), nao professor.
    const alunoComum = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno Comum',
        birthDate: '2000-01-01',
        gymUnitId: conta.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    const resposta = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        trainerId: (alunoComum.body as { id: string }).id,
        dayOfWeek: 1,
        startMinute: 480,
        durationMinutes: 60,
        capacity: 10,
      });

    expect(resposta.status).toBe(422);
    expect((resposta.body as { code: string }).code).toBe('TRAINER_INVALID');
  });

  it('inativa a aula sem apagar -- some da grade nova, historico permanece', async () => {
    const modalityId = await criarModalidade(conta, `Inativacao ${randomUUID().slice(0, 6)}`);

    const criada = await request(servidor())
      .post(`/api/v1/units/${conta.unidadeId}/classes`)
      .set('Cookie', conta.cookie)
      .send({
        gymUnitId: conta.unidadeId,
        modalityId,
        dayOfWeek: 0,
        startMinute: 540,
        durationMinutes: 60,
        capacity: 8,
      });

    const classId = (criada.body as { id: string }).id;

    const inativada = await request(servidor())
      .patch(`/api/v1/units/${conta.unidadeId}/classes/${classId}/activation`)
      .set('Cookie', conta.cookie)
      .send({ isActive: false });

    expect(inativada.status).toBe(200);
    expect((inativada.body as { isActive: boolean }).isActive).toBe(false);

    const aindaNoBanco = await db.class.findUnique({ where: { id: classId } });
    expect(aindaNoBanco).not.toBeNull();
  });

  it('recusa acesso a aula de outro tenant', async () => {
    const modalityDaB = await criarModalidade(outraConta, `Isolada ${randomUUID().slice(0, 6)}`);

    const criada = await request(servidor())
      .post(`/api/v1/units/${outraConta.unidadeId}/classes`)
      .set('Cookie', outraConta.cookie)
      .send({
        gymUnitId: outraConta.unidadeId,
        modalityId: modalityDaB,
        dayOfWeek: 1,
        startMinute: 480,
        durationMinutes: 60,
        capacity: 10,
      });

    const classId = (criada.body as { id: string }).id;

    const resposta = await request(servidor())
      .patch(`/api/v1/units/${outraConta.unidadeId}/classes/${classId}/activation`)
      .set('Cookie', conta.cookie)
      .send({ isActive: false });

    expect(resposta.status).toBe(404);
  });

  it('GET /students/trainers lista so Student com profile TRAINER da unidade', async () => {
    const trainerId = await criarProfessor(conta, 'Professor Listado');

    const alunoComum = await request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno Nao Professor',
        birthDate: '2000-01-01',
        gymUnitId: conta.unidadeId,
        cpf: gerarCpfValido(),
        contacts: [],
      });

    expect(alunoComum.status).toBe(201);

    const resposta = await request(servidor())
      .get(`/api/v1/students/trainers?gymUnitId=${conta.unidadeId}`)
      .set('Cookie', conta.cookie);

    expect(resposta.status).toBe(200);
    const ids = (resposta.body as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(trainerId);
    expect(ids).not.toContain((alunoComum.body as { id: string }).id);
  });
});
