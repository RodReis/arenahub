import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usarStatusDaTentativa } from './usar-status-da-tentativa.js';

interface RespostaDaTentativa {
  paymentAttemptId: string;
  status: string;
  statusDaFatura: string;
  pagoEm: string | null;
}

function respostaPendente(): RespostaDaTentativa {
  return {
    paymentAttemptId: 'tentativa-1',
    status: 'PROCESSING',
    statusDaFatura: 'OPEN',
    pagoEm: null,
  };
}

function respostaConfirmada(): RespostaDaTentativa {
  return {
    paymentAttemptId: 'tentativa-1',
    status: 'SUCCEEDED',
    statusDaFatura: 'PAID',
    pagoEm: '2026-09-12T10:05:00.000Z',
  };
}

describe('usarStatusDaTentativa', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('consulta uma vez ao montar', async () => {
    const consultar = jest.fn(() => Promise.resolve(respostaPendente()));

    renderHook(() => usarStatusDaTentativa('tentativa-1', consultar, 5000));

    await waitFor(() => expect(consultar).toHaveBeenCalledTimes(1));
  });

  it('repete a consulta no intervalo enquanto o status nao e terminal', async () => {
    const consultar = jest.fn(() => Promise.resolve(respostaPendente()));

    renderHook(() => usarStatusDaTentativa('tentativa-1', consultar, 5000));

    await waitFor(() => expect(consultar).toHaveBeenCalledTimes(1));

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(consultar).toHaveBeenCalledTimes(2));

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(consultar).toHaveBeenCalledTimes(3));
  });

  it('para de consultar assim que o status vira terminal -- nao insiste depois de confirmado', async () => {
    /*
     * `M4-BR-001`/INV-081: o hook so LE o que o webhook ja confirmou -- ele
     * nao insiste no laco depois de SUCCEEDED, e nao confirma nada sozinho.
     */
    const consultar = jest
      .fn<Promise<RespostaDaTentativa>, []>()
      .mockResolvedValueOnce(respostaPendente())
      .mockResolvedValueOnce(respostaConfirmada());

    const { result } = renderHook(() => usarStatusDaTentativa('tentativa-1', consultar, 5000));

    await waitFor(() => expect(consultar).toHaveBeenCalledTimes(1));

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(result.current?.status).toBe('SUCCEEDED'));

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it('id vazio NAO consulta -- a tela ainda nao tem tentativa criada', () => {
    const consultar = jest.fn(() => Promise.resolve(respostaPendente()));

    renderHook(() => usarStatusDaTentativa('', consultar, 5000));

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    expect(consultar).not.toHaveBeenCalled();
  });

  it('para de consultar quando desmonta -- sem vazamento apos a tela sair', async () => {
    const consultar = jest.fn(() => Promise.resolve(respostaPendente()));

    const { unmount } = renderHook(() => usarStatusDaTentativa('tentativa-1', consultar, 5000));

    await waitFor(() => expect(consultar).toHaveBeenCalledTimes(1));

    unmount();

    act(() => {
      jest.advanceTimersByTime(20000);
    });

    expect(consultar).toHaveBeenCalledTimes(1);
  });
});
