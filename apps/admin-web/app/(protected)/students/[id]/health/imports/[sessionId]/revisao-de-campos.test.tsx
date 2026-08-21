import { render as renderSemProvider, screen, type RenderResult } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { ToastProvider } from '@arenahub/ui';

import { AchadoDoEcg } from './achado-do-ecg';
import { RevisaoDeCampos, type LinhaDeRevisao } from './revisao-de-campos';
import { atributosDoAparelho, cartoesDeArquivo, type ArquivoDaSessao, type SessaoDeRevisao } from './sessao';

/**
 * Testes da revisão multiarquivo -- rebuild multiarquivo.
 *
 * As Server Actions chamam `chamarApi`, que é `server-only` e falaria com a
 * API de verdade; aqui elas nunca disparam (nenhum teste submete o
 * formulário), então o mock só existe para o módulo carregar em `jsdom`.
 */
vi.mock('../../../../../../actions/assessment-imports', () => ({
  confirmarSessao: vi.fn(),
  revisarCampo: vi.fn(),
  descartarSessao: vi.fn(),
}));

/**
 * `RevisaoDeCampos` chama `useToastDeErro`, que exige `<ToastProvider>` --
 * na tela real ele vem do layout (`app/(protected)/layout.tsx`); aqui cada
 * teste precisa do mesmo ancestral para o componente montar.
 */
function render(ui: ReactElement): RenderResult {
  return renderSemProvider(<ToastProvider>{ui}</ToastProvider>);
}

const linhaConcordante: LinhaDeRevisao = {
  type: 'WEIGHT',
  concordante: true,
  origens: ['Balança', 'App de análise'],
  campos: [
    {
      id: 'campo-1',
      type: 'WEIGHT',
      extractedValue: 82.4,
      extractedUnit: 'KG',
      confidence: 0.92,
      referenceMin: 60.6,
      referenceMax: 82,
      sourceLabel: 'Balança',
      state: 'CONFIRMED',
      leitura: 'ABOVE',
      importId: 'import-1',
    },
  ],
};

const linhaDivergente: LinhaDeRevisao = {
  type: 'BODY_FAT_PERCENT',
  concordante: false,
  origens: ['Balança', 'App de análise'],
  campos: [
    {
      id: 'campo-2a',
      type: 'BODY_FAT_PERCENT',
      extractedValue: 18.2,
      extractedUnit: 'PERCENT',
      confidence: 0.7,
      referenceMin: 10,
      referenceMax: 20,
      sourceLabel: 'Balança',
      state: 'PENDING',
      leitura: 'WITHIN',
      importId: 'import-1',
    },
    {
      id: 'campo-2b',
      type: 'BODY_FAT_PERCENT',
      extractedValue: 19.5,
      extractedUnit: 'PERCENT',
      confidence: 0.4,
      referenceMin: 10,
      referenceMax: 20,
      sourceLabel: 'App de análise',
      state: 'PENDING',
      leitura: 'WITHIN',
      importId: 'import-2',
    },
  ],
};

const linhaSemValor: LinhaDeRevisao = {
  type: 'VISCERAL_FAT_LEVEL',
  concordante: true,
  origens: ['Balança'],
  campos: [
    {
      id: 'campo-3',
      type: 'VISCERAL_FAT_LEVEL',
      extractedValue: null,
      extractedUnit: null,
      confidence: null,
      referenceMin: null,
      referenceMax: null,
      sourceLabel: 'Balança',
      state: 'CONFIRMED',
      leitura: 'UNKNOWN',
      importId: 'import-1',
    },
  ],
};

