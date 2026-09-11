import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({ chamarApi: vi.fn() }));
vi.mock('../../lib/api/repassar-cookies', () => ({ repassarCookies: vi.fn() }));
vi.mock('../../lib/api/pre-auth', () => ({
  gravarPreAuth: vi.fn(),
  lerPreAuth: vi.fn(),
  limparPreAuth: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`REDIRECIONOU:${destino}`);
  }),
}));

import { redirect } from 'next/navigation';

import { chamarApi } from '../../lib/api/server-client';
import { gravarPreAuth, lerPreAuth, limparPreAuth } from '../../lib/api/pre-auth';
import { repassarCookies } from '../../lib/api/repassar-cookies';
import { confirmarInscricaoDeSegundoFator, entrar, verificarSegundoFator } from './auth';

function formulario(): FormData {
  const dados = new FormData();

  dados.set('email', 'dono@arenahub.local');
  dados.set('password', 'senha-de-teste-correta');

  return dados;
}

function comCodigo(codigo: string): FormData {
  const dados = new FormData();

  dados.set('code', codigo);

  return dados;
}

beforeEach(() => {
  vi.mocked(chamarApi).mockReset();
  vi.mocked(repassarCookies).mockReset();
  vi.mocked(gravarPreAuth).mockReset();
  vi.mocked(lerPreAuth).mockReset();
  vi.mocked(limparPreAuth).mockReset();
  vi.mocked(redirect).mockClear();
});

describe('entrar', () => {
  /**
   * O LOGIN DO SUPER ADMIN NÃO DEVOLVE SESSÃO — devolve desafio.
   *
   * A API responde **200** com `{ desafio, preAuth }` e SEM cookie (INV-007:
   * um fator não abre sessão de plataforma). Como o status é de sucesso,
   * `resposta.ok` é verdadeiro, e o caminho ingênuo repassaria uma lista vazia
   * de cookies e mandaria para `/dashboard` — onde o layout não acha sessão e
   * devolve para `/login`, num laço com a senha certa.
   *
   * Agora o desafio tem para onde ir: a tela do segundo fator.
   */
  it('manda para a tela do código quando a conta já tem segundo fator', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { desafio: 'MFA_VERIFY', preAuth: 'token-de-cinco-minutos' },
      cookiesDaApi: [],
    });

    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU:/login/2fa');

    expect(gravarPreAuth).toHaveBeenCalledWith('token-de-cinco-minutos', 'MFA_VERIFY');
    // Nenhum cookie de sessão: não veio sessão nenhuma.
    expect(repassarCookies).not.toHaveBeenCalled();
  });

  it('manda para a configuração quando a conta ainda não tem segundo fator', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { desafio: 'MFA_SETUP', preAuth: 'token-de-setup' },
      cookiesDaApi: [],
    });

    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU:/login/configurar-2fa');

    expect(gravarPreAuth).toHaveBeenCalledWith('token-de-setup', 'MFA_SETUP');
  });

  /**
   * Um corpo 200 sem `preAuth` utilizável não é desafio — e tratá-lo como tal
   * gravaria um cookie de desafio vazio e mandaria a pessoa para uma tela que
   * só pode falhar.
   */
  it('não trata como desafio um corpo 200 sem preAuth', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: { desafio: 'MFA_VERIFY' },
      cookiesDaApi: ['arenahub_access=abc; Path=/'],
    });

    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU:/dashboard');

    expect(gravarPreAuth).not.toHaveBeenCalled();
  });

  it('entra normalmente quando a API devolve sessão', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: {},
      cookiesDaApi: ['arenahub_access=abc; Path=/'],
    });

    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU:/dashboard');

    expect(repassarCookies).toHaveBeenCalledWith(['arenahub_access=abc; Path=/']);
    expect(gravarPreAuth).not.toHaveBeenCalled();
  });

  /*
   * O dono do SaaS não tem tenant, e `/dashboard` é rota de TENANT: mandá-lo
   * para lá devolvia 401 numa sessão válida (issue #311). O destino sai de
   * `/auth/me`, porque a resposta do login não carrega esse sinal.
   */
  it('manda o platform admin para /platform, não para o painel de tenant', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) =>
      Promise.resolve(
        caminho === '/api/v1/auth/me'
          ? { ok: true, dados: { isPlatformAdmin: true }, cookiesDaApi: [] }
          : { ok: true, dados: {}, cookiesDaApi: ['arenahub_access=abc; Path=/'] },
      ),
    );

    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU:/platform');
  });

  it('mantém o usuário de tenant no painel de operação', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) =>
      Promise.resolve(
        caminho === '/api/v1/auth/me'
          ? { ok: true, dados: { isPlatformAdmin: false }, cookiesDaApi: [] }
          : { ok: true, dados: {}, cookiesDaApi: ['arenahub_access=abc; Path=/'] },
      ),
    );

    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU:/dashboard');
  });

  /*
   * `/auth/me` fora do ar não pode trancar ninguém na tela de login: cair no
   * destino de sempre deixa o platform admin ver o erro e digitar `/platform`,
   * enquanto mandar todo mundo para lá tiraria o painel de quem trabalha nele.
   */
  it('cai no painel de operação quando /auth/me falha', async () => {
    vi.mocked(chamarApi).mockImplementation((caminho: string) =>
      Promise.resolve(
        caminho === '/api/v1/auth/me'
          ? { ok: false, cookiesDaApi: [] }
          : { ok: true, dados: {}, cookiesDaApi: ['arenahub_access=abc; Path=/'] },
      ),
    );

    await expect(entrar({}, formulario())).rejects.toThrow('REDIRECIONOU:/dashboard');
  });
});

