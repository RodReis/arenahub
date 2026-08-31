import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../../src/app.module.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { RetentionSnapshotsService } from '../../src/modules/retention/retention-snapshots.service.js';
import {
  PORTA_DE_RETENCAO,
  SnapshotNaoDeterministicoError,
  type PortaDeRetencao,
} from '../../src/modules/retention/retention-snapshots.repository.js';
import { POLITICA_DE_SESSAO } from '../../src/modules/health/domain/frequencia.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Fatia F36 -- contrato de dados e baseline analitica, contra o banco real.
 *
 * O QUE ESTE ARQUIVO PROVA, e que teste de funcao pura NAO alcanca:
 *
 *   - o ACEITE LITERAL da Slice 6.1: um snapshot passado e reproduzido usando
 *     so o que se sabia naquela data -- o mesmo checksum, calculado duas vezes
 *     com o mesmo corte de conhecimento;
 *   - a INADIMPLENCIA e reconstruida por DATA e nao por `Invoice.status`: uma
 *     invoice paga hoje continua aparecendo como vencida no snapshot do mes
 *     passado, que e onde o sinal de churn mora;
 *   - a passagem sincronizada TARDE nao entra retroativamente -- `M6-FR-003`,
 *     e o defeito que nao tem sintoma visivel ate o modelo da F40 errar;
 *   - recalcular com dado NOVO acusa `SNAPSHOT_NAO_DETERMINISTICO` em vez de
 *     sobrescrever a evidencia em silencio;
 *   - isolamento entre tenants (INV-006, regra de arquitetura no 2).
 */
