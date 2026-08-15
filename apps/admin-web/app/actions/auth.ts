'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Cookies que a Server Action tem permissao de copiar da API.
 *
 * Lista fixa, e nao "copie tudo que veio": um cookie novo que a API passe a
 * emitir amanha nao entra na sessao do navegador sem alguem decidir aqui.
 */
const COOKIES_PERMITIDOS = ['arenahub_access', 'arenahub_refresh'];

const esquemaDeLogin = z.object({
  email: z.string().email('Informe um e-mail valido'),
  password: z.string().min(1, 'Informe a senha'),
});

export interface EstadoDoFormulario {
  erro?: string;
  /** Valores digitados, devolvidos para nao perder o que o usuario escreveu. */
  email?: string;
}

/**
 * Copia para o navegador so os cookies da lista.
 *
 * O parse e manual e simples de proposito: o que interessa e nome, valor e
 * os atributos de seguranca, que reemitimos com os mesmos valores que a API
 * usou.
 */
async function repassarCookies(cookiesDaApi: string[]): Promise<void> {
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

export async function entrar(
  _anterior: EstadoDoFormulario,
  formulario: FormData,
): Promise<EstadoDoFormulario> {
  // `FormData.get` devolve `string | File | null`. Um `File` chegando aqui
  // viraria "[object File]" no `String()` -- e o lint acusa com razao. O
  // campo de texto so pode ser string.
  const texto = (campo: string): string => {
    const valor = formulario.get(campo);

    return typeof valor === 'string' ? valor : '';
  };

  const bruto = { email: texto('email'), password: texto('password') };

  const validado = esquemaDeLogin.safeParse(bruto);

  if (!validado.success) {
    // Devolve o e-mail para o campo, nunca a senha: senha em prop
    // serializada volta no HTML da pagina.
    return { erro: validado.error.issues[0]?.message ?? 'Dados invalidos', email: bruto.email };
  }

  const resposta = await chamarApi('/api/v1/auth/login', {
    metodo: 'POST',
    corpo: validado.data,
  });

  if (!resposta.ok) {
    // Mensagem unica: a API ja nao distingue senha errada de e-mail
    // inexistente, e a interface nao pode desfazer isso.
    return { erro: 'E-mail ou senha invalidos', email: bruto.email };
  }

  await repassarCookies(resposta.cookiesDaApi);

  redirect('/units');
}

export async function sair(): Promise<void> {
  const resposta = await chamarApi('/api/v1/auth/logout', { metodo: 'POST' });

  await repassarCookies(resposta.cookiesDaApi);

  const armazem = await cookies();
  for (const nome of COOKIES_PERMITIDOS) armazem.delete(nome);

  redirect('/login');
}
