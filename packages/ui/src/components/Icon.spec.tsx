import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon.js';

describe('Icon', () => {
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
