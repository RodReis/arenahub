'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Cadastro de Edge e geração do código de pareamento (issue #404).
 *
 * `POST /api/v1/edge-nodes/:id/pairing-codes` existia desde a F59 e exigia um
 * `EdgeNode` já cadastrado — mas não havia como cadastrá-lo, nem por API nem
 * pelo painel. A instalação real do edge-agent na Arena Positiva travou
 * exatamente aqui: sem `edgeNodeId`, não há código para parear.
 */
const esquemaDeEdgeNode = z.object({
  gymUnitId: z.string().uuid('Selecione a unidade do Edge'),
  code: z
    .string()
    .trim()
    .min(1, 'Informe o código do Edge')
    .max(80, 'Código longo demais'),
});

export interface EstadoDoEdgeNode {
  erro?: string;
  /**
   * `gymUnitId` vem do SERVIDOR, não do formulário: é o fuso desta unidade
   * que datará a validade do código de pareamento, e ler o do formulário
   * arriscaria mostrar o prazo no fuso de outra unidade (DS §11, regra 5).
   */
  sucesso?: { id: string; code: string; gymUnitId: string };
  valores?: Record<string, string>;
}

export interface EstadoDoPareamento {
  erro?: string;
  /**
   * O código aparece UMA ÚNICA VEZ, nesta resposta — mesmo princípio de
   * segredo do `KIOSK_SECRET` (F50) e da credencial de Edge (ADR-011). Não
   * fica em log, não é recuperável depois: perdeu, gera outro.
   */
  sucesso?: { code: string; expiresAt: string };
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  FORBIDDEN: 'Seu perfil não tem permissão para cadastrar Edge.',
  GYM_UNIT_NOT_FOUND: 'Unidade não encontrada nesta academia.',
  GYM_UNIT_NOT_ACTIVE: 'Esta unidade não está ativa e não recebe Edge novo.',
  EDGE_NODE_CODE_TAKEN: 'Já existe um Edge com este código nesta academia.',
  EDGE_NODE_NOT_FOUND: 'Edge não encontrado nesta academia.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function cadastrarEdgeNode(
  _anterior: EstadoDoEdgeNode,
  formulario: FormData,
): Promise<EstadoDoEdgeNode> {
  const valores = {
    gymUnitId: texto(formulario, 'gymUnitId'),
    code: texto(formulario, 'code'),
  };

  const validado = esquemaDeEdgeNode.safeParse(valores);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const resposta = await chamarApi<{ id: string; code: string; gymUnitId: string }>(
    '/api/v1/edge-nodes',
    {
      metodo: 'POST',
      corpo: { gymUnitId: validado.data.gymUnitId, code: validado.data.code },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível cadastrar o Edge'),
      valores,
    };
  }

  revalidatePath('/operations');

  return {
    sucesso: {
      id: resposta.dados.id,
      code: resposta.dados.code,
      gymUnitId: resposta.dados.gymUnitId,
    },
  };
}

/**
 * Gera o código de pareamento de uso único (ADR-011).
 *
 * Não faz `revalidatePath`: o código vive só na resposta desta ação, e
 * recarregar a tela não deve nem pode trazê-lo de volta.
 */
export async function gerarCodigoDePareamento(
  _anterior: EstadoDoPareamento,
  formulario: FormData,
): Promise<EstadoDoPareamento> {
  const edgeNodeId = texto(formulario, 'edgeNodeId');

  if (edgeNodeId === '') {
    return { erro: 'Edge não informado.' };
  }

  const resposta = await chamarApi<{ code: string; expiresAt: string }>(
    `/api/v1/edge-nodes/${edgeNodeId}/pairing-codes`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível gerar o código') };
  }

  return { sucesso: { code: resposta.dados.code, expiresAt: resposta.dados.expiresAt } };
}
