import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Cpf } from './Cpf.js';

describe('Cpf', () => {
  it('mostra o CPF completo formatado pela API (ADR-034)', () => {
    render(<Cpf value="123.412.876-09" />);

    expect(screen.getByText('123.412.876-09')).toBeInTheDocument();
  });

  it('ausencia e travessao, nunca CPF vazio formatado', () => {
    render(<Cpf value={null} />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
  });
});
