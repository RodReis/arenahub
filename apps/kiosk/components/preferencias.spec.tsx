import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PreferenciasDoTotem, SessaoDoAluno } from '../lib/kiosk-client.js';
import { Preferencias } from './preferencias.js';

vi.mock('../lib/kiosk-client', async (original) => ({
  ...(await original<typeof import('../lib/kiosk-client')>()),
  carregarPreferencias: vi.fn(),
  atualizarPreferenciaDeRanking: vi.fn(),
  atualizarPerfilPublico: vi.fn(),
}));

const { carregarPreferencias, atualizarPreferenciaDeRanking, atualizarPerfilPublico } =
  await import('../lib/kiosk-client');

const SESSAO: SessaoDoAluno = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  token: 't1',
  nome: 'Ana Beatriz Souza',
  plano: { ativo: true, pendenciaEmCentavos: null },
  expiraEm: '2026-08-27T12:01:00.000Z',
};

const PREFERENCIAS_PADRAO: PreferenciasDoTotem = {
  finalidades: { RANKING: true },
  perfil: null,
  nomeExibido: 'Ana',
};

beforeEach(() => {
  vi.mocked(carregarPreferencias).mockReset().mockResolvedValue(PREFERENCIAS_PADRAO);
  vi.mocked(atualizarPreferenciaDeRanking).mockReset();
  vi.mocked(atualizarPerfilPublico).mockReset();
});

describe('Preferencias', () => {
  it('o interruptor de ranking nasce LIGADO -- regime opt-out', async () => {
    // Se alguem inverter o default, o aluno abre a tela achando que esta
    // fora do ranking enquanto aparece nele. Este teste guarda a coerencia
    // entre a tela e o regime.
    render(<Preferencias sessao={SESSAO} aoVoltar={vi.fn()} />);

    expect(await screen.findByRole('switch', { name: /aparecer no ranking/i })).toBeChecked();
  });

  it('finalidade dormente nao aparece na tela', async () => {
    // Interruptor que nao faz nada e pior que ausencia.
    render(<Preferencias sessao={SESSAO} aoVoltar={vi.fn()} />);

    await screen.findByRole('switch', { name: /aparecer no ranking/i });

    expect(screen.queryByText(/desafio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/notifica/i)).not.toBeInTheDocument();
  });

  it('apelido enviado mostra "em analise" e mantem o primeiro nome', async () => {
    const usuario = userEvent.setup();
    vi.mocked(atualizarPerfilPublico).mockResolvedValue({
      id: 'p1',
      identityChoice: 'APELIDO',
      alias: 'Tigre',
      status: 'PENDING',
      version: 1,
    });

    render(<Preferencias sessao={SESSAO} aoVoltar={vi.fn()} />);
    await screen.findByRole('switch', { name: /aparecer no ranking/i });

    await usuario.click(screen.getByRole('radio', { name: /apelido/i }));
    await usuario.click(screen.getByRole('button', { name: 't' }));
    await usuario.click(screen.getByRole('button', { name: 'i' }));
    await usuario.click(screen.getByRole('button', { name: 'g' }));
    await usuario.click(screen.getByRole('button', { name: 'r' }));
    await usuario.click(screen.getByRole('button', { name: 'e' }));
    await usuario.click(screen.getByRole('button', { name: /salvar apelido/i }));

    expect(await screen.findByText(/em análise/i)).toBeInTheDocument();
    expect(screen.getByTestId('nome-exibido')).toHaveTextContent('Ana');
  });

  it('erro da API vira toast, nunca alert', async () => {
    // `alert` e proibido pelas convencoes; e o toast precisa de efeito que
    // compare a mensagem, porque erro de action nao e evento.
    const usuario = userEvent.setup();
    vi.mocked(atualizarPreferenciaDeRanking).mockResolvedValue(null);

    render(<Preferencias sessao={SESSAO} aoVoltar={vi.fn()} />);
    const interruptor = await screen.findByRole('switch', { name: /aparecer no ranking/i });

    await usuario.click(interruptor);

    // `Toast` usa `role="alert"` de proposito (interrompe o leitor de tela --
    // ver `components/toast.tsx`), e nao `role="status"`.
    expect(await screen.findByRole('alert')).toHaveTextContent(/não foi possível/i);
  });
});
