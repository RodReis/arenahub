import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F45 -- cadastro completo de aluno, provado pela porta da frente.
 *
 * O que este arquivo prova, item a item do criterio de aceite da issue #100:
 *
 *   - cadastro com nome, nascimento e unidade gera matricula;
 *   - endereco e contato de emergencia persistem e voltam no `GET`;
 *   - edicao respeita `version` (trava otimista);
 *   - unidade de outro tenant e recusada -- aluno nao muda de academia;
 *   - duplicata continua AVISANDO, nao bloqueando (INV-014);
 *   - CPF completo persiste e volta na resposta (ADR-034).
 *
 * A prova de que `gym_unit_id` NAO entra na decisao de acesso e estrutural e
 * mora em `src/modules/access/gym-unit-nao-decide-acesso.spec.ts`: teste de
 * comportamento so pegaria esse defeito com um cenario que ninguem lembra de
 * escrever -- aluno cuja unidade de origem diverge do plano.
 */
/**
 * Forma do que a API devolve, declarada aqui de proposito.
 *
 * `supertest` tipa `response.body` como `any`, e `any` faz o teste passar
 * mesmo quando o campo deixa de existir: `body.gymUnitId` viraria `undefined`
 * e o `expect` compararia `undefined` com `undefined` em silencio. Com o tipo
 * declarado, tirar um campo do DTO quebra a COMPILACAO do teste.
 */
interface CorpoDeAluno {
  id: string;
  membershipNumber: string;
  fullName: string;
  cpf: string | null;
  rg: string | null;
  registeredSex: string | null;
  leadSource: string | null;
  gymUnitId: string;
  version: number;
  code?: string;
  duplicateCandidates?: { studentId: string; motivo: string }[];
}

/** `GET /students/:id`: sempre traz contatos e endereco. */
interface FichaDeAluno extends CorpoDeAluno {
  contacts: { type: string; value: string; label: string | null; relationship: string | null }[];
  address: {
    postalCode: string;
    street: string;
    number: string | null;
    city: string;
    state: string;
  } | null;
}

/** `response.body` com a forma acima. */
function corpo(resposta: request.Response): CorpoDeAluno {
  return resposta.body as CorpoDeAluno;
}

/** A ficha completa, do `GET /students/:id`. */
function ficha(resposta: request.Response): FichaDeAluno {
  return resposta.body as FichaDeAluno;
}

/** Listagem: o `GET /students` devolve um array. */
function lista(resposta: request.Response): CorpoDeAluno[] {
  return resposta.body as CorpoDeAluno[];
}

