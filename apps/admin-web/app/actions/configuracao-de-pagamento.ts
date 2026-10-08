'use server';

import { revalidatePath } from 'next/cache';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/** Espelha o corpo de `GET/PUT /api/v1/billing/settings` -- F89. */
export interface ConfiguracaoDePagamento {
  readonly invoiceGenerationDay: number;
  readonly dueDay: number;
  readonly graceDays: number;
}

export interface EstadoDaConfiguracaoDePagamento {
  erro?: string;
  sucesso?: true;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  BILLING_SETTINGS_INVALID:
    'Confira os valores: gerar e vencer de 1 a 28, bloqueio de 1 a 30, e gerar não pode ser depois do vencimento.',
};

const CAMPOS = ['invoiceGenerationDay', 'dueDay', 'graceDays'] as const;

/** `null` se não for string não vazia que vire inteiro. */
function inteiroDe(valor: FormDataEntryValue | null): number | null {
  if (typeof valor !== 'string' || valor.trim() === '') return null;
  const numero = Number(valor);

  return Number.isInteger(numero) ? numero : null;
}

/**
 * Grava a configuração de pagamento do tenant.
 *
 * A checagem aqui só poupa a viagem no erro de digitação (campo vazio, "10.5"):
 * limites e a ordem gerar <= vencer quem decide é a API
 * (`BILLING_SETTINGS_INVALID`). Os três vão como INTEIRO no JSON -- a API
 * recusa string. Não altera parcela já gerada.
 */
export async function salvarConfiguracaoDePagamento(
  _anterior: EstadoDaConfiguracaoDePagamento,
  formulario: FormData,
): Promise<EstadoDaConfiguracaoDePagamento> {
  const [invoiceGenerationDay, dueDay, graceDays] = CAMPOS.map((campo) =>
    inteiroDe(formulario.get(campo)),
  );

  if (invoiceGenerationDay === null || dueDay === null || graceDays === null) {
    return { erro: 'Preencha os três campos com números inteiros.' };
  }

  const resposta = await chamarApi<ConfiguracaoDePagamento>('/api/v1/billing/settings', {
    metodo: 'PUT',
    corpo: { invoiceGenerationDay, dueDay, graceDays },
  });

  if (!resposta.ok) {
    return {
      erro: MENSAGEM[resposta.erro?.code ?? ''] ?? 'Não foi possível salvar a configuração.',
    };
  }

  revalidatePath('/configuracao');

  return { sucesso: true };
}
