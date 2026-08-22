import 'server-only';

import { cookies } from 'next/headers';

/**
 * Cliente da API, exclusivo do servidor.
 *
 * `server-only` no topo NAO e decorativo: se alguem importar este arquivo de
 * um Client Component, o build QUEBRA. Sem isso, o erro seria silencioso e
 * pior -- `API_INTERNAL_URL` iria para o bundle do navegador, publicando o
 * endereco interno da API.
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  correlationId: string;
}

export interface RespostaDaApi<T> {
  ok: boolean;
  dados?: T;
  erro?: ProblemDetails;
  /** Cookies que a API mandou gravar, para a Server Action repassar. */
  cookiesDaApi: string[];
}

/**
 * Chama a API repassando os cookies da sessao.
 *
 * `cache: 'no-store'` em tudo: dado autenticado em cache compartilhado e
 * como um usuario ver a tela do outro.
 */
export async function chamarApi<T>(
  caminho: string,
  opcoes: {
    metodo?: string;
    corpo?: unknown;
    /**
     * Upload de arquivo. Vai no lugar de `corpo`.
     *
     * O `content-type` de `multipart/form-data` carrega um BOUNDARY que o
     * runtime gera junto com o corpo -- por isso ele NAO e declarado aqui.
     * Declarar `multipart/form-data` sem boundary faz o servidor recusar o
     * corpo inteiro, e o erro sai como "arquivo ausente", longe da causa.
     */
    formulario?: FormData;
    correlationId?: string;
  } = {},
): Promise<RespostaDaApi<T>> {
  const armazem = await cookies();
  const cabecalhoDeCookie = armazem
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const formulario = opcoes.formulario;

  // `BodyInit | undefined` numa variavel so, resolvida ANTES do literal:
  // com `exactOptionalPropertyTypes`, espalhar um ternario dentro do objeto
  // faz o TS ver `body: FormData | undefined`, que `RequestInit` recusa.
  const corpo: BodyInit | undefined =
    formulario ?? (opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo));

  const resposta = await fetch(`${URL_INTERNA}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      ...(formulario === undefined ? { 'content-type': 'application/json' } : {}),
      ...(cabecalhoDeCookie ? { cookie: cabecalhoDeCookie } : {}),
      ...(opcoes.correlationId ? { 'x-correlation-id': opcoes.correlationId } : {}),
    },
    ...(corpo === undefined ? {} : { body: corpo }),
    cache: 'no-store',
  });

  const cookiesDaApi = resposta.headers.getSetCookie();

  if (!resposta.ok) {
    // O corpo de erro segue `problem+json`; se vier outra coisa, nao
    // inventamos detalhe -- o codigo generico ja diz o que da para dizer.
    const erro = (await resposta.json().catch(() => null)) as ProblemDetails | null;

    return {
      ok: false,
      erro: erro ?? {
        type: 'about:blank',
        title: 'Erro inesperado',
        status: resposta.status,
        code: 'UNEXPECTED',
        correlationId: '',
      },
      cookiesDaApi,
    };
  }

  const dados = (await resposta.json().catch(() => ({}))) as T;

  return { ok: true, dados, cookiesDaApi };
}
