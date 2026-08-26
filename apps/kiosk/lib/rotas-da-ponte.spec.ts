import { describe, expect, it } from 'vitest';

import { resolverCaminhoDaPonte } from './rotas-da-ponte.js';

const SESSAO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('allowlist da ponte assinada', () => {
  it('aceita os cinco caminhos da jornada', () => {
    expect(resolverCaminhoDaPonte('/api/kiosk/config')).toBe('/api/v1/kiosk/config');
    expect(resolverCaminhoDaPonte('/api/kiosk/heartbeat')).toBe('/api/v1/kiosk/heartbeat');
    expect(resolverCaminhoDaPonte('/api/kiosk/sessions')).toBe('/api/v1/kiosk/sessions');
    expect(resolverCaminhoDaPonte(`/api/kiosk/sessions/${SESSAO}/extend`)).toBe(
      `/api/v1/kiosk/sessions/${SESSAO}/extend`,
    );
    expect(resolverCaminhoDaPonte(`/api/kiosk/sessions/${SESSAO}`)).toBe(
      `/api/v1/kiosk/sessions/${SESSAO}`,
    );
  });

  /**
   * O achado que a allowlist existe para fechar: sem ela, a ponte assinaria
   * QUALQUER caminho sob `/api/v1/` -- rota administrativa inclusive, com a
   * credencial do dispositivo.
   */
  it.each([
    ['travessia com ..', '/api/kiosk/../admin/tenants'],
    ['travessia embutida', '/api/kiosk/sessions/../../admin/users'],
    ['travessia codificada', '/api/kiosk/%2e%2e/admin'],
    ['barra codificada', '/api/kiosk/sessions%2f..%2fadmin'],
    ['rota administrativa direta', '/api/kiosk/admin'],
    ['prefixo que so parece valido', '/api/kiosk/configuracoes'],
    ['sufixo colado no permitido', '/api/kiosk/config/../../admin'],
    ['id de sessao que nao e UUID', '/api/kiosk/sessions/../extend'],
    ['fora do prefixo da ponte', '/api/v1/admin/tenants'],
    ['raiz da ponte', '/api/kiosk/'],
  ])('recusa %s', (_caso, caminho) => {
    expect(resolverCaminhoDaPonte(caminho)).toBeNull();
  });
});
