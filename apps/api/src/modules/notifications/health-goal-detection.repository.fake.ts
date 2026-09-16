import type {
  MetaAtivaParaAvaliar,
  PortaDeDeteccaoDeMeta,
} from './health-goal-detection.repository.js';

/** Dublê de `PortaDeDeteccaoDeMeta` em memoria. Instancia NOVA por teste. */
export class FakePortaDeDeteccaoDeMeta implements PortaDeDeteccaoDeMeta {
  private metas: MetaAtivaParaAvaliar[] = [];
  private valores = new Map<string, number>();
  readonly conquistasGravadas: { tenantId: string; goalId: string }[] = [];

  comMeta(meta: MetaAtivaParaAvaliar): void {
    this.metas.push(meta);
  }

  comValorPublicado(tenantId: string, studentId: string, type: string, valor: number): void {
    this.valores.set(`${tenantId}::${studentId}::${type}`, valor);
  }

  metasAtivasSemConquista(): Promise<readonly MetaAtivaParaAvaliar[]> {
    return Promise.resolve(this.metas);
  }

  ultimoValorPublicado(tenantId: string, studentId: string, type: string): Promise<number | null> {
    return Promise.resolve(this.valores.get(`${tenantId}::${studentId}::${type}`) ?? null);
  }

  marcarAtingidaEPublicar(tenantId: string, goalId: string): Promise<boolean> {
    const meta = this.metas.find((item) => item.id === goalId);
    if (!meta || meta.achievedAt !== null) return Promise.resolve(false);

    this.conquistasGravadas.push({ tenantId, goalId });

    return Promise.resolve(true);
  }
}
