import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumeroQueConta } from './numero-que-conta';

/**
 * O número que sobe de zero ao carregar — F57, passe visual.
 *
 * Testado aqui e não no navegador porque os valores da bancada são pequenos
 * (2 restrições, 4 dispositivos): contam em três quadros e são
 * indistinguíveis de "não animou" por amostragem. Com 341 a diferença é
 * óbvia, e o teste controla o relógio em vez de torcer pelo timing.
 */
describe('NumeroQueConta', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // `matchMedia` não existe no jsdom; sem ele o componente quebra ao ler a
    // preferência de movimento.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /*
   * O VALOR FINAL É O DO SERVIDOR, e ele está no HTML desde o primeiro
   * render: sem JavaScript a tela mostra o número certo, não zero. A animação
   * é enfeite por cima, e enfeite não pode ser a fonte do dado.
   */
  it('renderiza o valor final imediatamente, antes de qualquer efeito', () => {
    render(<NumeroQueConta valor={341} />);

    expect(screen.getByText('341')).toBeInTheDocument();
  });

  /*
   * O QUE ESTE TESTE PRENDE é que o número PASSA por valores intermediários,
   * não que ele chegue ao fim -- chegar ao fim ele chegaria mesmo sem
   * animação nenhuma, e foi essa a primeira versão do teste: verde e
   * decorativa.
   */
  it('passa por valores intermediários antes de chegar ao valor final', async () => {
    render(<NumeroQueConta valor={341} />);

    const lido = (): number => Number(document.body.textContent);

    // Um quadro depois do início: já saiu do zero e ainda não chegou.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    const noMeio = lido();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(noMeio).toBeGreaterThan(0);
    expect(noMeio).toBeLessThan(341);
    expect(lido()).toBe(341);
  });

  it('mostra o sufixo sem anima-lo', () => {
    render(
      <NumeroQueConta valor={4}>
        <span>/4 online</span>
      </NumeroQueConta>,
    );

    expect(document.body.textContent).toContain('/4 online');
  });

  /*
   * `prefers-reduced-motion` mostra o valor direto. O teste importa porque a
   * alternativa silenciosa seria animar mesmo assim -- e movimento que a
   * pessoa pediu para não ver é o pior tipo de defeito de acessibilidade:
   * invisível para quem o escreveu.
   */
  it('com movimento reduzido, não anima', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<NumeroQueConta valor={341} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(document.body.textContent).toContain('341');
  });
});
