import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../../src/app.module.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { RetentionScoresService } from '../../src/modules/retention/retention-scores.service.js';
import { RetentionTasksQueryService } from '../../src/modules/retention/retention-tasks-query.service.js';
import { RetentionTasksService } from '../../src/modules/retention/retention-tasks.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F38 -- CRM de retencao, contra o banco real.
 *
 * O QUE ESTE ARQUIVO PROVA, e que teste de funcao pura NAO alcanca:
 *
 *   - o ACEITE LITERAL da Slice 6.3: "cada intervencao liga score, acao,
 *     responsavel e resultado" -- os quatro chegam juntos na leitura da fila;
 *   - `M6-FR-007` sob CONCORRENCIA: o INDICE PARCIAL impede duas tarefas ativas
 *     do mesmo aluno e estrategia. E a garantia que o `@@unique(score_id)` NAO
 *     da: dois scores de dias diferentes sao o caso normal, o pipeline roda
 *     todo dia;
 *   - `M6-BR-004`: cooldown suprime a TAREFA e o score novo permanece;
 *   - `M6-BR-005`: capacidade corta o top-K, por unidade;
 *   - `M6-AC-006`: interacao registra responsavel, canal, horario e resultado,
 *     e VARIAS interacoes cabem numa tarefa;
 *   - os CHECKs do banco: concluir sem resultado e dispensar sem motivo sao
 *     recusados mesmo por fora da maquina de estados;
 *   - isolamento entre tenants (INV-006).
 */
