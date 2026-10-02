'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';
import { MENSAGEM_PADRAO } from '../(protected)/app/mensagem';

export interface EstadoDoInstalador {
  erro?: string;
  valores?: Record<string, string>;
  sucesso?: 'salvo' | 'removido';
}

const esquema = z.object({
  androidUrl: z.string().trim().min(1, 'Informe o link do instalador.'),
  androidVersion: z.string().trim().max(40, 'A versão aceita até 40 caracteres.'),
  shortSlug: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/,
      'O final do link aceita de 3 a 40 letras minúsculas, números e hífen (sem hífen nas pontas).',
    ),
  messageTemplate: z.string().max(1000, 'A mensagem aceita até 1000 caracteres.'),
});

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  APP_DISTRIBUTION_URL_INVALID: 'O link precisa começar com https://.',
  APP_LINK_SLUG_TAKEN: 'Esse final de link já é usado por outra academia. Escolha outro.',
  FORBIDDEN: 'Você não tem permissão para alterar o instalador.',
};

/** `FormData.get` devolve `File` ou `null` tambem: so texto interessa aqui. */
function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function mensagemDeErro(codigo: string, acao: string): string {
  return MENSAGEM[codigo] ?? `Não foi possível ${acao} (${codigo || 'erro'}).`;
}

export async function salvarInstaladorAndroid(
  _anterior: EstadoDoInstalador,
  formulario: FormData,
): Promise<EstadoDoInstalador> {
  const valores = {
    androidUrl: texto(formulario, 'androidUrl'),
    androidVersion: texto(formulario, 'androidVersion'),
    shortSlug: texto(formulario, 'shortSlug'),
    messageTemplate: texto(formulario, 'messageTemplate'),
  };
  const validado = esquema.safeParse(valores);
  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados.', valores };
  }

  const resposta = await chamarApi('/api/v1/app-distribution', {
    metodo: 'PUT',
    corpo: {
      androidUrl: validado.data.androidUrl,
      androidVersion: validado.data.androidVersion || null,
      shortSlug: validado.data.shortSlug,
      // Vazio ou identico ao padrao grava NULO: quem nunca personalizou
      // recebe as melhorias futuras do texto padrao sem fazer nada.
      messageTemplate:
        validado.data.messageTemplate.trim() && validado.data.messageTemplate !== MENSAGEM_PADRAO
          ? validado.data.messageTemplate
          : null,
    },
  });

  if (!resposta.ok) {
    return { erro: mensagemDeErro(resposta.erro?.code ?? '', 'salvar'), valores };
  }

  revalidatePath('/app');

  return { sucesso: 'salvo' };
}

export async function removerInstaladorAndroid(
  _anterior: EstadoDoInstalador,
  _formulario: FormData,
): Promise<EstadoDoInstalador> {
  const resposta = await chamarApi('/api/v1/app-distribution', { metodo: 'DELETE' });

  if (!resposta.ok) {
    return { erro: mensagemDeErro(resposta.erro?.code ?? '', 'remover') };
  }

  revalidatePath('/app');

  return { sucesso: 'removido' };
}
