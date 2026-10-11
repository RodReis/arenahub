import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

import { consultaDoFiltro } from '../../../../../src/reports/filtro';

/**
 * Download do Relatório de Alunos, servido pelo painel -- F90.
 *
 * Mesma razão de `/contratos/[id]/documento`: `API_INTERNAL_URL` é o endereço
 * da API vista DE DENTRO da rede e o navegador não o alcança. Esta rota repassa
 * o cookie de ACESSO (nunca o de refresh) e devolve o arquivo.
 *
 * NÃO É PROXY GENÉRICO. O caminho é literal e a query é reconstruída por
 * whitelist (`consultaDoFiltro` + `format`): é justamente por repassar cookie
 * que esta rota não pode virar um caminho autenticado para qualquer parâmetro
 * que o navegador mande. A AUTORIZAÇÃO continua sendo da API (`student.read`).
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

const FORMATOS = new Set(['pdf', 'csv']);

/** Os cabeçalhos que o navegador precisa receber, e nenhum outro. */
const CABECALHOS_REPASSADOS = [
  'content-type',
  'content-disposition',
  'x-content-type-options',
  'cache-control',
] as const;

export async function GET(requisicao: NextRequest): Promise<Response> {
  const acesso = (await cookies()).get('arenahub_access');

  if (!acesso) return new Response(null, { status: 404 });

  const parametros = new URL(requisicao.url).searchParams;
  const formato = parametros.get('format') ?? '';

  if (!FORMATOS.has(formato)) return new Response(null, { status: 400 });

  const consulta = consultaDoFiltro((chave) => parametros.get(chave) ?? undefined);
  consulta.set('format', formato);

  let resposta: Response;

  try {
    resposta = await fetch(`${URL_INTERNA}/api/v1/reports/students/export?${consulta.toString()}`, {
      cache: 'no-store',
      headers: { cookie: `${acesso.name}=${acesso.value}` },
    });
  } catch {
    // API fora do ar: o link não pode pintar a tela de erro. A pessoa tenta de novo.
    return new Response(null, { status: 404 });
  }

  if (!resposta.ok) return new Response(null, { status: resposta.status });

  const cabecalhos = new Headers();

  for (const nome of CABECALHOS_REPASSADOS) {
    const valor = resposta.headers.get(nome);

    if (valor !== null) cabecalhos.set(nome, valor);
  }

  return new Response(await resposta.arrayBuffer(), { status: 200, headers: cabecalhos });
}
