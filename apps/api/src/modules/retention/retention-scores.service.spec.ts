import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { ausente, observado, type ValorDeFeature } from './domain/valor-de-feature.js';
import type { RegraDeRetencao } from './domain/regra-de-retencao.js';
import { RetentionScoresService } from './retention-scores.service.js';
import type {
  CatalogoDeRegras,
  PortaDeScores,
  ResultadoDaGravacaoDeScore,
  SnapshotParaPontuar,
} from './retention-scores.repository.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL',
};

const regra = (parcial: Partial<RegraDeRetencao>): RegraDeRetencao => ({
  id: 'r',
  feature: 'attendance_days_30d',
  operador: 'MENOR_OU_IGUAL',
  limite: 4,
  peso: 30,
  direcao: 'AUMENTA',
  rotulo: 'Frequencia baixa no mes',
  ...parcial,
});

const catalogo = (parcial: Partial<CatalogoDeRegras> = {}): CatalogoDeRegras => ({
  versaoId: 'v1',
  label: 'regras@1',
  regras: [regra({ id: 'r1' })],
  faixas: [
    ['CRITICO', 75],
    ['ALTO', 50],
    ['MEDIO', 25],
    ['BAIXO', 0],
  ],
  completudeMinima: 0.3,
  ...parcial,
});

const snapshot = (parcial: Partial<SnapshotParaPontuar> = {}): SnapshotParaPontuar => ({
  snapshotId: 'snap1',
  studentId: 'e1',
  observadoEm: new Date('2026-09-01T00:00:00.000Z'),
  valores: [observado('attendance_days_30d', 2), observado('days_past_due', 0)],
  statusDoAluno: 'ACTIVE',
  statusDaAssinatura: 'ACTIVE',
  supressoesVigentes: [],
  ...parcial,
});

/** Dublê do kill switch (F41). Ligado é o padrão do produto. */
class MonitoramentoFake {
  ligado = true;

  scoringLigado(): Promise<boolean> {
    return Promise.resolve(this.ligado);
  }
}

class PortaFake implements PortaDeScores {
  catalogoAtual = catalogo();
  snapshots: SnapshotParaPontuar[] = [snapshot()];
  gravados: Parameters<PortaDeScores['gravarScore']>[1][] = [];
  pulados: Parameters<PortaDeScores['registrarPulo']>[1][] = [];
  /** Simula o score ja existente da reexecucao. */
  jaGravado: string | null = null;

  carregarCatalogo(): Promise<CatalogoDeRegras> {
    return Promise.resolve(this.catalogoAtual);
  }

  snapshotsDoDia(): Promise<SnapshotParaPontuar[]> {
    return Promise.resolve(this.snapshots);
  }

  gravarScore(
    _contexto: TenantContext,
    entrada: Parameters<PortaDeScores['gravarScore']>[1],
  ): Promise<ResultadoDaGravacaoDeScore> {
    this.gravados.push(entrada);
    if (this.jaGravado !== null) {
      return Promise.resolve({ scoreId: this.jaGravado, criado: false });
    }
    return Promise.resolve({ scoreId: `score-${this.gravados.length}`, criado: true });
  }

  registrarPulo(
    _contexto: TenantContext,
    entrada: Parameters<PortaDeScores['registrarPulo']>[1],
  ): Promise<void> {
    this.pulados.push(entrada);
    return Promise.resolve();
  }
}

