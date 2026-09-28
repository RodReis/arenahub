'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Vínculo do membro do time -- F81, PATCH `/api/v1/team/:id/employment`.
 *
 * Mesmo padrão de `alterarSituacao` em `actions/students.ts`: a validação
 * daqui não substitui a da API, existe para a recepção ver o erro sem perder
 * o que escolheu -- a API valida de novo e é ela que manda.
 */
const esquemaDeVinculo = z.object({
  teamMemberId: z.string().uuid(),
  employmentType: z.enum(['CLT', 'PJ', 'AUTONOMOUS']),
  employmentStartedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de início do vínculo'),
  version: z.coerce.number().int().min(0),
});

export interface EstadoDoVinculo {
  erro?: string;
  sucesso?: {
    employmentType: string | null;
    employmentStartedAt: string | null;
    version: number;
  };
}

const MENSAGEM: Record<string, string> = {
  STALE_VERSION: 'Alguém alterou este vínculo enquanto você editava. Recarregue a página.',
  TEAM_MEMBER_NOT_FOUND: 'Membro do time não encontrado.',
  FORBIDDEN: 'Seu perfil não tem permissão para esta ação.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function atualizarVinculo(
  _anterior: EstadoDoVinculo,
  formulario: FormData,
): Promise<EstadoDoVinculo> {
  const teamMemberId = texto(formulario, 'teamMemberId');

  const validado = esquemaDeVinculo.safeParse({
    teamMemberId,
    employmentType: texto(formulario, 'employmentType'),
    employmentStartedAt: texto(formulario, 'employmentStartedAt'),
    version: texto(formulario, 'version'),
  });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados do vínculo.' };
  }

  const resposta = await chamarApi<{
    employmentType: string | null;
    employmentStartedAt: string | null;
    version: number;
  }>(`/api/v1/team/${validado.data.teamMemberId}/employment`, {
    metodo: 'PATCH',
    corpo: {
      employmentType: validado.data.employmentType,
      employmentStartedAt: validado.data.employmentStartedAt,
      version: validado.data.version,
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível salvar o vínculo') };
  }

  revalidatePath(`/team/${teamMemberId}`);

  return {
    sucesso: {
      employmentType: resposta.dados.employmentType,
      employmentStartedAt: resposta.dados.employmentStartedAt,
      version: resposta.dados.version,
    },
  };
}

/**
 * Troca de perfil -- F82, PATCH `/api/v1/team/:id/profile`.
 *
 * A pessoa MUDA DE LISTA ao trocar perfil: quem vira `STUDENT` some de
 * `/team` no próximo carregamento (o repositório filtra `profile != STUDENT`).
 * Por isso o sucesso REDIRECIONA para `/team` em vez de manter a ficha aberta
 * -- decisão do PI: um F5 na URL antiga bateria 404 (`TEAM_MEMBER_NOT_FOUND`),
 * e a lista é o destino que continua válido qualquer que seja o perfil novo.
 */
const esquemaDePerfil = z.object({
  teamMemberId: z.string().uuid(),
  profile: z.enum(['ADMIN', 'STUDENT', 'STAFF', 'TRAINER']),
  version: z.coerce.number().int().min(0),
});

export interface EstadoDoPerfil {
  erro?: string;
}

export async function alterarPerfilDeTime(
  _anterior: EstadoDoPerfil,
  formulario: FormData,
): Promise<EstadoDoPerfil> {
  const validado = esquemaDePerfil.safeParse({
    teamMemberId: texto(formulario, 'teamMemberId'),
    profile: texto(formulario, 'profile'),
    version: texto(formulario, 'version'),
  });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira o perfil escolhido.' };
  }

  const resposta = await chamarApi<{ profile: string }>(
    `/api/v1/team/${validado.data.teamMemberId}/profile`,
    { metodo: 'PATCH', corpo: { profile: validado.data.profile, version: validado.data.version } },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível trocar o perfil') };
  }

  revalidatePath('/team');
  revalidatePath('/students');
  redirect('/team');
}
