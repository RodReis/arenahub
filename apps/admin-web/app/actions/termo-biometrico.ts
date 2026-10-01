'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Publicação do termo biométrico (issue #491).
 *
 * `POST /api/v1/consent-documents/biometric` existia desde a F8 e nenhuma
 * tela o chamava. Sem termo vigente o consentimento legado não nasce, e a
 * importação da base do leitor da Arena Positiva vinculou zero de 428 alunos.
 *
 * Os limites espelham o `esquemaDeDocumento` da API, para o erro aparecer
 * aqui, com a frase certa, e não como `VALIDATION_FAILED` genérico.
 */
const esquemaDoTermo = z.object({
  version: z.coerce.number().int().positive('Versão inválida'),
  purpose: z
    .string()
    .trim()
    .min(10, 'Descreva a finalidade em pelo menos 10 caracteres')
    .max(500, 'Finalidade longa demais (máximo 500 caracteres)'),
  content: z.string().trim().min(50, 'O texto do termo precisa de pelo menos 50 caracteres'),
});

export interface EstadoDoTermo {
  erro?: string;
  sucesso?: { version: number };
  valores?: Record<string, string>;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados do termo.',
  FORBIDDEN: 'Seu perfil não tem permissão para publicar o termo biométrico.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

export async function publicarTermoBiometrico(
  _anterior: EstadoDoTermo,
  formulario: FormData,
): Promise<EstadoDoTermo> {
  const valores = {
    version: texto(formulario, 'version'),
    purpose: texto(formulario, 'purpose'),
    content: texto(formulario, 'content'),
  };

  const validado = esquemaDoTermo.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados do termo.', valores };
  }

  const resposta = await chamarApi<{ version: number }>('/api/v1/consent-documents/biometric', {
    metodo: 'POST',
    corpo: validado.data,
  });

  if (!resposta.ok || !resposta.dados) {
    const codigo = resposta.erro?.code ?? '';

    return {
      erro: MENSAGEM[codigo] ?? `Não foi possível publicar o termo (${codigo || 'erro'}).`,
      valores,
    };
  }

  revalidatePath('/operations/biometric-term');

  return { sucesso: { version: resposta.dados.version } };
}
