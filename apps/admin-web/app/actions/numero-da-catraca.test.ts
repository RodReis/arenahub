import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { chamarApi } from '../../lib/api/server-client';
import { gerarNumeroDaCatraca, listarNumerosDoLeitorSemAluno } from './numero-da-catraca';

const ALUNO = '11111111-1111-4111-8111-111111111111';

function formulario(externalId?: string): FormData {
  const dados = new FormData();
  dados.set('studentId', ALUNO);
  if (externalId !== undefined) dados.set('externalId', externalId);
  return dados;
}

describe('gerarNumeroDaCatraca', () => {
  beforeEach(() => vi.mocked(chamarApi).mockReset());

  it('sem externalId manda corpo vazio e devolve o numero', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { externalId: '100000000007', linkedReaders: 0 },
      cookiesDaApi: [],
    });

    const r = await gerarNumeroDaCatraca({}, formulario());

    expect(chamarApi).toHaveBeenCalledWith(`/api/v1/students/${ALUNO}/turnstile-number`, {
      metodo: 'POST',
      corpo: {},
    });
    expect(r).toEqual({ numero: '100000000007', vinculado: false });
  });

  it('com externalId do leitor manda so os digitos e marca vinculado', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { externalId: '100000000123', linkedReaders: 2 },
      cookiesDaApi: [],
    });

    const r = await gerarNumeroDaCatraca({}, formulario(' 100000000123 '));

    expect(chamarApi).toHaveBeenCalledWith(`/api/v1/students/${ALUNO}/turnstile-number`, {
      metodo: 'POST',
      corpo: { externalId: '100000000123' },
    });
    expect(r).toEqual({ numero: '100000000123', vinculado: true });
  });

  it('409 vira frase de numero ocupado', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'CREDENTIAL_ALREADY_ASSIGNED',
        correlationId: '',
      },
      cookiesDaApi: [],
    });

    const r = await gerarNumeroDaCatraca({}, formulario('100000000001'));

    expect(r.erro).toBe('Este número já está vinculado a outro aluno.');
  });

  it('numero com letra ou longo demais nem chega na API', async () => {
    expect((await gerarNumeroDaCatraca({}, formulario('12a'))).erro).toBe('Número inválido');
    expect((await gerarNumeroDaCatraca({}, formulario('1234567890123'))).erro).toBe('Número inválido');
    expect(chamarApi).not.toHaveBeenCalled();
  });
});

describe('listarNumerosDoLeitorSemAluno', () => {
  beforeEach(() => vi.mocked(chamarApi).mockReset());

  it('devolve a lista da API e vazio quando ela falha', async () => {
    const lista = [{ externalId: '100000000123', readerName: 'MARIA S', deviceSerial: 'AYTI1' }];
    vi.mocked(chamarApi).mockResolvedValueOnce({ ok: true, dados: lista, cookiesDaApi: [] });

    expect(await listarNumerosDoLeitorSemAluno()).toEqual(lista);
    expect(chamarApi).toHaveBeenCalledWith('/api/v1/device-reader-numbers/unlinked');

    vi.mocked(chamarApi).mockResolvedValueOnce({ ok: false, cookiesDaApi: [] });
    expect(await listarNumerosDoLeitorSemAluno()).toEqual([]);
  });
});
