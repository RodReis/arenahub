import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { alterarSenha } from './perfil';

function formulario(
  valores: Partial<Record<'senhaAtual' | 'novaSenha' | 'confirmacao', string>> = {},
): FormData {
  const dados = new FormData();
  const completos = {
    senhaAtual: 'senha-atual-1',
    novaSenha: 'senha-nova-1',
    confirmacao: 'senha-nova-1',
    ...valores,
  };

  for (const [chave, valor] of Object.entries(completos)) dados.set(chave, valor);

  return dados;
}

function recusa(code: string, status = 422) {
  return {
    ok: false,
    erro: { type: 'about:blank', title: 'Recusado', status, code, correlationId: 'teste' },
    cookiesDaApi: [],
  };
}

describe('alterarSenha', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('envia so a senha atual e a nova -- a confirmacao e da tela', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, cookiesDaApi: [] });

    const estado = await alterarSenha({}, formulario());

    expect(chamarApi).toHaveBeenCalledWith('/api/v1/auth/password', {
      metodo: 'POST',
      corpo: { currentPassword: 'senha-atual-1', newPassword: 'senha-nova-1' },
    });
    expect(estado.erro).toBeUndefined();
    expect(estado.sucesso).toEqual(expect.any(Number));
  });

  it.each([
    [
      { novaSenha: '1234567', confirmacao: '1234567' },
      'A nova senha precisa ter ao menos 8 caracteres',
    ],
    [{ confirmacao: 'outra-coisa' }, 'As senhas não conferem'],
    [
      { novaSenha: 'senha-atual-1', confirmacao: 'senha-atual-1' },
      'A nova senha precisa ser diferente da atual',
    ],
    [{ senhaAtual: '' }, 'Informe a senha atual'],
  ])('recusa %o sem chamar a API', async (valores, mensagem) => {
    const estado = await alterarSenha({}, formulario(valores));

    expect(estado.erro).toBe(mensagem);
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('aceita a fronteira de 8 caracteres', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, cookiesDaApi: [] });

    const estado = await alterarSenha({}, formulario({ novaSenha: '12345678', confirmacao: '12345678' }));

    expect(estado.erro).toBeUndefined();
    expect(chamarApi).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['AUTH_CURRENT_PASSWORD_INVALID', 'Senha atual incorreta.'],
    ['AUTH_PASSWORD_UNCHANGED', 'A nova senha precisa ser diferente da atual'],
    ['AUTH_PASSWORD_CHANGE_RATE_LIMITED', 'Muitas tentativas. Aguarde um minuto e tente de novo.'],
    ['AUTH_PASSWORD_CHANGE_IN_SUPPORT', 'Em sessão de suporte não é possível trocar a senha.'],
    ['QUALQUER_OUTRO', 'Não foi possível trocar a senha. Tente de novo.'],
  ])('traduz %s', async (code, mensagem) => {
    vi.mocked(chamarApi).mockResolvedValue(recusa(code));

    expect((await alterarSenha({}, formulario())).erro).toBe(mensagem);
  });

  it('falha de rede vira erro na tela, nao excecao', async () => {
    vi.mocked(chamarApi).mockRejectedValue(new Error('ECONNREFUSED'));

    expect((await alterarSenha({}, formulario())).erro).toBe(
      'Não foi possível trocar a senha. Tente de novo.',
    );
  });

  it('nunca devolve senha no estado', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusa('AUTH_CURRENT_PASSWORD_INVALID'));

    const estado = await alterarSenha({}, formulario());

    expect(JSON.stringify(estado)).not.toContain('senha-atual-1');
    expect(JSON.stringify(estado)).not.toContain('senha-nova-1');
  });
});
