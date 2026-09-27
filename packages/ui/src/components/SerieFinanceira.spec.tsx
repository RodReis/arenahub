import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderPontoDaSerie, SerieFinanceira } from './SerieFinanceira.js';

/**
 * O SVG do Recharts NAO renderiza em jsdom -- o `ResponsiveContainer` mede o
 * pai, e em jsdom todo elemento tem largura zero. Testar o desenho aqui
 * produziria asserção sobre nada.
 *
 * O que estes testes guardam e o que EXISTE fora do canvas e decide se o bloco
 * informa ou mente: a tabela para leitor de tela, os estados de borda, e o
 * calculo do "nao entrou" -- que e a razao de o componente existir.
 */

const TRES_MESES = [
  { rotulo: 'jun/2026', faturadoMinor: 4_295_000, recebidoMinor: 4_040_000 },
  { rotulo: 'jul/2026', faturadoMinor: 4_295_000, recebidoMinor: 3_785_000 },
  { rotulo: 'ago/2026', faturadoMinor: 4_295_000, recebidoMinor: 3_095_000 },
];

describe('SerieFinanceira', () => {
  it('publica a serie numa tabela para leitor de tela', () => {
    render(<SerieFinanceira pontos={TRES_MESES} descricao="Faturado e recebido por mês" />);

    expect(screen.getByRole('table', { name: 'Faturado e recebido por mês' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'jul/2026' })).toBeInTheDocument();
  });

  /**
   * O NUMERO QUE O BLOCO EXISTE PARA MOSTRAR. A distancia entre as duas curvas
   * e a inadimplencia do mes: 42.950 faturado menos 37.850 recebido.
   */
  it('calcula quanto nao entrou em cada competencia', () => {
    render(<SerieFinanceira pontos={TRES_MESES} descricao="Faturado e recebido por mês" />);

    // R$ 5.100,00 em julho -- e o valor tem separador de milhar.
    expect(screen.getByText('R$ 5.100,00')).toBeInTheDocument();
    expect(screen.getByText('R$ 12.000,00')).toBeInTheDocument();
  });

  /**
   * RECEBIDO MAIOR QUE FATURADO E POSSIVEL: quem paga tres meses atrasados de
   * uma vez quita invoices de competencias anteriores. Sem o piso em zero o
   * `Area` desenharia altura negativa e a faixa apareceria espelhada,
   * sugerindo um buraco que nao existe.
   */
  it('nao produz diferenca negativa quando o recebido supera o faturado', () => {
    render(
      <SerieFinanceira
        pontos={[{ rotulo: 'set/2026', faturadoMinor: 100_000, recebidoMinor: 150_000 }]}
        descricao="Faturado e recebido por mês"
      />,
    );

    // A coluna "Nao entrou" mostra zero, nunca `-R$ 500,00`.
    expect(screen.getByText('R$ 0,00')).toBeInTheDocument();
  });

  /**
   * SEM PONTO NAO E GRAFICO VAZIO -- e uma frase. Eixos sem linha parecem dado
   * que nao carregou, e a pessoa fica esperando algo que nunca vem.
   */
  it('mostra frase, e nao eixos vazios, quando nao ha competencia', () => {
    render(<SerieFinanceira pontos={[]} descricao="Faturado e recebido por mês" testId="serie" />);

    expect(screen.getByTestId('serie')).toHaveTextContent(/Nenhuma competência apurada/i);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  /** Um ponto continua sendo informacao -- a tabela carrega o numero. */
  it('publica a tabela mesmo com uma competencia so', () => {
    render(
      <SerieFinanceira
        pontos={[TRES_MESES[0]!]}
        descricao="Faturado e recebido por mês"
      />,
    );

    expect(screen.getByRole('rowheader', { name: 'jun/2026' })).toBeInTheDocument();
  });

  /**
   * O SVG FICA FORA DA ARVORE DE ACESSIBILIDADE. Sem o `aria-hidden` no
   * wrapper, os `<text>` dos eixos seriam lidos e cada competencia anunciada
   * duas vezes -- uma na tabela, outra no grafico.
   */
  it('esconde o grafico do leitor de tela, deixando so a tabela', () => {
    const { container } = render(
      <SerieFinanceira pontos={TRES_MESES} descricao="Faturado e recebido por mês" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  /**
   * O ULTIMO PONTO (competencia mais recente) ganha destaque -- e para onde o
   * olho deve ir primeiro, porque e o numero que ainda pode mudar.
   *
   * TESTADO CHAMANDO A FUNCAO `dot` DIRETO, nao via DOM: Recharts nao
   * desenha SVG em jsdom (ver nota no topo deste arquivo), entao nao existe
   * circulo para inspecionar na arvore renderizada. A funcao que decide o
   * raio e pura -- recebe indice, devolve elemento -- e pode ser testada
   * isolada.
   */
  it('desenha o ultimo ponto com raio maior que os demais', () => {
    const pontoComum = renderPontoDaSerie({ cx: 10, cy: 20, index: 0 }, 3, 'currentColor', 'currentColor');
    const ultimoPonto = renderPontoDaSerie({ cx: 10, cy: 20, index: 2 }, 3, 'currentColor', 'currentColor');

    expect(pontoComum.props.r).toBe(4);
    expect(ultimoPonto.props.r).toBe(6);
  });

  /**
   * A BORDA DO PONTO usa cor RESOLVIDA, nao `var(--token)` literal -- achado
   * na revisao final: `BarrasDeFaixa` ja documenta que o SVG do Recharts nao
   * aceita `var(--token)` de forma confiavel em atributo de apresentacao.
   * `renderPontoDaSerie` recebia a cor da borda como string fixa em vez de
   * receber, como o `fill`, um valor ja resolvido pelo chamador.
   */
  it('recebe a cor da borda como parametro, nao como var() fixo', () => {
    const ponto = renderPontoDaSerie({ cx: 10, cy: 20, index: 0 }, 3, 'currentColor', 'rgb(1, 2, 3)');

    expect(ponto.props.stroke).toBe('rgb(1, 2, 3)');
  });

  /** Serie de um ponto so: esse unico ponto e o ultimo, e ganha o raio maior. */
  it('destaca o unico ponto quando a serie tem uma competencia so', () => {
    const ponto = renderPontoDaSerie({ cx: 10, cy: 20, index: 0 }, 1, 'currentColor', 'currentColor');

    expect(ponto.props.r).toBe(6);
  });
});
