import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { RetentionScoresController } from './retention-scores.controller.js';
import type {
  RetentionScoresQueryService,
  ScoreParaLeitura,
} from './retention-scores-query.service.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set(['retention.read']),
  allowedUnitIds: 'ALL',
};

const leitura = (parcial: Partial<ScoreParaLeitura> = {}): ScoreParaLeitura => ({
  scoreId: 'sc1',
  studentId: 'e1',
  valor: 60,
  faixa: 'ALTO',
  completude: 0.85,
  probabilidadeCalibrada: null,
  versaoDeRegras: 'regras@1',
  observadoEm: new Date('2026-09-05T00:00:00.000Z'),
  calculadoEm: new Date('2026-09-05T06:00:00.000Z'),
  validade: { estado: 'ATUAL', idadeEmDias: 0 },
  aviso: 'ESTIMATIVA_NAO_E_FATO',
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

describe('RetentionScoresController', () => {
  let query: { fila: jest.Mock; historico: jest.Mock };
  let controller: RetentionScoresController;

  beforeEach(() => {
    query = { fila: jest.fn(), historico: jest.fn() };
    query.fila.mockResolvedValue([leitura()] as never);
    query.historico.mockResolvedValue([leitura()] as never);

    controller = new RetentionScoresController(
      { require: () => contexto } as unknown as TenantContextService,
      query as unknown as RetentionScoresQueryService,
    );
  });

  it('devolve a fila com faixa, completude, validade e aviso', async () => {
    const resposta = await controller.listar({});

    expect(resposta.items[0]).toEqual({
      scoreId: 'sc1',
      studentId: 'e1',
      value: 60,
      band: 'ALTO',
      completeness: 0.85,
      calibratedProbability: null,
      ruleVersion: 'regras@1',
      observedAt: '2026-09-05T00:00:00.000Z',
      calculatedAt: '2026-09-05T06:00:00.000Z',
      freshness: { state: 'ATUAL', ageInDays: 0 },
      notice: 'ESTIMATIVA_NAO_E_FATO',
      factors: [
        {
          position: 1,
          feature: 'days_past_due',
          observedValue: 41,
          contribution: 40,
          direction: 'AUMENTA',
          label: 'Cobranca vencida',
        },
      ],
    });
  });

  it('nao expoe o vetor de features na lista -- PRD §17', async () => {
    const resposta = await controller.listar({});

    expect(JSON.stringify(resposta)).not.toContain('attendance_days_90d');
    expect(Object.keys(resposta.items[0] ?? {})).not.toContain('features');
  });

  it('usa limite padrao de 50 e aceita limite explicito', async () => {
    await controller.listar({});
    expect(query.fila.mock.calls[0]?.[1]).toMatchObject({ limite: 50 });

    await controller.listar({ limite: '10' });
    expect(query.fila.mock.calls[1]?.[1]).toMatchObject({ limite: 10 });
  });

  it('recusa limite fora da faixa em vez de truncar em silencio', async () => {
    await expect(controller.listar({ limite: '0' })).rejects.toThrow();
    await expect(controller.listar({ limite: '500' })).rejects.toThrow();
    await expect(controller.listar({ limite: 'abc' })).rejects.toThrow();
  });

  it('devolve o historico de um aluno', async () => {
    const resposta = await controller.historico('e1', {});

    expect(query.historico.mock.calls[0]?.[1]).toBe('e1');
    expect(resposta.items).toHaveLength(1);
  });

  it('passa o contexto do tenant a cada consulta', async () => {
    await controller.listar({});

    expect(query.fila.mock.calls[0]?.[0]).toBe(contexto);
  });
});
