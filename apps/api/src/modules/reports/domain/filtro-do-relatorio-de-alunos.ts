import { z } from 'zod';

import {
  ROTULO_DE_PERFIL,
  ROTULO_DE_SITUACAO,
  ROTULO_FINANCEIRO,
} from './formato-brasileiro.js';

/** As sete situações do aluno -- as mesmas de `situacaoDoAluno` em `students.controller.ts`. */
export const SITUACOES_DO_ALUNO = [
  'LEAD',
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
  'BLOCKED',
  'CANCELLED',
  'ARCHIVED',
] as const;

/** Os seis perfis (`StudentProfile`). */
export const PERFIS_DO_ALUNO = [
  'ADMIN',
  'STUDENT',
  'STAFF',
  'TRAINER',
  'PERMUTA_TACIO',
  'PERMUTA_DOUGLAS',
] as const;

export const VALORES_FINANCEIROS = ['INADIMPLENTES', 'PAGANTES'] as const;

export interface FiltroDoRelatorioDeAlunos {
  /** Unidade de ORIGEM do aluno (mesma coluna que o filtro da Lista de Alunos). */
  readonly gymUnitId: string | undefined;
  readonly status: (typeof SITUACOES_DO_ALUNO)[number] | undefined;
  /** Vazio = todos os perfis. */
  readonly profile: (typeof PERFIS_DO_ALUNO)[number] | undefined;
  /** Plano da assinatura vigente. */
  readonly planId: string | undefined;
  readonly financeiro: (typeof VALORES_FINANCEIROS)[number] | undefined;
}

/** Uma linha do relatório, já sem nada que a tela ou o arquivo não mostrem. */
export interface LinhaDoRelatorioDeAlunos {
  readonly studentId: string;
  /** Números do leitor; vazio antes da primeira credencial. */
  readonly deviceIds: readonly string[];
  readonly fullName: string;
  /** Em claro, como está no cadastro (ADR-034). */
  readonly cpf: string | null;
  readonly phone: string | null;
  /** Nome do plano ou origem do vínculo; `null` = nada a mostrar. */
  readonly planLabel: string | null;
}

/**
 * Lê UM valor ou devolve `undefined`.
 *
 * Valor inválido vira "sem filtro" e não 400 -- mesma regra de
 * `GET /students`: o parâmetro vem da URL, que a recepção edita, o colega
 * manda por chat e o navegador restaura de sessão antiga. Trocar a tela
 * inteira por erro por causa de um `?status=ATIVO` datilografado seria pior
 * que mostrar a lista completa.
 */
function ler<T>(esquema: z.ZodType<T>, bruto: unknown): T | undefined {
  const resultado = esquema.safeParse(bruto);

  return resultado.success ? resultado.data : undefined;
}

export function lerFiltro(entrada: Record<string, unknown>): FiltroDoRelatorioDeAlunos {
  return {
    gymUnitId: ler(z.string().uuid(), entrada['gymUnitId']),
    status: ler(z.enum(SITUACOES_DO_ALUNO), entrada['status']),
    profile: ler(z.enum(PERFIS_DO_ALUNO), entrada['profile']),
    planId: ler(z.string().uuid(), entrada['planId']),
    financeiro: ler(z.enum(VALORES_FINANCEIROS), entrada['financeiro']),
  };
}

export interface NomesDoFiltro {
  readonly unidade: string | undefined;
  readonly plano: string | undefined;
}

/** As linhas "Filtros:" do cabeçalho do arquivo, em pt-BR. */
export function descreverFiltro(filtro: FiltroDoRelatorioDeAlunos, nomes: NomesDoFiltro): string[] {
  const linhas: string[] = [];

  if (filtro.gymUnitId !== undefined) linhas.push(`Unidade: ${nomes.unidade ?? 'não encontrada'}`);
  if (filtro.status !== undefined) linhas.push(`Situação: ${ROTULO_DE_SITUACAO[filtro.status] ?? filtro.status}`);
  if (filtro.profile !== undefined) linhas.push(`Perfil: ${ROTULO_DE_PERFIL[filtro.profile] ?? filtro.profile}`);
  if (filtro.planId !== undefined) linhas.push(`Plano: ${nomes.plano ?? 'não encontrado'}`);
  if (filtro.financeiro !== undefined) {
    linhas.push(`Financeiro: ${ROTULO_FINANCEIRO[filtro.financeiro] ?? filtro.financeiro}`);
  }

  return linhas;
}