describe('revisao de campos', () => {
  it('mostra campo concordante numa linha so, com as duas origens', () => {
    render(<RevisaoDeCampos linhas={[linhaConcordante]} />);

    expect(screen.getAllByRole('row')).toHaveLength(2); // cabecalho + 1
    expect(screen.getByText(/2 arquivos/i)).toBeInTheDocument();
  });

  it('mostra divergencia como duas linhas, SEM pre-selecao', () => {
    render(<RevisaoDeCampos linhas={[linhaDivergente]} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it('desabilita confirmar enquanto houver divergencia aberta', () => {
    render(
      <RevisaoDeCampos
        linhas={[linhaDivergente]}
        podeConfirmar={{ pronta: false, motivo: 'DIVERGENCE_UNRESOLVED' }}
      />,
    );

    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
    expect(screen.getByText(/escolha qual valor vale/i)).toBeInTheDocument();
  });

  it('mostra valor ausente como travessao, nunca como zero', () => {
    render(<RevisaoDeCampos linhas={[linhaSemValor]} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('mostra a faixa de referencia da linha concordante', () => {
    render(<RevisaoDeCampos linhas={[linhaConcordante]} />);

    // 60,6 a 82,0 kg -- referenceMin/referenceMax do campo.
    expect(screen.getByText(/60,6/)).toBeInTheDocument();
  });

  it('mostra travessao quando a linha nao tem faixa de referencia publicada', () => {
    render(<RevisaoDeCampos linhas={[linhaSemValor]} />);

    // Duas celulas com travessao nesta linha: valor extraido E faixa.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('mostra o badge de leitura para cada linha', () => {
    render(<RevisaoDeCampos linhas={[linhaConcordante]} />);

    expect(screen.getByText(/acima da faixa/i)).toBeInTheDocument();
  });

  it('conta quantos campos ainda exigem conferencia', () => {
    render(<RevisaoDeCampos linhas={[linhaConcordante, linhaDivergente]} />);

    // linhaConcordante = CONFIRMED (0 pendente); linhaDivergente = 2 PENDING.
    expect(screen.getByTestId('contador-pendentes')).toHaveTextContent('2 de 3 campos exigem');
  });
});

describe('achado do ECG', () => {
  it('exibe o achado do ECG como texto do aparelho, sem acao', () => {
    render(<AchadoDoEcg ecgFinding="Ritmo nao classificado" />);

    expect(screen.getByText(/ritmo nao classificado/i)).toBeInTheDocument();
    expect(screen.getByText(/não constitui diagnóstico/i)).toBeInTheDocument();
    // ADR-035 e decisao 2 do PI: nada de encaminhamento nesta tela, NENHUM botao.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/encaminhamento/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exige leitura m[eé]dica/i)).not.toBeInTheDocument();
  });

  it('mostra ausencia quando nenhum arquivo trouxe achado', () => {
    render(<AchadoDoEcg />);

    expect(screen.getByTestId('achado-ecg-ausente')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('atributosDoAparelho', () => {
  /**
   * Regressao do fix round 1: `sourceLabel` ("ECG 30s") e o achado
   * ("Ritmo nao classificado — fibrilacao atrial suspeita") sao coisas
   * DIFERENTES de proposito neste fixture. A versao com bug lia
   * `campo.sourceLabel` como se fosse o achado -- um profissional veria o
   * NOME DO APARELHO onde esperava o resultado clinico. Se alguem reintroduz
   * aquela substituicao, este teste falha porque o texto batido vira o
   * rotulo do arquivo, nao o achado.
   */
  it('le o achado do ECG do atributo do arquivo, nao do sourceLabel', () => {
    const sessao: SessaoDeRevisao = {
      sessionId: 'sessao-1',
      podeConfirmar: { pronta: true },
      linhas: [],
      arquivos: [
        {
          importId: 'import-bio',
          sourceLabel: 'CF610_G',
          tipoDeLaudo: 'BIOIMPEDANCE',
          atributos: null,
        },
        {
          importId: 'import-ecg',
          sourceLabel: 'ECG 30s',
          tipoDeLaudo: 'ECG',
          atributos: { ecgFinding: 'Ritmo nao classificado — fibrilacao atrial suspeita' },
        },
      ],
    };

    expect(atributosDoAparelho(sessao)).toEqual({
      ecgFinding: 'Ritmo nao classificado — fibrilacao atrial suspeita',
    });
  });

  it('nao ha achado quando nenhum arquivo trouxe atributo', () => {
    const sessao: SessaoDeRevisao = {
      sessionId: 'sessao-2',
      podeConfirmar: { pronta: true },
      linhas: [],
      arquivos: [
        { importId: 'import-bio', sourceLabel: 'CF610_G', tipoDeLaudo: 'BIOIMPEDANCE', atributos: null },
      ],
    };

    expect(atributosDoAparelho(sessao)).toEqual({});
  });
});

describe('cartoesDeArquivo', () => {
  const arquivos: ArquivoDaSessao[] = [
    { importId: 'import-1', sourceLabel: 'Balança', tipoDeLaudo: 'BIOIMPEDANCE', atributos: null },
    { importId: 'import-2', sourceLabel: 'ECG 30s', tipoDeLaudo: 'ECG', atributos: null },
  ];

  it('conta os campos e a confianca media de cada arquivo', () => {
    const cartoes = cartoesDeArquivo(arquivos, [linhaConcordante]);

    const cartaoDaBalanca = cartoes.find((c) => c.importId === 'import-1');
    expect(cartaoDaBalanca?.totalDeCampos).toBe(1);
    expect(cartaoDaBalanca?.confidenceMedia).toBeCloseTo(0.92);
    expect(cartaoDaBalanca?.estado).toBe('EXTRACTED');
  });

  it('marca arquivo como PENDING_REVIEW enquanto algum campo estiver PENDING', () => {
    const cartoes = cartoesDeArquivo(arquivos, [linhaDivergente]);

    const cartaoDaBalanca = cartoes.find((c) => c.importId === 'import-1');
    expect(cartaoDaBalanca?.estado).toBe('PENDING_REVIEW');
  });

  it('arquivo sem campo atribuido fica com zero campos, nunca undefined', () => {
    const cartoes = cartoesDeArquivo(arquivos, []);

    expect(cartoes.every((c) => c.totalDeCampos === 0)).toBe(true);
    expect(cartoes.every((c) => c.confidenceMedia === null)).toBe(true);
  });
});
