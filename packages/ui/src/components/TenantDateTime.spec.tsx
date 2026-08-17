import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TenantDateTime } from './TenantDateTime.js';

describe('TenantDateTime', () => {
  /**
   * O teste que da razao ao componente existir.
   *
   * O mesmo instante em fusos diferentes tem de produzir textos diferentes.
   * As quatro implementacoes que este componente substitui hardcodavam
   * `America/Sao_Paulo` -- numa academia com filial em Manaus, todo evento
   * seria lido com uma hora de erro.
   */
  it('formata no timezone da UNIDADE, nao no do navegador', () => {
    // 03:30 UTC = 00:30 em Sao_Paulo, ainda no dia 16.
    render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" format="datetime" />,
    );

    expect(screen.getByText(/16\/08\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/00:30/)).toBeInTheDocument();
  });

  it('o mesmo instante em Manaus cai no dia anterior', () => {
    // 03:30 UTC = 23:30 em Manaus, dia 15.
    render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Manaus" format="datetime" />,
    );

    expect(screen.getByText(/15\/08\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/23:30/)).toBeInTheDocument();
  });

  it('usa <time> com o instante legivel por maquina', () => {
    const { container } = render(
      <TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" />,
    );

    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-08-16T03:30:00Z');
  });

  it('formato date omite a hora', () => {
    render(<TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" format="date" />);

    expect(screen.getByText('16/08/2026')).toBeInTheDocument();
  });

  it('formato time omite a data', () => {
    render(<TenantDateTime iso="2026-08-16T03:30:00Z" timeZone="America/Sao_Paulo" format="time" />);

    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  it('data ausente nao vira epoch zero', () => {
    render(<TenantDateTime iso={null} timeZone="America/Sao_Paulo" />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
  });

  /**
   * REGRESSAO das quatro implementacoes substituidas: todas checavam
   * `Number.isFinite(data.getTime())` e caiam para `—`. Sem esta guarda, uma
   * string invalida renderiza "Invalid Date" na tela da recepcao.
   */
  it('data invalida vira travessao, nunca "Invalid Date"', () => {
    render(<TenantDateTime iso="nao-e-data" timeZone="America/Sao_Paulo" />);

    expect(screen.getByLabelText('não informado')).toHaveTextContent('—');
    expect(screen.queryByText(/Invalid/)).not.toBeInTheDocument();
  });
});
