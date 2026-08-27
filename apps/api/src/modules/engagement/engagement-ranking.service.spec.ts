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
    // Nome civil "Ana Sobrenome Teste" abreviado -- DS-TOTEM.md §3.4c.
    expect(nome).toBe('Ana S.');
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

  /*
   * A POSICAO NAO E RENUMERADA quando alguem sai. Quem era 3o continua 3o, e
   * o 2o simplesmente nao aparece.
   *
   * Renumerar produziria 1, 2, 3 sem buraco -- e comparar duas leituras
   * revelaria por deducao quem pediu para sair. O buraco e a privacidade.
   */
  it('nao renumera a posicao de quem ficou', async () => {
    await publicadoCom(['ana', 'bruno', 'carla', 'diego', 'elisa']);

    fake.comOptOut('bruno');

    const placar = await servico.lerPlacarPublicado(CTX, 'unidade-1', MES);

    expect(placar.map((e) => e.position)).toEqual([1, 3, 4, 5]);
  });
});

describe('EngagementRankingService.posicaoDoAluno', () => {
  let fake: FakePortaDeRanking;
  let servico: EngagementRankingService;

  beforeEach(() => {
    fake = new FakePortaDeRanking();
    servico = new EngagementRankingService(fake);
    fake.comCoorteMinima(1);
  });

  async function publicadoCom(studentIds: readonly string[]): Promise<void> {
    const saldos = studentIds.map((id, indice) => ({
      studentId: id,
      points: (studentIds.length - indice) * 10,
      lastEntryAt: AGORA,
    }));
    fake.comSaldos('unidade-1', MES, saldos);
    for (const id of studentIds) {
      fake.comAluno(id, `${id.charAt(0).toUpperCase()}${id.slice(1)} Sobrenome Teste`);
    }

    const snapshot = await servico.gerarSnapshot(CTX, 'unidade-1', MES, AGORA);
    await servico.publicar(CTX, snapshot.id, AGORA);
  }

  it('devolve a posicao correta do aluno consultado', async () => {
    await publicadoCom(['ana', 'bruno', 'carla']);

    const posicao = await servico.posicaoDoAluno(CTX, 'unidade-1', MES, 'bruno');

    // Nome civil "Bruno Sobrenome Teste" abreviado -- DS-TOTEM.md §3.4c/§5.8.
    expect(posicao).toEqual({ position: 2, nomeExibido: 'Bruno S.', points: 20 });
  });

  /*
   * O caso interessante: quem saiu do placar nao tem posicao, nem para SI
   * MESMO -- `resolverExposicao` nao abre excecao para o proprio titular.
   */
  it('devolve null quando o proprio aluno consultado esta em opt-out', async () => {
    await publicadoCom(['ana', 'bruno', 'carla']);
    fake.comOptOut('bruno');

    const posicao = await servico.posicaoDoAluno(CTX, 'unidade-1', MES, 'bruno');

    expect(posicao).toBeNull();
  });
});

/**
 * `placarAoVivo` -- Emenda de 27/08/2026 (ADR-047). Mesmas garantias de
 * `lerPlacarPublicado` (coorte, opt-out, inatividade, apelido, sem
 * `studentId`), so que SEM snapshot -- e com um cache que o teste tem que
 * provar contando chamadas ao repositorio, nao so observando o resultado.
 */
