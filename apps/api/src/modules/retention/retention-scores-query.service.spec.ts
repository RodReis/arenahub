import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { RetentionScoresQueryService } from './retention-scores-query.service.js';
import type { PortaDeConsultaDeScores, ScoreGravado } from './retention-scores-query.service.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL',
};

const agora = new Date('2026-09-05T12:00:00.000Z');

const gravado = (parcial: Partial<ScoreGravado> = {}): ScoreGravado => ({
  scoreId: 'sc1',
  studentId: 'e1',
  valor: 60,
  faixa: 'ALTO',
  completude: 0.85,
  probabilidadeCalibrada: null,
  versaoDeRegras: 'regras@1',
  observadoEm: new Date('2026-09-05T00:00:00.000Z'),
  calculadoEm: new Date('2026-09-05T06:00:00.000Z'),
  fatores: [
    {
      posicao: 1,
      feature: 'days_past_due',
      valorObservado: 41,
      contribuicao: 40,
      direcao: 'AUMENTA',
      rotulo: 'Cobranca vencida',
    },
  ],
  ...parcial,
});

class PortaFake implements PortaDeConsultaDeScores {
  scores: ScoreGravado[] = [gravado()];
  historico: ScoreGravado[] = [gravado()];
  contagem: Record<ScoreGravado['faixa'], number> = { BAIXO: 0, MEDIO: 0, ALTO: 1, CRITICO: 0 };

  filaDeRisco(): Promise<ScoreGravado[]> {
    return Promise.resolve(this.scores);
  }

  historicoDoAluno(): Promise<ScoreGravado[]> {
    return Promise.resolve(this.historico);
  }

  contagemPorBanda(): Promise<Record<ScoreGravado['faixa'], number>> {
    return Promise.resolve(this.contagem);
  }
}

describe('RetentionScoresQueryService', () => {
  let porta: PortaFake;
  let service: RetentionScoresQueryService;

  beforeEach(() => {
    porta = new PortaFake();
    service = new RetentionScoresQueryService(porta);
  });

  it('repassa a contagem por banda da porta, sem recalcular', async () => {
    porta.contagem = { BAIXO: 3, MEDIO: 2, ALTO: 1, CRITICO: 0 };

    await expect(service.contagemPorBanda(contexto)).resolves.toEqual({
      BAIXO: 3,
      MEDIO: 2,
      ALTO: 1,
      CRITICO: 0,
    });
  });

  it('marca o score do dia como ATUAL', async () => {
    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]).toMatchObject({ validade: { estado: 'ATUAL', idadeEmDias: 0 } });
  });

  it('marca a idade de um score velho em vez de esconde-lo -- M6-BR-009', async () => {
    porta.scores = [gravado({ calculadoEm: new Date('2026-09-01T06:00:00.000Z') })];

    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.validade).toEqual({ estado: 'DESATUALIZADO', idadeEmDias: 4 });
    expect(fila[0]?.valor).toBe(60);
  });

  it('marca como EXPIRADO sem apagar o score nem a idade', async () => {
    porta.scores = [gravado({ calculadoEm: new Date('2026-08-20T06:00:00.000Z') })];

    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.validade.estado).toBe('EXPIRADO');
    expect(fila[0]?.validade.idadeEmDias).toBe(16);
    expect(fila[0]?.valor).toBe(60);
  });

  it('carrega sempre o aviso de estimativa -- M6-BR-001', async () => {
    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.aviso).toBe('ESTIMATIVA_NAO_E_FATO');
  });

  it('nao devolve probabilidade quando ela e nula', async () => {
    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.probabilidadeCalibrada).toBeNull();
  });

  it('devolve o historico do aluno com a validade de cada ponto', async () => {
    porta.historico = [
      gravado({ scoreId: 'sc2', calculadoEm: new Date('2026-09-05T06:00:00.000Z'), valor: 60 }),
      gravado({ scoreId: 'sc1', calculadoEm: new Date('2026-08-29T06:00:00.000Z'), valor: 20 }),
    ];

    const historico = await service.historico(contexto, 'e1', { agora, limite: 30 });

    expect(historico.map((h) => [h.valor, h.validade.estado])).toEqual([
      [60, 'ATUAL'],
      [20, 'EXPIRADO'],
    ]);
  });

  it('preserva os fatores com o valor observado, para contestacao', async () => {
    const fila = await service.fila(contexto, { agora, limite: 50 });

    expect(fila[0]?.fatores).toEqual([
      {
        posicao: 1,
        feature: 'days_past_due',
        valorObservado: 41,
        contribuicao: 40,
        direcao: 'AUMENTA',
        rotulo: 'Cobranca vencida',
      },
    ]);
  });

  it('devolve lista vazia sem quebrar quando nao ha score no dia', async () => {
    porta.scores = [];

    expect(await service.fila(contexto, { agora, limite: 50 })).toEqual([]);
  });
});
