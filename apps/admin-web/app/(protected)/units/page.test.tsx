import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDeUnidades from './page';

const UNIDADE = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'MATRIZ',
  name: 'Unidade Matriz',
  timezone: 'America/Sao_Paulo',
  status: 'ACTIVE',
};

async function renderizar() {
  const elemento = await PaginaDeUnidades();

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('pagina de unidades', () => {
  /**
   * O BUG QUE ESTE TESTE EXISTE PARA PEGAR (24/08/2026).
   *
   * O botao "Nova unidade" foi parar no `PageHeader` do bloco de ERRO --
   * aquele que so renderiza quando a API recusa a consulta. Na tela normal,
   * que e a que a recepcao ve, nao havia botao nenhum: `POST /units` existia
   * na API e continuava sem porta de entrada.
   *
   * Lint, typecheck, testes e CI passaram todos: nenhum deles verifica em
   * QUAL dos dois cabecalhos o botao esta. So olhando a tela -- e foi o PI
   * quem viu, tres vezes.
   */
  it('mostra a acao de cadastrar na tela que carregou com sucesso', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: [UNIDADE], cookiesDaApi: [] });

    await renderizar();

    expect(screen.getByTestId('nova-unidade')).toHaveAttribute('href', '/units/nova');
  });

  /**
   * O CAMINHO DE ERRO NAO OFERECE CADASTRO.
   *
   * Quem nao tem permissao para LISTAR unidade tambem nao tem para criar --
   * `unit.read` e `unit.create` sao permissoes distintas, mas oferecer a
   * acao numa tela que acabou de dizer "sem permissao" manda a pessoa bater
   * numa segunda negativa.
   */
  it('nao oferece cadastro quando a consulta foi recusada', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Sem permissao',
        status: 403,
        code: 'FORBIDDEN',
        correlationId: 'teste',
      },
      cookiesDaApi: [],
    });

    await renderizar();

    expect(screen.getByTestId('erro-de-permissao')).toBeInTheDocument();
    expect(screen.queryByTestId('nova-unidade')).not.toBeInTheDocument();
  });

  /**
   * "Vazio SEM saida e beco", como o proprio `EmptyState` documenta -- e a
   * dica desta tela MANDAVA cadastrar sem oferecer caminho.
   */
  it('oferece cadastro tambem no estado vazio', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: [], cookiesDaApi: [] });

    await renderizar();

    expect(screen.getByTestId('nova-unidade-vazio')).toHaveAttribute('href', '/units/nova');
  });
});
