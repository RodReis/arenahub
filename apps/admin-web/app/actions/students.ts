'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Cadastro e ciclo de vida do aluno — F7, Slice 1.2.
 *
 * A validação daqui NÃO substitui a da API: ela existe para a recepção ver o
 * erro sem perder o que digitou. A API valida de novo, e é ela que manda —
 * Server Action é superfície pública tanto quanto um endpoint.
 *
 * Ela também cobre um buraco do contrato: erro de validação da API responde
 * `VALIDATION_FAILED` sem dizer qual campo falhou. Sem o espelho aqui, a
 * recepção veria "confira os dados" e teria que adivinhar onde.
 */
const esquemaDeCadastro = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Informe o nome completo do aluno')
    .max(160, 'Nome longo demais'),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de nascimento'),
  // CPF é opcional por decisão de produto: a matrícula não depende dele
  // (INV-009/011), e exigi-lo na recepção travaria o cadastro de menor de
  // idade e de quem esqueceu o documento.
  cpf: z.string().trim().optional(),
  contatoTipo: z.enum(['EMAIL', 'PHONE', 'WHATSAPP']),
  contatoValor: z.string().trim().max(160, 'Contato longo demais').optional(),
});

const esquemaDeSituacao = z.object({
  status: z.enum([
    'LEAD',
    'TRIAL',
    'ACTIVE',
    'SUSPENDED',
    'BLOCKED',
    'CANCELLED',
    'ARCHIVED',
  ]),
  version: z.coerce.number().int().min(0),
});

export interface EstadoDoCadastro {
  erro?: string;
  sucesso?: {
    studentId: string;
    membershipNumber: string;
    /** Cadastros parecidos: a API avisa, não bloqueia (INV-014). */
    duplicatas: { studentId: string; membershipNumber: string; fullName: string; motivo: string }[];
  };
  /** Devolvidos para o formulário não perder o preenchimento em erro. */
  valores?: {
    fullName?: string;
    birthDate?: string;
    cpf?: string;
    contatoTipo?: string;
    contatoValor?: string;
  };
}

export interface EstadoDaSituacao {
  erro?: string;
  sucesso?: {
    status: string;
    /**
     * Versão devolvida pela API depois da alteração.
     *
     * Sem ela, o formulário continuaria montado com a versão que veio na
     * carga da página, e a SEGUNDA alteração seguida — mesmo operador, mesma
     * sessão, nenhuma disputa real — falharia com `STUDENT_VERSION_CONFLICT`
     * dizendo "alguém alterou este aluno enquanto você editava". O controle
     * otimista existe para pegar conflito de verdade, não para punir quem
     * corrige duas vezes.
     */
    version: number;
  };
}

/**
 * Códigos da API traduzidos.
 *
 * O código é estável e serve à correlação; a frase é de interface. Sem a
 * tradução, a recepção veria `STUDENT_INVALID_TRANSITION` e abriria chamado
 * para descobrir o que fazer.
 */
const MENSAGEM: Record<string, string> = {
  VALIDATION_FAILED: 'Confira os dados informados.',
  STUDENT_NOT_FOUND: 'Aluno não encontrado nesta academia.',
  STUDENT_INVALID_TRANSITION:
    'Esta mudança de situação não é permitida a partir da situação atual.',
  // A API responde 404 neste caso, não 409 — por isso a tradução é por
  // CÓDIGO, nunca por status HTTP.
  STUDENT_VERSION_CONFLICT:
    'Alguém alterou este aluno enquanto você editava. Recarregue a ficha e tente de novo.',
  FORBIDDEN: 'Seu perfil não tem permissão para esta ação.',
};

/**
 * Lê um campo de texto do formulário.
 *
 * `FormData.get` devolve `File` quando o campo é um upload, e `String(file)`
 * viraria `[object Object]` — um "nome" que passa na validação de tamanho e
 * não identifica ninguém.
 */
function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

interface AlunoCriado {
  id: string;
  membershipNumber: string;
  duplicateCandidates: {
    studentId: string;
    membershipNumber: string;
    fullName: string;
    motivo: string;
  }[];
}

export async function cadastrarAluno(
  _anterior: EstadoDoCadastro,
  formulario: FormData,
): Promise<EstadoDoCadastro> {
  const bruto = {
    fullName: texto(formulario, 'fullName'),
    birthDate: texto(formulario, 'birthDate'),
    cpf: texto(formulario, 'cpf'),
    contatoTipo: texto(formulario, 'contatoTipo') || 'PHONE',
    contatoValor: texto(formulario, 'contatoValor'),
  };

  const valores = { ...bruto };

  const validado = esquemaDeCadastro.safeParse(bruto);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  // O schema da API é `.strict()`: campo extra vira 400. Por isso o corpo é
  // montado por omissão condicional, nunca por spread do formulário inteiro.
  const contatos =
    bruto.contatoValor !== ''
      ? [{ type: bruto.contatoTipo, value: bruto.contatoValor, isPrimary: true }]
      : [];

  const resposta = await chamarApi<AlunoCriado>('/api/v1/students', {
    metodo: 'POST',
    corpo: {
      fullName: validado.data.fullName,
      birthDate: validado.data.birthDate,
      ...(bruto.cpf !== '' ? { cpf: bruto.cpf } : {}),
      contacts: contatos,
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(resposta.erro?.code ?? '', 'Não foi possível cadastrar o aluno'),
      valores,
    };
  }

  // A lista volta com o aluno novo; sem revalidar, a recepção cadastraria e
  // não veria o resultado.
  revalidatePath('/students');

  return {
    sucesso: {
      studentId: resposta.dados.id,
      membershipNumber: resposta.dados.membershipNumber,
      duplicatas: resposta.dados.duplicateCandidates ?? [],
    },
  };
}

export async function alterarSituacao(
  _anterior: EstadoDaSituacao,
  formulario: FormData,
): Promise<EstadoDaSituacao> {
  const studentId = texto(formulario, 'studentId');

  const validado = esquemaDeSituacao.safeParse({
    status: texto(formulario, 'status'),
    version: texto(formulario, 'version'),
  });

  if (!validado.success) {
    return { erro: 'Selecione uma situação válida.' };
  }

  const resposta = await chamarApi<{ status: string; version: number }>(
    `/api/v1/students/${studentId}/status`,
    {
      metodo: 'PATCH',
      corpo: { status: validado.data.status, version: validado.data.version },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível alterar a situação') };
  }

  revalidatePath(`/students/${studentId}`);

  return {
    sucesso: { status: resposta.dados.status, version: resposta.dados.version },
  };
}
