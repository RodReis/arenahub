import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { EngagementRankingService } from './engagement-ranking.service.js';
import { FakePortaDeRanking } from './engagement-ranking.repository.fake.js';

const CTX: TenantContext = {
  tenantId: 't1',
  actorId: 'u1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: new Set(['unidade-1']),
};
const AGORA = new Date('2026-08-27T12:00:00.000Z');
const MES = '2026-08';

/** Saldo minimo para popular `fake.comSaldos`. */
interface SaldoDeTeste {
  studentId: string;
  points: number;
  lastEntryAt: Date;
}

function saldosDeAlunos(quantidade: number): SaldoDeTeste[] {
  return Array.from({ length: quantidade }, (_valor, indice) => ({
    studentId: `aluno-${indice + 1}`,
    points: (quantidade - indice) * 10,
    lastEntryAt: AGORA,
  }));
}

describe('EngagementRankingService.gerarSnapshot', () => {
  let fake: FakePortaDeRanking;
  let servico: EngagementRankingService;

  beforeEach(() => {
    fake = new FakePortaDeRanking();
    servico = new EngagementRankingService(fake);
  });

  it('retem a categoria abaixo da coorte minima', async () => {
    const quatroAlunos = saldosDeAlunos(4);
    fake.comCoorteMinima(5);
    fake.comSaldos('unidade-1', MES, quatroAlunos);

    const snapshot = await servico.gerarSnapshot(CTX, 'unidade-1', MES, AGORA);

    expect(snapshot.status).toBe('WITHHELD');
    expect(snapshot.entries).toEqual([]);
  });

  it('gera DRAFT quando a coorte alcanca o minimo', async () => {
    const cincoAlunos = saldosDeAlunos(5);
    fake.comCoorteMinima(5);
    fake.comSaldos('unidade-1', MES, cincoAlunos);

    const snapshot = await servico.gerarSnapshot(CTX, 'unidade-1', MES, AGORA);

    expect(snapshot.status).toBe('DRAFT');
  });

  /*
   * A coorte conta APENAS quem apareceria. Contar quem esta em opt-out
   * inflaria o numero e publicaria um placar de tres pessoas alegando cinco.
   */
  it('nao conta aluno em opt-out na coorte', async () => {
    const cincoAlunos = saldosDeAlunos(5);
    fake.comCoorteMinima(5);
    fake.comSaldos('unidade-1', MES, cincoAlunos);
    fake.comOptOut(cincoAlunos[0]!.studentId);

    const snapshot = await servico.gerarSnapshot(CTX, 'unidade-1', MES, AGORA);

    expect(snapshot.status).toBe('WITHHELD');
  });
});

describe('EngagementRankingService.publicar', () => {
  let fake: FakePortaDeRanking;
  let servico: EngagementRankingService;

  beforeEach(() => {
    fake = new FakePortaDeRanking();
    servico = new EngagementRankingService(fake);
    fake.comCoorteMinima(5);
    fake.comSaldos('unidade-1', MES, saldosDeAlunos(5));
  });

  it('recusa republicar um snapshot ja publicado', async () => {
    const snapshot = await servico.gerarSnapshot(CTX, 'unidade-1', MES, AGORA);
    await servico.publicar(CTX, snapshot.id, AGORA);

    await expect(servico.publicar(CTX, snapshot.id, AGORA)).rejects.toThrow(
      'RANKING_SNAPSHOT_IMUTAVEL',
    );
  });
});

