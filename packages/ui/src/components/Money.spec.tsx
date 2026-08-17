import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Money } from './Money.js';

describe('Money', () => {
  it('centavos inteiros viram reais sem float no caminho', () => {
    render(<Money cents={12345} />);

    expect(screen.getByText(/123,45/)).toBeInTheDocument();
  });

  /**
   * O caso que quebra float: `0.1 + 0.2 = 0.30000000000000004`.
   *
   * Com centavo inteiro, 10 + 20 = 30 e a divisao por 100 acontece uma vez so,
   * no ultimo instante antes do olho humano.
   */
  it('30 centavos sao 30 centavos', () => {
    render(<Money cents={30} />);

    expect(screen.getByText(/0,30/)).toBeInTheDocument();
  });

  it('valor negativo mostra o sinal -- estorno existe', () => {
    render(<Money cents={-5000} />);

    expect(screen.getByText(/-/)).toBeInTheDocument();
    expect(screen.getByText(/50,00/)).toBeInTheDocument();
  });

  it('zero e zero; ausencia e travessao', () => {
    const { rerender } = render(<Money cents={0} />);
    expect(screen.getByText(/0,00/)).toBeInTheDocument();

    rerender(<Money cents={null} />);
    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
  });

  /**
   * Recusa em vez de arredondar.
   *
   * `M2-BR-001`: dinheiro e inteiro na menor unidade. Se um float chegou ate
   * aqui, alguem ja errou antes -- arredondar esconderia o bug e produziria
   * diferenca de centavo na conciliacao com o provedor de pagamento.
   */
  it('recusa valor nao inteiro em vez de arredondar em silencio', () => {
    expect(() => render(<Money cents={123.45} />)).toThrow(/inteiro/i);
  });

  it('liga numeral tabular -- coluna de dinheiro nao danca entre linhas', () => {
    const { container } = render(<Money cents={12345} />);

    expect(container.querySelector('[data-numeric]')).not.toBeNull();
  });
});
