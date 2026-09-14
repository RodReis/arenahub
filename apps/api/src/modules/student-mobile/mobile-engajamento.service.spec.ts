import { describe, expect, it, jest } from '@jest/globals';

import type { EngagementChallengesService } from '../engagement/engagement-challenges.service.js';
import type { EngagementRankingService } from '../engagement/engagement-ranking.service.js';
import type { EngagementXpService } from '../engagement/engagement-xp.service.js';
import type { EngagementService } from '../engagement/engagement.service.js';
import type { StudentChannelContext } from '../student-identity/student-identity.service.js';
import { MobileEngajamentoService } from './mobile-engajamento.service.js';

const ctx: StudentChannelContext = {
  tenantId: 'tenant-1',
  studentId: 'aluno-da-sessao',
  accountId: 'conta-1',
  sessionId: 'sessao-1',
  reauthenticatedAt: null,
};

/** 03h UTC de 01/09 = 00h de 01/09 em Sao Paulo, mas ainda 31/08 em Manaus. */
const AGORA = new Date('2026-09-01T03:30:00.000Z');

const TUDO_LIGADO = {
  rankingEnabled: true,
  challengesEnabled: true,
  achievementsEnabled: true,
  correctionLimitPoints: null,
};

/**
 * Dublês dos casos de uso publicos do `EngagementModule`.
 *
 * `jest.fn` e nao os `*.repository.fake.ts`: este servico nao tem regra de
 * dominio -- so traduz --, e o que se testa aqui e a TRADUCAO (qual unidade,
 * qual fuso, qual aluno, o que vira `null`). Os fakes provariam de novo a
 * regra dos servicos de engajamento, que ja tem suite propria.
 */
function montar(configuracao = TUDO_LIGADO, timezone = 'America/Sao_Paulo') {
  const db = {
    comTenant: jest.fn(() =>
      Promise.resolve({ gymUnitId: 'unidade-do-aluno', gymUnit: { name: 'Centro', timezone } }),
    ),
  };

  const engajamento = {
    obterConfiguracao: jest.fn<EngagementService['obterConfiguracao']>().mockResolvedValue(configuracao),
    obterPreferencias: jest.fn<EngagementService['obterPreferencias']>().mockResolvedValue({
      finalidades: { RANKING: true, CHALLENGE: false, ENGAGEMENT_PUSH: false, PHYSICAL_EVOLUTION_RANKING: false },
      perfil: null,
      nomeExibido: 'Ana',
    }),
    atualizarPreferencia: jest.fn<EngagementService['atualizarPreferencia']>(),
  };

  const xp = {
    sincronizarXp: jest
      .fn<EngagementXpService['sincronizarXp']>()
      .mockResolvedValue({ concedidos: 0, saldoDoMes: 30, conquistasNovas: [] }),
    obterExtratoCompleto: jest.fn<EngagementXpService['obterExtratoCompleto']>().mockResolvedValue({
      saldoDoMes: 30,
      mes: '2026-09',
      movimentos: [],
      conquistas: [
        {
          titulo: 'Primeiro treino',
          desbloqueadaEm: new Date('2026-08-02T12:00:00.000Z'),
          revertida: false,
          motivo: null,
        },
      ],
    }),
    obterConsistencia: jest.fn<EngagementXpService['obterConsistencia']>().mockResolvedValue({
      atual: 2,
      recorde: 5,
      diasPorSemana: 3,
      politica: 'streak@1',
      semanas: [],
    }),
  };

  const ranking = {
    posicaoAoVivoDoAluno: jest
      .fn<EngagementRankingService['posicaoAoVivoDoAluno']>()
      .mockResolvedValue({ position: 2, nomeExibido: 'Ana', points: 30 }),
    placarAoVivo: jest.fn<EngagementRankingService['placarAoVivo']>().mockResolvedValue([
      { position: 1, nomeExibido: 'Bruno', points: 40 },
      // Mesma posicao e mesmos pontos, NOME diferente: empate. So o nome
      // separa a linha do aluno da do outro.
      { position: 2, nomeExibido: 'Ana', points: 30 },
      { position: 2, nomeExibido: 'Ana Paula', points: 30 },
      // Mesmo nome, outra posicao: homonimo.
      { position: 4, nomeExibido: 'Ana', points: 10 },
    ]),
  };

  const desafios = {
    paraOAluno: jest.fn<EngagementChallengesService['paraOAluno']>().mockResolvedValue([
      {
        id: 'desafio-1',
        title: '12 treinos em setembro',
        meta: 12,
        progresso: 4,
        inscrito: true,
        startsOn: '2026-09-01',
        endsOn: '2026-09-30',
      },
    ]),
  };

  const service = new MobileEngajamentoService(
    db as never,
    engajamento as never,
    xp as never,
    ranking as never,
    desafios as never,
  );

  return { service, db, engajamento, xp, ranking, desafios };
}

