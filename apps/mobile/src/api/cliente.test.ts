import { criarCliente } from './cliente.js';

/**
 * O que este arquivo existe para impedir: o app derrubar a PROPRIA sessao.
 *
 * O refresh e rotativo e a familia morre no replay. Isso significa que duas
 * chamadas paralelas que levem 401 ao mesmo tempo NAO podem disparar dois
 * refreshes -- o segundo chegaria com o token ja rotacionado, o servidor
 * leria replay, e revogaria a familia inteira. O aluno seria deslogado por
 * abrir uma tela que faz duas requisicoes.
 */
describe('cliente de API', () => {
  const BASE = 'http://api.test';

  let refreshGuardado: string | null;
  let acessoAtual: string | null;
  let chamadasDeRefresh: number;
  let respostas: Map<string, Array<{ status: number; corpo?: unknown }>>;

  const armazenamento = {
    lerRefresh: () => Promise.resolve(refreshGuardado),
    salvarRefresh: (token: string) => {
      refreshGuardado = token;
      return Promise.resolve();
    },
    limpar: () => {
      refreshGuardado = null;
      return Promise.resolve();
    },
  };

  /** Enfileira respostas por caminho; a ultima repete. */
  const enfileirar = (caminho: string, lista: Array<{ status: number; corpo?: unknown }>) => {
    respostas.set(caminho, lista);
  };

  const proxima = (caminho: string) => {
    const fila = respostas.get(caminho) ?? [{ status: 200, corpo: {} }];
    return fila.length > 1 ? (fila.shift() ?? fila[0]!) : fila[0]!;
  };

  beforeEach(() => {
    refreshGuardado = 'refresh-inicial';
    acessoAtual = 'acesso-velho';
    chamadasDeRefresh = 0;
    respostas = new Map();

    globalThis.fetch = jest.fn((url: string) => {
      const caminho = url.replace(BASE, '');

      if (caminho === '/api/v1/mobile/auth/refresh') {
        chamadasDeRefresh += 1;
        const resposta = proxima(caminho);

        if (resposta.status !== 200) {
          return Promise.resolve(
            new Response(JSON.stringify(resposta.corpo ?? {}), { status: resposta.status }),
          );
        }

        acessoAtual = 'acesso-novo';
        return Promise.resolve(new Response(
          JSON.stringify({
            accessToken: 'acesso-novo',
            refreshToken: `refresh-${chamadasDeRefresh}`,
            sessionId: 's1',
            expiraEm: 600,
          }),
          { status: 200 },
        ));
      }

      const resposta = proxima(caminho);
      return Promise.resolve(
        new Response(JSON.stringify(resposta.corpo ?? {}), { status: resposta.status }),
      );
    }) as unknown as typeof fetch;
  });

  const criar = () =>
    criarCliente({
      baseUrl: BASE,
      armazenamento,
      lerAcesso: () => acessoAtual,
      guardarAcesso: (token) => {
        acessoAtual = token;
      },
      aoPerderSessao: jest.fn(),
    });

  it('manda o access token no cabecalho', async () => {
    enfileirar('/x', [{ status: 200, corpo: { ok: true } }]);
    const cliente = criar();

    await cliente.get('/x');

    const [, opcoes] = (globalThis.fetch as unknown as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect((opcoes.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer acesso-velho',
    );
  });

  it('renova UMA vez quando o access expira e repete a chamada', async () => {
    enfileirar('/x', [{ status: 401 }, { status: 200, corpo: { ok: true } }]);
    const cliente = criar();

    await expect(cliente.get('/x')).resolves.toEqual({ ok: true });
    expect(chamadasDeRefresh).toBe(1);
  });

  it('duas chamadas paralelas com 401 fazem UM refresh so', async () => {
    // O teste que justifica o arquivo. Sem a promessa compartilhada, cada
    // chamada dispararia o seu refresh; o segundo chegaria com o token ja
    // rotacionado, o servidor leria REPLAY e revogaria a familia -- o aluno
    // seria deslogado por abrir uma tela que faz duas requisicoes.
    enfileirar('/a', [{ status: 401 }, { status: 200, corpo: { ok: 'a' } }]);
    enfileirar('/b', [{ status: 401 }, { status: 200, corpo: { ok: 'b' } }]);
    const cliente = criar();

    await Promise.all([cliente.get('/a'), cliente.get('/b')]);

    expect(chamadasDeRefresh).toBe(1);
  });

  it('NAO tenta renovar duas vezes na mesma chamada', async () => {
    /*
     * 401 depois do refresh significa que o problema nao era o token. Tentar
     * de novo em laco queimaria a familia inteira, um elo por volta.
     *
     * O TETO EXISTE PORQUE A FALHA E PIOR QUE UM TESTE VERMELHO. Sem a
     * guarda `!jaRenovou`, a recursao nao para: medido, o processo estoura a
     * memoria do V8 e morre com exit 134 -- o Jest nao reporta falha
     * NENHUMA, e a suite some do relatorio em vez de acusar. Um teto de
     * chamadas transforma "trava e some" em "falha e diz o motivo".
     */
    let requisicoes = 0;
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = jest.fn((...args: Parameters<typeof fetch>) => {
      requisicoes += 1;
      if (requisicoes > 10) throw new Error('LACO DE REFRESH: mais de 10 requisicoes');
      return fetchOriginal(...args);
    });

    enfileirar('/x', [{ status: 401 }, { status: 401 }, { status: 401 }]);
    const cliente = criar();

    await expect(cliente.get('/x')).rejects.toBeTruthy();
    expect(chamadasDeRefresh).toBe(1);
    expect(requisicoes).toBeLessThanOrEqual(3);
  });

  it('limpa o armazenamento quando o refresh e recusado', async () => {
    enfileirar('/x', [{ status: 401 }]);
    enfileirar('/api/v1/mobile/auth/refresh', [
      { status: 401, corpo: { code: 'SESSAO_REVOGADA' } },
    ]);
    const cliente = criar();

    await expect(cliente.get('/x')).rejects.toBeTruthy();
    expect(refreshGuardado).toBeNull();
  });

  it('avisa quem escuta quando a sessao acaba', async () => {
    enfileirar('/x', [{ status: 401 }]);
    enfileirar('/api/v1/mobile/auth/refresh', [
      { status: 401, corpo: { code: 'REFRESH_REPLAY' } },
    ]);

    const aoPerderSessao = jest.fn();
    const cliente = criarCliente({
      baseUrl: BASE,
      armazenamento,
      lerAcesso: () => acessoAtual,
      guardarAcesso: (token) => {
        acessoAtual = token;
      },
      aoPerderSessao,
    });

    await expect(cliente.get('/x')).rejects.toBeTruthy();
    expect(aoPerderSessao).toHaveBeenCalled();
  });

  it('sem refresh guardado nao tenta renovar -- vai direto para o login', async () => {
    refreshGuardado = null;
    enfileirar('/x', [{ status: 401 }]);
    const cliente = criar();

    await expect(cliente.get('/x')).rejects.toBeTruthy();
    expect(chamadasDeRefresh).toBe(0);
  });

  it('erro que NAO e 401 sobe sem mexer na sessao', async () => {
    enfileirar('/x', [{ status: 500, corpo: { code: 'ERRO_INTERNO' } }]);
    const cliente = criar();

    await expect(cliente.get('/x')).rejects.toBeTruthy();
    expect(chamadasDeRefresh).toBe(0);
    expect(refreshGuardado).toBe('refresh-inicial');
  });
});
