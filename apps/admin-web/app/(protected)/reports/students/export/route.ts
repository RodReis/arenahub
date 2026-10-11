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

/**
 * O download que falha NÃO vira página em branco: o link de exportação é um
 * `<a>` comum, e o navegador mostraria "esta página não está funcionando" para
 * um 422 ou 500 de corpo vazio. Em vez disso a pessoa volta para a tela do
 * relatório, com o mesmo filtro, e lá a mensagem explica o que houve.
 *
 * 422 é só o teto de exportação (`REPORT_TOO_LARGE`): erro de formato é 400 e
 * morre aqui antes de chamar a API.
 */
function voltarParaATela(consulta: URLSearchParams, erro: 'muito-grande' | 'falha'): Response {
  const volta = new URLSearchParams(consulta);

  volta.delete('format');
  volta.set('erro', erro);

  return new Response(null, {
    status: 303,
    headers: { location: `/reports/students?${volta.toString()}` },
  });
}

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
    // API fora do ar: a pessoa volta para a tela e tenta de novo.
    return voltarParaATela(consulta, 'falha');
  }

  if (!resposta.ok) return voltarParaATela(consulta, resposta.status === 422 ? 'muito-grande' : 'falha');

  const cabecalhos = new Headers();

  for (const nome of CABECALHOS_REPASSADOS) {
    const valor = resposta.headers.get(nome);

    if (valor !== null) cabecalhos.set(nome, valor);
  }

  return new Response(await resposta.arrayBuffer(), { status: 200, headers: cabecalhos });
}
