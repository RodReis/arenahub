import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StateBadge } from './StateBadge.js';

describe('StateBadge', () => {
  it('mostra o rotulo pt-BR do dicionario, nunca o codigo cru', () => {
    render(<StateBadge machine="student" state="BLOCKED" />);

    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.queryByText('BLOCKED')).not.toBeInTheDocument();
  });

  it('carrega icone E texto -- cor nunca e o unico canal', () => {
    const { container } = render(<StateBadge machine="device" state="OFFLINE" />);

    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('estado desconhecido nao renderiza badge vazio', () => {
    const { container } = render(<StateBadge machine="student" state="NAO_EXISTE" />);

    expect(container.querySelector('[data-tone]')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByLabelText('não informado')).toBeInTheDocument();
  });

  it('expoe o tom para o CSS sem embutir cor no componente', () => {
    render(<StateBadge machine="entitlement" state="ACTIVE" />);

    expect(screen.getByText('Ativo').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'success',
    );
  });

  it('live liga role=status para o leitor anunciar mudanca em tempo real', () => {
    render(<StateBadge machine="device" state="DEGRADED" live />);

    expect(screen.getByRole('status')).toHaveTextContent('Degradado');
  });

  it('sem live nao ha role=status -- badge de tabela nao interrompe leitura', () => {
    render(<StateBadge machine="device" state="ONLINE" />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
