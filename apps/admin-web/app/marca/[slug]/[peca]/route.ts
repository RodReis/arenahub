import type { NextRequest } from 'next/server';

/**
 * O logo e o ícone da academia, servidos pelo painel — F62 (ADR-052 §9).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTA ROTA EXISTE, EM VEZ DE O `<img>` APONTAR PARA A API.
 * ---------------------------------------------------------------------------
 *
 * `API_INTERNAL_URL` é o endereço da API vista DE DENTRO da rede — hoje
 * `localhost:3344`, amanhã o nome do serviço na Railway. O navegador de quem
 * abre a tela de login não alcança esse endereço, e publicá-lo no bundle é
 * exatamente o que o `next.config.ts` diz que não se faz ("o que entra em
 * `env` vai para o bundle do cliente").
 *
 * Um `NEXT_PUBLIC_API_URL` resolveria — e criaria uma segunda configuração de
 * endereço da API, que a primeira mudança de ambiente faz divergir. Este
 * repasse usa a mesma variável que todas as Server Actions já usam.
 *
 * ---------------------------------------------------------------------------
 * NÃO É UM PROXY GENÉRICO, E A DIFERENÇA É A SEGURANÇA.
 * ---------------------------------------------------------------------------
 *
 * Só monta o caminho `/api/v1/branding/{slug}/{peca}`, com `peca` restrita a
 * dois valores literais. Nada do que o cliente manda entra na URL sem passar
 * por `encodeURIComponent`, e nenhum cabeçalho da requisição original é
 * repassado — em particular, NENHUM cookie. Se qualquer uma dessas três coisas
 * afrouxasse, esta rota viraria um caminho autenticado para qualquer endpoint
 * da API, montado a partir do que o navegador pedir.
 *
 * Os cabeçalhos de segurança vêm da RESPOSTA da API e são repassados como
 * chegaram: é lá que eles são decididos, ao lado da sanitização do SVG que os
 * torna necessários (`branding-publico.controller.ts`).
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

/** Os cabeçalhos que o navegador precisa receber, e nenhum outro. */
const CABECALHOS_REPASSADOS = [
  'content-type',
  'cache-control',
  'x-content-type-options',
  'content-security-policy',
  'content-disposition',
] as const;

export async function GET(
  _requisicao: NextRequest,
  contexto: { params: Promise<{ slug: string; peca: string }> },
): Promise<Response> {
  const { slug, peca } = await contexto.params;

  if (peca !== 'logo' && peca !== 'icon') {
    return new Response(null, { status: 404 });
  }

  let resposta: Response;

  try {
    resposta = await fetch(
      `${URL_INTERNA}/api/v1/branding/${encodeURIComponent(slug)}/${peca}`,
      { cache: 'no-store' },
    );
  } catch {
    /*
     * API FORA DO AR não é academia sem logo, mas a tela trata igual: o 404
     * faz o `<img>` falhar e o hero cair na marca ArenaHub. Um 500 aqui
     * pintaria a tela de login de erro por causa de uma imagem.
     */
    return new Response(null, { status: 404 });
  }

  if (!resposta.ok) return new Response(null, { status: 404 });

  const cabecalhos = new Headers();

  for (const nome of CABECALHOS_REPASSADOS) {
    const valor = resposta.headers.get(nome);

    if (valor !== null) cabecalhos.set(nome, valor);
  }

  return new Response(await resposta.arrayBuffer(), { status: 200, headers: cabecalhos });
}
