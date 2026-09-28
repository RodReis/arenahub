import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EvolucaoDeReceita } from './evolucao-de-receita';

describe('EvolucaoDeReceita', () => {
  it('com 1 ponto so, mostra aviso textual de dado insuficiente e nao desenha grafico', () => {
    render(
      <EvolucaoDeReceita
        testId="evolucao-teste"
        pontos={[{ rotulo: 'ago/2026', faturadoMinor: 10_000, recebidoMinor: 8_000 }]}
      />,
    );

    expect(screen.getByText(/dado insuficiente/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('com 0 pontos, mostra a frase de serie vazia em vez de eixos sem linha', () => {
    render(<EvolucaoDeReceita testId="evolucao-teste" pontos={[]} />);

    expect(screen.getByText(/nenhuma competência apurada/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('com 3+ pontos, desenha o grafico (aria-hidden) e publica a tabela equivalente', () => {
    render(
      <EvolucaoDeReceita
        testId="evolucao-teste"
        pontos={[
          { rotulo: 'jun/2026', faturadoMinor: 10_000, recebidoMinor: 9_000 },
          { rotulo: 'jul/2026', faturadoMinor: 11_000, recebidoMinor: 8_000 },
          { rotulo: 'ago/2026', faturadoMinor: 12_000, recebidoMinor: 10_000 },
        ]}
      />,
    );

    expect(screen.queryByText(/dado insuficiente/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('evolucao-teste')).toHaveAttribute('aria-hidden', 'true');

    const tabela = screen.getByRole('table');
    expect(within(tabela).getByText('jun/2026')).toBeInTheDocument();
    expect(within(tabela).getByText('jul/2026')).toBeInTheDocument();
    expect(within(tabela).getByText('ago/2026')).toBeInTheDocument();
    // Valor formatado em moeda -- prova que a tabela usa dinheiro de verdade,
    // nao centavos crus.
    expect(within(tabela).getByText('R$ 110,00')).toBeInTheDocument();
    expect(within(tabela).getByText('R$ 80,00')).toBeInTheDocument();
  });
});
