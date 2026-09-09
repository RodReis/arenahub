'use server';

import { revalidatePath } from 'next/cache';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Fatura da plataforma — F64, ADR-052.
 *
 * ARQUIVO PRÓPRIO, pela mesma razão de `contratos.ts` ter saído de
 * `platform.ts`: fatura é outro assunto, e um arquivo que cresce por
 * acumulação vira o lugar onde ninguém acha nada.
 */

/**
 * Frases por código de erro estável da API.
 *
 * `PLATFORM_INVOICE_ALREADY_PAID` importa mais do que parece: quem clica duas
 * vezes precisa entender que a segunda NÃO passou, e que o registro que vale é
 * o primeiro — "erro ao registrar" deixaria a dúvida de se a data gravada é a
 * de agora.
 */
const MENSAGEM: Record<string, string> = {
  PLATFORM_INVOICE_NOT_FOUND: 'Fatura não encontrada.',
  PLATFORM_INVOICE_ALREADY_PAID:
    'Esta fatura já constava como paga. O pagamento registrado antes é o que vale.',
  TENANT_CONTRACT_NOT_ACTIVE:
    'Esta academia não tem contrato vigente. Feche um contrato antes de faturar.',
  INDEX_VALUE_MISSING:
    'Falta o valor do índice em alguma competência da janela. Cadastre no histórico e tente de novo.',
  TENANT_NOT_FOUND: 'Academia não encontrada.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export interface EstadoDaFatura {
  erro?: string;
  salvo?: boolean;
}

/**
 * Emite a fatura da competência corrente fora do dia agendado.
 *
 * IDEMPOTENTE do outro lado: a competência já faturada devolve a MESMA fatura,
 * e a tela recarrega mostrando uma linha só. Por isso o botão não precisa se
 * desabilitar depois do primeiro clique — clicar de novo não cobra duas vezes.
 */
export async function emitirFatura(
  _anterior: EstadoDaFatura,
  formulario: FormData,
): Promise<EstadoDaFatura> {
  const tenantId = texto(formulario, 'tenantId');

  const resposta = await chamarApi<{ id: string }>('/api/v1/platform/invoices', {
    metodo: 'POST',
    corpo: { tenantId },
  });

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível emitir a fatura') };
  }

  revalidatePath(`/platform/${tenantId}/faturas`);

  return { salvo: true };
}

/** Registra o pagamento — manual, não há gateway para a plataforma (ADR-052). */
export async function registrarPagamentoDaFatura(
  _anterior: EstadoDaFatura,
  formulario: FormData,
): Promise<EstadoDaFatura> {
  const id = texto(formulario, 'id');
  const tenantId = texto(formulario, 'tenantId');

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/platform/invoices/${encodeURIComponent(id)}/payment`,
    { metodo: 'POST', corpo: {} },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível registrar o pagamento') };
  }

  revalidatePath(`/platform/${tenantId}/faturas`);

  return { salvo: true };
}
