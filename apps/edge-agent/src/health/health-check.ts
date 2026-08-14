import { type Config } from '../config/env.js';

/**
 * Health check local -- entrega da Slice 0.1.
 *
 * O aceite da slice e "outro desenvolvedor instala a bancada seguindo o
 * runbook e obtem heartbeat DOS COMPONENTES DISPONIVEIS". "Disponiveis", nao
 * "todos": componente ausente vira `indisponivel`, e isso nao reprova o
 * heartbeat -- reprova componente que existe e nao responde.
 *
 * Funcao pura: o "agora" entra por parametro (CLAUDE.md -> Convencoes). Sem
 * isso, testar degradacao por tempo exigiria relogio falso.
 */

export type EstadoComponente = 'ok' | 'degradado' | 'indisponivel';

export type Componente = {
  nome: string;
  estado: EstadoComponente;
  detalhe: string;
};

export type Heartbeat = {
  edgeAgentId: string;
  tenantId: string;
  gymUnitId: string;
  emitidoEm: string;
  /**
   * `ok` se todo componente disponivel responde; `degradado` se algum falha.
   *
   * Componente `indisponivel` NAO degrada o agente: numa bancada sem leitor
   * conectado, o agente esta saudavel -- so nao tem com quem falar.
   */
  estado: Exclude<EstadoComponente, 'indisponivel'>;
  componentes: readonly Componente[];
};

export function montarHeartbeat(
  config: Config,
  componentes: readonly Componente[],
  agora: Date,
): Heartbeat {
  const algumFalhou = componentes.some((c) => c.estado === 'degradado');

  return {
    edgeAgentId: config.EDGE_AGENT_ID,
    tenantId: config.TENANT_ID,
    gymUnitId: config.GYM_UNIT_ID,
    emitidoEm: agora.toISOString(),
    estado: algumFalhou ? 'degradado' : 'ok',
    componentes,
  };
}

/**
 * Componente que representa o proprio processo. Sempre `ok` -- se o processo
 * nao estivesse de pe, nao haveria heartbeat.
 */
export function componenteProcesso(config: Config): Componente {
  return {
    nome: 'edge-agent',
    estado: 'ok',
    detalhe: config.USE_SIMULATOR ? 'em execucao (modo simulador)' : 'em execucao',
  };
}
