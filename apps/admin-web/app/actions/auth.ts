'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { COOKIES_PERMITIDOS, repassarCookies } from '../../lib/api/repassar-cookies';
import {
  gravarPreAuth,
  lerPreAuth,
  limparPreAuth,
  type DesafioDeSegundoFator,
} from '../../lib/api/pre-auth';

const esquemaDeLogin = z.object({
  email: z.string().email('Informe um e-mail valido'),
  password: z.string().min(1, 'Informe a senha'),
});

/*
 * NÃO exportado, de propósito: arquivo `'use server'` só exporta função async,
 * e exportar isto o transformaria numa Server Action chamável do navegador.
 */
function lerDesafioDeSegundoFator(
  dados: unknown,
): { desafio: DesafioDeSegundoFator; preAuth: string } | null {
  if (typeof dados !== 'object' || dados === null) return null;

  const { desafio, preAuth } = dados as { desafio?: unknown; preAuth?: unknown };

  if (typeof preAuth !== 'string' || preAuth === '') return null;
  if (desafio !== 'MFA_SETUP' && desafio !== 'MFA_VERIFY') return null;

  return { desafio, preAuth };
}

/*
 * Rota inicial da sessão recém-aberta.
 *
 * NÃO exportado pelo mesmo motivo de `lerDesafioDeSegundoFator`: arquivo
 * `'use server'` só exporta função async, e exportar isto o transformaria numa
 * Server Action chamável do navegador.
 *
 * Consulta `/auth/me` porque a resposta do login não carrega o sinal: quem é
 * dono do SaaS não tem tenant, e `/dashboard` é rota de TENANT — mandá-lo para
 * lá devolve 401 numa sessão perfeitamente válida (issue #311).
 *
 * Falha de rede ou resposta estranha cai em `/dashboard`, o destino de sempre:
 * um platform admin que caia lá vê o erro e digita `/platform`, enquanto
 * mandar todo mundo para `/platform` na dúvida tiraria o painel de quem
 * trabalha nele o dia inteiro.
 */
async function destinoDaSessao(): Promise<string> {
  const resposta = await chamarApi<{ isPlatformAdmin?: boolean }>('/api/v1/auth/me');

  return resposta.ok && resposta.dados?.isPlatformAdmin ? '/platform' : '/dashboard';
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
   * Por isso o desafio NÃO cai no caminho de sucesso: ele desvia para a tela
   * do segundo fator, que troca o pre-auth pela sessão de verdade.
   */
  const desafio = lerDesafioDeSegundoFator(resposta.dados);

  if (desafio) {
    // O pre-auth vai para COOKIE `httpOnly`, nunca para a URL nem para o
    // estado do formulário -- ver `lib/api/pre-auth.ts`.
    await gravarPreAuth(desafio.preAuth, desafio.desafio);

    redirect(desafio.desafio === 'MFA_SETUP' ? '/login/configurar-2fa' : '/login/2fa');
  }

  await repassarCookies(resposta.cookiesDaApi);

  /*
   * ENTRA EM OPERAÇÃO, não em Unidades (decisão do PI, 24/08/2026).
   *
   * Quem abre o painel no começo do turno pergunta "a catraca está de pé?",
   * não "quais unidades existem?" -- e Unidades virou tela de
   * Administração, aberta uma vez por mês. Cair na configuração ao logar
   * fazia a recepção navegar antes de começar a trabalhar.
   *
   * O dono do SaaS é a exceção: não tem tenant, e Operação é rota de tenant.
   */
  redirect(await destinoDaSessao());
}

export async function sair(): Promise<void> {
  const resposta = await chamarApi('/api/v1/auth/logout', { metodo: 'POST' });

  await repassarCookies(resposta.cookiesDaApi);

  const armazem = await cookies();
  for (const nome of COOKIES_PERMITIDOS) armazem.delete(nome);

  redirect('/login');
}

/*
 * SEGUNDO FATOR -- issue #293.
 *
 * O código tem seis dígitos e é validado aqui antes de ir à API: o Zod da
 * rota já o exigiria, mas um 400 de contrato viraria "erro inesperado" na
 * tela, longe da causa. Dígito trocado por letra é erro de digitação comum, e
 * merece a mensagem certa.
 */
const esquemaDeCodigo = z.object({
  code: z
    .string()
    .trim()
    // Espaço é o que o autenticador do celular mostra ("123 456") e o que a
    // pessoa cola. Recusar por causa dele seria culpar quem copiou certo.
    .transform((valor) => valor.replace(/\s/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'O código tem seis dígitos')),
});

export interface EstadoDoSegundoFator {
  erro?: string;
}