describe('MobileEngajamentoService', () => {
  it('monta as quatro secoes pela unidade e pelo fuso DO ALUNO', async () => {
    const { service, ranking, desafios, xp } = montar();

    const resposta = await service.montar(ctx, AGORA);

    expect(resposta.mes).toBe('2026-09');
    expect(resposta.unidade).toEqual({ nome: 'Centro' });
    expect(resposta.xp.saldoDoMes).toBe(30);
    expect(resposta.xp.conquistas).toEqual([
      { titulo: 'Primeiro treino', desbloqueadaEm: '2026-08-02T12:00:00.000Z', revertida: false },
    ]);
    expect(resposta.consistencia).toEqual({ atual: 2, recorde: 5, diasPorSemana: 3 });
    expect(ranking.placarAoVivo).toHaveBeenCalledWith(expect.anything(), 'unidade-do-aluno', '2026-09', AGORA);
    expect(desafios.paraOAluno).toHaveBeenCalledWith(
      expect.anything(),
      'aluno-da-sessao',
      'unidade-do-aluno',
      '2026-09-01',
    );
    expect(xp.obterConsistencia).toHaveBeenCalledWith(
      expect.anything(),
      'aluno-da-sessao',
      '2026-09-01',
      'America/Sao_Paulo',
    );
    expect(resposta.desafios).toEqual([
      {
        id: 'desafio-1',
        titulo: '12 treinos em setembro',
        meta: 12,
        progresso: 4,
        inscrito: true,
        inicio: '2026-09-01',
        fim: '2026-09-30',
      },
    ]);
  });

  it('o fuso nao e fixo: em Manaus o mesmo instante ainda e agosto', async () => {
    // Com o fuso de Sao Paulo fixado como no totem, este aluno veria o placar
    // de setembro zerado as 23h30 do dia 31 de agosto.
    const { service, desafios } = montar(TUDO_LIGADO, 'America/Manaus');

    const resposta = await service.montar(ctx, AGORA);

    expect(resposta.mes).toBe('2026-08');
    expect(desafios.paraOAluno).toHaveBeenCalledWith(
      expect.anything(),
      'aluno-da-sessao',
      'unidade-do-aluno',
      '2026-08-31',
    );
  });

  it('sincroniza o XP ANTES de ler o extrato', async () => {
    const { service, xp } = montar();

    await service.montar(ctx, AGORA);

    const sincronizou = xp.sincronizarXp.mock.invocationCallOrder[0] ?? Infinity;
    const leu = xp.obterExtratoCompleto.mock.invocationCallOrder[0] ?? -Infinity;
    expect(sincronizou).toBeLessThan(leu);
  });

  it('secao desligada pelo tenant vira null, e nao lista vazia -- e nem e consultada', async () => {
    const { service, ranking, desafios, engajamento } = montar({
      rankingEnabled: false,
      challengesEnabled: false,
      achievementsEnabled: false,
      correctionLimitPoints: null,
    });

    const resposta = await service.montar(ctx, AGORA);

    expect(resposta.ranking).toBeNull();
    expect(resposta.desafios).toBeNull();
    expect(resposta.xp.conquistas).toBeNull();
    // O saldo NAO some com as conquistas: XP nao depende das flags (M5-BR-002).
    expect(resposta.xp.saldoDoMes).toBe(30);
    expect(ranking.placarAoVivo).not.toHaveBeenCalled();
    expect(ranking.posicaoAoVivoDoAluno).not.toHaveBeenCalled();
    expect(engajamento.obterPreferencias).not.toHaveBeenCalled();
    expect(desafios.paraOAluno).not.toHaveBeenCalled();
  });

  it('souEu marca SO a linha que bate posicao, nome e pontos com a do aluno', async () => {
    const { service } = montar();

    const resposta = await service.montar(ctx, AGORA);

    expect(resposta.ranking?.minhaPosicao).toEqual({ posicao: 2, pontos: 30 });
    expect(resposta.ranking?.placar.map((linha) => linha.souEu)).toEqual([false, true, false, false]);
    // Nenhuma linha carrega id de aluno (M5-AC-001).
    expect(Object.keys(resposta.ranking?.placar[0] ?? {}).sort()).toEqual(['nome', 'pontos', 'posicao', 'souEu']);
  });

  it('sem posicao propria (opt-out, coorte minima) nenhuma linha e do aluno', async () => {
    const { service, ranking } = montar();
    ranking.posicaoAoVivoDoAluno.mockResolvedValue(null);

    const resposta = await service.montar(ctx, AGORA);

    expect(resposta.ranking?.minhaPosicao).toBeNull();
    expect(resposta.ranking?.placar.some((linha) => linha.souEu)).toBe(false);
  });

  it('placar vem cortado nas 10 primeiras linhas', async () => {
    const { service, ranking } = montar();
    ranking.placarAoVivo.mockResolvedValue(
      Array.from({ length: 15 }, (_, indice) => ({
        position: indice + 1,
        nomeExibido: `Aluno ${indice + 1}`,
        points: 100 - indice,
      })),
    );

    const resposta = await service.montar(ctx, AGORA);

    expect(resposta.ranking?.placar).toHaveLength(10);
  });

  it('todo caso de uso recebe o aluno e o tenant da SESSAO, com ator nulo', async () => {
    const { service, xp, ranking, engajamento } = montar();

    await service.montar(ctx, AGORA);

    const contextoEsperado = {
      tenantId: 'tenant-1',
      actorId: null,
      sessionId: 'sessao-1',
      permissions: new Set(),
      allowedUnitIds: 'ALL',
    };
    expect(xp.sincronizarXp).toHaveBeenCalledWith(contextoEsperado, 'aluno-da-sessao', AGORA);
    expect(xp.obterExtratoCompleto).toHaveBeenCalledWith(contextoEsperado, 'aluno-da-sessao', '2026-09');
    expect(ranking.posicaoAoVivoDoAluno).toHaveBeenCalledWith(
      contextoEsperado,
      'unidade-do-aluno',
      '2026-09',
      'aluno-da-sessao',
    );
    expect(engajamento.obterPreferencias).toHaveBeenCalledWith(contextoEsperado, 'aluno-da-sessao');
    expect(engajamento.obterConfiguracao).toHaveBeenCalledWith('tenant-1');
  });

  it('atualizarRanking grava RANKING para o aluno da sessao e devolve o estado', async () => {
    const { service, engajamento } = montar();
    engajamento.atualizarPreferencia.mockResolvedValue({
      finalidades: { RANKING: false, CHALLENGE: false, ENGAGEMENT_PUSH: false, PHYSICAL_EVOLUTION_RANKING: false },
      perfil: null,
      nomeExibido: '',
    });

    const resposta = await service.atualizarRanking(ctx, false, 'chave-123456', AGORA);

    expect(engajamento.atualizarPreferencia).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', actorId: null }),
      { studentId: 'aluno-da-sessao', finalidade: 'RANKING', participa: false, idempotencyKey: 'chave-123456' },
      AGORA,
    );
    expect(resposta).toEqual({ participa: false, nomeExibido: '' });
  });

  it('aluno da sessao que sumiu responde MOBILE_STUDENT_NOT_FOUND', async () => {
    const { service, db, xp } = montar();
    db.comTenant.mockResolvedValue(null as never);

    await expect(service.montar(ctx, AGORA)).rejects.toMatchObject({
      code: 'MOBILE_STUDENT_NOT_FOUND',
      status: 404,
    });
    expect(xp.sincronizarXp).not.toHaveBeenCalled();
  });
});
