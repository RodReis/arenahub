import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Dashboard operacional -- F57, `SPEC-057`.
 *
 * O que so integracao prova, e por isso este arquivo existe:
 *
 *   - o corte de "hoje" e a meia-noite LOCAL contra dado real: o evento das
 *     23h de ontem NAO entra, o das 00:30 de hoje entra. Teste de unidade
 *     prova a aritmetica; so aqui se prova que a QUERY a usa (AC-2);
 *   - gerente restrito a unidade A nao le numero nenhum da B (AC-8);
 *   - `DRAFT` nao vaza para o placar, e o publicado sai com NOME REAL
 *     (AC-5, AC-9);
 *   - desafio `ACTIVE` aparece; `DRAFT`/`CLOSED`/`CANCELLED` nao (AC-6);
 *   - feriado municipal e por UNIDADE, e o `@@unique` do banco impede a
 *     mesma data duas vezes (AC-7, AC-9).
 */
describe('F57 -- dashboard operacional', () => {
  const sufixo = randomUUID().slice(0, 8);

  let app: Awaited<ReturnType<typeof criarApp>>['app'];
  let db: PrismaService;
  let cookieAdmin: string;
  let cookieRestrito: string;

  const ids = {
    tenantId: '',
    unidadeA: '',
    unidadeB: '',
    alunoSuspenso: '',
    alunoBloqueado: '',
    alunoDoPlacar: '',
  };

  /**
   * Fuso de todos os casos: `America/Sao_Paulo` (UTC-3). Meia-noite local e
   * 03:00 UTC do mesmo dia.
   */
  const FUSO = 'America/Sao_Paulo';

  async function criarApp() {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const criada = mod.createNestApplication();
    await criada.init();
    return { app: criada, db: criada.get(PrismaService) };
  }

  /** `getHttpServer()` devolve `any`; o cast estreita para o que o supertest pede. */
  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];

  /** Instante UTC da meia-noite local de hoje, na unidade. */
  function inicioDeHojeUtc(): Date {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const buscar = (tipo: string): number =>
      Number(partes.find((p) => p.type === tipo)?.value ?? Number.NaN);

    // UTC-3 sem horario de verao desde 2019: meia-noite local = 03:00 UTC.
    return new Date(Date.UTC(buscar('year'), buscar('month') - 1, buscar('day'), 3, 0, 0));
  }

  async function criarSessao(
    email: string,
    permissoes: readonly string[],
    gymUnitId: string | null,
  ): Promise<string> {
    const senha = 'senha-de-teste-f57';

    const usuario = await db.user.create({
      data: { email, passwordHash: await app.get(PasswordService).gerarHash(senha) },
    });

    await db.tenantMembership.create({ data: { tenantId: ids.tenantId, userId: usuario.id } });

    const papel = await db.role.create({
      data: { tenantId: ids.tenantId, name: `PAPEL_${email}`, isSystem: false },
    });

    for (const code of permissoes) {
      const permissao = await db.permission.upsert({ where: { code }, update: {}, create: { code } });
      await db.rolePermission.create({ data: { roleId: papel.id, permissionId: permissao.id } });
    }

    await db.userRole.create({
      data: { tenantId: ids.tenantId, userId: usuario.id, roleId: papel.id, gymUnitId },
    });

    const login = await request(servidor())
      .post('/api/v1/auth/login')
      .send({ email, password: senha })
      .expect(200);

    return (login.headers['set-cookie'] as unknown as string[]).join('; ');
  }

  beforeAll(async () => {
    const criado = await criarApp();
    app = criado.app;
    db = criado.db;

    const tenant = await db.tenant.create({
      data: {
        slug: `dash-${sufixo}`,
        legalName: `Dash ${sufixo} LTDA`,
        displayName: `Dash ${sufixo}`,
      },
    });
    ids.tenantId = tenant.id;

    const [unidadeA, unidadeB] = await Promise.all([
      db.gymUnit.create({
        data: {
          tenantId: tenant.id,
          code: `A-${sufixo}`,
          name: `Matriz ${sufixo}`,
          timezone: FUSO,
          openingHours: {},
        },
      }),
      db.gymUnit.create({
        data: {
          tenantId: tenant.id,
          code: `B-${sufixo}`,
          name: `Filial ${sufixo}`,
          timezone: FUSO,
          openingHours: {},
        },
      }),
    ]);
    ids.unidadeA = unidadeA.id;
    ids.unidadeB = unidadeB.id;

    const aluno = async (nome: string, gymUnitId: string, extra: object) =>
      db.student.create({
        data: {
          tenantId: tenant.id,
          gymUnitId,
          fullName: nome,
          membershipNumber: `${sufixo}-${randomUUID().slice(0, 6)}`,
          birthDate: new Date('1995-01-01T00:00:00.000Z'),
          ...extra,
        },
      });

    const [suspenso, bloqueado, doPlacar] = await Promise.all([
      aluno('Suspenso da Matriz', unidadeA.id, {
        status: 'SUSPENDED',
        statusReason: 'MEDICAL',
      }),
      aluno('Bloqueado da Matriz', unidadeA.id, {
        status: 'BLOCKED',
        statusReason: 'DELINQUENCY',
      }),
      aluno('Joana Ribeiro do Placar', unidadeA.id, { status: 'ACTIVE' }),
      aluno('Bloqueado da Filial', unidadeB.id, {
        status: 'BLOCKED',
        statusReason: 'CONDUCT',
      }),
    ]);
    ids.alunoSuspenso = suspenso.id;
    ids.alunoBloqueado = bloqueado.id;
    ids.alunoDoPlacar = doPlacar.id;

    cookieAdmin = await criarSessao(
      `admin-${sufixo}@teste.local`,
      ['access.read', 'unit.read', 'unit.update', 'engagement.read'],
      null,
    );

    cookieRestrito = await criarSessao(
      `restrito-${sufixo}@teste.local`,
      ['access.read', 'unit.read', 'unit.update', 'engagement.read'],
      unidadeA.id,
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  /*
   * AC-2 -- "hoje" e o dia da unidade.
   *
   * Os dois eventos plantados cercam a meia-noite local: um MINUTO antes
   * (ontem) e trinta minutos depois (hoje). Uma janela de 24 h corridas
   * contaria os dois; o corte por dia civil conta um.
   */
  describe('AC-2 -- acessos de hoje cortam na meia-noite da unidade', () => {
    beforeAll(async () => {
      const meiaNoite = inicioDeHojeUtc();

      const evento = (ocorreuEm: Date, outcome: 'ALLOW' | 'DENY') =>
        db.accessEvent.create({
          data: {
            tenantId: ids.tenantId,
            gymUnitId: ids.unidadeA,
            studentId: ids.alunoDoPlacar,
            occurredAt: ocorreuEm,
            receivedAt: ocorreuEm,
            outcome,
            reason: outcome === 'ALLOW' ? 'ACTIVE_ENTITLEMENT' : 'NO_ENTITLEMENT',
            mode: 'ONLINE',
            method: 'FACIAL',
            policyVersion: 'f57-teste',
            correlationId: `f57-${randomUUID()}`,
            // Chave de idempotencia: reprocessar o mesmo evento e seguro
            // (regra de arquitetura no 4). Unica por evento aqui.
            idempotencyKey: `f57-${randomUUID()}`,
            detail: {},
          },
        });

      await Promise.all([
        // 23:59 de ONTEM, hora local.
        evento(new Date(meiaNoite.getTime() - 60_000), 'ALLOW'),
        // 00:30 de HOJE, hora local.
        evento(new Date(meiaNoite.getTime() + 30 * 60_000), 'ALLOW'),
        evento(new Date(meiaNoite.getTime() + 31 * 60_000), 'DENY'),
      ]);
    });

    it('conta o acesso de hoje e NAO o de ontem as 23h59', async () => {
      const resposta = await request(servidor())
        .get(`/api/v1/dashboard?gymUnitId=${ids.unidadeA}`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const corpo = resposta.body as {
        acessosDeHoje: { desde: string; allow: number; deny: number };
      };

      expect(corpo.acessosDeHoje.allow).toBe(1);
      expect(corpo.acessosDeHoje.deny).toBe(1);
      expect(corpo.acessosDeHoje.desde).toBe(inicioDeHojeUtc().toISOString());
    });
  });

  /*
   * AC-4 -- bloqueados e suspensos COM o motivo da lista fechada (#241).
   */
  it('AC-4 -- agrupa suspensos e bloqueados por motivo', async () => {
    const resposta = await request(servidor())
      .get(`/api/v1/dashboard?gymUnitId=${ids.unidadeA}`)
      .set('Cookie', cookieAdmin)
      .expect(200);

    const situacoes = (
      resposta.body as {
        situacoes: { status: string; motivo: string | null; quantidade: number; alunos: string[] }[];
      }
    ).situacoes;

    expect(situacoes).toContainEqual({
      status: 'SUSPENDED',
      motivo: 'MEDICAL',
      quantidade: 1,
      alunos: ['Suspenso da Matriz'],
    });
    expect(situacoes).toContainEqual({
      status: 'BLOCKED',
      motivo: 'DELINQUENCY',
      quantidade: 1,
      alunos: ['Bloqueado da Matriz'],
    });

    // O bloqueado da FILIAL nao entra na contagem da matriz.
    expect(situacoes.some((s) => s.motivo === 'CONDUCT')).toBe(false);
  });

  /*
   * A ORDEM ESTAVEL do bloco 4 NAO e testada aqui, e a ausencia e deliberada.
   *
   * A primeira versao deste arquivo tinha um teste que lia duas vezes e
   * exigia a mesma ordem. **O canario reprovou o teste**: removendo o
   * desempate do repositorio, ele continuou VERDE -- a ordem fisica do
   * Postgres nao e reproduzivel sob demanda, e um UPDATE numa tabela pequena
   * nao move a tupla o bastante.
   *
   * A prova real vive em `dashboard-ordem.spec.ts`, sobre a funcao de
   * comparacao alimentada com as entradas na ordem errada de proposito. La o
   * canario funciona.
   */

  /*
   * BLOCO 4 -- teto de cinco nomes por situacao.
   *
   * Cinco cabem na linha sem quebrar o cartao; o sexto e os seguintes viram
   * "e mais N" (`NOMES_POR_SITUACAO` no repositorio). Setup PROPRIO -- sete
   * bloqueados so para este teste -- para nao inflar o cenario compartilhado
   * do `beforeAll` de cima, que os outros testes tambem leem.
   */
  it('AC-4 -- mostra ate cinco nomes por situacao, e conta o resto', async () => {
    const unidadeC = await db.gymUnit.create({
      data: {
        tenantId: ids.tenantId,
        code: `C-${sufixo}`,
        name: `Teto ${sufixo}`,
        timezone: FUSO,
        openingHours: {},
      },
    });

    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        db.student.create({
          data: {
            tenantId: ids.tenantId,
            gymUnitId: unidadeC.id,
            fullName: `Bloqueado Teto ${i}`,
            membershipNumber: `${sufixo}-teto-${i}`,
            birthDate: new Date('1995-01-01T00:00:00.000Z'),
            status: 'BLOCKED',
            statusReason: 'CONDUCT',
          },
        }),
      ),
    );

    const resposta = await request(servidor())
      .get(`/api/v1/dashboard?gymUnitId=${unidadeC.id}`)
      .set('Cookie', cookieAdmin)
      .expect(200);

    const situacao = (
      resposta.body as { situacoes: { quantidade: number; alunos: string[] }[] }
    ).situacoes[0];

    expect(situacao?.quantidade).toBe(7);
    expect(situacao?.alunos).toHaveLength(5);
  });

  /*
   * AC-5 e AC-9 -- placar publicado, com nome real; `DRAFT` invisivel.
   */
  describe('AC-5 e AC-9 -- placar', () => {
    let mes = '';

    beforeAll(async () => {
      mes = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO,
        year: 'numeric',
        month: '2-digit',
      })
        .format(new Date())
        .slice(0, 7);

      const rascunho = await db.rankingSnapshot.create({
        data: {
          tenantId: ids.tenantId,
          gymUnitId: ids.unidadeA,
          localMonth: mes,
          category: 'XP_DO_MES',
          status: 'DRAFT',
          // Copiados da configuracao no momento da geracao -- obrigatorios no
          // model, e e por eles que o snapshot sabe que politica o produziu.
          minimumCohort: 1,
          eligibleCount: 1,
          generatedAt: new Date(),
        },
      });

      await db.rankingEntry.create({
        data: {
          snapshotId: rascunho.id,
          studentId: ids.alunoDoPlacar,
          position: 1,
          points: 999,
          // Criterio 2 do desempate, congelado junto com a posicao.
          lastEntryAt: new Date(),
        },
      });
    });

    it('rascunho NAO vaza para o dashboard', async () => {
      const resposta = await request(servidor())
        .get(`/api/v1/dashboard?gymUnitId=${ids.unidadeA}`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const placar = (resposta.body as { placar: { publicadoEm: string | null; entradas: [] } })
        .placar;

      expect(placar.entradas).toEqual([]);
      expect(placar.publicadoEm).toBeNull();
    });

    it('publicado aparece com NOME REAL e a data da publicacao', async () => {
      const publicadoEm = new Date();

      await db.rankingSnapshot.updateMany({
        where: { gymUnitId: ids.unidadeA, localMonth: mes },
        data: { status: 'PUBLISHED', publishedAt: publicadoEm },
      });

      const resposta = await request(servidor())
        .get(`/api/v1/dashboard?gymUnitId=${ids.unidadeA}`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const placar = (
        resposta.body as {
          placar: { publicadoEm: string | null; entradas: { nome: string; points: number }[] };
        }
      ).placar;

      // Nome INTEIRO, nao "Joana R." -- o painel e tela interna (decisao do
      // PI, 01/09/2026). Abreviar aqui daria a recepcao um nome que ela nao
      // liga a ficha do aluno.
      expect(placar.entradas).toEqual([
        { position: 1, points: 999, nome: 'Joana Ribeiro do Placar' },
      ]);
      expect(placar.publicadoEm).toBe(publicadoEm.toISOString());
    });
  });

  /*
   * AC-8 -- escopo de unidade. O gerente restrito a matriz nao le a filial.
   */
  describe('AC-8 -- escopo de unidade', () => {
    it('pedir a unidade B da 404 para quem so enxerga a A', async () => {
      await request(servidor())
        .get(`/api/v1/dashboard?gymUnitId=${ids.unidadeB}`)
        .set('Cookie', cookieRestrito)
        .expect(404);
    });

    it('sem pedir unidade, a unica visivel e a dele -- e os numeros sao dela', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/dashboard')
        .set('Cookie', cookieRestrito)
        .expect(200);

      const corpo = resposta.body as {
        unidade: { id: string } | null;
        unidades: { id: string }[];
      };

      expect(corpo.unidade?.id).toBe(ids.unidadeA);
      expect(corpo.unidades.map((u) => u.id)).toEqual([ids.unidadeA]);
    });

    it('quem ve as duas e nao escolhe nao recebe soma nenhuma', async () => {
      const resposta = await request(servidor())
        .get('/api/v1/dashboard')
        .set('Cookie', cookieAdmin)
        .expect(200);

      const corpo = resposta.body as {
        unidade: unknown;
        acessosDeHoje: unknown;
        unidades: { id: string }[];
      };

      // Somar duas unidades daria um numero que nao corresponde a academia
      // nenhuma. Sem escolha, os blocos que dependem de "hoje" ficam nulos.
      expect(corpo.unidade).toBeNull();
      expect(corpo.acessosDeHoje).toBeNull();
      expect(corpo.unidades.length).toBeGreaterThanOrEqual(2);
    });
  });

  /*
   * AC-7 e AC-9 -- feriados: nacional calculado, municipal por unidade.
   */
  describe('AC-7 e AC-9 -- feriados', () => {
    it('cadastra feriado municipal e ele aparece no mes', async () => {
      const mesCorrente = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO,
        year: 'numeric',
        month: '2-digit',
      })
        .format(new Date())
        .slice(0, 7);

      const data = `${mesCorrente}-15`;

      await request(servidor())
        .post(`/api/v1/dashboard/units/${ids.unidadeA}/holidays`)
        .set('Cookie', cookieAdmin)
        .send({ data, nome: 'Aniversario da cidade' })
        .expect(201);

      const resposta = await request(servidor())
        .get(`/api/v1/dashboard?gymUnitId=${ids.unidadeA}`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const feriados = (
        resposta.body as { feriados: { data: string; nome: string; origem: string }[] }
      ).feriados;

      expect(feriados).toContainEqual({
        data,
        nome: 'Aniversario da cidade',
        origem: 'MUNICIPAL',
      });
    });

    /*
     * A data e `@db.Date`, e o caminho de ida e volta passa por dois pontos
     * onde o fuso poderia deslocar um dia (gravacao e leitura). Este teste
     * existe para pegar exatamente esse deslocamento: pede dia 15, tem de
     * voltar dia 15.
     */
    it('a data volta EXATAMENTE como foi cadastrada, sem deslocar um dia', async () => {
      const lista = await request(servidor())
        .get(`/api/v1/dashboard/units/${ids.unidadeA}/holidays`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const itens = lista.body as { id: string; data: string; nome: string }[];
      const cadastrado = itens.find((f) => f.nome === 'Aniversario da cidade');

      expect(cadastrado?.data.endsWith('-15')).toBe(true);
    });

    it('cadastrar a mesma data duas vezes atualiza o nome, nao duplica a linha', async () => {
      const mesCorrente = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO,
        year: 'numeric',
        month: '2-digit',
      })
        .format(new Date())
        .slice(0, 7);

      await request(servidor())
        .post(`/api/v1/dashboard/units/${ids.unidadeA}/holidays`)
        .set('Cookie', cookieAdmin)
        .send({ data: `${mesCorrente}-15`, nome: 'Aniversario da cidade (corrigido)' })
        .expect(201);

      const lista = await request(servidor())
        .get(`/api/v1/dashboard/units/${ids.unidadeA}/holidays`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const itens = lista.body as { data: string; nome: string }[];
      const noDia15 = itens.filter((f) => f.data.endsWith('-15'));

      expect(noDia15).toHaveLength(1);
      expect(noDia15[0]?.nome).toBe('Aniversario da cidade (corrigido)');
    });

    it('o feriado da matriz NAO aparece na filial -- o calendario e por unidade', async () => {
      const daFilial = await request(servidor())
        .get(`/api/v1/dashboard/units/${ids.unidadeB}/holidays`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      expect(daFilial.body).toEqual([]);
    });

    it('cadastrar feriado em unidade fora do escopo e 404, e nao grava nada', async () => {
      await request(servidor())
        .post(`/api/v1/dashboard/units/${ids.unidadeB}/holidays`)
        .set('Cookie', cookieRestrito)
        .send({ data: '2026-12-08', nome: 'Nao deveria entrar' })
        .expect(404);

      const gravados = await db.localHoliday.count({ where: { gymUnitId: ids.unidadeB } });
      expect(gravados).toBe(0);
    });

    it('remove feriado cadastrado', async () => {
      const lista = await request(servidor())
        .get(`/api/v1/dashboard/units/${ids.unidadeA}/holidays`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const alvo = (lista.body as { id: string }[])[0];

      await request(servidor())
        .delete(`/api/v1/dashboard/units/${ids.unidadeA}/holidays/${alvo?.id}`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      const depois = await request(servidor())
        .get(`/api/v1/dashboard/units/${ids.unidadeA}/holidays`)
        .set('Cookie', cookieAdmin)
        .expect(200);

      expect((depois.body as unknown[]).length).toBe(0);
    });
  });
});
