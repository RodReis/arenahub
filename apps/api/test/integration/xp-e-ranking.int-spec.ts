import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { assinar } from '@arenahub/api-contracts';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { aplicarParserComCorpoCru } from '../../src/common/http/bootstrap-http.js';
import type { TenantContext } from '../../src/common/tenant/tenant-context.js';
import { AttendanceService } from '../../src/modules/health/attendance.service.js';
import { EngagementXpService } from '../../src/modules/engagement/engagement-xp.service.js';
import { EngagementRankingService } from '../../src/modules/engagement/engagement-ranking.service.js';
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { calcularHashDeCpf } from '../../src/modules/students/domain/identificacao.js';
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

  let ranking: EngagementRankingService;

  type Totem = {
    tenantId: string;
    gymUnitId: string;
    kioskDeviceId: string;
    keyId: string;
    segredo: string;
  };

  const totem: Totem = { tenantId: '', gymUnitId: '', kioskDeviceId: '', keyId: '', segredo: '' };

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  /** Mesmo padrao HMAC de `kiosk-engajamento.int-spec.ts`. */
  const assinarPedido = (
    corpo: unknown,
    caminho: string,
    metodo: 'GET' | 'POST' = 'POST',
    tokenDeSessao?: string,
  ): Record<string, string> => {
    const body = metodo === 'GET' || corpo === '' ? '' : JSON.stringify(corpo);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();

    const cabecalhos: Record<string, string> = {
      'x-kiosk-key-id': totem.keyId,
      'x-kiosk-timestamp': String(timestamp),
      'x-kiosk-nonce': nonce,
      'x-kiosk-signature': assinar(
        { keyId: totem.keyId, timestamp, nonce, method: metodo, pathAndQuery: caminho, body },
        totem.segredo,
      ),
    };

    if (tokenDeSessao !== undefined) cabecalhos['x-session-token'] = tokenDeSessao;

    return cabecalhos;
  };

  /** Publica a config do tenant com os modulos que o caso pede. */
  const publicarConfig = async (modulos: Record<string, boolean>, versao: number): Promise<void> => {
    await db.kioskConfiguration.create({
      data: {
        tenantId: totem.tenantId,
        gymUnitId: null,
        kioskDeviceId: null,
        version: versao,
        publishedAt: new Date(),
        payload: {
          sessao: { duracaoSegundos: 60, incrementoSegundos: 30, tetoSegundos: 99 },
          modulos,
        },
      },
    });
  };

  /** Documento de consentimento vigente do tenant -- sem ele, `atualizarPreferencia` recusa. */
  const publicarDocumentoDeRanking = async (): Promise<void> => {
    const conteudo = `Termo de teste RANKING -- ${sufixo}. `.repeat(3);
    const sha = createHash('sha256').update(conteudo, 'utf8').digest('hex');

    await db.consentDocument.create({
      data: {
        tenantId: totem.tenantId,
        type: 'RANKING',
        version: 1,
        purpose: 'Finalidade de teste RANKING',
        content: conteudo,
        contentSha256: sha,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  };

  const abrirSessao = async (cpf: string): Promise<{ sessionId: string; token: string }> => {
    const resposta = await request(servidor())
      .post('/api/v1/kiosk/sessions')
      .set(assinarPedido({ cpf }, '/api/v1/kiosk/sessions'))
      .send({ cpf })
      .expect(201);

    const corpo = resposta.body as { sessionId: string; token: string };

    return { sessionId: corpo.sessionId, token: corpo.token };
  };

  const buscar = (caminho: string, token: string) =>
    request(servidor()).get(caminho).set(assinarPedido('', caminho, 'GET', token));

  const heartbeat = () =>
    request(servidor())
      .post('/api/v1/kiosk/heartbeat')
      .set(assinarPedido({ agentVersion: '1.0.0', localTimeMs: 0 }, '/api/v1/kiosk/heartbeat'))
      .send({ agentVersion: '1.0.0', localTimeMs: 0 });

  /** Aluno de teste com CPF, para abrir sessao de totem. */
  const criarAlunoComCpf = async (cpf: string, nome: string): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId,
        membershipNumber: `F31-CPF-${sufixo}-${String(contadorDeMatricula++).padStart(4, '0')}`,
        fullName: nome,
        birthDate: new Date('2000-01-01'),
        cpf,
        cpfHash: calcularHashDeCpf(tenantId, cpf),
        status: 'ACTIVE',
      },
    });

    return aluno.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
    await app.init();

    db = app.get(PrismaService);
    servico = app.get(EngagementXpService);
    frequencia = app.get(AttendanceService);
    ranking = app.get(EngagementRankingService);

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

    // Totem HTTP para os testes de HEARTBEAT/ENDPOINT (Task 9).
    const dispositivo = await db.kioskDevice.create({
      data: { tenantId, gymUnitId, code: `TOTEM-F31-${sufixo}` },
    });

    const segredo = randomBytes(32).toString('hex');
    const keyId = `kiosk-f31-${sufixo}`;

    await db.kioskCredential.create({
      data: {
        tenantId,
        kioskDeviceId: dispositivo.id,
        keyId,
        encryptedSecret: app.get(KioskAuthService).cifrarSegredo(segredo),
        activeFrom: new Date(Date.now() - 60_000),
        expiresAt: null,
      },
    });

    Object.assign(totem, {
      tenantId,
      gymUnitId,
      kioskDeviceId: dispositivo.id,
      keyId,
      segredo,
    });

    await publicarDocumentoDeRanking();
    await publicarConfig({ xp: true }, 1);
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

  /*
   * ---------------------------------------------------------------------
   * F31, TASK 9 -- ponte do totem: `GET .../engajamento/xp` e o placar no
   * heartbeat. Contra HTTP real (supertest), com a mesma credencial HMAC
   * dos demais endpoints do totem.
   * ---------------------------------------------------------------------
   */
  describe('GET sessions/:id/engajamento/xp', () => {
    /** Aluno com uma sessao confirmada, XP sincronizado e sessao de totem aberta. */
    const sessaoDoAlunoComXp = async (): Promise<{ sessionId: string; token: string; studentId: string }> => {
      const cpf = String(10_000_000_000n + BigInt(contadorDeMatricula) * 111n).padStart(11, '0');
      const aluno = await criarAlunoComCpf(cpf, 'Aluno Com XP');

      await gravarPassagemConfirmada(aluno, '2026-08-17T12:00:00.000Z');
      await projetarFrequencia(aluno);

      const { sessionId, token } = await abrirSessao(cpf);

      return { sessionId, token, studentId: aluno };
    };

    it('devolve saldo, movimentos explicaveis e posicao', async () => {
      const { sessionId, token } = await sessaoDoAlunoComXp();

      const resposta = await buscar(`/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`, token).expect(
        200,
      );

      expect(resposta.body).toMatchObject({ saldoDoMes: 10, mes: '2026-08' });
      // `M5-FR-004` e §13 do PRD: sempre mostrar POR QUE o aluno recebeu.
      const corpo = resposta.body as { movimentos: { pontos: number; regra: string }[] };
      expect(corpo.movimentos[0]).toMatchObject({ pontos: 10, regra: expect.any(String) });
    });

    /*
     * Cada endpoint da area do aluno so serve O ALUNO DAQUELA SESSAO. A
     * memoria `vazamento` e o `tenant-isolation.int-spec.ts` existem porque
     * este e o erro que mais custa caro.
     */
    it('nao devolve XP de aluno de outra sessao', async () => {
      const meu = await sessaoDoAlunoComXp();
      const outro = await sessaoDoAlunoComXp();

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${meu.sessionId}/engajamento/xp`,
        meu.token,
      ).expect(200);

      expect(JSON.stringify(resposta.body)).not.toContain(outro.studentId);
    });
  });

  describe('POST heartbeat -- placar publico', () => {
    /** Publica um placar PUBLICADO com os cinco alunos dados, com nome civil distinguivel. */
    const placarPublicadoCom = async (
      nomes: readonly string[],
    ): Promise<Record<string, string>> => {
      const idPorNome: Record<string, string> = {};

      for (const [indice, nome] of nomes.entries()) {
        const aluno = await criarAluno();
        idPorNome[nome] = aluno;

        await db.student.update({ where: { id: aluno }, data: { fullName: nome } });

        // Pontuacao decrescente: `ana` fica em 1o, e assim por diante --
        // so para o placar ter uma ordem estavel e previsivel no teste.
        const pontos = (nomes.length - indice) * 10;
        await db.studentXpBalance.create({
          data: {
            tenantId: totem.tenantId,
            studentId: aluno,
            localMonth: '2026-08',
            points: pontos,
            entryCount: 1,
            lastEntryAt: new Date('2026-08-20T12:00:00.000Z'),
          },
        });
      }

      const contextoDoTotem: TenantContext = {
        tenantId: totem.tenantId,
        actorId: 'system-f31-task9',
        sessionId: randomUUID(),
        permissions: new Set(),
        allowedUnitIds: 'ALL',
      };

      const snapshot = await ranking.gerarSnapshot(
        contextoDoTotem,
        totem.gymUnitId,
        '2026-08',
        new Date('2026-08-20T12:00:00.000Z'),
      );
      await ranking.publicar(contextoDoTotem, snapshot.id, new Date('2026-08-20T12:00:00.000Z'));

      return idPorNome;
    };

    /** Opt-out de RANKING para o aluno de nome dado, via `ConsentRecord` direto --
     * mais simples que abrir sessao so para isto, e o que o snapshot LE na leitura
     * (`resolverExposicao`) e a decisao vigente, nao a origem HTTP dela. */
    const optOut = async (studentId: string): Promise<void> => {
      const documento = await db.consentDocument.findFirstOrThrow({
        where: { tenantId: totem.tenantId, type: 'RANKING' },
      });

      await db.consentRecord.create({
        data: {
          tenantId: totem.tenantId,
          studentId,
          documentId: documento.id,
          decision: 'REFUSED',
          subjectKind: 'STUDENT',
          subjectAgeYears: 26,
          occurredAt: new Date('2026-08-21T00:00:00.000Z'),
          evidence: {},
        },
      });
    };

    it('entrega o placar ja sem quem pediu opt-out, e sem studentId', async () => {
      const idPorNome = await placarPublicadoCom(['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa']);
      await optOut(idPorNome['Bruno']!);

      const resposta = await heartbeat().expect(200);

      const corpo = resposta.body as { indicadores: { placar: unknown[] } };
      const serializado = JSON.stringify(corpo.indicadores.placar);

      expect(serializado).not.toContain('Bruno');
      expect(serializado).not.toContain('studentId');
      // As demais permanecem -- opt-out de um nao esvazia o placar inteiro.
      expect(serializado).toContain('Ana');
    });
  });
});
