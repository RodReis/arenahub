import { beforeEach, describe, expect, it } from '@jest/globals';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { RetentionMonitoringService } from './retention-monitoring.service.js';
import type {
  EstadoDoScoring,
  PortaDeMonitoramento,
  ResumoDePeriodo,
} from './retention-monitoring.repository.js';

const contexto: TenantContext = {
  tenantId: 't1',
  actorId: 'a1',
  sessionId: 's1',
  permissions: new Set<string>(),
  allowedUnitIds: 'ALL',
};

const agora = new Date('2026-09-10T12:00:00.000Z');

class PortaFake implements PortaDeMonitoramento {
  estado: EstadoDoScoring = {
    ligado: true,
    ultimoSnapshotEm: new Date('2026-09-10T04:00:00.000Z'),
  };
  anterior: ResumoDePeriodo[] = [];
  atual: ResumoDePeriodo[] = [];
  desligamentos: { ligado: boolean }[] = [];

  estadoDoScoring(): Promise<EstadoDoScoring> {
    return Promise.resolve(this.estado);
  }

  resumoDoPeriodo(_c: TenantContext, qual: 'ANTERIOR' | 'ATUAL'): Promise<ResumoDePeriodo[]> {
    return Promise.resolve(qual === 'ANTERIOR' ? this.anterior : this.atual);
  }

  definirScoring(_c: TenantContext, ligado: boolean): Promise<void> {
    this.desligamentos.push({ ligado });
    return Promise.resolve();
  }
}

describe('RetentionMonitoringService — painel', () => {
  let porta: PortaFake;
  let service: RetentionMonitoringService;

  beforeEach(() => {
    porta = new PortaFake();
    service = new RetentionMonitoringService(porta);
  });

  it('devolve saude do pipeline e drift juntos', async () => {
    porta.anterior = [{ nome: 'attendance_days_30d', observados: 100, ausentes: 0, media: 10 }];
    porta.atual = [{ nome: 'attendance_days_30d', observados: 20, ausentes: 80, media: 9 }];

    const painel = await service.painel(contexto, agora);

    expect(painel.pipeline.estado).toBe('SAUDAVEL');
    expect(painel.drift).toHaveLength(1);
    expect(painel.drift[0]).toMatchObject({ tipo: 'AUSENCIA', severidade: 'CRITICO' });
  });

  it('acusa NUNCA_RODOU quando nao ha snapshot', async () => {
    porta.estado = { ligado: true, ultimoSnapshotEm: null };

    expect((await service.painel(contexto, agora)).pipeline.estado).toBe('NUNCA_RODOU');
  });

  it('nao acusa atraso com o scoring desligado', async () => {
    porta.estado = { ligado: false, ultimoSnapshotEm: new Date('2026-01-01T00:00:00.000Z') };

    expect((await service.painel(contexto, agora)).pipeline.estado).toBe('DESLIGADO');
  });

  it('devolve drift vazio sem periodo anterior, em vez de alarmar no dia um', async () => {
    porta.atual = [{ nome: 'a', observados: 10, ausentes: 0, media: 5 }];

    expect((await service.painel(contexto, agora)).drift).toEqual([]);
  });

  it('marca precisaDeAtencao quando ha drift critico', async () => {
    porta.anterior = [{ nome: 'a', observados: 100, ausentes: 0, media: 10 }];
    porta.atual = [{ nome: 'a', observados: 100, ausentes: 0, media: 30 }];

    expect((await service.painel(contexto, agora)).precisaDeAtencao).toBe(true);
  });

  it('marca precisaDeAtencao quando o pipeline esta atrasado', async () => {
    porta.estado = { ligado: true, ultimoSnapshotEm: new Date('2026-09-01T04:00:00.000Z') };

    expect((await service.painel(contexto, agora)).precisaDeAtencao).toBe(true);
  });

  it('nao marca atencao para drift de ATENCAO sozinho', async () => {
    // Alarme que dispara com variação normal vira alarme ignorado.
    porta.anterior = [{ nome: 'a', observados: 100, ausentes: 0, media: 10 }];
    porta.atual = [{ nome: 'a', observados: 100, ausentes: 0, media: 13 }];

    const painel = await service.painel(contexto, agora);

    expect(painel.drift[0]?.severidade).toBe('ATENCAO');
    expect(painel.precisaDeAtencao).toBe(false);
  });

  it('nao marca atencao com o scoring desligado, mesmo com drift', async () => {
    // Desligado é decisão. Alarmar aqui treina a operação a ignorar o alarme.
    porta.estado = { ligado: false, ultimoSnapshotEm: null };
    porta.anterior = [{ nome: 'a', observados: 100, ausentes: 0, media: 10 }];
    porta.atual = [{ nome: 'a', observados: 100, ausentes: 0, media: 30 }];

    expect((await service.painel(contexto, agora)).precisaDeAtencao).toBe(false);
  });
});

describe('RetentionMonitoringService — kill switch', () => {
  let porta: PortaFake;
  let service: RetentionMonitoringService;

  beforeEach(() => {
    porta = new PortaFake();
    service = new RetentionMonitoringService(porta);
  });

  it('desliga o scoring', async () => {
    await service.definirScoring(contexto, false);

    expect(porta.desligamentos).toEqual([{ ligado: false }]);
  });

  it('religa o scoring', async () => {
    await service.definirScoring(contexto, true);

    expect(porta.desligamentos).toEqual([{ ligado: true }]);
  });

  it('responde se o scoring esta ligado', async () => {
    expect(await service.scoringLigado(contexto)).toBe(true);

    porta.estado = { ligado: false, ultimoSnapshotEm: null };
    expect(await service.scoringLigado(contexto)).toBe(false);
  });
});
