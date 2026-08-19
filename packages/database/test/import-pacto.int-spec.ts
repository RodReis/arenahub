import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPrismaClient, type PrismaClientArenaHub } from '../src/index.js';
import { importarRegistros, PROXIMO_SEQUENCIAL_APOS_IMPORTACAO } from '../src/import-pacto/importar.js';
import type { RegistroPacto } from '../src/import-pacto/parser.js';

/**
 * Prova os criterios de aceite da F47 (issue #118, ADR-033) contra Postgres
 * de verdade -- nao com dado real do Pacto, com registros sinteticos que
 * cobrem os mesmos casos (CPF valido, sem nascimento, endereco incompleto).
 */
describe('importacao da base legada Pacto (F47)', () => {
  let db: PrismaClientArenaHub;
  const sufixo = randomUUID().slice(0, 8);

  let alvo: { tenantId: string; planId: string; gymUnitId: string };

  beforeAll(async () => {
    db = criarPrismaClient();

    const tenant = await db.tenant.create({
      data: {
        slug: `pacto-${sufixo}`,
        legalName: 'Academia Pacto Teste LTDA',
        displayName: 'Academia Pacto Teste',
      },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MATRIZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: 'Programa Adultos e Idosos' },
    });

    alvo = { tenantId: tenant.id, planId: plano.id, gymUnitId: unidade.id };
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  const registroCompleto: RegistroPacto = {
    dados_pessoais: {
      matricula: '000881',
      nome: 'ABIGAIL DE JESUS ARRUDA',
      data_nascimento: '13/03/2000',
      telefone: '62984204010',
      email: null,
      email_truncado: false,
      sexo: 'Feminino',
      documento: '70586162135',
      documento_valido: true,
    },
    endereco: {
      logradouro: 'RUA 16 A',
      numero: '30',
      bairro: 'VILA PADRE ETERNO',
      cidade: 'TRINDADE',
      complemento: null,
      cep: '75388322',
    },
    plano: { nome_plano: 'PLANO PERSONAL EXCLUSIVE IND 2 OU 3X', situacao: 'Inativo' },
  };

  const registroSemNascimento: RegistroPacto = {
    dados_pessoais: {
      matricula: '000937',
      nome: 'SEM DATA DE NASCIMENTO',
      data_nascimento: null,
      telefone: null,
      email: null,
      email_truncado: false,
      sexo: null,
      documento: null,
      documento_valido: null,
    },
    endereco: { logradouro: null, numero: null, bairro: null, cidade: null, complemento: null, cep: null },
    plano: { nome_plano: null, situacao: 'Visitante' },
  };

  it('cria o aluno como CANCELLED, com CPF em claro, sem entitlement nem consentimento', async () => {
    const resultado = await importarRegistros(db, alvo, [registroCompleto]);

    expect(resultado.criados).toBe(1);
    expect(resultado.rejeitados).toEqual([]);

    const aluno = await db.student.findUniqueOrThrow({
      where: { tenantId_membershipNumber: { tenantId: alvo.tenantId, membershipNumber: 'AP-2026-00000881' } },
      include: { subscriptions: true, entitlements: true, consentRecords: true, contacts: true, addresses: true },
    });

    expect(aluno.status).toBe('CANCELLED');
    expect(aluno.cpf).toBe('70586162135');
    expect(aluno.subscriptions).toHaveLength(1);
    expect(aluno.subscriptions[0]?.status).toBe('CANCELLED');
    expect(aluno.entitlements).toHaveLength(0);
    expect(aluno.consentRecords).toHaveLength(0);
    expect(aluno.contacts).toHaveLength(1);
    expect(aluno.addresses).toHaveLength(1);
  });

  it('a catraca nega acesso ao aluno importado (INV-033: CANCELLED bloqueia)', async () => {
    const aluno = await db.student.findUniqueOrThrow({
      where: { tenantId_membershipNumber: { tenantId: alvo.tenantId, membershipNumber: 'AP-2026-00000881' } },
    });

    // Mesmo invariante que `alunoRecebeAcessoNormal` (apps/api) aplica:
    // BLOCKED, CANCELLED e ARCHIVED nao recebem acesso normal (INV-033,
    // M1-BR-002). Duplicado aqui de proposito -- este pacote nao depende da
    // API, e a garantia que importa e o STATUS gravado, nao a funcao.
    const semAcessoNormal = new Set(['BLOCKED', 'CANCELLED', 'ARCHIVED']);
    expect(semAcessoNormal.has(aluno.status)).toBe(true);
  });

  it('rejeita registro sem data de nascimento e reporta a pendencia', async () => {
    const resultado = await importarRegistros(db, alvo, [registroSemNascimento]);

    expect(resultado.criados).toBe(0);
    expect(resultado.rejeitados).toEqual([
      { matricula: '000937', nome: 'SEM DATA DE NASCIMENTO', motivo: 'SEM_DATA_NASCIMENTO' },
    ]);

    const naoExiste = await db.student.findUnique({
      where: { tenantId_membershipNumber: { tenantId: alvo.tenantId, membershipNumber: 'AP-2026-00000937' } },
    });
    expect(naoExiste).toBeNull();
  });

  it('roda duas vezes e produz o mesmo resultado (idempotencia, INV-084)', async () => {
    const primeira = await importarRegistros(db, alvo, [registroCompleto]);
    const segunda = await importarRegistros(db, alvo, [registroCompleto]);

    expect(primeira.criados).toBe(0); // ja existia do teste anterior
    expect(primeira.atualizados).toBe(1);
    expect(segunda.criados).toBe(0);
    expect(segunda.atualizados).toBe(1);

    const total = await db.student.count({
      where: { tenantId: alvo.tenantId, membershipNumber: 'AP-2026-00000881' },
    });
    expect(total).toBe(1);
  });

  it('eleva student_sequences.next_value para 3000 ao final', async () => {
    await importarRegistros(db, alvo, [registroCompleto]);

    const [linha] = await db.$queryRaw<{ next_value: number }[]>`
      SELECT next_value FROM student_sequences WHERE tenant_id = ${alvo.tenantId}::uuid
    `;

    expect(linha?.next_value).toBe(PROXIMO_SEQUENCIAL_APOS_IMPORTACAO);
  });
});
