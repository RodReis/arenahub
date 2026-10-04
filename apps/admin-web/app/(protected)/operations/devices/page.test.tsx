import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../../lib/api/server-client';
import PaginaDeSincronizacao from './page';

const UNIDADE = '44444444-4444-4444-8444-444444444444';
const OUTRA_UNIDADE = '55555555-5555-4555-8555-555555555555';

const ATIVO = {
  id: '11111111-1111-4111-8111-111111111111',
  gymUnitId: UNIDADE,
  edgeNodeId: null,
  model: 'Inner Fit',
  serial: 'AYTI11108174',
  status: 'ACTIVE',
  firmware: '1.2.0',
  lastHeartbeat: '2026-09-01T12:00:00.000Z',
  lastSyncAt: '2026-09-01T12:00:00.000Z',
};

const EM_MANUTENCAO = {
  id: '22222222-2222-4222-8222-222222222222',
  model: 'Inner Turn',
  serial: 'DEMO-CATRACA-01',
  status: 'MAINTENANCE',
  firmware: null,
  lastHeartbeat: null,
  lastSyncAt: null,
};

const APOSENTADO = {
  id: '33333333-3333-4333-8333-333333333333',
  model: 'Inner Fit',
  serial: '247000797',
  status: 'RETIRED',
  firmware: null,
  lastHeartbeat: null,
  lastSyncAt: null,
};

/** A tela faz tres chamadas em paralelo: fila de sync, dispositivos e Edges. */
function responder(dispositivos: unknown[], edges: unknown[] = []) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho.startsWith('/api/v1/devices')) {
      return Promise.resolve({ ok: true, dados: dispositivos, cookiesDaApi: [] });
    }

    if (caminho.startsWith('/api/v1/edge-nodes')) {
      return Promise.resolve({ ok: true, dados: edges, cookiesDaApi: [] });
    }

    return Promise.resolve({ ok: true, dados: [], cookiesDaApi: [] });
  });
}

async function renderizar() {
  const elemento = await PaginaDeSincronizacao();

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('tabela de equipamentos', () => {
  /**
   * O BUG QUE ESTE TESTE EXISTE PARA PEGAR (issue #241).
   *
   * `PATCH /api/v1/devices/:id` aceita `status` e `firmware` desde sempre, e
   * a tabela nao tinha nenhuma acao de linha -- mesmo defeito da issue #178
   * ("API pronta, painel sem tela"), em outra tela. Sem a acao, um leitor so
   * mudava de situacao por `curl`.
   */
  it('oferece editar em cada equipamento', async () => {
    responder([ATIVO]);

    await renderizar();

    expect(screen.getByTestId(`editar-dispositivo-${ATIVO.id}`)).toBeInTheDocument();
  });

  /**
   * TRES SITUACOES, TRES RESPOSTAS.
   *
   * O ternario anterior so distinguia `ACTIVE` de "todo o resto": manutencao
   * e aposentadoria caiam na MESMA frase ("Fora de operacao"). Enquanto
   * ninguem podia escolher a situacao pela tela isso era invisivel; com a
   * edicao, o operador marca "Em manutencao", recarrega e le "Fora de
   * operacao" -- e conclui que a alteracao nao salvou.
   */
  it('distingue manutencao de aposentadoria na coluna de situacao', async () => {
    responder([ATIVO, EM_MANUTENCAO, APOSENTADO]);

    await renderizar();

    /*
     * PELA CELULA, e nao por texto solto: o modal de edicao vive no DOM mesmo
     * fechado, e os `<option>` dele tambem dizem "Ativo" e "Em manutencao".
     * Procurar o texto na tela acharia dois de cada, e o teste falharia por
     * multiplicidade -- sem dizer nada sobre a celula, que e o que importa.
     */
    const situacao = (id: string) =>
      screen.getByTestId(`situacao-do-dispositivo-${id}`);

    expect(situacao(ATIVO.id)).toHaveTextContent('Ativo');
    expect(situacao(EM_MANUTENCAO.id)).toHaveTextContent('Em manutenção');
    expect(situacao(APOSENTADO.id)).toHaveTextContent('Aposentado');
  });

  /**
   * APOSENTAR NAO E EXCLUIR, E A TELA NAO PODE OFERECER DUAS VEZES.
   *
   * Nao existe `DELETE /devices/:id` e nao deve existir: `AccessEvent`
   * referencia o dispositivo, e apagar levaria o historico de quem passou na
   * catraca. Aposentar e o caminho -- e oferece-lo a quem JA esta aposentado
   * seria acao sem efeito.
   */
  it('nao oferece aposentar um equipamento que ja esta aposentado', async () => {
    responder([APOSENTADO]);

    await renderizar();

    expect(screen.queryByTestId(`aposentar-dispositivo-${APOSENTADO.id}`)).not.toBeInTheDocument();
  });

  it('oferece aposentar equipamento em operacao', async () => {
    responder([ATIVO]);

    await renderizar();

    expect(screen.getByTestId(`aposentar-dispositivo-${ATIVO.id}`)).toBeInTheDocument();
  });

  /**
   * #490 -- a reivindicacao automatica nao tinha desfazer pelo produto. O
   * seletor de Edge so oferece os da MESMA unidade do leitor (a API recusa o
   * resto) e some quando a unidade nao tem nenhum.
   */
  it('oferece so os Edges da unidade do leitor', async () => {
    responder(
      [ATIVO],
      [
        {
          id: 'a0000000-0000-4000-8000-00000000000a',
          gymUnitId: UNIDADE,
          code: 'EDGE-DA-UNIDADE',
          status: 'ACTIVE',
        },
        {
          id: 'b0000000-0000-4000-8000-00000000000b',
          gymUnitId: OUTRA_UNIDADE,
          code: 'EDGE-DE-FORA',
          status: 'ACTIVE',
        },
        {
          id: 'c0000000-0000-4000-8000-00000000000c',
          gymUnitId: UNIDADE,
          code: 'EDGE-SUSPENSO',
          status: 'SUSPENDED',
        },
      ],
    );

    await renderizar();

    const campo = screen.getByTestId(`campo-edge-do-dispositivo-${ATIVO.id}`);

    expect(campo).toHaveTextContent('EDGE-DA-UNIDADE');
    expect(campo).toHaveTextContent('Sem Edge');
    expect(campo).not.toHaveTextContent('EDGE-DE-FORA');
    expect(campo).not.toHaveTextContent('EDGE-SUSPENSO');
  });

  it('mantem o dono atual na lista mesmo suspenso, para a edicao nao apaga-lo', async () => {
    const suspenso = {
      id: 'c0000000-0000-4000-8000-00000000000c',
      gymUnitId: UNIDADE,
      code: 'EDGE-SUSPENSO',
      status: 'SUSPENDED',
    };

    responder([{ ...ATIVO, edgeNodeId: suspenso.id }], [suspenso]);

    await renderizar();

    const campo = screen.getByTestId(`campo-edge-do-dispositivo-${ATIVO.id}`);

    expect(campo).toHaveValue(suspenso.id);
  });

  it('esconde o campo de Edge quando a unidade nao tem nenhum', async () => {
    responder([ATIVO], []);

    await renderizar();

    expect(screen.queryByTestId(`campo-edge-do-dispositivo-${ATIVO.id}`)).not.toBeInTheDocument();
  });
});
