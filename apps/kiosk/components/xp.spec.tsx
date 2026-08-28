import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConsistenciaDoTotem,
  ExtratoDeXp,
  SemanaDeConsistencia,
  SessaoDoAluno,
} from '../lib/kiosk-client.js';
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

/** Consistencia neutra -- o teste que se importa com ela sobrescreve. */
const SEM_CONSISTENCIA: ConsistenciaDoTotem = {
  atual: 0,
  recorde: 0,
  diasPorSemana: 3,
  politica: 'semana-civil-local@1',
  semanas: [],
};

function dadosComSaldo(saldoDoMes: number): ExtratoDeXp {
  return {
    saldoDoMes,
    mes: '2026-08',
    movimentos: [],
    conquistas: [],
    posicao: null,
    consistencia: SEM_CONSISTENCIA,
  };
}

function dadosComConsistencia(consistencia: Partial<ConsistenciaDoTotem>): ExtratoDeXp {
  return {
    ...dadosComSaldo(0),
    consistencia: { ...SEM_CONSISTENCIA, ...consistencia },
  };
}

function semana(
  inicio: string,
  fim: string,
  diasTreinados: number,
  status: SemanaDeConsistencia['status'],
): SemanaDeConsistencia {
  return { inicio, fim, diasTreinados, status };
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

describe('Xp -- consistencia semanal (F32)', () => {
  beforeEach(() => {
    vi.mocked(carregarXp).mockReset();
  });

  it('mostra o streak atual e a meta da politica', async () => {
    vi.mocked(carregarXp).mockResolvedValue(
      dadosComConsistencia({ atual: 4, recorde: 4, diasPorSemana: 3 }),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('streak-atual')).toHaveTextContent('4');
    expect(screen.getByTestId('consistencia')).toHaveTextContent(/3 dias por semana/u);
  });

  it('le a meta do SERVIDOR, nao de uma constante da tela', async () => {
    // A politica e versionada: se a academia mudar a meta para 4, a tela tem
    // de acompanhar sem deploy. Um numero fixo aqui mentiria nesse dia.
    vi.mocked(carregarXp).mockResolvedValue(dadosComConsistencia({ diasPorSemana: 4 }));

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('consistencia')).toHaveTextContent(/4 dias por semana/u);
  });

  it('esconde o recorde quando ele e igual ao atual', async () => {
    vi.mocked(carregarXp).mockResolvedValue(dadosComConsistencia({ atual: 3, recorde: 3 }));

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    await screen.findByTestId('consistencia');

    expect(screen.queryByTestId('streak-recorde')).not.toBeInTheDocument();
  });

  it('mostra o recorde quando ele supera o atual', async () => {
    vi.mocked(carregarXp).mockResolvedValue(dadosComConsistencia({ atual: 1, recorde: 6 }));

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('streak-recorde')).toHaveTextContent('6');
  });

  it('lista as semanas com o intervalo em dia/mes', async () => {
    vi.mocked(carregarXp).mockResolvedValue(
      dadosComConsistencia({
        semanas: [semana('2026-08-24', '2026-08-30', 3, 'QUALIFICADA')],
      }),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('semana')).toHaveTextContent('24/08 a 30/08');
  });

  it('nao desloca a data por fuso do navegador', async () => {
    // O intervalo e recorte de texto, nao `new Date()`. Se passasse por Date,
    // um navegador a oeste de UTC mostraria 23/08 no lugar de 24/08 -- o
    // mesmo erro de fuso duplo que o backend evita nao aceitando `Date`.
    vi.mocked(carregarXp).mockResolvedValue(
      dadosComConsistencia({ semanas: [semana('2026-01-01', '2026-01-04', 1, 'PERDIDA')] }),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('semana')).toHaveTextContent('01/01 a 04/01');
  });

  it('diz que a semana pausada NAO conta contra o aluno -- `M5-FR-009`', async () => {
    vi.mocked(carregarXp).mockResolvedValue(
      dadosComConsistencia({ semanas: [semana('2026-08-24', '2026-08-30', 0, 'PAUSADA')] }),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('semana')).toHaveTextContent(/não conta contra você/u);
  });

  it('NAO usa linguagem de culpa na semana abaixo da meta -- §13 do PRD', async () => {
    vi.mocked(carregarXp).mockResolvedValue(
      dadosComConsistencia({ semanas: [semana('2026-08-24', '2026-08-30', 1, 'PERDIDA')] }),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    const linha = await screen.findByTestId('semana');

    expect(linha).toHaveTextContent(/Abaixo da meta/u);
    expect(linha.textContent ?? '').not.toMatch(/perdeu|falhou|você não|quebrou/iu);
  });

  it('NAO fala em dias seguidos -- a unidade e a semana (`M5-BR-005`)', async () => {
    // Exibir "dias seguidos" ensinaria a meta errada mesmo com o backend
    // contando semanas: o aluno passaria a treinar todo dia por medo de
    // romper, que e exatamente o que a Slice 5.3 quer evitar.
    vi.mocked(carregarXp).mockResolvedValue(dadosComConsistencia({ atual: 5, recorde: 5 }));

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    const card = await screen.findByTestId('consistencia');

    expect(card.textContent ?? '').not.toMatch(/dias seguidos|dias consecutivos/iu);
    expect(card).toHaveTextContent(/Semanas seguidas/u);
  });

  it('convida quem ainda nao treinou, em vez de mostrar lista vazia', async () => {
    vi.mocked(carregarXp).mockResolvedValue(dadosComConsistencia({ semanas: [] }));

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('sem-semanas')).toBeInTheDocument();
  });

  it('marca cada semana com o proprio status, para o CSS distinguir', async () => {
    vi.mocked(carregarXp).mockResolvedValue(
      dadosComConsistencia({
        semanas: [
          semana('2026-08-24', '2026-08-30', 2, 'EM_ANDAMENTO'),
          semana('2026-08-17', '2026-08-23', 3, 'QUALIFICADA'),
        ],
      }),
    );

    render(<Xp sessao={SESSAO} aoVoltar={vi.fn()} />);

    const linhas = await screen.findAllByTestId('semana');

    expect(linhas[0]).toHaveAttribute('data-status', 'EM_ANDAMENTO');
    expect(linhas[1]).toHaveAttribute('data-status', 'QUALIFICADA');
  });
});
