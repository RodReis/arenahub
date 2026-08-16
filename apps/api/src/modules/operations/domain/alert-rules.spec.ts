import { describe, expect, it } from '@jest/globals';

import {
  CODIGO_DE_ALERTA,
  LIMITES_PADRAO,
  avaliarDispositivo,
  avaliarEdge,
  avaliarSync,
  impressaoDigital,
  type EstadoDeSync,
  type EstadoDoDispositivo,
  type EstadoDoEdge,
} from './alert-rules.js';

/**
 * F11 -- regras de alerta. INV-146 e ADR-011.
 *
 * O "agora" e injetado, entao provar um limite de 90 s custa zero segundo de
 * espera. Um teste que precisasse esperar de verdade nao seria escrito, e a
 * regra que decide se alguem e acordado as 6h ficaria sem prova.
 */

const AGORA = new Date('2026-08-16T12:00:00.000Z');

function edge(sobrescreve: Partial<EstadoDoEdge> = {}): EstadoDoEdge {
  return {
    edgeNodeId: 'edge-1',
    codigo: 'EDGE-CENTRO',
    gymUnitId: 'unit-1',
    ultimoHeartbeat: new Date(AGORA.getTime() - 10_000),
    derivaMs: 0,
    credencialExpiraEm: new Date(AGORA.getTime() + 30 * 86_400_000),
    ...sobrescreve,
  };
}

function dispositivo(sobrescreve: Partial<EstadoDoDispositivo> = {}): EstadoDoDispositivo {
  return {
    deviceId: 'dev-1',
    serial: 'SER-1',
    gymUnitId: 'unit-1',
    kind: 'FACIAL_READER',
    status: 'ACTIVE',
    ultimoHeartbeat: new Date(AGORA.getTime() - 10_000),
    ...sobrescreve,
  };
}

function sync(sobrescreve: Partial<EstadoDeSync> = {}): EstadoDeSync {
  return {
    gymUnitId: 'unit-1',
    falhasPermanentes: 0,
    deadLetters: 0,
    totalDoDia: 100,
    sucessosDoDia: 100,
    ...sobrescreve,
  };
}

const codigos = (alertas: { codigo: string }[]): string[] => alertas.map((a) => a.codigo);

describe('Edge ausente (INV-146)', () => {
  it('nao alerta com heartbeat recente', () => {
    expect(avaliarEdge(edge(), AGORA)).toEqual([]);
  });

  it('nao alerta no limite exato de 90 s -- duas batidas perdidas ainda toleradas', () => {
    const noLimite = edge({ ultimoHeartbeat: new Date(AGORA.getTime() - 90_000) });

    expect(avaliarEdge(noLimite, AGORA)).toEqual([]);
  });

  it('alerta um milissegundo depois do limite', () => {
    const passou = edge({ ultimoHeartbeat: new Date(AGORA.getTime() - 90_001) });

    expect(codigos(avaliarEdge(passou, AGORA))).toEqual([CODIGO_DE_ALERTA.EDGE_OFFLINE]);
  });

  it('alerta como CRITICAL -- catraca parada nao e aviso', () => {
    const fora = edge({ ultimoHeartbeat: new Date(AGORA.getTime() - 200_000) });

    expect(avaliarEdge(fora, AGORA)[0]?.severidade).toBe('CRITICAL');
  });

  it('trata Edge que nunca bateu como offline', () => {
    const novo = edge({ ultimoHeartbeat: null });
    const alertas = avaliarEdge(novo, AGORA);

    expect(codigos(alertas)).toEqual([CODIGO_DE_ALERTA.EDGE_OFFLINE]);
    expect(alertas[0]?.evidencia['nuncaBateu']).toBe(true);
  });

  it('diz o que fazer, nao so o que aconteceu', () => {
    const fora = edge({ ultimoHeartbeat: null });
    const alerta = avaliarEdge(fora, AGORA)[0];

    expect(alerta?.impacto).toContain('nao esta liberando acesso');
    expect(alerta?.acaoRecomendada).toContain('liberacao manual');
  });

  it('Edge mudo NAO acumula alerta de credencial nem de relogio', () => {
    // Renovar credencial de maquina que nao responde e trabalho inutil, e
    // deriva medida ha duas horas nao e deriva de agora.
    const fora = edge({
      ultimoHeartbeat: null,
      credencialExpiraEm: new Date(AGORA.getTime() - 86_400_000),
      derivaMs: 600_000,
    });

    expect(codigos(avaliarEdge(fora, AGORA))).toEqual([CODIGO_DE_ALERTA.EDGE_OFFLINE]);
  });
});

