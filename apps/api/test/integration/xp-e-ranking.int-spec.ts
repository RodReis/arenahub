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
import { KioskAuthService } from '../../src/modules/kiosk-auth/kiosk-auth.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { calcularHashDeCpf } from '../../src/modules/students/domain/identificacao.js';
import { inicioDaSemanaLocal } from '../../src/modules/engagement/domain/semana-de-consistencia.js';
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
  //
  // VALE SO PARA O QUE RECEBE `AGORA` POR PARAMETRO. Os casos de uso que leem
  // o relogio de dentro (`new Date()` no controller) NAO enxergam este valor;
  // para eles a fixture tem de nascer do relogio real, senao a suite passa
  // enquanto o mes real coincide com agosto e quebra na virada -- foi o que
  // aconteceu em 01/09/2026 (issue #237).
  const AGORA = new Date('2026-08-20T12:00:00.000Z');

  /**
   * O dia civil de HOJE no fuso da academia, como o codigo de producao o
   * calcula. Serve as fixtures lidas por caso de uso que usa o relogio real.
   */
  const hojeLocal = (): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  let contexto: TenantContext;

  /** `gymUnitIdDoAluno` OMITIDO (padrao) = a unidade principal da suite --
   * os testes de escopo (Task 11, correcao critica) passam a segunda
   * unidade explicitamente. */
  const criarAluno = async (gymUnitIdDoAluno?: string): Promise<string> => {
    contadorDeMatricula += 1;

    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: gymUnitIdDoAluno ?? gymUnitId,
        membershipNumber: `F31-${sufixo}-${String(contadorDeMatricula).padStart(4, '0')}`,
        fullName: 'Aluno De Teste Do F31',
        birthDate: new Date('1995-06-15T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    return aluno.id;
  };

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

  const cookieDeAcesso = (resposta: request.Response): string => {
    const cabecalho: unknown = resposta.headers['set-cookie'];
    const lista: string[] = Array.isArray(cabecalho) ? (cabecalho as string[]) : [];

    return lista.find((c) => c.startsWith('arenahub_access=')) ?? '';
  };

  /**
   * Usuario de PAINEL com exatamente as permissoes pedidas -- mesmo padrao
   * de `billing-http.int-spec.ts`. Task 11: as rotas de placar/XP do painel
   * sao autenticadas por sessao (cookie), nao pelo HMAC do totem.
   */
  /**
   * `gymUnitIdDoPapel` OMITIDO (padrao) = papel vale no tenant inteiro
   * (`allowedUnitIds: 'ALL'`, ver `AuthGuard.montarContexto`). Passar um
   * `gymUnitId` cria um ator RESTRITO aquela unidade -- e o que os testes
   * de escopo (Task 11, correcao critica) precisam para provar que um
   * gerente de uma unidade nao age sobre outra.
   */
  const criarUsuarioCom = async (
    rotulo: string,
    codigos: readonly string[],
    gymUnitIdDoPapel?: string,
  ): Promise<string> => {
    const usuario = await db.user.create({
      data: {
        email: `f31-${rotulo}-${sufixo}@exemplo.test`,
        passwordHash: await app.get(PasswordService).gerarHash('senha-de-teste-f31'),
      },
    });

    await db.tenantMembership.create({ data: { tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId, name: `PAPEL_${rotulo}_${sufixo}`, isSystem: false },
    });

    for (const code of codigos) {
      const permissao = await db.permission.upsert({
        where: { code },
        create: { code },
        update: {},
      });

      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({
      data: { tenantId, userId: usuario.id, roleId: papel.id, gymUnitId: gymUnitIdDoPapel ?? null },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email: usuario.email, password: 'senha-de-teste-f31' });

    return cookieDeAcesso(login);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    aplicarParserComCorpoCru(app);
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
  const projetarFrequencia = async (aluno: string, agora: Date = AGORA): Promise<void> => {
    await frequencia.frequenciaDoAluno(contexto, aluno, 'ALL', 'SEMANAL', agora);
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

      /*
       * Passagem em HOJE, nao em agosto literal: o endpoint de XP da area do
       * aluno le o relogio REAL (`new Date()` no controller), nao o `AGORA`
       * desta suite. Com a passagem em agosto, o saldo caia num mes que o
       * endpoint nao consultava, e a resposta vinha vazia -- invisivel
       * enquanto o mes real era agosto.
       */
      const agoraReal = new Date();
      /*
       * DENTRO DO DIA LOCAL E JA NO PASSADO -- as duas condicoes, e nenhuma
       * das duas e obvia:
       *
       *   `T12:00Z` fixo esta no FUTURO quando a suite roda de madrugada, e
       *   passagem futura nao vira sessao -- o saldo voltava 0.
       *
       *   `agora - 1h` cego cai em ONTEM entre 00:00 e 01:00 no fuso da
       *   academia, e ai a sessao nasce fora do mes/dia que o endpoint
       *   consulta.
       *
       * O maior entre os dois satisfaz as duas em qualquer horario.
       */
      const umaHoraAtras = new Date(agoraReal.getTime() - 60 * 60 * 1000);
      const logoAposMeiaNoiteLocal = new Date(`${hojeLocal()}T00:05:00.000-03:00`);
      const quandoPassou =
        umaHoraAtras > logoAposMeiaNoiteLocal ? umaHoraAtras : logoAposMeiaNoiteLocal;

      await gravarPassagemConfirmada(aluno, quandoPassou.toISOString());
      await projetarFrequencia(aluno, agoraReal);

      const { sessionId, token } = await abrirSessao(cpf);

      return { sessionId, token, studentId: aluno };
    };

    it('devolve saldo, movimentos explicaveis e posicao', async () => {
      const { sessionId, token } = await sessaoDoAlunoComXp();

      const resposta = await buscar(`/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`, token).expect(
        200,
      );

      // `mes` derivado do relogio, nao '2026-08' literal: o endpoint responde o
      // mes CORRENTE, e a assercao tem de acompanhar (issue #237).
      expect(resposta.body).toMatchObject({ saldoDoMes: 10, mes: hojeLocal().slice(0, 7) });
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

    /*
     * `M5-FR-007` e §13 do PRD: revogacao e movimento compensatorio
     * auditado, NAO exclusao -- a conquista revertida continua visivel, MAS
     * so mostrar "Revertida" sem dizer por que levanta a pergunta sem
     * responder, o que e pior do que nao mostrar nada. `motivo` prende essa
     * garantia direto no corpo HTTP que o totem consome -- e o unico teste
     * que passaria mesmo com `conquistasDoExtrato` esquecendo de selecionar
     * `reversedReason`.
     */
    it('devolve o motivo de uma conquista revertida', async () => {
      const { sessionId, token, studentId: aluno } = await sessaoDoAlunoComXp();

      await servico.sincronizarXp(contexto, aluno, AGORA);
      const evidencia = await db.xpLedgerEntry.findFirstOrThrow({
        where: { tenantId, studentId: aluno },
      });

      const definicao = await db.achievementDefinitionVersion.create({
        data: {
          tenantId,
          code: `motivo-revertido-${sufixo}`,
          version: 1,
          title: 'Primeira semana completa',
          criterionKind: 'SESSOES_ACUMULADAS',
          threshold: 1,
          effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        },
      });

      const motivoEsperado = 'presenca lancada por engano na catraca';
      await db.studentAchievement.create({
        data: {
          tenantId,
          studentId: aluno,
          definitionVersionId: definicao.id,
          unlockedAt: AGORA,
          evidenceEntryId: evidencia.id,
          status: 'REVERSED',
          reversedAt: AGORA,
          reversedReason: motivoEsperado,
        },
      });

      const resposta = await buscar(`/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`, token).expect(
        200,
      );

      const corpo = resposta.body as {
        conquistas: { titulo: string; revertida: boolean; motivo: string | null }[];
      };
      const conquistaRevertida = corpo.conquistas.find((c) => c.titulo === 'Primeira semana completa');

      expect(conquistaRevertida).toMatchObject({ revertida: true, motivo: motivoEsperado });
    });
  });

  describe('POST heartbeat -- placar publico', () => {
    /**
     * O heartbeat le o placar AO VIVO (Emenda de 27/08/2026, ADR-047) com o
     * `agora` REAL do controller (`new Date()`), nao o `AGORA` fixo desta
     * suite -- entao o saldo tem de cair no mes CORRENTE de verdade, e nao
     * num snapshot publicado (que so existe para mes FECHADO agora).
     */
    const mesCorrente = (): string => {
      const formatador = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      return formatador.format(new Date()).slice(0, 7);
    };

    /** Grava saldo de XP direto (sem snapshot) para os alunos dados, com nome
     * civil distinguivel -- o placar AO VIVO le `StudentXpBalance`, nunca
     * snapshot, para o mes corrente. */
    const placarAoVivoCom = async (
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
            localMonth: mesCorrente(),
            points: pontos,
            entryCount: 1,
            lastEntryAt: new Date(),
          },
        });
      }

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
      const idPorNome = await placarAoVivoCom(['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa']);
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

  /**
   * Fatia F31, Task 11 -- painel: publicar placar e ajustar XP.
   *
   * NAO HA ROTA DE EDICAO: o teste central desta secao prova que o ajuste
   * GRAVA um movimento novo sem apagar o original (`M5-FR-007`), e que o
   * mesmo `idempotencyKey` repetido nao duplica (a chave unica do ledger
   * quem garante, nao um `if` no controller).
   */
  describe('painel -- publicar placar e ajustar XP', () => {
    let cookieModerador: string;
    let cookieSemPermissao: string;
    /** Moderador RESTRITO a `gymUnitId` -- o escopo do proprio `beforeAll`,
     * usado como "UNIDADE_A" nos testes de escopo abaixo. */
    let cookieModeradorRestrito: string;
    /** Segunda unidade -- "UNIDADE_B" nos testes de escopo: o gerente
     * restrito a `gymUnitId` nunca pode agir sobre ela. */
    let outraUnidadeId: string;

    beforeAll(async () => {
      // As DUAS permissoes: gerar/publicar placar exige `engagement.moderate`,
      // corrigir XP exige `engagement.correct` (F35, ADR-049 Decisao 2).
      cookieModerador = await criarUsuarioCom('moderador-t11', [
        'engagement.moderate',
        'engagement.correct',
      ]);
      cookieSemPermissao = await criarUsuarioCom('sem-permissao-t11', []);
      cookieModeradorRestrito = await criarUsuarioCom(
        'moderador-restrito-t11',
        ['engagement.moderate', 'engagement.correct'],
        gymUnitId,
      );

      const outraUnidade = await db.gymUnit.create({
        data: {
          tenantId,
          code: 'OUTRA-T11',
          name: `Outra Unidade T11 ${sufixo}`,
          timezone: 'America/Sao_Paulo',
          openingHours: {},
        },
      });
      outraUnidadeId = outraUnidade.id;
    });

    it('sem permissao, 403 ao publicar', async () => {
      // Mes PROPRIO desta suite (nao '2026-08'): a suite de heartbeat acima
      // ja publica um snapshot de '2026-08' para este `gymUnitId`, e a chave
      // unica `(tenantId, gymUnitId, localMonth)` colidiria.
      const aluno = await criarAluno();
      await db.studentXpBalance.create({
        data: {
          tenantId,
          studentId: aluno,
          localMonth: '2026-10',
          points: 10,
          entryCount: 1,
          lastEntryAt: AGORA,
        },
      });

      const gerado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${gymUnitId}/2026-10/gerar`)
        .set('Cookie', cookieModerador)
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Cookie', cookieSemPermissao)
        .expect(403);
    });

    /*
     * Correcao critica (F31, Task 11): um gerente restrito a `gymUnitId`
     * gerava e publicava DEFINITIVAMENTE o placar de `outraUnidadeId` so
     * por saber o UUID dela na URL -- `M5-AC-007` torna a publicacao
     * irreversivel, e o `SnapshotDto` devolve `entries[].studentId`, entao
     * o gerente ainda receberia a lista de alunos da unidade alheia.
     */
    it('moderador restrito nao gera placar de outra unidade', async () => {
      const aluno = await criarAluno(outraUnidadeId);
      await db.studentXpBalance.create({
        data: {
          tenantId,
          studentId: aluno,
          localMonth: '2026-11',
          points: 10,
          entryCount: 1,
          lastEntryAt: AGORA,
        },
      });

      await request(servidor())
        .post(`/api/v1/engagement/rankings/${outraUnidadeId}/2026-11/gerar`)
        .set('Cookie', cookieModeradorRestrito)
        .expect(404);
    });

    /*
     * Caso positivo: sem a guarda de escopo, um teste que so recusa tudo
     * passaria igual. O 201 sozinho ja prova que a PROPRIA unidade nao e
     * barrada -- o `status` pode ser WITHHELD (coorte de 1 aluno fica abaixo
     * do minimo do tenant) sem que isso seja falha de escopo nenhuma.
     */
    it('moderador restrito gera placar da propria unidade', async () => {
      const aluno = await criarAluno();
      await db.studentXpBalance.create({
        data: {
          tenantId,
          studentId: aluno,
          localMonth: '2026-11',
          points: 10,
          entryCount: 1,
          lastEntryAt: AGORA,
        },
      });

      await request(servidor())
        .post(`/api/v1/engagement/rankings/${gymUnitId}/2026-11/gerar`)
        .set('Cookie', cookieModeradorRestrito)
        .expect(201);
    });

    /*
     * `publicar` nao recebe `gymUnitId` na URL, so `snapshotId` -- a
     * correcao tem de carregar o snapshot e checar a unidade DELE. O
     * snapshot de `outraUnidadeId` foi gerado por um moderador `ALL`.
     */
    it('moderador restrito nao publica snapshot de outra unidade', async () => {
      const aluno = await criarAluno(outraUnidadeId);
      await db.studentXpBalance.create({
        data: {
          tenantId,
          studentId: aluno,
          localMonth: '2026-12',
          points: 10,
          entryCount: 1,
          lastEntryAt: AGORA,
        },
      });

      const gerado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${outraUnidadeId}/2026-12/gerar`)
        .set('Cookie', cookieModerador)
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      const resposta = await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Cookie', cookieModeradorRestrito)
        .expect(404);

      expect((resposta.body as { code: string }).code).toBe('RANKING_SNAPSHOT_NAO_ENCONTRADO');
    });

    /* Caso positivo: moderador restrito publicando o proprio snapshot. */
    it('moderador restrito publica snapshot da propria unidade', async () => {
      // Coorte de 5 -- o minimo padrao do tenant (`rankingMinimumCohort`).
      // Precisa fechar DRAFT (nao WITHHELD) para haver algo publicavel.
      for (let indice = 0; indice < 5; indice += 1) {
        const aluno = await criarAluno();
        await db.studentXpBalance.create({
          data: {
            tenantId,
            studentId: aluno,
            localMonth: '2027-01',
            points: 10,
            entryCount: 1,
            lastEntryAt: AGORA,
          },
        });
      }

      const gerado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${gymUnitId}/2027-01/gerar`)
        .set('Cookie', cookieModeradorRestrito)
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      const publicado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Cookie', cookieModeradorRestrito)
        .expect(201);

      expect(publicado.body).toMatchObject({ status: 'PUBLISHED' });
    });

    /*
     * `ajustar` recebe `studentId`, e um aluno pertence a uma unidade
     * (`Student.gymUnitId`). Mesmo 404 de "aluno inexistente" -- nao pode
     * denunciar que o aluno existe em outra unidade.
     */
    it('moderador restrito nao ajusta XP de aluno de outra unidade', async () => {
      const alunoDeOutraUnidade = await criarAluno(outraUnidadeId);

      const resposta = await request(servidor())
        .post(`/api/v1/engagement/xp/${alunoDeOutraUnidade}/ajustar`)
        .set('Cookie', cookieModeradorRestrito)
        .send({ pontos: -10, motivo: 'correcao', idempotencyKey: randomUUID() })
        .expect(404);

      expect((resposta.body as { code: string }).code).toBe('ALUNO_NAO_ENCONTRADO');
    });

    /* Caso positivo: moderador restrito ajustando aluno da propria unidade. */
    it('moderador restrito ajusta XP de aluno da propria unidade', async () => {
      const alunoDaUnidade = await criarAluno();

      await request(servidor())
        .post(`/api/v1/engagement/xp/${alunoDaUnidade}/ajustar`)
        .set('Cookie', cookieModeradorRestrito)
        .send({ pontos: -10, motivo: 'correcao', idempotencyKey: randomUUID() })
        .expect(201);
    });

    it('ajuste exige motivo', async () => {
      const aluno = await criarAluno();

      const resposta = await request(servidor())
        .post(`/api/v1/engagement/xp/${aluno}/ajustar`)
        .set('Cookie', cookieModerador)
        .send({ pontos: -10, motivo: '', idempotencyKey: randomUUID() })
        .expect(400);

      expect((resposta.body as { code: string }).code).toBe('VALIDATION_FAILED');
    });

    /*
     * `M5-FR-007` e `M5-AC-010`: correcao e movimento compensatorio. Nao ha
     * rota de edicao, e o movimento original continua no ledger.
     */
    it('ajuste grava movimento compensatorio sem apagar o original', async () => {
      const aluno = await criarAluno();

      await request(servidor())
        .post(`/api/v1/engagement/xp/${aluno}/ajustar`)
        .set('Cookie', cookieModerador)
        .send({ pontos: 30, motivo: 'bonus de evento', idempotencyKey: randomUUID() })
        .expect(201);

      const original = await db.xpLedgerEntry.findFirstOrThrow({
        where: { tenantId, studentId: aluno },
      });

      await request(servidor())
        .post(`/api/v1/engagement/xp/${aluno}/ajustar`)
        .set('Cookie', cookieModerador)
        .send({ pontos: -10, motivo: 'passagem corrigida', idempotencyKey: randomUUID() })
        .expect(201);

      const movimentos = await db.xpLedgerEntry.findMany({
        where: { tenantId, studentId: aluno },
        orderBy: { createdAt: 'asc' },
      });

      expect(movimentos).toHaveLength(2);
      expect(movimentos[0]?.id).toBe(original.id);
      expect(movimentos[1]).toMatchObject({ type: 'ADJUSTMENT', points: -10, reason: 'passagem corrigida' });
    });

    it('mesmo idempotencyKey nao ajusta duas vezes', async () => {
      const aluno = await criarAluno();
      const chave = randomUUID();

      const ajustar = () =>
        request(servidor())
          .post(`/api/v1/engagement/xp/${aluno}/ajustar`)
          .set('Cookie', cookieModerador)
          .send({ pontos: -10, motivo: 'passagem corrigida', idempotencyKey: chave });

      await ajustar().expect(201);
      await ajustar().expect(201);

      const total = await db.xpLedgerEntry.count({
        where: { tenantId, studentId: aluno, type: 'ADJUSTMENT' },
      });

      expect(total).toBe(1);
    });

    /* `M5-AC-007`: republicar e recusado -- 409, nao 500. */
    it('republicar um snapshot ja publicado e 409', async () => {
      const aluno = await criarAluno();
      await db.studentXpBalance.create({
        data: {
          tenantId,
          studentId: aluno,
          localMonth: '2026-09',
          points: 10,
          entryCount: 1,
          lastEntryAt: AGORA,
        },
      });

      const gerado = await request(servidor())
        .post(`/api/v1/engagement/rankings/${gymUnitId}/2026-09/gerar`)
        .set('Cookie', cookieModerador)
        .expect(201);

      const snapshotId = (gerado.body as { id: string }).id;

      await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Cookie', cookieModerador)
        .expect(201);

      const resposta = await request(servidor())
        .post(`/api/v1/engagement/rankings/${snapshotId}/publicar`)
        .set('Cookie', cookieModerador)
        .expect(409);

      expect((resposta.body as { code: string }).code).toBe('RANKING_SNAPSHOT_IMUTAVEL');
    });
  });
  /*
   * ---------------------------------------------------------------------
   * F32 -- CONSISTENCIA SEMANAL E STREAK (Slice 5.3).
   *
   * Contra HTTP real: a F30 e a F31 mostraram que as falhas desta ponte NAO
   * aparecem em teste de unidade -- rota nao exportada, campo que a API nao
   * envia, modulo fora do `AppModule`. Todas atravessam processo, onde
   * `fetch` e cast e nenhum compilador confere.
   * ---------------------------------------------------------------------
   */
  describe('GET sessions/:id/engajamento/xp -- consistencia (F32)', () => {
    /*
     * -------------------------------------------------------------------
     * DATAS ANCORADAS NO RELOGIO, NAO FIXAS. Issue #223.
     * -------------------------------------------------------------------
     *
     * A versao anterior treinava na semana de 17/08/2026 e esperava streak
     * 1. Era verdade ate 23/08 e virou 0 no dia 24: `resumirStreak` conta de
     * tras para frente e PARA na primeira semana PERDIDA, entao toda semana
     * vazia posterior derruba a contagem. O CI da `main` ficou vermelho em
     * 31/08 sem ninguem ter mudado uma linha de codigo.
     *
     * O resto da suite continua com data fixa porque depende de `localMonth`
     * ('2026-08'), que o `AGORA` fixo resolve. O STREAK e o unico que compara
     * com o relogio REAL -- o endpoint do totem chama `new Date()` no
     * controller, e injetar um relogio so para teste seria abstracao de uso
     * unico.
     *
     * A ancora e a SEMANA CORRENTE, porque o que estes testes precisam e da
     * posicao RELATIVA entre as semanas, nao das datas absolutas:
     *
     *   semana treinada = a ANTERIOR a corrente -- ja FECHADA (a corrente
     *     ainda corre e nunca qualifica, e `EM_ANDAMENTO` nao soma) e
     *     ADJACENTE (sem semana perdida entre ela e hoje para romper o
     *     streak).
     */
    const segundaDaSemanaCorrente = (): string =>
      inicioDaSemanaLocal(new Date().toISOString().slice(0, 10));

    /** Segunda-feira da semana treinada (a anterior a corrente), `AAAA-MM-DD`. */
    const inicioDaSemanaTreinada = (): string => {
      const corrente = new Date(`${segundaDaSemanaCorrente()}T00:00:00.000Z`);

      return new Date(corrente.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    };

    /** Um instante dentro da semana treinada: `offset` dias apos a segunda. */
    const naSemanaTreinada = (offsetEmDias: number, hora = '12:00:00'): string => {
      const inicio = new Date(`${inicioDaSemanaTreinada()}T00:00:00.000Z`);
      const dia = new Date(inicio.getTime() + offsetEmDias * 86_400_000);

      return `${dia.toISOString().slice(0, 10)}T${hora}.000Z`;
    };

    /** Um instante relativo a segunda da semana CORRENTE (offset pode ser negativo). */
    const naSemanaCorrente = (offsetEmDias: number): Date => {
      const inicio = new Date(`${segundaDaSemanaCorrente()}T09:00:00.000Z`);

      return new Date(inicio.getTime() + offsetEmDias * 86_400_000);
    };

    /*
     * `projetarFrequencia` (o helper da F31) projeta ate `AGORA`, e a F32
     * precisa das sessoes projetadas ate HOJE -- passagem posterior ao teto
     * ficaria fora da janela e a semana nunca qualificaria. Este helper
     * projeta com teto proprio; o `periodo: 'ALL'` ja cobre o inicio.
     */
    const projetarAte = async (aluno: string, ate: Date): Promise<void> => {
      await frequencia.frequenciaDoAluno(contexto, aluno, 'ALL', 'SEMANAL', ate);
    };

    /** Projeta ate agora -- a semana treinada ja fechou, a corrente ainda corre. */
    const projetarAteHoje = (aluno: string): Promise<void> => projetarAte(aluno, new Date());

    /** Uma semana qualificada: tres dias distintos na semana treinada (seg, qua, sex). */
    const treinarSemanaQualificada = async (aluno: string): Promise<void> => {
      for (const offset of [0, 2, 4]) {
        await gravarPassagemConfirmada(aluno, naSemanaTreinada(offset));
      }
      await projetarAteHoje(aluno);
    };

    it('devolve a consistencia junto do extrato, no MESMO endpoint', async () => {
      const cpf = String(20_000_000_000n + BigInt(contadorDeMatricula) * 111n).padStart(11, '0');
      const aluno = await criarAlunoComCpf(cpf, 'Aluno Consistente');
      await treinarSemanaQualificada(aluno);

      const { sessionId, token } = await abrirSessao(cpf);

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`,
        token,
      ).expect(200);

      // A F30 quebrou porque a ponte nao exportava o verbo; a F31, porque a
      // fila lia campo que a API nao mandava. Assertar a FORMA inteira aqui
      // e o que pega os dois.
      expect(resposta.body).toMatchObject({
        consistencia: {
          atual: 1,
          diasPorSemana: 3,
          politica: 'semana-civil-local@1',
        },
      });
    });

    it('nao qualifica a semana abaixo da meta', async () => {
      const cpf = String(21_000_000_000n + BigInt(contadorDeMatricula) * 111n).padStart(11, '0');
      const aluno = await criarAlunoComCpf(cpf, 'Aluno De Dois Dias');

      // Dois dias so -- abaixo da meta de tres.
      await gravarPassagemConfirmada(aluno, naSemanaTreinada(0));
      await gravarPassagemConfirmada(aluno, naSemanaTreinada(2));
      await projetarAteHoje(aluno);

      const { sessionId, token } = await abrirSessao(cpf);

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`,
        token,
      ).expect(200);

      expect(resposta.body).toMatchObject({ consistencia: { atual: 0 } });
    });

    /*
     * A "prevencao de multipla pontuacao diaria" da Slice 5.3 e o indice
     * unico da F24, no banco -- nao um `if` no dominio. Este teste passa por
     * ele: seis passagens em tres dias viram tres sessoes, e a semana
     * qualifica por DIAS, nao por passagens.
     */
    it('conta DIAS, nao passagens -- duas entradas no mesmo dia sao um dia so', async () => {
      const cpf = String(22_000_000_000n + BigInt(contadorDeMatricula) * 111n).padStart(11, '0');
      const aluno = await criarAlunoComCpf(cpf, 'Aluno Que Volta A Tarde');

      for (const offset of [0, 2]) {
        await gravarPassagemConfirmada(aluno, naSemanaTreinada(offset, '09:00:00'));
        await gravarPassagemConfirmada(aluno, naSemanaTreinada(offset, '21:00:00'));
      }
      await projetarAteHoje(aluno);

      const { sessionId, token } = await abrirSessao(cpf);

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`,
        token,
      ).expect(200);

      const corpo = resposta.body as {
        consistencia: { atual: number; semanas: { inicio: string; diasTreinados: number }[] };
      };

      const semanaTreinada = corpo.consistencia.semanas.find(
        (semana) => semana.inicio === inicioDaSemanaTreinada(),
      );

      // Quatro passagens, DOIS dias -- abaixo da meta de tres.
      expect(semanaTreinada?.diasTreinados).toBe(2);
      expect(corpo.consistencia.atual).toBe(0);
    });

    /*
     * `M5-FR-009` ATRAVESSANDO MODULO: a pausa e reconstruida da timeline de
     * `membership`, nao de `Subscription.status`. O status diz o estado de
     * HOJE; se o streak lesse dele, a pausa de agosto sumiria no dia em que o
     * aluno retomasse -- e o teste unitario, que injeta a pausa pronta no
     * dublê, nunca veria isso.
     */
    it('le a pausa da TIMELINE, e ela nao rompe o streak', async () => {
      const cpf = String(23_000_000_000n + BigInt(contadorDeMatricula) * 111n).padStart(11, '0');
      const aluno = await criarAlunoComCpf(cpf, 'Aluno Que Pausou');

      await treinarSemanaQualificada(aluno);

      /*
       * Pausa que cobre a semana CORRENTE inteira, JA RETOMADA -- a
       * assinatura de hoje esta ativa, e so a timeline guarda o intervalo.
       *
       * Comeca no DOMINGO anterior e termina no domingo seguinte para que a
       * semana corrente caia inteira dentro do intervalo:
       * `semanaInteiraPausada` exige `pausa.inicio <= inicio && fim <=
       * pausa.fim`, entao pausa que comeca na propria segunda nao a cobre.
       */
      await db.studentTimelineEvent.create({
        data: {
          tenantId,
          studentId: aluno,
          type: 'SUBSCRIPTION_PAUSED',
          actorType: 'USER',
          correlationId: randomUUID(),
          occurredAt: naSemanaCorrente(-1),
        },
      });
      await db.studentTimelineEvent.create({
        data: {
          tenantId,
          studentId: aluno,
          type: 'SUBSCRIPTION_RESUMED',
          actorType: 'USER',
          correlationId: randomUUID(),
          occurredAt: naSemanaCorrente(7),
        },
      });

      const { sessionId, token } = await abrirSessao(cpf);

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`,
        token,
      ).expect(200);

      const corpo = resposta.body as {
        consistencia: { semanas: { inicio: string; status: string }[] };
      };

      const semanaPausada = corpo.consistencia.semanas.find(
        (semana) => semana.inicio === segundaDaSemanaCorrente(),
      );

      expect(semanaPausada?.status).toBe('PAUSADA');
    });

    /** Consistencia tambem e dado de aluno: nunca a de outra sessao. */
    it('nao devolve a consistencia de aluno de outra sessao', async () => {
      const cpfMeu = String(24_000_000_000n + BigInt(contadorDeMatricula) * 111n).padStart(11, '0');
      const meu = await criarAlunoComCpf(cpfMeu, 'Aluno Sem Treino');

      const cpfOutro = String(25_000_000_000n + BigInt(contadorDeMatricula) * 111n).padStart(11, '0');
      const outro = await criarAlunoComCpf(cpfOutro, 'Aluno Com Streak');
      await treinarSemanaQualificada(outro);

      void meu;
      void outro;

      const { sessionId, token } = await abrirSessao(cpfMeu);

      const resposta = await buscar(
        `/api/v1/kiosk/sessions/${sessionId}/engajamento/xp`,
        token,
      ).expect(200);

      // O streak do OUTRO aluno e 1; a sessao e do meu, que nao treinou.
      expect(resposta.body).toMatchObject({ consistencia: { atual: 0 } });
    });
  });
});