/**
 * Troca o código pelo par de tokens, na conta que JÁ tem segundo fator.
 *
 * O pre-auth vem do cookie, não do formulário: enviá-lo pelo corpo o exporia
 * no HTML da página, e um campo escondido é editável por quem abrir o
 * inspetor.
 */
export async function verificarSegundoFator(
  _anterior: EstadoDoSegundoFator,
  formulario: FormData,
): Promise<EstadoDoSegundoFator> {
  return concluirSegundoFator(formulario, 'MFA_VERIFY', '/api/v1/auth/mfa/verify');
}

/** Confirma a inscrição de quem ainda não tinha segundo fator. */
export async function confirmarInscricaoDeSegundoFator(
  _anterior: EstadoDoSegundoFator,
  formulario: FormData,
): Promise<EstadoDoSegundoFator> {
  return concluirSegundoFator(formulario, 'MFA_SETUP', '/api/v1/auth/mfa/enroll/confirm');
}

/**
 * Desiste do desafio e volta ao login.
 *
 * Existe porque um pre-auth esquecido no navegador faria a próxima visita a
 * `/login` cair na tela do código com um token que já não vale -- e sem saída
 * visível, já que a tela do código não tem campo de e-mail.
 */
export async function cancelarSegundoFator(): Promise<void> {
  await limparPreAuth();

  redirect('/login');
}

/*
 * O corpo comum das duas ações. NÃO exportado: `'use server'` só exporta
 * função async, e exportar isto o tornaria chamável do navegador -- com o
 * `caminho` da API escolhido por quem chama.
 */
async function concluirSegundoFator(
  formulario: FormData,
  esperado: DesafioDeSegundoFator,
  caminho: string,
): Promise<EstadoDoSegundoFator> {
  const desafio = await lerPreAuth();

  /*
   * Sem cookie, ou com o cookie do OUTRO desafio: manda de volta ao login em
   * vez de tentar adivinhar. O segundo caso não é teórico -- basta a pessoa
   * abrir `/login/2fa` à mão tendo um desafio de SETUP pendente, e a API
   * recusaria com um 401 que a tela traduziria como "código inválido",
   * culpando quem digitou certo.
   */
  if (!desafio || desafio.desafio !== esperado) {
    await limparPreAuth();
    redirect('/login');
  }

  const valor = formulario.get('code');
  const validado = esquemaDeCodigo.safeParse({ code: typeof valor === 'string' ? valor : '' });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Código inválido' };
  }

  const resposta = await chamarApi(caminho, {
    metodo: 'POST',
    corpo: { code: validado.data.code },
    preAuth: desafio.token,
  });

  if (!resposta.ok) {
    const codigo = resposta.erro?.code;

    /*
     * Os três casos vêm como 401 e só o `code` os separa -- por isso a
     * decisão é por código, não por status.
     *
     * `AUTH_REQUIRED` é o pre-auth vencido ou inválido, e é diferente de
     * código errado: insistir num desafio morto nunca vai dar certo, e a
     * pessoa precisa saber que o caminho é entrar de novo. O cookie sai junto,
     * senão a próxima visita a `/login` volta para cá com o mesmo token morto.
     */
    if (codigo === 'AUTH_REQUIRED') {
      await limparPreAuth();

      return { erro: 'O desafio expirou. Entre novamente pelo formulário.' };
    }

    /*
     * Reuso NÃO é "código errado": significa que aquele número já passou por
     * aqui. Dizer "tente de novo" esconderia justamente o caso que o operador
     * precisa enxergar.
     */
    if (codigo === 'MFA_CODE_REPLAYED') {
      return { erro: 'Este código já foi usado. Espere o próximo no aplicativo.' };
    }

    return { erro: 'Código inválido. Confira o aplicativo e tente de novo.' };
  }

  await repassarCookies(resposta.cookiesDaApi);
  await limparPreAuth();

  redirect(await destinoDaSessao());
}

/**
 * Busca o segredo TOTP para a tela de configuração.
 *
 * Não é `useActionState`: a tela precisa do segredo AO ABRIR, não ao enviar um
 * formulário. Quem chama é o Server Component da página, que já roda no
 * servidor -- por isso devolve `null` em vez de redirecionar, deixando a
 * página decidir (ela redireciona, e um `redirect` daqui abortaria a
 * renderização com menos contexto sobre o motivo).
 */
export async function iniciarInscricaoDeSegundoFator(): Promise<{
  uri: string;
  base32: string;
} | null> {
  const desafio = await lerPreAuth();

  if (!desafio || desafio.desafio !== 'MFA_SETUP') return null;

  const resposta = await chamarApi<{ uri: string; base32: string }>('/api/v1/auth/mfa/enroll', {
    metodo: 'POST',
    preAuth: desafio.token,
    esquema: z.object({ uri: z.string(), base32: z.string() }),
  });

  return resposta.ok && resposta.dados ? resposta.dados : null;
}
