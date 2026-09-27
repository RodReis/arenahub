import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ComposicaoPorMetodo } from './composicao-por-metodo';

describe('ComposicaoPorMetodo', () => {
  it('nao lista segmento com valorMinor zero na legenda acessivel', () => {
    render(
      <ComposicaoPorMetodo
        testId="composicao-teste"
        segmentos={[
          { rotulo: 'PIX', valorMinor: 10_000, percentual: 100, tokenDeCor: '--ah-state-success' },
          { rotulo: 'Cartão', valorMinor: 0, percentual: null, tokenDeCor: '--ah-state-info' },
        ]}
      />,
    );

    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('PIX')).toBeInTheDocument();
    expect(within(tabela).queryByText('Cartão')).not.toBeInTheDocument();
  });

  it('nao quebra ao formatar percentual nulo -- mostra so o valor em dinheiro', () => {
    render(
      <ComposicaoPorMetodo
        testId="composicao-teste"
        segmentos={[
          { rotulo: 'PIX', valorMinor: 10_000, percentual: null, tokenDeCor: '--ah-state-success' },
        ]}
      />,
    );

    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('R$ 100,00')).toBeInTheDocument();
    // Sem "null", "NaN" ou "%" soltos -- prova que o componente nao tentou
    // formatar um percentual inexistente.
    expect(within(tabela).queryByText(/null|NaN/)).not.toBeInTheDocument();
  });

  it('quando todos os segmentos sao zero, nao ha grafico nem tabela -- so o aviso de vazio', () => {
    render(
      <ComposicaoPorMetodo
        testId="composicao-teste"
        segmentos={[{ rotulo: 'PIX', valorMinor: 0, percentual: null, tokenDeCor: '--ah-state-success' }]}
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/nenhum valor recebido/i)).toBeInTheDocument();
  });

  it('a legenda visual fica aria-hidden -- so a tabela e lida pelo leitor de tela', () => {
    render(
      <ComposicaoPorMetodo
        testId="composicao-teste"
        segmentos={[
          { rotulo: 'PIX', valorMinor: 10_000, percentual: 100, tokenDeCor: '--ah-state-success' },
        ]}
      />,
    );

    expect(screen.getByTestId('composicao-teste')).toHaveAttribute('aria-hidden', 'true');
  });
});
