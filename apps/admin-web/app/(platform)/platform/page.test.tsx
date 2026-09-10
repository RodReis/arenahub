import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDePlataforma from './page';

/** Formato real de `GET /api/v1/platform/tenants` -- ver `platform.controller.ts`. */
const TENANT_BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'arena-positiva',
  displayName: 'Arena Positiva',
  unidades: 2,
  alunosAtivos: 400,
  alunosInativos: 120,
};

async function renderizar() {
  const elemento = await PaginaDePlataforma();

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('pagina de academias (Super Admin)', () => {
  /**
   * F65 -- a grid mostra quantos dias faltam para a suspensao.
   */
  it('mostra a contagem regressiva quando ha fatura vencida', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: [
        {
          ...TENANT_BASE,
          status: 'ACTIVE',
          cobranca: { diasRestantes: 7, emAbertoMinor: 596250 },
        },
      ],
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByText(/7 dias/)).toBeInTheDocument();
  });

  /**
   * F65 -- suspensa aparece como suspensa, nunca como contagem negativa.
   *
   * Uma vez suspensa, `diasRestantes` fica negativo (carencia ja esgotada ha
   * N dias) -- mostrar "-3 dias" seria confuso: a suspensao ja aconteceu.
   */
  it('mostra "suspensa" e nunca um numero negativo quando o tenant esta suspenso', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: [
        {
          ...TENANT_BASE,
          status: 'SUSPENDED',
          cobranca: { diasRestantes: -3, emAbertoMinor: 596250 },
        },
      ],
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByText(/suspensa/i)).toBeInTheDocument();
    expect(screen.queryByText(/-3/)).not.toBeInTheDocument();
  });

  /**
   * F65 -- academia em dia nao mostra contagem nenhuma.
   *
   * Ruido nas linhas em dia esconderia justamente a que importa: se "dias"
   * aparecesse em toda linha, a contagem regressiva perderia o sentido de
   * aviso.
   */
  it('nao mostra contagem nenhuma quando a academia esta em dia', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: [{ ...TENANT_BASE, status: 'ACTIVE', cobranca: null }],
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.queryByText(/dias/)).not.toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });
});
