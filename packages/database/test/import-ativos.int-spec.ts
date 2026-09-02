import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evaluateAccess, resolverHoraLocal } from '@arenahub/access-policy';

import { criarPrismaClient, type PrismaClientArenaHub } from '../src/index.js';
import {
  importarPessoasAtivas,
  type AlvoDaAtivacao,
  type RegistroDePessoaAtiva,
  type ResultadoDaAtivacao,
} from '../src/import-ativos/importar.js';

/**
 * Integracao da F48 contra Postgres de verdade -- o que o unitario nao
 * consegue provar: idempotencia contra o UNIQUE do banco, campo vazio nao
 * apagando dado bom, e a garantia de que ativar cadastro NAO abre a catraca.
 *
 * Nenhum dado real de aluno (`CLAUDE.md`): nomes inventados e CPFs gerados
 * com digito verificador valido.
 */
describe('importacao da base ativa do Pacto (F48)', () => {
  let db: PrismaClientArenaHub;
  const sufixo = randomUUID().slice(0, 8);

  let alvo: AlvoDaAtivacao;
  let gymUnitId: string;
  const AGORA = new Date('2026-08-20T12:00:00.000Z');

  /** CPFs sinteticos, digito verificador valido, nenhum de pessoa real. */
  const CPF = {
    ana: '11144477735',
    bruno: '52998224725',
    carla: '15350946056',
    diego: '40364019808',
    karina: '95705331029',
    leo: '02270481216',
    mira: '25395558616',
    nilo: '81957649674',
    olga: '26967752065',
    pedro: '06099568760',
    quezia: '34362583343',
    tulio: '91917739974',
    ursula: '31350038415',
    vera: '36829112192',
    xenia: '61885159200',
    // UM CPF POR TESTE, sem reuso: o tenant e o mesmo para a suite inteira e
    // nao ha limpeza entre casos, entao repetir um CPF faz o teste seguinte
    // CASAR com a pessoa do anterior em vez de criar a sua -- e passar pelo
    // motivo errado. Estes cinco entraram com os testes de UF e endereco.
    wagner: '60020666241',
    yara: '34862268862',
    zilda: '82606204050',
    heitor: '52622602685',
    ines: '04004288061',
  } as const;

  beforeAll(async () => {
    db = criarPrismaClient();

    const tenant = await db.tenant.create({
      data: {
        slug: `ativos-${sufixo}`,
        legalName: 'Academia Ativos Teste LTDA',
        displayName: 'Academia Ativos Teste',
      },
    });

    const unidade = await db.gymUnit.create({
      data: {
        tenantId: tenant.id,
        code: 'MATRIZ',
        name: 'Matriz',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });

    const plano = await db.plan.create({
      data: { tenantId: tenant.id, name: 'Programa Adultos e Idosos' },
    });

    gymUnitId = unidade.id;
    alvo = {
      tenantId: tenant.id,
      planId: plano.id,
      planName: plano.name,
      gymUnitIds: [unidade.id],
    };

    // Contador em 3000, como a F47 deixou a base real de proposito: as
    // matriculas emitidas depois da importacao historica nao podem colidir
    // com as importadas. A fixture reproduz esse estado inicial.
    await db.$executeRaw`
      INSERT INTO student_sequences (tenant_id, next_value, updated_at)
      VALUES (${tenant.id}::uuid, 3000, now())
      ON CONFLICT (tenant_id) DO UPDATE SET next_value = 3000, updated_at = now()
    `;
  });

  afterAll(async () => {
    // Limpa o rastro da suite -- `Cascade` a partir do tenant leva aluno,
    // credencial, assinatura, direito e janela junto.
    if (alvo) {
      await db.tenant.delete({ where: { id: alvo.tenantId } }).catch(() => undefined);
    }

    await db?.$disconnect();
  });

  /**
   * Matricula da fixture, EMITIDA PELO MESMO CONTADOR que a producao usa.
   *
   * Contador proprio no teste nao serve mais: a F49 tambem consome
   * `student_sequences` a cada pessoa que cadastra, entao dois contadores
   * independentes se cruzam e a colisao no UNIQUE aparece conforme a ordem
   * dos testes -- que e a definicao de teste inutil. Uma fonte so, como no
   * banco de verdade.
   *
   * O `UPDATE ... RETURNING` incrementa e devolve na MESMA instrucao, entao
   * nao ha janela entre ler e gravar.
   */
  async function emitirMatricula(): Promise<string> {
    const linhas = await db.$queryRaw<{ next_value: number }[]>`
      UPDATE student_sequences
      SET next_value = next_value + 1, updated_at = now()
      WHERE tenant_id = ${alvo.tenantId}::uuid
      RETURNING next_value - 1 AS next_value
    `;

    const sequencial = linhas[0]?.next_value;

    if (sequencial === undefined) {
      throw new Error('Contador do tenant nao existe -- o `beforeAll` devia te-lo criado.');
    }

    return `AP-2026-${String(sequencial).padStart(8, '0')}`;
  }

  /**
   * Insere um aluno no estado que a F47 deixou: `CANCELLED`, sem credencial,
   * sem assinatura, sem direito.
   */
  async function criarAlunoCancelado(dados: {
    nome?: string;
    cpf?: string | null;
    status?: 'CANCELLED' | 'BLOCKED' | 'ARCHIVED';
  }): Promise<{ id: string; fullName: string; cpf: string | null }> {
    const membershipNumber = await emitirMatricula();

    return db.student.create({
      data: {
        tenantId: alvo.tenantId,
        gymUnitId,
        membershipNumber,
        fullName: dados.nome ?? `PESSOA SINTETICA ${membershipNumber}`,
        birthDate: new Date(Date.UTC(1990, 0, 15)),
        cpf: dados.cpf ?? null,
        status: dados.status ?? 'CANCELLED',
      },
      select: { id: true, fullName: true, cpf: true },
    });
  }

  /**
   * Monta um registro completo do Pacto. Com `aluno`, herda nome e CPF dele;
   * com `null`, so as sobrescritas -- e como se testa a linha que nao casa
   * com ninguem.
   */
  function registroDe(
    aluno: { fullName: string; cpf: string | null } | null,
    sobrescritas: Partial<RegistroDePessoaAtiva> = {},
  ): RegistroDePessoaAtiva {
    return {
      nome: aluno?.fullName ?? '',
      cartao: '',
      identificadorFacial: '',
      codigoPerfil: '1',
      dataNascimento: '15/01/1990',
      endereco: '',
      bairro: '',
      cep: '',
      municipio: '',
      // Vazia por padrao: e o caso comum do arquivo, e exercita a queda em
      // `UF_PADRAO`. O teste de UF sobrescreve com a sigla que quer provar.
      uf: '',
      telefone: '',
      celular: '',
      cpf: aluno?.cpf ?? '',
      dataInicio: '',
      dataFim: '',
      email: '',
      ...sobrescritas,
    };
  }

  const importar = (registros: readonly RegistroDePessoaAtiva[]): Promise<ResultadoDaAtivacao> =>
    importarPessoasAtivas(db, alvo, registros, AGORA);

  it('grava as duas credenciais e nao duplica na segunda execucao', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'ANA CREDENCIAL', cpf: CPF.ana });
    const registro = registroDe(aluno, {
      cartao: '2061',
      identificadorFacial: '2061',
      dataInicio: '20260803',
      dataFim: '20260902',
    });

    const primeira = await importar([registro]);
    const segunda = await importar([registro]);

    expect(primeira.casados).toBe(1);
    expect(segunda.casados).toBe(1);
    // Reprocessar e seguro: nem pendencia de "credencial ja pertence a outro
    // aluno" (seria o dono se confundindo consigo mesmo), nem duplicata.
    expect(primeira.pendencias).toEqual([]);
    expect(segunda.pendencias).toEqual([]);

    const credenciais = await db.studentCredential.findMany({
      where: { studentId: aluno.id },
      select: { kind: true, externalId: true },
    });

    expect(credenciais).toHaveLength(2);
    expect(credenciais.map((c) => c.kind).sort()).toEqual(['FACIAL_ENROLL_ID', 'TURNSTILE_CARD']);
    expect(credenciais.every((c) => c.externalId === '2061')).toBe(true);
  });

  it('casa por CPF mesmo com o nome escrito diferente do banco', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'ZOETE LOPES DE SOUZA', cpf: CPF.bruno });

    // Nome com caixa, acento e espaco diferentes do banco: so o CPF casa isso.
    const resultado = await importar([
      registroDe(null, { nome: '  Zoete Lopes de Souza Filha  ', cpf: CPF.bruno }),
    ]);

    expect(resultado.casadosPorCpf).toBe(1);
    expect(resultado.casadosPorNome).toBe(0);

    const atualizado = await db.student.findUniqueOrThrow({ where: { id: aluno.id } });

    expect(atualizado.status).toBe('ACTIVE');
  });

  it('campo vazio no arquivo NAO apaga o telefone que a recepcao corrigiu', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'CARLA CONTATO', cpf: CPF.carla });

    await db.studentContact.create({
      data: {
        tenantId: alvo.tenantId,
        studentId: aluno.id,
        type: 'PHONE',
        value: '62999990000',
        isPrimary: true,
      },
    });

    await importar([registroDe(aluno, { telefone: '', celular: '', email: '' })]);

    const contatos = await db.studentContact.findMany({ where: { studentId: aluno.id } });

    expect(contatos).toHaveLength(1);
    expect(contatos[0]!.value).toBe('62999990000');
    expect(contatos[0]!.isPrimary).toBe(true);
  });

  it('nascimento ausente no arquivo NAO apaga o que ja esta no banco', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'DIEGO NASCIMENTO', cpf: CPF.diego });

    await importar([registroDe(aluno, { dataNascimento: '' })]);

    const atualizado = await db.student.findUniqueOrThrow({ where: { id: aluno.id } });

    expect(atualizado.birthDate.toISOString().slice(0, 10)).toBe('1990-01-15');
  });

  it('aluno sem periodo e ativado, mas NAO ganha direito de acesso', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'EVA SEM PERIODO' });

    const resultado = await importar([
      registroDe(aluno, { dataInicio: '', dataFim: '', codigoPerfil: '1' }),
    ]);

    const atualizado = await db.student.findUniqueOrThrow({ where: { id: aluno.id } });
    const direitos = await db.entitlement.findMany({ where: { studentId: aluno.id } });
    const assinaturas = await db.subscription.findMany({ where: { studentId: aluno.id } });

    expect(atualizado.status).toBe('ACTIVE');
    // A REGRA No 1 EM UMA LINHA: cadastro ativo nao e direito de acesso.
    expect(direitos).toHaveLength(0);
    expect(assinaturas).toHaveLength(0);
    expect(resultado.pendencias).toEqual([
      { nome: 'EVA SEM PERIODO', motivo: 'aluno sem periodo de plano' },
    ]);
  });

  it('funcionario ganha direito por vinculo, sem assinatura', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'FABIO FUNCIONARIO' });

    const resultado = await importar([
      registroDe(aluno, { codigoPerfil: '2', dataInicio: '', dataFim: '' }),
    ]);

    const direitos = await db.entitlement.findMany({ where: { studentId: aluno.id } });
    const assinaturas = await db.subscription.findMany({ where: { studentId: aluno.id } });

    expect(direitos).toHaveLength(1);
    expect(direitos[0]!.source).toBe('EMPLOYEE');
    expect(direitos[0]!.subscriptionId).toBeNull();
    expect(direitos[0]!.status).toBe('ACTIVE');
    // Funcionario nao paga mensalidade: assinatura falsa poluiria o financeiro.
    expect(assinaturas).toHaveLength(0);
    expect(resultado.direitosPorVinculo).toBe(1);
    expect(resultado.direitosPorPlano).toBe(0);

    // Direito por VINCULO tambem precisa de janela na unidade -- sem ela a
    // catraca nega com WRONG_UNIT (ver o teste dedicado, abaixo).
    const janelas = await db.entitlementUnitWindow.findMany({
      where: { entitlementId: direitos[0]!.id },
      select: { gymUnitId: true },
    });

    expect(janelas.length).toBeGreaterThan(0);
    expect([...new Set(janelas.map((j) => j.gymUnitId))]).toEqual([gymUnitId]);

    // Segunda execucao nao cria um segundo direito por vinculo.
    const segunda = await importar([
      registroDe(aluno, { codigoPerfil: '2', dataInicio: '', dataFim: '' }),
    ]);

    expect(segunda.direitosPorVinculo).toBe(0);
    expect(await db.entitlement.count({ where: { studentId: aluno.id } })).toBe(1);
  });

  it('aluno com periodo ganha assinatura ligada ao plano correto', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'GABI COM PLANO' });

    const resultado = await importar([
      registroDe(aluno, { codigoPerfil: '1', dataInicio: '20260803', dataFim: '20260902' }),
    ]);

    const assinatura = await db.subscription.findFirstOrThrow({
      where: { studentId: aluno.id },
      include: { plan: true },
    });
    const direito = await db.entitlement.findFirstOrThrow({ where: { studentId: aluno.id } });

    expect(assinatura.plan.name).toBe('Programa Adultos e Idosos');
    expect(assinatura.planId).toBe(alvo.planId);
    expect(assinatura.status).toBe('ACTIVE');
    expect(assinatura.startsAt.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(assinatura.endsAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(direito.source).toBe('SUBSCRIPTION');
    expect(direito.subscriptionId).toBe(assinatura.id);
    expect(resultado.direitosPorPlano).toBe(1);

    // Idempotencia: segunda execucao nao duplica assinatura nem direito.
    const segunda = await importar([
      registroDe(aluno, { codigoPerfil: '1', dataInicio: '20260803', dataFim: '20260902' }),
    ]);

    expect(segunda.direitosPorPlano).toBe(0);
    expect(await db.subscription.count({ where: { studentId: aluno.id } })).toBe(1);
    expect(await db.entitlement.count({ where: { studentId: aluno.id } })).toBe(1);
  });

  it('o direito por PLANO recebe janela na unidade certa, nao so linhas', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'HELENA JANELA' });

    await importar([
      registroDe(aluno, { codigoPerfil: '1', dataInicio: '20260803', dataFim: '20260902' }),
    ]);

    const direito = await db.entitlement.findFirstOrThrow({ where: { studentId: aluno.id } });
    const janelas = await db.entitlementUnitWindow.findMany({
      where: { entitlementId: direito.id },
      select: { gymUnitId: true, dayOfWeek: true, startMinute: true, endMinute: true },
    });

    // `AccessProjectionRepository` monta `unitIds` A PARTIR DESTA TABELA, e
    // `evaluate-access` nega com WRONG_UNIT quando a unidade da catraca nao
    // esta na lista. Direito sem janela = unitIds vazio = todo mundo negado.
    // Contar linhas nao pega isso; conferir a UNIDADE pega.
    expect([...new Set(janelas.map((j) => j.gymUnitId))]).toEqual([gymUnitId]);
    // 0..6, EIXO DO MOTOR (`Date.getDay()`, domingo = 0) -- nao ISO 1..7. Ver
    // o bloco em `montarSnapshot`. Travar o eixo errado aqui e o que fazia a
    // suite reprovar quem consertasse o defeito de domingo.
    expect(janelas.map((j) => j.dayOfWeek).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(janelas.every((j) => j.startMinute === 0 && j.endMinute === 1440)).toBe(true);
  });

  it('a catraca ABRE de verdade para quem foi importado -- inclusive no DOMINGO', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'PAULA DOMINGO' });

    await importar([
      registroDe(aluno, { codigoPerfil: '1', dataInicio: '20260803', dataFim: '20260902' }),
    ]);

    // Le do banco EXATAMENTE como `AccessProjectionRepository` le: `unitIds`
    // sai do `distinct` de `EntitlementUnitWindow`, nunca de outra coluna.
    const direito = await db.entitlement.findFirstOrThrow({
      where: { studentId: aluno.id },
      select: { id: true, status: true, startsAt: true, endsAt: true },
    });
    const janelas = await db.entitlementUnitWindow.findMany({
      where: { entitlementId: direito.id },
      select: { gymUnitId: true, dayOfWeek: true, startMinute: true, endMinute: true },
    });

    const entrada = (instante: string) => {
      const local = resolverHoraLocal(instante, 'America/Sao_Paulo');

      return {
        evaluatedAt: instante,
        unitId: gymUnitId,
        localDayOfWeek: local.dayOfWeek,
        localMinuteOfDay: local.minuteOfDay,
        student: { status: 'ACTIVE' as const },
        adminBlock: { active: false },
        entitlements: [
          {
            id: direito.id,
            status: direito.status,
            startsAt: direito.startsAt.toISOString(),
            endsAt: direito.endsAt.toISOString(),
            unitIds: [...new Set(janelas.map((j) => j.gymUnitId))],
            windows: janelas.map((j) => ({
              dayOfWeek: j.dayOfWeek,
              startMinute: j.startMinute,
              endMinute: j.endMinute,
            })),
          },
        ],
      };
    };

    // DOMINGO, 10:00 em Sao Paulo. E o unico dia que expoe o eixo trocado: de
    // segunda a sabado os eixos ISO (1..7) e do motor (0..6) coincidem, entao
    // a semana toda passa mesmo com o defeito. Aqui o motor calcula `0`; se o
    // seed gravasse `7`, nenhuma janela casaria e viria OUTSIDE_SCHEDULE.
    const domingo = evaluateAccess(entrada('2026-08-23T13:00:00.000Z'));

    expect(domingo.outcome).toBe('ALLOW');
    if (domingo.outcome === 'ALLOW') expect(domingo.entitlementId).toBe(direito.id);

    // Um dia de semana tambem, para o teste nao virar "so domingo funciona".
    expect(evaluateAccess(entrada('2026-08-24T13:00:00.000Z')).outcome).toBe('ALLOW');

    // E o comportamento ANTIGO (direito sem janela nenhuma), para provar que
    // e a janela que sustenta o ALLOW: sem linha, `unitIds` fica vazio e o
    // motor nega com WRONG_UNIT -- o defeito que a Task 6 corrigiu.
    const semJanela = evaluateAccess({
      ...entrada('2026-08-24T13:00:00.000Z'),
      entitlements: [
        { ...entrada('2026-08-24T13:00:00.000Z').entitlements[0]!, unitIds: [], windows: [] },
      ],
    });

    expect(semJanela.outcome).toBe('DENY');
    if (semJanela.outcome === 'DENY') expect(semJanela.reason).toBe('WRONG_UNIT');
  });

  it('NAO emite cobranca -- essas pessoas ja pagaram no Pacto', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'IVO SEM FATURA' });

    await importar([
      registroDe(aluno, { codigoPerfil: '1', dataInicio: '20260803', dataFim: '20260902' }),
    ]);

    // Vincular plano NAO e cobrar. Fatura retroativa criaria divida fantasma
    // para ~340 pessoas que ja quitaram no sistema antigo.
    expect(await db.invoice.count({ where: { studentId: aluno.id } })).toBe(0);
    // Biometria exige consentimento e nao e escopo desta fatia (regra no 7).
    expect(await db.biometricIdentity.count({ where: { studentId: aluno.id } })).toBe(0);
    expect(await db.consentRecord.count({ where: { studentId: aluno.id } })).toBe(0);
  });

  it('aluno BLOCKED no ArenaHub nao e reativado pela importacao', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'JOANA BLOQUEADA', status: 'BLOCKED' });

    const resultado = await importar([
      registroDe(aluno, {
        codigoPerfil: '1',
        dataInicio: '20260803',
        dataFim: '20260902',
        cartao: '9911',
      }),
    ]);

    const atualizado = await db.student.findUniqueOrThrow({ where: { id: aluno.id } });

    // A recepcao bloqueou DEPOIS da exportacao do Pacto. O arquivo antigo nao
    // pode desfazer isso em silencio.
    expect(atualizado.status).toBe('BLOCKED');
    expect(resultado.casados).toBe(0);
    expect(resultado.pendencias).toEqual([
      { nome: 'JOANA BLOQUEADA', motivo: 'bloqueado no ArenaHub, veio como ativo no arquivo' },
    ]);
    // Nem credencial, nem direito: a linha inteira foi recusada, nao so o status.
    expect(await db.studentCredential.count({ where: { studentId: aluno.id } })).toBe(0);
    expect(await db.entitlement.count({ where: { studentId: aluno.id } })).toBe(0);
  });

  it('descarta registro de teste sem tentar casar e sem criar aluno', async () => {
    const antes = await db.student.count({ where: { tenantId: alvo.tenantId } });

    const resultado = await importar([
      registroDe(null, { nome: 'teste-poc-17-08' }),
      registroDe(null, { nome: '8585' }),
      registroDe(null, { nome: '   ' }),
    ]);

    // Lixo do Pacto nao vira aluno nem vira pendencia: vira descarte contado,
    // para o relatorio nao esconder o que ignorou.
    expect(resultado.lidos).toBe(3);
    expect(resultado.descartados).toBe(3);
    expect(resultado.casados).toBe(0);
    expect(resultado.pendencias).toEqual([]);
    expect(await db.student.count({ where: { tenantId: alvo.tenantId } })).toBe(antes);
  });

  // ==========================================================================
  // F49 -- quem nao casa com o cadastro passa a ser CADASTRADO.
  //
  // A F48 empurrava essas linhas para pendencia humana. Na rodada real foram
  // 49 pessoas que a F47 nunca trouxe -- nao casamento perdido por grafia.
  // ==========================================================================

  it('cadastra quem nao existe no cadastro, com matricula e status ACTIVE', async () => {
    const antes = await db.student.count({ where: { tenantId: alvo.tenantId } });

    const resultado = await importar([
      registroDe(null, {
        nome: 'KARINA QUE NUNCA EXISTIU',
        cpf: CPF.karina,
        dataNascimento: '10/03/1988',
        dataInicio: '20260803',
        dataFim: '20260902',
      }),
    ]);

    expect(resultado.criados).toBe(1);
    // NAO conta como casado: sao coisas diferentes, e e a queda de `criados`
    // a zero na segunda execucao que prova a idempotencia no relatorio.
    expect(resultado.casados).toBe(0);
    expect(await db.student.count({ where: { tenantId: alvo.tenantId } })).toBe(antes + 1);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'KARINA QUE NUNCA EXISTIU' },
    });

    // `AP-{ano}-{8 digitos}` -- o formato de `formatarMatricula`. Nao basta
    // "tem matricula": numero fora do formato quebra a leitura da recepcao e
    // colide com a sequencia do tenant.
    expect(criada.membershipNumber).toMatch(/^AP-2026-\d{8}$/);
    expect(criada.status).toBe('ACTIVE');
    expect(criada.profile).toBe('STUDENT');
    expect(criada.gymUnitId).toBe(gymUnitId);
    expect(criada.birthDate.toISOString().slice(0, 10)).toBe('1988-03-10');
    // `cpf` e `cpfHash` andam juntos -- o hash e o indice da busca por
    // duplicata, e hash diferente do que a API grava esconde o duplicado.
    expect(criada.cpf).toBe(CPF.karina);
    expect(criada.cpfHash).toBe(
      createHash('sha256').update(`${alvo.tenantId}:${CPF.karina}`).digest('hex'),
    );

    // A matricula saiu do CONTADOR do tenant, e nao de um numero inventado:
    // o contador avancou. Sem isso, a proxima criacao colidiria no UNIQUE.
    const contador = await db.studentSequence.findUniqueOrThrow({
      where: { tenantId: alvo.tenantId },
    });

    expect(contador.nextValue).toBeGreaterThan(Number(criada.membershipNumber.slice(-8)));
  });

  it('rodar duas vezes NAO cria a pessoa de novo -- a segunda casa com a primeira', async () => {
    const linha = registroDe(null, {
      nome: 'LEO CRIADO UMA VEZ SO',
      cpf: CPF.leo,
      dataInicio: '20260803',
      dataFim: '20260902',
      cartao: '4801',
    });

    const contador = async (): Promise<number> =>
      (await db.studentSequence.findUniqueOrThrow({ where: { tenantId: alvo.tenantId } }))
        .nextValue;

    const primeira = await importar([linha]);
    const depoisDaPrimeira = await contador();
    const segunda = await importar([linha]);
    const depoisDaSegunda = await contador();

    expect(primeira.criados).toBe(1);
    // A LEITURA QUE PROVA A IDEMPOTENCIA: na segunda passada ela ja existe no
    // banco, entao casa por CPF em vez de nascer outra vez.
    expect(segunda.criados).toBe(0);
    expect(segunda.casados).toBe(1);
    expect(segunda.casadosPorCpf).toBe(1);

    const alunos = await db.student.findMany({
      where: { tenantId: alvo.tenantId, fullName: 'LEO CRIADO UMA VEZ SO' },
      select: { id: true },
    });

    // Contagem por nome NAO basta sozinha: e por isso que abaixo se confere
    // tambem o que pendura no id -- direito, assinatura e credencial em
    // dobro seriam quebra de idempotencia com a mesma contagem de alunos.
    expect(alunos).toHaveLength(1);
    // O CONTADOR TAMBEM E ESTADO. Se a segunda execucao consumisse um numero
    // (criando e falhando, ou reservando antes de decidir), a matricula
    // seguinte pularia -- e "roda duas vezes, mesmo banco" seria mentira numa
    // tabela que ninguem olha.
    expect(depoisDaSegunda).toBe(depoisDaPrimeira);
    expect(await db.entitlement.count({ where: { studentId: alunos[0]!.id } })).toBe(1);
    expect(await db.subscription.count({ where: { studentId: alunos[0]!.id } })).toBe(1);
    expect(await db.studentCredential.count({ where: { studentId: alunos[0]!.id } })).toBe(1);
    expect(segunda.direitosPorPlano).toBe(0);
  });

  it('cadastrado sem data de nascimento recebe placeholder E vira pendencia -- em TODA execucao', async () => {
    const linha = registroDe(null, {
      nome: 'MIRA SEM NASCIMENTO',
      cpf: CPF.mira,
      dataNascimento: '',
    });

    const resultado = await importar([linha]);

    expect(resultado.criados).toBe(1);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'MIRA SEM NASCIMENTO' },
    });

    // `birthDate` e NOT NULL: sem data no arquivo, o cadastro so existe com
    // marcador. 1900-01-01 e impossivel de proposito (`nascimentoEhPlausivel`
    // recusa acima de 110 anos), entao ninguem digita isso por engano.
    expect(criada.birthDate.toISOString().slice(0, 10)).toBe('1900-01-01');
    expect(criada.status).toBe('ACTIVE');
    // E O PAR INSEPARAVEL: sem a pendencia, existe no banco uma pessoa com
    // data que ninguem escolheu e ninguem consegue distinguir de data real.
    expect(resultado.pendencias).toContainEqual({
      nome: 'MIRA SEM NASCIMENTO',
      motivo: 'cadastrado sem data de nascimento',
    });
    // UMA pendencia para UMA causa: `nascimento implausivel` NAO pode vir
    // junto -- e a mesma falta de data, e duas linhas fariam a recepcao
    // procurar dois problemas onde existe um. (`aluno sem periodo de plano`
    // vem tambem, e esta certo: e outro problema, de outra causa.)
    expect(resultado.pendencias).not.toContainEqual({
      nome: 'MIRA SEM NASCIMENTO',
      motivo: 'nascimento implausivel',
    });

    // ------------------------------------------------------------------
    // A SEGUNDA EXECUCAO TEM DE AVISAR IGUAL. Aqui a pessoa ja existe,
    // entao ela CASA em vez de nascer -- e o aviso emitido "quando cria"
    // sumiria justamente na rodada em que o `1900-01-01` continua no banco.
    //
    // Consequencia pratica: a recepcao roda o seed de novo antes de
    // corrigir as 3 pessoas, o bloco de aviso some da tela, e a data falsa
    // fica no banco sem rastro nenhum. Nada no admin-web sabe ler
    // `1900-01-01` como "nao sabemos".
    //
    // O criterio e sobre O ESTADO NO BANCO, nao sobre o que aconteceu
    // nesta execucao.
    // ------------------------------------------------------------------
    const segunda = await importar([linha]);

    expect(segunda.criados).toBe(0);
    expect(segunda.casados).toBe(1);
    expect(segunda.pendencias).toContainEqual({
      nome: 'MIRA SEM NASCIMENTO',
      motivo: 'cadastrado sem data de nascimento',
    });

    // E a data continua sendo o placeholder -- o aviso nao pode ser eco de
    // uma correcao que nao houve.
    const depois = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'MIRA SEM NASCIMENTO' },
    });

    expect(depois.birthDate.toISOString().slice(0, 10)).toBe('1900-01-01');
  });

  it('corrigida a data de nascimento, o aviso do placeholder PARA de aparecer', async () => {
    const linha = registroDe(null, {
      nome: 'VERA CORRIGIDA NA RECEPCAO',
      cpf: CPF.vera,
      dataNascimento: '',
    });

    const primeira = await importar([linha]);

    expect(primeira.pendencias).toContainEqual({
      nome: 'VERA CORRIGIDA NA RECEPCAO',
      motivo: 'cadastrado sem data de nascimento',
    });

    // A recepcao faz o que a pendencia pediu: poe a data de verdade.
    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'VERA CORRIGIDA NA RECEPCAO' },
    });

    await db.student.update({
      where: { id: criada.id },
      data: { birthDate: new Date(Date.UTC(1991, 6, 22)) },
    });

    // O AVISO TEM DE CALAR. Um aviso que nunca some deixa de ser lido, e a
    // proxima pessoa com data falsa passa despercebida no meio do ruido.
    // E o que prova que a condicao le o BANCO, e nao um marcador do arquivo:
    // a linha do arquivo continua sem data, e mesmo assim nao ha pendencia.
    const segunda = await importar([linha]);

    expect(segunda.pendencias).not.toContainEqual({
      nome: 'VERA CORRIGIDA NA RECEPCAO',
      motivo: 'cadastrado sem data de nascimento',
    });
    // E a data da recepcao sobrevive: arquivo vazio nao apaga dado bom.
    const depois = await db.student.findUniqueOrThrow({ where: { id: criada.id } });

    expect(depois.birthDate.toISOString().slice(0, 10)).toBe('1991-07-22');
  });

  it('quando o arquivo passa a trazer a data, o aviso do placeholder cala na mesma rodada', async () => {
    // Cadastrada sem data numa rodada; numa exportacao posterior do Pacto a
    // data aparece. `gravarPessoa` grava a data boa por cima do placeholder,
    // entao o problema deixou de existir NESTA rodada -- avisar aqui seria
    // mandar a recepcao corrigir o que o proprio seed acabou de corrigir.
    const semData = registroDe(null, {
      nome: 'XENIA DATA CHEGOU DEPOIS',
      cpf: CPF.xenia,
      dataNascimento: '',
    });

    const primeira = await importar([semData]);

    expect(primeira.pendencias).toContainEqual({
      nome: 'XENIA DATA CHEGOU DEPOIS',
      motivo: 'cadastrado sem data de nascimento',
    });

    const segunda = await importar([{ ...semData, dataNascimento: '05/09/1993' }]);

    expect(segunda.pendencias).not.toContainEqual({
      nome: 'XENIA DATA CHEGOU DEPOIS',
      motivo: 'cadastrado sem data de nascimento',
    });

    const depois = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'XENIA DATA CHEGOU DEPOIS' },
    });

    expect(depois.birthDate.toISOString().slice(0, 10)).toBe('1993-09-05');
  });

  it('data de nascimento IMPLAUSIVEL no arquivo tambem cai no placeholder', async () => {
    // O arquivo do Pacto traz nascimentos em 2026 -- alguem digitou a data de
    // hoje no campo errado. Gravar isso criaria um "recem-nascido" matriculado.
    const resultado = await importar([
      registroDe(null, {
        nome: 'URSULA NASCIDA ONTEM',
        cpf: CPF.ursula,
        dataNascimento: '01/08/2026',
      }),
    ]);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'URSULA NASCIDA ONTEM' },
    });

    expect(criada.birthDate.toISOString().slice(0, 10)).toBe('1900-01-01');
    expect(resultado.pendencias).toContainEqual({
      nome: 'URSULA NASCIDA ONTEM',
      motivo: 'cadastrado sem data de nascimento',
    });
  });

  it('funcionario criado ganha direito por VINCULO, sem assinatura', async () => {
    const resultado = await importar([
      registroDe(null, {
        nome: 'NILO FUNCIONARIO NOVO',
        cpf: CPF.nilo,
        codigoPerfil: '2',
        dataInicio: '',
        dataFim: '',
      }),
    ]);

    expect(resultado.criados).toBe(1);
    expect(resultado.direitosPorVinculo).toBe(1);
    expect(resultado.direitosPorPlano).toBe(0);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'NILO FUNCIONARIO NOVO' },
    });

    expect(criada.profile).toBe('STAFF');
    expect(criada.status).toBe('ACTIVE');

    const direitos = await db.entitlement.findMany({ where: { studentId: criada.id } });

    expect(direitos).toHaveLength(1);
    expect(direitos[0]!.source).toBe('EMPLOYEE');
    expect(direitos[0]!.subscriptionId).toBeNull();
    // Funcionario nao paga mensalidade: assinatura falsa poluiria o financeiro.
    expect(await db.subscription.count({ where: { studentId: criada.id } })).toBe(0);
    expect(await db.invoice.count({ where: { studentId: criada.id } })).toBe(0);

    // Direito sem janela = `unitIds` vazio = catraca fechada com WRONG_UNIT.
    const janelas = await db.entitlementUnitWindow.findMany({
      where: { entitlementId: direitos[0]!.id },
      select: { gymUnitId: true },
    });

    expect([...new Set(janelas.map((j) => j.gymUnitId))]).toEqual([gymUnitId]);
  });

  it('professor criado ganha direito PERSONAL_TRAINER', async () => {
    const resultado = await importar([
      registroDe(null, { nome: 'OLGA PROFESSORA NOVA', cpf: CPF.olga, codigoPerfil: '3' }),
    ]);

    expect(resultado.criados).toBe(1);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'OLGA PROFESSORA NOVA' },
    });
    const direito = await db.entitlement.findFirstOrThrow({ where: { studentId: criada.id } });

    expect(criada.profile).toBe('TRAINER');
    expect(direito.source).toBe('PERSONAL_TRAINER');
    expect(await db.subscription.count({ where: { studentId: criada.id } })).toBe(0);
  });

  it('aluno criado SEM periodo e ativado, mas NAO ganha entitlement nenhum', async () => {
    const resultado = await importar([
      registroDe(null, {
        nome: 'PEDRO CRIADO SEM PERIODO',
        cpf: CPF.pedro,
        codigoPerfil: '1',
        dataInicio: '',
        dataFim: '',
      }),
    ]);

    expect(resultado.criados).toBe(1);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'PEDRO CRIADO SEM PERIODO' },
    });

    expect(criada.status).toBe('ACTIVE');
    // A REGRA No 1 APLICADA A QUEM NASCEU AGORA: cadastrar e ativar nao e dar
    // acesso. So `Entitlement` decide, e sem periodo nao ha o que congelar.
    expect(await db.entitlement.count({ where: { studentId: criada.id } })).toBe(0);
    expect(await db.subscription.count({ where: { studentId: criada.id } })).toBe(0);
    expect(resultado.pendencias).toContainEqual({
      nome: 'PEDRO CRIADO SEM PERIODO',
      motivo: 'aluno sem periodo de plano',
    });
  });

  it('duas linhas do arquivo para a mesma pessoa criam UMA -- a segunda vira pendencia', async () => {
    const antes = await db.student.count({ where: { tenantId: alvo.tenantId } });

    // O caso real: a mesma pessoa aparece 2x (cartoes 174 e 28) com CPF e
    // celular INVERTIDOS entre as linhas. Ninguem existe no banco antes disto.
    const resultado = await importar([
      registroDe(null, {
        nome: 'QUEZIA DUAS LINHAS',
        cpf: CPF.quezia,
        cartao: '174',
        celular: '62988881111',
      }),
      registroDe(null, {
        nome: 'QUEZIA DUAS LINHAS',
        cpf: CPF.quezia,
        cartao: '28',
        celular: '62988882222',
      }),
    ]);

    expect(resultado.criados).toBe(1);
    expect(await db.student.count({ where: { tenantId: alvo.tenantId } })).toBe(antes + 1);
    expect(resultado.pendencias).toContainEqual({
      nome: 'QUEZIA DUAS LINHAS',
      motivo: 'duplicata dentro do arquivo',
    });

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'QUEZIA DUAS LINHAS' },
    });

    // A PRIMEIRA OCORRENCIA VENCE, INTEIRA. Se a segunda tivesse sido
    // reprocessada, o cartao 28 e o celular ...2222 estariam la tambem -- e
    // seria o codigo escolhendo em silencio qual versao da pessoa e a boa.
    const credenciais = await db.studentCredential.findMany({
      where: { studentId: criada.id },
      select: { externalId: true },
    });

    expect(credenciais.map((c) => c.externalId)).toEqual(['174']);

    const contatos = await db.studentContact.findMany({
      where: { studentId: criada.id },
      select: { value: true },
    });

    expect(contatos.map((c) => c.value)).toEqual(['62988881111']);
  });

  it('duas linhas com o mesmo NOME e sem CPF tambem criam uma so', async () => {
    const antes = await db.student.count({ where: { tenantId: alvo.tenantId } });

    // Sem CPF o casamento cai para nome normalizado -- caixa e espaco
    // diferentes tem de continuar sendo a mesma pessoa.
    const resultado = await importar([
      registroDe(null, { nome: 'RUI SOMENTE NOME', cpf: '' }),
      registroDe(null, { nome: '  rui somente nome  ', cpf: '' }),
    ]);

    expect(resultado.criados).toBe(1);
    expect(await db.student.count({ where: { tenantId: alvo.tenantId } })).toBe(antes + 1);
    expect(resultado.pendencias).toContainEqual({
      nome: '  rui somente nome  ',
      motivo: 'duplicata dentro do arquivo',
    });
  });

  it('AMBIGUO continua pendencia -- nao cria pessoa nova para escapar da escolha', async () => {
    // Dois cadastros com o MESMO nome normalizado e sem CPF: `decidirCasamento`
    // devolve AMBIGUO.
    await criarAlunoCancelado({ nome: 'SONIA HOMONIMA' });
    await criarAlunoCancelado({ nome: 'SONIA HOMONIMA' });

    const antes = await db.student.count({ where: { tenantId: alvo.tenantId } });

    const resultado = await importar([registroDe(null, { nome: 'SONIA HOMONIMA', cpf: '' })]);

    // A TENTACAO QUE ESTE TESTE EXISTE PARA BARRAR: "nao sei qual dos dois,
    // entao cadastro um terceiro". Isso trocaria um problema visivel (uma
    // pendencia) por um invisivel (tres cadastros da mesma pessoa).
    expect(resultado.criados).toBe(0);
    expect(resultado.casados).toBe(0);
    expect(await db.student.count({ where: { tenantId: alvo.tenantId } })).toBe(antes);
    expect(resultado.pendencias).toEqual([
      { nome: 'SONIA HOMONIMA', motivo: 'mais de um candidato no cadastro' },
    ]);
  });

  it('quem e criado recebe o mesmo tratamento de quem casou -- endereco inclusive', async () => {
    await importar([
      registroDe(null, {
        nome: 'TULIO COM ENDERECO',
        cpf: CPF.tulio,
        endereco: 'RUA SINTETICA 500',
        bairro: 'CENTRO',
        cep: '75380000',
        municipio: 'Trindade',
      }),
    ]);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'TULIO COM ENDERECO' },
    });
    const endereco = await db.studentAddress.findFirstOrThrow({
      where: { studentId: criada.id },
    });

    // E o motivo de a criacao chamar `gravarPessoa` em vez de ter um caminho
    // proprio: caminho paralelo diverge na proxima fatia sem ninguem notar.
    expect(endereco.street).toBe('RUA SINTETICA 500');
    expect(endereco.postalCode).toBe('75380000');
    expect(endereco.city).toBe('Trindade');
    expect(endereco.state).toBe('GO');
  });

  it('a UF vem do ARQUIVO, e nao do padrao fixo', async () => {
    await importar([
      registroDe(null, {
        nome: 'WAGNER DE OUTRO ESTADO',
        cpf: CPF.wagner,
        endereco: 'RUA DE SAO PAULO 10',
        cep: '01000000',
        municipio: 'Sao Paulo',
        uf: 'sp',
      }),
    ]);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'WAGNER DE OUTRO ESTADO' },
    });
    const endereco = await db.studentAddress.findFirstOrThrow({
      where: { studentId: criada.id },
    });

    // CAIXA ALTA, vindo de `sp` minusculo: o Pacto escreve a sigla de tres
    // jeitos, e quem filtra por `SP` tem de achar todo mundo que mora la.
    expect(endereco.state).toBe('SP');
  });

  it('UF invalida no arquivo cai no padrao, em vez de gravar sujeira', async () => {
    await importar([
      registroDe(null, {
        nome: 'YARA COM UF TORTA',
        cpf: CPF.yara,
        endereco: 'RUA QUALQUER 1',
        municipio: 'Trindade',
        // `goias` por extenso: o campo existe, mas nao e sigla. Gravar como
        // veio deixaria a coluna com duas grafias para o mesmo estado.
        uf: 'goias',
      }),
    ]);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'YARA COM UF TORTA' },
    });
    const endereco = await db.studentAddress.findFirstOrThrow({
      where: { studentId: criada.id },
    });

    expect(endereco.state).toBe('GO');
  });

  it('endereco SEM CEP e gravado -- a rua sozinha ja localiza', async () => {
    await importar([
      registroDe(null, {
        nome: 'ZILDA SEM CEP',
        cpf: CPF.zilda,
        endereco: 'RUA SEM CEP 77',
        bairro: 'SANTUARIO',
        municipio: 'Trindade',
      }),
    ]);

    const criada = await db.student.findFirstOrThrow({
      where: { tenantId: alvo.tenantId, fullName: 'ZILDA SEM CEP' },
    });
    const endereco = await db.studentAddress.findFirstOrThrow({
      where: { studentId: criada.id },
    });

    // O REGIME ANTIGO DESCARTAVA ESTA LINHA INTEIRA. Sao 275 enderecos do
    // export real contra 69 CEPs: exigir os dois perdia a rua de quase toda
    // a base para preservar um CEP que o Pacto nao preenche.
    expect(endereco.street).toBe('RUA SEM CEP 77');
    expect(endereco.postalCode).toBe('');
  });

  it('endereco que mudou no arquivo ATUALIZA o que ja estava no banco', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'HEITOR QUE MUDOU DE CASA', cpf: CPF.heitor });

    await importar([
      registroDe(aluno, { endereco: 'RUA ANTIGA 1', cep: '75380000', municipio: 'Trindade' }),
    ]);
    await importar([
      registroDe(aluno, { endereco: 'RUA NOVA 2', cep: '75381111', municipio: 'Trindade' }),
    ]);

    const enderecos = await db.studentAddress.findMany({ where: { studentId: aluno.id } });

    // UM endereco, o novo. O regime antigo (`if (!jaTem)`) deixava a rua
    // antiga para sempre e ainda contava a pessoa como "endereco gravado" --
    // rerodar o import nao corrigia, e o relatorio dizia que estava tudo bem.
    expect(enderecos).toHaveLength(1);
    expect(enderecos[0]?.street).toBe('RUA NOVA 2');
    expect(enderecos[0]?.postalCode).toBe('75381111');
  });

  it('CEP ausente na segunda rodada NAO apaga o que ja estava gravado', async () => {
    const aluno = await criarAlunoCancelado({ nome: 'INES QUE PERDEU O CEP', cpf: CPF.ines });

    await importar([
      registroDe(aluno, { endereco: 'RUA ANTIGA 1', cep: '75380000', municipio: 'Trindade' }),
    ]);
    // Mesma pessoa, arquivo novo sem o CEP -- o caso do export atual, que
    // traz 275 ruas e so 69 CEPs.
    await importar([registroDe(aluno, { endereco: 'RUA NOVA 2', municipio: 'Trindade' })]);

    const endereco = await db.studentAddress.findFirstOrThrow({ where: { studentId: aluno.id } });

    expect(endereco.street).toBe('RUA NOVA 2');
    // Campo vazio no arquivo NAO apaga dado do banco -- regra do topo de
    // `importar.ts`. A rua atualiza; o CEP que ninguem trouxe permanece.
    expect(endereco.postalCode).toBe('75380000');
  });

  it('credencial que ja pertence a outro aluno vira pendencia, nao muda de dono', async () => {
    const dono = await criarAlunoCancelado({ nome: 'LUCAS DONO DO CARTAO' });
    const intruso = await criarAlunoCancelado({ nome: 'MARIA OUTRO ALUNO' });

    await importar([registroDe(dono, { cartao: '7777' })]);
    const resultado = await importar([registroDe(intruso, { cartao: '7777' })]);

    expect(resultado.pendencias).toContainEqual({
      nome: 'MARIA OUTRO ALUNO',
      motivo: 'credencial ja pertence a outro aluno',
    });

    const credencial = await db.studentCredential.findUniqueOrThrow({
      where: {
        tenantId_kind_externalId: {
          tenantId: alvo.tenantId,
          kind: 'TURNSTILE_CARD',
          externalId: '7777',
        },
      },
      select: { studentId: true },
    });

    // Reatribuir calado trocaria o dono de um cartao sem ninguem ver.
    expect(credencial.studentId).toBe(dono.id);
    expect(await db.studentCredential.count({ where: { studentId: intruso.id } })).toBe(0);
  });

  it('roda duas vezes e produz exatamente o mesmo banco', async () => {
    const comPlano = await criarAlunoCancelado({ nome: 'NADIA IDEMPOTENTE' });
    const funcionario = await criarAlunoCancelado({ nome: 'OTAVIO IDEMPOTENTE' });

    const lote: readonly RegistroDePessoaAtiva[] = [
      registroDe(comPlano, {
        codigoPerfil: '1',
        dataInicio: '20260803',
        dataFim: '20260902',
        cartao: '3001',
        identificadorFacial: '3002',
        telefone: '62988887777',
        email: 'nadia@example.test',
        endereco: 'RUA SINTETICA 100',
        cep: '75380000',
        municipio: 'Trindade',
        bairro: 'CENTRO',
      }),
      registroDe(funcionario, { codigoPerfil: '3' }),
    ];

    const ids = [comPlano.id, funcionario.id];

    const fotografar = async () => ({
      alunos: await db.student.findMany({
        where: { id: { in: ids } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, profile: true, birthDate: true },
      }),
      credenciais: await db.studentCredential.findMany({
        where: { studentId: { in: ids } },
        orderBy: [{ studentId: 'asc' }, { kind: 'asc' }],
        select: { id: true, studentId: true, kind: true, externalId: true },
      }),
      contatos: await db.studentContact.findMany({
        where: { studentId: { in: ids } },
        orderBy: [{ studentId: 'asc' }, { value: 'asc' }],
        select: { id: true, studentId: true, type: true, value: true },
      }),
      enderecos: await db.studentAddress.findMany({
        where: { studentId: { in: ids } },
        orderBy: { studentId: 'asc' },
        select: { id: true, studentId: true, street: true, postalCode: true, city: true },
      }),
      assinaturas: await db.subscription.findMany({
        where: { studentId: { in: ids } },
        orderBy: { studentId: 'asc' },
        select: {
          id: true,
          studentId: true,
          planId: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
      }),
      direitos: await db.entitlement.findMany({
        where: { studentId: { in: ids } },
        orderBy: { studentId: 'asc' },
        select: {
          id: true,
          studentId: true,
          source: true,
          subscriptionId: true,
          startsAt: true,
          endsAt: true,
          policySnapshot: true,
        },
      }),
      janelas: await db.entitlementUnitWindow.findMany({
        where: { entitlement: { studentId: { in: ids } } },
        orderBy: [{ entitlementId: 'asc' }, { gymUnitId: 'asc' }, { dayOfWeek: 'asc' }],
        select: {
          entitlementId: true,
          gymUnitId: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
        },
      }),
    });

    await importar(lote);
    const depoisDaPrimeira = await fotografar();

    await importar(lote);
    const depoisDaSegunda = await fotografar();

    // ID a ID, e nao contagem: recriar uma linha com id novo daria a mesma
    // contagem e ainda assim seria quebra de idempotencia.
    expect(depoisDaSegunda).toEqual(depoisDaPrimeira);
    expect(depoisDaPrimeira.direitos).toHaveLength(2);
    // Sete dias por direito, uma unidade: 14 janelas. Zero seria a catraca
    // fechada para os dois.
    expect(depoisDaPrimeira.janelas).toHaveLength(14);
  });
});
