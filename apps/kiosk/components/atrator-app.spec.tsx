import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CONFIG_PADRAO_DO_TOTEM,
  type IndicadoresDaUnidade,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { Atrator } from './atrator.js';

/**
 * #534 -- "Baixar o app" na barra inferior da tela atratora.
 *
 * Mesma armadilha do alto contraste (`atrator-toque.spec.tsx`): a tela inteira
 * e tocavel, entao o clique do botao novo BORBULHA para o fundo e abriria a
 * identificacao por CPF em vez do QR. `stopPropagation` e o que impede isso, e
 * este arquivo e o canario.
 */

const SEM_INDICADORES: IndicadoresDaUnidade = {
  checkinsDeHoje: 0,
  treinandoAgora: 0,
  placar: [],
  desafio: null,
};

const CONFIG: KioskConfig = {
  ...CONFIG_PADRAO_DO_TOTEM,
  blocos: { tempoPorBlocoSegundos: 12, itens: [] },
};

function montar(aoBaixarApp?: () => void) {
  const aoEntrar = vi.fn();

  render(
    <Atrator
      config={CONFIG}
      indicadores={SEM_INDICADORES}
      altoContraste={false}
      aoAlternarContraste={vi.fn()}
      aoEntrar={aoEntrar}
      {...(aoBaixarApp ? { aoBaixarApp } : {})}
    />,
  );

  return { aoEntrar };
}

describe('Atrator -- Baixar o app (#534)', () => {
  it('sem aoBaixarApp nao existe botao e a dica segue como era', () => {
    montar();

    expect(screen.queryByTestId('baixar-app')).toBeNull();
    expect(screen.getByTestId('dica-de-entrada').textContent).toContain(
      'Toque na tela para entrar na sua área',
    );
  });

  it('com aoBaixarApp o botao aparece NA MESMA barra da dica', () => {
    montar(vi.fn());

    const barra = screen.getByTestId('barra-de-entrada');

    expect(barra.contains(screen.getByTestId('baixar-app'))).toBe(true);
    expect(barra.contains(screen.getByTestId('dica-de-entrada'))).toBe(true);
  });

  it('tocar em Baixar o app abre o QR e NAO a identificacao', () => {
    const aoBaixarApp = vi.fn();
    const { aoEntrar } = montar(aoBaixarApp);

    fireEvent.click(screen.getByTestId('baixar-app'));

    expect(aoBaixarApp).toHaveBeenCalledTimes(1);
    expect(aoEntrar).not.toHaveBeenCalled();
  });

  it('tocar no fundo continua levando a identificacao', () => {
    const { aoEntrar } = montar(vi.fn());

    fireEvent.click(screen.getByTestId('tela-atratora'));

    expect(aoEntrar).toHaveBeenCalledTimes(1);
  });
});
