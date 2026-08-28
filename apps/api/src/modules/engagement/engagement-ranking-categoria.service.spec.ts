import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementRankingService } from './engagement-ranking.service.js';
import { FakePortaDeRanking } from './engagement-ranking.repository.fake.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

const TENANT = 'tenant-a';
const UNIDADE = 'unidade-1';
const MES = '2026-08';

function contexto(): TenantContext {
  return {
    tenantId: TENANT,
    actorId: 'ator-1',
    sessionId: 'sessao-1',
    permissions: new Set<string>(),
    allowedUnitIds: 'ALL',
  };
}

/**
 * Registra um aluno e devolve o id.
 *
 * Um por chamada, e nao uma lista: `noUncheckedIndexedAccess` faz todo acesso
 * indexado render `string | undefined`, e cada uso no teste viraria um `!`.
 */
function comAluno(porta: FakePortaDeRanking, indice: number): string {
  const id = `aluno-${indice}`;
  porta.comAluno(id, `Aluno ${indice}`);
  return id;
}

describe('EngagementRankingService -- placar por categoria (F35)', () => {
  let porta: FakePortaDeRanking;
  let service: EngagementRankingService;

  beforeEach(() => {
    // Instancia NOVA por teste: dublê com estado compartilhado vaza modo
    // ligado de um bloco para o proximo.
    porta = new FakePortaDeRanking();
    service = new EngagementRankingService(porta);
    porta.comCoorteMinima(2);
  });

  it('gera o placar de XP -- comportamento da F31, inalterado', async () => {
    const a = comAluno(porta, 0);
    const b = comAluno(porta, 1);
    porta.comSaldos(UNIDADE, MES, [
      { studentId: a, points: 30, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
      { studentId: b, points: 10, lastEntryAt: new Date('2026-08-11T10:00:00Z') },
    ]);

    const snapshot = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'XP_DO_MES');

    expect(snapshot.status).toBe('DRAFT');
    expect(snapshot.entries.map((e) => e.studentId)).toEqual([a, b]);
  });

  it('gera o placar de FREQUENCIA a partir de sessoes, nao de XP', async () => {
    // A ordem tem de INVERTER em relacao ao XP: quem tem mais XP aqui tem
    // menos sessoes. Se a categoria fosse ignorada, o teste veria a ordem do
    // XP e passaria pelo motivo errado.
    const a = comAluno(porta, 0);
    const b = comAluno(porta, 1);
    porta.comSaldos(UNIDADE, MES, [
      { studentId: a, points: 300, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
      { studentId: b, points: 10, lastEntryAt: new Date('2026-08-11T10:00:00Z') },
    ]);
    porta.comFrequencia(UNIDADE, MES, [
      { studentId: a, points: 2, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
      { studentId: b, points: 18, lastEntryAt: new Date('2026-08-11T10:00:00Z') },
    ]);

    const snapshot = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'FREQUENCIA');

    expect(snapshot.entries.map((e) => e.studentId)).toEqual([b, a]);
    expect(snapshot.entries[0]?.points).toBe(18);
  });

  it('gera o placar de CONSISTENCIA a partir de semanas elegiveis', async () => {
    const a = comAluno(porta, 0);
    const b = comAluno(porta, 1);
    porta.comConsistencia(UNIDADE, MES, [
      { studentId: a, points: 1, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
      { studentId: b, points: 4, lastEntryAt: new Date('2026-08-11T10:00:00Z') },
    ]);

    const snapshot = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'CONSISTENCIA');

    expect(snapshot.entries.map((e) => e.studentId)).toEqual([b, a]);
  });

  it('O CANARIO DA FATIA: gerar uma categoria NAO apaga o rascunho de outra', async () => {
    // A regeracao da F31 apagava o DRAFT existente da mesma unidade/mes. Sem
    // olhar a categoria, gerar frequencia em agosto destruiria o rascunho de
    // XP de agosto -- e o operador so descobriria ao publicar e nao achar.
    const a = comAluno(porta, 0);
    const b = comAluno(porta, 1);
    const saldos = [
      { studentId: a, points: 30, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
      { studentId: b, points: 10, lastEntryAt: new Date('2026-08-11T10:00:00Z') },
    ];
    porta.comSaldos(UNIDADE, MES, saldos);
    porta.comFrequencia(UNIDADE, MES, saldos);

    const doXp = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'XP_DO_MES');
    await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'FREQUENCIA');

    // O de XP tem de continuar la, recuperavel pelo proprio id.
    const aindaExiste = await service.snapshotPorId(contexto(), doXp.id);
    expect(aindaExiste).not.toBeNull();
    expect(aindaExiste?.id).toBe(doXp.id);
  });

  it('regerar a MESMA categoria continua substituindo o rascunho', async () => {
    // O outro lado do canario: a protecao por categoria nao pode virar
    // acumulo de rascunhos duplicados da mesma categoria.
    const a = comAluno(porta, 0);
    const b = comAluno(porta, 1);
    porta.comSaldos(UNIDADE, MES, [
      { studentId: a, points: 30, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
      { studentId: b, points: 10, lastEntryAt: new Date('2026-08-11T10:00:00Z') },
    ]);

    const primeiro = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'XP_DO_MES');
    const segundo = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'XP_DO_MES');

    expect(segundo.id).not.toBe(primeiro.id);
    expect(await service.snapshotPorId(contexto(), primeiro.id)).toBeNull();
  });

  it('coorte insuficiente retem a categoria, sem afetar as outras', async () => {
    const a = comAluno(porta, 0);
    porta.comFrequencia(UNIDADE, MES, [
      { studentId: a, points: 5, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
    ]);

    const snapshot = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'FREQUENCIA');

    expect(snapshot.status).toBe('WITHHELD');
    expect(snapshot.entries).toHaveLength(0);
  });

  it('opt-out vale em TODA categoria, nao so no XP', async () => {
    // resolverExposicao nao muda com a categoria -- quem pediu para sair sai
    // do placar de frequencia tambem.
    const a = comAluno(porta, 0);
    const b = comAluno(porta, 1);
    const c = comAluno(porta, 2);
    porta.comFrequencia(UNIDADE, MES, [
      { studentId: a, points: 20, lastEntryAt: new Date('2026-08-10T10:00:00Z') },
      { studentId: b, points: 15, lastEntryAt: new Date('2026-08-11T10:00:00Z') },
      { studentId: c, points: 10, lastEntryAt: new Date('2026-08-12T10:00:00Z') },
    ]);
    porta.comOptOut(a);

    const snapshot = await service.gerarSnapshot(contexto(), UNIDADE, MES, new Date(), 'FREQUENCIA');

    expect(snapshot.entries.map((e) => e.studentId)).toEqual([b, c]);
  });
});
