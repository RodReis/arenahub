import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarrasVerticais } from './BarrasVerticais.js';

const FAIXAS = [
  { rotulo: 'Até 15 dias', valor: 630_000, tokenDeCor: '--ah-state-warning', valorLegivel: 'R$ 6.300,00' },
  { rotulo: '16 a 30 dias', valor: 675_000, tokenDeCor: '--ah-state-risk', valorLegivel: 'R$ 6.750,00' },
  { rotulo: 'Mais de 30 dias', valor: 330_000, tokenDeCor: '--ah-state-danger', valorLegivel: 'R$ 3.300,00' },
];

describe('BarrasVerticais', () => {
  it('publica as faixas numa tabela para leitor de tela', () => {
    render(<BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />);

    expect(screen.getByRole('table', { name: 'Dívida por faixa de atraso' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '16 a 30 dias' })).toBeInTheDocument();
  });

  it('mostra o valor legível no topo de cada coluna', () => {
    render(<BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />);

    expect(screen.getAllByText('R$ 6.750,00')).toHaveLength(1);
  });

  /** Mesma regra de BarrasDeFaixa: sem dado e frase, nao eixo vazio. */
  it('mostra frase, nao eixo vazio, quando todas as faixas sao zero', () => {
    render(
      <BarrasVerticais
        faixas={FAIXAS.map((f) => ({ ...f, valor: 0 }))}
        descricao="Dívida por faixa de atraso"
        testId="aging"
      />,
    );

    expect(screen.getByTestId('aging')).toHaveTextContent(/nada em atraso/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  /**
   * UMA FAIXA CONCENTRADA nao pode fazer as outras (valor zero) produzirem
   * altura NaN ou negativa ao normalizar contra o maior valor.
   */
  it('nao quebra quando so uma faixa tem valor', () => {
    const faixas = [
      { rotulo: 'Até 15 dias', valor: 0, tokenDeCor: '--ah-state-warning', valorLegivel: 'R$ 0,00' },
      { rotulo: '16 a 30 dias', valor: 500_000, tokenDeCor: '--ah-state-risk', valorLegivel: 'R$ 5.000,00' },
    ];

    render(<BarrasVerticais faixas={faixas} descricao="Dívida por faixa de atraso" />);

    expect(screen.getAllByText('R$ 5.000,00').length).toBeGreaterThan(0);
  });

  it('esconde o grafico do leitor de tela, deixando so a tabela', () => {
    const { container } = render(
      <BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
