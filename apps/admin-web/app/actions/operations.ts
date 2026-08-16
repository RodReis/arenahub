'use server';

import { revalidatePath } from 'next/cache';

import { chamarApi } from '../../lib/api/server-client';

export interface EstadoDoReconhecimento {
  erro?: string;
}

/**
 * Reconhece um alerta — "estou vendo, estou indo".
 *
 * NÃO RESOLVE. A condição continua sendo avaliada pelo servidor a cada 30 s;
 * se o Edge ainda estiver fora, o alerta continua no painel, agora marcado
 * como reconhecido. É o que impede o painel de virar uma lista do que alguém
 * clicou em vez do que está acontecendo.
 */
export async function reconhecerAlerta(
  _anterior: EstadoDoReconhecimento,
  formulario: FormData,
): Promise<EstadoDoReconhecimento> {
  const bruto = formulario.get('alertaId');
  const alertaId = typeof bruto === 'string' ? bruto : '';

  if (alertaId === '') return { erro: 'Alerta não identificado.' };

  const resposta = await chamarApi(`/api/v1/operations/alerts/${alertaId}/acknowledge`, {
    metodo: 'POST',
    corpo: {},
  });

  if (!resposta.ok) {
    const codigo = resposta.erro?.code ?? '';

    return {
      erro:
        codigo === 'OPERATIONAL_ALERT_NOT_FOUND'
          ? 'Este alerta não existe mais.'
          : 'Não foi possível reconhecer o alerta.',
    };
  }

  // Recarrega o painel: sem isto, a linha continuaria mostrando "Aberto" e o
  // operador clicaria de novo achando que não funcionou.
  revalidatePath('/operations');

  return {};
}
