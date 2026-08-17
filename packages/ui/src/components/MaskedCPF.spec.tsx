import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MaskedCPF } from './MaskedCPF.js';

describe('MaskedCPF', () => {
  it('mostra a mascara que a API mandou, sem remontar o CPF', () => {
    render(<MaskedCPF masked="•••.412.876-••" />);

    expect(screen.getByText('•••.412.876-••')).toBeInTheDocument();
  });

  it('ausencia e travessao, nunca CPF vazio formatado', () => {
    render(<MaskedCPF masked={null} />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
  });

  /**
   * O painel nunca recebe documento inteiro. Se a API regredir e devolver o
   * CPF cru, o erro aparece no primeiro render -- em vez de o documento chegar
   * calado na tela e nos logs de erro do navegador.
   */
  it('recusa CPF completo -- o painel nunca recebe documento inteiro', () => {
    expect(() => render(<MaskedCPF masked="123.412.876-09" />)).toThrow(/mascarado/i);
  });
});
