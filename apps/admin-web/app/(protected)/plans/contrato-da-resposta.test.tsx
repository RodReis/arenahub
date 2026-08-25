import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

/*
 * Aqui `chamarApi` roda DE VERDADE -- e o oposto de `page.test.tsx`, que o
 * substitui por `vi.fn()`. Com o cliente mockado o schema nunca executa, e
 * um teste assim nao distingue "validou" de "nao valida nada" (issue #167).
 * O que se troca por dublê e o degrau de baixo: `fetch` e `next/headers`.
 */
vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ getAll: () => [] }),
}));

vi.mock('../../actions/membership', () => ({
  cadastrarPlano: vi.fn(),
  reajustarPreco: vi.fn(),
  alterarAtivacaoDePlano: vi.fn(),
  editarPlano: vi.fn(),
}));

import PaginaDePlanos from './page';

const UNIDADE = { id: 'unidade-1', name: 'Unidade Centro', timezone: 'America/Sao_Paulo' };

const PLANO_COMPLETO = {
  id: 'plano-1',
  name: 'Programa Adultos',
  description: null,
  isActive: true,
  gymUnitIds: [UNIDADE.id],
  janelas: [],
  currentPrice: { amountMinor: 15000, currency: 'BRL', validFrom: '2026-08-24T00:00:00.000Z' },
  prices: [{ amountMinor: 15000, currency: 'BRL', validFrom: '2026-08-24T00:00:00.000Z' }],
};

function respostaFalsa(corpo: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { getSetCookie: () => [], get: () => null },
    json: () => Promise.resolve(corpo),
  } as unknown as Response;
}

function servir(planos: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(respostaFalsa(url.includes('/plans') ? planos : [UNIDADE])),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('planos -- resposta fora do contrato', () => {
  /*
   * O caso exato do episodio de 24/08: a API respondeu SEM `prices`, e
   * `historico.length` em `acao-de-reajuste.tsx:75` quebrou o render com
   * `Cannot read properties of undefined (reading length)`.
   */
  it('renderiza erro tratado, e nao TypeError, quando falta um campo', async () => {
    const { prices: _ignorado, ...semPrices } = PLANO_COMPLETO;

    servir([semPrices]);

    const elemento = await PaginaDePlanos();
    render(<ToastProvider>{elemento}</ToastProvider>);

    const erro = screen.getByTestId('erro-de-permissao');

    expect(erro).toHaveTextContent(/fora do contrato/i);
    // O campo que divergiu tem de aparecer: e o que encurta o diagnostico.
    expect(erro).toHaveTextContent(/prices/);
  });

  it('renderiza a listagem normalmente quando a resposta casa com o contrato', async () => {
    servir([PLANO_COMPLETO]);

    const elemento = await PaginaDePlanos();
    render(<ToastProvider>{elemento}</ToastProvider>);

    expect(screen.queryByTestId('erro-de-permissao')).toBeNull();
    expect(screen.getByTestId('plano-plano-1')).toHaveTextContent('Programa Adultos');
  });
});
