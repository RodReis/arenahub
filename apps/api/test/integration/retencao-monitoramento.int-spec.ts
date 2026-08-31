import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { RetentionMonitoringService } from '../../src/modules/retention/retention-monitoring.service.js';
import { RetentionScoresService } from '../../src/modules/retention/retention-scores.service.js';
import { RetentionTasksService } from '../../src/modules/retention/retention-tasks.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F41 -- producao controlada e monitoramento, contra o banco real.
 *
 * O QUE ESTE ARQUIVO PROVA, e que teste de funcao pura NAO alcanca:
 *
 *   - o ACEITE da Slice 6.6 na parte que existe sem modelo: "degradacao
 *     desativa o scoring com seguranca e PRESERVA TAREFAS JA AUDITADAS";
 *   - `M6-NFR-009` literal: com o kill switch acionado, a tarefa aberta
 *     continua tratavel de ponta a ponta -- atribuir, iniciar, registrar
 *     contato e concluir;
 *   - `M6-FR-017`: desligar e um `UPDATE` de coluna, sem deploy, e religar
 *     devolve o pipeline porque nada foi destruido;
 *   - `M6-FR-018`: drift de ausencia e detectado sobre dado real;
 *   - o pipeline que NUNCA rodou tem estado proprio -- e o estado do banco de
 *     desenvolvimento que a medicao da F40 encontrou;
 *   - isolamento entre tenants (INV-006).
 */
