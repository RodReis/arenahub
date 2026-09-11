import { render, screen, within } from '@testing-library/react';
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

describe('pagina de clientes (Super Admin)', () => {
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
  it('mostra "suspenso" e nunca um numero negativo quando o tenant esta suspenso', async () => {
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

    /*
      DENTRO DA TABELA: a faixa de resumo tambem conta suspensos, e uma busca
      solta por "suspenso" casaria com as duas -- passando mesmo que a coluna
      de situacao da linha deixasse de dizer o estado.
    */
    const tabela = screen.getByTestId('tabela-de-academias');

    expect(within(tabela).getByText(/suspenso/i)).toBeInTheDocument();
    expect(screen.queryByText(/-3/)).not.toBeInTheDocument();
  });

  /**
   * F65 -- cliente em dia nao mostra contagem nenhuma.
   *
   * Ruido nas linhas em dia esconderia justamente a que importa: se "dias"
   * aparecesse em toda linha, a contagem regressiva perderia o sentido de
   * aviso.
   */
  it('nao mostra contagem nenhuma quando o cliente esta em dia', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: [{ ...TENANT_BASE, status: 'ACTIVE', cobranca: null }],
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.queryByText(/dias/)).not.toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
  });

  /*
   * F68 -- a faixa de resumo, derivada da mesma lista que a tabela mostra.
   */
  describe('resumo da carteira', () => {
    it('decompoe a base em ativos e inativos, e soma o que esta em aberto', async () => {
      /*
       * A DECOMPOSICAO e o ponto: o inativo domina a conta (66% na base real),
       * e um total sozinho esconderia o risco que o dono do SaaS abre a tela
       * para ver.
       */
      vi.mocked(chamarApi).mockResolvedValue({
        ok: true,
        dados: [
          {
            ...TENANT_BASE,
            status: 'ACTIVE',
            cobranca: { diasRestantes: 7, emAbertoMinor: 596_250 },
          },
          {
            ...TENANT_BASE,
            id: '22222222-2222-4222-8222-222222222222',
            slug: 'outra',
            displayName: 'Outra',
            alunosAtivos: 100,
            alunosInativos: 80,
            status: 'ACTIVE',
            cobranca: null,
          },
        ],
        cookiesDaApi: [],
      });

      await renderizar();

      const alunos = screen.getByTestId('resumo-alunos');

      // 400 + 120 + 100 + 80
      expect(alunos).toHaveTextContent('700');
      expect(alunos).toHaveTextContent('500 ativos');
      expect(alunos).toHaveTextContent('200 inativos');

      expect(screen.getByTestId('resumo-inadimplencia')).toHaveTextContent(
        '1 cliente com fatura vencida',
      );
    });

    it('sem fatura vencida, a celula de inadimplencia PERDE o tom', async () => {
      /*
       * "Nada vencido" e o estado normal, e nao uma boa noticia: pinta-lo de
       * positivo faria o alerta e a rotina disputarem a mesma atencao. O tom
       * so existe quando ha estado a descrever.
       */
      vi.mocked(chamarApi).mockResolvedValue({
        ok: true,
        dados: [{ ...TENANT_BASE, status: 'ACTIVE', cobranca: null }],
        cookiesDaApi: [],
      });

      await renderizar();

      const celula = screen.getByTestId('resumo-inadimplencia');

      expect(celula).not.toHaveAttribute('data-tom');
      expect(celula).toHaveTextContent('Nenhuma fatura vencida');
    });

    it('com fatura vencida, a celula veste o tom de risco', async () => {
      vi.mocked(chamarApi).mockResolvedValue({
        ok: true,
        dados: [
          {
            ...TENANT_BASE,
            status: 'ACTIVE',
            cobranca: { diasRestantes: 2, emAbertoMinor: 100_000 },
          },
        ],
        cookiesDaApi: [],
      });

      await renderizar();

      expect(screen.getByTestId('resumo-inadimplencia')).toHaveAttribute('data-tom', 'risco');
    });

    it('a faixa NAO aparece com a carteira vazia', async () => {
      /*
       * Tres zeros e um "R$ 0,00" afirmariam sobre o mundo o que e so ausencia
       * de cadastro -- e o estado vazio abaixo ja diz isso melhor.
       */
      vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: [], cookiesDaApi: [] });

      await renderizar();

      expect(screen.queryByTestId('resumo-da-carteira')).not.toBeInTheDocument();
      expect(screen.getByTestId('lista-vazia')).toBeInTheDocument();
    });
  });
});
