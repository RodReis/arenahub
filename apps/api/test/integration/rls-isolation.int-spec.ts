import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { comContexto, criarPrismaClient, type PrismaClientArenaHub } from '@arenahub/database';

/**
 * F66 -- INV-006 provado no BANCO, nao na aplicacao (SPEC-066, ADR-054).
 *
 * O que este arquivo prova: com a politica RLS ativa, o Postgres recusa
 * sozinho leitura e escrita fora do tenant da transacao -- mesmo que a
 * aplicacao esqueca o `where`. Por isso NENHUMA query aqui filtra por
 * tenant: o filtro e justamente o que se quer ver faltando.
 *
 * O CLIENT PRECISA SER O ROLE RESTRITO. Sob o role dono o teste passaria sem
 * provar nada -- pior, o `arenahub` do compose local e superusuario, e
 * superusuario ignora RLS mesmo com FORCE. Daí a suite pular inteira, e nao
 * passar em falso, quando `RUNTIME_INTEGRATION_DATABASE_URL` nao existe.
 */
const urlRestrita = process.env['RUNTIME_INTEGRATION_DATABASE_URL'];

const descreverOuPular = urlRestrita ? describe : describe.skip;

descreverOuPular('F66 -- o banco recusa o que a aplicacao deixaria passar', () => {
  /** Dono: monta o cenario. Ele ignora RLS, e e o que se quer aqui. */
  let dono: PrismaClientArenaHub;
  /** Restrito: o que a API usa em execucao. E quem esta sob teste. */
  let restrito: PrismaClientArenaHub;

  const sufixo = randomUUID().slice(0, 8);

  let tenantA: string;
  let tenantB: string;
  let alunoDeA: string;
  let alunoDeB: string;
  /** Unidade REAL de B -- ver o teste de escrita cruzada. */
  let unidadeDeB: string;
  /** Unidade de A -- a sessao de frequencia do teste de `include` precisa. */
  let unidadeDeA: string;
  /** Usuario REAL -- `audit_logs.actor_id` tem FK; um uuid solto violaria. */
  let atorId: string;

  async function criarTenantComAluno(rotulo: string): Promise<[string, string, string]> {
    const tenant = await dono.tenant.create({
      data: {
        slug: `f66-${rotulo}-${sufixo}`,
        legalName: `RLS ${rotulo} LTDA`,
        displayName: `RLS ${rotulo}`,
      },
    });

    const unidade = await dono.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'CENTRO',
        name: 'Centro',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const aluno = await dono.student.create({
      data: {
        tenantId: tenant.id,
        gymUnitId: unidade.id,
        membershipNumber: `F66-${rotulo}-${sufixo}`,
        fullName: `Aluno do tenant ${rotulo}`,
        birthDate: new Date('1990-01-01T00:00:00.000Z'),
        status: 'ACTIVE',
      },
    });

    return [tenant.id, aluno.id, unidade.id];
  }

  beforeAll(async () => {
    dono = criarPrismaClient();
    // `descreverOuPular` ja garantiu que a variavel existe.
    restrito = criarPrismaClient({ url: urlRestrita as string });

    [tenantA, alunoDeA, unidadeDeA] = await criarTenantComAluno('a');
    [tenantB, alunoDeB, unidadeDeB] = await criarTenantComAluno('b');

    const usuario = await dono.user.create({
      data: { email: `f66-ator-${sufixo}@exemplo.test`, passwordHash: 'x' },
    });
    atorId = usuario.id;
  }, 60_000);

  afterAll(async () => {
    await dono.auditLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await dono.studentAttendanceSession.deleteMany({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    await dono.student.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await dono.gymUnit.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await dono.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await dono.user.delete({ where: { id: atorId } });

    await dono.$disconnect();
    await restrito.$disconnect();
  });

  /** O client de transacao que o Prisma entrega, com os modelos. */
  type Tx = Parameters<Parameters<PrismaClientArenaHub['$transaction']>[0]>[0];

  /**
   * Roda no contexto do tenant, com o `set_config` dentro da transacao.
   *
   * O `set_config` e emitido aqui a mao porque este teste usa
   * `criarPrismaClient` direto, sem o `PrismaService` da API -- e o
   * `PrismaService` que faz isso em producao. Testar pelo client cru e
   * deliberado: prova a POLITICA, e nao a intercepcao que a alimenta.
   */
  function comoTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return comContexto({ kind: 'tenant', tenantId }, () =>
      restrito.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SELECT set_config($1, $2, true)', 'app.tenant_id', tenantId);
        return fn(tx);
      }),
    );
  }

  it('sem where nenhum, o tenant A so enxerga os proprios alunos', async () => {
    const vistos = await comoTenant(tenantA, (tx) =>
      tx.student.findMany({
        where: { membershipNumber: { contains: sufixo } },
      }),
    );

    expect(vistos.map((a) => a.tenantId)).toEqual([tenantA]);
  });

  it('buscar o aluno de B pelo id, do contexto de A, nao acha nada', async () => {
    // A query nomeia o id exato de um aluno que EXISTE. Sem a politica ela
    // devolveria a linha; e o caso classico do `where` esquecido.
    const achado = await comoTenant(tenantA, (tx) =>
      tx.student.findUnique({ where: { id: alunoDeB } }),
    );

    expect(achado).toBeNull();
  });

  it('escrever com o tenant_id de B, do contexto de A, e recusado pelo banco', async () => {
    // `gymUnitId` e a unidade REAL de B, nao um uuid qualquer: com um id
    // inexistente a escrita falharia por chave estrangeira, e o teste
    // passaria mesmo com a politica desligada -- provando outra coisa.
    await expect(
      comoTenant(tenantA, (tx) =>
        tx.student.create({
          data: {
            tenantId: tenantB,
            gymUnitId: unidadeDeB,
            membershipNumber: `F66-INVASOR-${sufixo}`,
            fullName: 'Invasor',
            birthDate: new Date('1990-01-01T00:00:00.000Z'),
            status: 'ACTIVE',
          },
        }),
      ),
    ).rejects.toThrow();

    const existe = await dono.student.findFirst({
      where: { membershipNumber: `F66-INVASOR-${sufixo}` },
    });

    expect(existe).toBeNull();
  });

  it('atualizar aluno de B, do contexto de A, nao afeta linha nenhuma', async () => {
    const afetadas = await comoTenant(tenantA, (tx) =>
      tx.student.updateMany({
        where: { id: alunoDeB },
        data: { fullName: 'Sequestrado' },
      }),
    );

    expect(afetadas.count).toBe(0);

    const intacto = await dono.student.findUnique({ where: { id: alunoDeB } });

    expect(intacto?.fullName).toBe('Aluno do tenant b');
  });

  it('escrita legitima do proprio tenant continua passando', async () => {
    // Sem este caso, os anteriores passariam com uma politica que recusa
    // TUDO -- e isolamento perfeito e inutil.
    const criado = await comoTenant(tenantA, (tx) =>
      tx.student.updateMany({
        where: { id: alunoDeA },
        data: { fullName: 'Aluno do tenant a, renomeado' },
      }),
    );

    expect(criado.count).toBe(1);
  });

  it('escreve e le na mesma transacao, enxergando a propria escrita', async () => {
    // Protege contra a regressao para o padrao publicado na doc do Prisma:
    // um `$transaction([set_config, query])` por query roda em OUTRA
    // conexao, e a leitura nao veria a escrita ainda nao commitada.
    const visto = await comoTenant(tenantA, async (tx) => {
      await tx.student.updateMany({
        where: { id: alunoDeA },
        data: { fullName: 'Escrito na mesma transacao' },
      });

      return tx.student.findUnique({ where: { id: alunoDeA } });
    });

    expect(visto?.fullName).toBe('Escrito na mesma transacao');
  });

  it('sem contexto, a leitura devolve vazio -- por isso a aplicacao exige o escopo', async () => {
    // Este e o motivo de `SemContextoDeTenantError` existir: sozinha, a
    // politica devolve ZERO LINHAS, e zero linhas e indistinguivel de "nao
    // ha dados". O banco nao avisa; quem avisa e a aplicacao.
    const semContexto = await restrito.student.findMany({
      where: { membershipNumber: { contains: sufixo } },
    });

    expect(semContexto).toHaveLength(0);
  });

  /*
   * Issue #302 -- `audit_logs` tem a MESMA politica (tenant_isolation_audit_logs,
   * F66), com a excecao extra que `students` nao tem: `app.actor = 'platform'`
   * atravessa qualquer tenant (ADR-052 SS3). E exatamente o caminho que
   * `ElevarUseCase` e `EncerrarElevacaoUseCase` passaram a abrir com
   * `comContexto({ kind: 'platform' }, ...)`.
   *
   * Sem contexto nenhum, a politica recusa a escrita em `audit_logs` com
   * 42501 -- diferente da leitura em `students` (que so devolve vazio), aqui
   * o INSERT FALHA, porque a clausula WITH CHECK nao acha app.tenant_id nem
   * app.actor = 'platform'. E o proprio 42501 que a issue #302 descreve.
   */
  describe('issue #302 -- escrita em audit_logs pelo Super Admin sem tenant', () => {
    it('sem contexto nenhum, o insert em audit_logs e recusado', async () => {
      // P2039: o Postgres recusou a query -- aqui, a politica RLS. Sem
      // `app.tenant_id` nem `app.actor = 'platform'` setados, a clausula
      // WITH CHECK de `tenant_isolation_audit_logs` nao acha nenhuma das
      // duas condicoes. E o 42501 que a issue #302 descreve.
      await expect(
        restrito.auditLog.create({
          data: {
            tenantId: tenantA,
            actorType: 'SUPPORT',
            actorId: atorId,
            action: 'support.elevated',
            target: 'tenant',
            targetId: tenantA,
            correlationId: `corr-302-${sufixo}`,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2039' });
    });

    it('com contexto platform, o mesmo insert passa -- o molde que os use cases de plataforma usam', async () => {
      const criado = await comContexto({ kind: 'platform' }, () =>
        restrito.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SELECT set_config($1, $2, true)', 'app.actor', 'platform');

          return tx.auditLog.create({
            data: {
              tenantId: tenantA,
              actorType: 'SUPPORT',
              actorId: atorId,
              action: 'support.elevated',
              target: 'tenant',
              targetId: tenantA,
              correlationId: `corr-302-platform-${sufixo}`,
            },
          });
        }),
      );

      expect(criado.tenantId).toBe(tenantA);
    });
  });

  /*
   * Issue #302 -- a forma MAIS SILENCIOSA do mesmo defeito.
   *
   * Os testes acima leem `students` como RAIZ da query, e ali a politica
   * some com a linha inteira: a aplicacao recebe `null` e trata como "nao
   * achei". Quando `students` entra por `include`, a raiz (aqui,
   * `student_attendance_sessions`) NAO tem politica -- ela volta normalmente,
   * so que sem o aluno pendurado.
   *
   * Foi assim que o `IdentityResolver` decidiria acesso na catraca sem saber
   * se o aluno esta ativo: o vinculo do dispositivo existe, o `student` vem
   * nulo, e nada no caminho parece errado.
   */
  describe('issue #302 -- `students` por include, com a raiz sem politica', () => {
    beforeAll(async () => {
      await dono.studentAttendanceSession.create({
        data: {
          tenantId: tenantA,
          studentId: alunoDeA,
          gymUnitId: unidadeDeA,
          sessionDate: new Date('2026-08-17T00:00:00.000Z'),
          firstPassageAt: new Date('2026-08-17T12:00:00.000Z'),
          lastPassageAt: new Date('2026-08-17T12:00:00.000Z'),
          passageCount: 1,
          // A contagem TEM que bater com os ids -- ha check constraint.
          passageIds: [randomUUID()],
          policyVersion: '1.0.0',
        },
      });
    });

    it('sem contexto, a raiz vem mas o aluno do include vem NULO', async () => {
      const semContexto = await restrito.studentAttendanceSession.findFirst({
        where: { studentId: alunoDeA },
        select: { id: true, student: { select: { status: true } } },
      });

      // A linha existe -- a raiz nao tem politica. O aluno, que tem, sumiu.
      expect(semContexto).not.toBeNull();
      expect(semContexto?.student).toBeNull();
    });

    it('com o contexto do tenant, o aluno do include aparece', async () => {
      const comEscopo = await comContexto({ kind: 'tenant', tenantId: tenantA }, () =>
        restrito.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SELECT set_config($1, $2, true)', 'app.tenant_id', tenantA);

          return tx.studentAttendanceSession.findFirst({
            where: { studentId: alunoDeA },
            select: { id: true, student: { select: { status: true } } },
          });
        }),
      );

      expect(comEscopo?.student?.status).toBe('ACTIVE');
    });
  });
});
