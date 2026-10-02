import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelaDoApp } from './tela-do-app.js';

const URL_DO_APK = 'https://expo.dev/artifacts/eas/abc.apk';

describe('TelaDoApp (#534)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra o QR, a versao e os tres passos', async () => {
    render(<TelaDoApp url={URL_DO_APK} version="0.1.0 (build 8)" aoVoltar={vi.fn()} />);

    // Relogio falso: `findBy*` espera por timers e travaria. Basta drenar as
    // promessas pendentes (a geracao do QR e assincrona, sem timer).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const qr = screen.getByTestId('qr-do-app');

    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByTestId('versao-do-app').textContent).toContain('0.1.0 (build 8)');
    expect(screen.getAllByTestId('passo-do-app')).toHaveLength(3);
  });

  it('sem versao a pilula mostra so Android', () => {
    render(<TelaDoApp url={URL_DO_APK} version={null} aoVoltar={vi.fn()} />);

    expect(screen.getByTestId('versao-do-app').textContent).not.toContain('versão');
  });

  it('Voltar chama aoVoltar', () => {
    const aoVoltar = vi.fn();
    render(<TelaDoApp url={URL_DO_APK} version={null} aoVoltar={aoVoltar} />);

    fireEvent.click(screen.getByTestId('voltar-do-app'));

    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });

  it('a contagem regressiva desce de segundo em segundo', () => {
    render(<TelaDoApp url={URL_DO_APK} version={null} aoVoltar={vi.fn()} tempoDeEsperaMs={60_000} />);

    expect(screen.getByTestId('contagem-do-app').textContent).toContain('60 s');

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByTestId('contagem-do-app').textContent).toContain('55 s');
  });

  it('volta sozinha quando a contagem zera, uma vez so', () => {
    const aoVoltar = vi.fn();
    render(<TelaDoApp url={URL_DO_APK} version={null} aoVoltar={aoVoltar} tempoDeEsperaMs={60_000} />);

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(aoVoltar).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });

  it('um toque na tela reinicia a contagem', () => {
    const aoVoltar = vi.fn();
    render(<TelaDoApp url={URL_DO_APK} version={null} aoVoltar={aoVoltar} tempoDeEsperaMs={60_000} />);

    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    fireEvent.pointerDown(screen.getByTestId('tela-do-app'));
    act(() => {
      vi.advanceTimersByTime(40_000);
    });

    expect(aoVoltar).not.toHaveBeenCalled();
    expect(screen.getByTestId('contagem-do-app').textContent).toContain('20 s');
  });
});
