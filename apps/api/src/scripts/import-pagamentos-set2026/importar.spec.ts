import { describe, expect, it, jest } from '@jest/globals';

import { gravarPagamentosProntos } from './importar.js';
import type { VereditoDaLinha } from './dominio.js';

/**
 * `gravarPagamentosProntos` com `registrar` dublado -- sem banco. A parte
 * que precisa de Postgres real (`planejarImportacao`, RLS de `Student`)
 * fica em `test/integration/import-pagamentos-set2026.int-spec.ts`.
 */
describe('gravarPagamentosProntos', () => {
  const pronto = (nome: string, invoiceId: string): Extract<VereditoDaLinha, { tipo: 'PRONTO' }> => ({
    tipo: 'PRONTO',
    nome,
    studentId: `student-${nome}`,
    invoiceId,
    amountMinor: 15_000,
    valorDaInvoiceMinor: 15_000,
    paidAt: new Date('2026-09-01T00:00:00Z'),
  });

  it('chama registrar uma vez por item, na ordem', async () => {
    const chamadas: unknown[] = [];
    const registrar = jest.fn((entrada: unknown) => {
      chamadas.push(entrada);
      return Promise.resolve({});
    });

    const resultado = await gravarPagamentosProntos(registrar, [
      pronto('Ana', 'inv-1'),
      pronto('Bruno', 'inv-2'),
    ]);

    expect(registrar).toHaveBeenCalledTimes(2);
    expect(resultado.reconciliados).toBe(2);
    expect(resultado.falhas).toHaveLength(0);
    expect(chamadas[0]).toMatchObject({ invoiceId: 'inv-1', amountMinor: 15_000 });
    expect(chamadas[1]).toMatchObject({ invoiceId: 'inv-2' });
  });

  it('falha de UM item nao aborta os demais -- cada pagamento e independente', async () => {
    const registrar = jest
      .fn<(entrada: { invoiceId: string; amountMinor: number; reason: string; paidAt: Date }) => Promise<unknown>>()
      .mockImplementationOnce(() => Promise.resolve({}))
      .mockImplementationOnce(() => Promise.reject(new Error('invoice ja paga')))
      .mockImplementationOnce(() => Promise.resolve({}));

    const resultado = await gravarPagamentosProntos(registrar, [
      pronto('Ana', 'inv-1'),
      pronto('Bruno', 'inv-2'),
      pronto('Carla', 'inv-3'),
    ]);

    expect(registrar).toHaveBeenCalledTimes(3);
    expect(resultado.reconciliados).toBe(2);
    expect(resultado.falhas).toEqual([{ nome: 'Bruno', erro: 'invoice ja paga' }]);
  });

  it('lista vazia nao chama registrar', async () => {
    const registrar = jest.fn(() => Promise.resolve({}));

    const resultado = await gravarPagamentosProntos(registrar, []);

    expect(registrar).not.toHaveBeenCalled();
    expect(resultado).toEqual({ reconciliados: 0, falhas: [] });
  });
});
