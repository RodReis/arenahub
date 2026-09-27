import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GraficoDeRosca } from './GraficoDeRosca.js';

const SEGMENTOS = [
  { rotulo: 'Cartão Recorrente', valor: 1_172_320, tokenDeCor: '--ah-state-info', valorLegivel: 'R$ 11.723,20 · 68%' },
  { rotulo: 'PIX Automático', valor: 379_280, tokenDeCor: '--ah-state-success', valorLegivel: 'R$ 3.792,80 · 22%' },
  { rotulo: 'Espécie', valor: 344_80, tokenDeCor: '--ah-text-secondary', valorLegivel: 'R$ 344,80 · 2%' },
];

describe('GraficoDeRosca', () => {
  it('publica os segmentos numa tabela para leitor de tela', () => {
    render(<GraficoDeRosca segmentos={SEGMENTOS} descricao="Distribuição por forma de pagamento" />);

    expect(
      screen.getByRole('table', { name: 'Distribuição por forma de pagamento' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'PIX Automático' })).toBeInTheDocument();
  });

  it('mostra o valor legível de cada segmento na legenda', () => {
    render(<GraficoDeRosca segmentos={SEGMENTOS} descricao="Distribuição por forma de pagamento" />);

    // Aparece duas vezes de proposito: na tabela invisivel (leitor de tela)
    // e na legenda visivel -- getAllByText confirma as duas.
    expect(screen.getAllByText('R$ 11.723,20 · 68%')).toHaveLength(2);
  });

  it('mostra rótulo e valor central quando fornecidos', () => {
    render(
      <GraficoDeRosca
        segmentos={SEGMENTOS}
        descricao="Distribuição por forma de pagamento"
        rotuloCentral="Recorrente"
        valorCentral="68%"
      />,
    );

    expect(screen.getByText('Recorrente')).toBeInTheDocument();
    expect(screen.getByText('68%')).toBeInTheDocument();
  });

  /**
   * SEM DADO NAO E GRAFICO VAZIO -- mesma regra de BarrasDeFaixa/SerieFinanceira.
   * Um anel com todos os segmentos zerados desenharia um circulo cinza sem
   * significado, parecendo dado que nao carregou.
   */
  it('mostra frase, nao anel vazio, quando todos os segmentos sao zero', () => {
    render(
      <GraficoDeRosca
        segmentos={SEGMENTOS.map((s) => ({ ...s, valor: 0 }))}
        descricao="Distribuição por forma de pagamento"
        testId="rosca"
      />,
    );

    expect(screen.getByTestId('rosca')).toHaveTextContent(/nenhum/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('esconde o grafico do leitor de tela, deixando so a tabela', () => {
    const { container } = render(
      <GraficoDeRosca segmentos={SEGMENTOS} descricao="Distribuição por forma de pagamento" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
