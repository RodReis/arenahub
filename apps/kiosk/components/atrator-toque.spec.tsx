import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_PADRAO_DO_TOTEM,
  type IndicadoresDaUnidade,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { Atrator } from './atrator.js';

/**
 * A TELA INTEIRA E TOCAVEL, MAS O CONTRASTE NAO PODE NAVEGAR.
 *
 * O §4 pede que qualquer toque na tela atratora leve a identificacao -- e nao
 * so o botao. Isso pos um `onClick` no container, e com ele um problema que
 * nao existia antes: todo botao de dentro passa a ter o clique BORBULHANDO
 * para o fundo.
 *
 * Para o botao "Entrar" isso e inofensivo (os dois fazem a mesma coisa). Para
 * o "Alto contraste" e um defeito de acessibilidade: quem toca nele quer
 * enxergar melhor a tela em que esta, e sairia dela para a identificacao. A
 * pessoa que MAIS precisa do recurso e a que seria expulsa da tela ao usa-lo.
 *
 * `stopPropagation` no handler e o que impede isso -- e este arquivo e o
 * canario: removendo-o, o primeiro teste falha.
 */

const SEM_INDICADORES: IndicadoresDaUnidade = {
  checkinsDeHoje: 0,
  treinandoAgora: 0,
  placar: [],
  desafio: null,
};

function montar() {
  const aoEntrar = vi.fn();
  const aoAlternarContraste = vi.fn();

  const config: KioskConfig = {
    ...CONFIG_PADRAO_DO_TOTEM,
    blocos: { tempoPorBlocoSegundos: 12, itens: [] },
  };

  render(
    <Atrator
      config={config}
      indicadores={SEM_INDICADORES}
      aoEntrar={aoEntrar}
      altoContraste={false}
      aoAlternarContraste={aoAlternarContraste}
    />,
  );

  return { aoEntrar, aoAlternarContraste };
}

describe('Atrator -- a tela inteira e tocavel (§4)', () => {
  it('alternar o contraste NAO navega para a identificacao', () => {
    const { aoEntrar, aoAlternarContraste } = montar();

    fireEvent.click(screen.getByTestId('alternar-contraste'));

    expect(aoAlternarContraste).toHaveBeenCalledTimes(1);
    // O canario: sem `stopPropagation`, o clique borbulha e isto vira 1.
    expect(aoEntrar).not.toHaveBeenCalled();
  });

  it('tocar o fundo leva a identificacao', () => {
    const { aoEntrar, aoAlternarContraste } = montar();

    fireEvent.click(screen.getByTestId('tela-atratora'));

    expect(aoEntrar).toHaveBeenCalledTimes(1);
    expect(aoAlternarContraste).not.toHaveBeenCalled();
  });

  it('o botao Entrar do cabecalho chama a identificacao UMA vez', () => {
    const { aoEntrar } = montar();

    fireEvent.click(screen.getByTestId('entrar-cabecalho'));

    /*
     * UMA, nao duas. Aqui o `stopPropagation` nao muda o que o usuario ve --
     * o fundo faria a mesma coisa -- mas chamar `aoEntrar` duas vezes por
     * toque e o tipo de duplicata que vira sessao aberta em dobro quando
     * alguem trocar o handler por algo que grava estado.
     */
    expect(aoEntrar).toHaveBeenCalledTimes(1);
  });
});