describe('EngagementRankingService.placarAoVivo', () => {
  let fake: FakePortaDeRanking;
  let servico: EngagementRankingService;

  beforeEach(() => {
    fake = new FakePortaDeRanking();
    servico = new EngagementRankingService(fake);
  });

  /** Popula `quantidade` alunos com nome civil `Nome N Sobrenome Teste`,
   * cada um com o proprio saldo -- suficiente para as asserções de
   * ordem/coorte, sem precisar de apelido nem opt-out. */
  function comAlunos(quantidade: number): void {
    const saldos = saldosDeAlunos(quantidade);
    fake.comSaldos('unidade-1', MES, saldos);
    for (const saldo of saldos) {
      fake.comAluno(saldo.studentId, `${capitalizar(saldo.studentId)} Sobrenome Teste`);
    }
  }

  function capitalizar(texto: string): string {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  it('coorte abaixo do minimo devolve lista vazia', async () => {
    fake.comCoorteMinima(5);
    comAlunos(4);

    const placar = await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);

    expect(placar).toEqual([]);
  });

  it('aluno em opt-out nao aparece E nao conta na coorte', async () => {
    fake.comCoorteMinima(5);
    comAlunos(5);
    fake.comOptOut('aluno-1');

    // So 4 elegiveis restam depois do opt-out -- abaixo do minimo de 5.
    const placar = await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);

    expect(placar).toEqual([]);
  });

  it('aluno inativo nao aparece', async () => {
    fake.comCoorteMinima(1);
    comAlunos(2);
    fake.comAlunoInativo('aluno-1');

    const placar = await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);

    expect(placar.map((e) => e.nomeExibido)).not.toContain('Aluno-1 S.');
    expect(placar).toHaveLength(1);
  });

  it('apelido pendente nao vaza -- so APPROVED vira nome', async () => {
    fake.comCoorteMinima(1);
    comAlunos(1);
    fake.comApelidoPendente('aluno-1', 'ApelidoNaoAprovado');

    const placar = await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);

    // Nome civil "Aluno-1 Sobrenome Teste" abreviado -- DS-TOTEM.md §3.4c.
    expect(placar[0]?.nomeExibido).toBe('Aluno-1 S.');
  });

  it('apelido aprovado aparece inteiro, sem abreviar', async () => {
    fake.comCoorteMinima(1);
    comAlunos(1);
    fake.comApelidoAprovado('aluno-1', 'Aninha');

    const placar = await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);

    expect(placar[0]?.nomeExibido).toBe('Aninha');
  });

  it('o DTO nao contem studentId', async () => {
    fake.comCoorteMinima(1);
    comAlunos(1);

    const serializado = JSON.stringify(await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA));

    expect(serializado).not.toContain('studentId');
    expect(serializado).not.toContain('Sobrenome Teste');
  });

  it('ordem deterministica com entrada embaralhada', async () => {
    fake.comCoorteMinima(1);
    const saldos = [
      { studentId: 'aluno-3', points: 10, lastEntryAt: AGORA },
      { studentId: 'aluno-1', points: 30, lastEntryAt: AGORA },
      { studentId: 'aluno-2', points: 20, lastEntryAt: AGORA },
    ];
    fake.comSaldos('unidade-1', MES, saldos);

    const placar = await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);

    expect(placar.map((e) => e.points)).toEqual([30, 20, 10]);
    expect(placar.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  /*
   * POSICAO SEM BURACO -- ao contrario do placar PUBLICADO. Aqui quem esta
   * em opt-out nunca entra no calculo, entao a lista classificada ja nasce
   * sem buraco: 1, 2, 3, nao 1, 3, 4.
   */
  it('posicao sem buraco quando alguem esta em opt-out', async () => {
    fake.comCoorteMinima(1);
    comAlunos(3);
    fake.comOptOut('aluno-2');

    const placar = await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);

    expect(placar.map((e) => e.position)).toEqual([1, 2]);
  });

  /*
   * O CASO DO CACHE. Duas chamadas dentro do TTL (60 s) fazem UMA leitura no
   * repositorio; depois do TTL, a proxima chamada le de novo. `agora` entra
   * por parametro -- o teste nao espera um minuto real.
   */
  describe('cache', () => {
    it('duas chamadas dentro do TTL leem o repositorio uma vez so', async () => {
      fake.comCoorteMinima(1);
      comAlunos(1);

      await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);
      await servico.placarAoVivo(CTX, 'unidade-1', MES, new Date(AGORA.getTime() + 30_000));

      expect(fake.chamadasASaldosDaUnidade).toBe(1);
    });

    it('depois do TTL, a proxima chamada le o repositorio de novo', async () => {
      fake.comCoorteMinima(1);
      comAlunos(1);

      await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);
      await servico.placarAoVivo(CTX, 'unidade-1', MES, new Date(AGORA.getTime() + 60_000));

      expect(fake.chamadasASaldosDaUnidade).toBe(2);
    });

    it('TTL e por (tenant, unidade, mes) -- outra unidade nao reaproveita o cache', async () => {
      fake.comCoorteMinima(1);
      comAlunos(1);
      fake.comSaldos('unidade-2', MES, saldosDeAlunos(1));

      await servico.placarAoVivo(CTX, 'unidade-1', MES, AGORA);
      await servico.placarAoVivo(CTX, 'unidade-2', MES, AGORA);

      expect(fake.chamadasASaldosDaUnidade).toBe(2);
    });
  });
});

/**
 * `posicaoAoVivoDoAluno` -- a area interna do totem (`DS-TOTEM.md` §5.8)
 * consulta a PROPRIA posicao no mes corrente, que nunca tem snapshot
 * publicado desde a Emenda de 27/08/2026.
 */
describe('EngagementRankingService.posicaoAoVivoDoAluno', () => {
  let fake: FakePortaDeRanking;
  let servico: EngagementRankingService;

  beforeEach(() => {
    fake = new FakePortaDeRanking();
    servico = new EngagementRankingService(fake);
    fake.comCoorteMinima(1);
  });

  function comAlunos(quantidade: number): void {
    const saldos = saldosDeAlunos(quantidade);
    fake.comSaldos('unidade-1', MES, saldos);
    for (const saldo of saldos) {
      fake.comAluno(saldo.studentId, `${capitalizar(saldo.studentId)} Sobrenome Teste`);
    }
  }

  function capitalizar(texto: string): string {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  it('devolve a propria posicao, com o nome abreviado', async () => {
    comAlunos(3);

    const posicao = await servico.posicaoAoVivoDoAluno(CTX, 'unidade-1', MES, 'aluno-2');

    expect(posicao).toEqual({ position: 2, nomeExibido: 'Aluno-2 S.', points: 20 });
  });

  it('devolve null quando o proprio aluno esta em opt-out', async () => {
    comAlunos(3);
    fake.comOptOut('aluno-2');

    const posicao = await servico.posicaoAoVivoDoAluno(CTX, 'unidade-1', MES, 'aluno-2');

    expect(posicao).toBeNull();
  });

  it('devolve null quando a coorte nao alcanca o minimo', async () => {
    fake.comCoorteMinima(5);
    comAlunos(2);

    const posicao = await servico.posicaoAoVivoDoAluno(CTX, 'unidade-1', MES, 'aluno-1');

    expect(posicao).toBeNull();
  });

  it('devolve null para aluno sem saldo no mes', async () => {
    comAlunos(3);

    const posicao = await servico.posicaoAoVivoDoAluno(CTX, 'unidade-1', MES, 'aluno-inexistente');

    expect(posicao).toBeNull();
  });
});
