import { NextResponse, type NextRequest } from 'next/server';

import { precisaRenovar } from './src/auth/sessao';

/**
 * Renovacao de sessao -- issue #187.
 *
 * O token de acesso vale 10 minutos e NADA o renovava: `POST /auth/refresh`
 * existia na API desde sempre e o painel nunca o chamava. Com a aba parada,
 * a API passava a responder `401 AUTH_REQUIRED` e toda Server Action falhava
 * calada -- a recepcao atribuia um plano, nao gravava nada, e a tela nao
 * dizia que o problema era login.
 *
 * POR QUE AQUI, E NAO NO `chamarApi`.
 *
 * Duas razoes, e as duas sao bloqueios reais, nao preferencia:
 *
 * 1. SERVER COMPONENT NAO GRAVA COOKIE. O Next barra mutacao durante o
 *    render. `chamarApi` e chamado das paginas, entao mesmo que renovasse,
 *    nao conseguiria persistir o token novo -- a renovacao valeria para uma
 *    requisicao e se perderia.
 *
 * 2. O REFRESH ROTACIONA E DETECTA REUSO. Usar um refresh ja rotacionado
 *    derruba a FAMILIA inteira de sessoes (`auth.service.ts`, `refresh`).
 *    A ficha do aluno dispara cinco `chamarApi` em `Promise.all`: se cada
 *    uma reagisse ao proprio 401, quatro chegariam com o token velho e
 *    deslogariam o usuario -- trocando "falha calada" por "expulso do
 *    sistema". Aqui a decisao e uma so por requisicao, antes de qualquer
 *    chamada sair.
 *
 * RENOVA ANTES DE EXPIRAR, nao depois: ver `MARGEM_DE_RENOVACAO_MS`.
 *
 * COBRE A SERVER ACTION porque ela NAO e rota propria: o Next a trata como
 * um POST para a rota onde e usada (docs de `proxy`, "Execution order"), e o
 * proxy roda antes. Por isso o `matcher` precisa continuar cobrindo as rotas
 * de pagina -- excluir um caminho tira a renovacao das actions dele junto, e
 * o bug volta so naquela tela.
 */
const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

const COOKIE_DE_ACESSO = 'arenahub_access';
const COOKIE_DE_REFRESH = 'arenahub_refresh';

/**
 * Rotas que nao exigem sessao.
 *
 * `/login` fica de fora porque renovar ali seria trabalho jogado fora --
 * quem esta no login ou nao tem sessao, ou vai criar uma nova.
 *
 * `/convite` entra pelo mesmo motivo, com um agravante (issue #274): quem
 * aceita convite nao tem conta, mas quem ABRE o link para conferir muitas
 * vezes e a propria pessoa que convidou, logada nesta maquina. Sem esta
 * linha o proxy gastaria uma ROTACAO de refresh para servir uma pagina que
 * nao chama nada autenticado -- e refresh rotacionado e detectado como
 * reuso se reaparecer.
 */
const PUBLICAS = ['/login', '/convite', '/marca'];

/**
 * `/{slug}/login` — a tela de entrada da academia (F62, ADR-052 §10).
 *
 * Casa pelo SUFIXO, e não por prefixo como as rotas acima: o slug é o primeiro
 * segmento e não se conhece de antemão. Um prefixo dinâmico aqui liberaria
 * `/qualquer-coisa` inteira, e a renovação de sessão sairia das telas
 * protegidas junto — que é o bug que o comentário do topo deste arquivo
 * descreve.
 *
 * Dois segmentos exatos: `/arena-positiva/login` casa, `/students/x/login`
 * não. Nenhuma rota protegida do painel termina em `/login`.
 */
const LOGIN_COM_SLUG = /^\/[a-z0-9][a-z0-9-]*\/login$/;

export async function proxy(requisicao: NextRequest): Promise<NextResponse> {
  const { pathname } = requisicao.nextUrl;

  if (PUBLICAS.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))) {
    return NextResponse.next();
  }

  if (LOGIN_COM_SLUG.test(pathname)) return NextResponse.next();

  const acesso = requisicao.cookies.get(COOKIE_DE_ACESSO)?.value;
  const refresh = requisicao.cookies.get(COOKIE_DE_REFRESH)?.value;

  /*
   * SEM REFRESH NAO HA O QUE RENOVAR. Segue em frente: quem decide se a
   * pagina exige login e o layout protegido, que ja redireciona quando
   * `/auth/me` recusa. Redirecionar daqui duplicaria essa regra em dois
   * lugares, que e como as duas comecam a divergir.
   */
  if (refresh === undefined) return NextResponse.next();

  if (acesso !== undefined && !precisaRenovar(acesso, Date.now())) {
    return NextResponse.next();
  }

  let resposta: Response;

  try {
    resposta = await fetch(`${URL_INTERNA}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `${COOKIE_DE_REFRESH}=${refresh}` },
      cache: 'no-store',
    });
  } catch {
    /*
     * API FORA DO AR NAO E SESSAO INVALIDA. Seguir sem renovar deixa a
     * pagina falhar com o erro real da API; limpar o cookie aqui deslogaria
     * quem so pegou a API reiniciando.
     */
    return NextResponse.next();
  }

  const seguir = NextResponse.next();

  if (!resposta.ok) {
    /*
     * REFRESH RECUSADO: a sessao acabou de verdade (expirou, foi revogada,
     * ou a familia caiu por reuso). Limpa os dois cookies para o layout
     * protegido mandar ao login em vez de tentar de novo a cada navegacao,
     * e para nao reapresentar um refresh morto -- que a API trata como
     * reuso.
     */
    seguir.cookies.delete(COOKIE_DE_ACESSO);
    seguir.cookies.delete(COOKIE_DE_REFRESH);

    return seguir;
  }

  /*
   * Repassa o par novo. `Set-Cookie` da API traz os atributos que ela mesma
   * escolheu; aqui so os nomes conhecidos sao copiados -- cookie novo que a
   * API passe a emitir amanha nao entra na sessao sem alguem decidir (mesma
   * regra da lista de `app/actions/auth.ts`).
   */
  for (const bruto of resposta.headers.getSetCookie()) {
    const [par] = bruto.split(';');
    const [nome, ...resto] = (par ?? '').split('=');

    if (nome !== COOKIE_DE_ACESSO && nome !== COOKIE_DE_REFRESH) continue;

    seguir.cookies.set({
      name: nome,
      value: resto.join('='),
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  return seguir;
}

export const config = {
  /*
   * Fora: `_next` (bundle e imagem otimizada), o favicon e qualquer arquivo
   * com extensao. Nenhum deles chama a API, e renovar sessao para servir um
   * `.css` gastaria uma rotacao de refresh por asset.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
