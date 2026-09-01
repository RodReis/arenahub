import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Server Action fala com `chamarApi`, que é `server-only`. Nenhum teste
 * aqui completa uma chamada de verdade — mesmo padrão de
 * `painel-de-desafios.test.tsx`.
 */
vi.mock('../../actions/dashboard', () => ({
  lerFeedDeAcessos: vi.fn(),
}));

import { lerFeedDeAcessos, type EventoDoFeed } from '../../actions/dashboard';
import { FeedAoVivo } from './feed-ao-vivo';

const evento = (id: string, nome: string): EventoDoFeed => ({
  id,
  occurredAt: '2026-09-01T14:32:08.000Z',
  outcome: 'ALLOW',
  reason: 'ACESSO_LIBERADO',
  method: 'FACIAL',
  student: { fullName: nome },
  externalUserId: null,
});

/**
 * Troca o estado de visibilidade da aba e dispara o evento do navegador.
 *
 * Dentro de `act` porque o listener chama `setPausado`: fora dele o React não
 * reprocessa, e o teste leria o rótulo do render anterior — falso vermelho
 * que aponta para o componente quando o defeito é do teste.
 */
function mudarVisibilidade(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => estado,
  });

  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('FeedAoVivo — F57 bloco 3', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mudarVisibilidade('visible');
    vi.mocked(lerFeedDeAcessos).mockResolvedValue({ eventos: [evento('e-2', 'Marina Lopes')] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('nasce com a lista que veio do servidor, sem esperar o primeiro ciclo', () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[evento('e-1', 'Rodrigo Ramires')]}
      />,
    );

    expect(screen.getByText(/Rodrigo Ramires/)).toBeInTheDocument();
    expect(lerFeedDeAcessos).not.toHaveBeenCalled();
  });

  it('recarrega a cada 5 s e substitui a lista', async () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[evento('e-1', 'Rodrigo Ramires')]}
      />,
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await waitFor(() => expect(screen.getByText(/Marina Lopes/)).toBeInTheDocument());
    expect(screen.queryByText(/Rodrigo Ramires/)).not.toBeInTheDocument();
  });

  /*
   * AC-3, e a razão de o teste existir: um painel esquecido aberto num turno
   * de 12 h faz ~8.600 requisições sozinho, contra a MESMA API que atende a
   * catraca. O teste avança DEZ ciclos com a aba oculta — se a pausa sumir,
   * ele conta dez chamadas onde deveria contar zero.
   */
  it('PARA de recarregar com a aba oculta', async () => {
    render(<FeedAoVivo gymUnitId="u-1" timeZone="America/Sao_Paulo" inicial={[]} />);

    mudarVisibilidade('hidden');

    await vi.advanceTimersByTimeAsync(50_000);

    expect(lerFeedDeAcessos).not.toHaveBeenCalled();
    expect(screen.getByTestId('estado-do-feed')).toHaveTextContent('pausado');
  });

  it('volta a recarregar ao reexibir a aba, com leitura IMEDIATA', async () => {
    render(<FeedAoVivo gymUnitId="u-1" timeZone="America/Sao_Paulo" inicial={[]} />);

    mudarVisibilidade('hidden');
    await vi.advanceTimersByTimeAsync(50_000);
    expect(lerFeedDeAcessos).not.toHaveBeenCalled();

    mudarVisibilidade('visible');

    // Sem avançar o relógio: a leitura da volta é imediata, senão a tela
    // mostraria por até 5 s o estado de quando foi escondida.
    await waitFor(() => expect(lerFeedDeAcessos).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('estado-do-feed')).toHaveTextContent('ao vivo');
  });

  /*
   * Falha de rede mantém a lista anterior. Zerar o feed porque uma leitura
   * falhou diria "ninguém passou na catraca", que é o oposto do que houve.
   */
  it('erro de leitura NÃO apaga o que já estava na tela', async () => {
    vi.mocked(lerFeedDeAcessos).mockResolvedValue({ eventos: [], erro: 'falhou' });

    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[evento('e-1', 'Rodrigo Ramires')]}
      />,
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(lerFeedDeAcessos).toHaveBeenCalled());

    expect(screen.getByText(/Rodrigo Ramires/)).toBeInTheDocument();
  });

  it('para o ciclo ao desmontar — aba fechada não continua consultando', async () => {
    const { unmount } = render(
      <FeedAoVivo gymUnitId="u-1" timeZone="America/Sao_Paulo" inicial={[]} />,
    );

    unmount();

    await vi.advanceTimersByTimeAsync(50_000);

    expect(lerFeedDeAcessos).not.toHaveBeenCalled();
  });
});
