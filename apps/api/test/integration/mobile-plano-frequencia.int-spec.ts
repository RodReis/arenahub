import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';

/**
 * Plano e frequencia pela porta HTTP -- F24, Slice 4.2.
 *
 * PELA PORTA HTTP, e nao so no service, pelo mesmo motivo que a suite da F23
 * existe: `students`, `entitlements` e `access_events` tem RLS com FORCE, e
 * sob o role restrito uma consulta fora de transacao com contexto devolve
 * ZERO LINHAS sem erro e sem log. Um teste de service com dublê passaria
 * verde e a tela viria vazia.
 *
 * O QUE ESTA SUITE NAO TESTA: carteirinha e QR. Foram cortados do escopo
 * desta fatia por decisao do PI em 12/09/2026 -- a Slice 4.2 original os
 * previa, e eles voltam quando o PI decidir quem escaneia o QR.
 */
describe('F24 -- Plano e frequencia do app', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const SLUG = `f24pf-${sufixo}`;
  const EMAIL = `aluno-pf-${sufixo}@exemplo.test`;
  const EMAIL_SEM_PLANO = `aluno-sp-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-longa';

  let tenantId: string;
  let unidadeId: string;
  let alunoId: string;
  let alunoSemPlanoId: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  interface CorpoDoPlano {
    asOf: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
    /*
     * `inicioEm` e `fimEm` sao `string`, e nao `string | null`: as colunas do
     * entitlement sao obrigatorias, entao quando HA plano as duas datas
     * existem. A nulidade mora um nivel acima -- `plano: null` --, e escreve-la
     * tambem nos campos faria o teste tolerar uma resposta sem validade, que e
     * justamente o que ele deveria recusar.
     */
    plano: {
      situacao: string;
      inicioEm: string;
      fimEm: string;
      nome: string | null;
    } | null;
  }

  interface CorpoDaFrequencia {
    asOf: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
    periodo: string;
    granularidade: string;
    totalDeSessoes: number;
    totalDePassagens: number;
    baldes: { rotulo: string; sessoes: number; passagens: number }[];
  }

  const entrar = async (identificador = EMAIL): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/mobile/auth/login')
      .send({ tenantSlug: SLUG, identificador, senha: SENHA });

    return (resposta.body as { accessToken: string }).accessToken;
  };

  /**
   * Cria aluno com conta ativa e devolve o `studentId`.
   *
   * `matricula` vem por parametro, e nao derivada do e-mail: todos os e-mails
   * da suite comecam com prefixo parecido, e derivar dava a MESMA matricula
   * para dois alunos -- a unica `(tenant_id, membership_number)` recusava o
   * segundo e a suite inteira caia no `beforeAll`.
   */
  const criarAluno = async (
    identifier: string,
    nome: string,
    matricula: string,
  ): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `${matricula}-${sufixo}`,
        fullName: nome,
        birthDate: new Date('1990-01-01'),
      },
    });

    await db.studentAccount.create({
      data: {
        tenantId,
        studentId: aluno.id,
        identifier,
        passwordHash: await senhas.gerarHash(SENHA),
        status: 'ACTIVE',
        activatedAt: new Date(),
      },
    });

    return aluno.id;
  };

  /** Uma passagem CONFIRMADA num dia -- o unico fato que vira frequencia. */
  const registrarTreino = async (studentId: string, quando: Date): Promise<void> => {
    const evento = await db.accessEvent.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        studentId,
        outcome: 'ALLOW',
        reason: 'ACTIVE_ENTITLEMENT',
        policyVersion: 'teste@1',
        mode: 'ONLINE',
        method: 'FACIAL',
        occurredAt: quando,
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        detail: {},
      },
    });

    await db.accessPassage.create({
      data: { tenantId, accessEventId: evento.id, state: 'CONFIRMED' },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: { slug: SLUG, legalName: 'Academia F24 LTDA', displayName: 'Academia F24' },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `F24-${sufixo}`,
        name: 'Unidade F24',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    unidadeId = unidade.id;

    alunoId = await criarAluno(EMAIL, 'Joana Ribeiro Costa', 'COMPLANO');
    alunoSemPlanoId = await criarAluno(EMAIL_SEM_PLANO, 'Pedro Santos Lima', 'SEMPLANO');

    /*
     * Entitlement VIGENTE do primeiro aluno: comeca no passado e termina no
     * futuro, para que a resposta nao dependa do instante em que a suite roda.
     */
    await db.entitlement.create({
      data: {
        tenantId,
        studentId: alunoId,
        source: 'COURTESY',
        status: 'ACTIVE',
        startsAt: new Date(Date.now() - 30 * 86_400_000),
        endsAt: new Date(Date.now() + 30 * 86_400_000),
        reason: 'fixture da suite F24',
        policySnapshot: {},
      },
    });

    // Dois treinos em DIAS distintos, e duas passagens no MESMO dia: a
    // distincao entre `totalDeSessoes` (dias) e `totalDePassagens` so aparece
    // com os dois casos presentes.
    //
    // ANCORADO NO MEIO-DIA UTC (09h em Sao Paulo), nao em `Date.now()`
    // puro: o teste rodando perto da virada de meia-noite local faz "1 dia
    // atras" e "1 dia atras + 1 hora" carem em dias civis DIFERENTES, e a
    // suite conta 3 sessoes em vez de 2 -- foi exatamente isso que aconteceu
    // no CI as 02h06 UTC (23h06 em SP), issue achada na F29 mas o bug e da
    // F24. Meio-dia UTC fica a 12h de qualquer virada, entao a soma de 1h
    // nunca cruza a fronteira do dia civil, seja qual for o horario em que
    // o CI decidir rodar.
    const meioDiaUtcHaDias = (dias: number): Date => {
      const agora = new Date();
      const ancora = new Date(
        Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12, 0, 0),
      );
      return new Date(ancora.getTime() - dias * 86_400_000);
    };

    await registrarTreino(alunoId, meioDiaUtcHaDias(3));
    await registrarTreino(alunoId, meioDiaUtcHaDias(1));
    await registrarTreino(alunoId, new Date(meioDiaUtcHaDias(1).getTime() + 3_600_000));
  });

  afterAll(async () => {
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    await app?.close();
  });

  describe('GET /api/v1/mobile/plano', () => {
    it('devolve o plano vigente do aluno da SESSAO', async () => {
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/plano')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDoPlano;
      expect(corpo.status).toBe('AVAILABLE');
      expect(corpo.plano?.situacao).toBe('ACTIVE');
      expect(corpo.plano?.fimEm).toBeTruthy();
    });

    it('aluno SEM entitlement recebe `plano: null`, e nao um estado inventado', async () => {
      /*
       * `null` e nao `{ situacao: 'INACTIVE' }`: nunca houve direito, e
       * afirmar uma situacao para quem nao tem nenhuma e inventar dado. A
       * tela decide o texto do estado vazio; a API nao mente para facilitar.
       */
      const acesso = await entrar(EMAIL_SEM_PLANO);

      const resposta = await request(servidor())
        .get('/api/v1/mobile/plano')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDoPlano;
      expect(corpo.status).toBe('AVAILABLE');
      expect(corpo.plano).toBeNull();
    });

    it('direito ACTIVE com `endsAt` no passado NAO e exibido como vigente', async () => {
      /*
       * O defeito que a revisao adversarial achou. `status` so vira `EXPIRED`
       * quando algo expira o direito, e enquanto esse algo nao roda existe
       * linha `ACTIVE` com a janela vencida. Exibi-la como vigente faria o
       * aluno sair de casa com um direito que a CATRACA recusa -- la a janela
       * e conferida (`access-projection.repository.ts`).
       *
       * O ALUNO PRECISA TER OS DOIS DIREITOS, e essa e a lica que o canario
       * ensinou: com SO o vencido, o teste passava mesmo com o defeito
       * presente -- o fallback ("o mais recente conta a historia") devolvia a
       * mesma linha, e a asserção nunca alcancava a guarda testada. Com um
       * vigente de verdade ao lado, escolher o vencido vira erro visivel.
       *
       * O vencido COMECOU depois, entao `startsAt desc` -- a ordem antiga --
       * o escolheria.
       */
      const email = `vencido-${sufixo}@exemplo.test`;
      const id = await criarAluno(email, 'Carla Dias Moura', 'VENCIDO');
      const vigenteAte = new Date(Date.now() + 20 * 86_400_000);

      await db.entitlement.create({
        data: {
          tenantId,
          studentId: id,
          source: 'SUBSCRIPTION',
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 90 * 86_400_000),
          endsAt: vigenteAte,
          policySnapshot: {},
        },
      });

      await db.entitlement.create({
        data: {
          tenantId,
          studentId: id,
          source: 'COURTESY',
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 60 * 86_400_000),
          endsAt: new Date(Date.now() - 10 * 86_400_000),
          reason: 'direito com janela vencida e status nao atualizado',
          policySnapshot: {},
        },
      });

      const resposta = await request(servidor())
        .get('/api/v1/mobile/plano')
        .set('Authorization', `Bearer ${await entrar(email)}`);

      const corpo = resposta.body as CorpoDoPlano;
      // O que vale HOJE, e nao a linha vencida que o `status` ainda chama de
      // ACTIVE.
      expect(new Date(corpo.plano!.fimEm).toISOString()).toBe(vigenteAte.toISOString());
    });

    it('entre dois direitos vigentes, mostra o que TERMINA por ultimo', async () => {
      /*
       * INV-064: assinatura, cortesia, visitante e dependente coexistem, e
       * nenhuma unica no banco impede dois `ACTIVE`. Ordenar por `startsAt`
       * mostraria a cortesia de uma semana concedida HOJE no lugar da
       * mensalidade que vai ate dezembro -- e a pergunta que a tela responde
       * e "ate quando posso treinar?".
       */
      const email = `dois-${sufixo}@exemplo.test`;
      const id = await criarAluno(email, 'Rafael Neves Pinto', 'DOIS');

      const longo = new Date(Date.now() + 120 * 86_400_000);

      await db.entitlement.create({
        data: {
          tenantId,
          studentId: id,
          source: 'SUBSCRIPTION',
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 30 * 86_400_000),
          endsAt: longo,
          policySnapshot: {},
        },
      });

      // Comeca DEPOIS e termina ANTES: e o que `startsAt desc` escolheria.
      await db.entitlement.create({
        data: {
          tenantId,
          studentId: id,
          source: 'COURTESY',
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 1 * 86_400_000),
          endsAt: new Date(Date.now() + 7 * 86_400_000),
          reason: 'cortesia curta concedida depois',
          policySnapshot: {},
        },
      });

      const resposta = await request(servidor())
        .get('/api/v1/mobile/plano')
        .set('Authorization', `Bearer ${await entrar(email)}`);

      const corpo = resposta.body as CorpoDoPlano;
      expect(new Date(corpo.plano!.fimEm).toISOString()).toBe(longo.toISOString());
    });

    it('sem token responde 401', async () => {
      await request(servidor()).get('/api/v1/mobile/plano').expect(401);
    });

    it('nao aceita id de aluno na consulta -- o aluno sai da sessao', async () => {
      /*
       * O buraco que a F27 fechou no totem, fechado aqui tambem: com id na
       * URL, quem tem uma sessao valida leria o plano de qualquer aluno do
       * tenant trocando um UUID. O parametro tem de ser IGNORADO, nao honrado.
       */
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get(`/api/v1/mobile/plano?studentId=${alunoSemPlanoId}`)
        .set('Authorization', `Bearer ${acesso}`);

      // O aluno da sessao TEM plano; o da query nao. Responder `null` aqui
      // provaria que o parametro foi obedecido.
      expect((resposta.body as CorpoDoPlano).plano?.situacao).toBe('ACTIVE');
    });
  });

  describe('GET /api/v1/mobile/frequencia', () => {
    it('conta DIAS treinados, nao passagens', async () => {
      // Tres passagens em dois dias: 2 sessoes, 3 passagens. Colapsar os dois
      // numeros faria quem entrou duas vezes na terca "treinar" dois dias.
      const acesso = await entrar();

      const resposta = await request(servidor())
        .get('/api/v1/mobile/frequencia?periodo=30D&granularidade=SEMANAL')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDaFrequencia;
      expect(corpo.status).toBe('AVAILABLE');
      expect(corpo.totalDeSessoes).toBe(2);
      expect(corpo.totalDePassagens).toBe(3);
    });

    it('aluno sem treino no periodo recebe serie vazia, e nao erro', async () => {
      // Estado vazio e resposta legitima: "nenhum treino" nao e falha.
      const acesso = await entrar(EMAIL_SEM_PLANO);

      const resposta = await request(servidor())
        .get('/api/v1/mobile/frequencia?periodo=30D&granularidade=SEMANAL')
        .set('Authorization', `Bearer ${acesso}`);

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDaFrequencia;
      expect(corpo.status).toBe('AVAILABLE');
      expect(corpo.totalDeSessoes).toBe(0);
      expect(corpo.baldes).toEqual([]);
    });

    it('recusa periodo fora da lista, em vez de cair num padrao silencioso', async () => {
      /*
       * 400 (o mesmo status e o mesmo formato de `health-progress.controller`)
       * e nao "usa 30D por padrao": um periodo invalido que vira padrao
       * devolve um numero correto para OUTRA pergunta, e a tela o exibe como
       * resposta a que foi feita.
       *
       * Periodo AUSENTE e caso diferente e tem padrao -- ver o controller.
       */
      const acesso = await entrar();

      await request(servidor())
        .get('/api/v1/mobile/frequencia?periodo=ONTEM&granularidade=SEMANAL')
        .set('Authorization', `Bearer ${acesso}`)
        .expect(400);
    });

    it('sem token responde 401', async () => {
      await request(servidor()).get('/api/v1/mobile/frequencia').expect(401);
    });

    it('nao aceita id de aluno na consulta -- o aluno sai da sessao', async () => {
      const acesso = await entrar(EMAIL_SEM_PLANO);

      const resposta = await request(servidor())
        .get(`/api/v1/mobile/frequencia?periodo=30D&granularidade=SEMANAL&studentId=${alunoId}`)
        .set('Authorization', `Bearer ${acesso}`);

      // Quem pediu nao treinou. Ver as 2 sessoes do outro aluno provaria que
      // o parametro foi obedecido.
      expect((resposta.body as CorpoDaFrequencia).totalDeSessoes).toBe(0);
    });
  });
});
