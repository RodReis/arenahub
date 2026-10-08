import { describe, expect, it } from 'vitest';

import { planosDeDiariaDe } from './planos-de-diaria';

const preco = { amountMinor: 3000, currency: 'BRL' };

describe('planosDeDiariaDe', () => {
  it('so plano DIARIA, ativo e com preco vigente', () => {
    const lista = [
      { id: 'a', name: 'Diaria', isActive: true, billingMode: 'DIARIA' as const, currentPrice: preco },
      { id: 'b', name: 'Mensal', isActive: true, billingMode: 'AVULSO' as const, currentPrice: preco },
      { id: 'c', name: 'Diaria inativa', isActive: false, billingMode: 'DIARIA' as const, currentPrice: preco },
      { id: 'd', name: 'Diaria sem preco', isActive: true, billingMode: 'DIARIA' as const, currentPrice: null },
      { id: 'e', name: 'Sem modo', isActive: true },
    ];

    expect(planosDeDiariaDe(lista)).toEqual([
      { id: 'a', name: 'Diaria', amountMinor: 3000, currency: 'BRL' },
    ]);
  });
});
