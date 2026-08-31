import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { sortearGrupo } from '../../src/modules/retention/domain/randomizacao.js';
import { RetentionExperimentsService } from '../../src/modules/retention/retention-experiments.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F39 -- experimento operacional, contra o banco real.
 *
 * O QUE ESTE ARQUIVO PROVA, e que teste de funcao pura NAO alcanca:
 *
 *   - o ACEITE da Slice 6.4: o resultado permite decidir "sem cherry-picking",
 *     porque o grupo gravado BATE com o recalculo -- ninguem escolheu a dedo;
 *   - `M6-FR-012` no BANCO: o trigger recusa mudar grupo de alocacao e recusa
 *     mexer em semente/fracao depois de RUNNING. Guarda no servico e uma porta;
 *     o trigger pega quem entra pela janela;
 *   - `M6-FR-011`: realocar o mesmo aluno nao re-sorteia -- a chave unica
 *     decide, nao um `if`;
 *   - a janela e por ALUNO: quem ainda esta dentro dela nao entra na analise;
 *   - `M6-AC-011`: efeito adverso e contado nos dois bracos;
 *   - isolamento entre tenants (INV-006).
 */
describe('F39 -- experimento operacional', () => {
  let app: INestApplication;
  let db: PrismaService;
  let experimentos: RetentionExperimentsService;

  const sufixo = randomUUID().slice(0, 8);
  const SEMENTE = 'semente-do-piloto';

  interface Academia {
    tenantId: string;
    gymUnitId: string;
    planId: string;
    experimentoId: string;
    contexto: TenantContext;
  }

  const contexto = (tenantId: string): TenantContext => ({
    tenantId,
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

  const montarAcademia = async (
    slug: string,
    opcoes: { fracao?: number; janela?: number; status?: 'DRAFT' | 'RUNNING' } = {},
  ): Promise<Academia> => {
    const tenant = await db.tenant.create({
      data: { slug, legalName: `${slug} LTDA`, displayName: slug },
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
    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Mensal ${slug}`, billingMode: 'ASSINATURA' },
    });
    const status = opcoes.status ?? 'RUNNING';
    const experimento = await db.retentionExperiment.create({
      data: {
        tenantId: tenant.id,
        label: 'piloto@1',
        status,
        seed: SEMENTE,
        controlFraction: opcoes.fracao ?? 0.2,
        windowDays: opcoes.janela ?? 30,
        startedAt: status === 'DRAFT' ? null : new Date('2026-07-01T00:00:00.000Z'),
      },
    });

    return {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      planId: plano.id,
      experimentoId: experimento.id,
      contexto: contexto(tenant.id),
    };
  };

  /** Um aluno com assinatura, para a métrica de permanência ter o que ler. */
  const criarAluno = async (
    academia: Academia,
    indice: number,
    opcoes: { assinatura?: 'ACTIVE' | 'CANCELLED'; arquivado?: boolean } = {},
  ): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId: academia.tenantId,
        gymUnitId: academia.gymUnitId,
        fullName: `Aluno ${indice}`,
        birthDate: new Date('1990-05-10T00:00:00.000Z'),
        membershipNumber: `${academia.tenantId.slice(0, 6)}-${indice}`,
        status: opcoes.arquivado === true ? 'ARCHIVED' : 'ACTIVE',
      },
    });
    await db.subscription.create({
      data: {
        tenantId: academia.tenantId,
        studentId: aluno.id,
        planId: academia.planId,
        status: opcoes.assinatura ?? 'ACTIVE',
        startsAt: new Date('2025-06-01T00:00:00.000Z'),
      },
    });
    return aluno.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    experimentos = app.get(RetentionExperimentsService);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { slug: { startsWith: `f39-${sufixo}` } } });
    await app.close();
  });

  it('aloca e o grupo gravado bate com o recalculo -- o aceite da Slice 6.4', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-aloca`);
    const alunos = await Promise.all([0, 1, 2, 3, 4].map((i) => criarAluno(academia, i)));

    const resumo = await experimentos.alocar(
      academia.contexto,
      alunos,
      new Date('2026-07-02T09:00:00.000Z'),
    );
    expect(resumo.alocados).toBe(5);

    const gravadas = await db.retentionExperimentAssignment.findMany({
      where: { tenantId: academia.tenantId },
    });

    // A prova de que ninguém escolheu o grupo a dedo: qualquer pessoa
    // recalcula `(semente, aluno)` e confere.
    for (const gravada of gravadas) {
      const esperado = sortearGrupo(SEMENTE, gravada.studentId, 0.2);
      const noBanco = gravada.assignedGroup === 'CONTROL' ? 'CONTROLE' : 'TRATAMENTO';
      expect(noBanco).toBe(esperado);
    }
  });

  it('dois experimentos re-embaralham os mesmos alunos', async () => {
    // A consequência de a semente não entrar no hash: o aluno que caiu no
    // controle no primeiro experimento cairia no controle em TODOS, e o mesmo
    // grupo de pessoas acumularia o custo de nunca receber intervenção. Com 40
    // alunos, duas divisões idênticas seriam improváveis por acaso.
    const primeiro = await montarAcademia(`f39-${sufixo}-semente-a`, { fracao: 0.5 });
    const segundo = await montarAcademia(`f39-${sufixo}-semente-b`, { fracao: 0.5 });

    await db.retentionExperiment.update({
      where: { id: segundo.experimentoId },
      // Semente diferente: `montarAcademia` usa a mesma para os dois, e o
      // experimento do segundo ainda está em RUNNING — por isso o update vai
      // pelo `seed` de um DRAFT recém-criado, não deste. Recriar é mais simples.
      data: { status: 'CLOSED' },
    });
    const outro = await db.retentionExperiment.create({
      data: {
        tenantId: segundo.tenantId,
        label: 'piloto@2',
        status: 'RUNNING',
        seed: 'semente-completamente-diferente',
        controlFraction: 0.5,
        windowDays: 30,
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });

    const ids = Array.from({ length: 40 }, (_, i) => `aluno-estavel-${i}`);
    const grupoNoPrimeiro = ids.map((id) => sortearGrupo(SEMENTE, id, 0.5));
    const grupoNoSegundo = ids.map((id) => sortearGrupo(outro.seed, id, 0.5));

    const iguais = grupoNoPrimeiro.filter((g, i) => g === grupoNoSegundo[i]).length;

    // Se a semente fosse ignorada, seriam 40 de 40. Com ela, fica perto de 20.
    expect(iguais).toBeLessThan(35);
    expect(primeiro.experimentoId).not.toBe(outro.id);
  });

  it('realocar nao re-sorteia -- M6-FR-012', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-realoca`);
    const aluno = await criarAluno(academia, 0);
    const quando = new Date('2026-07-02T09:00:00.000Z');

    await experimentos.alocar(academia.contexto, [aluno], quando);
    const primeira = await db.retentionExperimentAssignment.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    const segunda = await experimentos.alocar(academia.contexto, [aluno], quando);

    expect(segunda).toEqual({ alocados: 0, jaAlocados: 1 });
    const todas = await db.retentionExperimentAssignment.findMany({
      where: { tenantId: academia.tenantId },
    });
    expect(todas).toHaveLength(1);
    expect(todas[0]?.assignedGroup).toBe(primeira.assignedGroup);
  });

  it('o banco recusa mudar o grupo de uma alocacao -- trigger, nao guarda no servico', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-imutavel`);
    const aluno = await criarAluno(academia, 0);
    await experimentos.alocar(academia.contexto, [aluno], new Date('2026-07-02T09:00:00.000Z'));

    const alocacao = await db.retentionExperimentAssignment.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const outro = alocacao.assignedGroup === 'CONTROL' ? 'TREATMENT' : 'CONTROL';

    await expect(
      db.retentionExperimentAssignment.update({
        where: { id: alocacao.id },
        data: { assignedGroup: outro as never },
      }),
    ).rejects.toThrow();
  });

  it('o banco recusa mexer na semente depois de RUNNING', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-congelado`);

    // Rodar, ver o resultado, mudar a semente e rodar de novo é o
    // cherry-picking que o aceite proíbe.
    await expect(
      db.retentionExperiment.update({
        where: { id: academia.experimentoId },
        data: { seed: 'outra-semente' },
      }),
    ).rejects.toThrow();
  });

  it('o banco recusa mexer na fracao depois de RUNNING', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-fracao`);

    await expect(
      db.retentionExperiment.update({
        where: { id: academia.experimentoId },
        data: { controlFraction: 0.5 },
      }),
    ).rejects.toThrow();
  });

  it('em DRAFT o desenho ainda pode mudar', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-rascunho`, { status: 'DRAFT' });

    const atualizado = await db.retentionExperiment.update({
      where: { id: academia.experimentoId },
      data: { seed: 'semente-corrigida', controlFraction: 0.3 },
    });

    expect(atualizado.seed).toBe('semente-corrigida');
  });

  it('experimento em DRAFT nao e o ativo -- nao aloca ninguem', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-draft-inativo`, { status: 'DRAFT' });
    const aluno = await criarAluno(academia, 0);

    const resumo = await experimentos.alocar(
      academia.contexto,
      [aluno],
      new Date('2026-07-02T09:00:00.000Z'),
    );

    expect(resumo).toEqual({ alocados: 0, jaAlocados: 0 });
  });

  it('grupoDoAluno devolve o gravado, e null para quem nao participa', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-consulta`);
    const dentro = await criarAluno(academia, 0);
    const fora = await criarAluno(academia, 1);

    await experimentos.alocar(academia.contexto, [dentro], new Date('2026-07-02T09:00:00.000Z'));

    expect(await experimentos.grupoDoAluno(academia.contexto, dentro)).toBe(
      sortearGrupo(SEMENTE, dentro, 0.2),
    );
    expect(await experimentos.grupoDoAluno(academia.contexto, fora)).toBeNull();
  });

  it('a janela e por aluno: quem ainda esta dentro dela nao entra na analise', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-janela`, { janela: 30 });
    const antigo = await criarAluno(academia, 0);
    const recente = await criarAluno(academia, 1);

    // O antigo fechou a janela; o recente entrou ontem.
    await experimentos.alocar(academia.contexto, [antigo], new Date('2026-01-01T00:00:00.000Z'));
    await experimentos.alocar(academia.contexto, [recente], new Date());

    const resultado = await experimentos.analisar(academia.contexto);
    const total =
      (resultado?.tratamento.participantes ?? 0) + (resultado?.controle.participantes ?? 0);

    // Incluir quem está dentro da janela infla a permanência dos dois braços
    // (ninguém teve tempo de sair) e dilui qualquer efeito real.
    expect(total).toBe(1);
  });

  it('mede permanencia pela assinatura e conta efeito adverso nos dois bracos', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-analise`, { fracao: 0.5 });
    const ficou = await criarAluno(academia, 0, { assinatura: 'ACTIVE' });
    const saiu = await criarAluno(academia, 1, { assinatura: 'CANCELLED' });

    const passado = new Date('2026-01-01T00:00:00.000Z');
    await experimentos.alocar(academia.contexto, [ficou, saiu], passado);

    await db.retentionExperimentAdverseEvent.create({
      data: {
        tenantId: academia.tenantId,
        experimentId: academia.experimentoId,
        studentId: saiu,
        effect: 'CANCELLED',
      },
    });

    const resultado = await experimentos.analisar(academia.contexto);
    const somaPermaneceram =
      (resultado?.tratamento.permaneceram ?? 0) + (resultado?.controle.permaneceram ?? 0);
    const somaAdversos =
      (resultado?.tratamento.adversos.CANCELOU ?? 0) +
      (resultado?.controle.adversos.CANCELOU ?? 0);

    expect(somaPermaneceram).toBe(1);
    expect(somaAdversos).toBe(1);
    // Amostra de dois não sustenta conclusão nenhuma.
    expect(resultado?.conclusivo).toBe(false);
  });

  it('o mesmo efeito registrado duas vezes conta uma -- a chave unica decide', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-adverso-dup`);
    const aluno = await criarAluno(academia, 0);
    await experimentos.alocar(academia.contexto, [aluno], new Date('2026-01-01T00:00:00.000Z'));

    await db.retentionExperimentAdverseEvent.create({
      data: {
        tenantId: academia.tenantId,
        experimentId: academia.experimentoId,
        studentId: aluno,
        effect: 'OPT_OUT',
      },
    });

    await expect(
      db.retentionExperimentAdverseEvent.create({
        data: {
          tenantId: academia.tenantId,
          experimentId: academia.experimentoId,
          studentId: aluno,
          effect: 'OPT_OUT',
        },
      }),
    ).rejects.toThrow();
  });

  it('alocacao de outro tenant nunca aparece -- INV-006', async () => {
    const a = await montarAcademia(`f39-${sufixo}-tenant-a`);
    const b = await montarAcademia(`f39-${sufixo}-tenant-b`);
    const deA = await criarAluno(a, 0);
    const deB = await criarAluno(b, 0);

    await experimentos.alocar(a.contexto, [deA], new Date('2026-07-02T09:00:00.000Z'));
    await experimentos.alocar(b.contexto, [deB], new Date('2026-07-02T09:00:00.000Z'));

    // O aluno de B não é conhecido pelo experimento de A.
    expect(await experimentos.grupoDoAluno(a.contexto, deB)).toBeNull();

    const doTenantA = await db.retentionExperimentAssignment.findMany({
      where: { tenantId: a.tenantId },
    });
    expect(doTenantA).toHaveLength(1);
    expect(doTenantA[0]?.studentId).toBe(deA);
  });

  it('recusa fracao fora de [0, 1] no proprio banco', async () => {
    const academia = await montarAcademia(`f39-${sufixo}-fracao-invalida`, { status: 'DRAFT' });

    await expect(
      db.retentionExperiment.update({
        where: { id: academia.experimentoId },
        data: { controlFraction: 1.5 },
      }),
    ).rejects.toThrow();
  });
});
