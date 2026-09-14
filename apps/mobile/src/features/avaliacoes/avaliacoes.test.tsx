import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Evolucao, formatarValor, type DadosDasAvaliacoes } from './avaliacoes.js';

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
      <Evolucao
        dados={{ ...base, ...dados }}
        periodo="90D"
        onPeriodo={() => undefined}
        onVerLaudo={() => undefined}
        testID="avaliacoes"
      />
    </ProvedorDeTema>,
  );

const tabela = () => within(screen.getByTestId('avaliacoes-serie-WEIGHT-tabela'));

describe('Evolucao', () => {
  it('traduz o tipo de medida para o nome que o aluno entende', () => {
    renderizar();
    expect(screen.getByText('Histórico · Peso')).toBeTruthy();
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
    expect(tabela().getByText('80,5 kg')).toBeTruthy();
    expect(tabela().getByText('78,2 kg')).toBeTruthy();
  });

  it('o delta diz a DIRECAO por texto, nao so por cor', () => {
    // Quem nao separa verde de laranja precisa ler o sinal. Cor como unico
    // canal reprova no `M4-NFR-007`.
    renderizar();

    fireEvent.press(screen.getByTestId('avaliacoes-serie-WEIGHT-alternar'));

    expect(tabela().getByText('−2,3 kg')).toBeTruthy();
  });

  it('a primeira linha nao inventa comparacao', () => {
    renderizar();

    fireEvent.press(screen.getByTestId('avaliacoes-serie-WEIGHT-alternar'));

    expect(tabela().getByText('—')).toBeTruthy();
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

    expect(screen.getByText('Histórico · TIPO_NOVO')).toBeTruthy();
  });

  it('metrica sem serie no periodo aparece como AUSENTE, nunca como zero', () => {
    renderizar();
    // So ha peso na fixture: gordura e musculo nao foram medidos.
    expect(within(screen.getByTestId('avaliacoes-metrica-Gordura')).getByLabelText('Gordura não medido no período')).toBeTruthy();
  });

  it('o delta do topo compara a primeira e a ultima medida do periodo', () => {
    renderizar();
    expect(within(screen.getByTestId('avaliacoes-metrica-Peso')).getByText('−2,3 kg')).toBeTruthy();
  });

  it('abre o laudo pelo cartao da avaliacao', () => {
    const onVerLaudo = jest.fn();
    render(
      <ProvedorDeTema forcarTema="dark">
        <Evolucao dados={base} periodo="90D" onPeriodo={() => undefined} onVerLaudo={onVerLaudo} />
      </ProvedorDeTema>,
    );

    fireEvent.press(screen.getByTestId('botao-ver-laudo'));
    expect(onVerLaudo).toHaveBeenCalled();
  });
});

describe('formatarValor', () => {
  it('reconhece a unidade em minusculas, como a API manda', () => {
    // O smoke do App Mobile v2 achou `22,5 percent` na tela: a API manda
    // `percent`/`kg` e o dicionario so tinha as chaves em maiusculas.
    expect(formatarValor(22.5, 'percent')).toBe('22,5 %');
    expect(formatarValor(92.25, 'kg', 2)).toBe('92,25 kg');
  });
});
