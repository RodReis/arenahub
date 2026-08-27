import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` lanca fora de bundle Next (ve nota em route.ts) -- mock vazio
// e o jeito padrao de testar um route handler que o importa.
vi.mock('server-only', () => ({}));

const SESSAO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/**
 * Prova que a ponte assinada aceita PATCH -- Critical 1 da revisao da F30.
 *
 * O bug era `type Metodo` fechado sem 'PATCH' e nenhum `export async function
 * PATCH`: o Next devolvia 405 antes de `repassar` rodar. Um teste que so
 * checasse `typeof PATCH === 'function'` provaria a exportacao mas nao que a
 * requisicao chega ao destino com metodo, corpo e cabecalhos certos -- por
 * isso este teste inspeciona a chamada real a `fetch`.
 */
describe('ponte assinada do kiosk -- PATCH', () => {
  const ambienteOriginal = { ...process.env };

  beforeEach(() => {
    process.env['KIOSK_KEY_ID'] = 'kiosk-teste';
    process.env['KIOSK_SECRET'] = 'segredo-de-teste';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ambienteOriginal };
    vi.restoreAllMocks();
  });

  it('repassa PATCH para a API com metodo, corpo e assinatura', async () => {
    const fetchMock = vi.fn((_url: string, _opcoes: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { PATCH } = await import('./route');

    const corpo = { finalidade: 'RANKING', participa: false, idempotencyKey: 'k1' };
    const requisicao = new Request(
      `http://localhost:8081/api/kiosk/sessions/${SESSAO}/engajamento/preferencias`,
      {
        method: 'PATCH',
        headers: { 'x-session-token': 'token-da-sessao', 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      },
    );

    const resposta = await PATCH(requisicao);

    expect(resposta.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const chamada = fetchMock.mock.calls[0];
    if (!chamada) throw new Error('esperava uma chamada a fetch');

    const [urlChamada, opcoes] = chamada;
    expect(urlChamada).toBe(
      `http://localhost:3344/api/v1/kiosk/sessions/${SESSAO}/engajamento/preferencias`,
    );
    expect(opcoes.method).toBe('PATCH');
    expect(opcoes.body).toBe(JSON.stringify(corpo));

    const cabecalhos = opcoes.headers as Record<string, string>;
    expect(cabecalhos['x-session-token']).toBe('token-da-sessao');
    expect(cabecalhos['content-type']).toBe('application/json');
    expect(cabecalhos['x-kiosk-key-id']).toBe('kiosk-teste');
    expect(typeof cabecalhos['x-kiosk-signature']).toBe('string');
    expect((cabecalhos['x-kiosk-signature'] ?? '').length).toBeGreaterThan(0);
  });

  it('caminho fora da allowlist recusa PATCH com 404, sem chamar a API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { PATCH } = await import('./route');

    const requisicao = new Request('http://localhost:8081/api/kiosk/admin', {
      method: 'PATCH',
      body: JSON.stringify({}),
    });

    const resposta = await PATCH(requisicao);

    expect(resposta.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
