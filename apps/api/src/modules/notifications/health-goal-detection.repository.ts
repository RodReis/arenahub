import type { MetaParaProgresso } from '../health/domain/progresso-da-meta.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_DETECCAO_DE_META = Symbol('PortaDeDeteccaoDeMeta');

export interface MetaAtivaParaAvaliar extends MetaParaProgresso {
  readonly id: string;
  readonly tenantId: string;
  readonly studentId: string;
  readonly type: string;
}

/**
 * O que `HealthGoalDetectionSchedulerService` precisa -- F73 §4.1.
 *
 * `achievedAt` NAO era persistido antes desta fatia (calculado sob demanda
 * em `attendance.service.ts`); este job e quem passa a gravar, na mesma
 * transacao do `OutboxEvent`.
 */
export interface PortaDeDeteccaoDeMeta {
  /** Metas ainda sem `achievedAt` e sem `closedAt` -- as unicas que ainda
   * podem "ser atingidas agora". */
  metasAtivasSemConquista(): Promise<readonly MetaAtivaParaAvaliar[]>;

  /** Ultimo valor PUBLICADO do tipo, para o aluno. `null` sem medicao. */
  ultimoValorPublicado(tenantId: string, studentId: string, type: string): Promise<number | null>;

  /** Grava `achievedAt` (so se ainda nulo) e publica `HealthGoalReached` na
   * MESMA transacao. */
  marcarAtingidaEPublicar(tenantId: string, goalId: string, agora: Date): Promise<boolean>;
}
