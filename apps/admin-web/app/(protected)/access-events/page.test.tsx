import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../../lib/api/server-client';
import PaginaDeEventos from './page';

function ok<T>(dados: T) {
  return { ok: true, dados, cookiesDaApi: [] };
}

const PAGINA_VAZIA = { eventos: [], periodoLimitado: false, cursor: null };

/**
 * FIX: `<input type="datetime-local">` manda `2026-09-01T12:04` -- sem
 * segundos, sem fuso. `z.string().datetime()` na API exige ISO-8601
 * completo, e a rota inteira recusava com `VALIDATION_FAILED` (mensagem
 * enganosa, falava em permissão) toda vez que o operador filtrava por
 * período -- e o defeito voltava a cada F5, porque o filtro fica salvo na
 * própria URL.
 */
describe('pagina de eventos de acesso', () => {
  // `chamarApi` e mock COMPARTILHADO entre testes: sem limpar as chamadas
  // acumuladas, `mock.calls[0]` do segundo teste ainda aponta para a
  // requisição do primeiro -- exatamente o jeito de um teste passar pelo
  // motivo errado.
  beforeEach(() => {
    vi.mocked(chamarApi).mockClear();
    vi.mocked(chamarApi).mockResolvedValue(ok(PAGINA_VAZIA));
  });

  it('converte from/to de datetime-local para ISO-8601 completo antes de chamar a API', async () => {
    const elemento = await PaginaDeEventos({
      searchParams: Promise.resolve({ from: '2026-09-01T12:04', to: '2026-09-23T12:04' }),
    });

    render(elemento);

    const [url] = vi.mocked(chamarApi).mock.calls[0] as [string];
    const consulta = new URL(url, 'http://localhost').searchParams;

    // ISO-8601 completo: dígitos, segundos e o `Z` de UTC -- nunca o valor
    // cru do input, que a API recusaria de novo.
    expect(consulta.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(consulta.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('from/to ausentes nao viram string vazia na query', async () => {
    const elemento = await PaginaDeEventos({ searchParams: Promise.resolve({}) });

    render(elemento);

    const [url] = vi.mocked(chamarApi).mock.calls[0] as [string];
    const consulta = new URL(url, 'http://localhost').searchParams;

    // `z.string().datetime().optional()` recusa `''` do mesmo jeito que
    // recusava o formato incompleto -- ausencia e o unico estado seguro.
    expect(consulta.has('from')).toBe(false);
    expect(consulta.has('to')).toBe(false);
  });

  it('valor de data invalido tambem vira ausencia, nao string vazia', async () => {
    const elemento = await PaginaDeEventos({
      searchParams: Promise.resolve({ from: 'lixo-nao-e-data' }),
    });

    render(elemento);

    const [url] = vi.mocked(chamarApi).mock.calls[0] as [string];
    const consulta = new URL(url, 'http://localhost').searchParams;

    expect(consulta.has('from')).toBe(false);
  });
});
