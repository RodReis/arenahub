import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  });

  afterAll(async () => {
    // Limpa o rastro da suite -- `Cascade` a partir do tenant leva aluno,
    // credencial, assinatura, direito e janela junto.
    if (alvo) {
      await db.tenant.delete({ where: { id: alvo.tenantId } }).catch(() => undefined);
    }

    await db?.$disconnect();
  });

  /** Numero de matricula unico por chamada -- a coluna e UNIQUE por tenant. */
  let proximaMatricula = 0;

  /**
   * Insere um aluno no estado que a F47 deixou: `CANCELLED`, sem credencial,
   * sem assinatura, sem direito.
   */
  async function criarAlunoCancelado(dados: {
    nome?: string;
    cpf?: string | null;
    status?: 'CANCELLED' | 'BLOCKED' | 'ARCHIVED';
  }): Promise<{ id: string; fullName: string; cpf: string | null }> {
    proximaMatricula += 1;

    return db.student.create({
      data: {
        tenantId: alvo.tenantId,
        gymUnitId,
        membershipNumber: `AP-2026-${String(proximaMatricula).padStart(8, '0')}`,
        fullName: dados.nome ?? `PESSOA SINTETICA ${proximaMatricula}`,
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
    expect(janelas.map((j) => j.dayOfWeek).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(janelas.every((j) => j.startMinute === 0 && j.endMinute === 1440)).toBe(true);
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

  it('nunca cria aluno: quem nao casa vira pendencia', async () => {
    const antes = await db.student.count({ where: { tenantId: alvo.tenantId } });

    const resultado = await importar([
      registroDe(null, { nome: 'KARINA QUE NUNCA EXISTIU', cpf: '' }),
    ]);

    expect(resultado.casados).toBe(0);
    expect(resultado.pendencias).toEqual([
      { nome: 'KARINA QUE NUNCA EXISTIU', motivo: 'nao encontrado no cadastro' },
    ]);
    expect(await db.student.count({ where: { tenantId: alvo.tenantId } })).toBe(antes);
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
