import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Financeiro, type DadosDoFinanceiro } from './financeiro.js';

const base: DadosDoFinanceiro = {
  asOf: '2026-09-12T12:00:00.000Z',
  status: 'AVAILABLE',
  invoices: [
    {
      invoiceId: 'invoice-1',
      status: 'OPEN',
      vencimentoEm: '2026-09-20T00:00:00.000Z',
      pagoEm: null,
      valorEmCentavos: 15000,
      moeda: 'BRL',
    },
  ],
};

const renderizar = (dados: Partial<DadosDoFinanceiro> = {}, onPagar = () => {}) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Financeiro dados={{ ...base, ...dados }} onPagar={onPagar} />
    </ProvedorDeTema>,
  );

describe('Financeiro', () => {
  it('mostra o valor e o vencimento da invoice em aberto', () => {
    renderizar();

    expect(screen.getByText(/150,00/)).toBeTruthy();
    expect(screen.getByText(/20\/09\/2026/)).toBeTruthy();
  });

  it('invoice em aberto tem acao de pagar', () => {
    const onPagar = jest.fn();
    renderizar({}, onPagar);

    fireEvent.press(screen.getByTestId('financeiro-pagar-invoice-1'));

    expect(onPagar).toHaveBeenCalledWith('invoice-1');
  });

  it('invoice paga NAO tem acao de pagar', () => {
    renderizar({
      invoices: [
        {
          invoiceId: 'invoice-2',
          status: 'PAID',
          vencimentoEm: '2026-08-20T00:00:00.000Z',
          pagoEm: '2026-08-18T00:00:00.000Z',
          valorEmCentavos: 15000,
          moeda: 'BRL',
        },
      ],
    });

    expect(screen.queryByTestId('financeiro-pagar-invoice-2')).toBeNull();
  });

  it('lista vazia mostra estado vazio, e nao erro', () => {
    renderizar({ invoices: [] });

    expect(screen.getByTestId('financeiro-vazio')).toBeTruthy();
  });

  it('indisponivel mostra o SHELL, e nao a lista antiga como se fosse atual', () => {
    /* Mesma regra de `plano.tsx`/`M4-NFR-002`: dado financeiro obsoleto
     * exibido como atual e pior aqui do que em qualquer outra tela do app. */
    renderizar({ status: 'UNAVAILABLE' });

    expect(screen.getByText(/não foi possível atualizar/i)).toBeTruthy();
    expect(screen.queryByText(/150,00/)).toBeNull();
  });
});
