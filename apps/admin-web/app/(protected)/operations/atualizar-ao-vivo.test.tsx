import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

import { AtualizarAoVivo, INTERVALO_DE_RECARGA_MS } from './atualizar-ao-vivo';

function esconderAba(oculta: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: oculta ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('atualização ao vivo do painel de operação', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
    esconderAba(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('recarrega os dados do servidor a cada 30 segundos', () => {
    render(<AtualizarAoVivo />);

    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(INTERVALO_DE_RECARGA_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(INTERVALO_DE_RECARGA_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  /** Aba esquecida aberta num turno de 12 h nao pode disputar fila com a catraca. */
  it('para com a aba oculta, diz "pausado" por escrito e le uma vez ao voltar', () => {
    render(<AtualizarAoVivo />);

    expect(screen.getByTestId('estado-da-operacao')).toHaveTextContent('ao vivo');

    act(() => esconderAba(true));
    expect(screen.getByTestId('estado-da-operacao')).toHaveTextContent('pausado');

    act(() => {
      vi.advanceTimersByTime(INTERVALO_DE_RECARGA_MS * 3);
    });
    expect(refresh).not.toHaveBeenCalled();

    act(() => esconderAba(false));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('estado-da-operacao')).toHaveTextContent('ao vivo');
  });

  it('o botão atualiza na hora, sem esperar o ciclo', () => {
    render(<AtualizarAoVivo />);

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('desmontar para o ciclo', () => {
    const { unmount } = render(<AtualizarAoVivo />);

    unmount();
    act(() => {
      vi.advanceTimersByTime(INTERVALO_DE_RECARGA_MS * 2);
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