describe('credencial do Edge -- causa separada, por ADR-011', () => {
  it('nao alerta com credencial longe do vencimento', () => {
    expect(avaliarEdge(edge(), AGORA)).toEqual([]);
  });

  it('alerta como WARNING quando falta menos de 24 h', () => {
    const vencendo = edge({ credencialExpiraEm: new Date(AGORA.getTime() + 3_600_000) });
    const alertas = avaliarEdge(vencendo, AGORA);

    expect(codigos(alertas)).toEqual([CODIGO_DE_ALERTA.EDGE_CREDENTIAL_EXPIRING]);
    expect(alertas[0]?.severidade).toBe('WARNING');
  });

  it('vira CRITICAL depois de vencida', () => {
    const vencida = edge({ credencialExpiraEm: new Date(AGORA.getTime() - 1000) });

    expect(avaliarEdge(vencida, AGORA)[0]?.severidade).toBe('CRITICAL');
  });

  it('alerta quando nao ha credencial ativa nenhuma', () => {
    const semCredencial = edge({ credencialExpiraEm: null });
    const alertas = avaliarEdge(semCredencial, AGORA);

    expect(codigos(alertas)).toEqual([CODIGO_DE_ALERTA.EDGE_CREDENTIAL_EXPIRING]);
    expect(alertas[0]?.evidencia['semCredencialAtiva']).toBe(true);
  });

  it('a acao NAO manda ir ate a academia -- e problema da nuvem', () => {
    // O ponto do ADR-011: mesma consequencia, acoes opostas. Mandar a
    // recepcao conferir cabo aqui seria mandar a pessoa errada procurar no
    // lugar errado.
    const vencendo = edge({ credencialExpiraEm: new Date(AGORA.getTime() + 3_600_000) });
    const alerta = avaliarEdge(vencendo, AGORA)[0];

    expect(alerta?.acaoRecomendada).toContain('Rotacione a credencial');
    expect(alerta?.acaoRecomendada).toContain('Nao e necessario ir ate a academia');
  });

  it('e um codigo DIFERENTE de EDGE_OFFLINE', () => {
    expect(CODIGO_DE_ALERTA.EDGE_CREDENTIAL_EXPIRING).not.toBe(CODIGO_DE_ALERTA.EDGE_OFFLINE);
  });
});

describe('deriva de relogio', () => {
  it('nao alerta dentro do limite', () => {
    expect(avaliarEdge(edge({ derivaMs: 60_000 }), AGORA)).toEqual([]);
  });

  it('alerta acima do limite, em qualquer direcao', () => {
    const adiantado = avaliarEdge(edge({ derivaMs: 400_000 }), AGORA);
    const atrasado = avaliarEdge(edge({ derivaMs: -400_000 }), AGORA);

    expect(codigos(adiantado)).toEqual([CODIGO_DE_ALERTA.CLOCK_DRIFT]);
    expect(codigos(atrasado)).toEqual([CODIGO_DE_ALERTA.CLOCK_DRIFT]);
  });

  it('e WARNING, nao CRITICAL -- a decisao usa o relogio do servidor', () => {
    const alerta = avaliarEdge(edge({ derivaMs: 400_000 }), AGORA)[0];

    expect(alerta?.severidade).toBe('WARNING');
    expect(alerta?.impacto).toContain('horario do servidor');
  });

  it('nao alerta quando a deriva e desconhecida', () => {
    expect(avaliarEdge(edge({ derivaMs: null }), AGORA)).toEqual([]);
  });
});

