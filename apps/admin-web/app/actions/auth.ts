'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { COOKIES_PERMITIDOS, repassarCookies } from '../../lib/api/repassar-cookies';

const esquemaDeLogin = z.object({
  email: z.string().email('Informe um e-mail valido'),
  password: z.string().min(1, 'Informe a senha'),
});

export interface EstadoDoFormulario {
  erro?: string;
  /** Valores digitados, devolvidos para nao perder o que o usuario escreveu. */
  email?: string;
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

  /*
   * ENTRA EM OPERAÇÃO, não em Unidades (decisão do PI, 24/08/2026).
   *
   * Quem abre o painel no começo do turno pergunta "a catraca está de pé?",
   * não "quais unidades existem?" -- e Unidades virou tela de
   * Administração, aberta uma vez por mês. Cair na configuração ao logar
   * fazia a recepção navegar antes de começar a trabalhar.
   */
  redirect('/dashboard');
}

export async function sair(): Promise<void> {
  const resposta = await chamarApi('/api/v1/auth/logout', { metodo: 'POST' });

  await repassarCookies(resposta.cookiesDaApi);

  const armazem = await cookies();
  for (const nome of COOKIES_PERMITIDOS) armazem.delete(nome);

  redirect('/login');
}
