import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Indicadores } from './indicadores';
import type { IndicadoresDeEngajamento } from '../../../actions/engagement';

const BASE: IndicadoresDeEngajamento = {
  alunosAtivos: 200,
  participandoDoRanking: 180,
  optOut: 20,
  apelidosPendentes: 3,
  apelidosOcultos: 1,
  contestacoesAbertas: 2,
};

describe('Indicadores', () => {
  it('mostra a base ativa, quem está no placar e quem saiu', () => {
    render(<Indicadores dados={BASE} />);

    expect(screen.getByTestId('indicador-alunosAtivos')).toHaveTextContent('200');
    expect(screen.getByTestId('indicador-participandoDoRanking')).toHaveTextContent('180');
    expect(screen.getByTestId('indicador-optOut')).toHaveTextContent('20');
  });

  it('calcula a taxa sobre a base ATIVA', () => {
    render(<Indicadores dados={BASE} />);
    expect(screen.getByTestId('indicador-participandoDoRanking')).toHaveTextContent('90%');
  });

  it('academia sem aluno nao mostra porcentagem -- nao ha divisao por zero', () => {
    // O canário: `180/0` daria `Infinity` e a tela estamparia "Infinity%".
    render(
      <Indicadores
        dados={{
          alunosAtivos: 0,
          participandoDoRanking: 0,
          optOut: 0,
          apelidosPendentes: 0,
          apelidosOcultos: 0,
          contestacoesAbertas: 0,
        }}
      />,
    );

    expect(screen.getByTestId('indicador-participandoDoRanking')).not.toHaveTextContent('%');
  });

  it('separa o que ESTÁ acontecendo do que espera alguém', () => {
    // A fila é o que a secretaria abre a tela para ver; misturá-la com
    // estatística faria procurá-la no meio dos números.
    render(<Indicadores dados={BASE} />);

    expect(screen.getByRole('heading', { name: /participação/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /esperando alguém/i })).toBeInTheDocument();
  });

  it('mostra as pendências que a operação precisa resolver', () => {
    render(<Indicadores dados={BASE} />);

    expect(screen.getByTestId('indicador-apelidosPendentes')).toHaveTextContent('3');
    expect(screen.getByTestId('indicador-contestacoesAbertas')).toHaveTextContent('2');
    expect(screen.getByTestId('indicador-apelidosOcultos')).toHaveTextContent('1');
  });

  it('explica que quem não pediu para sair participa', () => {
    // Sem essa frase, um operador que vê "180 no placar" e "20 pediram para
    // sair" tenta descobrir onde estão os outros que "não aceitaram".
    render(<Indicadores dados={BASE} />);
    expect(screen.getByText(/quem não pediu para sair participa/i)).toBeInTheDocument();
  });
});