describe('F41 -- producao controlada e monitoramento', () => {
  let app: INestApplication;
  let db: PrismaService;
  let monitoramento: RetentionMonitoringService;
  let scores: RetentionScoresService;
  let tarefas: RetentionTasksService;

  const sufixo = randomUUID().slice(0, 8);
  const OBSERVACAO = new Date('2026-09-01T00:00:00.000Z');
  const AGORA = new Date('2026-09-10T09:00:00.000Z');

  interface Academia {
    tenantId: string;
    gymUnitId: string;
    studentId: string;
    contexto: TenantContext;
  }

  const contexto = (tenantId: string): TenantContext => ({
    tenantId,
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

  /** Academia com um aluno em risco alto, pronto para virar score e tarefa. */
  const montarAcademia = async (slug: string): Promise<Academia> => {
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
      data: { tenantId: tenant.id, gymUnitId: unidade.id, dailyCapacity: 20 },
    });
    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Mensal ${slug}`, billingMode: 'ASSINATURA' },
    });
    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        fullName: 'Aluno Em Risco',
        birthDate: new Date('1990-05-10T00:00:00.000Z'),
        membershipNumber: `${slug}-1`,
        status: 'ACTIVE',
      },
    });
    await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2025-06-01T00:00:00.000Z'),
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
    await db.studentFeatureSnapshot.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        targetVersionId: alvo.id,
        featureSetVersionId: features.id,
        observedAt: OBSERVACAO,
        knowledgeCutoffAt: OBSERVACAO,
        completeness: 1,
        checksum: `checksum-${slug}`,
        values: {
          create: [
            { tenantId: tenant.id, name: 'days_past_due', value: 90 },
            { tenantId: tenant.id, name: 'pause_count_180d', value: 0 },
          ],
        },
      },
    });

    return {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      studentId: aluno.id,
      contexto: contexto(tenant.id),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    monitoramento = app.get(RetentionMonitoringService);
    scores = app.get(RetentionScoresService);
    tarefas = app.get(RetentionTasksService);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { slug: { startsWith: `f41-${sufixo}` } } });
    await app.close();
  });

  it('nasce ligado -- o kill switch é opt-in, não opt-out', async () => {
    const academia = await montarAcademia(`f41-${sufixo}-padrao`);

    expect(await monitoramento.scoringLigado(academia.contexto)).toBe(true);
  });

  it('desligar para o scoring sem deploy -- M6-FR-017', async () => {
    const academia = await montarAcademia(`f41-${sufixo}-desliga`);

    expect((await scores.pontuarDia(academia.contexto, OBSERVACAO)).pontuados).toBe(1);

    await monitoramento.definirScoring(academia.contexto, false);

    const depois = await scores.pontuarDia(academia.contexto, OBSERVACAO);
    expect(depois).toEqual({ pontuados: 0, pulados: 0 });
  });

  it('religar devolve o pipeline -- nada foi destruido', async () => {
    const academia = await montarAcademia(`f41-${sufixo}-religa`);

    await monitoramento.definirScoring(academia.contexto, false);
    expect((await scores.pontuarDia(academia.contexto, OBSERVACAO)).pontuados).toBe(0);

    await monitoramento.definirScoring(academia.contexto, true);
    expect((await scores.pontuarDia(academia.contexto, OBSERVACAO)).pontuados).toBe(1);
  });

  it('desligado, a TAREFA ABERTA continua tratavel de ponta a ponta -- M6-NFR-009', async () => {
    // O aceite da Slice 6.6: "desativa com seguranca e PRESERVA TAREFAS JA
    // AUDITADAS". Desligar o scoring no meio do dia nao pode deixar a recepcao
    // com uma fila que ela nao consegue mais fechar.
    const academia = await montarAcademia(`f41-${sufixo}-preserva`);
    await scores.pontuarDia(academia.contexto, OBSERVACAO);
    await tarefas.gerarFila(academia.contexto, AGORA);

    const tarefa = await db.retentionTask.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    await monitoramento.definirScoring(academia.contexto, false);

    const responsavel = randomUUID();
    const comAtor = contexto(academia.tenantId);
    await tarefas.aplicar(comAtor, tarefa.id, { tipo: 'ATRIBUIR', responsavelId: responsavel });
    await tarefas.aplicar(comAtor, tarefa.id, { tipo: 'INICIAR' });
    await tarefas.registrarContato(comAtor, tarefa.id, {
      canal: 'WHATSAPP',
      resultado: 'CONTATADO',
    });
    await tarefas.aplicar(comAtor, tarefa.id, { tipo: 'CONCLUIR', resultado: 'CONTATADO' });

    const fechada = await db.retentionTask.findFirstOrThrow({ where: { id: tarefa.id } });
    expect(fechada.status).toBe('COMPLETED');
    expect(fechada.result).toBe('CONTACTED');

    const interacoes = await db.retentionInteraction.count({
      where: { tenantId: academia.tenantId },
    });
    expect(interacoes).toBe(1);
  });

  it('desligado, o score ja gravado continua legivel', async () => {
    const academia = await montarAcademia(`f41-${sufixo}-legivel`);
    await scores.pontuarDia(academia.contexto, OBSERVACAO);

    await monitoramento.definirScoring(academia.contexto, false);

    const gravados = await db.retentionScore.count({ where: { tenantId: academia.tenantId } });
    expect(gravados).toBe(1);
  });

  it('o painel acusa DESLIGADO, e nao atraso', async () => {
    const academia = await montarAcademia(`f41-${sufixo}-painel-off`);
    await monitoramento.definirScoring(academia.contexto, false);

    const painel = await monitoramento.painel(academia.contexto, AGORA);

    expect(painel.pipeline.estado).toBe('DESLIGADO');
    expect(painel.precisaDeAtencao).toBe(false);
  });

  it('desligado nao alarma NEM COM drift critico presente', async () => {
    // O caso que o teste anterior NAO alcanca: la o painel esta desligado mas
    // tambem nao ha drift, entao `precisaDeAtencao: false` sairia mesmo sem a
    // guarda de `estado.ligado`. Aqui ha drift CRITICO no historico -- se a
    // guarda sumisse, o painel alarmaria por uma situacao que alguem criou de
    // proposito, e alarme assim treina a operacao a ignorar alarme.
    const academia = await montarAcademia(`f41-${sufixo}-off-com-drift`);

    const alvo = await db.retentionTargetVersion.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const features = await db.retentionFeatureSetVersion.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    await db.studentFeatureSnapshot.updateMany({
      where: { tenantId: academia.tenantId },
      data: { observedAt: new Date('2026-08-25T00:00:00.000Z') },
    });
    await db.studentFeatureSnapshot.create({
      data: {
        tenantId: academia.tenantId,
        studentId: academia.studentId,
        targetVersionId: alvo.id,
        featureSetVersionId: features.id,
        observedAt: new Date('2026-09-05T00:00:00.000Z'),
        knowledgeCutoffAt: new Date('2026-09-05T00:00:00.000Z'),
        completeness: 0,
        checksum: 'checksum-off-drift',
        values: {
          create: [
            {
              tenantId: academia.tenantId,
              name: 'days_past_due',
              value: null,
              missingReason: 'SOURCE_UNAVAILABLE',
            },
          ],
        },
      },
    });

    // Ligado: o drift critico existe e o painel pede atencao.
    const ligado = await monitoramento.painel(academia.contexto, AGORA);
    expect(ligado.drift.some((d) => d.severidade === 'CRITICO')).toBe(true);
    expect(ligado.precisaDeAtencao).toBe(true);

    // Desligado: o MESMO drift continua visivel na tela, mas nao alarma.
    await monitoramento.definirScoring(academia.contexto, false);
    const desligado = await monitoramento.painel(academia.contexto, AGORA);

    expect(desligado.drift.some((d) => d.severidade === 'CRITICO')).toBe(true);
    expect(desligado.precisaDeAtencao).toBe(false);
  });

  it('acusa NUNCA_RODOU quando nao ha snapshot -- o estado que a F40 mediu', async () => {
    const tenant = await db.tenant.create({
      data: {
        slug: `f41-${sufixo}-vazio`,
        legalName: 'Vazio LTDA',
        displayName: 'Vazio',
      },
    });

    const painel = await monitoramento.painel(contexto(tenant.id), AGORA);

    expect(painel.pipeline).toEqual({ estado: 'NUNCA_RODOU', horasSemRodar: null });
    expect(painel.precisaDeAtencao).toBe(true);
  });

  it('acusa ATRASADO quando o pipeline parou', async () => {
    const academia = await montarAcademia(`f41-${sufixo}-atrasado`);

    // O snapshot foi criado agora; envelhece o `createdAt` para simular o job
    // que parou. É `createdAt` que responde "quando o pipeline rodou".
    await db.studentFeatureSnapshot.updateMany({
      where: { tenantId: academia.tenantId },
      data: { createdAt: new Date('2026-08-01T00:00:00.000Z') },
    });

    const painel = await monitoramento.painel(academia.contexto, AGORA);

    expect(painel.pipeline.estado).toBe('ATRASADO');
    expect(painel.precisaDeAtencao).toBe(true);
  });

  it('a saude le QUANDO o pipeline rodou, nao que dia ele descreveu', async () => {
    // Reconstrucao historica: o pipeline roda HOJE e grava um snapshot de um
    // dia antigo (`observedAt` no passado, `createdAt` agora). E operacao
    // legitima -- a F36 desenhou o corte de conhecimento justamente para isso.
    //
    // Se a saude lesse `observedAt`, esse pipeline saudavel apareceria como
    // ATRASADO ha meses, e o alarme dispararia toda vez que alguem
    // reconstruisse historico.
    const academia = await montarAcademia(`f41-${sufixo}-reconstrucao`);

    await db.studentFeatureSnapshot.updateMany({
      where: { tenantId: academia.tenantId },
      data: {
        observedAt: new Date('2026-03-01T00:00:00.000Z'),
        knowledgeCutoffAt: new Date('2026-03-01T00:00:00.000Z'),
        createdAt: new Date('2026-09-10T04:00:00.000Z'),
      },
    });

    const painel = await monitoramento.painel(academia.contexto, AGORA);

    expect(painel.pipeline.estado).toBe('SAUDAVEL');
    expect(painel.pipeline.horasSemRodar).toBe(5);
  });

  it('detecta drift de ausencia entre dois periodos', async () => {
    const academia = await montarAcademia(`f41-${sufixo}-drift`);

    const alvo = await db.retentionTargetVersion.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    const features = await db.retentionFeatureSetVersion.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    // A janela de comparação é de 7 dias contra os 7 anteriores. O snapshot
    // base (01/09) e um novo em 05/09 cairiam na MESMA janela e não haveria o
    // que comparar -- por isso o base é empurrado para 20/08, no período
    // anterior. (Errar isso foi o que fez a primeira versão deste teste
    // passar por engano.)
    await db.studentFeatureSnapshot.updateMany({
      where: { tenantId: academia.tenantId },
      data: { observedAt: new Date('2026-08-25T00:00:00.000Z') },
    });

    // Agora o período ATUAL tem `days_past_due` AUSENTE, e o ANTERIOR o tem
    // observado -- a fonte caiu, que é o drift mais silencioso que existe.
    await db.studentFeatureSnapshot.create({
      data: {
        tenantId: academia.tenantId,
        studentId: academia.studentId,
        targetVersionId: alvo.id,
        featureSetVersionId: features.id,
        observedAt: new Date('2026-09-05T00:00:00.000Z'),
        knowledgeCutoffAt: new Date('2026-09-05T00:00:00.000Z'),
        completeness: 0,
        checksum: 'checksum-drift',
        values: {
          create: [
            {
              tenantId: academia.tenantId,
              name: 'days_past_due',
              value: null,
              missingReason: 'SOURCE_UNAVAILABLE',
            },
          ],
        },
      },
    });

    const painel = await monitoramento.painel(academia.contexto, AGORA);
    const achado = painel.drift.find((d) => d.feature === 'days_past_due');

    expect(achado).toMatchObject({ tipo: 'AUSENCIA', severidade: 'CRITICO' });
    expect(painel.precisaDeAtencao).toBe(true);
  });

  it('o kill switch de um tenant nao afeta o outro -- INV-006', async () => {
    const a = await montarAcademia(`f41-${sufixo}-tenant-a`);
    const b = await montarAcademia(`f41-${sufixo}-tenant-b`);

    await monitoramento.definirScoring(a.contexto, false);

    expect(await monitoramento.scoringLigado(a.contexto)).toBe(false);
    expect(await monitoramento.scoringLigado(b.contexto)).toBe(true);

    // E o pipeline de B continua pontuando.
    expect((await scores.pontuarDia(b.contexto, OBSERVACAO)).pontuados).toBe(1);
    expect((await scores.pontuarDia(a.contexto, OBSERVACAO)).pontuados).toBe(0);
  });
});
