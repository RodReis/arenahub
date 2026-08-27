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

/** Espelha `SnapshotDto` de `engagement-xp.controller.ts`. */
export interface SnapshotDto {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'WITHHELD';
  publishedAt: string | null;
  entries: { studentId: string; position: number; points: number }[];
}

/**
 * Placar mensal e ajuste de XP -- F31, Task 11.
 *
 * NAO HA ACAO DE EDITAR aqui: `gerarPlacar` e `publicarPlacar` so avancam o
 * snapshot pelos estados que a API aceita (DRAFT/WITHHELD -> PUBLISHED), e
 * `ajustarXp` sempre GRAVA um movimento novo. O ledger append-only e o
 * snapshot imutavel apos publicado sao garantidos no backend (Task 1, Task 8)
 * -- este arquivo so traduz o que a API ja recusa em mensagem de tela.
 */
const MENSAGEM_DO_PLACAR: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  RANKING_SNAPSHOT_IMUTAVEL:
    'Este placar já foi publicado e não pode ser publicado de novo — ele é definitivo.',
  RANKING_SNAPSHOT_NAO_ENCONTRADO: 'Placar não encontrado. Gere um novo antes de publicar.',
};

const MENSAGEM_DO_AJUSTE: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  ALUNO_NAO_ENCONTRADO: 'Aluno não encontrado.',
  CATALOGO_DE_XP_VAZIO: 'Este tenant ainda não tem nenhuma regra de XP cadastrada.',
};

export interface EstadoDoGerar {
  erro?: string;
  snapshot?: SnapshotDto;
}

const esquemaDeGerar = z.object({
  gymUnitId: z.string().uuid(),
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
});

export async function gerarPlacar(
  _anterior: EstadoDoGerar,
  formulario: FormData,
): Promise<EstadoDoGerar> {
  const analisado = esquemaDeGerar.safeParse({
    gymUnitId: formulario.get('gymUnitId'),
    mes: formulario.get('mes'),
  });

  if (!analisado.success) {
    return { erro: 'Escolha a unidade e o mês antes de gerar o placar.' };
  }

  const resposta = await chamarApi<SnapshotDto>(
    `/api/v1/engagement/rankings/${analisado.data.gymUnitId}/${analisado.data.mes}/gerar`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível gerar o placar.') };
  }

  return { snapshot: resposta.dados };
}

export interface EstadoDoPublicar {
  erro?: string;
  snapshot?: SnapshotDto;
}

const esquemaDePublicar = z.object({ snapshotId: z.string().trim().min(1) });

export async function publicarPlacar(
  _anterior: EstadoDoPublicar,
  formulario: FormData,
): Promise<EstadoDoPublicar> {
  const analisado = esquemaDePublicar.safeParse({ snapshotId: formulario.get('snapshotId') });

  if (!analisado.success) {
    return { erro: 'Placar inválido.' };
  }

  const resposta = await chamarApi<SnapshotDto>(
    `/api/v1/engagement/rankings/${analisado.data.snapshotId}/publicar`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: (resposta.erro?.code ? MENSAGEM_DO_PLACAR[resposta.erro.code] : undefined) ?? 'Não foi possível publicar o placar.' };
  }

  revalidatePath('/engagement/placar');

  return { snapshot: resposta.dados };
}

export interface EstadoDoAjuste {
  erro?: string;
  sucesso?: boolean;
}

/**
 * Motivo obrigatorio e nao-vazio JA no boundary do cliente -- a API repete a
 * checagem (`M5-FR-007`), mas duplicar aqui devolve o erro sem round-trip
 * para o caso mais comum de digitacao (campo deixado em branco).
 */
const esquemaDeAjuste = z.object({
  studentId: z.string().uuid(),
  pontos: z.coerce.number().int().refine((valor) => valor !== 0, 'pontos nao pode ser zero'),
  motivo: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
});

export async function ajustarXp(
  _anterior: EstadoDoAjuste,
  formulario: FormData,
): Promise<EstadoDoAjuste> {
  const analisado = esquemaDeAjuste.safeParse({
    studentId: formulario.get('studentId'),
    pontos: formulario.get('pontos'),
    motivo: formulario.get('motivo'),
    idempotencyKey: formulario.get('idempotencyKey'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados do ajuste.' };
  }

  const resposta = await chamarApi<{ ajustado: boolean }>(
    `/api/v1/engagement/xp/${analisado.data.studentId}/ajustar`,
    {
      metodo: 'POST',
      corpo: {
        pontos: analisado.data.pontos,
        motivo: analisado.data.motivo,
        idempotencyKey: analisado.data.idempotencyKey,
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro:
        (resposta.erro?.code ? MENSAGEM_DO_AJUSTE[resposta.erro.code] : undefined) ??
        'Não foi possível registrar o ajuste.',
    };
  }

  return { sucesso: true };
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
