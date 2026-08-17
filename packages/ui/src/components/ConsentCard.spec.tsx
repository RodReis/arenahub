import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConsentCard } from './ConsentCard.js';

describe('ConsentCard', () => {
  it('mostra os quatro campos que provam o consentimento', () => {
    render(
      <ConsentCard
        version="v2"
        grantedAt="2026-08-16T17:32:00Z"
        ip="192.168.2.10"
        device="Chrome 141 · Windows"
        timeZone="America/Sao_Paulo"
      />,
    );

    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText(/14:32/)).toBeInTheDocument();
    expect(screen.getByText('192.168.2.10')).toBeInTheDocument();
    expect(screen.getByText('Chrome 141 · Windows')).toBeInTheDocument();
  });

  /**
   * A data do aceite segue o fuso da UNIDADE, nao o do navegador.
   *
   * Numa disputa sobre consentimento, a hora que importa e a do lugar onde a
   * pessoa assinou.
   */
  it('a data do aceite usa o fuso da unidade', () => {
    render(
      <ConsentCard
        version="v2"
        grantedAt="2026-08-16T03:30:00Z"
        ip="192.168.2.10"
        device="Chrome"
        timeZone="America/Manaus"
      />,
    );

    expect(screen.getByText(/15\/08\/2026/)).toBeInTheDocument();
  });
});
