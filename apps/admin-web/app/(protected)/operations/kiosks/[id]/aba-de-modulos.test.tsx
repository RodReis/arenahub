import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CONFIG_PADRAO_DO_TOTEM, type KioskConfig } from '@arenahub/api-contracts';

import { AbaDeModulos } from './aba-de-modulos';

function renderizar(modulos: Partial<KioskConfig['modulos']> = {}) {
  const aoMudarModulos = vi.fn();
  const rascunho: KioskConfig = {
    ...CONFIG_PADRAO_DO_TOTEM,
    modulos: { ...CONFIG_PADRAO_DO_TOTEM.modulos, ...modulos },
  };

  render(<AbaDeModulos rascunho={rascunho} aoMudarModulos={aoMudarModulos} />);

  return { aoMudarModulos, rascunho };
}

describe('AbaDeModulos', () => {
  it('lista os cinco módulos com fatia entregue', () => {
    renderizar();

    expect(screen.getByTestId('campo-modulo-pagamento')).toBeInTheDocument();
    expect(screen.getByTestId('campo-modulo-historicoDePagamentos')).toBeInTheDocument();
    expect(screen.getByTestId('campo-modulo-avaliacao')).toBeInTheDocument();
    expect(screen.getByTestId('campo-modulo-evolucao')).toBeInTheDocument();
    expect(screen.getByTestId('campo-modulo-historicoDeAvaliacoes')).toBeInTheDocument();
  });

  it('mostra ranking — a F30 entregou a fatia que alimenta o modulo', () => {
    // Ate a F30 este teste provava a AUSENCIA: trava 2 do ADR-042, Decisao 5,
    // com a F33 apontada como dona. A F30 (ADR-046) entregou a tela de
    // preferencia de exposicao, entao o modulo passa a ser configuravel --
    // a trava continua valendo, o que mudou e existir fatia.
    renderizar({ ranking: true });

    const campo = screen.getByTestId('campo-modulo-ranking');
    expect(campo).toBeInTheDocument();
    expect(campo).toBeChecked();
  });

  it('avisa que desligar remove a etapa, não só o botão', () => {
    renderizar();

    expect(screen.getByText(/remove a ação da tela interna e a etapa/i)).toBeInTheDocument();
  });

  it('devolve a seção inteira ao alternar, preservando os outros módulos', async () => {
    const usuario = userEvent.setup();
    const { aoMudarModulos } = renderizar({ pagamento: false, avaliacao: true });

    await usuario.click(screen.getByTestId('campo-modulo-pagamento'));

    expect(aoMudarModulos).toHaveBeenCalledWith(
      expect.objectContaining({ pagamento: true, avaliacao: true }),
    );
  });

  it('desliga um módulo já ligado', async () => {
    const usuario = userEvent.setup();
    const { aoMudarModulos } = renderizar({ evolucao: true });

    await usuario.click(screen.getByTestId('campo-modulo-evolucao'));

    expect(aoMudarModulos).toHaveBeenCalledWith(expect.objectContaining({ evolucao: false }));
  });
});