describe('RetentionScoresService', () => {
  let porta: PortaFake;
  let monitoramento: MonitoramentoFake;
  let service: RetentionScoresService;

  beforeEach(() => {
    porta = new PortaFake();
    monitoramento = new MonitoramentoFake();
    service = new RetentionScoresService(porta, monitoramento as never);
  });

  it('pontua aluno elegivel e grava fatores ordenados', async () => {
    porta.catalogoAtual = catalogo({
      regras: [
        regra({ id: 'r1', peso: 30 }),
        regra({
          id: 'r2',
          feature: 'days_past_due',
          operador: 'MAIOR_OU_IGUAL',
          limite: 0,
          peso: 40,
          rotulo: 'Cobranca vencida',
        }),
      ],
    });

    const resumo = await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(resumo).toEqual({ pontuados: 1, pulados: 0 });
    expect(porta.gravados).toHaveLength(1);
    expect(porta.gravados[0]).toMatchObject({
      snapshotId: 'snap1',
      studentId: 'e1',
      versaoDeRegrasId: 'v1',
      valor: 70,
      faixa: 'ALTO',
      probabilidadeCalibrada: null,
    });
    expect(porta.gravados[0]?.fatores.map((f) => [f.posicao, f.regraId])).toEqual([
      [1, 'r2'],
      [2, 'r1'],
    ]);
  });

  it('nao pontua ninguem com o kill switch acionado -- M6-FR-017', async () => {
    monitoramento.ligado = false;

    const resumo = await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(resumo).toEqual({ pontuados: 0, pulados: 0 });
    expect(porta.gravados).toEqual([]);
  });

  it('kill switch nao registra pulo -- desligado nao e inelegibilidade', async () => {
    // A linha de pulo existe para dizer POR QUE um aluno não foi pontuado
    // (cancelado, suprimido, sem histórico). Scoring desligado não é uma
    // propriedade do aluno, e gravar uma linha por aluno a cada rodada
    // encheria a tabela de ruído que some quando alguém religa.
    monitoramento.ligado = false;

    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(porta.pulados).toEqual([]);
  });

  it('volta a pontuar quando o scoring e religado', async () => {
    monitoramento.ligado = false;
    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    monitoramento.ligado = true;
    const resumo = await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    // Religar devolve o pipeline: nada foi destruído enquanto esteve desligado.
    expect(resumo.pontuados).toBe(1);
  });

  it('grava o valor observado em cada fator, para a explicacao ser contestavel', async () => {
    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(porta.gravados[0]?.fatores[0]).toMatchObject({
      feature: 'attendance_days_30d',
      valorObservado: 2,
      rotulo: 'Frequencia baixa no mes',
    });
  });

  it('nao pontua aluno cancelado e registra a razao -- M6-FR-006', async () => {
    porta.snapshots = [snapshot({ statusDaAssinatura: 'CANCELLED' })];

    const resumo = await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(resumo).toEqual({ pontuados: 0, pulados: 1 });
    expect(porta.gravados).toHaveLength(0);
    expect(porta.pulados[0]).toMatchObject({ snapshotId: 'snap1', razao: 'CANCELADO' });
  });

  it('nao pontua aluno suprimido', async () => {
    porta.snapshots = [snapshot({ supressoesVigentes: ['OPT_OUT'] })];

    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(porta.pulados[0]).toMatchObject({ razao: 'SUPRIMIDO' });
  });

  it('nao pontua quando a completude nao alcanca o minimo da versao', async () => {
    const quaseTudoAusente: ValorDeFeature[] = [
      observado('attendance_days_30d', 2),
      ausente('days_past_due', 'SEM_HISTORICO'),
      ausente('pause_count_180d', 'SEM_HISTORICO'),
      ausente('subscription_age_days', 'SEM_HISTORICO'),
    ];
    porta.snapshots = [snapshot({ valores: quaseTudoAusente })];
    porta.catalogoAtual = catalogo({ completudeMinima: 0.5 });

    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(porta.pulados[0]).toMatchObject({ razao: 'HISTORICO_INSUFICIENTE' });
    expect(porta.gravados).toHaveLength(0);
  });

  it('registra pulo sem score, e nao score zero', async () => {
    porta.snapshots = [snapshot({ supressoesVigentes: ['EXCLUSAO_PENDENTE'] })];

    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(porta.gravados).toEqual([]);
  });

  it('nao duplica na reexecucao -- M6-NFR-002', async () => {
    porta.jaGravado = 'score-existente';

    const primeira = await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));
    const segunda = await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(primeira).toEqual(segunda);
  });

  it('usa as faixas da versao, nao as do dominio', async () => {
    porta.catalogoAtual = catalogo({
      regras: [regra({ id: 'r1', peso: 30 })],
      faixas: [
        ['CRITICO', 90],
        ['ALTO', 80],
        ['MEDIO', 10],
        ['BAIXO', 0],
      ],
    });

    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(porta.gravados[0]).toMatchObject({ valor: 30, faixa: 'MEDIO' });
  });

  it('processa todos os alunos do dia, mesmo com pulos no meio', async () => {
    porta.snapshots = [
      snapshot({ snapshotId: 's1', studentId: 'e1' }),
      snapshot({ snapshotId: 's2', studentId: 'e2', statusDaAssinatura: 'CANCELLED' }),
      snapshot({ snapshotId: 's3', studentId: 'e3' }),
    ];

    const resumo = await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(resumo).toEqual({ pontuados: 2, pulados: 1 });
    expect(porta.gravados.map((g) => g.studentId)).toEqual(['e1', 'e3']);
  });

  it('grava no maximo cinco fatores mesmo com mais regras disparando', async () => {
    const valores = Array.from({ length: 7 }, (_, i) => observado(`f${i}`, 1));
    porta.snapshots = [snapshot({ valores })];
    porta.catalogoAtual = catalogo({
      regras: valores.map((v, i) =>
        regra({ id: `r${i}`, feature: v.nome, operador: 'MAIOR_OU_IGUAL', limite: 1, peso: i + 1 }),
      ),
    });

    await service.pontuarDia(contexto, new Date('2026-09-01T00:00:00.000Z'));

    expect(porta.gravados[0]?.fatores).toHaveLength(5);
    expect(porta.gravados[0]?.fatores.map((f) => f.posicao)).toEqual([1, 2, 3, 4, 5]);
  });
});
