import { randomUUID } from 'node:crypto';

import pino, { type Logger } from 'pino';

import { type Config } from '../config/env.js';

/**
 * Log estruturado do edge-agent.
 *
 * `M0-NFR-004`: os logs precisam permitir reconstruir UMA TENTATIVA inteira
 * pelo `correlationId`. Por isso o correlationId nao e opcional no caminho
 * de uma tentativa -- ele nasce no reconhecimento e acompanha ate a
 * passagem ou o timeout.
 *
 * CLAUDE.md: nunca logar template biometrico, token de pagamento, dado de
 * cartao ou PII. A redacao abaixo e a rede de seguranca, nao a regra -- a
 * regra e nao passar esses dados para o logger.
 */

/**
 * Caminhos redigidos automaticamente.
 *
 * Isto NAO substitui cuidado no ponto de chamada: cobre o campo com nome
 * previsto, e nada mais. Template biometrico dentro de um campo chamado
 * `payload` passa batido -- por isso ele nunca deve chegar aqui.
 */
const CAMINHOS_REDIGIDOS = [
  'template',
  'templateBiometrico',
  'biometricTemplate',
  'secret',
  'hmac',
  'password',
  'senha',
  'token',
  'authorization',
  'cpf',
  '*.template',
  '*.secret',
  '*.token',
  '*.cpf',
  'headers.authorization',
] as const;

export function criarLogger(config: Config): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: {
      // Todo log carrega de onde veio. Numa bancada com mais de um agente,
      // sem isto o log vira sopa.
      edgeAgentId: config.EDGE_AGENT_ID,
      tenantId: config.TENANT_ID,
      gymUnitId: config.GYM_UNIT_ID,
    },
    redact: {
      paths: [...CAMINHOS_REDIGIDOS],
      censor: '***',
    },
    // ISO com milissegundo: correlacionar log de agente com log de nuvem
    // exige timestamp comparavel, e epoch em milissegundo obriga conversao
    // na hora errada -- quando alguem esta investigando incidente.
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/** Cria um `correlationId` novo para uma tentativa. */
export function novoCorrelationId(): string {
  return randomUUID();
}

/**
 * Deriva um logger preso a uma tentativa.
 *
 * Todo log emitido por ele carrega o mesmo `correlationId`, que e o que
 * torna `M0-NFR-004` verificavel: filtrar por um id devolve a tentativa
 * inteira, do reconhecimento ao desfecho.
 */
export function loggerDaTentativa(logger: Logger, correlationId = novoCorrelationId()): Logger {
  return logger.child({ correlationId });
}
