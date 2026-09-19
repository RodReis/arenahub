'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Agenda de aulas -- F77 (SPEC-077, ADR-061).
 *
 * A validacao daqui NAO substitui a da API: existe para a recepcao ver o
 * erro sem perder o que digitou. A API valida de novo e e ela que manda --
 * Server Action e superficie publica tanto quanto um endpoint.
 */
const esquemaDeAula = z.object({
  gymUnitId: z.string().uuid(),
  modalityId: z.string().uuid('Selecione a modalidade'),
  // Opcional -- decisao do PI, 18/09/2026: quadra alugada sem professor e
  // caso real (SPEC-077 3.1).
  trainerId: z.string().uuid().optional().or(z.literal('')),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startMinute: z.coerce.number().int().min(0),
  durationMinutes: z.coerce.number().int().positive('Duração deve ser maior que zero'),
  capacity: z.coerce.number().int().positive('Capacidade deve ser maior que zero'),
});

const esquemaDeExcecao = z
  .object({
    gymUnitId: z.string().uuid(),
    classId: z.string().uuid(),
    occurrenceDate: z.string().min(1, 'Selecione a data'),
    type: z.enum(['CANCELLED', 'TRAINER_OVERRIDE']),
    overrideTrainerId: z.string().uuid().optional().or(z.literal('')),
  })
  .refine((dados) => dados.type !== 'TRAINER_OVERRIDE' || !!dados.overrideTrainerId, {
    message: 'Selecione o professor substituto',
  });

export interface EstadoDaAula {
  erro?: string;
  sucesso?: { id: string };
  valores?: {
    modalityId?: string;
    trainerId?: string;
    dayOfWeek?: string;
    startMinute?: string;
    durationMinutes?: string;
    capacity?: string;
  };
}

export interface EstadoDaExcecao {
  erro?: string;
  sucesso?: { id: string };
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  FORBIDDEN: 'Seu perfil não tem permissão para gerenciar a agenda de aulas.',
  UNIT_NOT_FOUND: 'Unidade não encontrada.',
  MODALITY_NOT_FOUND: 'Modalidade não encontrada nesta unidade.',
  TRAINER_INVALID: 'O professor selecionado precisa ser um aluno com perfil de professor.',
  CLASS_NOT_FOUND: 'Aula não encontrada.',
  CLASS_SCHEDULE_INVALID:
    'Horário inválido: confira o dia, o início e a duração. Aula não pode atravessar a virada do dia.',
  CLASS_EXCEPTION_ALREADY_EXISTS: 'Já existe uma exceção registrada para esta aula neste dia.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function cadastrarAula(
  _anterior: EstadoDaAula,
  formulario: FormData,
): Promise<EstadoDaAula> {
  const gymUnitId = texto(formulario, 'gymUnitId');

  const valores = {
    modalityId: texto(formulario, 'modalityId'),
    trainerId: texto(formulario, 'trainerId'),
    dayOfWeek: texto(formulario, 'dayOfWeek'),
    startMinute: texto(formulario, 'startMinute'),
    durationMinutes: texto(formulario, 'durationMinutes'),
    capacity: texto(formulario, 'capacity'),
  };

  const validado = esquemaDeAula.safeParse({ gymUnitId, ...valores });

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const resposta = await chamarApi<{ id: string }>(`/api/v1/units/${gymUnitId}/classes`, {
    metodo: 'POST',
    corpo: {
      gymUnitId: validado.data.gymUnitId,
      modalityId: validado.data.modalityId,
      ...(validado.data.trainerId ? { trainerId: validado.data.trainerId } : {}),
      dayOfWeek: validado.data.dayOfWeek,
      startMinute: validado.data.startMinute,
      durationMinutes: validado.data.durationMinutes,
      capacity: validado.data.capacity,
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível cadastrar a aula'), valores };
  }

  revalidatePath('/classes');

  return { sucesso: { id: resposta.dados.id } };
}

/**
 * Registra excecao de calendario: cancela UMA ocorrencia ou troca o
 * professor de UM dia, sem desfazer a grade (SPEC-077 §3).
 */
export async function registrarExcecaoDeAula(
  _anterior: EstadoDaExcecao,
  formulario: FormData,
): Promise<EstadoDaExcecao> {
  const gymUnitId = texto(formulario, 'gymUnitId');
  const classId = texto(formulario, 'classId');

  const validado = esquemaDeExcecao.safeParse({
    gymUnitId,
    classId,
    occurrenceDate: texto(formulario, 'occurrenceDate'),
    type: texto(formulario, 'type'),
    overrideTrainerId: texto(formulario, 'overrideTrainerId'),
  });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/units/${gymUnitId}/classes/${classId}/exceptions`,
    {
      metodo: 'POST',
      corpo: {
        occurrenceDate: validado.data.occurrenceDate,
        type: validado.data.type,
        ...(validado.data.type === 'TRAINER_OVERRIDE'
          ? { overrideTrainerId: validado.data.overrideTrainerId }
          : {}),
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível registrar a exceção') };
  }

  revalidatePath('/classes');

  return { sucesso: { id: resposta.dados.id } };
}

/** Liga/desliga a aula da grade. INATIVAR, NUNCA APAGAR. */
export async function alternarAtivacaoDaAula(
  _anterior: EstadoDaAula,
  formulario: FormData,
): Promise<EstadoDaAula> {
  const gymUnitId = texto(formulario, 'gymUnitId');
  const classId = texto(formulario, 'classId');
  const isActive = texto(formulario, 'isActive') === 'true';

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/units/${gymUnitId}/classes/${classId}/activation`,
    { metodo: 'PATCH', corpo: { isActive } },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(
        resposta.erro?.code ?? '',
        isActive ? 'Não foi possível reativar a aula' : 'Não foi possível inativar a aula',
      ),
    };
  }

  revalidatePath('/classes');

  return { sucesso: { id: resposta.dados.id } };
}
