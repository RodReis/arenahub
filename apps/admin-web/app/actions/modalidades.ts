'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Modalidades de uma unidade — F60.
 *
 * A Arena Positiva é um complexo esportivo: academia, quadras de areia, cross
 * fit, box. Modalidade é ROTULO — serve para diferenciar o aluno de quadra do
 * aluno de academia na recepção e no relatório. Quem decide se a catraca abre
 * continua sendo o plano (regra de arquitetura nº 1), e hoje só a academia
 * tem catraca.
 *
 * A validação daqui NÃO substitui a da API: existe para a recepção ver o erro
 * sem perder o que digitou. Server Action é superfície pública tanto quanto
 * um endpoint, e a API valida de novo.
 */
const esquemaDeCriacao = z.object({
  unitId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(2, 'Informe o nome da modalidade')
    .max(80, 'Nome longo demais'),
});

const esquemaDeSituacao = z.object({
  unitId: z.string().uuid(),
  modalityId: z.string().uuid(),
});

export interface EstadoDaModalidade {
  erro?: string;
  sucesso?: { id: string; name: string };
  /** Devolvido para o campo não perder o que foi digitado em erro. */
  valores?: { name?: string };
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira o nome informado.',
  FORBIDDEN: 'Seu perfil não tem permissão para alterar modalidades.',
  UNIT_NOT_FOUND: 'Unidade não encontrada.',
  MODALITY_NOT_FOUND: 'Modalidade não encontrada.',
  /*
   * O nome é único POR UNIDADE. A frase precisa dizer isso: "erro ao salvar"
   * mandaria a recepção adivinhar, e o mesmo nome em OUTRA unidade é
   * legítimo.
   */
  MODALITY_ALREADY_EXISTS: 'Esta unidade já tem uma modalidade com este nome.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function cadastrarModalidade(
  _anterior: EstadoDaModalidade,
  formulario: FormData,
): Promise<EstadoDaModalidade> {
  const valores = { name: texto(formulario, 'name') };

  const validado = esquemaDeCriacao.safeParse({
    unitId: texto(formulario, 'unitId'),
    name: valores.name,
  });

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira o nome informado.',
      valores,
    };
  }

  const resposta = await chamarApi<{ id: string; name: string }>(
    `/api/v1/units/${validado.data.unitId}/modalities`,
    { metodo: 'POST', corpo: { name: validado.data.name } },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível cadastrar a modalidade'),
      valores,
    };
  }

  revalidatePath('/units');

  return { sucesso: { id: resposta.dados.id, name: resposta.dados.name } };
}

/**
 * Inativa ou reativa uma modalidade.
 *
 * NÃO HÁ exclusão, e não deve haver: aluno já vinculado ficaria órfão, e o
 * histórico de quem treinou o que sumiria. Mesma escolha que a própria
 * unidade faz.
 *
 * Diferente da unidade, aqui NÃO se exige motivo: inativar uma modalidade
 * tira uma opção da lista de cadastro, não tira ninguém de operação — pedir
 * justificativa só ensinaria a digitar "." no campo.
 */
export async function alternarSituacaoDaModalidade(
  _anterior: EstadoDaModalidade,
  formulario: FormData,
): Promise<EstadoDaModalidade> {
  const validado = esquemaDeSituacao.safeParse({
    unitId: texto(formulario, 'unitId'),
    modalityId: texto(formulario, 'modalityId'),
  });

  if (!validado.success) {
    return { erro: 'Modalidade inválida.' };
  }

  const ativando = texto(formulario, 'situacao') === 'ACTIVE';

  const resposta = await chamarApi<{ id: string; name: string }>(
    `/api/v1/units/${validado.data.unitId}/modalities/${validado.data.modalityId}`,
    { metodo: 'PATCH', corpo: { isActive: ativando } },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(
        resposta.erro?.code ?? '',
        ativando
          ? 'Não foi possível reativar a modalidade'
          : 'Não foi possível inativar a modalidade',
      ),
    };
  }

  revalidatePath('/units');

  return { sucesso: { id: resposta.dados.id, name: resposta.dados.name } };
}
