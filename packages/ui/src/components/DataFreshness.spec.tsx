import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DataFreshness } from './DataFreshness.js';

const TZ = 'America/Sao_Paulo';

describe('DataFreshness', () => {
  it('atual mostra o carimbo no fuso da unidade', () => {
    render(<DataFreshness state="current" at="2026-08-16T17:32:00Z" timeZone={TZ} />);

    expect(screen.getByText(/14:32/)).toBeInTheDocument();
  });

  /**
   * "Desatualizado" e "indisponivel" NAO colapsam -- §8.2.
   *
   * No primeiro ha dado antigo na tela e a operacao decide se serve; no
   * segundo nao ha dado nenhum. Sao acoes diferentes.
   */
  it('desatualizado e indisponivel produzem telas diferentes', () => {
    const { rerender } = render(
      <DataFreshness state="stale" at="2026-08-13T17:32:00Z" timeZone={TZ} />,
    );

    expect(screen.getByText(/Atualizado às/)).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();

    rerender(<DataFreshness state="unavailable" timeZone={TZ} />);

    expect(screen.getByText(/Não foi possível carregar/)).toBeInTheDocument();
    expect(screen.queryByText(/Atualizado às/)).not.toBeInTheDocument();
  });

  it('expoe o estado para o CSS sem embutir cor no componente', () => {
    const { container } = render(
      <DataFreshness state="stale" at="2026-08-13T17:32:00Z" timeZone={TZ} />,
    );

    expect(container.querySelector('[data-state="stale"]')).not.toBeNull();
  });

  it('indisponivel so oferece recarregar quando ha o que recarregar', () => {
    const { rerender } = render(<DataFreshness state="unavailable" timeZone={TZ} />);
    expect(screen.queryByRole('button', { name: 'Recarregar' })).not.toBeInTheDocument();

    rerender(<DataFreshness state="unavailable" timeZone={TZ} onReload={() => {}} />);
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeInTheDocument();
  });

  it('indisponivel e anunciado pelo leitor de tela', () => {
    render(<DataFreshness state="unavailable" timeZone={TZ} />);

    expect(screen.getByRole('status')).toHaveTextContent('Não foi possível carregar');
  });
});
