import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

import { PainelDeConfiguracao } from './painel-de-configuracao';
import type { ConfiguracaoDeEngajamento } from '../../../actions/engagement';

vi.mock('../../../actions/engagement', () => ({
  salvarConfiguracaoDeEngajamento: vi.fn(),
}));

const { salvarConfiguracaoDeEngajamento } = await import('../../../actions/engagement');

const TUDO_LIGADO: ConfiguracaoDeEngajamento = {
  rankingEnabled: true,
  challengesEnabled: true,
  achievementsEnabled: true,
  correctionLimitPoints: null,
};

function renderizar(inicial: ConfiguracaoDeEngajamento = TUDO_LIGADO) {
  return render(
    <ToastProvider>
      <PainelDeConfiguracao inicial={inicial} />
    </ToastProvider>,
  );
}

/** O que a action recebeu na última chamada, como objeto simples. */
function ultimoEnvio(): Record<string, string> {
  const chamadas = vi.mocked(salvarConfiguracaoDeEngajamento).mock.calls;
  const formulario = chamadas[chamadas.length - 1]?.[1] as FormData;

  return Object.fromEntries(
    [...formulario.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
  );
}

describe('PainelDeConfiguracao', () => {
  beforeEach(() => {
    vi.mocked(salvarConfiguracaoDeEngajamento).mockReset();
    vi.mocked(salvarConfiguracaoDeEngajamento).mockResolvedValue({ sucesso: true });
  });

  it('reflete o que está ligado no servidor', () => {
    renderizar({ ...TUDO_LIGADO, challengesEnabled: false });

    expect(screen.getByTestId('flag-rankingEnabled')).toBeChecked();
    expect(screen.getByTestId('flag-challengesEnabled')).not.toBeChecked();
  });

  it('envia SÓ a capacidade que o operador mexeu', async () => {
    // O canário do parcial: mandar o objeto inteiro faria duas abas abertas
    // sobrescreverem uma a decisão da outra em campos que nenhuma tocou.
    renderizar();

    await userEvent.click(screen.getByTestId('flag-challengesEnabled'));

    await waitFor(() => {
      expect(ultimoEnvio()).toEqual({ challengesEnabled: 'false' });
    });
  });

  it('diz que desligar é reversível -- quem desliga precisa saber antes de clicar', () => {
    renderizar();
    expect(screen.getByText(/desligar não apaga nada/i)).toBeInTheDocument();
  });

  it('explica que o limite vale para dar E para tirar', () => {
    // O teto é sobre valor absoluto. Sem essa frase, um operador que digita
    // 100 acha que só limitou o lado positivo.
    renderizar();
    expect(screen.getByText(/vale para dar e para tirar/i)).toBeInTheDocument();
  });

  it('diz que a correção acima do limite é RECUSADA, não enfileirada', () => {
    // ADR-049 Decisão 2: não existe fila de aprovação. A tela não pode
    // sugerir que alguém vai liberar depois.
    renderizar();
    expect(screen.getByText(/recusada na hora/i)).toBeInTheDocument();
  });

  it('campo de limite vazio vira SEM TETO, não zero', async () => {
    // Os dois são estados legítimos e distintos: vazio é "sem limite", zero
    // é "ninguém corrige". Colapsá-los desligaria a correção por acidente.
    renderizar({ ...TUDO_LIGADO, correctionLimitPoints: 100 });

    const campo = screen.getByTestId('teto-de-correcao');
    await userEvent.clear(campo);
    await userEvent.tab();

    await waitFor(() => {
      expect(ultimoEnvio()).toEqual({ correctionLimitPoints: '' });
    });
  });

  it('grava o limite digitado', async () => {
    renderizar();

    const campo = screen.getByTestId('teto-de-correcao');
    await userEvent.type(campo, '100');
    await userEvent.tab();

    await waitFor(() => {
      expect(ultimoEnvio()).toEqual({ correctionLimitPoints: '100' });
    });
  });

  it('não oferece desfazer -- a alteração já foi gravada no clique', () => {
    // Um "desfazer" que só mexesse no estado da tela mentiria sobre o que
    // está no servidor.
    renderizar();
    expect(screen.queryByRole('button', { name: /desfazer/i })).not.toBeInTheDocument();
  });
});