describe('F36 -- snapshot point-in-time', () => {
  let app: INestApplication;
  let db: PrismaService;
  let service: RetentionSnapshotsService;
  let porta: PortaDeRetencao;

  const sufixo = randomUUID().slice(0, 8);

  const OBSERVACAO = new Date('2026-08-31T00:00:00.000Z');
  const VERSOES = { alvo: 'alvo@1', features: 'features@1' };

  /** Uma academia semeada com o minimo que a fatia le. */
  interface Academia {
    tenantId: string;
    gymUnitId: string;
    studentId: string;
    alvoId: string;
    featuresId: string;
    contexto: TenantContext;
  }

  const contexto = (tenantId: string): TenantContext => ({
    tenantId,
    actorId: randomUUID(),
    sessionId: randomUUID(),
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  });

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

    const aluno = await db.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        fullName: 'Aluno De Retencao',
        birthDate: new Date('1990-05-10T00:00:00.000Z'),
        membershipNumber: `${slug}-1`,
        status: 'ACTIVE',
      },
    });

    const alvo = await db.retentionTargetVersion.create({
      data: {
        tenantId: tenant.id,
        label: VERSOES.alvo,
        featureWindowDays: 90,
        predictionDays: 30,
        confirmationDays: 30,
      },
    });

    const features = await db.retentionFeatureSetVersion.create({
      data: {
        tenantId: tenant.id,
        label: VERSOES.features,
        featureNames: [],
      },
    });

    return {
      tenantId: tenant.id,
      gymUnitId: unidade.id,
      studentId: aluno.id,
      alvoId: alvo.id,
      featuresId: features.id,
      contexto: contexto(tenant.id),
    };
  };

  /** Uma assinatura ativa que comecou ha bastante tempo. */
  const criarAssinatura = async (academia: Academia): Promise<void> => {
    const plano = await db.plan.create({
      data: {
        tenantId: academia.tenantId,
        name: `Mensal ${academia.studentId.slice(0, 8)}`,
        billingMode: 'ASSINATURA',
      },
    });

    await db.subscription.create({
      data: {
        tenantId: academia.tenantId,
        studentId: academia.studentId,
        planId: plano.id,
        status: 'ACTIVE',
        startsAt: new Date('2025-06-01T00:00:00.000Z'),
      },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    service = app.get(RetentionSnapshotsService);
    porta = app.get<PortaDeRetencao>(PORTA_DE_RETENCAO);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reproduz o mesmo checksum recalculando o mesmo recorte', async () => {
    // O ACEITE DA SLICE, verificado contra o banco.
    const academia = await montarAcademia(`f36-repro-${sufixo}`);
    await criarAssinatura(academia);

    const recorte = { observadoEm: OBSERVACAO, corteDeConhecimento: OBSERVACAO };

    const primeiro = await service.calcular(
      academia.contexto,
      academia.studentId,
      recorte,
      VERSOES,
    );
    const segundo = await service.calcular(academia.contexto, academia.studentId, recorte, VERSOES);

    expect(segundo.checksum).toBe(primeiro.checksum);
    expect(primeiro.valores).toHaveLength(13);
  });

  /*
   * O CASO QUE JUSTIFICA NAO LER `Invoice.status`.
   *
   * A invoice venceu em 10/08 e foi paga em 05/09. No snapshot de 31/08 ela
   * ESTAVA vencida -- e e esse o sinal de churn. Lendo o status de hoje
   * (`PAID`), o sinal desapareceria do historico inteiro.
   */
  it('reconhece invoice vencida na observacao mesmo tendo sido paga depois', async () => {
    const academia = await montarAcademia(`f36-atraso-${sufixo}`);
    await criarAssinatura(academia);

    const assinatura = await db.subscription.findFirstOrThrow({
      where: { tenantId: academia.tenantId, studentId: academia.studentId },
    });

    await db.invoice.create({
      data: {
        tenantId: academia.tenantId,
        subscriptionId: assinatura.id,
        studentId: academia.studentId,
        billingPeriod: new Date('2026-08-01T00:00:00.000Z'),
        status: 'PAID',
        number: 1,
        subtotalMinor: 10_000,
        totalMinor: 10_000,
        dueAt: new Date('2026-08-10T00:00:00.000Z'),
        paidAt: new Date('2026-09-05T00:00:00.000Z'),
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });

    const snapshot = await service.calcular(
      academia.contexto,
      academia.studentId,
      { observadoEm: OBSERVACAO, corteDeConhecimento: OBSERVACAO },
      VERSOES,
    );

    const vencidas = snapshot.valores.find((item) => item.nome === 'past_due_invoice_count');
    const atraso = snapshot.valores.find((item) => item.nome === 'days_past_due');

    expect(vencidas?.valor).toBe(1);
    expect(atraso?.valor).toBe(21);
  });

  /*
   * `M6-FR-003`: a sessao ocorreu dentro da janela mas so foi GRAVADA depois
   * do corte (catraca offline que sincronizou tarde). Ela nao pode entrar.
   */
  it('ignora sessao gravada depois do corte de conhecimento', async () => {
    const academia = await montarAcademia(`f36-tarde-${sufixo}`);
    await criarAssinatura(academia);

    await db.studentAttendanceSession.create({
      data: {
        tenantId: academia.tenantId,
        studentId: academia.studentId,
        gymUnitId: academia.gymUnitId,
        sessionDate: new Date('2026-08-20T00:00:00.000Z'),
        firstPassageAt: new Date('2026-08-20T07:00:00.000Z'),
        lastPassageAt: new Date('2026-08-20T08:00:00.000Z'),
        passageCount: 1,
        passageIds: [randomUUID()],
        policyVersion: POLITICA_DE_SESSAO,
        // Sincronizada DEPOIS da observacao.
        createdAt: new Date('2026-09-10T19:00:00.000Z'),
        updatedAt: new Date('2026-09-10T19:00:00.000Z'),
      },
    });

    const doDia31 = await service.calcular(
      academia.contexto,
      academia.studentId,
      { observadoEm: OBSERVACAO, corteDeConhecimento: OBSERVACAO },
      VERSOES,
    );

    /*
     * A sessao NAO entra. E o valor sai AUSENTE, nao zero: filtrada pelo corte,
     * ela tambem nao conta como primeiro fato do aluno, entao a janela de 30
     * dias nao esta coberta. As duas regras compondo -- e o resultado certo:
     * no dia 31 o sistema nao sabia nada sobre este aluno.
     */
    const doDia31Trinta = doDia31.valores.find((item) => item.nome === 'attendance_days_30d');

    expect(doDia31Trinta?.valor).toBeNull();
    expect(doDia31Trinta?.razao).toBe('SEM_HISTORICO');

    /*
     * CONTRAPROVA: a sessao nao esta proibida, so chega mais tarde. Com o
     * corte em setembro ela e conhecida e passa a contar.
     *
     * A assercao usa `days_since_last_confirmed_passage` porque essa feature
     * nao depende de cobertura de janela -- se ela enxerga a sessao, o filtro
     * de conhecimento e o unico responsavel pela diferenca, que e exatamente
     * o que este teste isola.
     */
    const deSetembro = await service.calcular(
      academia.contexto,
      academia.studentId,
      {
        observadoEm: new Date('2026-09-15T00:00:00.000Z'),
        corteDeConhecimento: new Date('2026-09-15T00:00:00.000Z'),
      },
      VERSOES,
    );

    expect(
      doDia31.valores.find((item) => item.nome === 'days_since_last_confirmed_passage')?.razao,
    ).toBe('SEM_HISTORICO');
    expect(
      deSetembro.valores.find((item) => item.nome === 'days_since_last_confirmed_passage')?.valor,
    ).toBe(25);
  });

  it('grava o snapshot e reconhece a reexecucao identica', async () => {
    const academia = await montarAcademia(`f36-grava-${sufixo}`);
    await criarAssinatura(academia);

    const recorte = { observadoEm: OBSERVACAO, corteDeConhecimento: OBSERVACAO };
    const snapshot = await service.calcular(
      academia.contexto,
      academia.studentId,
      recorte,
      VERSOES,
    );

    const versoes = { alvoId: academia.alvoId, featuresId: academia.featuresId };

    const primeira = await porta.gravarSnapshot(academia.contexto, snapshot, versoes);
    const segunda = await porta.gravarSnapshot(academia.contexto, snapshot, versoes);

    expect(primeira.criado).toBe(true);
    // Reexecucao do worker nao duplica nem falha.
    expect(segunda.criado).toBe(false);
    expect(segunda.snapshotId).toBe(primeira.snapshotId);

    const valores = await db.studentFeatureValue.findMany({
      where: { snapshotId: primeira.snapshotId },
      select: { name: true, value: true, missingReason: true, provenance: true },
    });

    expect(valores).toHaveLength(13);

    // AUSENTE NAO E ZERO -- a distincao chega ao banco.
    const ausentes = valores.filter((item) => item.value === null);
    expect(ausentes.every((item) => item.missingReason !== null)).toBe(true);

    // So a feature de falha de pagamento carrega a marca da decisao do PI.
    const correntes = valores.filter((item) => item.provenance === 'CURRENT_STATE');
    expect(correntes.map((item) => item.name)).toEqual(['payment_failure_count_90d']);
  });

  /*
   * A guarda que impede o pior desfecho: o pipeline deixar de ser
   * reproduzivel e ninguem ficar sabendo. Aqui um fato NOVO e conhecido
   * dentro do mesmo recorte -- o checksum muda, e a gravacao RECUSA.
   */
  /*
   * A CORRIDA REAL, e nao duas chamadas em fila.
   *
   * Dois workers (retry do job + reprocessamento manual, ou duas replicas do
   * mesmo cron) chamam `gravarSnapshot` ao mesmo tempo. Os dois passam pelo
   * `findUnique` antes de qualquer `create` commitar, e o segundo colide na
   * chave unica. Sem tratar o P2002, o job cairia com erro cru justamente na
   * reexecucao que o metodo promete ser inofensiva.
   *
   * `Promise.all` de verdade -- sequencial nao exercita nada disto.
   */
  it('sobrevive a duas gravacoes concorrentes do mesmo snapshot', async () => {
    const academia = await montarAcademia(`f36-corrida-${sufixo}`);
    await criarAssinatura(academia);

    const snapshot = await service.calcular(
      academia.contexto,
      academia.studentId,
      { observadoEm: OBSERVACAO, corteDeConhecimento: OBSERVACAO },
      VERSOES,
    );

    const versoes = { alvoId: academia.alvoId, featuresId: academia.featuresId };

    const resultados = await Promise.all([
      porta.gravarSnapshot(academia.contexto, snapshot, versoes),
      porta.gravarSnapshot(academia.contexto, snapshot, versoes),
      porta.gravarSnapshot(academia.contexto, snapshot, versoes),
    ]);

    // Exatamente UM cria; os outros reconhecem o vencedor. Nenhum estoura.
    expect(resultados.filter((item) => item.criado)).toHaveLength(1);
    expect(new Set(resultados.map((item) => item.snapshotId)).size).toBe(1);

    // E o banco tem uma linha so -- a chave unica e quem decidiu.
    const gravados = await db.studentFeatureSnapshot.count({
      where: { tenantId: academia.tenantId, studentId: academia.studentId },
    });

    expect(gravados).toBe(1);
  });

  it('acusa SNAPSHOT_NAO_DETERMINISTICO em vez de sobrescrever', async () => {
    const academia = await montarAcademia(`f36-determinismo-${sufixo}`);
    await criarAssinatura(academia);

    const recorte = { observadoEm: OBSERVACAO, corteDeConhecimento: OBSERVACAO };
    const versoes = { alvoId: academia.alvoId, featuresId: academia.featuresId };

    const original = await service.calcular(
      academia.contexto,
      academia.studentId,
      recorte,
      VERSOES,
    );
    await porta.gravarSnapshot(academia.contexto, original, versoes);

    // Um fato que o snapshot original nao viu, dentro da janela e do corte.
    await db.studentAttendanceSession.create({
      data: {
        tenantId: academia.tenantId,
        studentId: academia.studentId,
        gymUnitId: academia.gymUnitId,
        sessionDate: new Date('2026-08-25T00:00:00.000Z'),
        firstPassageAt: new Date('2026-08-25T07:00:00.000Z'),
        lastPassageAt: new Date('2026-08-25T08:00:00.000Z'),
        passageCount: 1,
        passageIds: [randomUUID()],
        policyVersion: POLITICA_DE_SESSAO,
        createdAt: new Date('2026-08-25T08:00:00.000Z'),
        updatedAt: new Date('2026-08-25T08:00:00.000Z'),
      },
    });

    const recalculado = await service.calcular(
      academia.contexto,
      academia.studentId,
      recorte,
      VERSOES,
    );

    expect(recalculado.checksum).not.toBe(original.checksum);
    await expect(
      porta.gravarSnapshot(academia.contexto, recalculado, versoes),
    ).rejects.toBeInstanceOf(SnapshotNaoDeterministicoError);
  });

  it('nao enxerga aluno de outro tenant', async () => {
    // INV-006 e regra de arquitetura no 2.
    const a = await montarAcademia(`f36-iso-a-${sufixo}`);
    const b = await montarAcademia(`f36-iso-b-${sufixo}`);
    await criarAssinatura(a);
    await criarAssinatura(b);

    const elegiveisDeA = await service.elegiveis(a.contexto, OBSERVACAO);

    expect(elegiveisDeA).toContain(a.studentId);
    expect(elegiveisDeA).not.toContain(b.studentId);
  });
});
