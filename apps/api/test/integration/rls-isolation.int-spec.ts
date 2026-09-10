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

    [tenantA, alunoDeA] = await criarTenantComAluno('a');
    [tenantB, alunoDeB, unidadeDeB] = await criarTenantComAluno('b');
  }, 60_000);

  afterAll(async () => {
    await dono.student.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await dono.gymUnit.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await dono.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });

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
});
