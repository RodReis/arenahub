'use server';

import { revalidatePath } from 'next/cache';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Adesão e cancelamento da cobrança recorrente — F56, `SPEC-056` §2.2 e §2.4.
 *
 * Arquivo próprio e não dentro de `membership.ts`: recorrência é combinado de
 * COBRANÇA, e assinatura é direito de ACESSO. Confundir os dois é o erro que
 * o `CancelarRecorrenciaUseCase` documenta em maiúsculas do lado da API —
 * cancelar a recorrência não tira o acesso de quem já pagou.
 */

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  SUBSCRIPTION_NOT_FOUND: 'Assinatura não encontrada nesta academia.',
  PLAN_NOT_SUBSCRIPTION:
    'Este plano é avulso. A cobrança automática exige um plano na modalidade assinatura.',
  SUBSCRIPTION_NOT_ADHERABLE: 'Esta assinatura não está ativa e não aceita adesão.',
  RECURRENCE_ALREADY_ACTIVE: 'Este aluno já tem cobrança recorrente ativa.',
  PLAN_WITHOUT_ACTIVE_PRICE: 'O plano está sem preço vigente. Defina o preço antes de aderir.',
  /*
   * A frase diz O QUE FAZER, não só que deu errado (ADR-043, Decisão 3): o
   * antifraude do provedor recusa cartão sem CPF, e "transação negada" mandaria
   * a recepção procurar problema no cartão, que está bom.
   */
  STUDENT_CPF_REQUIRED:
    'O aluno está sem CPF. Complete o cadastro antes de aderir — o antifraude do provedor recusa cartão sem CPF.',
  PAYMENT_METHOD_MISSING: 'O aluno não tem cartão ativo. Cadastre um cartão antes de aderir.',
  RECURRENCE_CONSENT_REQUIRED: 'É preciso o aceite do aluno para ativar a cobrança recorrente.',
  BILLING_SETTINGS_MISSING:
    'A academia está sem configuração financeira. Defina o dia de vencimento antes de aderir.',
  PROVIDER_ACCOUNT_MISSING: 'Não há conta de cartão configurada para esta academia.',
  FORBIDDEN: 'Seu perfil não tem permissão para alterar a cobrança recorrente.',
};

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export interface EstadoDaRecorrencia {
  erro?: string;
  sucesso?: {
    /** Quanto será cobrado por ciclo, em centavos. */
    amountMinor?: number;
    currency?: string;
    dueDay?: number;
    mensagem: string;
  };
}

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

/**
 * Ativa a cobrança recorrente do aluno.
 *
 * O ACEITE VEM DA TELA e é obrigatório. A API recusa `aceitouRecorrencia`
 * ausente ou falso, então a garantia não depende deste arquivo — mas barrar
 * aqui dá a frase certa em vez de um erro de validação sem contexto.
 */
export async function aderirARecorrencia(
  _anterior: EstadoDaRecorrencia,
  formulario: FormData,
): Promise<EstadoDaRecorrencia> {
  const subscriptionId = texto(formulario, 'subscriptionId');

  if (subscriptionId === '') {
    return { erro: 'Não foi possível identificar a assinatura. Recarregue a ficha.' };
  }

  if (texto(formulario, 'aceitouRecorrencia') !== 'on') {
    return { erro: MENSAGEM['RECURRENCE_CONSENT_REQUIRED'] ?? 'É preciso o aceite do aluno.' };
  }

  const resposta = await chamarApi<{
    subscriptionId: string;
    amountMinor: number;
    currency: string;
    dueDay: number;
  }>(`/api/v1/subscriptions/${subscriptionId}/recurrence`, {
    metodo: 'POST',
    corpo: { aceitouRecorrencia: true },
  });

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível ativar a cobrança recorrente'),
    };
  }

  revalidatePath('/students');

  return {
    sucesso: {
      amountMinor: resposta.dados.amountMinor,
      currency: resposta.dados.currency,
      dueDay: resposta.dados.dueDay,
      mensagem: 'Cobrança recorrente ativada.',
    },
  };
}

/**
 * Encerra a cobrança recorrente.
 *
 * NÃO CANCELA A ASSINATURA: o aluno que pagou até o dia 30 continua entrando
 * até o dia 30. Quem decide acesso é o entitlement (regra de arquitetura nº 1),
 * e nem esta ação nem a rota que ela chama o tocam.
 */
export async function cancelarRecorrencia(
  _anterior: EstadoDaRecorrencia,
  formulario: FormData,
): Promise<EstadoDaRecorrencia> {
  const subscriptionId = texto(formulario, 'subscriptionId');

  if (subscriptionId === '') {
    return { erro: 'Não foi possível identificar a assinatura. Recarregue a ficha.' };
  }

  const resposta = await chamarApi<{ subscriptionId: string; canceladasNoProvedor: number }>(
    `/api/v1/subscriptions/${subscriptionId}/recurrence/cancel`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível encerrar a cobrança recorrente'),
    };
  }

  revalidatePath('/students');

  /*
   * ZERO NÃO É ERRO: não havia recorrência instalada (o aluno nunca aderiu, ou
   * o provedor já a encerrou). Dizer "encerrada" nos dois casos seria mentir;
   * dizer "falhou" faria a recepção tentar de novo para sempre.
   */
  return {
    sucesso: {
      mensagem:
        resposta.dados.canceladasNoProvedor > 0
          ? 'Cobrança recorrente encerrada. O acesso vale até o fim do período pago.'
          : 'Não havia cobrança recorrente ativa para este aluno.',
    },
  };
}
