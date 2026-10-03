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
  student: { id: `aluno-${id}`, fullName: nome },
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
    // 8 min depois dos eventos da fixture: dentro da janela de permanência.
    vi.setSystemTime(new Date('2026-09-01T14:40:00.000Z'));
    mudarVisibilidade('visible');
    vi.mocked(lerFeedDeAcessos).mockResolvedValue({
      eventos: [evento('e-2', 'Marina Lopes')],
    });
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
    vi.mocked(lerFeedDeAcessos).mockResolvedValue({
      eventos: [],
      erro: 'falhou',
    });

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

  /** Pedido do PI, 02/10/2026: o DIA inteiro, não as últimas 24 h. */
  it('pede o feed desde o início do dia da unidade', async () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[]}
        desde="2026-10-02T03:00:00.000Z"
      />,
    );

    await vi.advanceTimersByTimeAsync(5_000);

    expect(lerFeedDeAcessos).toHaveBeenCalledWith('u-1', '2026-10-02T03:00:00.000Z');
  });

  /** Pedido do PI, 02/10/2026: quem a catraca barrou hoje, no cartão de bloqueados. */
  it('mostra no cartão de bloqueados quem a catraca recusou hoje', () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        situacoes={[]}
        inicial={[
          evento('e-1', 'Nanci Santana'),
          {
            ...evento('e-2', 'Joao Pedro Ramalho'),
            outcome: 'DENY',
            reason: 'NO_ENTITLEMENT',
          },
        ]}
      />,
    );

    const recusados = screen.getByTestId('recusados-de-hoje');
    expect(recusados).toHaveTextContent('Joao Pedro');
    expect(recusados).not.toHaveTextContent('Nanci');
    expect(screen.getByTestId('contagem-de-recusados')).toHaveTextContent('1 recusado hoje');
  });

  /** Pedido do PI, 03/10/2026: saída é giro livre, então a lista mostra só quem entrou há até 90 min. */
  it('a lista só mostra quem passou nos últimos 90 min', () => {
    const antigo: EventoDoFeed = {
      ...evento('e-0', 'Entrou Cedo'),
      occurredAt: '2026-09-01T13:00:00.000Z',
    };

    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[evento('e-1', 'Rodrigo Ramires'), antigo]}
      />,
    );

    expect(screen.getByText(/Rodrigo Ramires/)).toBeInTheDocument();
    expect(screen.queryByText(/Entrou Cedo/)).not.toBeInTheDocument();
    expect(screen.getByTestId('janela-do-feed')).toHaveTextContent('últimos 90 min');
  });

  it('a linha sai da lista quando o relógio passa da janela, sem evento novo', async () => {
    vi.mocked(lerFeedDeAcessos).mockResolvedValue({ eventos: [evento('e-1', 'Rodrigo Ramires')] });

    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[evento('e-1', 'Rodrigo Ramires')]}
      />,
    );
    expect(screen.getByText(/Rodrigo Ramires/)).toBeInTheDocument();

    // 14:32:08 + 90 min = 16:02:08. Pula o relógio para 16:05 e roda UM ciclo:
    // avançar 85 min em ciclos de 5 s estourava o limite do teste no CI.
    vi.setSystemTime(new Date('2026-09-01T16:05:00.000Z'));
    await vi.advanceTimersByTimeAsync(5_000);

    await waitFor(() => expect(screen.queryByText(/Rodrigo Ramires/)).not.toBeInTheDocument());
    expect(screen.getByText(/Ninguém passou na catraca/)).toBeInTheDocument();
  });

  it('o cartão de recusados continua lendo o dia inteiro, fora da janela', () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        situacoes={[]}
        inicial={[
          {
            ...evento('e-2', 'Joao Pedro Ramalho'),
            outcome: 'DENY',
            reason: 'NO_ENTITLEMENT',
            occurredAt: '2026-09-01T11:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByTestId('recusados-de-hoje')).toHaveTextContent('Joao Pedro');
    expect(screen.queryByTestId('feed-de-acessos')).toBeNull();
  });

  /** Pedido do PI, 03/10/2026: o nome leva à tela de detalhe do aluno. */
  it('o nome do aluno é um link para o detalhe dele', () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[evento('e-1', 'Rodrigo Ramires')]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Rodrigo Ramires' })).toHaveAttribute(
      'href',
      '/students/aluno-e-1',
    );
  });

  it('quem não foi identificado aparece sem link', () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[{ ...evento('e-1', 'x'), student: null, externalUserId: '1558' }]}
      />,
    );

    expect(screen.getByText('1558')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  /** Pedido do PI, 03/10/2026: cartão de pessoa com foto, faixa no tom da razão. */
  it('com foto na ficha, o cartão mostra a foto; sem foto, as iniciais', () => {
    const comFoto: EventoDoFeed = {
      ...evento('e-1', 'Rodrigo Ramires'),
      student: { id: 'aluno-1', fullName: 'Rodrigo Ramires', temFoto: true },
    };

    const { container } = render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[comFoto, evento('e-2', 'Marina Lopes')]}
      />,
    );

    expect(container.querySelector('img')).toHaveAttribute('src', '/fotos-de-aluno/aluno-1');
    expect(screen.getByText('ML')).toBeInTheDocument();
  });

  it('o cartão diz a razão por escrito e leva o tom dela', () => {
    render(
      <FeedAoVivo
        gymUnitId="u-1"
        timeZone="America/Sao_Paulo"
        inicial={[{ ...evento('e-1', 'Joao Pedro'), outcome: 'DENY', reason: 'NO_ENTITLEMENT' }]}
      />,
    );

    const cartao = screen.getByText('Sem plano vigente').closest('li');
    expect(cartao).toHaveAttribute('data-tom', 'danger');
    expect(cartao).toHaveTextContent('Tentativa');
  });

  it('sem situacoes, o feed nao desenha o cartão de bloqueados', () => {
    render(<FeedAoVivo gymUnitId="u-1" timeZone="America/Sao_Paulo" inicial={[]} />);

    expect(screen.queryByText('Bloqueados e suspensos')).toBeNull();
  });
});
