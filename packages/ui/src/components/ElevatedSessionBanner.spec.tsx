import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ElevatedSessionBanner } from './ElevatedSessionBanner.js';

/**
 * A faixa e AVISO DE SEGURANCA, nao enfeite -- DS-PAINEL.md §4.2.
 *
 * Quem opera elevado ve a tela do cliente identica a propria; sem a faixa,
 * age achando que esta na propria casa.
 */
describe('ElevatedSessionBanner', () => {
  it('nomeia o tenant e a hora de encerramento, porque operar as cegas e o risco', () => {
    render(
      <ElevatedSessionBanner
        tenant="Arena Positiva"
        reason="Suporte ao chamado 4821"
        expiresAt="2026-09-09T17:30:00Z"
        timeZone="America/Sao_Paulo"
      />,
    );

    const faixa = screen.getByTestId('faixa-de-suporte');

    expect(faixa).toHaveAttribute('role', 'status');
    expect(faixa).toHaveTextContent('Arena Positiva');
    // 17:30Z em America/Sao_Paulo.
    expect(faixa).toHaveTextContent('14:30');
  });

  /**
   * Sair tem de ser um clique. Quem entrou por engano no tenant errado nao
   * pode ter de procurar como voltar -- e o prazo sozinho deixaria a pessoa
   * elevada ate o relogio resolver.
   */
  it('oferece saida imediata', async () => {
    const sair = vi.fn();

    render(
      <ElevatedSessionBanner
        tenant="Arena Positiva"
        reason="Suporte"
        expiresAt="2026-09-09T17:30:00Z"
        timeZone="America/Sao_Paulo"
        sair={<button onClick={sair}>Sair do suporte</button>}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /sair do suporte/i }));

    expect(sair).toHaveBeenCalled();
  });

  /**
   * Sem `sair`, nenhum botao -- e em especial nenhum de FECHAR. Faixa que se
   * dispensa some da memoria em trinta segundos, e ai alguem opera sobre o
   * tenant do cliente achando que e usuario comum.
   */
  it('nao oferece como dispensar a faixa', () => {
    render(
      <ElevatedSessionBanner
        tenant="Arena Positiva"
        reason="Suporte"
        expiresAt="2026-09-09T17:30:00Z"
        timeZone="America/Sao_Paulo"
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
