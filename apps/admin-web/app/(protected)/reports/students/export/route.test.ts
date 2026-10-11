import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lerCookie = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: lerCookie }),
}));

import { GET } from './route';

const requisicao = (query: string) =>
  new Request(`http://painel.test/reports/students/export?${query}`) as never;

describe('GET /reports/students/export', () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    lerCookie.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it('sem cookie de acesso: 404 e a API nem é chamada', async () => {
    lerCookie.mockReturnValue(undefined);
    const chamada = vi.fn();
    globalThis.fetch = chamada as never;

    const resposta = await GET(requisicao('format=csv'));

    expect(resposta.status).toBe(404);
    expect(chamada).not.toHaveBeenCalled();
  });

  it('format inválido: 400 e a API nem é chamada', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    const chamada = vi.fn();
    globalThis.fetch = chamada as never;

    expect((await GET(requisicao('format=xlsx'))).status).toBe(400);
    expect((await GET(requisicao(''))).status).toBe(400);
    expect(chamada).not.toHaveBeenCalled();
  });

  it('repassa SÓ o cookie de acesso e SÓ as chaves do filtro (nada de tenantId)', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    const chamada = vi.fn(() => Promise.resolve(new Response('x', { status: 200 })));
    globalThis.fetch = chamada;

    await GET(requisicao('format=pdf&status=ACTIVE&tenantId=outro&financeiro=PAGANTES&lixo=1'));

    const [url, opcoes] = chamada.mock.calls[0] as unknown as [string, RequestInit];
    const alvo = new URL(url);

    expect(alvo.pathname).toBe('/api/v1/reports/students/export');
    expect(Object.fromEntries(alvo.searchParams)).toEqual({
      format: 'pdf',
      status: 'ACTIVE',
      financeiro: 'PAGANTES',
    });
    expect(opcoes.headers).toEqual({ cookie: 'arenahub_access=tok' });
  });

  it('devolve o corpo e só os cabeçalhos de download', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('conteudo', {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="relatorio-alunos-2026-10-10.csv"',
            'x-content-type-options': 'nosniff',
            'set-cookie': 'arenahub_refresh=vaza',
            'x-interno': 'segredo',
          },
        }),
      ));

    const resposta = await GET(requisicao('format=csv'));

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe('conteudo');
    expect(resposta.headers.get('content-disposition')).toContain('relatorio-alunos-2026-10-10.csv');
    expect(resposta.headers.get('set-cookie')).toBeNull();
    expect(resposta.headers.get('x-interno')).toBeNull();
  });

  it('422 (acima do teto): volta para a tela com o filtro e `erro=muito-grande`, sem `format`', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    globalThis.fetch = (() =>
      Promise.resolve(new Response('{"code":"REPORT_TOO_LARGE"}', { status: 422 })));

    const resposta = await GET(requisicao('format=csv&status=ACTIVE&tenantId=outro'));

    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe(
      '/reports/students?status=ACTIVE&erro=muito-grande',
    );
    expect(await resposta.text()).toBe('');
  });

  it('outro erro da API (403, 500...): volta para a tela com `erro=falha`', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });

    for (const status of [401, 403, 500]) {
      globalThis.fetch = (() => Promise.resolve(new Response('x', { status })));

      const resposta = await GET(requisicao('format=pdf'));

      expect(resposta.status).toBe(303);
      expect(resposta.headers.get('location')).toBe('/reports/students?erro=falha');
    }
  });

  it('API fora do ar: volta para a tela com `erro=falha`, não página em branco', async () => {
    lerCookie.mockReturnValue({ name: 'arenahub_access', value: 'tok' });
    globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED')));

    const resposta = await GET(requisicao('format=csv'));

    expect(resposta.status).toBe(303);
    expect(resposta.headers.get('location')).toBe('/reports/students?erro=falha');
  });
});
