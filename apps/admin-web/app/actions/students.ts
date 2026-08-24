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
  /**
   * Unidade de origem. Obrigatória desde a F45. Nome, nascimento, CPF e
   * unidade são os obrigatórios; todo o resto do formulário é opcional.
   */
  gymUnitId: z.string().uuid('Selecione a unidade do aluno'),
  // Obrigatório desde o ADR-043 Decisão 3 (23/08), que REVERTE a decisão do
  // PI de 18/08 ("CPF continua opcional"). O antifraude do checkout de
  // cartão bloqueia cobrança sem CPF no `customer`; exigi-lo no cadastro
  // evita pedir o documento dentro do fluxo de pagamento. A matrícula
  // continua sem depender do CPF (INV-009/011) -- obrigatório na ENTRADA,
  // nunca virou identificador.
  cpf: z.string().trim().min(1, 'Informe o CPF do aluno'),
  rg: z.string().trim().max(40, 'RG longo demais').optional(),
  registeredSex: z.enum(['FEMALE', 'MALE', 'NOT_INFORMED']).optional(),
  leadSource: z
    .enum(['INDICACAO', 'REDES_SOCIAIS', 'PASSAGEM_NA_PORTA', 'CAMPANHA', 'SITE', 'OUTRO'])
    .optional(),
  advisorUserId: z.string().uuid().optional(),
  status: z.enum(['LEAD', 'TRIAL', 'ACTIVE']).optional(),
  telefone: z.string().trim().max(160).optional(),
  whatsapp: z.string().trim().max(160).optional(),
  email: z.string().trim().max(160).optional(),
  // Endereço: ou vem inteiro o suficiente, ou não vem. Ver `montarEndereco`.
  cep: z.string().trim().optional(),
  logradouro: z.string().trim().max(200).optional(),
  numero: z.string().trim().max(20).optional(),
  complemento: z.string().trim().max(120).optional(),
  bairro: z.string().trim().max(120).optional(),
  cidade: z.string().trim().max(120).optional(),
  uf: z.string().trim().optional(),
  emergenciaNome: z.string().trim().max(160).optional(),
  emergenciaParentesco: z.string().trim().max(80).optional(),
  emergenciaTelefone: z.string().trim().max(160).optional(),
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
  /**
   * Devolvidos para o formulário não perder o preenchimento em erro.
   *
   * Com vinte e dois campos em quatro passos, perder o rascunho não é
   * inconveniência: é a recepção digitando tudo de novo com o aluno de pé na
   * frente dela. `Record` genérico porque o wizard devolve o rascunho
   * inteiro, e enumerar campo a campo aqui só criaria um segundo lugar para
   * esquecer de atualizar.
   */
  valores?: Record<string, string>;
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

/**
 * Campos que o wizard envia. Uma lista só, e não um `for` sobre o FormData:
 * ler o FormData inteiro deixaria passar qualquer campo injetado no HTML
 * para dentro do corpo da requisição.
 */
const CAMPOS_DO_CADASTRO = [
  'fullName',
  'birthDate',
  'gymUnitId',
  'cpf',
  'rg',
  'registeredSex',
  'leadSource',
  'advisorUserId',
  'status',
  'telefone',
  'whatsapp',
  'email',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
  'emergenciaNome',
  'emergenciaParentesco',
  'emergenciaTelefone',
] as const;

type DadosDoCadastro = z.infer<typeof esquemaDeCadastro>;

interface ContatoDaApi {
  type: 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'EMERGENCY';
  value: string;
  isPrimary: boolean;
  label?: string;
  relationship?: string;
}

/**
 * Contatos do aluno, na ordem em que a recepção os informou.
 *
 * O primeiro telefone é o primário. O contato de EMERGÊNCIA é de OUTRA
 * pessoa e por isso nunca é primário: marcá-lo faria a academia ligar para a
 * mãe do aluno achando que ligava para ele.
 */
function montarContatos(dados: DadosDoCadastro): ContatoDaApi[] {
  const contatos: ContatoDaApi[] = [];

  if (dados.telefone) {
    contatos.push({ type: 'PHONE', value: dados.telefone, isPrimary: true });
  }

  if (dados.whatsapp) {
    contatos.push({ type: 'WHATSAPP', value: dados.whatsapp, isPrimary: false });
  }

  if (dados.email) {
    contatos.push({ type: 'EMAIL', value: dados.email, isPrimary: false });
  }

  if (dados.emergenciaTelefone) {
    contatos.push({
      type: 'EMERGENCY',
      value: dados.emergenciaTelefone,
      isPrimary: false,
      ...(dados.emergenciaNome ? { label: dados.emergenciaNome } : {}),
      ...(dados.emergenciaParentesco ? { relationship: dados.emergenciaParentesco } : {}),
    });
  }

  return contatos;
}

