import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SeletorDeForma } from './seletor-de-forma';

/**
 * O seletor de forma de pagamento -- F53, Task 10.
 *
 * A regra que mais importa: aluno sem CPF nao pode pagar com cartao (o
 * antifraude do provedor bloqueia), mas a opcao NUNCA some -- ela aparece
 * desabilitada, com o motivo visivel. Sumir faz a recepcao procurar o que
 * nao esta la, e ela nao tem como adivinhar que o conserto e preencher o
 * CPF (ver `seletor-de-forma.tsx`).
 */
describe('SeletorDeForma', () => {
  it('oferece as tres formas', () => {
    render(<SeletorDeForma faltandoParaCartao={[]} onEscolher={vi.fn()} />);

    expect(screen.getByTestId('forma-dinheiro')).toBeEnabled();
    expect(screen.getByTestId('forma-pix')).toBeEnabled();
    expect(screen.getByTestId('forma-cartao')).toBeEnabled();
  });

  /*
   * DESABILITADO COM O MOTIVO, nunca ausente. Sumir com a opcao faz a
   * recepcionista procurar o que nao esta la -- e ela nao tem como descobrir
   * que o conserto e preencher o CPF.
   */
  it('desabilita o cartao e diz o motivo quando falta CPF', () => {
    render(<SeletorDeForma faltandoParaCartao={['CPF']} onEscolher={vi.fn()} />);

    expect(screen.getByTestId('forma-cartao')).toBeDisabled();
    expect(screen.getByText(/ainda não tem CPF no cadastro/i)).toBeInTheDocument();
    expect(screen.getByTestId('forma-dinheiro')).toBeEnabled();
    expect(screen.getByTestId('forma-pix')).toBeEnabled();
  });
});
