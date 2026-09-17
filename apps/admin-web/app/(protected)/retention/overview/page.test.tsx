import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import VisaoGeralDeRetencaoPage from './page';

const OVERVIEW = {
  pipeline: { state: 'SAUDAVEL' as const, hoursSinceLastRun: 6 },
  riskQueue: { BAIXO: 10, MEDIO: 4, ALTO: 2, CRITICO: 1 },
  taskQueue: { ABERTA: 2, CONCLUIDA: 1 },
};

async function renderizar(overview: unknown = OVERVIEW) {
  vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: overview, cookiesDaApi: [] });

  const elemento = await VisaoGeralDeRetencaoPage();

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('visão geral de retenção', () => {
  it('mostra o estado do pipeline e sua idade', async () => {
    await renderizar();

    expect(screen.getByTestId('estado-do-pipeline')).toHaveTextContent('Saudável');
    expect(screen.getByText(/última execução há 6h/i)).toBeInTheDocument();
  });

  it('mostra a fila de risco por banda e o total', async () => {
    await renderizar();

    expect(screen.getByTestId('total-da-fila-de-risco')).toHaveTextContent('17');
    const fila = screen.getByTestId('fila-de-risco-por-banda');
    expect(fila).toHaveTextContent('Baixo');
    expect(fila).toHaveTextContent('10');
    expect(fila).toHaveTextContent('Crítico');
    expect(fila).toHaveTextContent('1');
  });

  it('mostra so os estados de tarefa com contagem maior que zero', async () => {
    await renderizar();

    const fila = screen.getByTestId('fila-de-tarefas-por-estado');
    expect(fila).toHaveTextContent('Aberta');
    expect(fila).toHaveTextContent('Concluída');
    expect(fila).not.toHaveTextContent('Dispensada');
  });

  it('nunca rodou tinge o bloco do pipeline e a fila de risco fica vazia', async () => {
    await renderizar({
      pipeline: { state: 'NUNCA_RODOU', hoursSinceLastRun: null },
      riskQueue: { BAIXO: 0, MEDIO: 0, ALTO: 0, CRITICO: 0 },
      taskQueue: {},
    });

    expect(screen.getByTestId('estado-do-pipeline')).toHaveTextContent('Nunca rodou');
    expect(screen.getByText(/sem execução registrada/i)).toBeInTheDocument();
    expect(screen.getByTestId('sem-score-na-fila')).toBeInTheDocument();
    expect(screen.getByTestId('sem-tarefa-na-fila')).toBeInTheDocument();
  });

  it('mostra erro quando a api recusa', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      dados: null,
      cookiesDaApi: [],
      erro: {
        type: 'about:blank',
        title: 'Sem permissão',
        status: 403,
        code: 'SEM_PERMISSAO',
        correlationId: 'c1',
      },
    });

    const elemento = await VisaoGeralDeRetencaoPage();
    render(<ToastProvider>{elemento}</ToastProvider>);

    expect(screen.getByTestId('erro-de-permissao')).toBeInTheDocument();
  });
});
