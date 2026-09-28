import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgingDaDivida } from './aging-da-divida';

describe('AgingDaDivida', () => {
  it('nao desenha barra para faixa com valor zero, mas mantem a faixa com valor', () => {
    render(
      <AgingDaDivida
        testId="aging-teste"
        faixas={[
          { rotulo: 'Até 15 dias', valorMinor: 10_000, tokenDeCor: '--ah-state-warning' },
          { rotulo: '16 a 30 dias', valorMinor: 0, tokenDeCor: '--ah-state-risk' },
        ]}
      />,
    );

    // A tabela de apoio (leitor de tela) e a UNICA fonte visivel de rotulo
    // no jsdom -- Recharts nao desenha SVG aqui, entao provar "nao desenhou
    // barra" so e possivel checando que o dado nao chegou nem a lista que
    // alimentaria o grafico. A tabela sr-only, porem, so lista faixas > 0.
    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('Até 15 dias')).toBeInTheDocument();
    expect(within(tabela).queryByText('16 a 30 dias')).not.toBeInTheDocument();
  });

  it('quando todas as faixas sao zero, nao ha grafico nem tabela -- so o aviso de vazio', () => {
    render(
      <AgingDaDivida
        testId="aging-teste"
        faixas={[{ rotulo: 'Até 15 dias', valorMinor: 0, tokenDeCor: '--ah-state-warning' }]}
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/nenhuma dívida em aberto/i)).toBeInTheDocument();
  });

  it('publica tabela invisivel para leitor de tela com todas as faixas com valor', () => {
    render(
      <AgingDaDivida
        testId="aging-teste"
        faixas={[
          { rotulo: 'Até 15 dias', valorMinor: 10_000, tokenDeCor: '--ah-state-warning' },
          { rotulo: '16 a 30 dias', valorMinor: 5_000, tokenDeCor: '--ah-state-risk' },
        ]}
      />,
    );

    expect(screen.getByTestId('aging-teste')).toHaveAttribute('aria-hidden', 'true');

    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('Até 15 dias')).toBeInTheDocument();
    expect(within(tabela).getByText('16 a 30 dias')).toBeInTheDocument();
    // Valor formatado em moeda, nao centavos crus.
    expect(within(tabela).getByText('R$ 100,00')).toBeInTheDocument();
  });
});
