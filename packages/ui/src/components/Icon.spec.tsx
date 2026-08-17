import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ICON_NAMES, Icon } from './Icon.js';

describe('Icon', () => {
  /**
   * Renderiza os 20, nao dois.
   *
   * A uniao literal garante que ninguem PECA um icone inexistente, mas nao
   * garante que o que existe DESENHE: uma entrada com array vazio compila,
   * passa no typecheck e produz um `<svg>` em branco na tela. So renderizar
   * pega isso.
   */
  it.each(ICON_NAMES)('%s desenha ao menos um traco', (nome) => {
    const { container } = render(<Icon name={nome} />);

    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('renderiza svg escondido do leitor de tela', () => {
    const { container } = render(<Icon name="check-circle" />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('usa currentColor para herdar o tom de quem o contem', () => {
    const { container } = render(<Icon name="x-circle" />);

    expect(container.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
  });
});
