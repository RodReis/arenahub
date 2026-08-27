import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtratoDeXp, SessaoDoAluno } from '../lib/kiosk-client.js';
import { Xp } from './xp.js';

vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  carregarXp: vi.fn(),
}));

const { carregarXp } = await import('../lib/kiosk-client');

const SESSAO: SessaoDoAluno = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  token: 't1',
  nome: 'Marina Duarte',
  plano: { ativo: true, pendenciaEmCentavos: null },
  expiraEm: '2026-08-27T12:01:00.000Z',
};

function dadosComSaldo(saldoDoMes: number): ExtratoDeXp {
  return {
    saldoDoMes,
    mes: '2026-08',
    movimentos: [],
    conquistas: [],
    posicao: null,
  };
}

function dadosCom(
  movimentos: readonly { pontos: number; regra: string; quando: string }[],
): ExtratoDeXp {
  return { ...dadosComSaldo(10), movimentos };
}

function dadosComConquistaRevertida(titulo: string, motivo: string): ExtratoDeXp {
  return {
    ...dadosComSaldo(0),
    conquistas: [{ titulo, desbloqueadaEm: '2026-08-05T10:00:00.000Z', revertida: true, motivo }],
  };
}

beforeEach(() => {
  vi.mocked(carregarXp).mockReset().mockResolvedValue(dadosComSaldo(0));
});

describe('<Xp />', () => {
  it('mostra o saldo do mes', async () => {
    vi.mocked(carregarXp).mockResolvedValue(dadosComSaldo(120));

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('saldo-de-xp')).toHaveTextContent('120');
  });

  /*
   * `M5-FR-004` e §13 do PRD: "sempre mostrar por que o aluno recebeu XP".
   * Saldo sem procedencia e numero magico.
   */
  it('explica de onde veio cada ponto', async () => {
    vi.mocked(carregarXp).mockResolvedValue(
      dadosCom([{ pontos: 10, regra: 'Treino do dia', quando: '2026-08-10T12:00:00.000Z' }]),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByText(/Treino do dia/u)).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
  });

  it('mostra conquista revertida sem apagar o desbloqueio', async () => {
    vi.mocked(carregarXp).mockResolvedValue(
      dadosComConquistaRevertida('10 treinos', 'passagem corrigida'),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByText('10 treinos')).toBeInTheDocument();
    expect(screen.getByText(/passagem corrigida/u)).toBeInTheDocument();
  });

  /*
   * `M5-BR-010`: XP nao tem valor financeiro e nao se transfere. Palavra de
   * dinheiro na tela sugere o contrario.
   */
  it('nao usa linguagem financeira', async () => {
    vi.mocked(carregarXp).mockResolvedValue(dadosComSaldo(120));

    const { container } = render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    await screen.findByTestId('saldo-de-xp');

    expect(container.textContent).not.toMatch(/R\$|saldo em conta|resgatar|trocar por/iu);
  });

  it('sem posicao no placar, nao promete lugar nenhum', async () => {
    vi.mocked(carregarXp).mockResolvedValue({ ...dadosComSaldo(10), posicao: null });

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    await screen.findByTestId('saldo-de-xp');

    expect(screen.queryByText(/lugar/iu)).not.toBeInTheDocument();
  });

  it('com posicao no placar, mostra o lugar', async () => {
    vi.mocked(carregarXp).mockResolvedValue({ ...dadosComSaldo(10), posicao: 3 });

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('posicao-no-placar')).toHaveTextContent(/3º lugar/u);
  });

  it('explica quando a rede falhou, sem travar a tela', async () => {
    vi.mocked(carregarXp).mockResolvedValue(null);

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('xp-falhou')).toBeInTheDocument();
  });
});