describe('EngagementRankingService.lerPlacarPublicado', () => {
  let fake: FakePortaDeRanking;
  let servico: EngagementRankingService;

  beforeEach(() => {
    fake = new FakePortaDeRanking();
    servico = new EngagementRankingService(fake);
    // Coorte minima 1: estes testes verificam EXPOSICAO na leitura, nao a
    // retencao por coorte (ja coberta em `gerarSnapshot` acima) -- com o
    // default de 5 alunos, os casos de 1-2 alunos ficariam WITHHELD e nunca
    // testariam o que se propoem a testar.
    fake.comCoorteMinima(1);
  });

  /** Publica um placar com os `studentId`s dados, cada um com nome civil
   * `Nome Sobrenome Teste` (primeira letra maiuscula do id). */
  async function publicadoCom(studentIds: readonly string[]): Promise<{ id: string }> {
    const saldos = studentIds.map((id, indice) => ({
      studentId: id,
      points: (studentIds.length - indice) * 10,
      lastEntryAt: AGORA,
    }));
    fake.comSaldos('unidade-1', MES, saldos);
    for (const id of studentIds) {
      fake.comAluno(id, `${capitalizar(id)} Sobrenome Teste`);
    }

    const snapshot = await servico.gerarSnapshot(CTX, 'unidade-1', MES, AGORA);
    await servico.publicar(CTX, snapshot.id, AGORA);
    return snapshot;
  }

  async function publicado(): Promise<{ id: string }> {
    return publicadoCom(['ana', 'bruno', 'carla', 'diego', 'elisa']);
  }

  async function retido(): Promise<void> {
    fake.comCoorteMinima(5);
    fake.comSaldos('unidade-1', MES, saldosDeAlunos(2));
    await servico.gerarSnapshot(CTX, 'unidade-1', MES, AGORA);
  }

  function capitalizar(texto: string): string {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  /*
   * O CASO CENTRAL DA FATIA. O snapshot congela pontuacao; quem aparece e
   * decidido AGORA. Se o nome fosse gravado na entrada, este aluno
   * continuaria estampado num artefato imutavel, e a unica saida seria
   * mutar o que o M5-AC-007 proibe mutar.
   */
  it('omite quem pediu opt-out DEPOIS da publicacao, sem tocar no snapshot', async () => {
    const snapshot = await publicado();

    fake.comOptOut('bruno');

    const placar = await servico.lerPlacarPublicado(CTX, 'unidade-1', MES);

    expect(placar.map((e) => e.nomeExibido)).not.toContain('Bruno');

    const entradas = await fake.entradasDoSnapshot(snapshot.id);
    expect(entradas).toHaveLength(5);
  });

  it('omite aluno inativo', async () => {
    await publicadoCom(['ana', 'bruno']);
    fake.comAlunoInativo('bruno');

    const placar = await servico.lerPlacarPublicado(CTX, 'unidade-1', MES);
    expect(placar.map((e) => e.nomeExibido)).not.toContain('Bruno');
  });

  it('usa o apelido aprovado quando o aluno escolheu apelido', async () => {
    await publicadoCom(['ana']);
    fake.comApelidoAprovado('ana', 'Aninha');

    const placar = await servico.lerPlacarPublicado(CTX, 'unidade-1', MES);
    expect(placar[0]?.nomeExibido).toBe('Aninha');
  });

  it('nao vaza apelido pendente de moderacao', async () => {
    await publicadoCom(['ana']);
    fake.comApelidoPendente('ana', 'ApelidoNaoAprovado');

    const placar = await servico.lerPlacarPublicado(CTX, 'unidade-1', MES);
    const nome = placar[0]?.nomeExibido;

    expect(nome).not.toBe('ApelidoNaoAprovado');
    expect(nome).toBe('Ana');
  });

  /*
   * `M5-AC-001`. O DTO publico nao carrega identificador interno nem nome
   * civil completo -- e este teste inspeciona o JSON serializado, nao as
   * chaves que o tipo promete, porque o tipo nao viaja pela rede.
   */
  it('o DTO publico nao contem studentId nem nome civil', async () => {
    await publicadoCom(['ana']);

    const serializado = JSON.stringify(await servico.lerPlacarPublicado(CTX, 'unidade-1', MES));

    expect(serializado).not.toContain('studentId');
    expect(serializado).not.toContain('Ana Sobrenome Teste');
  });

  it('placar retido nao devolve entrada nenhuma', async () => {
    await retido();

    expect(await servico.lerPlacarPublicado(CTX, 'unidade-1', MES)).toEqual([]);
  });
});
