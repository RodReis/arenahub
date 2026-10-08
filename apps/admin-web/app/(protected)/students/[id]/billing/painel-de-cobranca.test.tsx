import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { PainelDeCobranca } from './painel-de-cobranca';

/*
 * Actions viram mock: sao Server Actions (`'use server'`) e importam
 * `chamarApi` (`server-only`). Aqui so importa QUANDO a venda de diaria
 * aparece, nao o transporte.
 */
vi.mock('../../../../actions/billing', () => ({
  receberPagamentoEmLote: vi.fn(),
  abrirCobranca: vi.fn(),
}));

vi.mock('../../../../actions/membership', () => ({ venderDiaria: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const diaria = {
  studentId: 's1',
  planos: [{ id: 'p', name: 'Diaria', amountMinor: 3000, currency: 'BRL' }],
  impedido: false,
};

function montar(props: Partial<React.ComponentProps<typeof PainelDeCobranca>>) {
  return render(
    <ToastProvider>
      <PainelDeCobranca
        subscriptionId={null}
        subscriptionIdParaPagamento={null}
        mesesPagaveis={[]}
        diaria={diaria}
        {...props}
      />
    </ToastProvider>,
  );
}

/**
 * Diaria na Cobranca (ajuste do PI, F89): a venda do balcao fica na tela em
 * que se recebe o plano, mas SO para quem nao tem plano vinculado.
 */
describe('PainelDeCobranca -- diaria', () => {
  it('sem assinatura: mostra o vazio E a venda de diaria', () => {
    montar({});

    expect(screen.getByTestId('sem-assinatura-ativa')).toBeInTheDocument();
    expect(screen.getByTestId('abrir-venda-de-diaria')).toBeInTheDocument();
  });

  it('com assinatura ativa: NAO mostra a venda de diaria', () => {
    montar({ subscriptionId: 'sub', subscriptionIdParaPagamento: 'sub' });

    expect(screen.queryByTestId('abrir-venda-de-diaria')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diaria-na-cobranca')).not.toBeInTheDocument();
  });

  it('assinatura suspensa (so faixa de meses): NAO mostra a venda de diaria', () => {
    montar({ subscriptionId: null, subscriptionIdParaPagamento: 'sub' });

    expect(screen.queryByTestId('abrir-venda-de-diaria')).not.toBeInTheDocument();
    expect(screen.queryByTestId('diaria-na-cobranca')).not.toBeInTheDocument();
  });

  it('aluno impedido: mostra o aviso, nao o botao', () => {
    montar({ diaria: { ...diaria, impedido: true } });

    expect(screen.getByTestId('diaria-impedida')).toBeInTheDocument();
    expect(screen.queryByTestId('abrir-venda-de-diaria')).not.toBeInTheDocument();
  });

  it('sem a prop diaria (chamador antigo): so o vazio, sem bloco', () => {
    render(
      <ToastProvider>
        <PainelDeCobranca subscriptionId={null} subscriptionIdParaPagamento={null} mesesPagaveis={[]} />
      </ToastProvider>,
    );

    expect(screen.getByTestId('sem-assinatura-ativa')).toBeInTheDocument();
    expect(screen.queryByTestId('diaria-na-cobranca')).not.toBeInTheDocument();
  });
});
