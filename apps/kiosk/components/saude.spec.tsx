import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvaliacaoDoTotem, SessaoDoAluno } from '../lib/kiosk-client.js';
import { AvaliacaoDoMes, Evolucao, HistoricoDeAvaliacoes } from './saude.js';

vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  carregarAvaliacao: vi.fn(),
  carregarAvaliacoes: vi.fn(),
  carregarEvolucao: vi.fn(),
}));

const { carregarAvaliacao, carregarAvaliacoes, carregarEvolucao } = await import(
  '../lib/kiosk-client'
);

const SESSAO: SessaoDoAluno = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  token: 't1',
  nome: 'Marina Duarte',
  plano: { ativo: true, pendenciaEmCentavos: null },
  expiraEm: '2026-08-26T12:01:00.000Z',
};

const AVALIACAO: AvaliacaoDoTotem = {
  medidaEm: '2026-08-03T10:00:00.000Z',
  aparelho: 'CF610_G',
  metricas: [
    { tipo: 'WEIGHT', valor: 82.4, unidade: 'KG', deltaAbsoluto: -2.4, razaoDaAusencia: null },
    {
      tipo: 'BODY_FAT_PERCENT',
      valor: null,
      unidade: 'PERCENT',
      deltaAbsoluto: null,
      razaoDaAusencia: null,
    },
  ],
  segmentos: [
    { segmento: 'ARMS', gorduraKg: 1.3, musculoKg: 3.8 },
    { segmento: 'TRUNK', gorduraKg: 11.6, musculoKg: 30.8 },
    { segmento: 'LEGS', gorduraKg: null, musculoKg: null },
  ],
  relatorioDoAparelho: null,
};

beforeEach(() => {
  vi.mocked(carregarAvaliacao).mockReset().mockResolvedValue(AVALIACAO);
  vi.mocked(carregarAvaliacoes).mockReset().mockResolvedValue([]);
  vi.mocked(carregarEvolucao)
    .mockReset()
    .mockResolvedValue({ months: [], latestAnalysis: null });
});

describe('AvaliacaoDoMes', () => {
  it('diz de onde veio o número — origem sempre atribuída', async () => {
    // `M3-NFR-006`: numero sem origem nao pode ser conferido pelo aluno nem
    // contestado pelo avaliador.
    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('origem-da-medicao')).toHaveTextContent('CF610_G');
    expect(screen.getByTestId('origem-da-medicao')).toHaveTextContent(/somente leitura/i);
  });

  it('sempre exibe o aviso de não-diagnóstico, sem botão de fechar', async () => {
    // Regra de arquitetura no 8. Um aviso que se fecha e um aviso que nao
    // existe a partir do segundo uso.
    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    const aviso = await screen.findByTestId('aviso-nao-diagnostico');

    expect(aviso).toHaveTextContent(/não é diagnóstico médico/i);
    expect(aviso.querySelector('button')).toBeNull();
  });

  it('mostra traço para métrica não medida, nunca zero', async () => {
    // INV-104: zero e uma medicao, ausencia e a falta dela.
    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('metrica-BODY_FAT_PERCENT')).toHaveTextContent('—');
  });

  it('mostra o delta com sinal explícito', async () => {
    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('metrica-WEIGHT')).toHaveTextContent('−2,4 kg');
  });

  it('desenha as três linhas de segmento, com ausência como traço', async () => {
    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('segmento-ARMS')).toHaveTextContent('Braços');
    expect(screen.getByTestId('segmento-LEGS')).toHaveTextContent('—');
  });

  it('exibe pontuação e achado do aparelho sem interpretar', async () => {
    // ADR-035 / RDC 657: exibir isenta, interpretar enquadra como
    // dispositivo medico. O texto sai como o aparelho escreveu, atribuido.
    vi.mocked(carregarAvaliacao).mockResolvedValue({
      ...AVALIACAO,
      relatorioDoAparelho: { score: 80, bodyType: 'Condição boa', ecgFinding: 'Ritmo sinusal' },
    });

    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('pontuacao')).toHaveTextContent('80 pontos');
    expect(screen.getByTestId('achado-do-aparelho')).toHaveTextContent('Ritmo sinusal');
    expect(screen.getByText(/reportados pelo aparelho/i)).toBeInTheDocument();
  });

  it('não desenha o bloco do aparelho quando ele não reportou nada', async () => {
    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    await screen.findByTestId('grade-de-metricas');
    expect(screen.queryByTestId('relatorio-do-aparelho')).not.toBeInTheDocument();
  });

  it('explica quando o aluno ainda não tem avaliação', async () => {
    vi.mocked(carregarAvaliacao).mockResolvedValue('sem-avaliacao');

    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('sem-avaliacao')).toBeInTheDocument();
  });

  it('NÃO diz "você não tem avaliação" quando foi a rede que caiu', async () => {
    // O bug que este teste fecha: com os dois casos colapsados em `null`, um
    // aluno que TEM avaliacao lia "voce ainda nao tem avaliacao registrada"
    // toda vez que a rede da academia oscilasse -- e ia reclamar na recepcao
    // de um dado que existe.
    vi.mocked(carregarAvaliacao).mockResolvedValue(null);

    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('saude-falhou')).toBeInTheDocument();
    expect(screen.queryByTestId('sem-avaliacao')).not.toBeInTheDocument();
  });

  it('reserva a moldura do bloco de composição com o selo do mês', async () => {
    render(<AvaliacaoDoMes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('bloco-de-composicao')).toHaveTextContent('COMPOSIÇÃO DE AGOSTO');
  });
});

describe('Evolucao', () => {
  it('explica quando não há medições suficientes', async () => {
    render(<Evolucao sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('sem-evolucao')).toBeInTheDocument();
  });

  it('exibe o aviso da IA quando há análise', async () => {
    // Regra de arquitetura no 8: toda saida de IA carrega o disclaimer.
    vi.mocked(carregarEvolucao).mockResolvedValue({
      months: [
        {
          assessedAtLocal: '2026-08-03T10:00:00.000Z',
          metrics: [{ type: 'WEIGHT', value: 82.4, unit: 'KG' }],
        },
      ],
      latestAnalysis: {
        positivePoints: ['Massa muscular subiu'],
        attentionPoints: ['Hidratação abaixo do usual'],
        disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS',
      },
    });

    render(<Evolucao sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('disclaimer-da-ia')).toHaveTextContent(
      /não é diagnóstico médico/i,
    );
    expect(screen.getByText('Massa muscular subiu')).toBeInTheDocument();
  });
});

describe('HistoricoDeAvaliacoes', () => {
  it('explica quando não há avaliação nenhuma', async () => {
    render(<HistoricoDeAvaliacoes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('sem-avaliacoes')).toBeInTheDocument();
  });

  it('lista uma linha por mês medido', async () => {
    vi.mocked(carregarAvaliacoes).mockResolvedValue([
      {
        assessmentId: 'a1',
        medidaEm: '2026-08-03T10:00:00.000Z',
        metricas: [
          { tipo: 'WEIGHT', valor: 82.4, unidade: 'KG', deltaAbsoluto: null, razaoDaAusencia: null },
        ],
      },
    ]);

    render(<HistoricoDeAvaliacoes sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByTestId('lista-de-avaliacoes')).toHaveTextContent('AGOSTO');
    expect(screen.getByTestId('lista-de-avaliacoes')).toHaveTextContent('82,4 kg');
  });
});
