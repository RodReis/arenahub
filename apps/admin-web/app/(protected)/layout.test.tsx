import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

/*
 * `usePathname` entra junto: o layout renderiza `Navegacao`, que o usa para
 * marcar o item atual. Sem ele o mock derruba a árvore inteira.
 */
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => '/students',
}));

vi.mock('../actions/auth', () => ({
  sair: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import LayoutProtegido from './layout';

const PERFIL = { id: 'u1', email: 'dono@arena-positiva.test' };

function unidade(nome: string, status = 'ACTIVE') {
  return { id: `id-${nome}`, name: nome, status };
}

function responder(unidades: unknown[]) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho === '/api/v1/units') {
      return Promise.resolve({ ok: true, dados: unidades, cookiesDaApi: [] });
    }
    return Promise.resolve({ ok: true, dados: PERFIL, cookiesDaApi: [] });
  });
}

async function renderizar() {
  const elemento = await LayoutProtegido({ children: <p>conteúdo</p> });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

/**
 * O TOPBAR dizia "Unidade não selecionada" mesmo com a Matriz cadastrada --
 * mandava a recepção escolher algo que não havia onde escolher. O texto vinha
 * de quando o painel não consultava unidade nenhuma.
 */
describe('indicador de unidade no topbar', () => {
  it('com UMA unidade ativa, mostra o nome dela', async () => {
    responder([unidade('Unidade Matriz')]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('Unidade Matriz');
  });

  /**
   * Com VÁRIAS o painel ainda não sabe qual está em uso: a troca exige
   * decisão de produto sobre persistência e escopo de sessão (DS-PAINEL §5).
   * Dizer quantas é mais verdadeiro que fingir uma escolha.
   */
  it('com mais de uma, diz quantas em vez de fingir uma escolha', async () => {
    responder([unidade('Matriz'), unidade('Zona Sul')]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('2 unidades');
  });

  it('sem nenhuma, o texto convida a cadastrar', async () => {
    responder([]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('Nenhuma unidade cadastrada');
  });

  /**
   * UNIDADE INATIVA NÃO CONTA: a academia fechou aquela porta, e contá-la
   * faria o topbar dizer "2 unidades" para quem opera uma só.
   */
  it('ignora unidade inativa na contagem', async () => {
    responder([unidade('Matriz'), unidade('Antiga', 'INACTIVE')]);

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toHaveTextContent('Matriz');
  });

  /**
   * FALHA AO BUSCAR UNIDADE NÃO DERRUBA O PAINEL -- o indicador é apoio, e o
   * resto da tela responde sem ele.
   */
  it('sobrevive à falha na consulta de unidades', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) => {
      if (caminho === '/api/v1/units') {
        return Promise.resolve({
          ok: false,
          erro: {
            type: 'about:blank',
            title: 'erro',
            status: 500,
            code: 'ERRO',
            correlationId: 't',
          },
          cookiesDaApi: [],
        });
      }
      return Promise.resolve({ ok: true, dados: PERFIL, cookiesDaApi: [] });
    });

    await renderizar();

    expect(screen.getByTestId('unidade-ativa')).toBeInTheDocument();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
});
