import type {
  AlunoParaAvaliar,
  InvoiceParaAvaliar,
  PortaDePrazo,
  SubscriptionParaAvaliar,
} from './notification-deadline.repository.js';

export interface EventoPublicado {
  readonly tenantId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/** Dublê de `PortaDePrazo` em memoria. Instancia NOVA por teste. */
export class FakePortaDePrazo implements PortaDePrazo {
  private invoices: InvoiceParaAvaliar[] = [];
  private assinaturas: SubscriptionParaAvaliar[] = [];
  private alunos: AlunoParaAvaliar[] = [];
  readonly eventosPublicados: EventoPublicado[] = [];

  comInvoice(invoice: InvoiceParaAvaliar): void {
    this.invoices.push(invoice);
  }

  comAssinatura(assinatura: SubscriptionParaAvaliar): void {
    this.assinaturas.push(assinatura);
  }

  comAluno(aluno: AlunoParaAvaliar): void {
    this.alunos.push(aluno);
  }

  async invoicesAbertasSemAvisoDeVencimento(): Promise<readonly InvoiceParaAvaliar[]> {
    return this.invoices;
  }

  async assinaturasAtivasSemAvisoDeVencimento(): Promise<readonly SubscriptionParaAvaliar[]> {
    return this.assinaturas;
  }

  async alunosSemAvisoDeAusencia(): Promise<readonly AlunoParaAvaliar[]> {
    return this.alunos;
  }

  async publicarEvento(
    tenantId: string,
    eventType: string,
    aggregateType: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.eventosPublicados.push({ tenantId, eventType, aggregateType, aggregateId, payload });
  }
}
