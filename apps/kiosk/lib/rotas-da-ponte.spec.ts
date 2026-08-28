import { describe, expect, it } from 'vitest';

import { resolverCaminhoDaPonte } from './rotas-da-ponte.js';

const TENTATIVA = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
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

  /** Area do aluno (F52) -- um padrao por endpoint, nunca um curinga. */
  it.each([
    ['historico de pagamentos', `sessions/${SESSAO}/payments`],
    ['cobranca PIX', `sessions/${SESSAO}/payments/pix`],
    ['checkout de cartao', `sessions/${SESSAO}/payments/card-checkout`],
    ['observar tentativa', `sessions/${SESSAO}/payments/${TENTATIVA}`],
    ['avaliacao do mes', `sessions/${SESSAO}/assessment`],
    ['historico de avaliacoes', `sessions/${SESSAO}/assessments`],
    ['evolucao', `sessions/${SESSAO}/evolution`],
    ['preferencia de engajamento', `sessions/${SESSAO}/engajamento/preferencias`],
    ['perfil publico', `sessions/${SESSAO}/engajamento/perfil-publico`],
    ['extrato de xp', `sessions/${SESSAO}/engajamento/xp`],
  ] as const)('aceita %s', (_caso, resto) => {
    expect(resolverCaminhoDaPonte(`/api/kiosk/${resto}`)).toBe(`/api/v1/kiosk/${resto}`);
  });

  /**
   * A lista e por ENDPOINT, e nao `sessions/<id>/.*` -- um curinga passaria
   * sub-caminho futuro sem ninguem reler a allowlist.
   */
  it.each([
    ['sub-caminho inventado', `/api/kiosk/sessions/${SESSAO}/payments/pix/confirm`],
    ['attemptId que nao e UUID', `/api/kiosk/sessions/${SESSAO}/payments/abc`],
    ['avaliacao com id colado', `/api/kiosk/sessions/${SESSAO}/assessment/${TENTATIVA}`],
    ['travessia depois do id', `/api/kiosk/sessions/${SESSAO}/../../admin`],
    ['modulo inventado', `/api/kiosk/sessions/${SESSAO}/ranking`],
    ['travessia depois do extrato de xp', `/api/kiosk/sessions/${SESSAO}/engajamento/xp/../../admin`],
  ])('recusa %s', (_caso, caminho) => {
    expect(resolverCaminhoDaPonte(caminho)).toBeNull();
  });
});

describe('desafios (F34)', () => {
  const SESSAO = '11111111-1111-4111-8111-111111111111';
  const DESAFIO = '22222222-2222-4222-8222-222222222222';

  it('permite listar desafios da sessao', () => {
    expect(resolverCaminhoDaPonte(`/api/kiosk/sessions/${SESSAO}/engajamento/desafios`)).toBe(
      `/api/v1/kiosk/sessions/${SESSAO}/engajamento/desafios`,
    );
  });

  it('permite entrar e sair de um desafio', () => {
    expect(
      resolverCaminhoDaPonte(`/api/kiosk/sessions/${SESSAO}/engajamento/desafios/${DESAFIO}/join`),
    ).toBe(`/api/v1/kiosk/sessions/${SESSAO}/engajamento/desafios/${DESAFIO}/join`);
  });

  it('permite marcar avisos como lidos', () => {
    expect(
      resolverCaminhoDaPonte(`/api/kiosk/sessions/${SESSAO}/engajamento/desafios/avisos/lidos`),
    ).toBe(`/api/v1/kiosk/sessions/${SESSAO}/engajamento/desafios/avisos/lidos`);
  });

  /**
   * O `challengeId` e ancorado como UUID de proposito: `[^/]+` deixaria
   * passar caminho arbitrario depois de `desafios/`.
   */
  it('recusa challengeId que nao e UUID', () => {
    expect(
      resolverCaminhoDaPonte(`/api/kiosk/sessions/${SESSAO}/engajamento/desafios/../../admin/join`),
    ).toBeNull();
  });

  it('recusa sub-caminho de desafios fora da lista', () => {
    expect(
      resolverCaminhoDaPonte(`/api/kiosk/sessions/${SESSAO}/engajamento/desafios/${DESAFIO}/apagar`),
    ).toBeNull();
  });
});
