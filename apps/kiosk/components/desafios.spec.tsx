import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesafioDoTotem, DesafiosDoTotem, SessaoDoAluno } from '../lib/kiosk-client.js';
import { Desafios } from './desafios.js';

vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  carregarDesafios: vi.fn(),
  entrarNoDesafio: vi.fn(),
  sairDoDesafio: vi.fn(),
  marcarAvisosComoLidos: vi.fn(),
}));

const { carregarDesafios, entrarNoDesafio, sairDoDesafio, marcarAvisosComoLidos } = await import(
  '../lib/kiosk-client'
);

const SESSAO: SessaoDoAluno = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  token: 't1',
  nome: 'Marina Duarte',
  plano: { ativo: true, pendenciaEmCentavos: null },
  expiraEm: '2026-08-27T12:01:00.000Z',
};

const DESAFIO: DesafioDoTotem = {
  id: 'c-1',
  title: 'Setembro em dia',
  meta: 8,
  progresso: 0,
  inscrito: false,
  startsOn: '2026-09-01',
  endsOn: '2026-09-14',
};

function comDados(dados: Partial<DesafiosDoTotem>): void {
  vi.mocked(carregarDesafios).mockResolvedValue({
    desafios: [],
    avisos: [],
    ...dados,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(entrarNoDesafio).mockResolvedValue({ ok: true });
  vi.mocked(sairDoDesafio).mockResolvedValue({ ok: true });
  vi.mocked(marcarAvisosComoLidos).mockResolvedValue({ ok: true });
});

function renderizar() {
  return render(<Desafios sessao={SESSAO} aoVoltar={() => undefined} />);
}

describe('Desafios no totem', () => {
  /**
   * OPT-IN (`M5-BR-001`, ADR-048 Decisao 2).
   *
   * O botao diz "Participar", nao "Sair" -- e o oposto da tela de
   * preferencias, onde o interruptor de ranking NASCE LIGADO. Este teste e o
   * canario contra alguem alinhar as duas telas pelo regime errado.
   */
  it('quem nao aderiu ve "Participar", nunca um estado ja inscrito', async () => {
    comDados({ desafios: [DESAFIO] });
    renderizar();

    expect(await screen.findByTestId('alternar-c-1')).toHaveTextContent('Participar');
    expect(screen.queryByText(/sair do desafio/i)).not.toBeInTheDocument();
  });

  /**
   * Quem nao entrou ve a META, nao "0 de 8": progresso zerado sugeriria que
   * ele ja participa e esta indo mal.
   */
  it('mostra a meta, nao progresso zerado, para quem nao aderiu', async () => {
    comDados({ desafios: [DESAFIO] });
    renderizar();

    expect(await screen.findByTestId('meta-c-1')).toHaveTextContent('Meta: 8 treinos');
    expect(screen.queryByTestId('progresso-c-1')).not.toBeInTheDocument();
  });

  it('mostra o progresso de quem aderiu', async () => {
    comDados({ desafios: [{ ...DESAFIO, inscrito: true, progresso: 3 }] });
    renderizar();

    expect(await screen.findByTestId('progresso-c-1')).toHaveTextContent('Faltam 5 treino(s)');
    expect(screen.getByTestId('alternar-c-1')).toHaveTextContent('Sair do desafio');
  });

  it('anuncia meta batida quando o progresso alcanca a meta', async () => {
    comDados({ desafios: [{ ...DESAFIO, inscrito: true, progresso: 8 }] });
    renderizar();

    expect(await screen.findByTestId('progresso-c-1')).toHaveTextContent('Meta batida!');
  });

  it('inscreve ao tocar em Participar e recarrega a lista', async () => {
    const usuario = userEvent.setup();
    comDados({ desafios: [DESAFIO] });
    renderizar();

    await usuario.click(await screen.findByTestId('alternar-c-1'));

    expect(entrarNoDesafio).toHaveBeenCalledWith(SESSAO.sessionId, SESSAO.token, 'c-1');
    // Recarrega em vez de adivinhar o progresso localmente.
    await waitFor(() => {
      expect(carregarDesafios).toHaveBeenCalledTimes(2);
    });
  });

  it('sai do desafio ao tocar em Sair', async () => {
    const usuario = userEvent.setup();
    comDados({ desafios: [{ ...DESAFIO, inscrito: true, progresso: 2 }] });
    renderizar();

    await usuario.click(await screen.findByTestId('alternar-c-1'));

    expect(sairDoDesafio).toHaveBeenCalledWith(SESSAO.sessionId, SESSAO.token, 'c-1');
    expect(entrarNoDesafio).not.toHaveBeenCalled();
  });

  it('mostra estado vazio quando nao ha desafio aberto', async () => {
    comDados({ desafios: [] });
    renderizar();

    expect(await screen.findByTestId('sem-desafios')).toBeInTheDocument();
  });

  it('mostra falha sem prometer dado que nao carregou', async () => {
    vi.mocked(carregarDesafios).mockResolvedValue(null);
    renderizar();

    expect(await screen.findByTestId('desafios-falhou')).toBeInTheDocument();
    expect(screen.queryByTestId('sem-desafios')).not.toBeInTheDocument();
  });

  it('exibe os avisos do aluno', async () => {
    comDados({
      avisos: [
        { id: 'n-1', challengeTitle: 'Agosto forte', kind: 'CONCLUIDO', lido: false },
        { id: 'n-2', challengeTitle: 'Julho', kind: 'ENCERRADO_SEM_META', lido: true },
      ],
    });
    renderizar();

    expect(await screen.findByText(/concluiu o desafio Agosto forte/i)).toBeInTheDocument();
    expect(screen.getByText(/Julho terminou/i)).toBeInTheDocument();
  });

  it('marca so os avisos NAO lidos, e uma vez so', async () => {
    comDados({
      avisos: [
        { id: 'n-1', challengeTitle: 'Agosto forte', kind: 'CONCLUIDO', lido: false },
        { id: 'n-2', challengeTitle: 'Julho', kind: 'ENCERRADO_SEM_META', lido: true },
      ],
    });
    renderizar();

    await waitFor(() => {
      expect(marcarAvisosComoLidos).toHaveBeenCalledWith(SESSAO.sessionId, SESSAO.token, ['n-1']);
    });

    // Sem a trava do `useRef`, um re-render dispararia o POST de novo.
    expect(marcarAvisosComoLidos).toHaveBeenCalledTimes(1);
  });

  it('nao chama a marcacao quando todos os avisos ja foram lidos', async () => {
    comDados({
      avisos: [{ id: 'n-1', challengeTitle: 'Agosto forte', kind: 'CONCLUIDO', lido: true }],
    });
    renderizar();

    expect(await screen.findByText(/concluiu o desafio/i)).toBeInTheDocument();
    expect(marcarAvisosComoLidos).not.toHaveBeenCalled();
  });
});
