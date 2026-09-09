import 'server-only';

import { cookies } from 'next/headers';

/**
 * Onde o desafio de segundo fator espera entre o login e a tela do codigo.
 *
 * O pre-auth NAO E SESSAO: ele so serve para completar o MFA e vale cinco
 * minutos na API. Mas e credencial, e por isso nao pode viajar como os
 * caminhos obvios levariam:
 *
 * - na URL, ele fica no historico do navegador, no `Referer` e em todo log de
 *   proxy no meio do caminho;
 * - como prop de Client Component, ele volta serializado no HTML da pagina --
 *   o mesmo motivo pelo qual a senha nunca e devolvida ao formulario;
 * - em `localStorage`, qualquer script da pagina o le.
 *
 * Cookie `httpOnly` e o unico dos quatro que o JavaScript do navegador nao
 * alcanca, e a Server Action o le no servidor sem que ele passe pelo HTML.
 *
 * NAO entra em `COOKIES_PERMITIDOS`: aquela lista e o que a API MANDA gravar,
 * e este cookie e decisao do painel, escrito a partir do corpo da resposta.
 */
const COOKIE_DE_PRE_AUTH = 'arenahub_preauth';

/**
 * Cinco minutos -- o mesmo que `PRE_AUTH_VALIDO_POR_SEGUNDOS` na API.
 *
 * Guardar por mais tempo nao estenderia nada: a API recusa o token vencido de
 * qualquer forma. O que um prazo maior faria e deixar um cookie morto no
 * navegador, e a tela pediria o codigo para depois falhar com "sessao
 * expirada" -- pior que mandar de volta ao login na hora certa.
 */
const VALIDO_POR_SEGUNDOS = 5 * 60;

export type DesafioDeSegundoFator = 'MFA_SETUP' | 'MFA_VERIFY';

export async function gravarPreAuth(
  token: string,
  desafio: DesafioDeSegundoFator,
): Promise<void> {
  const armazem = await cookies();

  armazem.set({
    name: COOKIE_DE_PRE_AUTH,
    // O tipo do desafio viaja junto com o token, e nao em cookie separado:
    // sao um dado so, e dois cookies poderiam divergir -- um desafio de
    // VERIFY com o token de um SETUP anterior, por exemplo.
    value: `${desafio}:${token}`,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VALIDO_POR_SEGUNDOS,
  });
}

export async function lerPreAuth(): Promise<{
  token: string;
  desafio: DesafioDeSegundoFator;
} | null> {
  const armazem = await cookies();
  const bruto = armazem.get(COOKIE_DE_PRE_AUTH)?.value;

  if (!bruto) return null;

  const separador = bruto.indexOf(':');

  if (separador < 0) return null;

  const desafio = bruto.slice(0, separador);
  const token = bruto.slice(separador + 1);

  // Cookie adulterado ou de uma versao anterior do painel: trata como
  // ausente, e a tela manda de volta ao login. Confiar no valor levaria um
  // `desafio` invalido para dentro da decisao de qual rota chamar.
  if (desafio !== 'MFA_SETUP' && desafio !== 'MFA_VERIFY') return null;
  if (!token) return null;

  return { token, desafio };
}

/**
 * Apaga o desafio. Chamado ao concluir E ao desistir: um pre-auth esquecido
 * no navegador faria a proxima visita a `/login` cair na tela do codigo, com
 * um token que ja nao vale.
 */
export async function limparPreAuth(): Promise<void> {
  (await cookies()).delete(COOKIE_DE_PRE_AUTH);
}
