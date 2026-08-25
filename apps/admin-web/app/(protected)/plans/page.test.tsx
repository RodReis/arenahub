import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

/**
 * `page.tsx` e Server Component async: chama `chamarApi`, que e
 * `server-only` e usa `next/headers`. O mock troca a chamada de rede pelo
 * dado fixo -- mesma ideia do mock de Server Action nos outros testes desta
 * pasta, so que aqui e a leitura, nao a escrita.
 */
vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

// A pagina renderiza `FormularioDePlano` e `AcaoDeReajuste`, que falam com
// Server Actions -- mesmo mock de todo teste que passa por elas.
vi.mock('../../actions/membership', () => ({
  cadastrarPlano: vi.fn(),
  reajustarPreco: vi.fn(),
  alterarAtivacaoDePlano: vi.fn(),
  editarPlano: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDePlanos from './page';

const UNIDADE = { id: 'unidade-1', name: 'Unidade Centro', timezone: 'America/Sao_Paulo' };

function plano(sobrescritas: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plano-1',
    name: 'Programa Adultos',
    description: null,
    isActive: true,
    gymUnitIds: [UNIDADE.id],
    janelas: [],
    currentPrice: { amountMinor: 15000, currency: 'BRL', validFrom: '2026-08-24T00:00:00.000Z' },
    prices: [{ amountMinor: 15000, currency: 'BRL', validFrom: '2026-08-24T00:00:00.000Z' }],
    ...sobrescritas,
  };
}

/**
 * F53: preco vigente precisa aparecer na listagem -- sem ele a recepcao nao
 * sabe quanto o plano cobra sem abrir a ficha.
 */
describe('pagina de planos -- preco vigente na listagem', () => {
  it('mostra o preco vigente formatado em reais', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/plans') {
        return Promise.resolve({ ok: true, dados: [plano()], cookiesDaApi: [] });
      }
      return Promise.resolve({ ok: true, dados: [UNIDADE], cookiesDaApi: [] });
    });

    const elemento = await PaginaDePlanos();
    render(<ToastProvider>{elemento}</ToastProvider>);

    /*
     * DENTRO DA TABELA, e nao em qualquer lugar da tela: desde que o
     * reajuste virou modal (24/08/2026), o historico de vigencias fica
     * montado no DOM e repete o mesmo preco. `getByText` solto passou a
     * achar dois -- e o que este teste garante e a COLUNA de preco.
     */
    expect(screen.getByTestId('preco-do-plano-plano-1')).toHaveTextContent('R$ 150,00');
  });

  it('mostra aviso quando o plano nao tem preco vigente', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/plans') {
        return Promise.resolve({
          ok: true,
          dados: [plano({ currentPrice: null, prices: [] })],
          cookiesDaApi: [],
        });
      }
      return Promise.resolve({ ok: true, dados: [UNIDADE], cookiesDaApi: [] });
    });

    const elemento = await PaginaDePlanos();
    render(<ToastProvider>{elemento}</ToastProvider>);

    expect(screen.getByTestId('plano-plano-1')).toHaveTextContent(/sem preço vigente/i);
  });
  /**
   * DUAS ABAS na tela de planos (decisao do PI, 24/08/2026) -- mesmo motivo
   * da ficha do aluno: a listagem e o formulario de criacao viviam
   * empilhados, e quem vinha CONFERIR um plano rolava a pagina inteira por
   * cima de um formulario que nao ia usar.
   */
  it('divide a tela em Planos cadastrados e Criar plano', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/plans') {
        return Promise.resolve({ ok: true, dados: [plano()], cookiesDaApi: [] });
      }
      return Promise.resolve({ ok: true, dados: [UNIDADE], cookiesDaApi: [] });
    });

    const elemento = await PaginaDePlanos();
    render(<ToastProvider>{elemento}</ToastProvider>);

    expect(screen.getByTestId('aba-lista-de-planos')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('aba-novo-plano')).toHaveAttribute('aria-selected', 'false');
  });
});
