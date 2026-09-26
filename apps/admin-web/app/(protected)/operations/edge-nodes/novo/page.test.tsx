import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../../../lib/api/server-client';
import PaginaDeNovoEdgeNode from './page';

const MATRIZ = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Matriz',
  status: 'ACTIVE',
  timezone: 'America/Sao_Paulo',
};

const FECHADA = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Unidade Fechada',
  status: 'INACTIVE',
  timezone: 'America/Sao_Paulo',
};

function responder(unidades: unknown[]) {
  vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: unidades, cookiesDaApi: [] });
}

async function renderizar() {
  const elemento = await PaginaDeNovoEdgeNode();

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('cadastro de Edge', () => {
  it('oferece as unidades ativas no seletor', async () => {
    responder([MATRIZ]);

    await renderizar();

    expect(screen.getByTestId('campo-unidade-do-edge-node')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Matriz' })).toBeInTheDocument();
  });

  /*
   * Unidade inativa nao recebe Edge novo -- a academia fechou aquela porta.
   * Mesma regra do cadastro de dispositivo.
   */
  it('nao oferece unidade inativa', async () => {
    responder([MATRIZ, FECHADA]);

    await renderizar();

    expect(screen.queryByRole('option', { name: 'Unidade Fechada' })).not.toBeInTheDocument();
  });

  it('pede o codigo do Edge', async () => {
    responder([MATRIZ]);

    await renderizar();

    expect(screen.getByTestId('campo-codigo-do-edge-node')).toBeInTheDocument();
  });

  /*
   * Sem unidade nao ha Edge: a tela DIZ o que fazer em vez de mostrar um
   * seletor vazio que nunca envia.
   */
  it('manda cadastrar unidade quando nao ha nenhuma ativa', async () => {
    responder([FECHADA]);

    await renderizar();

    expect(screen.getByTestId('sem-unidades')).toBeInTheDocument();
    expect(screen.queryByTestId('confirmar-edge-node')).not.toBeInTheDocument();
  });
});

