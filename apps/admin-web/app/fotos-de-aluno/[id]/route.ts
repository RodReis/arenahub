import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

/**
 * A foto do aluno, servida pelo painel -- #503.
 *
 * Mesmo desenho de `/contratos/[contratoId]/documento`, pelas mesmas razoes:
 * `API_INTERNAL_URL` nao e alcancavel pelo navegador, e esta rota repassa SO
 * o cookie de ACESSO (nunca o de refresh). Caminho LITERAL, com um unico
 * segmento variavel em `encodeURIComponent` -- nunca um proxy generico
 * autenticado para a API.
 *
 * A AUTORIZACAO E DA API (`student.read`, e o tenant da sessao): o que ela nao
 * entrega vira 404 aqui, e o avatar cai nas iniciais.
 *
 * CACHE CURTO E PRIVADO no navegador: a lista pede vinte fotos por pagina, e
 * ir e voltar entre paginas nao precisa baixar tudo de novo. `private` porque
 * e foto de pessoa, atras de sessao -- nenhum cache compartilhado guarda.
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

export async function GET(
  _requisicao: NextRequest,
  contexto: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await contexto.params;

  const acesso = (await cookies()).get('arenahub_access');

  if (!acesso) return new Response(null, { status: 404 });

  let resposta: Response;

  try {
    resposta = await fetch(`${URL_INTERNA}/api/v1/students/${encodeURIComponent(id)}/photo`, {
      cache: 'no-store',
      headers: { cookie: `${acesso.name}=${acesso.value}` },
    });
  } catch {
    return new Response(null, { status: 404 });
  }

  if (!resposta.ok) return new Response(null, { status: 404 });

  return new Response(await resposta.arrayBuffer(), {
    status: 200,
    headers: {
      'content-type': resposta.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