describe('F38 -- CRM de retencao', () => {
  let app: INestApplication;
  let db: PrismaService;
  let scores: RetentionScoresService;
  /**
   * Com o contexto de banco aberto: fora de HTTP o `TenantRlsInterceptor`
   * nao roda, e `candidatosDoDia` le `retention_scores` trazendo `student`
   * por `include` -- tabela com politica RLS desde a F66 (issue #306).
   */
  let tarefas: RetentionTasksService;
  let consulta: RetentionTasksQueryService;

  const sufixo = randomUUID().slice(0, 8);

  const OBSERVACAO = new Date('2026-09-01T00:00:00.000Z');
  /** Quinta-feira. `venceEm(+3 uteis)` = terca 15/09. */
  const AGORA = new Date('2026-09-10T09:00:00.000Z');

  interface Academia {
    tenantId: string;
    gymUnitId: string;
    studentId: string;
    contexto: TenantContext;
  }

  const contexto = (tenantId: string, actorId = randomUUID()): TenantContext => ({
    tenantId,
    actorId,
    sessionId: randomUUID(),
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

  /**
   * Semeia academia, aluno com score alto e politica de capacidade.
   *
   * O score sai do pipeline REAL da F37 (`pontuarDia`), nao de um insert
   * manual: e o que prova que a fila da F38 consome o que a F37 produz --
   * inclusive o fator dominante, de onde a estrategia e derivada.
   */
  const montarAcademia = async (
    slug: string,
    opcoes: { capacidade?: number; alunos?: number } = {},
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

    await db.retentionCapacityPolicy.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        dailyCapacity: opcoes.capacidade ?? 20,
        cooldownDays: 14,
        slaBusinessDays: 3,
      },
    });

    const alvo = await db.retentionTargetVersion.create({
      data: {
        tenantId: tenant.id,
        label: 'alvo@1',
        featureWindowDays: 90,
        predictionDays: 30,
        confirmationDays: 30,
      },
    });
    const features = await db.retentionFeatureSetVersion.create({
      data: { tenantId: tenant.id, label: 'features@1', featureNames: [] },
    });
    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Mensal ${slug}`, billingMode: 'ASSINATURA' },
    });

    await db.retentionRuleVersion.create({
      data: {
        tenantId: tenant.id,
        label: 'regras@1',
        frozenAt: new Date('2026-08-31T00:00:00.000Z'),
        rules: {
          create: [
            {
              tenantId: tenant.id,
              featureName: 'days_past_due',
              operator: 'GREATER_THAN_OR_EQUAL',
              threshold: 30,
              weight: 60,
              direction: 'INCREASE',
              label: 'Cobranca vencida ha 30 dias ou mais',
            },
          ],
        },
      },
    });

    const quantos = opcoes.alunos ?? 1;
    let primeiroAluno = '';

    for (let i = 0; i < quantos; i += 1) {
      const aluno = await db.student.create({
        data: {
          tenantId: tenant.id,
          gymUnitId: unidade.id,
          fullName: `Aluno ${i}`,
          birthDate: new Date('1990-05-10T00:00:00.000Z'),
          membershipNumber: `${slug}-${i}`,
          status: 'ACTIVE',
        },
      });
      if (i === 0) primeiroAluno = aluno.id;

      await db.subscription.create({
        data: {
          tenantId: tenant.id,
          studentId: aluno.id,
          planId: plano.id,
          status: 'ACTIVE',
          startsAt: new Date('2025-06-01T00:00:00.000Z'),
        },
      });

      await db.studentFeatureSnapshot.create({
        data: {
          tenantId: tenant.id,
          studentId: aluno.id,
          targetVersionId: alvo.id,
          featureSetVersionId: features.id,
          observedAt: OBSERVACAO,
          knowledgeCutoffAt: OBSERVACAO,
          completeness: 1,
          checksum: `checksum-${slug}-${i}`,
          values: {
            create: [
              // Valor decrescente: o aluno 0 e o de maior risco.
              { tenantId: tenant.id, name: 'days_past_due', value: 90 - i },
              { tenantId: tenant.id, name: 'pause_count_180d', value: 0 },
            ],
          },
        },
      });
    }

    // A fila consome o que a F37 produz, pelo pipeline de verdade.
    await scores.pontuarDia(contexto(tenant.id), OBSERVACAO);

    return {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      studentId: primeiroAluno,
      contexto: contexto(tenant.id),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    scores = app.get(RetentionScoresService);
    tarefas = comContextoDeTenant(app.get(RetentionTasksService));
    consulta = app.get(RetentionTasksQueryService);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { slug: { startsWith: `f38-${sufixo}` } } });
    await app.close();
  });

  it('gera tarefa a partir do score, com estrategia derivada do fator', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-basico`);

    const resumo = await tarefas.gerarFila(academia.contexto, AGORA);

    expect(resumo).toEqual({ criadas: 1, suprimidas: 0 });

    const tarefa = await db.retentionTask.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    expect(tarefa.strategy).toBe('DAYS_PAST_DUE');
    expect(tarefa.status).toBe('OPEN');
    // Quinta 10/09 + 3 uteis = terca 15/09.
    expect(tarefa.dueAt).toEqual(new Date('2026-09-15T09:00:00.000Z'));
  });

  it('reexecutar o dia nao duplica -- M6-AC-004', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-replay`);

    await tarefas.gerarFila(academia.contexto, AGORA);
    const segunda = await tarefas.gerarFila(academia.contexto, AGORA);

    expect(segunda.criadas).toBe(0);
    expect(await db.retentionTask.count({ where: { tenantId: academia.tenantId } })).toBe(1);
  });

  it('tres rodadas simultaneas criam UMA tarefa -- a chave unica decide', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-corrida`);

    await Promise.all([
      tarefas.gerarFila(academia.contexto, AGORA),
      tarefas.gerarFila(academia.contexto, AGORA),
      tarefas.gerarFila(academia.contexto, AGORA),
    ]);

    expect(await db.retentionTask.count({ where: { tenantId: academia.tenantId } })).toBe(1);
  });

  it('score de OUTRO dia nao gera segunda tarefa ativa -- o indice parcial, nao o unique de score', async () => {
    // O caso que o `@@unique(score_id)` NAO cobre, e que e o caso NORMAL: o
    // pipeline roda todo dia, entao amanha ha um score novo do mesmo aluno com
    // o mesmo motivo. Sem o indice parcial, ele viraria a segunda ligacao.
    const academia = await montarAcademia(`f38-${sufixo}-outro-dia`);
    await tarefas.gerarFila(academia.contexto, AGORA);

    const snapshot = await db.studentFeatureSnapshot.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
      include: { values: true },
    });
    const versao = await db.retentionRuleVersion.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const outroDia = new Date('2026-09-02T00:00:00.000Z');

    const novoSnapshot = await db.studentFeatureSnapshot.create({
      data: {
        tenantId: academia.tenantId,
        studentId: snapshot.studentId,
        targetVersionId: snapshot.targetVersionId,
        featureSetVersionId: snapshot.featureSetVersionId,
        observedAt: outroDia,
        knowledgeCutoffAt: outroDia,
        completeness: 1,
        checksum: 'checksum-outro-dia',
        values: {
          create: snapshot.values.map((valor) => ({
            tenantId: academia.tenantId,
            name: valor.name,
            value: valor.value,
          })),
        },
      },
    });

    const novoScore = await db.retentionScore.create({
      data: {
        tenantId: academia.tenantId,
        studentId: snapshot.studentId,
        snapshotId: novoSnapshot.id,
        ruleVersionId: versao.id,
        value: 60,
        band: 'HIGH',
        completeness: 1,
        observedAt: outroDia,
        factors: {
          create: [
            {
              tenantId: academia.tenantId,
              ruleId: randomUUID(),
              featureName: 'days_past_due',
              observedValue: 90,
              contribution: 60,
              direction: 'INCREASE',
              label: 'Cobranca vencida',
              position: 1,
            },
          ],
        },
      },
    });

    // A escrita direta e recusada pelo banco: e o indice parcial em acao.
    await expect(
      db.retentionTask.create({
        data: {
          tenantId: academia.tenantId,
          gymUnitId: academia.gymUnitId,
          studentId: snapshot.studentId,
          scoreId: novoScore.id,
          strategy: 'DAYS_PAST_DUE',
          status: 'OPEN',
          dueAt: AGORA,
        },
      }),
    ).rejects.toThrow();

    expect(await db.retentionTask.count({ where: { tenantId: academia.tenantId } })).toBe(1);
  });

  it('tarefa terminal libera o aluno para uma nova -- o indice e PARCIAL', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-terminal`);
    await tarefas.gerarFila(academia.contexto, AGORA);

    const tarefa = await db.retentionTask.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    await tarefas.aplicar(academia.contexto, tarefa.id, {
      tipo: 'DISPENSAR',
      motivo: 'Aluno voltou a treinar ontem',
    });

    // Score NOVO, de outro dia: reusar o mesmo `scoreId` bateria no
    // `@@unique(score_id)` e o teste passaria pelo motivo errado -- provaria a
    // outra chave, nao o predicado parcial que se quer exercitar aqui.
    const snapshot = await db.studentFeatureSnapshot.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const versao = await db.retentionRuleVersion.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const outroDia = new Date('2026-09-03T00:00:00.000Z');

    const novoSnapshot = await db.studentFeatureSnapshot.create({
      data: {
        tenantId: academia.tenantId,
        studentId: snapshot.studentId,
        targetVersionId: snapshot.targetVersionId,
        featureSetVersionId: snapshot.featureSetVersionId,
        observedAt: outroDia,
        knowledgeCutoffAt: outroDia,
        completeness: 1,
        checksum: 'checksum-pos-terminal',
      },
    });
    const novoScore = await db.retentionScore.create({
      data: {
        tenantId: academia.tenantId,
        studentId: snapshot.studentId,
        snapshotId: novoSnapshot.id,
        ruleVersionId: versao.id,
        value: 60,
        band: 'HIGH',
        completeness: 1,
        observedAt: outroDia,
      },
      select: { id: true },
    });

    // Com a primeira DISPENSADA, o indice parcial deixa de valer para ela.
    const criada = await db.retentionTask.create({
      data: {
        tenantId: academia.tenantId,
        gymUnitId: academia.gymUnitId,
        studentId: tarefa.studentId,
        scoreId: novoScore.id,
        strategy: 'DAYS_PAST_DUE',
        status: 'OPEN',
        dueAt: AGORA,
      },
      select: { id: true },
    });

    expect(criada.id).toBeTruthy();
    expect(await db.retentionTask.count({ where: { tenantId: academia.tenantId } })).toBe(2);
  });

  it('corta na capacidade da unidade -- M6-BR-005', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-capacidade`, {
      capacidade: 2,
      alunos: 5,
    });

    const resumo = await tarefas.gerarFila(academia.contexto, AGORA);

    expect(resumo).toEqual({ criadas: 2, suprimidas: 3 });
    const criadas = await db.retentionTask.findMany({
      where: { tenantId: academia.tenantId },
      include: { score: { select: { value: true } } },
    });
    // As duas de MAIOR risco: `days_past_due` 90 e 89.
    expect(criadas.map((t) => t.score.value).sort((a, b) => b - a)).toEqual([60, 60]);
    expect(criadas).toHaveLength(2);
  });

  it('cooldown suprime a tarefa mas o score continua no historico -- M6-BR-004', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-cooldown`);
    await tarefas.gerarFila(academia.contexto, AGORA);

    const tarefa = await db.retentionTask.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    await tarefas.aplicar(academia.contexto, tarefa.id, {
      tipo: 'DISPENSAR',
      motivo: 'tratado',
    });

    // Score NOVO, de outro dia -- e o que o pipeline produz amanha. Sem ele o
    // `@@unique(score_id)` bloquearia primeiro e o teste passaria pelo motivo
    // errado: provaria a chave de score, nao o COOLDOWN.
    const snapshot = await db.studentFeatureSnapshot.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const versao = await db.retentionRuleVersion.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const diaSeguinte = new Date('2026-09-11T00:00:00.000Z');

    const novoSnapshot = await db.studentFeatureSnapshot.create({
      data: {
        tenantId: academia.tenantId,
        studentId: snapshot.studentId,
        targetVersionId: snapshot.targetVersionId,
        featureSetVersionId: snapshot.featureSetVersionId,
        observedAt: diaSeguinte,
        knowledgeCutoffAt: diaSeguinte,
        completeness: 1,
        checksum: 'checksum-cooldown',
      },
    });
    await db.retentionScore.create({
      data: {
        tenantId: academia.tenantId,
        studentId: snapshot.studentId,
        snapshotId: novoSnapshot.id,
        ruleVersionId: versao.id,
        value: 60,
        band: 'HIGH',
        completeness: 1,
        observedAt: diaSeguinte,
        factors: {
          create: [
            {
              tenantId: academia.tenantId,
              ruleId: randomUUID(),
              featureName: 'days_past_due',
              observedValue: 90,
              contribution: 60,
              direction: 'INCREASE',
              label: 'Cobranca vencida',
              position: 1,
            },
          ],
        },
      },
    });

    // Cinco dias depois: a tarefa esta DISPENSADA (o indice parcial ja liberou)
    // e ha score novo (a chave de score ja liberou). So o COOLDOWN de 14 dias
    // segura -- desative-o e este teste cai.
    const cincoDiasDepois = new Date('2026-09-15T09:00:00.000Z');
    const resumo = await tarefas.gerarFila(academia.contexto, cincoDiasDepois);

    expect(resumo).toEqual({ criadas: 0, suprimidas: 1 });
    expect(await db.retentionTask.count({ where: { tenantId: academia.tenantId } })).toBe(1);

    // A metade que se esquece: o score novo continua gravado (`M6-BR-004`).
    expect(await db.retentionScore.count({ where: { tenantId: academia.tenantId } })).toBe(2);

    // E passado o cooldown, o mesmo aluno volta a fila.
    const vinteDiasDepois = new Date('2026-09-30T09:00:00.000Z');
    expect((await tarefas.gerarFila(academia.contexto, vinteDiasDepois)).criadas).toBe(1);
  });

  it('liga score, acao, responsavel e resultado -- o aceite da Slice 6.3', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-aceite`);
    const responsavel = randomUUID();
    const comAtor = contexto(academia.tenantId, responsavel);

    await tarefas.gerarFila(academia.contexto, AGORA);
    const tarefa = await db.retentionTask.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    await tarefas.aplicar(comAtor, tarefa.id, { tipo: 'ATRIBUIR', responsavelId: responsavel });
    await tarefas.aplicar(comAtor, tarefa.id, { tipo: 'INICIAR' });
    await tarefas.registrarContato(comAtor, tarefa.id, {
      canal: 'WHATSAPP',
      resultado: 'SEM_RESPOSTA',
      observacoes: 'Mandei mensagem, sem retorno',
      proximoPasso: 'Tentar de novo amanha',
    });
    await tarefas.registrarContato(comAtor, tarefa.id, {
      canal: 'WHATSAPP',
      resultado: 'CONTATADO',
      observacoes: 'Respondeu, volta na segunda',
    });
    await tarefas.aplicar(comAtor, tarefa.id, { tipo: 'CONCLUIR', resultado: 'CONTATADO' });

    const fila = await consulta.fila(academia.contexto, { agora: AGORA, limite: 50 });

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({
      estado: 'CONCLUIDA',
      responsavelId: responsavel,
      resultado: 'CONTATADO',
      estrategia: 'DAYS_PAST_DUE',
    });
    // O score que motivou, com o fator que a atendente leu.
    expect(fila[0]?.score.faixa).toBe('ALTO');
    expect(fila[0]?.fatores[0]).toMatchObject({
      feature: 'days_past_due',
      valorObservado: 90,
    });
    // DUAS interacoes numa tarefa: e o historico de tentativa.
    expect(fila[0]?.interacoes).toHaveLength(2);
    expect(fila[0]?.interacoes.map((i) => i.resultado)).toEqual(['SEM_RESPOSTA', 'CONTATADO']);
    expect(fila[0]?.interacoes[0]?.actorId).toBe(responsavel);
  });

  it('o banco recusa concluir sem resultado, mesmo por fora da maquina de estados', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-check-resultado`);
    await tarefas.gerarFila(academia.contexto, AGORA);
    const tarefa = await db.retentionTask.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    await expect(
      db.retentionTask.update({
        where: { id: tarefa.id },
        data: { status: 'COMPLETED', result: null },
      }),
    ).rejects.toThrow();
  });

  it('o banco recusa dispensar sem motivo', async () => {
    const academia = await montarAcademia(`f38-${sufixo}-check-motivo`);
    await tarefas.gerarFila(academia.contexto, AGORA);
    const tarefa = await db.retentionTask.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    await expect(
      db.retentionTask.update({
        where: { id: tarefa.id },
        data: { status: 'DISMISSED', dismissReason: '   ' },
      }),
    ).rejects.toThrow();
  });

  it('tarefa de outro tenant nunca aparece na fila -- INV-006', async () => {
    const a = await montarAcademia(`f38-${sufixo}-tenant-a`);
    const b = await montarAcademia(`f38-${sufixo}-tenant-b`);

    await tarefas.gerarFila(a.contexto, AGORA);
    await tarefas.gerarFila(b.contexto, AGORA);

    const filaDeA = await consulta.fila(a.contexto, { agora: AGORA, limite: 50 });

    expect(filaDeA).toHaveLength(1);
    expect(filaDeA[0]?.studentId).toBe(a.studentId);
    expect(filaDeA.map((t) => t.studentId)).not.toContain(b.studentId);
  });

  it('nao carrega tarefa de outro tenant pelo id', async () => {
    const a = await montarAcademia(`f38-${sufixo}-vazamento-a`);
    const b = await montarAcademia(`f38-${sufixo}-vazamento-b`);

    await tarefas.gerarFila(b.contexto, AGORA);
    const deB = await db.retentionTask.findFirstOrThrow({ where: { tenantId: b.tenantId } });

    await expect(
      tarefas.aplicar(a.contexto, deB.id, { tipo: 'ATRIBUIR', responsavelId: randomUUID() }),
    ).rejects.toThrow('TAREFA_NAO_ENCONTRADA');
  });
});