/**
 * Endereço, ou `undefined` quando ele não foi informado.
 *
 * A API exige CEP, logradouro, cidade e UF juntos — endereço pela metade não
 * localiza ninguém. Mandar os quatro só quando os quatro existem evita o 400
 * que diria "CEP inválido" para quem simplesmente não preencheu endereço
 * nenhum.
 */
function montarEndereco(dados: DadosDoCadastro):
  | {
      postalCode: string;
      street: string;
      city: string;
      state: string;
      number?: string;
      complement?: string;
      district?: string;
    }
  | undefined {
  if (!dados.cep || !dados.logradouro || !dados.cidade || !dados.uf) return undefined;

  return {
    postalCode: dados.cep,
    street: dados.logradouro,
    city: dados.cidade,
    state: dados.uf,
    ...(dados.numero ? { number: dados.numero } : {}),
    ...(dados.complemento ? { complement: dados.complemento } : {}),
    ...(dados.bairro ? { district: dados.bairro } : {}),
  };
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
  const bruto: Record<string, string> = {};

  for (const campo of CAMPOS_DO_CADASTRO) {
    bruto[campo] = texto(formulario, campo);
  }

  const valores = { ...bruto };

  // Campo vazio é campo NÃO INFORMADO, não string vazia: `""` chegaria à API
  // como `rg: ""` e seria gravado como RG em branco em vez de ausente.
  const preenchidos = Object.fromEntries(
    Object.entries(bruto).filter(([, valor]) => valor !== ''),
  );

  const validado = esquemaDeCadastro.safeParse(preenchidos);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const dados = validado.data;

  // O schema da API é `.strict()`: campo extra vira 400. Por isso o corpo é
  // montado por omissão condicional, nunca por spread do formulário inteiro.
  const resposta = await chamarApi<AlunoCriado>('/api/v1/students', {
    metodo: 'POST',
    corpo: {
      fullName: dados.fullName,
      birthDate: dados.birthDate,
      gymUnitId: dados.gymUnitId,
      cpf: dados.cpf,
      ...(dados.rg ? { rg: dados.rg } : {}),
      ...(dados.registeredSex ? { registeredSex: dados.registeredSex } : {}),
      ...(dados.leadSource ? { leadSource: dados.leadSource } : {}),
      ...(dados.advisorUserId ? { advisorUserId: dados.advisorUserId } : {}),
      ...(dados.status ? { status: dados.status } : {}),
      contacts: montarContatos(dados),
      ...(montarEndereco(dados) ? { address: montarEndereco(dados) } : {}),
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

/**
 * Liberação financeira em um clique — issue #118, botão na grade de Alunos.
 *
 * NÃO é o override da F9 (`liberarAcessoManual`): aquele abre a catraca
 * fisicamente, exige unidade, dispositivo e motivo de 10+ caracteres. Este é
 * `billing/financial-overrides` (Slice 2.4) — libera por PRAZO, prazo padrão
 * de 3 dias já decidido pelo PI (`DIAS_PADRAO_DE_LIBERACAO`), sem tocar
 * entitlement nem invoice. Regra de arquitetura nº 1 continua valendo.
 *
 * O motivo é fixo: a grade de Alunos não sabe qual invoice está em atraso
 * (isso é cálculo de `billing/delinquency`), então não há dado real para
 * compor um motivo mais específico sem uma segunda chamada.
 */
const esquemaDeLiberacaoFinanceira = z.object({
  studentId: z.string().uuid(),
});

const MOTIVO_DA_LIBERACAO_RAPIDA =
  'Liberação rápida pela recepção — tolerância de pagamento';

export interface EstadoDaLiberacaoFinanceira {
  erro?: string;
  sucesso?: { studentId: string; expiresAt: string };
}

const MENSAGEM_DA_LIBERACAO: Record<string, string> = {
  STUDENT_NOT_FOUND: 'Aluno não encontrado nesta academia.',
  FORBIDDEN: 'Seu perfil não tem permissão para liberar financeiramente.',
};

export async function liberarFinanceiramente(
  _anterior: EstadoDaLiberacaoFinanceira,
  formulario: FormData,
): Promise<EstadoDaLiberacaoFinanceira> {
  const validado = esquemaDeLiberacaoFinanceira.safeParse({
    studentId: texto(formulario, 'studentId'),
  });

  if (!validado.success) {
    return { erro: 'Aluno inválido.' };
  }

  const resposta = await chamarApi<{ id: string; studentId: string; expiresAt: string }>(
    '/api/v1/billing/financial-overrides',
    {
      metodo: 'POST',
      corpo: {
        studentId: validado.data.studentId,
        reason: MOTIVO_DA_LIBERACAO_RAPIDA,
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: MENSAGEM_DA_LIBERACAO[resposta.erro?.code ?? ''] ?? 'Não foi possível liberar o aluno.',
    };
  }

  revalidatePath('/students');

  return {
    sucesso: { studentId: resposta.dados.studentId, expiresAt: resposta.dados.expiresAt },
  };
}
