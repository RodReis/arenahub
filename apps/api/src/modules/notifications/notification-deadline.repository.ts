/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_PRAZO = Symbol('PortaDePrazo');

export interface InvoiceParaAvaliar {
  readonly id: string;
  readonly tenantId: string;
  readonly dueAt: Date;
}

export interface SubscriptionParaAvaliar {
  readonly id: string;
  readonly tenantId: string;
  readonly endsAt: Date;
}

export interface AlunoParaAvaliar {
  readonly studentId: string;
  readonly tenantId: string;
  readonly ultimoCheckIn: Date;
}

/**
 * O que `NotificationDeadlineSchedulerService` precisa -- F73 §4.2.
 *
 * Cada `*ParaAvisar` ja filtra por "sem `OutboxEvent` deste tipo emitido no
 * periodo relevante" -- a idempotencia por `aggregateId`+`eventType` mora
 * na query, nao numa coluna nova.
 */
export interface PortaDePrazo {
  invoicesAbertasSemAvisoDeVencimento(agora: Date): Promise<readonly InvoiceParaAvaliar[]>;
  assinaturasAtivasSemAvisoDeVencimento(agora: Date): Promise<readonly SubscriptionParaAvaliar[]>;
  /** Alunos ATIVOS cujo ultimo check-in nao gerou `StudentAbsent` nos
   * ultimos 7 dias -- a janela evita repetir o aviso todo dia. */
  alunosSemAvisoDeAusencia(agora: Date): Promise<readonly AlunoParaAvaliar[]>;

  publicarEvento(
    tenantId: string,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}
