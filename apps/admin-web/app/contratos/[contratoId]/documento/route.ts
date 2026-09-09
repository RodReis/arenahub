import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

/**
 * O PDF do contrato, servido pelo painel — F63 (ADR-052 §8).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA ROTA EXISTE, EM VEZ DE O LINK APONTAR PARA A API.
 * ---------------------------------------------------------------------------
 *
 * Mesma razão de `/marca/[slug]/[peca]`: `API_INTERNAL_URL` é o endereço da API
 * vista DE DENTRO da rede, e o navegador de quem abre o painel não o alcança.
 * Publicá-lo no bundle é o que o `next.config.ts` proíbe, e um
 * `NEXT_PUBLIC_API_URL` criaria uma segunda configuração que a primeira
 * mudança de ambiente faz divergir.
 *
 * ---------------------------------------------------------------------------
 * ESTA REPASSA O COOKIE, E A DA MARCA NÃO. A DIFERENÇA É DELIBERADA.
 * ---------------------------------------------------------------------------
 *
 * A rota da marca é pública e por isso não manda cookie nenhum. Esta é o
 * contrário: `/api/v1/platform/*` é `@PlatformRoute()`, e sem o cookie de
 * acesso a API recusaria todo download. Só o cookie de ACESSO é repassado —
 * nunca o de refresh, que não abre porta nenhuma nesta rota e cujo vazamento
 * custaria a família de sessões inteira.
 *
 * NÃO É UM PROXY GENÉRICO. O caminho é montado literal, com um único segmento
 * variável que passa por `encodeURIComponent`. Afrouxar isso transformaria
 * esta rota num caminho AUTENTICADO para qualquer endpoint da API, montado a
 * partir do que o navegador pedir — e é justamente por repassar o cookie que
 * ela não pode nunca virar isso.
 *
 * A AUTORIZAÇÃO É DA API, e continua sendo: quem não é Super Admin recebe o
 * mesmo 404 daqui, porque a resposta dela não vem `ok`.
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

/** Os cabeçalhos que o navegador precisa receber, e nenhum outro. */
const CABECALHOS_REPASSADOS = [
  'content-type',
  'cache-control',
  'x-content-type-options',
  'content-disposition',
] as const;

export async function GET(
  _requisicao: NextRequest,
  contexto: { params: Promise<{ contratoId: string }> },
): Promise<Response> {
  const { contratoId } = await contexto.params;

  const acesso = (await cookies()).get('arenahub_access');

  if (!acesso) return new Response(null, { status: 404 });

  let resposta: Response;

  try {
    resposta = await fetch(
      `${URL_INTERNA}/api/v1/platform/contracts/${encodeURIComponent(contratoId)}/document`,
      {
        cache: 'no-store',
        headers: { cookie: `${acesso.name}=${acesso.value}` },
      },
    );
  } catch {
    /*
     * API fora do ar vira 404 pelo mesmo motivo da rota da marca: o link não
     * pode pintar a tela inteira de erro. A pessoa tenta de novo.
     */
    return new Response(null, { status: 404 });
  }

  if (!resposta.ok) return new Response(null, { status: resposta.status === 404 ? 404 : 403 });

  const cabecalhos = new Headers();

  for (const nome of CABECALHOS_REPASSADOS) {
    const valor = resposta.headers.get(nome);

    if (valor !== null) cabecalhos.set(nome, valor);
  }

  return new Response(await resposta.arrayBuffer(), { status: 200, headers: cabecalhos });
}
