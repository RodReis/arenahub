'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Cadastro de academia pelo dono do SaaS — F61.
 *
 * A validação daqui NÃO substitui a da API: ela existe para quem cadastra ver
 * o erro sem perder o que digitou. A API valida de novo, e é ela que manda —
 * Server Action é superfície pública tanto quanto um endpoint.
 */
const esquemaDeTenant = z.object({
  /*
   * `slug` é identificador público usado em URL (F62 fará login por ele).
   * Minúsculas, números e hífen -- nada que precise de escape.
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'O identificador precisa de ao menos 3 caracteres')
    .max(48, 'Identificador longo demais')
    .regex(/^[a-z0-9-]+$/, 'Use apenas minúsculas, números e hífen no identificador'),
  legalName: z.string().trim().min(1, 'Informe a razão social').max(200, 'Razão social longa demais'),
  displayName: z.string().trim().min(1, 'Informe o nome fantasia').max(120, 'Nome longo demais'),
  /*
   * Máscara ENTRA e sai só dígito: o campo aceita "12.345.678/0001-99" porque
   * é assim que se digita CNPJ, e a API exige os 14 dígitos crus. Mandar o
   * texto mascarado daria `VALIDATION_FAILED` genérico, longe da causa.
   */
  cnpj: z
    .string()
    .trim()
    .transform((valor) => valor.replace(/\D/g, ''))
    .refine((valor) => valor.length === 14, 'CNPJ precisa ter 14 dígitos'),
  /*
   * Mesmo peso que na unidade (ADR-019): o fuso decide vencimento e bloqueio,
   * sem fallback. A lista da tela é fechada; aqui a checagem é de presença.
   */
  timezone: z.string().min(1, 'Selecione o fuso horário'),
  responsavelNome: z.string().trim().min(1, 'Informe o nome do responsável').max(120),
  responsavelEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail do responsável inválido')
    .max(320),
  unidadeCode: z.string().trim().min(1, 'Informe o código da primeira unidade').max(32),
  unidadeName: z.string().trim().min(1, 'Informe o nome da primeira unidade').max(120),
});

/**
 * O que o formulário mandou, campo a campo.
 *
 * NOMEADO e não `Record<string, string>`: com o índice genérico, todo acesso
 * vira `valores?.['slug']` (regra `noPropertyAccessFromIndexSignature`) e um
 * campo com nome errado passaria batido pelo compilador -- exatamente o que a
 * devolução de valores existe para evitar.
 */
export interface ValoresDoTenant {
  slug: string;
  legalName: string;
  displayName: string;
  cnpj: string;
  timezone: string;
  responsavelNome: string;
  responsavelEmail: string;
  unidadeCode: string;
  unidadeName: string;
}

export interface EstadoDoTenant {
  erro?: string;
  sucesso?: { id: string; displayName: string; emailEnviado: boolean };
  /** Devolvidos para o formulário não perder o preenchimento em erro. */
  valores?: ValoresDoTenant;
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  /*
   * A frase de `MENSAGEM_DE_SESSAO` fala de "perfil sem permissão", que aqui
   * seria enganosa: `/platform` recusa QUEM NÃO É dono do SaaS, e não há
   * permissão de tenant que resolva.
   */
  FORBIDDEN: 'Este perfil não administra a plataforma.',
  TENANT_NOT_FOUND: 'Esta academia não existe mais.',
  MOTIVO_OBRIGATORIO: 'Escreva o motivo (ao menos 10 caracteres).',
  /*
   * SLUG REPETIDO CHEGA AQUI COMO `INTERNAL_ERROR`.
   *
   * `POST /platform/tenants` não traduz o P2002 do Prisma, e o filtro de
   * `problem+json` manda todo erro imprevisto para o genérico -- não existe
   * `TENANT_SLUG_TAKEN` na API. A frase não pode AFIRMAR que foi o slug (o
   * mesmo código sai de qualquer falha inesperada), mas sugerir a causa mais
   * provável ao lado do código estável é o que deixa alguém agir. Quando a
   * API ganhar código próprio, esta linha sai e entra o código de verdade.
   */
  INTERNAL_ERROR:
    'Não foi possível criar a academia. Confira se o identificador já está em uso (INTERNAL_ERROR).',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function criarTenant(
  _anterior: EstadoDoTenant,
  formulario: FormData,
): Promise<EstadoDoTenant> {
  const valores = {
    slug: texto(formulario, 'slug'),
    legalName: texto(formulario, 'legalName'),
    displayName: texto(formulario, 'displayName'),
    cnpj: texto(formulario, 'cnpj'),
    timezone: texto(formulario, 'timezone'),
    responsavelNome: texto(formulario, 'responsavelNome'),
    responsavelEmail: texto(formulario, 'responsavelEmail'),
    unidadeCode: texto(formulario, 'unidadeCode'),
    unidadeName: texto(formulario, 'unidadeName'),
  };

  const validado = esquemaDeTenant.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.', valores };
  }

  const dados = validado.data;

  const resposta = await chamarApi<{ id: string; gymUnitId: string; emailEnviado: boolean }>(
    '/api/v1/platform/tenants',
    {
      metodo: 'POST',
      corpo: {
        slug: dados.slug,
        legalName: dados.legalName,
        displayName: dados.displayName,
        cnpj: dados.cnpj,
        timezone: dados.timezone,
        responsavelNome: dados.responsavelNome,
        responsavelEmail: dados.responsavelEmail,
        /*
         * A primeira unidade herda o fuso do tenant: pedir os dois separados
         * na mesma tela seria oferecer uma divergência que ninguém quer no
         * cadastro, e a unidade pode ser corrigida depois em `/units`.
         */
        unidade: {
          code: dados.unidadeCode,
          name: dados.unidadeName,
          timezone: dados.timezone,
        },
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível criar a academia'), valores };
  }

  revalidatePath('/platform');

  return {
    sucesso: {
      id: resposta.dados.id,
      displayName: dados.displayName,
      /*
       * O RESEND RESPONDE ERRO COM HTTP 200, e é por isso que a API devolve
       * este booleano em vez de deixar a falha sumir. Perdê-lo aqui faria a
       * tela afirmar um convite que não saiu, e o dono da academia esperaria
       * um e-mail que nunca chega.
       */
      emailEnviado: resposta.dados.emailEnviado,
    },
  };
}
