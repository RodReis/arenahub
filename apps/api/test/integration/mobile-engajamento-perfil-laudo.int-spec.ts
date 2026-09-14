import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { mesLocal } from '../../src/modules/engagement/domain/movimento-de-xp.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';

/**
 * Engajamento, perfil e laudo do app -- pela porta HTTP.
 *
 * PELA PORTA HTTP, e nao so no service, pelo mesmo motivo das suites da F23 e
 * da F24: `students` tem RLS com FORCE, e a leitura fora de `comTenant` volta
 * vazia sem erro. O caminho inteiro -- guard da sessao, contexto de tenant,
 * casos de uso do `EngagementModule` e do `HealthModule` -- so e exercitado
 * junto aqui.
 *
 * O `POST /engajamento/ranking` grava `consent_records` com `actor_id` NULO
 * (`tenantContextDoAluno`): esta suite e a prova de que a coluna aceita, e
 * nao so o tipo.
 */
describe('App do aluno -- engajamento, perfil e laudo', () => {
  let app: INestApplication;
  let db: PrismaService;
  let senhas: PasswordService;

  const sufixo = randomUUID().slice(0, 8);
  const SLUG = `mob-eng-${sufixo}`;
  const EMAIL_ANA = `ana-${sufixo}@exemplo.test`;
  const EMAIL_BRUNO = `bruno-${sufixo}@exemplo.test`;
  const EMAIL_AVALIADOR = `avaliador-${sufixo}@exemplo.test`;
  const SENHA = 'senha-de-teste-longa';

  let tenantId: string;
  let unidadeId: string;
  let anaId: string;
  let brunoId: string;
  let avaliadorId: string;
  let regraId: string;

  const servidor = (): Parameters<typeof request>[0] =>
    app.getHttpServer() as Parameters<typeof request>[0];

  interface CorpoDoEngajamento {
    status: string;
    mes: string;
    unidade: { nome: string };
    xp: { saldoDoMes: number; conquistas: unknown[] | null };
    consistencia: { atual: number; recorde: number; diasPorSemana: number };
    ranking: {
      participa: boolean;
      nomeExibido: string;
      minhaPosicao: { posicao: number; pontos: number } | null;
      placar: { posicao: number; nome: string; pontos: number; souEu: boolean }[];
    } | null;
    desafios: unknown[] | null;
  }

  interface CorpoDoPerfil {
    nome: string;
    matricula: string;
    nascimento: string;
    email: string | null;
    telefone: string | null;
    alunoDesde: string;
    unidade: string;
  }

  interface CorpoDoLaudo {
    avaliacao: {
      data: string;
      metricas: {
        tipo: string;
        valor: number;
        unidade: string | null;
        leitura: string;
        faixaMin: number | null;
        faixaMax: number | null;
      }[];
      regioes: Record<string, { gorduraKg: number | null; leituraGordura: string }>;
    } | null;
  }

  const entrar = async (identificador: string): Promise<string> => {
    const resposta = await request(servidor())
      .post('/api/v1/mobile/auth/login')
      .send({ tenantSlug: SLUG, identificador, senha: SENHA });

    return (resposta.body as { accessToken: string }).accessToken;
  };

  const criarAluno = async (identifier: string, nome: string, matricula: string): Promise<string> => {
    const aluno = await db.student.create({
      data: {
        tenantId,
        gymUnitId: unidadeId,
        membershipNumber: `${matricula}-${sufixo}`,
        fullName: nome,
        birthDate: new Date('1992-03-15'),
        status: 'ACTIVE',
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

  /**
   * XP pelo LEDGER, e nao por `student_xp_balances` direto: o GET chama
   * `sincronizarXp`, que reconstroi o saldo a partir do ledger -- saldo
   * gravado a mao sem movimento seria sobrescrito por zero.
   */
  const concederXp = async (studentId: string, pontos: number): Promise<void> => {
    const localMonth = mesLocal(new Date(), 'America/Sao_Paulo');

    await db.xpLedgerEntry.create({
      data: {
        tenantId,
        studentId,
        sourceKind: 'ATTENDANCE_SESSION',
        sourceId: randomUUID(),
        ruleVersionId: regraId,
        type: 'GRANT',
        points: pontos,
        occurredAt: new Date(),
        localMonth,
      },
    });

    /*
     * E a PROJECAO tambem: o placar le `student_xp_balances` da unidade, e so
     * o aluno que abre o app sincroniza o proprio saldo. Sem esta linha o
     * outro aluno nunca entraria na coorte, e o placar sairia vazio pelo
     * motivo errado (coorte abaixo do minimo).
     */
    await db.studentXpBalance.create({
      data: { tenantId, studentId, localMonth, points: pontos, entryCount: 1, lastEntryAt: new Date() },
    });
  };

  const buscar = (caminho: string, token: string) =>
    request(servidor()).get(caminho).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get(PrismaService);
    senhas = app.get(PasswordService);

    const tenant = await db.tenant.create({
      data: {
        slug: SLUG,
        legalName: 'Academia Mobile Engajamento LTDA',
        displayName: 'Academia Mobile Engajamento',
        // Coorte de 2: os dois alunos da suite ja formam placar, sem precisar
        // de cinco figurantes.
        rankingMinimumCohort: 2,
      },
    });
    tenantId = tenant.id;

    const unidade = await db.gymUnit.create({
      data: {
        tenantId,
        code: `MOB-${sufixo}`,
        name: 'Unidade Jardins',
        timezone: 'America/Sao_Paulo',
        openingHours: {},
      },
    });
    unidadeId = unidade.id;

    anaId = await criarAluno(EMAIL_ANA, 'Ana Carolina Prado', 'ANA');
    brunoId = await criarAluno(EMAIL_BRUNO, 'Bruno Teixeira Lopes', 'BRUNO');

    const conteudo = `Termo de ranking de teste -- ${sufixo}. `.repeat(3);
    await db.consentDocument.create({
      data: {
        tenantId,
        type: 'RANKING',
        version: 1,
        purpose: 'Finalidade de teste RANKING',
        content: conteudo,
        contentSha256: createHash('sha256').update(conteudo, 'utf8').digest('hex'),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

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
    regraId = regra.id;

    await concederXp(anaId, 20);
    await concederXp(brunoId, 50);

    // Contatos da Ana: um e-mail ANTIGO nao principal e um NOVO principal --
    // o principal tem de vencer mesmo cadastrado depois.
    await db.studentContact.create({
      data: { tenantId, studentId: anaId, type: 'EMAIL', value: `antigo-${sufixo}@exemplo.test`, isPrimary: false },
    });
    await db.studentContact.create({
      data: { tenantId, studentId: anaId, type: 'EMAIL', value: EMAIL_ANA, isPrimary: true },
    });
    await db.studentContact.create({
      data: { tenantId, studentId: anaId, type: 'WHATSAPP', value: '11987654321', isPrimary: true },
    });

    const avaliador = await db.user.create({
      data: { email: EMAIL_AVALIADOR, passwordHash: await senhas.gerarHash(SENHA) },
    });
    avaliadorId = avaliador.id;
  });

  afterAll(async () => {
    // Tenant antes do usuario: `body_assessments.evaluator_user_id` e Restrict.
    if (tenantId) await db.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
    if (avaliadorId) await db.user.delete({ where: { id: avaliadorId } }).catch(() => undefined);
    await app?.close();
  });

  describe('GET /api/v1/mobile/engajamento', () => {
    it('devolve o XP do aluno da SESSAO e marca so a linha dele no placar', async () => {
      const resposta = await buscar('/api/v1/mobile/engajamento', await entrar(EMAIL_ANA));

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDoEngajamento;
      expect(corpo.status).toBe('AVAILABLE');
      expect(corpo.mes).toBe(mesLocal(new Date(), 'America/Sao_Paulo'));
      expect(corpo.unidade).toEqual({ nome: 'Unidade Jardins' });
      // 20 da Ana, e nao 50 do Bruno nem 70 da unidade.
      expect(corpo.xp.saldoDoMes).toBe(20);
      expect(corpo.consistencia.diasPorSemana).toBeGreaterThan(0);
      // Flags do tenant no padrao (tudo ligado): secoes presentes, nao `null`.
      expect(corpo.desafios).toEqual([]);
      expect(corpo.xp.conquistas).toEqual([]);

      expect(corpo.ranking?.participa).toBe(true);
      expect(corpo.ranking?.minhaPosicao).toEqual({ posicao: 2, pontos: 20 });
      expect(corpo.ranking?.placar.map((linha) => [linha.posicao, linha.pontos, linha.souEu])).toEqual([
        [1, 50, false],
        [2, 20, true],
      ]);
      // Placar publico sem id de ninguem (M5-AC-001).
      expect(JSON.stringify(corpo.ranking)).not.toContain(brunoId);
      expect(JSON.stringify(corpo.ranking)).not.toContain(anaId);
    });

    it('ignora `?studentId=` de outro aluno', async () => {
      const resposta = await buscar(
        `/api/v1/mobile/engajamento?studentId=${brunoId}`,
        await entrar(EMAIL_ANA),
      );

      expect((resposta.body as CorpoDoEngajamento).xp.saldoDoMes).toBe(20);
    });

    it('secao desligada pelo tenant volta `null`', async () => {
      await db.tenant.update({
        where: { id: tenantId },
        data: { engagementChallengesEnabled: false, engagementAchievementsEnabled: false },
      });

      try {
        const resposta = await buscar('/api/v1/mobile/engajamento', await entrar(EMAIL_ANA));
        const corpo = resposta.body as CorpoDoEngajamento;

        expect(corpo.desafios).toBeNull();
        expect(corpo.xp.conquistas).toBeNull();
        expect(corpo.ranking).not.toBeNull();
      } finally {
        await db.tenant.update({
          where: { id: tenantId },
          data: { engagementChallengesEnabled: true, engagementAchievementsEnabled: true },
        });
      }
    });

    it('sem token responde 401', async () => {
      await request(servidor()).get('/api/v1/mobile/engajamento').expect(401);
    });
  });

  describe('POST /api/v1/mobile/engajamento/ranking', () => {
    const decidir = (token: string, corpo: unknown, chave?: string) => {
      const pedido = request(servidor())
        .post('/api/v1/mobile/engajamento/ranking')
        .set('Authorization', `Bearer ${token}`);

      if (chave !== undefined) pedido.set('Idempotency-Key', chave);

      return pedido.send(corpo as object);
    };

    it('desliga e religa, com ator nulo, e o GET seguinte reflete', async () => {
      const token = await entrar(EMAIL_ANA);

      const saiu = await decidir(token, { participa: false }, `sair-${sufixo}`);
      expect(saiu.status).toBe(200);
      expect(saiu.body).toEqual({ participa: false, nomeExibido: '' });

      const depoisDeSair = (await buscar('/api/v1/mobile/engajamento', token)).body as CorpoDoEngajamento;
      expect(depoisDeSair.ranking?.participa).toBe(false);
      expect(depoisDeSair.ranking?.minhaPosicao).toBeNull();

      // A decisao foi gravada para a Ana, sem usuario do painel como ator.
      const decisao = await db.consentRecord.findFirstOrThrow({
        where: { tenantId, studentId: anaId, supersededAt: null, document: { type: 'RANKING' } },
      });
      expect(decisao.decision).toBe('REFUSED');
      expect(decisao.actorId).toBeNull();

      const voltou = await decidir(token, { participa: true }, `voltar-${sufixo}`);
      expect(voltou.status).toBe(200);
      expect((voltou.body as { participa: boolean }).participa).toBe(true);

      const depoisDeVoltar = (await buscar('/api/v1/mobile/engajamento', token)).body as CorpoDoEngajamento;
      expect(depoisDeVoltar.ranking?.participa).toBe(true);
      expect(depoisDeVoltar.ranking?.minhaPosicao).toEqual({ posicao: 2, pontos: 20 });
    });

    it('mesma Idempotency-Key nao grava segunda decisao', async () => {
      const token = await entrar(EMAIL_BRUNO);
      const chave = `dedupe-${sufixo}`;

      await decidir(token, { participa: false }, chave).expect(200);
      await decidir(token, { participa: false }, chave).expect(200);

      const decisoes = await db.consentRecord.count({ where: { tenantId, studentId: brunoId } });
      expect(decisoes).toBe(1);
    });

    it('corpo invalido responde 400 com codigo estavel', async () => {
      const token = await entrar(EMAIL_ANA);

      for (const corpo of [{}, { participa: 'sim' }, { participa: true, studentId: brunoId }]) {
        const resposta = await decidir(token, corpo);

        expect(resposta.status).toBe(400);
        expect((resposta.body as { code: string }).code).toBe('MOBILE_INVALID_RANKING_PREFERENCE');
      }

      const chaveCurta = await decidir(token, { participa: true }, 'curta');
      expect(chaveCurta.status).toBe(400);
    });
  });

  describe('GET /api/v1/mobile/perfil', () => {
    it('devolve o aluno da sessao, com contato principal, e ignora `?studentId=`', async () => {
      const resposta = await buscar(`/api/v1/mobile/perfil?studentId=${brunoId}`, await entrar(EMAIL_ANA));

      expect(resposta.status).toBe(200);

      const corpo = resposta.body as CorpoDoPerfil;
      expect(corpo.nome).toBe('Ana Carolina Prado');
      expect(corpo.matricula).toBe(`ANA-${sufixo}`);
      expect(corpo.nascimento).toBe('1992-03-15');
      expect(corpo.email).toBe(EMAIL_ANA);
      expect(corpo.telefone).toBe('11987654321');
      expect(corpo.unidade).toBe('Unidade Jardins');
      expect(Number.isNaN(Date.parse(corpo.alunoDesde))).toBe(false);
      expect(Object.keys(corpo)).not.toContain('cpf');
    });

    it('aluno sem contato recebe `null`, e nao string vazia', async () => {
      const corpo = (await buscar('/api/v1/mobile/perfil', await entrar(EMAIL_BRUNO))).body as CorpoDoPerfil;

      expect(corpo.nome).toBe('Bruno Teixeira Lopes');
      expect(corpo.email).toBeNull();
      expect(corpo.telefone).toBeNull();
    });
  });

  describe('GET /api/v1/mobile/avaliacoes/laudo', () => {
    it('sem avaliacao publicada responde `avaliacao: null`', async () => {
      const resposta = await buscar('/api/v1/mobile/avaliacoes/laudo', await entrar(EMAIL_BRUNO));

      expect(resposta.status).toBe(200);
      expect((resposta.body as CorpoDoLaudo).avaliacao).toBeNull();
    });

    it('devolve a ULTIMA publicada, com faixa do fabricante e leitura decidida no servidor', async () => {
      const criarAvaliacao = async (assessedAt: Date, peso: number): Promise<string> => {
        const avaliacao = await db.bodyAssessment.create({
          data: {
            tenantId,
            studentId: anaId,
            status: 'PUBLISHED',
            assessedAt,
            publishedAt: assessedAt,
            evaluatorUserId: avaliadorId,
            measurements: {
              create: [
                { tenantId, type: 'WEIGHT', originalValue: peso, originalUnit: 'KG', canonicalValue: peso, canonicalUnit: 'KG' },
                {
                  tenantId,
                  type: 'SEGMENTAL_FAT_MASS_TRUNK',
                  originalValue: 10,
                  originalUnit: 'KG',
                  canonicalValue: 10,
                  canonicalUnit: 'KG',
                },
              ],
            },
          },
        });

        return avaliacao.id;
      };

      await criarAvaliacao(new Date('2026-03-10T15:00:00.000Z'), 70);
      const ultimaId = await criarAvaliacao(new Date('2026-06-20T15:00:00.000Z'), 80);

      // Faixa do fabricante so para o PESO da ultima: 55 a 75 kg -> ABOVE.
      await db.assessmentImport.create({
        data: {
          tenantId,
          studentId: anaId,
          status: 'CONFIRMED',
          originalFilename: 'laudo.pdf',
          fileType: 'application/pdf',
          fileSizeBytes: 1024,
          uploadedByUserId: avaliadorId,
          reviewedByUserId: avaliadorId,
          reviewedAt: new Date('2026-06-20T16:00:00.000Z'),
          assessmentId: ultimaId,
          fields: {
            create: [{ tenantId, type: 'WEIGHT', state: 'CONFIRMED', referenceMin: 55, referenceMax: 75 }],
          },
        },
      });

      const resposta = await buscar('/api/v1/mobile/avaliacoes/laudo', await entrar(EMAIL_ANA));
      expect(resposta.status).toBe(200);

      const avaliacao = (resposta.body as CorpoDoLaudo).avaliacao;
      expect(avaliacao?.data).toBe('2026-06-20');
      expect(avaliacao?.metricas).toEqual([
        { tipo: 'WEIGHT', valor: 80, unidade: 'kg', leitura: 'ABOVE', faixaMin: 55, faixaMax: 75 },
      ]);
      expect(Object.keys(avaliacao?.regioes ?? {}).sort()).toEqual([
        'ARM_LEFT',
        'ARM_RIGHT',
        'LEG_LEFT',
        'LEG_RIGHT',
        'TRUNK',
      ]);
      // Medida sem faixa: valor presente, leitura UNKNOWN -- nunca WITHIN.
      expect(avaliacao?.regioes['TRUNK']).toMatchObject({ gorduraKg: 10, leituraGordura: 'UNKNOWN' });
      expect(avaliacao?.regioes['ARM_LEFT']).toMatchObject({ gorduraKg: null, leituraGordura: 'UNKNOWN' });
    });
  });
});
