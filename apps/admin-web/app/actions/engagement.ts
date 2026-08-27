'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Moderação de apelido público -- F30, Task 9.
 *
 * O moderador so ESCOLHE entre `APPROVED` e `REJECTED`; a API da Task 7 nao
 * aceita outra coisa no PATCH (`engagement.controller.ts`, `esquemaDeModeracao`)
 * -- `HIDDEN` existe no enum de estado mas nao e uma decisao deste formulario.
 */
const esquemaDeModeracao = z.object({
  perfilId: z.string().uuid(),
  decisao: z.enum(['APPROVED', 'REJECTED']),
  rejectionReason: z
    .enum(['OFENSIVO', 'CONTEM_PII', 'IMPERSONACAO', 'SPAM_OU_PROPAGANDA', 'ILEGIVEL'])
    .nullish(),
});

export interface EstadoDaModeracao {
  erro?: string;
  sucesso?: { perfilId: string };
}

/**
 * Mensagem por codigo estavel -- nunca a mensagem crua do servidor.
 *
 * `ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO` e o erro que o moderador encontra de
 * verdade (dois alunos escolhendo o mesmo apelido, o segundo chegando na
 * fila depois do primeiro ja aprovado): a mensagem explica o que aconteceu,
 * nao so o codigo.
 */
const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  RAZAO_DE_RECUSA_OBRIGATORIA: 'Escolha um motivo para rejeitar o apelido.',
  RAZAO_DE_RECUSA_INVALIDA: 'Motivo de rejeição inválido.',
  ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO:
    'Outro aluno já tem este apelido aprovado. Rejeite ou peça para este aluno escolher outro.',
};

function mensagemDe(code: string | undefined, padrao: string): string {
  return (code ? MENSAGEM[code] : undefined) ?? padrao;
}

export async function moderarAlias(
  _anterior: EstadoDaModeracao,
  formulario: FormData,
): Promise<EstadoDaModeracao> {
  const analisado = esquemaDeModeracao.safeParse({
    perfilId: formulario.get('perfilId'),
    decisao: formulario.get('decisao'),
    rejectionReason: formulario.get('rejectionReason') || null,
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/engagement/aliases/${analisado.data.perfilId}`,
    {
      metodo: 'PATCH',
      corpo: {
        decisao: analisado.data.decisao,
        ...(analisado.data.rejectionReason
          ? { rejectionReason: analisado.data.rejectionReason }
          : {}),
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível registrar a decisão.') };
  }

  revalidatePath('/engagement/aliases');

  return { sucesso: { perfilId: resposta.dados.id } };
}