describe('segundo fator', () => {
  /*
   * O caminho REAL do platform admin: o login dele sempre devolve desafio de
   * MFA (INV-007), então quem decide o destino dele é esta função, não `entrar`.
   */
  it('manda o platform admin para /platform depois do segundo fator', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_VERIFY' });
    vi.mocked(chamarApi).mockImplementation((caminho: string) =>
      Promise.resolve(
        caminho === '/api/v1/auth/me'
          ? { ok: true, dados: { isPlatformAdmin: true }, cookiesDaApi: [] }
          : { ok: true, dados: {}, cookiesDaApi: ['arenahub_access=abc; Path=/'] },
      ),
    );

    await expect(verificarSegundoFator({}, comCodigo('123456'))).rejects.toThrow(
      'REDIRECIONOU:/platform',
    );
  });

  it('troca o código pela sessão e limpa o desafio', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_VERIFY' });
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: {},
      cookiesDaApi: ['arenahub_access=abc; Path=/'],
    });

    await expect(verificarSegundoFator({}, comCodigo('123456'))).rejects.toThrow(
      'REDIRECIONOU:/dashboard',
    );

    expect(repassarCookies).toHaveBeenCalledWith(['arenahub_access=abc; Path=/']);
    // Sem isto, a próxima visita a `/login` voltaria para a tela do código com
    // um token já gasto.
    expect(limparPreAuth).toHaveBeenCalled();
  });

  /**
   * O PRE-AUTH VAI NO CABEÇALHO, e não no corpo nem na URL.
   *
   * A rota é `@Public()` e não lê cookie: é este `Bearer` que a autoriza. Se o
   * token deixasse de ser enviado, a API responderia 401 e a tela culparia
   * quem digitou o código certo.
   */
  it('envia o pre-auth como Bearer, nunca no corpo', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_VERIFY' });
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: {}, cookiesDaApi: [] });

    await expect(verificarSegundoFator({}, comCodigo('123456'))).rejects.toThrow();

    expect(chamarApi).toHaveBeenCalledWith(
      '/api/v1/auth/mfa/verify',
      expect.objectContaining({ preAuth: 'pre-auth', corpo: { code: '123456' } }),
    );
  });

  /**
   * O autenticador do celular mostra "123 456", com espaço, e é isso que a
   * pessoa copia. Recusar por causa do espaço seria culpar quem copiou certo.
   */
  it('aceita o código com o espaço que o aplicativo mostra', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_VERIFY' });
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: {}, cookiesDaApi: [] });

    await expect(verificarSegundoFator({}, comCodigo('123 456'))).rejects.toThrow();

    expect(chamarApi).toHaveBeenCalledWith(
      '/api/v1/auth/mfa/verify',
      expect.objectContaining({ corpo: { code: '123456' } }),
    );
  });

  it('recusa código que não tem seis dígitos, sem chamar a API', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_VERIFY' });

    const estado = await verificarSegundoFator({}, comCodigo('12345'));

    expect(estado.erro).toBe('O código tem seis dígitos');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * Desafio vencido é diferente de código errado: insistir num pre-auth morto
   * nunca vai dar certo, e a pessoa precisa saber que o caminho é entrar de
   * novo. O cookie sai junto — senão `/login` volta para cá com o token morto.
   */
  it('distingue desafio expirado de código errado', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_VERIFY' });
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Autenticacao obrigatoria',
        status: 401,
        code: 'AUTH_REQUIRED',
        correlationId: '',
      },
      cookiesDaApi: [],
    });

    const estado = await verificarSegundoFator({}, comCodigo('123456'));

    expect(estado.erro).toContain('expirou');
    expect(limparPreAuth).toHaveBeenCalled();
  });

  /**
   * Reuso NÃO é "código errado". Significa que aquele número já passou por
   * aqui, e "tente de novo" esconderia o caso que o operador precisa ver.
   */
  it('diz que o código já foi usado quando a API acusa reuso', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_VERIFY' });
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: {
        type: 'about:blank',
        title: 'Codigo ja utilizado',
        status: 401,
        code: 'MFA_CODE_REPLAYED',
        correlationId: '',
      },
      cookiesDaApi: [],
    });

    const estado = await verificarSegundoFator({}, comCodigo('123456'));

    expect(estado.erro).toContain('já foi usado');
    // O desafio continua válido: o próximo código serve.
    expect(limparPreAuth).not.toHaveBeenCalled();
  });

  it('sem desafio pendente, manda de volta ao login em vez de chamar a API', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue(null);

    await expect(verificarSegundoFator({}, comCodigo('123456'))).rejects.toThrow(
      'REDIRECIONOU:/login',
    );

    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * A GUARDA QUE IMPEDE O DESAFIO ERRADO.
   *
   * Basta abrir `/login/2fa` à mão tendo um SETUP pendente: sem esta checagem
   * a ação mandaria o pre-auth de setup para a rota de verificação, a API
   * responderia 401 e a tela diria "código inválido" — culpando quem digitou
   * certo.
   */
  it('recusa o desafio de outro tipo em vez de mandar o token para a rota errada', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_SETUP' });

    await expect(verificarSegundoFator({}, comCodigo('123456'))).rejects.toThrow(
      'REDIRECIONOU:/login',
    );

    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('a confirmação de inscrição usa a rota de enroll, não a de verify', async () => {
    vi.mocked(lerPreAuth).mockResolvedValue({ token: 'pre-auth', desafio: 'MFA_SETUP' });
    vi.mocked(chamarApi).mockResolvedValue({
      ok: true,
      dados: {},
      cookiesDaApi: ['arenahub_access=abc; Path=/'],
    });

    await expect(confirmarInscricaoDeSegundoFator({}, comCodigo('123456'))).rejects.toThrow(
      'REDIRECIONOU:/dashboard',
    );

    expect(chamarApi).toHaveBeenCalledWith(
      '/api/v1/auth/mfa/enroll/confirm',
      expect.objectContaining({ preAuth: 'pre-auth' }),
    );
  });
});
