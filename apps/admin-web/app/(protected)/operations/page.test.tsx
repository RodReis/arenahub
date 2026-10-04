import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@arenahub/ui';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

/** A URL do caso: o select lê a unidade daqui, como no navegador. */
const url = vi.hoisted(() => ({ busca: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/operations',
  useSearchParams: () => url.busca,
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDeOperacao from './page';

const UNIDADE = '44444444-4444-4444-8444-444444444444';
const FILIAL = '55555555-5555-4555-8555-555555555555';

const ARENA = { id: UNIDADE, name: 'Arena Positiva', timezone: 'America/Sao_Paulo', status: 'ACTIVE' };
const CENTRO = { id: FILIAL, name: 'Filial Centro', timezone: 'America/Sao_Paulo', status: 'ACTIVE' };

const AGORA = Date.now();
const HA_10_S = new Date(AGORA - 10_000).toISOString();
const HA_22_H = new Date(AGORA - 22 * 3_600_000).toISOString();

function panorama(sobrescrever: Record<string, unknown> = {}) {
  return {
    edges: [
      {
        id: 'e1',
        codigo: 'RECEPCAO-01',
        gymUnitId: UNIDADE,
        status: 'ACTIVE',
        agentVersion: '1.4.0',
        ultimoHeartbeat: HA_10_S,
        derivaMs: -2000,
      },
    ],
    dispositivos: [
      {
        id: 'd1',
        serial: 'AYTI11108174',
        modelo: 'Inner Fit',
        kind: 'FACE_READER',
        status: 'ACTIVE',
        gymUnitId: UNIDADE,
        ultimoHeartbeat: HA_10_S,
        ultimoSync: HA_10_S,
      },
    ],
    sync: { pendentes: 0, processando: 0, falhados: 0, deadLetters: 0, totalDoDia: 0, sucessosDoDia: 0, desde: '2026-10-04T02:00:00.000Z' },
    acesso: { allow: 2, deny: 0, override: 0 },
    ...sobrescrever,
  };
}

const ALERTA_CRITICO = {
  id: 'a1',
  code: 'EDGE_OFFLINE',
  severity: 'CRITICAL',
  state: 'OPEN',
  resource: 'edge_node',
  resourceId: 'e1',
  gymUnitId: UNIDADE,
  impact: 'A catraca desta unidade não está liberando acesso.',
  recommendedAction: 'Verifique o PC da academia.',
  firstSeenAt: HA_22_H,
  lastSeenAt: HA_10_S,
};

interface Respostas {
  readonly panorama?: unknown;
  readonly alertas?: unknown[] | 'falha';
  readonly unidades?: unknown[];
}

function responder({ panorama: p = panorama(), alertas = [], unidades = [ARENA] }: Respostas = {}) {
  vi.mocked(chamarApi).mockImplementation((caminho: string) => {
    if (caminho.startsWith('/api/v1/operations/overview')) {
      return Promise.resolve({ ok: true, dados: p, cookiesDaApi: [] });
    }

    if (caminho.startsWith('/api/v1/operations/alerts')) {
      return alertas === 'falha'
        ? Promise.resolve({
            ok: false,
            erro: { type: 'about:blank', title: 'Erro', status: 500, code: 'INTERNAL', correlationId: 'x' },
            cookiesDaApi: [],
          })
        : Promise.resolve({ ok: true, dados: alertas, cookiesDaApi: [] });
    }

    return Promise.resolve({
      ok: true,
      dados: unidades,
      cookiesDaApi: [],
    });
  });
}

async function renderizar(busca: { unidade?: string } = {}) {
  url.busca = new URLSearchParams(busca);
  const elemento = await PaginaDeOperacao({ searchParams: Promise.resolve(busca) });

  return render(<ToastProvider>{elemento}</ToastProvider>);
}

describe('painel de operação', () => {
  it('com tudo respondendo e sem alerta, diz que está tudo bem', async () => {
    responder();
    await renderizar();

    const faixa = screen.getByTestId('resumo-da-operacao');

    expect(faixa).toHaveAttribute('data-nivel', 'ok');
    expect(faixa).toHaveTextContent('Nenhum problema crítico agora.');
  });

  it('crítico aberto vira alarme, com a idade do mais antigo e o alerta tingido', async () => {
    responder({
      panorama: panorama({
        edges: [{ ...panorama().edges[0], ultimoHeartbeat: HA_22_H }],
      }),
      alertas: [ALERTA_CRITICO],
    });
    await renderizar();

    const faixa = screen.getByTestId('resumo-da-operacao');

    expect(faixa).toHaveAttribute('data-nivel', 'critico');
    expect(faixa).toHaveTextContent('1 problema crítico impedindo acesso agora.');
    expect(faixa).toHaveTextContent('há 22h');
    expect(screen.getByTestId('alerta-EDGE_OFFLINE')).toHaveAttribute('data-tom', 'negativo');
    expect(screen.getByTestId('contagem-fora-do-ar')).toHaveTextContent(
      '1 Edge(s) e 0 dispositivo(s) sem resposta.',
    );
  });

  /**
   * O DEFEITO QUE ESTE TESTE EXISTE PARA PEGAR: a leitura dos alertas falhava
   * e a tela caía no estado vazio, afirmando "Nenhum problema crítico agora" e
   * "Edge e dispositivos respondendo" sem ter lido nada.
   */
  it('alerta ilegível NÃO é apresentado como "nenhum problema"', async () => {
    responder({ alertas: 'falha' });
    await renderizar();

    const faixa = screen.getByTestId('resumo-da-operacao');

    expect(faixa).toHaveAttribute('data-nivel', 'indisponivel');
    expect(faixa).not.toHaveTextContent('Nenhum problema crítico');
    expect(screen.getByTestId('erro-de-alertas')).toBeInTheDocument();
    expect(screen.queryByTestId('sem-alertas')).not.toBeInTheDocument();
  });

  it('equipamento mudo sem alerta ainda aberto pinta atenção, não "tudo bem"', async () => {
    responder({
      panorama: panorama({
        edges: [{ ...panorama().edges[0], ultimoHeartbeat: HA_22_H }],
      }),
    });
    await renderizar();

    expect(screen.getByTestId('resumo-da-operacao')).toHaveAttribute('data-nivel', 'atencao');
    expect(screen.getByTestId('estado-do-edge-RECEPCAO-01')).toHaveTextContent('Sem resposta');
  });

  it('todo estado tem TEXTO além da cor', async () => {
    responder();
    await renderizar();

    expect(screen.getByTestId('estado-do-edge-RECEPCAO-01')).toHaveTextContent('Respondendo');
    expect(screen.getByTestId('estado-do-dispositivo-AYTI11108174')).toHaveTextContent(
      'Respondendo',
    );
  });

  it('Edge suspenso e leitor aposentado não viram "sem resposta"', async () => {
    responder({
      panorama: panorama({
        edges: [{ ...panorama().edges[0], status: 'SUSPENDED', ultimoHeartbeat: HA_22_H }],
        dispositivos: [
          { ...panorama().dispositivos[0], status: 'RETIRED', ultimoHeartbeat: HA_22_H },
        ],
      }),
    });
    await renderizar();

    expect(screen.getByTestId('estado-do-edge-RECEPCAO-01')).toHaveTextContent('Suspenso');
    expect(screen.getByTestId('estado-do-dispositivo-AYTI11108174')).toHaveTextContent(
      'Aposentado',
    );
    expect(screen.getByTestId('contagem-fora-do-ar')).toHaveTextContent(
      '0 Edge(s) e 0 dispositivo(s) sem resposta.',
    );
  });

  it('falha de sincronização ganha tom e leva à fila; sem volume não vira "0%"', async () => {
    responder({
      panorama: panorama({
        sync: { pendentes: 1, processando: 0, falhados: 2, deadLetters: 2, totalDoDia: 0, sucessosDoDia: 0, desde: '2026-10-04T02:00:00.000Z' },
      }),
    });
    await renderizar();

    const sync = screen.getByTestId('resumo-de-sync');
    const falhadas = within(sync).getByTestId('resumo-falhadas');

    expect(falhadas).toHaveAttribute('data-tom', 'risco');
    expect(within(falhadas).getByRole('link', { name: /ver a fila/ })).toHaveAttribute(
      'href',
      '/operations/devices',
    );
    expect(within(sync).getByTestId('resumo-taxa')).toHaveTextContent('sem sincronizações desde 23:00');
    expect(within(sync).getByTestId('resumo-taxa')).not.toHaveTextContent('0%');
  });

  it('mantém os títulos de seção e as âncoras que a jornada do turno usa', async () => {
    responder();
    await renderizar();

    for (const titulo of ['Alertas', 'Edge', 'Dispositivos', 'Sincronização de biometria']) {
      expect(screen.getByRole('heading', { name: titulo })).toBeInTheDocument();
    }

    expect(screen.getByTestId('resumo-de-acesso')).toBeInTheDocument();
    expect(screen.getByTestId('novo-edge-node')).toBeInTheDocument();
    expect(screen.getByTestId('estado-da-operacao')).toHaveTextContent('ao vivo');
  });
});

/** Chamadas feitas à API, só o caminho -- é o que prova o filtro repassado. */
function caminhosChamados(): string[] {
  return vi.mocked(chamarApi).mock.calls.map(([caminho]) => caminho);
}

describe('filtro por unidade -- issue #549', () => {
  it('com uma unidade só, mostra o nome dela e não oferece select', async () => {
    vi.mocked(chamarApi).mockClear();
    responder();
    await renderizar();

    const unidade = screen.getByTestId('unidade-da-operacao');

    expect(unidade).toHaveTextContent('Arena Positiva');
    expect(unidade.tagName).not.toBe('SELECT');
  });

  it('com várias unidades e nenhuma escolhida, o select mostra "Todas" e nada é filtrado', async () => {
    vi.mocked(chamarApi).mockClear();
    responder({ unidades: [ARENA, CENTRO] });
    await renderizar();

    const select = screen.getByTestId('unidade-da-operacao');

    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveDisplayValue('Todas as unidades');
    expect(caminhosChamados().some((c) => c.includes('gymUnitId'))).toBe(false);
  });

  it('a unidade escolhida vai para o panorama E para os alertas', async () => {
    vi.mocked(chamarApi).mockClear();
    responder({ unidades: [ARENA, CENTRO] });
    await renderizar({ unidade: FILIAL });

    expect(screen.getByTestId('unidade-da-operacao')).toHaveDisplayValue('Filial Centro');
    expect(caminhosChamados()).toEqual(
      expect.arrayContaining([
        `/api/v1/operations/overview?gymUnitId=${FILIAL}`,
        `/api/v1/operations/alerts?open=true&limit=50&gymUnitId=${FILIAL}`,
      ]),
    );
  });

  it('unidade fora do escopo diz que não achou a unidade, e não "sem permissão"', async () => {
    responder({ unidades: [ARENA, CENTRO] });
    vi.mocked(chamarApi).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        erro: { type: 'about:blank', title: 'Not Found', status: 404, code: 'UNIT_NOT_FOUND', correlationId: 'x' },
        cookiesDaApi: [],
      }),
    );
    await renderizar({ unidade: FILIAL });

    expect(screen.getByTestId('erro-de-permissao')).toHaveTextContent('Unidade não encontrada');
    expect(screen.getByTestId('unidade-da-operacao')).toBeInTheDocument();
  });
});
