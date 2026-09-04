import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * F60 -- modalidades por unidade, contra o banco.
 *
 * O que estas suites existem para pegar:
 *
 *   1. Modalidade de OUTRA UNIDADE do mesmo tenant entrando no cadastro do
 *      aluno. E o erro mais provavel da tela: as duas unidades sao do mesmo
 *      operador, e a lista chega inteira ao navegador.
 *   2. Modalidade de OUTRO TENANT entrando por id adivinhado -- o mesmo
 *      caminho, com uma linha que o filtro por tenant tem de barrar.
 *   3. Nome duplicado na mesma unidade, que o indice unico recusa e o
 *      controller tem de traduzir para 409 em vez de 500.
 *
 * A unicidade e por UNIDADE, e nao por tenant: duas unidades do mesmo
 * complexo podem oferecer "Cross Fit" cada uma. Ha teste para isso.
 */
const SENHA = 'SenhaForte#2026';

describe('F60 -- modalidades por unidade', () => {
  let app: INestApplication;
  let db: PrismaService;
  let tenantId = '';
  let outroTenantId = '';
  let unidadeA = '';
  let unidadeB = '';
  let cookie = '';
  let sufixo = '';

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /**
   * CPF valido e DISTINTO por chamada.
   *
   * Repetir o mesmo CPF no tenant compartilhado faria o cadastro casar com o
   * aluno do teste anterior, e a suite passaria pelo motivo errado.
   *
   * A base NAO pode ser digito repetido: `111111111` produz um CPF que a
   * validacao recusa de proposito (sequencia nao e documento), e o cadastro
   * levaria 400 antes de a modalidade ser sequer olhada -- que foi
   * exatamente como o teste de outro tenant passou pelo motivo errado na
   * primeira execucao.
   */
  const cpfValido = (base: string): string => {
    const digitos = base.padStart(9, '0').slice(-9).split('').map(Number);

    for (let posicao = 0; posicao < 2; posicao += 1) {
      const peso = digitos.length + 1;
      const soma = digitos.reduce((total, digito, i) => total + digito * (peso - i), 0);
      const resto = (soma * 10) % 11;
      digitos.push(resto >= 10 ? 0 : resto);
    }

    return digitos.join('');
  };

  const criarUnidade = async (tenant: string, codigo: string): Promise<string> => {
    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant,
        code: codigo,
        name: codigo,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    return unidade.id;
  };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();
    db = app.get(PrismaService);

    sufixo = randomUUID().slice(0, 8);

    const tenant = await db.tenant.create({
      data: { slug: `t-${sufixo}`, legalName: `T-${sufixo} LTDA`, displayName: `T-${sufixo}` },
    });
    tenantId = tenant.id;

    const outro = await db.tenant.create({
      data: { slug: `o-${sufixo}`, legalName: `O-${sufixo} LTDA`, displayName: `O-${sufixo}` },
    });
    outroTenantId = outro.id;

    unidadeA = await criarUnidade(tenantId, `A-${sufixo}`);
    unidadeB = await criarUnidade(tenantId, `B-${sufixo}`);

    const email = `admin-${sufixo}@arenahub.test`;

    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(SENHA) },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: 'ADMIN DE TESTE', isSystem: false },
    });

    // As permissoes que ESTE arquivo exercita. Faltando qualquer delas, a
    // rota responde 403 e o teste passaria pelo motivo errado -- recusa por
    // permissao e recusa por schema sao indistinguiveis olhando so o status.
    for (const codigo of ['unit.read', 'unit.update', 'student.create', 'student.read']) {
      const permissao = await db.permission.upsert({
        where: { code: codigo },
        create: { code: codigo },
        update: {},
      });

      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({ data: { tenantId, userId: usuario.id, roleId: papel.id } });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA });

    const cabecalho: unknown = login.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    cookie = lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenantId } });
    await db.tenant.delete({ where: { id: outroTenantId } });
    await app.close();
  });

  const criarModalidade = async (unidade: string, nome: string): Promise<string> => {
    const resposta = await request(servidor())
      .post(`/api/v1/units/${unidade}/modalities`)
      .set('cookie', cookie)
      .send({ name: nome });

    expect(resposta.status).toBe(201);

    return (resposta.body as { id: string }).id;
  };

  describe('cadastro na unidade', () => {
    it('cria, lista e inativa uma modalidade', async () => {
      const id = await criarModalidade(unidadeA, 'Quadras de Areia');

      const listadas = await request(servidor())
        .get(`/api/v1/units/${unidadeA}/modalities`)
        .set('cookie', cookie);

      expect(listadas.status).toBe(200);
      expect(listadas.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ id, name: 'Quadras de Areia' })]),
      );

      const inativada = await request(servidor())
        .patch(`/api/v1/units/${unidadeA}/modalities/${id}`)
        .set('cookie', cookie)
        .send({ isActive: false });

      expect(inativada.status).toBe(200);
      expect((inativada.body as { isActive: boolean }).isActive).toBe(false);

      // `onlyActive` e o que a tela de cadastro usa: modalidade fora de
      // operacao nao pode ser oferecida a aluno novo.
      const ativas = await request(servidor())
        .get(`/api/v1/units/${unidadeA}/modalities?onlyActive=true`)
        .set('cookie', cookie);

      expect((ativas.body as { id: string }[]).map((m) => m.id)).not.toContain(id);
    });

    it('recusa nome repetido na MESMA unidade, e aceita o mesmo nome em outra', async () => {
      await criarModalidade(unidadeA, 'Cross Fit');

      const repetida = await request(servidor())
        .post(`/api/v1/units/${unidadeA}/modalities`)
        .set('cookie', cookie)
        .send({ name: 'Cross Fit' });

      expect(repetida.status).toBe(409);

      // Unicidade e POR UNIDADE: duas unidades do mesmo complexo podem
      // oferecer a mesma modalidade, e sao ofertas distintas.
      const outraUnidade = await request(servidor())
        .post(`/api/v1/units/${unidadeB}/modalities`)
        .set('cookie', cookie)
        .send({ name: 'Cross Fit' });

      expect(outraUnidade.status).toBe(201);
    });

    it('404 para unidade de outro tenant', async () => {
      const alheia = await criarUnidade(outroTenantId, `X-${sufixo}`);

      const resposta = await request(servidor())
        .get(`/api/v1/units/${alheia}/modalities`)
        .set('cookie', cookie);

      // 404, nunca 403: 403 confirmaria que a unidade existe.
      expect(resposta.status).toBe(404);
    });
  });

  describe('vinculo no cadastro do aluno', () => {
    const novoAluno = (
      unidade: string,
      cpf: string,
      modalityIds?: string[],
    ): Record<string, unknown> => ({
      fullName: `Aluno ${cpf}`,
      birthDate: '1990-05-10',
      cpf,
      gymUnitId: unidade,
      ...(modalityIds ? { modalityIds } : {}),
    });

    it('vincula varias modalidades ao aluno', async () => {
      const box = await criarModalidade(unidadeA, 'Box');
      const areia = await criarModalidade(unidadeA, 'Areia');

      const criado = await request(servidor())
        .post('/api/v1/students')
        .set('cookie', cookie)
        .send(novoAluno(unidadeA, cpfValido('190235471'), [box, areia]));

      expect(criado.status).toBe(201);

      const id = (criado.body as { id: string }).id;

      const ficha = await request(servidor()).get(`/api/v1/students/${id}`).set('cookie', cookie);

      // Assertar o ESTADO GRAVADO, e nao o eco do que foi enviado: um
      // repositorio que ignorasse `modalityIds` devolveria 201 igual.
      const nomes = (ficha.body as { modalities: { name: string }[] }).modalities.map(
        (m) => m.name,
      );

      expect(nomes).toEqual(['Areia', 'Box']);
    });

    it('recusa modalidade de OUTRA UNIDADE do mesmo tenant', async () => {
      const daOutra = await criarModalidade(unidadeB, 'Funcional');

      const resposta = await request(servidor())
        .post('/api/v1/students')
        .set('cookie', cookie)
        .send(novoAluno(unidadeA, cpfValido('308114962'), [daOutra]));

      expect(resposta.status).toBe(400);
      expect((resposta.body as { code: string }).code).toBe('MODALITY_NOT_IN_UNIT');
    });

    it('recusa modalidade de OUTRO TENANT', async () => {
      const alheia = await criarUnidade(outroTenantId, `Y-${sufixo}`);

      // Criada direto no banco: a API nao deixaria criar em unidade alheia, e
      // o que se testa aqui e o id ADIVINHADO chegando pelo cadastro.
      const modalidade = await db.gymUnitModality.create({
        data: { tenantId: outroTenantId, gymUnitId: alheia, name: 'Alheia' },
      });

      const resposta = await request(servidor())
        .post('/api/v1/students')
        .set('cookie', cookie)
        .send(novoAluno(unidadeA, cpfValido('427503819'), [modalidade.id]));

      expect(resposta.status).toBe(400);

      // E nada foi gravado: recusar depois de criar o aluno seria pior que
      // recusar antes.
      const vinculos = await db.studentModality.count({ where: { modalityId: modalidade.id } });

      expect(vinculos).toBe(0);
    });

    it('aceita cadastro SEM modalidade -- a exigencia e do painel, nao da coluna', async () => {
      const resposta = await request(servidor())
        .post('/api/v1/students')
        .set('cookie', cookie)
        .send(novoAluno(unidadeA, cpfValido('561982037')));

      expect(resposta.status).toBe(201);
    });
  });
});
