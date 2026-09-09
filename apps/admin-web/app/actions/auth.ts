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

/*
 * NÃO exportado, de propósito: arquivo `'use server'` só exporta função async,
 * e exportar isto o transformaria numa Server Action chamável do navegador.
 */
function ehDesafioDeSegundoFator(dados: unknown): boolean {
  return typeof dados === 'object' && dados !== null && 'desafio' in dados;
}

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

  /*
   * DESAFIO DE SEGUNDO FATOR NÃO É SESSÃO — e chega com status 200.
   *
   * O login do Super Admin devolve `{ desafio, preAuth }` e NENHUM cookie
   * (INV-007: um fator não abre sessão de plataforma). Como o status é de
   * sucesso, `resposta.ok` é verdadeiro; sem esta checagem o código repassaria
   * uma lista vazia de cookies e redirecionaria para `/dashboard`, onde o
   * layout não acha sessão e devolve para `/login`. O resultado é um laço
   * silencioso: a senha está certa, e a tela insiste em não deixar entrar.
   *
   * A tela do segundo fator ainda não existe (a API a ganhou na F61, o painel
   * não). Enquanto ela não vem, o mínimo honesto é PARAR aqui e dizer por quê,
   * em vez de fingir um login que não aconteceu.
   */
  if (ehDesafioDeSegundoFator(resposta.dados)) {
    return {
      erro: 'Esta conta exige segundo fator, e o painel ainda não oferece essa tela.',
      email: bruto.email,
    };
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
