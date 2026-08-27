import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AttendanceService } from '../../src/modules/health/attendance.service.js';
import { EngagementXpService } from '../../src/modules/engagement/engagement-xp.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F31, Task 1 -- o modelo de dados do ledger de XP, conquistas e
 * ranking, contra Postgres real.
 *
 * O que este arquivo prova, e que nenhum dublê alcança:
 *
 *   - a chave unica que garante `M5-AC-002` -- cem replays do mesmo fato
 *     colidem numa linha so, tratados como sucesso idempotente no service,
 *     nao como erro de retry infinito;
 *   - o ledger e append-only DE VERDADE: o trigger no banco recusa UPDATE e
 *     DELETE, nao so a disciplina da aplicacao.
 */
describe('F31 -- XP, conquistas e ranking (integracao)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let servico: EngagementXpService;
  let frequencia: AttendanceService;

  const sufixo = randomUUID().slice(0, 8);

  let tenantId = '';
  let gymUnitId = '';
  let studentId = '';
  let ruleVersionId = '';
  let contadorDeMatricula = 0;

  // `agora` fixo: as sessoes de fixture caem todas em agosto/2026, e o
  // `localMonth` esperado nas asserções ('2026-08') depende de uma data de
  // referencia estavel, nao do relogio real da maquina que roda o teste.
  const AGORA = new Date('2026-08-20T12:00:00.000Z');

  let contexto: TenantContext;

  const criarAluno = async (): Promise<string> => {
    contadorDeMatricula += 1;

    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `F31-${sufixo}-${String(contadorDeMatricula).padStart(4, '0')}`,
        fullName: 'Aluno De Teste Do F31',
        birthDate: new Date('1995-06-15T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    return aluno.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    servico = app.get(EngagementXpService);
    frequencia = app.get(AttendanceService);

    const tenant = await db.tenant.create({
      data: {
        slug: `f31-tenant-${sufixo}`,
        legalName: `F31 ${sufixo} LTDA`,
        displayName: `F31 ${sufixo}`,
      },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: 'CENTRO',
        name: `Centro ${sufixo}`,
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    gymUnitId = unidade.id;

    studentId = await criarAluno();

    const regra = await db.xpRuleVersion.create({
      data: {
        tenantId,
        code: 'treino-diario',
        version: 1,
        trigger: 'SESSAO_CONFIRMADA',
        points: 10,
        status: 'APPROVED',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    ruleVersionId = regra.id;

    contexto = {
      tenantId,
      actorId: 'system-f31-task7',
      sessionId: randomUUID(),
      permissions: new Set(),
      allowedUnitIds: 'ALL',
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  /**
   * Grava uma passagem CONFIRMADA e projeta a sessao de frequencia pelo
   * caminho REAL (`AttendanceService.frequenciaDoAluno`), como a F24 exige --
   * inserir `StudentAttendanceSession` na mao provaria so a tabela isolada,
   * nunca a cadeia inteira (evento -> passagem -> projecao -> XP).
   */
  const gravarPassagemConfirmada = async (aluno: string, occurredAt: string): Promise<void> => {
    const evento = await db.accessEvent.create({
      data: {
        tenantId,
        gymUnitId,
        studentId: aluno,
        outcome: 'ALLOW',
        reason: 'ACTIVE_ENTITLEMENT',
        policyVersion: '1.1.0',
        mode: 'ONLINE',
        method: 'FACIAL',
        occurredAt: new Date(occurredAt),
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        detail: {},
      },
    });

    await db.accessPassage.create({
      data: { accessEventId: evento.id, state: 'CONFIRMED' },
    });
  };

  /** Forca a projecao de `StudentAttendanceSession` a partir das passagens gravadas. */
  const projetarFrequencia = async (aluno: string): Promise<void> => {
    await frequencia.frequenciaDoAluno(contexto, aluno, 'ALL', 'SEMANAL', AGORA);
  };

  /** Aluno com uma unica sessao ja projetada e pronta para receber XP. */
  const alunoComUmaSessaoConfirmada = async (): Promise<{ studentId: string; sessionId: string }> => {
    const aluno = await criarAluno();
    await gravarPassagemConfirmada(aluno, '2026-08-17T12:00:00.000Z');
    await projetarFrequencia(aluno);

    const sessao = await db.studentAttendanceSession.findFirstOrThrow({
      where: { tenantId, studentId: aluno },
    });

    return { studentId: aluno, sessionId: sessao.id };
  };

  /** Duas passagens no MESMO dia local -- a F24 garante que viram UMA sessao. */
  const alunoComDuasPassagensNoMesmoDia = async (): Promise<{ studentId: string }> => {
    const aluno = await criarAluno();
    await gravarPassagemConfirmada(aluno, '2026-08-17T11:00:00.000Z');
    await gravarPassagemConfirmada(aluno, '2026-08-17T20:00:00.000Z');
    await projetarFrequencia(aluno);

    return { studentId: aluno };
  };

  /** Aluno com tres sessoes em dias distintos -- fixture da reconstrucao. */
  const alunoComTresSessoes = async (): Promise<{ studentId: string }> => {
    const aluno = await criarAluno();
    await gravarPassagemConfirmada(aluno, '2026-08-10T12:00:00.000Z');
    await gravarPassagemConfirmada(aluno, '2026-08-12T12:00:00.000Z');
    await gravarPassagemConfirmada(aluno, '2026-08-14T12:00:00.000Z');
    await projetarFrequencia(aluno);

    return { studentId: aluno };
  };

  it('recusa dois movimentos identicos para o mesmo fato', async () => {
    const sessionId = randomUUID();
    const chave = {
      tenantId,
      studentId,
      sourceKind: 'ATTENDANCE_SESSION' as const,
      sourceId: sessionId,
      ruleVersionId,
      type: 'GRANT' as const,
    };

    await db.xpLedgerEntry.create({
      data: { ...chave, points: 10, occurredAt: new Date('2026-08-10T12:00:00Z'), localMonth: '2026-08' },
    });

    await expect(
      db.xpLedgerEntry.create({
        data: { ...chave, points: 10, occurredAt: new Date('2026-08-10T12:00:00Z'), localMonth: '2026-08' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('recusa UPDATE e DELETE no ledger', async () => {
    const entrada = await db.xpLedgerEntry.create({
      data: {
        tenantId,
        studentId,
        sourceKind: 'ATTENDANCE_SESSION',
        sourceId: randomUUID(),
        ruleVersionId,
        type: 'GRANT',
        points: 10,
        occurredAt: new Date('2026-08-11T12:00:00Z'),
        localMonth: '2026-08',
      },
    });

    await expect(
      db.xpLedgerEntry.update({ where: { id: entrada.id }, data: { points: 999 } }),
    ).rejects.toThrow(/XP_LEDGER_APPEND_ONLY/u);

    await expect(
      db.xpLedgerEntry.delete({ where: { id: entrada.id } }),
    ).rejects.toThrow(/XP_LEDGER_APPEND_ONLY/u);
  });

  /*
   * `M5-AC-002`: "reprocessar cem vezes o mesmo evento gera uma concessao de
   * XP".
   *
   * Contra Postgres de verdade, com as cem chamadas de fato concorrentes. Um
   * teste sequencial aqui passaria verde sem medir nada: a guarda que le
   * antes de escrever so falha quando duas escritas se cruzam, e em serie
   * elas nunca se cruzam. A memoria `revisao-adversarial-acha-corrida`
   * registra tres versoes erradas deste mesmo teste na F17.
   */
  it('cem sincronizacoes CONCORRENTES geram uma concessao so', async () => {
    const { studentId: aluno, sessionId } = await alunoComUmaSessaoConfirmada();

    await Promise.allSettled(
      Array.from({ length: 100 }, () => servico.sincronizarXp(contexto, aluno, AGORA)),
    );

    const movimentos = await db.xpLedgerEntry.findMany({
      where: { tenantId, studentId: aluno, sourceKind: 'ATTENDANCE_SESSION', sourceId: sessionId },
    });

    expect(movimentos).toHaveLength(1);
    expect(movimentos[0]?.points).toBe(10);

    /*
     * O SALDO tambem, e nao so a contagem de linhas: a memoria
     * `idempotencia-derivada-de-contagem` registra a cobranca em dobro que
     * passou por uma guarda que contava certo e somava errado.
     */
    const saldo = await db.studentXpBalance.findUniqueOrThrow({
      where: { tenantId_studentId_localMonth: { tenantId, studentId: aluno, localMonth: '2026-08' } },
    });
    expect(saldo.points).toBe(10);
    expect(saldo.entryCount).toBe(1);
  });

  /*
   * `M5-AC-003`: duas entradas no mesmo dia nao duplicam XP. A garantia vem
   * da F24 -- duas passagens no mesmo dia local formam UMA
   * `StudentAttendanceSession` -- e este teste prova que a cadeia inteira
   * preserva isso, nao so a tabela isolada.
   */
  it('duas passagens no mesmo dia geram um unico GRANT', async () => {
    const { studentId: aluno } = await alunoComDuasPassagensNoMesmoDia();

    await servico.sincronizarXp(contexto, aluno, AGORA);

    const movimentos = await db.xpLedgerEntry.findMany({ where: { tenantId, studentId: aluno } });

    expect(movimentos).toHaveLength(1);
  });

  /*
   * `M5-NFR-002`: a projecao e reconstruivel. Apagar o saldo e refaze-lo do
   * ledger tem de dar o mesmo numero -- se nao der, o ledger deixou de ser a
   * fonte da verdade sem ninguem perceber.
   */
  it('reconstroi o saldo a partir do ledger', async () => {
    const { studentId: aluno } = await alunoComTresSessoes();
    await servico.sincronizarXp(contexto, aluno, AGORA);

    const antes = await db.studentXpBalance.findUniqueOrThrow({
      where: { tenantId_studentId_localMonth: { tenantId, studentId: aluno, localMonth: '2026-08' } },
    });

    await db.studentXpBalance.deleteMany({ where: { tenantId, studentId: aluno } });
    await servico.reconstruirProjecao(contexto, aluno);

    const depois = await db.studentXpBalance.findUniqueOrThrow({
      where: { tenantId_studentId_localMonth: { tenantId, studentId: aluno, localMonth: '2026-08' } },
    });

    expect(depois.points).toBe(antes.points);
    expect(depois.entryCount).toBe(antes.entryCount);
  });
});
