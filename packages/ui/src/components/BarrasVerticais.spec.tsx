import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarrasVerticais, prepararColunas } from './BarrasVerticais.js';

const FAIXAS = [
  { rotulo: 'Até 15 dias', valor: 630_000, tokenDeCor: '--ah-state-warning', valorLegivel: 'R$ 6.300,00' },
  { rotulo: '16 a 30 dias', valor: 675_000, tokenDeCor: '--ah-state-risk', valorLegivel: 'R$ 6.750,00' },
  { rotulo: 'Mais de 30 dias', valor: 330_000, tokenDeCor: '--ah-state-danger', valorLegivel: 'R$ 3.300,00' },
];

describe('BarrasVerticais', () => {
  it('publica as faixas numa tabela para leitor de tela', () => {
    render(<BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />);

    expect(screen.getByRole('table', { name: 'Dívida por faixa de atraso' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '16 a 30 dias' })).toBeInTheDocument();
  });

  it('mostra o valor legível no topo de cada coluna', () => {
    render(<BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />);

    // Recharts nao desenha SVG em jsdom (ResponsiveContainer mede zero) --
    // o que se prova aqui e que o texto existe em algum lugar do DOM
    // (a tabela invisivel), nao que o LabelList visual desenhou. A prova do
    // LabelList em si e `prepararColunas`, abaixo.
    expect(screen.getAllByText('R$ 6.750,00').length).toBeGreaterThan(0);
  });

  /**
   * FAIXA ZERADA SAI DO GRAFICO, mas continua na tabela do leitor de tela --
   * mesma regra que `BarrasDeFaixa` ja aplica (achado na revisao final: a
   * primeira versao deste componente desenhava TODAS as faixas, inclusive
   * as zeradas, e uma coluna de altura zero com rotulo "R$ 0,00" no topo
   * parece dado que nao carregou).
   *
   * `prepararColunas` e a funcao PURA que decide isso -- extraida para ser
   * testavel sem depender do Recharts renderizar (que nao acontece em
   * jsdom).
   */
  it('prepararColunas remove faixas zeradas, mantendo as com valor', () => {
    const colunas = prepararColunas(FAIXAS);

    expect(colunas).toHaveLength(3);

    const comZero = [...FAIXAS, { rotulo: 'Zerada', valor: 0, tokenDeCor: '--ah-text-muted', valorLegivel: 'R$ 0,00' }];
    const colunasComZero = prepararColunas(comZero);

    expect(colunasComZero).toHaveLength(3);
    expect(colunasComZero.some((c) => c.rotulo === 'Zerada')).toBe(false);
  });

  /** Mesma regra de BarrasDeFaixa: sem dado e frase, nao eixo vazio. */
  it('mostra frase, nao eixo vazio, quando todas as faixas sao zero', () => {
    render(
      <BarrasVerticais
        faixas={FAIXAS.map((f) => ({ ...f, valor: 0 }))}
        descricao="Dívida por faixa de atraso"
        testId="aging"
      />,
    );

    expect(screen.getByTestId('aging')).toHaveTextContent(/nada em atraso/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  /**
   * UMA FAIXA CONCENTRADA nao pode fazer as outras (valor zero) produzirem
   * altura NaN ou negativa ao normalizar contra o maior valor.
   */
  it('nao quebra quando so uma faixa tem valor', () => {
    const faixas = [
      { rotulo: 'Até 15 dias', valor: 0, tokenDeCor: '--ah-state-warning', valorLegivel: 'R$ 0,00' },
      { rotulo: '16 a 30 dias', valor: 500_000, tokenDeCor: '--ah-state-risk', valorLegivel: 'R$ 5.000,00' },
    ];

    const colunas = prepararColunas(faixas);

    // So a faixa com valor entra -- nenhum NaN, nenhuma altura negativa,
    // porque a faixa zerada nem chega ao Recharts para normalizar.
    expect(colunas).toEqual([{ rotulo: '16 a 30 dias', valor: 500_000, valorLegivel: 'R$ 5.000,00' }]);

    render(<BarrasVerticais faixas={faixas} descricao="Dívida por faixa de atraso" />);

    expect(screen.getAllByText('R$ 5.000,00').length).toBeGreaterThan(0);
  });

  it('esconde o grafico do leitor de tela, deixando so a tabela', () => {
    const { container } = render(
      <BarrasVerticais faixas={FAIXAS} descricao="Dívida por faixa de atraso" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
