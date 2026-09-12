/**
 * Cliente HTTP do app do aluno.
 *
 * A responsabilidade que justifica o arquivo NAO e montar URL -- e nunca
 * derrubar a propria sessao. O refresh do ArenaHub e rotativo e a familia
 * morre no replay (ver `domain/sessao-do-aluno.ts` na API): duas chamadas
 * paralelas que levem 401 ao mesmo tempo, cada uma disparando o seu refresh,
 * fazem o servidor ver um token ja rotacionado chegando de novo. Ele le
 * replay, revoga a familia, e o aluno e deslogado por ter aberto uma tela
 * que faz duas requisicoes.
 *
 * Por isso o refresh em voo e UM SO, compartilhado por todas as chamadas que
 * esperam.
 */

export interface ArmazenamentoDeSessao {
  lerRefresh(): Promise<string | null>;
  salvarRefresh(token: string): Promise<void>;
  limpar(): Promise<void>;
}

export interface OpcoesDoCliente {
  readonly baseUrl: string;
  readonly armazenamento: ArmazenamentoDeSessao;
  /** O access token vive em MEMORIA, no provedor -- nunca em disco. */
  readonly lerAcesso: () => string | null;
  readonly guardarAcesso: (token: string | null) => void;
  /** Chamado quando nao ha mais o que renovar: a tela volta para o login. */
  readonly aoPerderSessao: () => void;
}

export class ErroDeApi extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly corpo: unknown,
  ) {
    super(code ?? `HTTP ${status}`);
    this.name = 'ErroDeApi';
  }
}

interface ParDeTokens {
  accessToken: string;
  refreshToken: string;
}

const CAMINHO_DO_REFRESH = '/api/v1/mobile/auth/refresh';

export function criarCliente(opcoes: OpcoesDoCliente) {
  /**
   * A promessa de refresh em voo, compartilhada.
   *
   * Quem chega durante uma renovacao ESPERA a que ja existe em vez de abrir
   * outra. E o unico estado mutavel do modulo, e existe so para isso.
   */
  let refreshEmVoo: Promise<string> | null = null;

  const renovar = async (): Promise<string> => {
    const guardado = await opcoes.armazenamento.lerRefresh();
    if (!guardado) throw new ErroDeApi(401, 'SEM_SESSAO', null);

    const resposta = await fetch(`${opcoes.baseUrl}${CAMINHO_DO_REFRESH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: guardado }),
    });

    if (!resposta.ok) {
      // Recusa aqui e definitiva: revogada, expirada ou replay. Em qualquer
      // dos tres, insistir so queima elo. Limpa e manda para o login.
      const corpo: unknown = await resposta.json().catch(() => null);
      await opcoes.armazenamento.limpar();
      opcoes.guardarAcesso(null);
      opcoes.aoPerderSessao();

      throw new ErroDeApi(resposta.status, codigoDe(corpo), corpo);
    }

    const par = (await resposta.json()) as ParDeTokens;
    await opcoes.armazenamento.salvarRefresh(par.refreshToken);
    opcoes.guardarAcesso(par.accessToken);

    return par.accessToken;
  };

  const renovarUmaVezSo = (): Promise<string> => {
    refreshEmVoo ??= renovar().finally(() => {
      refreshEmVoo = null;
    });

    return refreshEmVoo;
  };

  const requisitar = async (
    caminho: string,
    init: RequestInit,
    jaRenovou: boolean,
  ): Promise<unknown> => {
    const acesso = opcoes.lerAcesso();

    const resposta = await fetch(`${opcoes.baseUrl}${caminho}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(acesso ? { Authorization: `Bearer ${acesso}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (resposta.status === 401 && !jaRenovou) {
      // UMA tentativa. 401 DEPOIS de renovar significa que o problema nao era
      // o token -- repetir em laco queimaria a familia, um elo por volta.
      await renovarUmaVezSo();
      return requisitar(caminho, init, true);
    }

    const corpo: unknown = await resposta.json().catch(() => null);

    if (!resposta.ok) throw new ErroDeApi(resposta.status, codigoDe(corpo), corpo);

    return corpo;
  };

  return {
    get: (caminho: string) => requisitar(caminho, { method: 'GET' }, false),
    post: (caminho: string, corpo?: unknown) =>
      requisitar(
        caminho,
        { method: 'POST', ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) },
        false,
      ),
    delete: (caminho: string) => requisitar(caminho, { method: 'DELETE' }, false),
  };
}

/** O `code` do `problem+json`, quando houver. */
function codigoDe(corpo: unknown): string | undefined {
  if (corpo && typeof corpo === 'object' && 'code' in corpo) {
    const code = (corpo as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}
