import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SeletorDeForma } from './seletor-de-forma';

/**
 * O seletor de forma de pagamento -- F-painel-financeiro.
 *
 * A academia recebe por maquininha fisica (nao integrada): Dinheiro, PIX,
 * Debito e Credito viram baixa manual no sistema, cada um com o proprio
 * botao -- sem checkout hospedado, sem antifraude de provedor. Por isso o
 * bloqueio de CPF/endereco (regra do checkout da Getnet) nao existe mais
 * aqui: a maquininha fisica nao passa por antifraude nenhum.
 */
describe('SeletorDeForma', () => {
  it('oferece as quatro formas, sempre habilitadas', () => {
    render(<SeletorDeForma onEscolher={vi.fn()} />);

    expect(screen.getByTestId('forma-dinheiro')).toBeEnabled();
    expect(screen.getByTestId('forma-pix')).toBeEnabled();
    expect(screen.getByTestId('forma-debito')).toBeEnabled();
    expect(screen.getByTestId('forma-credito')).toBeEnabled();
  });
});
