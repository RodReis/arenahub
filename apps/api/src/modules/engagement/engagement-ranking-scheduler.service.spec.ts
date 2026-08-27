import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementRankingSchedulerService } from './engagement-ranking-scheduler.service.js';
import { EngagementRankingService } from './engagement-ranking.service.js';
import { FakePortaDeRanking } from './engagement-ranking.repository.fake.js';

/** `AAAA-MM-01T00:00:00Z` -- o job roda diariamente, mas so faz algo de
 * verdade quando o mes anterior ainda nao tem snapshot publicado. */
const PRIMEIRO_DE_SETEMBRO = new Date('2026-09-01T03:00:00.000Z');

/** Saldo minimo para popular `fake.comSaldos`. */
function saldosDeAlunos(quantidade: number, prefixo = 'aluno'): { studentId: string; points: number; lastEntryAt: Date }[] {
  return Array.from({ length: quantidade }, (_valor, indice) => ({
    studentId: `${prefixo}-${indice + 1}`,
    points: (quantidade - indice) * 10,
    lastEntryAt: PRIMEIRO_DE_SETEMBRO,
  }));
}

describe('EngagementRankingSchedulerService', () => {
  let fake: FakePortaDeRanking;
  let ranking: EngagementRankingService;
  let job: EngagementRankingSchedulerService;

  beforeEach(() => {
    fake = new FakePortaDeRanking();
    ranking = new EngagementRankingService(fake);
    job = new EngagementRankingSchedulerService(ranking, fake);
    fake.comCoorteMinima(5);
  });

  it('no dia 1, publica o mes anterior', async () => {
    fake.comUnidadeAtiva('t1', 'u1', 'America/Sao_Paulo');
    fake.comSaldos('u1', '2026-08', saldosDeAlunos(5));

    const resultado = await job.executarCiclo(PRIMEIRO_DE_SETEMBRO);

    expect(resultado).toEqual({ unidades: 1, fechadas: 1, falhas: 0 });

    const publicado = await fake.snapshotPublicado(
      { tenantId: 't1', actorId: 'a', sessionId: 's', permissions: new Set(), allowedUnitIds: 'ALL' },
      'u1',
      '2026-08',
    );
    expect(publicado?.status).toBe('PUBLISHED');
  });

  it('rodar duas vezes nao cria dois snapshots', async () => {
    fake.comUnidadeAtiva('t1', 'u1', 'America/Sao_Paulo');
    fake.comSaldos('u1', '2026-08', saldosDeAlunos(5));

    await job.executarCiclo(PRIMEIRO_DE_SETEMBRO);
    const segundaRodada = await job.executarCiclo(PRIMEIRO_DE_SETEMBRO);

    // Segunda rodada nao fecha de novo -- ja existe snapshot publicado.
    expect(segundaRodada).toEqual({ unidades: 1, fechadas: 0, falhas: 0 });
  });

  it('mes anterior ja publicado nao tenta republicar (sem levantar 409)', async () => {
    fake.comUnidadeAtiva('t1', 'u1', 'America/Sao_Paulo');
    fake.comSaldos('u1', '2026-08', saldosDeAlunos(5));

    const contexto = {
      tenantId: 't1',
      actorId: 'a',
      sessionId: 's',
      permissions: new Set<string>(),
      allowedUnitIds: 'ALL' as const,
    };
    const snapshot = await ranking.gerarSnapshot(contexto, 'u1', '2026-08', PRIMEIRO_DE_SETEMBRO);
    await ranking.publicar(contexto, snapshot.id, PRIMEIRO_DE_SETEMBRO);

    await expect(job.executarCiclo(PRIMEIRO_DE_SETEMBRO)).resolves.toEqual({
      unidades: 1,
      fechadas: 0,
      falhas: 0,
    });
  });

  it('falha em um tenant nao impede os outros', async () => {
    fake.comUnidadeAtiva('t1', 'u1', 'America/Sao_Paulo');
    fake.comUnidadeAtiva('t2', 'u2', 'America/Sao_Paulo');
    fake.comSaldos('u1', '2026-08', saldosDeAlunos(5, 'a1'));
    fake.comSaldos('u2', '2026-08', saldosDeAlunos(5, 'a2'));

    // Forca falha SO na primeira unidade processada, substituindo o metodo
    // que le a coorte minima -- generico o bastante para nao depender de
    // qual das duas o Promise.all resolve primeiro internamente.
    const coorteMinimaOriginal = fake.coorteMinima.bind(fake);
    let chamadas = 0;
    fake.coorteMinima = (contexto) => {
      chamadas += 1;
      if (chamadas === 1) return Promise.reject(new Error('falha simulada'));
      return coorteMinimaOriginal(contexto);
    };

    const resultado = await job.executarCiclo(PRIMEIRO_DE_SETEMBRO);

    expect(resultado.unidades).toBe(2);
    expect(resultado.falhas).toBe(1);
    expect(resultado.fechadas).toBe(1);
  });

  it('coorte pequena vira WITHHELD sem contar como falha', async () => {
    fake.comUnidadeAtiva('t1', 'u1', 'America/Sao_Paulo');
    fake.comSaldos('u1', '2026-08', saldosDeAlunos(2));

    const resultado = await job.executarCiclo(PRIMEIRO_DE_SETEMBRO);

    expect(resultado).toEqual({ unidades: 1, fechadas: 0, falhas: 0 });
  });
});
