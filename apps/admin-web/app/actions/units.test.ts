import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { cadastrarUnidade, editarUnidade } from './units';

function formulario(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('code', 'ZONA-SUL');
  dados.set('name', 'Unidade Zona Sul');
  dados.set('timezone', 'America/Sao_Paulo');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function criada() {
  return { ok: true, dados: { id: 'un-1', name: 'Unidade Zona Sul' }, cookiesDaApi: [] };
}

describe('cadastrarUnidade', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('cadastra a unidade com codigo, nome e fuso', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criada());

    const estado = await cadastrarUnidade({}, formulario());

    expect(estado.sucesso).toBeDefined();

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['code']).toBe('ZONA-SUL');
    expect(corpo['timezone']).toBe('America/Sao_Paulo');
  });

  /**
   * `openingHours` E OBRIGATORIO NA API e vai vazio de proposito.
   *
   * Quem controla acesso e a janela do PLANO (regra de arquitetura no 1:
   * entitlement decide), nao o horario declarado da unidade -- entao nascer
   * sem ele nao bloqueia nada. Omitir o campo daria 400: o schema o exige.
   */
  it('manda openingHours vazio, e nao omite o campo', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criada());

    await cadastrarUnidade({}, formulario());

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo).toHaveProperty('openingHours');
    expect(corpo['openingHours']).toEqual({});
  });

  /**
   * `tenantId` NAO PODE VIAJAR NO CORPO: o schema da API e `.strict()` e o
   * recusa, nao ignora -- o tenant vem da identidade autenticada (regra de
   * arquitetura no 2). Mandar por engano derrubaria a requisicao inteira.
   */
  it('nao manda tenantId no corpo', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criada());

    await cadastrarUnidade({}, formulario({ tenantId: 'nao-deve-viajar' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('tenantId');
  });

  it('preserva o preenchimento quando a validacao falha', async () => {
    const estado = await cadastrarUnidade({}, formulario({ name: '' }));

    expect(estado.sucesso).toBeUndefined();
    expect(estado.valores?.code).toBe('ZONA-SUL');
    expect(vi.mocked(chamarApi)).not.toHaveBeenCalled();
  });
});
describe('editarUnidade', () => {
  const UNIDADE_ID = '11111111-1111-4111-8111-111111111111';

  function formularioDeEdicao(extras: Record<string, string> = {}): FormData {
    const dados = new FormData();

    dados.set('unitId', UNIDADE_ID);
    dados.set('name', 'Unidade Zona Sul Renomeada');
    dados.set('timezone', 'America/Manaus');

    for (const [chave, valor] of Object.entries(extras)) {
      dados.set(chave, valor);
    }

    return dados;
  }

  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('manda PATCH com nome e fuso', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criada());

    const estado = await editarUnidade({}, formularioDeEdicao());

    expect(estado.sucesso).toBeDefined();
    expect(vi.mocked(chamarApi).mock.calls[0]?.[0]).toBe(`/api/v1/units/${UNIDADE_ID}`);
    expect(vi.mocked(chamarApi).mock.calls[0]?.[1]?.metodo).toBe('PATCH');
  });

  /**
   * `openingHours` NAO PODE VIAJAR na edicao.
   *
   * O schema o declara opcional: campo AUSENTE e "nao mexer", campo presente
   * e vazio e "esvazie". Manda-lo `{}` aqui apagaria o horario de uma unidade
   * que ja o tivesse -- e ninguem veria sumir, porque nenhuma tela mostra
   * horario de funcionamento hoje.
   */
  it('nao manda openingHours, para nao apagar o horario existente', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criada());

    await editarUnidade({}, formularioDeEdicao());

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('openingHours');
  });

  /**
   * `code` tambem fica de fora: `PATCH /units/:id` nao o aceita (`.strict()`),
   * e manda-lo derrubaria a requisicao inteira com VALIDATION_FAILED.
   */
  it('nao manda o codigo, que a API nao aceita alterar', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criada());

    await editarUnidade({}, formularioDeEdicao({ code: 'TENTATIVA' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('code');
  });

  it('preserva o preenchimento quando a validacao falha', async () => {
    const estado = await editarUnidade({}, formularioDeEdicao({ name: '' }));

    expect(estado.sucesso).toBeUndefined();
    expect(estado.valores?.timezone).toBe('America/Manaus');
    expect(vi.mocked(chamarApi)).not.toHaveBeenCalled();
  });
});
