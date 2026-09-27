import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { revalidatePath } from 'next/cache';
import { atualizarVinculo } from './team';

const MEMBRO = '11111111-1111-4111-8111-111111111111';

function formulario(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('teamMemberId', MEMBRO);
  dados.set('employmentType', 'CLT');
  dados.set('employmentStartedAt', '2024-01-01');
  dados.set('version', '0');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function corpoEnviado(): Record<string, unknown> {
  return vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
}

describe('atualizarVinculo -- vínculo trabalhista do time (F81)', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
    vi.mocked(revalidatePath).mockReset();
  });

  it('envia employmentType, employmentStartedAt e version no corpo do PATCH', async () => {
    vi.mocked(chamarApi).mockResolvedValueOnce({
      ok: true,
      dados: { employmentType: 'CLT', employmentStartedAt: '2024-01-01', version: 1 },
      cookiesDaApi: [],
    });

    const estado = await atualizarVinculo({}, formulario());

    expect(chamarApi).toHaveBeenCalledWith(
      `/api/v1/team/${MEMBRO}/employment`,
      expect.objectContaining({ metodo: 'PATCH' }),
    );
    expect(corpoEnviado()).toEqual({
      employmentType: 'CLT',
      employmentStartedAt: '2024-01-01',
      version: 0,
    });
    expect(estado.sucesso).toEqual({ employmentType: 'CLT', employmentStartedAt: '2024-01-01', version: 1 });
    expect(estado.erro).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith(`/team/${MEMBRO}`);
  });

  it('devolve erro amigável quando a API responde STALE_VERSION (409)', async () => {
    vi.mocked(chamarApi).mockResolvedValueOnce({
      ok: false,
      dados: null,
      erro: { code: 'STALE_VERSION' },
      cookiesDaApi: [],
    });

    const estado = await atualizarVinculo({}, formulario({ version: '0' }));

    expect(estado.erro).toBe('Alguém alterou este vínculo enquanto você editava. Recarregue a página.');
    expect(estado.sucesso).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('devolve erro de validação sem chamar a API quando employmentStartedAt está em formato inválido', async () => {
    const estado = await atualizarVinculo({}, formulario({ employmentStartedAt: '01/01/2024' }));

    expect(estado.erro).toBe('Informe a data de início do vínculo');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('devolve mensagem genérica com o código quando a API responde erro desconhecido', async () => {
    vi.mocked(chamarApi).mockResolvedValueOnce({
      ok: false,
      dados: null,
      erro: { code: 'INTERNAL_ERROR' },
      cookiesDaApi: [],
    });

    const estado = await atualizarVinculo({}, formulario());

    expect(estado.erro).toBe('Não foi possível salvar o vínculo (INTERNAL_ERROR).');
  });
});
