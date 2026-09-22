'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Usuários do painel — issue #274.
 *
 * A API tinha `POST /users/invitations` e `POST /users/invitations/accept`
 * desde sempre, e NENHUM chamador: criar um administrador exigia `curl` com
 * um `roleId` descoberto direto no banco. Esta fatia dá tela aos dois.
 *
 * SENHA MÍNIMA é a da API (`esquemaDeAceite`), não escolha desta tela.
 * Repetir aqui evita o round-trip que devolveria `VALIDATION_FAILED` sem
 * dizer qual campo — quem está criando a própria conta veria "confira os
 * dados" e tentaria de novo com a mesma senha curta.
 *
 * Passou de 12 para 8 por decisão do PI em 05/09/2026 (issue #281). Se mudar
 * de novo, muda nos TRÊS lugares: aqui, no `esquemaDeAceite` da API e na dica
 * do formulário de aceite.
 */
const MINIMO_DE_SENHA = 8;

const esquemaDeConvite = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido').max(320),
  roleId: z.string().uuid('Selecione o papel'),
});

const esquemaDeAceite = z
  .object({
    token: z.string().min(1, 'Convite inválido ou expirado.').max(512),
    password: z
      .string()
      .min(MINIMO_DE_SENHA, `A senha precisa ter ao menos ${MINIMO_DE_SENHA} caracteres`)
      .max(1024, 'Senha longa demais'),
    confirmacao: z.string(),
  })
  /*
   * A CONFIRMAÇÃO É SÓ DA TELA — a API não a conhece, e por isso ela não vai
   * no corpo. Existe porque o aceite é a ÚNICA chance: errar a senha aqui
   * cria a conta com uma senha que ninguém sabe, e não há recuperação de
   * senha no produto (ver a tela de login). Um erro de digitação viraria
   * chamado para o suporte e um convite novo.
   */
  .refine((dados) => dados.password === dados.confirmacao, {
    message: 'As senhas não conferem',
    path: ['confirmacao'],
  });

export interface EstadoDoConvite {
  erro?: string;
  sucesso?: {
    email: string;
    /**
     * O token EM CLARO, devolvido UMA VEZ pela API.
     *
     * Vai para a tela porque não há envio de e-mail no produto: quem convida
     * copia o link e entrega por fora. O banco só tem o hash — recarregar a
     * página perde o link para sempre, e a tela precisa dizer isso.
     */
    token: string;
    expiresAt: string;
    /**
     * Se o convite saiu por e-mail (issue #277).
     *
     * `false` NAO e erro: o convite existe e o link vale. Significa que a
     * entrega e por conta de quem convidou -- sem chave do Resend, com o
     * dominio ainda nao verificado, ou com o provedor fora do ar. A tela
     * precisa dizer isso, senao a recepcao espera por um e-mail que nunca
     * saiu.
     */
    emailEnviado: boolean;
  };
  /** Devolvido para o formulário não perder o que foi digitado em erro. */
  valores?: { email?: string; roleId?: string };
}

export interface EstadoDoAceite {
  erro?: string;
  sucesso?: true;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  FORBIDDEN: 'Seu perfil não tem permissão para convidar usuários.',
  ROLE_NOT_FOUND: 'Papel não encontrado nesta academia.',
  /*
   * A API responde UM código para expirado, já aceito, revogado e
   * inexistente (`ConviteInvalidoError`), de propósito: distinguir ensinaria
   * a quem sonda quais convites existiram. A frase acompanha essa escolha e
   * não tenta adivinhar qual dos quatro é.
   */
  INVITATION_INVALID: 'Convite inválido ou expirado. Peça um novo à academia.',

