import 'server-only';

import { cookies } from 'next/headers';

/**
 * Cookies que a Server Action tem permissão de copiar da API.
 *
 * Lista fixa, e não "copie tudo que veio": um cookie novo que a API passe a
 * emitir amanhã não entra na sessão do navegador sem alguém decidir aqui.
 */
export const COOKIES_PERMITIDOS = ['arenahub_access', 'arenahub_refresh'];

/**
 * Copia para o navegador só os cookies da lista.
 *
 * MORA AQUI, e não em `app/actions/auth.ts`, porque a elevação de suporte
 * (F61) precisa da mesma coisa: `POST /platform/tenants/:id/elevar` devolve um
 * cookie de acesso NOVO, já com o tenant alvo, e `encerrar` devolve um sem
 * tenant. Um arquivo `'use server'` só pode exportar função async — reexportar
 * este helper de lá o transformaria numa Server Action pública, chamável do
 * navegador.
 *
 * O parse é manual e simples de propósito: o que interessa é nome, valor e os
 * atributos de segurança, que reemitimos com os mesmos valores que a API usou.
 */
export async function repassarCookies(cookiesDaApi: string[]): Promise<void> {
  const armazem = await cookies();

  for (const bruto of cookiesDaApi) {
    const [par] = bruto.split(';');
    const [nome, ...resto] = (par ?? '').split('=');

    if (!nome || !COOKIES_PERMITIDOS.includes(nome)) continue;

    armazem.set({
      name: nome,
      value: resto.join('='),
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
}
