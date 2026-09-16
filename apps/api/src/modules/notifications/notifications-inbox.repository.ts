import type { AvisoAGravar } from './domain/mapa-de-avisos.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_AVISOS = Symbol('PortaDeAvisos');

/**
 * O que `NotificationsInboxConsumer` precisa para gravar um aviso -- spec
 * da F73 §3.
 */
export interface PortaDeAvisos {
  /**
   * Resolve o `studentId` do aluno dono do agregado, quando o payload do
   * evento nao o carrega (caso de `Invoice`/`Subscription`/`Membership`,
   * cujo `aggregateId` e o proprio recurso, nao o aluno).
   *
   * `aggregateType` decide de qual tabela ler. `null` quando o
   * `aggregateId` JA E o `studentId` (caso de `HealthGoalReached`,
   * `AssessmentPublished`, `RankingUpdated`, `StudentAbsent`).
   */
  resolverStudentId(aggregateType: string, aggregateId: string): Promise<string | null>;

  gravar(tenantId: string, studentId: string, aviso: AvisoAGravar): Promise<void>;
}
