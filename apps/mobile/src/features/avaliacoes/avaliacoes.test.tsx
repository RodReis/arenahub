import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Avaliacoes, type DadosDasAvaliacoes } from './avaliacoes.js';

const base: DadosDasAvaliacoes = {
  asOf: '2026-09-12T12:00:00.000Z',
  periodo: '90D',
  series: [
    {
      tipo: 'WEIGHT',
      unidade: 'KG',
      pontos: [
        { avaliacaoId: 'a1', medidaEm: '2026-07-03T10:00:00.000Z', valor: 80.5 },
        { avaliacaoId: 'a2', medidaEm: '2026-08-03T10:00:00.000Z', valor: 78.2 },
      ],
      meta: null,
    },
  ],
  analise: null,
};

const renderizar = (dados: Partial<DadosDasAvaliacoes> = {}) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Avaliacoes
        dados={{ ...base, ...dados }}
        periodo="90D"
        onPeriodo={() => undefined}
        testID="avaliacoes"
      />
    </ProvedorDeTema>,
  );

describe('Avaliacoes', () => {
  it('traduz o tipo de medida para o nome que o aluno entende', () => {
    renderizar();
    expect(screen.getByText('Peso')).toBeTruthy();
  });

  it('a TABELA traz os mesmos numeros do grafico, nao um resumo', () => {
    /*
     * O contrato `ChartWithTableProps` (`packages/ui`) exige tabela
     * EQUIVALENTE, nao um rotulo de acessibilidade no desenho: leitor de tela
     * nao le `Polyline`. Este teste falha se a tabela virar sumario.
     */
    renderizar();

    fireEvent.press(screen.getByTestId('avaliacoes-serie-WEIGHT-alternar'));

    expect(screen.getByTestId('avaliacoes-serie-WEIGHT-tabela')).toBeTruthy();
    expect(screen.getByText('80,5 kg')).toBeTruthy();
    expect(screen.getByText('78,2 kg')).toBeTruthy();
  });

  it('o delta diz a DIRECAO por texto, nao so por cor', () => {
    // Quem nao separa verde de laranja precisa ler o sinal. Cor como unico
    // canal reprova no `M4-NFR-007`.
    renderizar();

    fireEvent.press(screen.getByTestId('avaliacoes-serie-WEIGHT-alternar'));

    expect(screen.getByText('−2,3 kg')).toBeTruthy();
  });

  it('a primeira linha nao inventa comparacao', () => {
    renderizar();

    fireEvent.press(screen.getByTestId('avaliacoes-serie-WEIGHT-alternar'));

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('formata o numero em pt-BR mesmo com o aparelho em outro idioma', () => {
    // `toFixed` + troca de ponto por virgula, nunca `toLocaleString`: o
    // formatador do dispositivo segue o idioma do CELULAR.
    renderizar();

    fireEvent.press(screen.getByTestId('avaliacoes-serie-WEIGHT-alternar'));

    expect(screen.queryByText('80.5 kg')).toBeNull();
  });

  it('sem avaliacoes no periodo mostra ausencia, e nao grafico vazio', () => {
    renderizar({ series: [] });
    expect(screen.getByTestId('avaliacoes-vazio')).toBeTruthy();
  });

  it('serie de UM ponto nao quebra o grafico', () => {
    // `maior === menor` daria divisao por zero e a linha sumiria.
    renderizar({
      series: [
        {
          tipo: 'WEIGHT',
          unidade: 'KG',
          pontos: [{ avaliacaoId: 'a1', medidaEm: '2026-08-03T10:00:00.000Z', valor: 80 }],
          meta: null,
        },
      ],
    });

    expect(screen.getByTestId('avaliacoes-serie-WEIGHT-grafico')).toBeTruthy();
  });

  it('sem analise publicada NAO mostra o aviso de IA', () => {
    renderizar();
    expect(screen.queryByTestId('avaliacoes-analise')).toBeNull();
  });

  it('com analise, o AVISO aparece junto do texto', () => {
    /*
     * Regra de arquitetura no 8: toda saida de IA carrega o
     * `NOT_MEDICAL_DIAGNOSIS`. Texto de analise renderizado sem o aviso e o
     * caso que este teste existe para impedir.
     */
    renderizar({
      analise: {
        geradaEm: '2026-08-04T10:00:00.000Z',
        model: 'claude-sonnet-4-6',
        promptVersion: 'analise-v3',
        analise: {
          summary: 'Sua constância melhorou no período.',
          positivePoints: ['Frequência estável'],
          attentionPoints: [],
          questionsForProfessional: [],
          disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS',
        },
      },
    });

    expect(screen.getByTestId('avaliacoes-analise-aviso')).toBeTruthy();
    expect(screen.getByText('Sua constância melhorou no período.')).toBeTruthy();
  });

  it('tipo desconhecido aparece com o codigo, em vez de sumir', () => {
    renderizar({
      series: [
        {
          tipo: 'TIPO_NOVO',
          unidade: null,
          pontos: [{ avaliacaoId: 'a1', medidaEm: '2026-08-03T10:00:00.000Z', valor: 10 }],
          meta: null,
        },
      ],
    });

    expect(screen.getByText('TIPO_NOVO')).toBeTruthy();
  });
});
