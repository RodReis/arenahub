import { describe, expect, it } from '@jest/globals';

import {
  CODIGO_DE_ALERTA,
  LIMITES_PADRAO,
  avaliarDispositivo,
  avaliarEdge,
  avaliarFinanceiro,
  avaliarSaude,
  avaliarSync,
  impressaoDigital,
  type EstadoDeSync,
  type EstadoDoFinanceiro,
  type EstadoDaSaude,
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

/**
 * Saude do webhook e da conciliacao -- F16.
 *
 * O que estes testes protegem: o alerta de SILENCIO. Backlog e visivel (a fila
 * cresce), mas webhook mudo nao produz erro nenhum -- tudo parece calmo
 * enquanto nenhum pagamento e reconhecido. E a falha que so aparece quando um
 * aluno reclama na recepcao.
 */
describe('avaliarFinanceiro', () => {
  const AGORA_F16 = new Date('2026-08-19T12:00:00.000Z');

  function financeiro(sobrescreve: Partial<EstadoDoFinanceiro> = {}): EstadoDoFinanceiro {
    return {
      providerAccountId: 'conta-1',
      eventoPendenteMaisAntigo: null,
      eventosPendentes: 0,
      ultimoEventoRecebido: new Date('2026-08-19T11:59:00.000Z'),
      divergenciasEmAberto: 0,
      ...sobrescreve,
    };
  }

  it('tudo em dia nao gera alerta', () => {
    expect(avaliarFinanceiro(financeiro(), AGORA_F16)).toHaveLength(0);
  });

  it('evento pendente ha 20 min vira WEBHOOK_BACKLOG', () => {
    const alertas = avaliarFinanceiro(
      financeiro({
        eventoPendenteMaisAntigo: new Date('2026-08-19T11:40:00.000Z'),
        eventosPendentes: 3,
      }),
      AGORA_F16,
    );

    expect(alertas.map((a) => a.codigo)).toContain('WEBHOOK_BACKLOG');
    expect(alertas[0]?.evidencia['eventosPendentes']).toBe(3);
  });

  it('evento pendente ha 5 min NAO alerta -- reentrega normal do provedor', () => {
    // Alertar no SLO de 30 s acusaria toda reentrega. O limite e trinta vezes
    // o SLO: o que sobra ali nao e lentidao, e travamento.
    const alertas = avaliarFinanceiro(
      financeiro({ eventoPendenteMaisAntigo: new Date('2026-08-19T11:55:00.000Z') }),
      AGORA_F16,
    );

    expect(alertas.map((a) => a.codigo)).not.toContain('WEBHOOK_BACKLOG');
  });

  it('sem evento ha tres dias vira WEBHOOK_SILENCIOSO', () => {
    const alertas = avaliarFinanceiro(
      financeiro({ ultimoEventoRecebido: new Date('2026-08-16T12:00:00.000Z') }),
      AGORA_F16,
    );

    expect(alertas.map((a) => a.codigo)).toContain('WEBHOOK_SILENCIOSO');
  });

  it('CONTA NOVA NAO ALERTA SILENCIO -- nunca recebeu evento nenhum', () => {
    // Sem esta guarda, cadastrar a conta do provedor geraria alarme no mesmo
    // dia, antes de existir cobranca capaz de gerar evento.
    const alertas = avaliarFinanceiro(financeiro({ ultimoEventoRecebido: null }), AGORA_F16);

    expect(alertas.map((a) => a.codigo)).not.toContain('WEBHOOK_SILENCIOSO');
  });

  it('um dia sem evento nao alerta -- academia pequena passa um dia sem PIX', () => {
    const alertas = avaliarFinanceiro(
      financeiro({ ultimoEventoRecebido: new Date('2026-08-18T12:00:00.000Z') }),
      AGORA_F16,
    );

    expect(alertas.map((a) => a.codigo)).not.toContain('WEBHOOK_SILENCIOSO');
  });

  it('divergencia em aberto vira RECONCILIATION_PENDING, severidade INFO', () => {
    const alertas = avaliarFinanceiro(financeiro({ divergenciasEmAberto: 4 }), AGORA_F16);
    const alerta = alertas.find((a) => a.codigo === 'RECONCILIATION_PENDING');

    // INFO e nao WARNING: divergencia de conciliacao nao para a catraca. Subir
    // a severidade a nivelaria com Edge offline, e a operacao perderia a
    // distincao que faz o painel valer.
    expect(alerta?.severidade).toBe('INFO');
    expect(alerta?.evidencia['divergenciasEmAberto']).toBe(4);
  });

  it('BACKLOG E SILENCIO SAO ALERTAS DIFERENTES -- as acoes sao opostas', () => {
    // Backlog manda olhar o processamento; silencio manda olhar a configuracao
    // do webhook no provedor. Um codigo so faria a operacao ligar para a
    // pessoa errada -- mesmo criterio que separou EDGE_OFFLINE de
    // EDGE_CREDENTIAL_EXPIRING (ADR-011).
    const alertas = avaliarFinanceiro(
      financeiro({
        eventoPendenteMaisAntigo: new Date('2026-08-16T11:00:00.000Z'),
        eventosPendentes: 2,
        ultimoEventoRecebido: new Date('2026-08-16T12:00:00.000Z'),
      }),
      AGORA_F16,
    );

    expect(alertas.map((a) => a.codigo).sort()).toEqual(['WEBHOOK_BACKLOG', 'WEBHOOK_SILENCIOSO']);
    expect(alertas[0]?.acaoRecomendada).not.toBe(alertas[1]?.acaoRecomendada);
  });

  it('todo alerta financeiro tem impacto e acao em pt-BR', () => {
    const alertas = avaliarFinanceiro(
      financeiro({
        eventoPendenteMaisAntigo: new Date('2026-08-16T11:00:00.000Z'),
        ultimoEventoRecebido: new Date('2026-08-16T12:00:00.000Z'),
        divergenciasEmAberto: 1,
      }),
      AGORA_F16,
    );

    expect(alertas).toHaveLength(3);

    for (const alerta of alertas) {
      expect(alerta.impacto.length).toBeGreaterThan(20);
      expect(alerta.acaoRecomendada.length).toBeGreaterThan(20);
      expect(alerta.recurso).toBe('BILLING');
    }
  });

  it('evidencia financeira nao carrega PII nem valor de aluno', () => {
    const alertas = avaliarFinanceiro(
      financeiro({
        eventoPendenteMaisAntigo: new Date('2026-08-16T11:00:00.000Z'),
        divergenciasEmAberto: 1,
      }),
      AGORA_F16,
    );

    for (const alerta of alertas) {
      const chaves = Object.keys(alerta.evidencia).join(',').toLowerCase();

      expect(chaves).not.toContain('cpf');
      expect(chaves).not.toContain('student');
      expect(chaves).not.toContain('nome');
      expect(chaves).not.toContain('amount');
    }
  });
});

describe('avaliarSaude -- operacao da Slice 3.6 (F22)', () => {
  const AGORA = new Date('2026-08-21T12:00:00.000Z');

  function estado(sobrescreve: Partial<EstadoDaSaude> = {}): EstadoDaSaude {
    return {
      importacoesPendentes: 0,
      pendenteMaisAntiga: null,
      importacoesComFalha: 0,
      analisesNoPeriodo: 0,
      analisesRejeitadas: 0,
      gastoMicros: 0,
      tetoMicros: null,
      ...sobrescreve,
    };
  }

  it('operacao saudavel nao gera alerta nenhum', () => {
    expect(avaliarSaude(estado(), AGORA)).toEqual([]);
  });

  /**
   * Nenhum alerta desta fatia e CRITICAL, e isso e deliberado: CRITICAL
   * significa "a catraca nao esta funcionando agora". Laudo esperando revisao
   * nao impede ninguem de treinar, e dar a ele o mesmo peso faria a operacao
   * aprender a ignorar o vermelho.
   */
  it('nenhum alerta de saude e CRITICAL', () => {
    const todos = avaliarSaude(
      estado({
        pendenteMaisAntiga: new Date('2026-08-01T12:00:00.000Z'),
        importacoesPendentes: 3,
        importacoesComFalha: 2,
        analisesNoPeriodo: 10,
        analisesRejeitadas: 9,
        gastoMicros: 100,
        tetoMicros: 100,
      }),
      AGORA,
    );

    expect(todos).toHaveLength(4);
    expect(todos.every((a) => a.severidade !== 'CRITICAL')).toBe(true);
    expect(todos.every((a) => a.recurso === 'HEALTH')).toBe(true);
  });

  describe('importacao esperando revisao', () => {
    it('alerta quando a espera passa do limite', () => {
      const alertas = avaliarSaude(
        estado({
          importacoesPendentes: 2,
          pendenteMaisAntiga: new Date('2026-08-18T12:00:00.000Z'),
        }),
        AGORA,
      );

      expect(alertas).toHaveLength(1);
      expect(alertas[0]).toMatchObject({
        codigo: 'HEALTH_IMPORT_PENDING_REVIEW',
        severidade: 'WARNING',
      });
      expect(alertas[0]!.evidencia['esperaEmHoras']).toBe(72);
    });

    it('nao alerta enquanto a espera e normal', () => {
      // Revisar em algumas horas e o fluxo funcionando -- alertar ai seria
      // acusar a operacao de estar trabalhando.
      const alertas = avaliarSaude(
        estado({
          importacoesPendentes: 1,
          pendenteMaisAntiga: new Date('2026-08-21T06:00:00.000Z'),
        }),
        AGORA,
      );

      expect(alertas).toEqual([]);
    });

    it('sem pendencia nao alerta', () => {
      expect(avaliarSaude(estado({ importacoesPendentes: 0 }), AGORA)).toEqual([]);
    });
  });

  describe('importacao com falha', () => {
    it('alerta e diz para digitar a mao', () => {
      const alertas = avaliarSaude(estado({ importacoesComFalha: 1 }), AGORA);

      expect(alertas[0]!.codigo).toBe('HEALTH_IMPORT_FAILED');
      // INV-140: o caminho manual sempre existiu, e a acao recomendada tem de
      // dizer isso -- senao a recepcao fica esperando o OCR voltar.
      expect(alertas[0]!.acaoRecomendada).toContain('a mao');
    });

    it('zero falhas nao alerta', () => {
      expect(avaliarSaude(estado({ importacoesComFalha: 0 }), AGORA)).toEqual([]);
    });
  });

  describe('taxa de rejeicao da IA (M3-AC-008)', () => {
    /**
     * Rejeicao isolada e o sistema FUNCIONANDO -- a regra no 8 recusando saida
     * ruim. O que se vigia e a taxa.
     */
    it('nao alerta com poucas analises, mesmo com rejeicao alta', () => {
      // 1 de 1 seria "100% de rejeicao" -- alarme no primeiro uso do recurso.
      const alertas = avaliarSaude(
        estado({ analisesNoPeriodo: 1, analisesRejeitadas: 1 }),
        AGORA,
      );

      expect(alertas).toEqual([]);
    });

    it('alerta quando a taxa passa do limite com amostra suficiente', () => {
      const alertas = avaliarSaude(
        estado({ analisesNoPeriodo: 10, analisesRejeitadas: 4 }),
        AGORA,
      );

      expect(alertas[0]).toMatchObject({ codigo: 'HEALTH_AI_REJECTION_RATE_HIGH' });
      expect(alertas[0]!.evidencia['taxaPercentual']).toBe(40);
    });

    it('taxa dentro do aceitavel nao alerta', () => {
      // 2 de 10 = 20%, abaixo dos 30%: rejeicao existe e e saudavel.
      expect(
        avaliarSaude(estado({ analisesNoPeriodo: 10, analisesRejeitadas: 2 }), AGORA),
      ).toEqual([]);
    });
  });

  describe('teto de gasto (M3-NFR-005, ADR-036 decisao 4)', () => {
    /**
     * Teto NAO configurado e o padrao hoje. Inventar um numero cortaria a
     * analise de uma academia que nunca combinou limite nenhum.
     */
    it('sem teto configurado NAO alerta, por mais que gaste', () => {
      expect(
        avaliarSaude(estado({ gastoMicros: 999_999, tetoMicros: null }), AGORA),
      ).toEqual([]);
    });

    it('alerta ANTES de estourar', () => {
      const alertas = avaliarSaude(
        estado({ gastoMicros: 85, tetoMicros: 100 }),
        AGORA,
      );

      expect(alertas[0]).toMatchObject({ codigo: 'HEALTH_AI_BUDGET_NEAR_LIMIT' });
      expect(alertas[0]!.evidencia['estourou']).toBe(false);
      // Avisar antes da tempo de decidir; avisar depois faz a academia
      // descobrir pelo aluno reclamando que o resumo sumiu.
      expect(alertas[0]!.impacto).toContain('perto do teto');
    });

    it('estourado, o impacto muda de tom', () => {
      const alertas = avaliarSaude(
        estado({ gastoMicros: 120, tetoMicros: 100 }),
        AGORA,
      );

      expect(alertas[0]!.evidencia['estourou']).toBe(true);
      expect(alertas[0]!.impacto).toContain('degradada');
    });

    it('gasto folgado nao alerta', () => {
      expect(avaliarSaude(estado({ gastoMicros: 10, tetoMicros: 100 }), AGORA)).toEqual([]);
    });

    it('teto zero nao divide por zero', () => {
      expect(avaliarSaude(estado({ gastoMicros: 10, tetoMicros: 0 }), AGORA)).toEqual([]);
    });
  });

  describe('todo alerta e acionavel', () => {
    it('declara impacto e acao, nunca so o diagnostico', () => {
      const todos = avaliarSaude(
        estado({
          pendenteMaisAntiga: new Date('2026-08-01T12:00:00.000Z'),
          importacoesComFalha: 1,
          analisesNoPeriodo: 10,
          analisesRejeitadas: 9,
          gastoMicros: 100,
          tetoMicros: 100,
        }),
        AGORA,
      );

      for (const alerta of todos) {
        // "Sem impacto declarado" e como um alerta vira ruido.
        expect(alerta.impacto.length).toBeGreaterThan(20);
        expect(alerta.acaoRecomendada.length).toBeGreaterThan(20);
      }
    });
  });
});
