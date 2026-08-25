'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { janelaFechada } from '../../src/billing/conciliacao';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Conciliação e estorno — F16, Slice 2.5.
 *
 * O ACEITE DA FATIA É LITERAL: "operador resolve divergência sem editar banco
 * e sem duplicar efeito financeiro". Por isso a tela oferece exatamente os dois
 * comandos que a API aceita — nenhum campo livre, nenhuma edição de valor.
 * Um formulário que deixasse corrigir o número seria o `UPDATE` manual de
 * volta, só que com botão.
 */

const esquemaDeResolucao = z.object({
  itemId: z.string().uuid(),
  comando: z.enum(['REPROCESS_PROVIDER_EVENT', 'ACCEPT_DOCUMENTED_DIFFERENCE']),
  reason: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo — a auditoria depende disso')
    .max(300, 'Motivo longo demais'),
});

const esquemaDeConciliacao = z.object({
  providerAccountId: z.string().uuid('Selecione a conta do provedor'),
  de: z.string().min(1, 'Informe o início do período'),
  ate: z.string().min(1, 'Informe o fim do período'),
});

export interface EstadoDaResolucao {
  erro?: string;
  sucesso?: { itemId: string; eventoAplicado: boolean | null };
}

export interface EstadoDaConciliacao {
  erro?: string;
  sucesso?: { runId: string; itensEmAberto: number; jaExistia: boolean };
}

/**
 * Mensagens por código estável, nunca a mensagem crua do servidor.
 *
 * Quem concilia precisa saber O QUE FAZER — não qual invariante quebrou.
 */
const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  RECONCILIATION_ITEM_NOT_FOUND: 'Esta divergência não existe mais nesta academia.',
  RECONCILIATION_ITEM_ALREADY_RESOLVED:
    'Outra pessoa já resolveu esta divergência. Recarregue a fila para ver o desfecho.',
  RECONCILIATION_COMMAND_NOT_APPLICABLE:
    'Esta ação não se aplica a este tipo de divergência. Use a ação recomendada na linha.',
  PROVIDER_EVENT_NOT_FOUND:
    'Não há evento do provedor guardado para reprocessar. Consulte o status do pagamento antes de decidir.',
  RECONCILIATION_INVALID_WINDOW:
    'O período precisa estar fechado. Conciliar um intervalo em curso acusa divergência que ainda vai se resolver sozinha.',
  PROVIDER_ACCOUNT_NOT_FOUND: 'Conta do provedor não encontrada nesta academia.',
  PROVIDER_UNAVAILABLE:
    'O provedor não respondeu. A execução foi marcada como falha e pode ser repetida.',
  FORBIDDEN: 'Seu perfil não tem permissão para esta ação.',
};

function mensagemDe(code: string | undefined, padrao: string): string {
  return (code ? MENSAGEM[code] : undefined) ?? padrao;
}

export async function resolverDivergencia(
  _anterior: EstadoDaResolucao,
  formulario: FormData,
): Promise<EstadoDaResolucao> {
  const analisado = esquemaDeResolucao.safeParse({
    itemId: formulario.get('itemId'),
    comando: formulario.get('comando'),
    reason: formulario.get('reason'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ itemId: string; eventoAplicado: boolean | null }>(
    `/api/v1/reconciliation/items/${analisado.data.itemId}/resolve`,
    {
      metodo: 'POST',
      corpo: { comando: analisado.data.comando, reason: analisado.data.reason },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível resolver a divergência.') };
  }

  revalidatePath('/billing/reconciliation');

  return {
    sucesso: {
      itemId: resposta.dados.itemId,
      eventoAplicado: resposta.dados.eventoAplicado,
    },
  };
}

export async function conciliarPeriodo(
  _anterior: EstadoDaConciliacao,
  formulario: FormData,
): Promise<EstadoDaConciliacao> {
  const analisado = esquemaDeConciliacao.safeParse({
    providerAccountId: formulario.get('providerAccountId'),
    de: formulario.get('de'),
    ate: formulario.get('ate'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  // A conta do fim exclusivo mora em `src/billing/conciliacao.ts`, testada em
  // separado: regra de data precisa de teste, e testar Server Action
  // carregaria o Next inteiro para exercitar uma soma de dias.
  const { de, ate } = janelaFechada(analisado.data.de, analisado.data.ate);

  const resposta = await chamarApi<{
    runId: string;
    itensEmAberto: number;
    jaExistia: boolean;
  }>('/api/v1/reconciliation/runs', {
    metodo: 'POST',
    corpo: {
      providerAccountId: analisado.data.providerAccountId,
      de: de.toISOString(),
      ate: ate.toISOString(),
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível conciliar o período.') };
  }

  revalidatePath('/billing/reconciliation');

  return {
    sucesso: {
      runId: resposta.dados.runId,
      itensEmAberto: resposta.dados.itensEmAberto,
      jaExistia: resposta.dados.jaExistia,
    },
  };
}
