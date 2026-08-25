import 'server-only';

import { cookies } from 'next/headers';
import type { ZodType } from 'zod';

import { validarResposta } from '../../src/api/validar-resposta';
import type { ProblemDetails } from '../../src/api/validar-resposta';

/*
 * `ProblemDetails` continua saindo daqui -- e o tipo que todo chamador ja
 * importava, e tipo nao vai para o bundle.
 *
 * `CODIGO_DE_CONTRATO` NAO e reexportado de proposito: reexportar valor
 * daria a um Client Component um motivo para importar deste arquivo, e o
 * `server-only` do topo derrubaria o build -- ou pior, alguem removeria o
 * `server-only` para "resolver", publicando `API_INTERNAL_URL` no
 * navegador. Quem precisa da constante importa de `src/api/`, que e segura
 * nos dois lados.
 */
export type { ProblemDetails } from '../../src/api/validar-resposta';

/**
 * Cliente da API, exclusivo do servidor.
 *
 * `server-only` no topo NAO e decorativo: se alguem importar este arquivo de
 * um Client Component, o build QUEBRA. Sem isso, o erro seria silencioso e
 * pior -- `API_INTERNAL_URL` iria para o bundle do navegador, publicando o
 * endereco interno da API.
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

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
    /**
     * Schema da RESPOSTA. Opcional de proposito: sem ele o generico `T`
     * segue valendo como assercao e o comportamento e o de sempre, o que
     * deixa a migracao das telas ser incremental (issue #167).
     *
     * Com ele, divergencia de contrato vira `ProblemDetails` tratado no
     * lugar de `TypeError` na arvore de render.
     */
    esquema?: ZodType<T>;
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

  const corpoDaResposta: unknown = await resposta.json().catch(() => ({}));

  const esquema = opcoes.esquema;

  if (esquema === undefined) {
    return { ok: true, dados: corpoDaResposta as T, cookiesDaApi };
  }

  const validado = validarResposta(esquema, corpoDaResposta, {
    caminho,
    correlationId: resposta.headers.get('x-correlation-id') ?? opcoes.correlationId ?? '',
  });

  if (!validado.ok) {
    return { ok: false, erro: validado.erro, cookiesDaApi };
  }

  return { ok: true, dados: validado.dados, cookiesDaApi };
}