describe('dispositivo offline', () => {
  it('nao alerta com heartbeat recente', () => {
    expect(avaliarDispositivo(dispositivo(), AGORA)).toEqual([]);
  });

  it('alerta leitor silencioso', () => {
    const fora = dispositivo({ ultimoHeartbeat: new Date(AGORA.getTime() - 200_000) });

    expect(codigos(avaliarDispositivo(fora, AGORA))).toEqual([CODIGO_DE_ALERTA.DEVICE_OFFLINE]);
  });

  it('distingue catraca de leitor na acao recomendada', () => {
    const catraca = avaliarDispositivo(
      dispositivo({ kind: 'TURNSTILE', ultimoHeartbeat: null }),
      AGORA,
    )[0];
    const leitor = avaliarDispositivo(
      dispositivo({ kind: 'FACIAL_READER', ultimoHeartbeat: null }),
      AGORA,
    )[0];

    expect(catraca?.impacto).toContain('catraca');
    expect(leitor?.impacto).toContain('leitor');
    expect(catraca?.acaoRecomendada).not.toBe(leitor?.acaoRecomendada);
  });

  it.each(['MAINTENANCE', 'RETIRED'])(
    'NAO alerta equipamento em %s -- alguem ja sabe que esta fora',
    (status) => {
      const parado = dispositivo({ status, ultimoHeartbeat: null });

      expect(avaliarDispositivo(parado, AGORA)).toEqual([]);
    },
  );
});

describe('sincronizacao', () => {
  it('nao alerta com tudo saudavel', () => {
    expect(avaliarSync(sync())).toEqual([]);
  });

  it('alerta falha permanente', () => {
    expect(codigos(avaliarSync(sync({ falhasPermanentes: 3 })))).toContain(
      CODIGO_DE_ALERTA.SYNC_FAILED,
    );
  });

  it('explica o impacto em termos do aluno, nao do sistema', () => {
    const alerta = avaliarSync(sync({ falhasPermanentes: 1 }))[0];

    expect(alerta?.impacto).toContain('recusados na catraca');
  });

  it('alerta dead letter pendente', () => {
    expect(codigos(avaliarSync(sync({ deadLetters: 2 })))).toContain(
      CODIGO_DE_ALERTA.DLQ_NON_EMPTY,
    );
  });

  it('alerta taxa diaria abaixo de 99%', () => {
    const ruim = sync({ totalDoDia: 100, sucessosDoDia: 95 });

    expect(codigos(avaliarSync(ruim))).toContain(CODIGO_DE_ALERTA.SYNC_SUCCESS_RATE_LOW);
  });

  it('nao alerta taxa exatamente em 99%', () => {
    const noLimite = sync({ totalDoDia: 100, sucessosDoDia: 99 });

    expect(codigos(avaliarSync(noLimite))).not.toContain(CODIGO_DE_ALERTA.SYNC_SUCCESS_RATE_LOW);
  });

  it('NAO alerta taxa com volume pequeno -- 1 falha em 1 nao diz nada', () => {
    const poucoVolume = sync({ totalDoDia: 1, sucessosDoDia: 0 });

    expect(codigos(avaliarSync(poucoVolume))).not.toContain(
      CODIGO_DE_ALERTA.SYNC_SUCCESS_RATE_LOW,
    );
  });

  it('acumula falha e dead letter quando as duas existem', () => {
    const duplo = sync({ falhasPermanentes: 1, deadLetters: 1 });

    expect(codigos(avaliarSync(duplo))).toEqual([
      CODIGO_DE_ALERTA.SYNC_FAILED,
      CODIGO_DE_ALERTA.DLQ_NON_EMPTY,
    ]);
  });
});