describe('F45 -- cadastro completo de aluno', () => {
  let app: INestApplication;
  let db: PrismaService;

  const sufixo = randomUUID().slice(0, 8);
  const SENHA = 'senha-de-teste-correta';

  const contas = {
    a: {
      email: `f45-a-${sufixo}@exemplo.test`,
      tenantId: '',
      unidadeId: '',
      outraUnidadeId: '',
      userId: '',
      cookie: '',
    },
    b: {
      email: `f45-b-${sufixo}@exemplo.test`,
      tenantId: '',
      unidadeId: '',
      outraUnidadeId: '',
      userId: '',
      cookie: '',
    },
  };

  const PERMISSOES = ['student.create', 'student.read', 'student.update'];

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  const montarAcademia = async (conta: (typeof contas)['a'], slug: string): Promise<void> => {
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

    await db.userRole.create({ data: { tenantId: tenant.id, userId: user.id, roleId: papel.id } });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: `Centro ${slug}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const outra = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'FILIAL',
        name: `Filial ${slug}`,
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
    conta.outraUnidadeId = outra.id;
    conta.cookie = cookieDeAcesso(login);
  };

  const criar = async (
    conta: (typeof contas)['a'],
    dados: Record<string, unknown> = {},
  ): Promise<request.Response> =>
    request(servidor())
      .post('/api/v1/students')
      .set('Cookie', conta.cookie)
      .send({
        fullName: 'Aluno Completo',
        birthDate: '1990-05-10',
        gymUnitId: conta.unidadeId,
        contacts: [],
        ...dados,
      });

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication();
    await app.init();

    db = app.get(PrismaService);

    await montarAcademia(contas.a, `f45-a-${sufixo}`);
    await montarAcademia(contas.b, `f45-b-${sufixo}`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('cadastro minimo', () => {
    it('nome, nascimento e unidade bastam -- e geram matricula', async () => {
      // O CRITERIO CENTRAL DA FATIA: quem chega sem CPF, sem endereco e sem
      // telefone e cadastrado do mesmo jeito (INV-009, INV-011). Se este
      // teste passar a exigir mais um campo, a decisao do PI foi revertida
      // sem ninguem ter escrito isso em lugar nenhum.
      const resposta = await criar(contas.a);

      expect(resposta.status).toBe(201);
      expect(corpo(resposta).membershipNumber).toMatch(/^AP-\d{4}-\d{8}$/);
      expect(corpo(resposta).gymUnitId).toBe(contas.a.unidadeId);
      expect(corpo(resposta).cpf).toBeNull();
    });

    it('recusa unidade de outro tenant, sem confirmar que ela existe', async () => {
      // 404 e nao 403: 403 diria ao atacante "o UUID esta certo, so nao e
      // seu" -- metade do trabalho de mapear a base alheia.
      const resposta = await criar(contas.a, { gymUnitId: contas.b.unidadeId });

      expect(resposta.status).toBe(404);
      expect(corpo(resposta).code).toBe('GYM_UNIT_NOT_FOUND');
    });

    it('recusa cadastro sem unidade', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/students')
        .set('Cookie', contas.a.cookie)
        .send({ fullName: 'Sem Unidade', birthDate: '1990-05-10', contacts: [] });

      expect(resposta.status).toBe(400);
    });

    it('recusa consultor de outro tenant tambem na criacao', async () => {
      const resposta = await criar(contas.a, { advisorUserId: contas.b.userId });

      expect(resposta.status).toBe(404);
      expect(corpo(resposta).code).toBe('ADVISOR_NOT_FOUND');
    });

    it('continua recusando tenantId e membershipNumber no corpo', async () => {
      // `.strict()` do Zod. Aceitar qualquer um dos dois deixaria o cliente
      // escolher o tenant (regra no 2) ou a matricula (INV-010).
      const comTenant = await criar(contas.a, { tenantId: contas.b.tenantId });
      const comMatricula = await criar(contas.a, { membershipNumber: 'AP-2026-00000999' });

      expect(comTenant.status).toBe(400);
      expect(comMatricula.status).toBe(400);
    });
  });

  describe('endereco e contato de emergencia', () => {
    it('persistem na criacao e voltam no GET', async () => {
      const criacao = await criar(contas.a, {
        fullName: 'Aluna Com Endereco',
        rg: '12.345.678-9',
        registeredSex: 'FEMALE',
        leadSource: 'INDICACAO',
        address: {
          postalCode: '80010-000',
          street: 'Rua das Flores',
          number: '123',
          complement: 'Apto 4',
          district: 'Centro',
          city: 'Curitiba',
          state: 'pr',
        },
        contacts: [
          { type: 'PHONE', value: '(41) 99999-0000', isPrimary: true },
          {
            type: 'EMERGENCY',
            value: '(41) 98888-1111',
            label: 'Maria Silva',
            relationship: 'mae',
          },
        ],
      });

      expect(criacao.status).toBe(201);

      const fichaDoAluno = await request(servidor())
        .get(`/api/v1/students/${corpo(criacao).id}`)
        .set('Cookie', contas.a.cookie);

      expect(fichaDoAluno.status).toBe(200);

      // CEP e UF voltam NORMALIZADOS: "80010-000" gravado so com digitos,
      // "pr" como "PR". Sem isso o mesmo endereco teria tres formas no banco.
      expect(ficha(fichaDoAluno).address).toMatchObject({
        postalCode: '80010000',
        street: 'Rua das Flores',
        number: '123',
        city: 'Curitiba',
        state: 'PR',
      });

      const emergencia = ficha(fichaDoAluno).contacts.find((c) => c.type === 'EMERGENCY');

      expect(emergencia).toMatchObject({
        value: '41988881111',
        label: 'Maria Silva',
        relationship: 'mae',
      });

      expect(ficha(fichaDoAluno).rg).toBe('12.345.678-9');
      expect(ficha(fichaDoAluno).registeredSex).toBe('FEMALE');
      expect(ficha(fichaDoAluno).leadSource).toBe('INDICACAO');
    });

    it('recusa CEP e UF invalidos', async () => {
      const cepCurto = await criar(contas.a, {
        address: { postalCode: '8001000', street: 'R', city: 'Curitiba', state: 'PR' },
      });

      const ufInexistente = await criar(contas.a, {
        address: { postalCode: '80010000', street: 'R', city: 'Curitiba', state: 'XX' },
      });

      expect(cepCurto.status).toBe(400);
      expect(ufInexistente.status).toBe(400);
    });

    it('telefone de emergencia nao torna dois alunos a mesma pessoa', async () => {
      // Familia que se cadastra junta compartilha o telefone de emergencia.
      // Compara-lo produziria duplicata falsa em todo irmao.
      const telefoneDaMae = '(41) 97777-2222';

      await criar(contas.a, {
        fullName: 'Irmao Um',
        contacts: [{ type: 'EMERGENCY', value: telefoneDaMae, label: 'Mae', relationship: 'mae' }],
      });

      const irmao = await criar(contas.a, {
        fullName: 'Irmao Dois',
        contacts: [{ type: 'EMERGENCY', value: telefoneDaMae, label: 'Mae', relationship: 'mae' }],
      });

      expect(irmao.status).toBe(201);
      expect(corpo(irmao).duplicateCandidates).toHaveLength(0);
    });
  });

  describe('edicao (PATCH /students/:id)', () => {
    it('corrige dado cadastral e incrementa a versao', async () => {
      const criacao = await criar(contas.a, { fullName: 'Nome Errado' });

      const edicao = await request(servidor())
        .patch(`/api/v1/students/${corpo(criacao).id}`)
        .set('Cookie', contas.a.cookie)
        .send({
          version: corpo(criacao).version,
          fullName: 'Nome Certo',
          address: {
            postalCode: '01310-100',
            street: 'Avenida Paulista',
            city: 'Sao Paulo',
            state: 'SP',
          },
        });

      expect(edicao.status).toBe(200);
      expect(corpo(edicao).fullName).toBe('Nome Certo');
      expect(corpo(edicao).version).toBe(corpo(criacao).version + 1);

      const fichaDoAluno = await request(servidor())
        .get(`/api/v1/students/${corpo(criacao).id}`)
        .set('Cookie', contas.a.cookie);

      expect(ficha(fichaDoAluno).address?.city).toBe('Sao Paulo');
    });

    it('recusa escrita com versao velha, em vez de sobrescrever', async () => {
      // Duas recepcionistas na mesma ficha: sem esta trava, a segunda apaga
      // a correcao da primeira sem ninguem perceber.
      const criacao = await criar(contas.a, { fullName: 'Disputado' });
      const versaoVelha = corpo(criacao).version;

      const primeira = await request(servidor())
        .patch(`/api/v1/students/${corpo(criacao).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: versaoVelha, rg: '11.111.111-1' });

      expect(primeira.status).toBe(200);

      const segunda = await request(servidor())
        .patch(`/api/v1/students/${corpo(criacao).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: versaoVelha, rg: '22.222.222-2' });

      expect(segunda.status).toBe(404);
      expect(corpo(segunda).code).toBe('STUDENT_VERSION_CONFLICT');

      const fichaDoAluno = await request(servidor())
        .get(`/api/v1/students/${corpo(criacao).id}`)
        .set('Cookie', contas.a.cookie);

      // O valor da PRIMEIRA sobrevive: a segunda foi recusada, nao aplicada.
      expect(ficha(fichaDoAluno).rg).toBe('11.111.111-1');
    });

    it('null apaga o campo; ausente nao mexe nele', async () => {
      const criacao = await criar(contas.a, {
        fullName: 'Com RG E Sexo',
        rg: '33.333.333-3',
        registeredSex: 'MALE',
      });

      const edicao = await request(servidor())
        .patch(`/api/v1/students/${corpo(criacao).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: corpo(criacao).version, rg: null });

      expect(edicao.status).toBe(200);
      expect(corpo(edicao).rg).toBeNull();
      // `registeredSex` nao foi mandado: continua como estava.
      expect(corpo(edicao).registeredSex).toBe('MALE');
    });

    it('nao edita aluno de outro tenant', async () => {
      const alheio = await criar(contas.b, { fullName: 'Aluno Do Vizinho' });

      const invasao = await request(servidor())
        .patch(`/api/v1/students/${corpo(alheio).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: corpo(alheio).version, fullName: 'Renomeado Por Estranho' });

      expect(invasao.status).toBe(404);

      const fichaDoAluno = await request(servidor())
        .get(`/api/v1/students/${corpo(alheio).id}`)
        .set('Cookie', contas.b.cookie);

      expect(ficha(fichaDoAluno).fullName).toBe('Aluno Do Vizinho');
    });

    it('recusa consultor de outro tenant', async () => {
      // MESMA ASSIMETRIA QUE A UNIDADE FECHOU. `User` e entidade GLOBAL --
      // nao tem `tenant_id`, o vinculo mora em `TenantMembership` --, entao a
      // FK aceita qualquer usuario do sistema inteiro. Sem esta checagem, a
      // recepcao da academia A poderia pendurar um funcionario da academia B
      // como consultor do proprio aluno, e o banco nao reclamaria.
      const aluno = await criar(contas.a, { fullName: 'Consultor Alheio' });

      const resposta = await request(servidor())
        .patch(`/api/v1/students/${corpo(aluno).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: corpo(aluno).version, advisorUserId: contas.b.userId });

      expect(resposta.status).toBe(404);
      expect(corpo(resposta).code).toBe('ADVISOR_NOT_FOUND');
    });

    it('aceita consultor do proprio tenant', async () => {
      const aluno = await criar(contas.a, { fullName: 'Consultor Proprio' });

      const resposta = await request(servidor())
        .patch(`/api/v1/students/${corpo(aluno).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: corpo(aluno).version, advisorUserId: contas.a.userId });

      expect(resposta.status).toBe(200);
    });

    it('recusa mudar a unidade para a de outro tenant', async () => {
      const aluno = await criar(contas.a, { fullName: 'Nao Se Move' });

      const resposta = await request(servidor())
        .patch(`/api/v1/students/${corpo(aluno).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: corpo(aluno).version, gymUnitId: contas.b.unidadeId });

      expect(resposta.status).toBe(404);
      expect(corpo(resposta).code).toBe('GYM_UNIT_NOT_FOUND');
    });

    it('registra na timeline os campos tocados, nunca os valores', async () => {
      // INV-022: a timeline e lida por gente que nao precisa ver o CPF nem o
      // endereco de ninguem.
      const aluno = await criar(contas.a, { fullName: 'Auditado' });

      await request(servidor())
        .patch(`/api/v1/students/${corpo(aluno).id}`)
        .set('Cookie', contas.a.cookie)
        .send({ version: corpo(aluno).version, cpf: '11144477735', rg: '44.444.444-4' });

      const eventos = await db.studentTimelineEvent.findMany({
        where: { studentId: corpo(aluno).id, type: 'STUDENT_UPDATED' },
      });

      expect(eventos).toHaveLength(1);

      const payload = JSON.stringify(eventos[0]?.payload);

      expect(payload).toContain('cpf');
      expect(payload).toContain('rg');
      // O VALOR nao pode estar la -- nem o do CPF, nem o do RG.
      expect(payload).not.toContain('11144477735');
      expect(payload).not.toContain('44.444.444-4');
    });
  });

  describe('CPF', () => {
    it('persiste e devolve o CPF completo (ADR-034)', async () => {
      const cpf = '11144477735';

      const criacao = await criar(contas.a, { fullName: 'Com CPF', cpf });

      expect(criacao.status).toBe(201);
      expect(corpo(criacao).cpf).toBe('111.444.777-35');

      const linha = await db.student.findFirstOrThrow({ where: { id: corpo(criacao).id } });

      expect(linha.cpf).toBe(cpf);
      // `cpfHash` continua gravado: e o indice que a deteccao de duplicata
      // usa (INV-014), sem varrer a tabela em texto claro.
      expect(linha.cpfHash).not.toBeNull();
    });

    it('duplicata de CPF avisa, e nao bloqueia (INV-014)', async () => {
      const cpf = '52998224725';

      const primeiro = await criar(contas.a, { fullName: 'Primeiro Cadastro', cpf });
      const segundo = await criar(contas.a, { fullName: 'Segundo Cadastro', cpf });

      expect(primeiro.status).toBe(201);
      // 201, nao 409: bloquear deixaria de fora gemeos, homonimos e a pessoa
      // que trocou de telefone. Quem decide e a recepcao.
      expect(segundo.status).toBe(201);
      expect(corpo(segundo).duplicateCandidates).toContainEqual(
        expect.objectContaining({ studentId: corpo(primeiro).id, motivo: 'CPF' }),
      );
    });
  });

  describe('listagem por unidade', () => {
    it('filtra pela unidade quando pedida, e mostra tudo quando nao', async () => {
      const naFilial = await criar(contas.a, {
        fullName: `Aluno Da Filial ${sufixo}`,
        gymUnitId: contas.a.outraUnidadeId,
      });

      const daFilial = await request(servidor())
        .get(`/api/v1/students?gymUnitId=${contas.a.outraUnidadeId}`)
        .set('Cookie', contas.a.cookie);

      const todos = await request(servidor())
        .get('/api/v1/students?limit=100')
        .set('Cookie', contas.a.cookie);

      const idsDaFilial = lista(daFilial).map((a) => a.id);
      const idsDeTodos = lista(todos).map((a) => a.id);

      expect(idsDaFilial).toContain(corpo(naFilial).id);
      expect(idsDeTodos).toContain(corpo(naFilial).id);
      // A filial tem menos gente que a academia inteira -- e o filtro e o que
      // faz a diferenca.
      expect(idsDaFilial.length).toBeLessThan(idsDeTodos.length);
    });
  });
  /**
   * Filtro de SITUACAO da listagem -- a barra de filtros da lista de alunos.
   *
   * Vive junto do filtro de unidade porque os dois compoem: a recepcao filtra
   * "bloqueados NA filial", nao um ou outro.
   */
  describe('listagem por situacao', () => {
    it('devolve so a situacao pedida, e todas quando nao ha filtro', async () => {
      const interessado = corpo(
        await criar(contas.a, { fullName: `Interessado ${sufixo}`, status: 'LEAD' }),
      );
      const ativo = corpo(await criar(contas.a, { fullName: `Ativo ${sufixo}`, status: 'ACTIVE' }));

      const soAtivos = await request(servidor())
        .get('/api/v1/students?status=ACTIVE&limit=100')
        .set('Cookie', contas.a.cookie);

      const ids = lista(soAtivos).map((a) => a.id);

      expect(ids).toContain(ativo.id);
      expect(ids).not.toContain(interessado.id);

      const todos = await request(servidor())
        .get('/api/v1/students?limit=100')
        .set('Cookie', contas.a.cookie);

      expect(lista(todos).map((a) => a.id)).toEqual(expect.arrayContaining([ativo.id, interessado.id]));
    });

    /**
     * SITUACAO INVALIDA NAO DERRUBA A TELA.
     *
     * O parametro vem da URL, que a recepcao edita, colega manda por chat e
     * navegador restaura de sessao antiga. Um `?status=ATIVO` datilografado
     * devolvendo 400 trocaria a lista inteira por uma pagina de erro -- entao
     * degrada para "sem filtro", que e o que a tela mostrava antes.
     */
    it('ignora situacao invalida em vez de recusar a listagem', async () => {
      const aluno = corpo(await criar(contas.a, { fullName: `Situacao Torta ${sufixo}` }));

      const resposta = await request(servidor())
        .get('/api/v1/students?status=ATIVO&limit=100')
        .set('Cookie', contas.a.cookie);

      expect(resposta.status).toBe(200);
      expect(lista(resposta).map((a) => a.id)).toContain(aluno.id);
    });

    /** Os dois filtros compoem: "bloqueados NA filial", nao um ou outro. */
    it('combina situacao e unidade', async () => {
      const naFilial = corpo(
        await criar(contas.a, {
          fullName: `Ativo Da Filial ${sufixo}`,
          gymUnitId: contas.a.outraUnidadeId,
          status: 'ACTIVE',
        }),
      );
      const naMatriz = corpo(
        await criar(contas.a, { fullName: `Ativo Da Matriz ${sufixo}`, status: 'ACTIVE' }),
      );

      const resposta = await request(servidor())
        .get(`/api/v1/students?status=ACTIVE&gymUnitId=${contas.a.outraUnidadeId}&limit=100`)
        .set('Cookie', contas.a.cookie);

      const ids = lista(resposta).map((a) => a.id);

      expect(ids).toContain(naFilial.id);
      expect(ids).not.toContain(naMatriz.id);
    });
  });
});
