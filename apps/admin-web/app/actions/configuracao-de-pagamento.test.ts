import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from 'next/cache';

import { chamarApi } from '../../lib/api/server-client';
import { salvarConfiguracaoDePagamento } from './configuracao-de-pagamento';

const chamada = vi.mocked(chamarApi);

function formulario(campos: Record<string, string>): FormData {
  const dados = new FormData();
  for (const [nome, valor] of Object.entries(campos)) dados.set(nome, valor);

  return dados;
}

const VALIDO = { invoiceGenerationDay: '1', dueDay: '10', graceDays: '5' };

beforeEach(() => {
  vi.clearAllMocks();
  chamada.mockResolvedValue({
    ok: true,
    dados: { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 },
    cookiesDaApi: [],
  });
});

describe('salvarConfiguracaoDePagamento', () => {
  it('envia os três valores como INTEIROS, não strings', async () => {
    const estado = await salvarConfiguracaoDePagamento({}, formulario(VALIDO));

    expect(chamada).toHaveBeenCalledTimes(1);
    expect(chamada).toHaveBeenCalledWith('/api/v1/billing/settings', {
      metodo: 'PUT',
      corpo: { invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 },
    });
    expect(estado).toEqual({ sucesso: true });
    expect(revalidatePath).toHaveBeenCalledWith('/configuracao');
  });

  it.each([
    ['vazio', { ...VALIDO, dueDay: '' }],
    ['decimal', { ...VALIDO, graceDays: '10.5' }],
    ['texto', { ...VALIDO, invoiceGenerationDay: 'abc' }],
    ['espaços', { ...VALIDO, dueDay: '  ' }],
    ['ausente', { invoiceGenerationDay: '1', dueDay: '10' }],
  ])('campo %s devolve erro SEM chamar a API', async (_nome, campos) => {
    const estado = await salvarConfiguracaoDePagamento({}, formulario(campos));

    expect(estado).toEqual({ erro: 'Preencha os três campos com números inteiros.' });
    expect(chamada).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('traduz BILLING_SETTINGS_INVALID na mensagem da tela', async () => {
    chamada.mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'x', status: 422, code: 'BILLING_SETTINGS_INVALID', correlationId: 'c' },
      cookiesDaApi: [],
    });

    const estado = await salvarConfiguracaoDePagamento({}, formulario(VALIDO));

    expect(estado).toEqual({
      erro: 'Confira os valores: gerar e vencer de 1 a 28, bloqueio de 1 a 30, e gerar não pode ser depois do vencimento.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('erro desconhecido cai na mensagem padrão', async () => {
    chamada.mockResolvedValue({
      ok: false,
      erro: { type: 'about:blank', title: 'x', status: 500, code: 'OUTRO', correlationId: 'c' },
      cookiesDaApi: [],
    });

    const estado = await salvarConfiguracaoDePagamento({}, formulario(VALIDO));

    expect(estado).toEqual({ erro: 'Não foi possível salvar a configuração.' });
  });
});
