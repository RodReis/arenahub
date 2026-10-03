'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Numero da catraca -- spec 2026-10-03 (id-catraca-automatico).
 *
 * Sem `externalId`, a API GERA o numero (ou devolve o que o aluno ja tem:
 * a rota e idempotente). Com `externalId`, usa o numero que o leitor ja
 * guarda. Nos dois casos a API cria o vinculo com o leitor na hora quando
 * ele existe -- `linkedReaders > 0`.
 *
 * `'use server'` so exporta funcao async: esquema e mensagens ficam privados.
 */
const esquema = z.object({
  studentId: z.string().uuid(),
  externalId: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/, 'Número inválido')
    .optional(),
});

export interface EstadoDoNumero {
  erro?: string;
  numero?: string;
  vinculado?: boolean;
}

export interface NumeroDoLeitor {
  externalId: string;
  readerName: string | null;
  deviceSerial: string;
}

const MENSAGEM: Record<string, string> = {
  CREDENTIAL_ALREADY_ASSIGNED: 'Este número já está vinculado a outro aluno.',
  STUDENT_NOT_FOUND: 'Aluno não encontrado.',
};

export async function gerarNumeroDaCatraca(
  _anterior: EstadoDoNumero,
  formulario: FormData,
): Promise<EstadoDoNumero> {
  const bruto = formulario.get('externalId');
  const validado = esquema.safeParse({
    studentId: formulario.get('studentId'),
    externalId: typeof bruto === 'string' && bruto.trim() !== '' ? bruto : undefined,
  });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados.' };
  }

  const { studentId, externalId } = validado.data;
  const resposta = await chamarApi<{ externalId: string; linkedReaders: number }>(
    `/api/v1/students/${studentId}/turnstile-number`,
    { metodo: 'POST', corpo: externalId === undefined ? {} : { externalId } },
  );

  if (!resposta.ok || !resposta.dados) {
    const codigo = resposta.erro?.code ?? '';
    return { erro: MENSAGEM[codigo] ?? `Não foi possível obter o número (${codigo || 'erro'}).` };
  }

  revalidatePath('/students');
  revalidatePath(`/students/${studentId}`);

  return { numero: resposta.dados.externalId, vinculado: resposta.dados.linkedReaders > 0 };
}

export async function listarNumerosDoLeitorSemAluno(): Promise<NumeroDoLeitor[]> {
  const resposta = await chamarApi<NumeroDoLeitor[]>('/api/v1/device-reader-numbers/unlinked');

  return resposta.ok && resposta.dados ? resposta.dados : [];
}
