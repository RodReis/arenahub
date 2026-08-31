import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { RetentionScoresService } from '../../src/modules/retention/retention-scores.service.js';
import { RetentionScoresQueryService } from '../../src/modules/retention/retention-scores-query.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F37 -- regras explicaveis e score, contra o banco real.
 *
 * O QUE ESTE ARQUIVO PROVA, e que teste de funcao pura NAO alcanca:
 *
 *   - o ACEITE LITERAL da Slice 6.2: a operacao entende e CONTESTA o score --
 *     cada fator gravado carrega a regra, o valor observado e o limite;
 *   - `M6-AC-002`: reexecutar a mesma versao sobre o mesmo snapshot da o mesmo
 *     score e os mesmos fatores, e nao cria linha nova;
 *   - `M6-NFR-002` sob CONCORRENCIA: tres rodadas simultaneas nao duplicam --
 *     a garantia e o indice unico, nao um `if` que perde a corrida;
 *   - `M6-BR-002` no caminho completo: aluno novo, com quase tudo ausente, sai
 *     da fila por COMPLETUDE e nao por risco alto -- e nao vira score zero;
 *   - `M6-FR-006`: suprimido nao e pontuado, e a razao fica gravada;
 *   - isolamento entre tenants (INV-006, regra de arquitetura no 2).
 */