  /*
   * Recusas da revogação de acesso (F80). Cada uma pede um ato diferente de
   * quem está na tela, então cada uma tem frase própria.
   */
  MOTIVO_OBRIGATORIO: 'Escreva o motivo da revogação (ao menos 10 caracteres).',
  USER_NOT_FOUND: 'Esta pessoa não tem mais acesso a esta academia.',
  NAO_REVOGA_A_SI_MESMO: 'Você não pode revogar o próprio acesso.',
  ULTIMO_DONO:
    'Este é o único dono da academia. Convide outro dono antes de revogar este acesso.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function convidarUsuario(
  _anterior: EstadoDoConvite,
  formulario: FormData,
): Promise<EstadoDoConvite> {
  const valores = { email: texto(formulario, 'email'), roleId: texto(formulario, 'roleId') };

  const validado = esquemaDeConvite.safeParse(valores);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const resposta = await chamarApi<{
    id: string;
    expiresAt: string;
    token: string;
    emailEnviado?: boolean;
  }>(
    '/api/v1/users/invitations',
    { metodo: 'POST', corpo: { email: validado.data.email, roleId: validado.data.roleId } },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível convidar'), valores };
  }

  /*
   * A LISTA NÃO MUDA AGORA, e a revalidação é para o retorno.
   *
   * Convidar não cria usuário: quem entra na lista é quem ACEITA, do outro
   * lado e mais tarde. Sem `GET /users/invitations` na API, o convite
   * pendente não aparece em lugar nenhum -- a tela mostra o link uma vez e
   * pronto.
   *
   * Revalidar mesmo assim custa uma consulta e cobre o caso real: a pessoa
   * aceita, quem convidou volta à aba aberta, e sem isto veria a lista
   * cacheada de antes do convite e concluiria que o aceite falhou.
   */
  revalidatePath('/users');

  return {
    sucesso: {
      email: validado.data.email,
      token: resposta.dados.token,
      expiresAt: resposta.dados.expiresAt,
      /*
       * AUSENTE VIRA `false`, e nao `true`: uma API antiga que ainda nao
       * devolva o campo faria a tela AFIRMAR que o e-mail saiu quando nem
       * existe envio. Errar para o lado de "entregue o link a mao" custa um
       * aviso a mais; errar para o outro lado deixa a pessoa esperando.
       */
      emailEnviado: resposta.dados.emailEnviado ?? false,
    },
  };
}

/**
 * Aceita o convite e define a senha.
 *
 * PÚBLICA de propósito, como a rota que ela chama: quem aceita convite ainda
 * não tem conta, e exigir sessão aqui tornaria o convite inútil.
 *
 * NÃO LOGA a pessoa depois: a API devolve `{}` sem cookie de sessão, e a
 * conta nasce com MFA pendente. Forjar uma sessão daqui exigiria uma segunda
 * chamada com a senha recém-criada -- mais superfície para o mesmo resultado
 * que um redirecionamento ao login dá.
 */
export async function aceitarConvite(
  _anterior: EstadoDoAceite,
  formulario: FormData,
): Promise<EstadoDoAceite> {
  const validado = esquemaDeAceite.safeParse({
    token: texto(formulario, 'token'),
    password: texto(formulario, 'password'),
    confirmacao: texto(formulario, 'confirmacao'),
  });

  if (!validado.success) {
    // A SENHA NÃO VOLTA para a tela, ao contrário do e-mail no convite:
    // devolvida como estado, reapareceria no HTML da página. Mesma regra do
    // formulário de login.
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<Record<string, never>>('/api/v1/users/invitations/accept', {
    metodo: 'POST',
    corpo: { token: validado.data.token, password: validado.data.password },
  });

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível aceitar o convite') };
  }

  return { sucesso: true };
}

const esquemaDeRevogacao = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Escreva o motivo da revogação (ao menos 10 caracteres).')
    .max(500, 'Motivo longo demais'),
});

export interface EstadoDaRevogacao {
  erro?: string;
  revogado?: boolean;
}

/**
 * Tira o acesso de alguém ao painel — F80.
 *
 * O MOTIVO É OBRIGATÓRIO e vai para a auditoria do tenant. Pedi-lo na tela e
 * descartá-lo aqui seria teatro — a pergunta existe porque a resposta fica
 * gravada, como no desligamento de cliente e na revogação de biometria.
 */
export async function revogarAcesso(
  _anterior: EstadoDaRevogacao,
  formulario: FormData,
): Promise<EstadoDaRevogacao> {
  const userId = texto(formulario, 'userId');

  const validado = esquemaDeRevogacao.safeParse({ reason: texto(formulario, 'reason') });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Escreva o motivo da revogação.' };
  }

  const resposta = await chamarApi<{ revogado: boolean }>(
    `/api/v1/users/${encodeURIComponent(userId)}/revogar`,
    { metodo: 'POST', corpo: { reason: validado.data.reason } },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível revogar o acesso') };
  }

  revalidatePath('/users');

  return { revogado: true };
}