describe('impressao digital -- condicao que persiste nao vira 960 linhas', () => {
  it('e estavel para a mesma condicao', () => {
    const alerta = {
      codigo: CODIGO_DE_ALERTA.EDGE_OFFLINE,
      recurso: 'EDGE' as const,
      recursoId: 'edge-1',
      gymUnitId: 'unit-1',
    };

    expect(impressaoDigital('t1', alerta)).toBe(impressaoDigital('t1', alerta));
  });

  it('separa tenants', () => {
    const alerta = {
      codigo: CODIGO_DE_ALERTA.EDGE_OFFLINE,
      recurso: 'EDGE' as const,
      recursoId: 'edge-1',
      gymUnitId: 'unit-1',
    };

    expect(impressaoDigital('t1', alerta)).not.toBe(impressaoDigital('t2', alerta));
  });

  it('separa codigos no mesmo recurso -- as duas causas do ADR-011 coexistem', () => {
    const base = { recurso: 'EDGE' as const, recursoId: 'edge-1', gymUnitId: 'unit-1' };

    expect(impressaoDigital('t1', { ...base, codigo: CODIGO_DE_ALERTA.EDGE_OFFLINE })).not.toBe(
      impressaoDigital('t1', { ...base, codigo: CODIGO_DE_ALERTA.EDGE_CREDENTIAL_EXPIRING }),
    );
  });
});

describe('escopo desta fatia (ADR-012)', () => {
  it('NAO tem alerta de snapshot nem de backlog -- sao F10', () => {
    // O plano de apoio pede os dois, mas snapshot assinado e fila offline
    // sao a Slice 1.5, fora do MVP 1. Alarme que nunca dispara ensina a
    // operacao a confiar num sensor cego.
    const todos: string[] = Object.values(CODIGO_DE_ALERTA);

    expect(todos).not.toContain('SNAPSHOT_STALE');
    expect(todos).not.toContain('BACKLOG_HIGH');
  });

  it('todo alerta declara impacto e acao', () => {
    const gerados = [
      ...avaliarEdge(edge({ ultimoHeartbeat: null }), AGORA),
      ...avaliarEdge(edge({ credencialExpiraEm: null }), AGORA),
      ...avaliarEdge(edge({ derivaMs: 999_999 }), AGORA),
      ...avaliarDispositivo(dispositivo({ ultimoHeartbeat: null }), AGORA),
      ...avaliarSync(sync({ falhasPermanentes: 1, deadLetters: 1, sucessosDoDia: 50 })),
    ];

    expect(gerados.length).toBeGreaterThan(4);

    for (const alerta of gerados) {
      // Alerta sem impacto declarado e como um alarme vira ruido: ninguem
      // sabe se larga o que esta fazendo ou termina o atendimento primeiro.
      expect(alerta.impacto.length).toBeGreaterThan(20);
      expect(alerta.acaoRecomendada.length).toBeGreaterThan(20);
    }
  });

  it('nenhuma evidencia carrega PII', () => {
    const gerados = [
      ...avaliarEdge(edge({ ultimoHeartbeat: null }), AGORA),
      ...avaliarDispositivo(dispositivo({ ultimoHeartbeat: null }), AGORA),
    ];

    for (const alerta of gerados) {
      const chaves = Object.keys(alerta.evidencia).join(',').toLowerCase();

      expect(chaves).not.toContain('cpf');
      expect(chaves).not.toContain('student');
      expect(chaves).not.toContain('nome');
    }
  });

  it('os limites padrao batem com o plano', () => {
    expect(LIMITES_PADRAO.heartbeatMaximoMs).toBe(90_000);
    expect(LIMITES_PADRAO.taxaMinimaDeSync).toBe(0.99);
  });
});
