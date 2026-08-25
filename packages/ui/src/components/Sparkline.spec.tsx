import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sparkline } from './Sparkline.js';

describe('Sparkline', () => {
  it('desenha quando ha pelo menos dois pontos', () => {
    render(<Sparkline valores={[100, 200, 150]} testId="tendencia" />);

    expect(screen.getByTestId('tendencia')).toBeInTheDocument();
  });

  /**
   * UM PONTO NAO E TENDENCIA. Um traço reto afirmaria estabilidade que
   * ninguem mediu -- e o mesmo erro que a serie de um ponto so cometeria.
   * Nada e desenhado; o KPI ao lado continua inteiro.
   */
  it('nao desenha nada com um ponto so', () => {
    render(<Sparkline valores={[100]} testId="tendencia" />);

    expect(screen.queryByTestId('tendencia')).not.toBeInTheDocument();
  });

  it('nao desenha nada sem ponto algum', () => {
    render(<Sparkline valores={[]} testId="tendencia" />);

    expect(screen.queryByTestId('tendencia')).not.toBeInTheDocument();
  });

  /**
   * SEM ALTERNATIVA TEXTUAL, E E CORRETO: a serie que ele ilustra ja esta
   * publicada na tabela do bloco de competencia, na mesma pagina. Repeti-la
   * faria o leitor de tela anunciar os mesmos meses duas vezes.
   */
  it('fica fora da arvore de acessibilidade', () => {
    render(<Sparkline valores={[100, 200]} testId="tendencia" />);

    expect(screen.getByTestId('tendencia')).toHaveAttribute('aria-hidden', 'true');
  });
});
