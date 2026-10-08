import type { PlanoDeDiaria } from '../../app/(protected)/students/[id]/vender-diaria';

export interface PlanoDaLista {
  id: string;
  name: string;
  isActive: boolean;
  billingMode?: 'AVULSO' | 'ASSINATURA' | 'DIARIA';
  currentPrice?: { amountMinor: number; currency: string } | null;
}

/** Planos que a recepcao pode vender como diaria: modalidade DIARIA, ativo e com preco vigente. */
export function planosDeDiariaDe(planos: readonly PlanoDaLista[]): PlanoDeDiaria[] {
  return planos.flatMap((p) =>
    p.billingMode === 'DIARIA' && p.isActive && p.currentPrice
      ? [{ id: p.id, name: p.name, amountMinor: p.currentPrice.amountMinor, currency: p.currentPrice.currency }]
      : [],
  );
}
