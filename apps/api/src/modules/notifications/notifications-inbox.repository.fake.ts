import type { AvisoAGravar } from './domain/mapa-de-avisos.js';
import type { PortaDeAvisos } from './notifications-inbox.repository.js';

export interface AvisoGravado {
  readonly tenantId: string;
  readonly studentId: string;
  readonly kind: AvisoAGravar['kind'];
  readonly title: string;
  readonly body: string;
  readonly action: AvisoAGravar['action'];
  readonly actionTargetId: string | null;
  readonly expiresAt: Date | null;
}

/** Dublê de `PortaDeAvisos` em memoria. Instancia NOVA por teste. */
export class FakePortaDeAvisos implements PortaDeAvisos {
  readonly gravados: AvisoGravado[] = [];
  private alunosPorAgregado = new Map<string, string>();

  /** `resolverStudentId('Invoice', 'invoice-1')` devolvera `studentId`. */
  comAgregado(aggregateType: string, aggregateId: string, studentId: string): void {
    this.alunosPorAgregado.set(`${aggregateType}::${aggregateId}`, studentId);
  }

  async resolverStudentId(aggregateType: string, aggregateId: string): Promise<string | null> {
    return this.alunosPorAgregado.get(`${aggregateType}::${aggregateId}`) ?? null;
  }

  async gravar(tenantId: string, studentId: string, aviso: AvisoAGravar): Promise<void> {
    this.gravados.push({ tenantId, studentId, ...aviso });
  }
}
