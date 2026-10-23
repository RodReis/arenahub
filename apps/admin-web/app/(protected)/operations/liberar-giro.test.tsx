import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

const liberarGiro = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('../../actions/access-override', () => ({
  liberarGiro: (...args: unknown[]) => liberarGiro(...args),
}));

import { LiberarGiro } from './liberar-giro';

const UNIDADE = '11111111-1111-4111-8111-111111111111';
const CATRACA = '22222222-2222-4222-8222-222222222222';

function renderizar() {
  return render(
    <ToastProvider>
      <LiberarGiro gymUnitId={UNIDADE} deviceId={CATRACA} />
    </ToastProvider>,
  );
}

/** #660 -- botão "Liberar giro" do painel Operação. */
describe('Liberar giro', () => {
  it('manda a catraca e a unidade certas na ação', () => {
    const { container } = renderizar();

    expect(container.querySelector('input[name="deviceId"]')).toHaveValue(CATRACA);
    expect(container.querySelector('input[name="gymUnitId"]')).toHaveValue(UNIDADE);
  });

  it('e verde cheio, para nao passar despercebido (#682)', () => {
    renderizar();

    expect(screen.getByTestId('liberar-giro')).toHaveAttribute('data-variant', 'success');
  });

  it('avisa por toast que o giro foi liberado', async () => {
    liberarGiro.mockResolvedValueOnce({ liberadoEm: '2026-10-22T12:00:00.000Z' });
    renderizar();

    fireEvent.click(screen.getByTestId('liberar-giro'));

    await waitFor(() => expect(screen.getByText(/Giro liberado/)).toBeInTheDocument());
  });

  it('mostra o erro da API por toast', async () => {
    liberarGiro.mockResolvedValueOnce({ erro: 'Seu perfil não tem permissão para liberar a catraca.' });
    renderizar();

    fireEvent.click(screen.getByTestId('liberar-giro'));

    await waitFor(() => expect(screen.getByText(/não tem permissão/)).toBeInTheDocument());
  });
});