describe('F37 -- score explicavel', () => {
  let app: INestApplication;
  let db: PrismaService;
  let scores: RetentionScoresService;
  let consulta: RetentionScoresQueryService;

  const sufixo = randomUUID().slice(0, 8);

  const OBSERVACAO = new Date('2026-09-01T00:00:00.000Z');

  interface Academia {
    tenantId: string;
    studentId: string;
    snapshotId: string;
    versaoDeRegrasId: string;
    contexto: TenantContext;
  }

  const contexto = (tenantId: string): TenantContext => ({
    tenantId,
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

  /**
   * Semeia uma academia com um aluno, um snapshot e um catalogo congelado.
   *
   * `valores` entra por parametro porque cada cenario precisa de um vetor
   * diferente -- e o vetor e justamente o que decide score e completude.
   */
  const montarAcademia = async (
    slug: string,
    valores: { nome: string; valor: number | null; razao?: string }[] = [
      { nome: 'attendance_days_30d', valor: 2 },
      { nome: 'days_past_due', valor: 41 },
      { nome: 'pause_count_180d', valor: 0 },
      { nome: 'subscription_age_days', valor: 400 },
    ],
    statusDaAssinatura: 'ACTIVE' | 'CANCELLED' = 'ACTIVE',
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

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        fullName: 'Aluno De Risco',
        birthDate: new Date('1990-05-10T00:00:00.000Z'),
        membershipNumber: `${slug}-1`,
        status: 'ACTIVE',
      },
    });

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: `Mensal ${slug}`, billingMode: 'ASSINATURA' },
    });

    await db.subscription.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        planId: plano.id,
        status: statusDaAssinatura,
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

    const snapshot = await db.studentFeatureSnapshot.create({
      data: {
        tenantId: tenant.id,
        studentId: aluno.id,
        targetVersionId: alvo.id,
        featureSetVersionId: features.id,
        observedAt: OBSERVACAO,
        knowledgeCutoffAt: OBSERVACAO,
        completeness: valores.filter((v) => v.valor !== null).length / valores.length,
        checksum: `checksum-${slug}`,
        values: {
          create: valores.map((valor) => ({
            tenantId: tenant.id,
            name: valor.nome,
            value: valor.valor,
            missingReason: (valor.razao ?? null) as never,
          })),
        },
      },
    });

    const versao = await db.retentionRuleVersion.create({
      data: {
        tenantId: tenant.id,
        label: 'regras@1',
        frozenAt: new Date('2026-08-31T00:00:00.000Z'),
        rules: {
          create: [
            {
              tenantId: tenant.id,
              featureName: 'attendance_days_30d',
              operator: 'LESS_THAN_OR_EQUAL',
              threshold: 4,
              weight: 30,
              direction: 'INCREASE',
              label: 'Treinou 4 dias ou menos no mes',
            },
            {
              tenantId: tenant.id,
              featureName: 'days_past_due',
              operator: 'GREATER_THAN_OR_EQUAL',
              threshold: 30,
              weight: 40,
              direction: 'INCREASE',
              label: 'Cobranca vencida ha 30 dias ou mais',
            },
            {
              tenantId: tenant.id,
              featureName: 'subscription_age_days',
              operator: 'GREATER_THAN_OR_EQUAL',
              threshold: 365,
              weight: 15,
              direction: 'DECREASE',
              label: 'Aluno ha mais de um ano',
            },
          ],
        },
      },
    });

    return {
      tenantId: tenant.id,
      studentId: aluno.id,
      snapshotId: snapshot.id,
      versaoDeRegrasId: versao.id,
      contexto: contexto(tenant.id),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    scores = app.get(RetentionScoresService);
    consulta = app.get(RetentionScoresQueryService);
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { slug: { startsWith: `f37-${sufixo}` } } });
    await app.close();
  });

  it('pontua o aluno e grava a explicacao com o valor observado', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-basico`);

    const resumo = await scores.pontuarDia(academia.contexto, OBSERVACAO);

    expect(resumo).toEqual({ pontuados: 1, pulados: 0 });

    const gravado = await db.retentionScore.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
      include: { factors: { orderBy: { position: 'asc' } } },
    });

    // 30 (frequencia) + 40 (cobranca) - 15 (aluno antigo, fator protetor) = 55.
    expect(gravado.value).toBe(55);
    expect(gravado.band).toBe('HIGH');
    // Baseline NUNCA publica probabilidade -- PRD §16.
    expect(gravado.calibratedProbability).toBeNull();

    // O valor observado viaja junto: sem ele "cobranca vencida" nao e
    // contestavel; com ele, contestar vira conferir 41 contra o extrato.
    expect(
      gravado.factors.map((f) => [f.featureName, Number(f.observedValue), f.contribution]),
    ).toEqual([
      ['days_past_due', 41, 40],
      ['attendance_days_30d', 2, 30],
      ['subscription_age_days', 400, -15],
    ]);
  });

  it('reexecutar nao duplica nem muda o score -- M6-AC-002 e M6-NFR-002', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-replay`);

    await scores.pontuarDia(academia.contexto, OBSERVACAO);
    const primeiro = await db.retentionScore.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });

    await scores.pontuarDia(academia.contexto, OBSERVACAO);

    const todos = await db.retentionScore.findMany({ where: { tenantId: academia.tenantId } });
    expect(todos).toHaveLength(1);
    expect(todos[0]?.id).toBe(primeiro.id);
    expect(todos[0]?.value).toBe(primeiro.value);

    const fatores = await db.retentionScoreFactor.count({
      where: { tenantId: academia.tenantId },
    });
    expect(fatores).toBe(3);
  });

  it('tres rodadas simultaneas nao duplicam -- a chave unica decide, nao um if', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-corrida`);

    await Promise.all([
      scores.pontuarDia(academia.contexto, OBSERVACAO),
      scores.pontuarDia(academia.contexto, OBSERVACAO),
      scores.pontuarDia(academia.contexto, OBSERVACAO),
    ]);

    const todos = await db.retentionScore.findMany({ where: { tenantId: academia.tenantId } });
    expect(todos).toHaveLength(1);
  });

  it('aluno novo sai por completude, e nao vira score zero -- M6-BR-002', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-novo`, [
      { nome: 'attendance_days_30d', valor: null, razao: 'NO_HISTORY' },
      { nome: 'days_past_due', valor: null, razao: 'NO_HISTORY' },
      { nome: 'pause_count_180d', valor: null, razao: 'NO_HISTORY' },
      { nome: 'subscription_age_days', valor: 3 },
    ]);

    const resumo = await scores.pontuarDia(academia.contexto, OBSERVACAO);

    expect(resumo).toEqual({ pontuados: 0, pulados: 1 });

    // A distincao que a fatia inteira existe para preservar: nao ha score `0`
    // que o coloque na fila ao lado de quem realmente esta em risco baixo.
    expect(await db.retentionScore.count({ where: { tenantId: academia.tenantId } })).toBe(0);

    const pulo = await db.retentionScoreSkip.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    expect(pulo.reason).toBe('INSUFFICIENT_HISTORY');
  });

  it('feature ausente nao pontua, mesmo com completude suficiente -- M6-BR-002', async () => {
    // O caso que o teste do "aluno novo" NAO alcanca: la a completude reprova
    // antes de qualquer regra ser avaliada, entao um `?? 0` no motor passaria
    // verde. Aqui a completude e 0.75 (passa o minimo de 0.3) e `days_past_due`
    // esta AUSENTE -- se o motor colapsasse ausente em zero, a regra
    // `days_past_due >= 30` nao dispararia, mas a de `attendance <= 4` sim, e o
    // aluno seria pontuado por um numero que ninguem mediu.
    const academia = await montarAcademia(`f37-${sufixo}-ausente`, [
      { nome: 'attendance_days_30d', valor: 20 },
      { nome: 'days_past_due', valor: null, razao: 'NO_HISTORY' },
      { nome: 'pause_count_180d', valor: 0 },
      { nome: 'subscription_age_days', valor: 400 },
    ]);

    const resumo = await scores.pontuarDia(academia.contexto, OBSERVACAO);
    expect(resumo).toEqual({ pontuados: 1, pulados: 0 });

    const gravado = await db.retentionScore.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
      include: { factors: true },
    });

    // So o fator protetor dispara: 0 - 15, com piso em zero.
    expect(gravado.value).toBe(0);
    expect(gravado.band).toBe('LOW');
    // A prova: `days_past_due` ausente NAO virou fator, nem para cima nem para
    // baixo. Com `?? 0` ela viraria `0`, e `0 >= 30` continua falso -- mas
    // `attendance_days_30d = 20` tambem nao dispara, e a diferenca apareceria
    // no proximo cenario. Aqui o que se trava e a AUSENCIA da linha.
    expect(gravado.factors.map((f) => f.featureName)).toEqual(['subscription_age_days']);
  });

  it('zero observado pontua, ausente nao -- a distincao chega ate o banco', async () => {
    // O par que fecha `M6-BR-002`. Os dois alunos tem o MESMO vetor, com uma
    // diferenca: um tem `attendance_days_30d = 0` (faltou o mes inteiro), o
    // outro a tem AUSENTE (entrou ontem). Colapsados, os dois entrariam na fila
    // com o mesmo numero, e a recepcao ligaria para quem acabou de se
    // matricular. Este teste morre se alguem escrever `?? 0` no caminho.
    const faltou = await montarAcademia(`f37-${sufixo}-faltou`, [
      { nome: 'attendance_days_30d', valor: 0 },
      { nome: 'days_past_due', valor: 0 },
      { nome: 'pause_count_180d', valor: 0 },
      { nome: 'subscription_age_days', valor: 100 },
    ]);
    const novo = await montarAcademia(`f37-${sufixo}-recem`, [
      { nome: 'attendance_days_30d', valor: null, razao: 'NO_HISTORY' },
      { nome: 'days_past_due', valor: 0 },
      { nome: 'pause_count_180d', valor: 0 },
      { nome: 'subscription_age_days', valor: 100 },
    ]);

    await scores.pontuarDia(faltou.contexto, OBSERVACAO);
    await scores.pontuarDia(novo.contexto, OBSERVACAO);

    const scoreDeQuemFaltou = await db.retentionScore.findFirstOrThrow({
      where: { tenantId: faltou.tenantId },
      include: { factors: true },
    });
    const scoreDoRecem = await db.retentionScore.findFirstOrThrow({
      where: { tenantId: novo.tenantId },
      include: { factors: true },
    });

    // Quem faltou o mes inteiro: a regra de frequencia dispara.
    expect(scoreDeQuemFaltou.value).toBe(30);
    expect(scoreDeQuemFaltou.factors.map((f) => f.featureName)).toEqual([
      'attendance_days_30d',
    ]);

    // Quem entrou ontem: NENHUM fator de frequencia, e score zero.
    expect(scoreDoRecem.value).toBe(0);
    expect(scoreDoRecem.factors).toHaveLength(0);
  });

  it('aluno cancelado nao gera score -- M6-BR-003', async () => {
    const academia = await montarAcademia(
      `f37-${sufixo}-cancelado`,
      undefined,
      'CANCELLED',
    );

    await scores.pontuarDia(academia.contexto, OBSERVACAO);

    expect(await db.retentionScore.count({ where: { tenantId: academia.tenantId } })).toBe(0);
    const pulo = await db.retentionScoreSkip.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    expect(pulo.reason).toBe('CANCELLED');
  });

  it('aluno suprimido nao e pontuado, e a razao fica gravada -- M6-FR-006', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-suprimido`);

    await db.retentionSuppression.create({
      data: {
        tenantId: academia.tenantId,
        studentId: academia.studentId,
        reason: 'OPT_OUT',
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: randomUUID(),
      },
    });

    await scores.pontuarDia(academia.contexto, OBSERVACAO);

    expect(await db.retentionScore.count({ where: { tenantId: academia.tenantId } })).toBe(0);
    const pulo = await db.retentionScoreSkip.findFirstOrThrow({
      where: { tenantId: academia.tenantId },
    });
    expect(pulo.reason).toBe('SUPPRESSED');
  });

  it('supressao ja expirada nao tira o aluno da fila', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-expirada`);

    await db.retentionSuppression.create({
      data: {
        tenantId: academia.tenantId,
        studentId: academia.studentId,
        reason: 'OPT_OUT',
        startsAt: new Date('2026-06-01T00:00:00.000Z'),
        endsAt: new Date('2026-07-01T00:00:00.000Z'),
        createdBy: randomUUID(),
      },
    });

    const resumo = await scores.pontuarDia(academia.contexto, OBSERVACAO);

    expect(resumo).toEqual({ pontuados: 1, pulados: 0 });
  });

  it('supressao manual sem motivo e recusada pelo banco -- M6-BR-007', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-manual`);

    await expect(
      db.retentionSuppression.create({
        data: {
          tenantId: academia.tenantId,
          studentId: academia.studentId,
          reason: 'MANUAL_WITH_REASON',
          createdBy: randomUUID(),
        },
      }),
    ).rejects.toThrow();
  });

  it('a fila devolve o score com validade e aviso de estimativa', async () => {
    const academia = await montarAcademia(`f37-${sufixo}-fila`);
    await scores.pontuarDia(academia.contexto, OBSERVACAO);

    const fila = await consulta.fila(academia.contexto, {
      agora: new Date('2026-09-01T12:00:00.000Z'),
      limite: 50,
    });

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({
      valor: 55,
      faixa: 'ALTO',
      versaoDeRegras: 'regras@1',
      aviso: 'ESTIMATIVA_NAO_E_FATO',
      validade: { estado: 'ATUAL', idadeEmDias: 0 },
    });
    expect(fila[0]?.fatores).toHaveLength(3);
  });

  it('score de outro tenant nunca aparece na fila -- INV-006', async () => {
    const a = await montarAcademia(`f37-${sufixo}-tenant-a`);
    const b = await montarAcademia(`f37-${sufixo}-tenant-b`);

    await scores.pontuarDia(a.contexto, OBSERVACAO);
    await scores.pontuarDia(b.contexto, OBSERVACAO);

    const filaDeA = await consulta.fila(a.contexto, {
      agora: new Date('2026-09-01T12:00:00.000Z'),
      limite: 50,
    });

    expect(filaDeA).toHaveLength(1);
    expect(filaDeA[0]?.studentId).toBe(a.studentId);
    expect(filaDeA.map((s) => s.studentId)).not.toContain(b.studentId);
  });
});
