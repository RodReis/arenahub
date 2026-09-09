import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));
vi.mock('../../lib/api/repassar-cookies', () => ({ repassarCookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECIONOU');
  }),
}));

import { redirect } from 'next/navigation';

import { chamarApi } from '../../lib/api/server-client';
import { repassarCookies } from '../../lib/api/repassar-cookies';
import { entrar } from './auth';

function formulario(): FormData {
  const dados = new FormData();

  dados.set('email', 'dono@arenahub.local');
  dados.set('password', 'senha-de-teste-correta');

  return dados;
}

describe('entrar', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
    vi.mocked(repassarCookies).mockReset();
    vi.mocked(redirect).mockClear();
  });

  /**
   * O LOGIN DO SUPER ADMIN NÃO DEVOLVE SESSÃO — devolve desafio.
   *
   * A API responde **200** com `{ desafio, preAuth }` e SEM cookie (INV-007:
   * um fator não abre sessão de plataforma). Como o status é de sucesso,
   * `resposta.ok` é verdadeiro, e o caminho ingênuo repassa uma lista vazia de
   * cookies e redireciona para `/dashboard` — onde o layout não acha sessão e
   * manda de volta para `/login`. O dono do SaaS fica num laço silencioso,
   * digitando a senha certa e voltando para a mesma tela.
   *
   * Enquanto a tela de segundo fator não existe, o mínimo é **dizer a
   * verdade**: não redirecionar, e explicar por que não entrou.
   */
  it('não redireciona quando a API devolve desafio de MFA em vez de sessão', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { desafio: 'MFA_VERIFY', preAuth: 'token-de-cinco-minutos' },
      cookiesDaApi: [],
    });

    const estado = await entrar({}, formulario());

    expect(redirect).not.toHaveBeenCalled();
    expect(estado.erro).toBeTruthy();
    // Não pode gravar cookie nenhum: não veio sessão.
    expect(vi.mocked(repassarCookies)).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('arenahub_access')]),
    );
  });

  it('entra normalmente quando a API devolve sessão', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: {},
      cookiesDaApi: ['arenahub_access=abc; Path=/'],
    });

    // O `redirect` do Next lança por construção; o teste só precisa saber que
    // foi chamado.
    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU');

    expect(repassarCookies).toHaveBeenCalledWith(['arenahub_access=abc; Path=/']);
  });
});
