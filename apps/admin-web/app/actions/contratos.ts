'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Plano SaaS, contrato do tenant e histórico do índice — F63, ADR-052 §5–§8.
 *
 * ARQUIVO PRÓPRIO, e não mais actions em `platform.ts`: aquele já passa de 500
 * linhas com tenant, elevação e marca. Um arquivo que cresce por acumulação
 * vira o lugar onde ninguém acha nada.
 */

/**
 * Frases por código de erro estável da API.
 *
 * Cada uma diz o que FAZER, e não só o que deu errado. `INDEX_VALUE_MISSING` é
 * a que mais importa desta fatia: a correção não roda por falta de índice, e
 * quem lê precisa saber que a saída é cadastrar a competência no histórico —
 * "não foi possível corrigir" mandaria a pessoa tentar de novo o mesmo botão.
 */
const MENSAGEM: Record<string, string> = {
  SAAS_PLAN_VALUES_INVALID: 'Os valores não combinam com o modelo do plano.',
  SAAS_PLAN_NOT_FOUND: 'Plano não encontrado.',
  SAAS_PLAN_ARCHIVED: 'Este plano está arquivado e não aceita contrato novo.',
  TENANT_CONTRACT_NOT_FOUND: 'Contrato não encontrado.',
  TENANT_CONTRACT_IMMUTABLE:
    'Contrato ativo não muda. Feche um contrato novo referenciando este.',
  TENANT_CONTRACT_ALREADY_ACTIVE:
    'Esta academia já tem um contrato vigente. Encerre-o antes de ativar outro.',
  INDEX_VALUE_MISSING:
    'Falta o valor do índice em alguma competência da janela. Cadastre no histórico e tente de novo.',
  INDEX_REFERENCE_MONTH_INVALID: 'Informe a competência no formato AAAA-MM.',
  TENANT_NOT_FOUND: 'Academia não encontrada.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

/**
 * `R$ 1.234,56` -> `123456`.
 *
 * A máscara ENTRA e sai só o inteiro em centavos: é assim que se digita
 * dinheiro, e a API exige a menor unidade monetária (regra de arquitetura 6).
 * Mandar o texto mascarado devolveria erro de validação genérico, longe da
 * causa.
 *
 * `Number` sobre a string inteira NÃO serve: `parseFloat('5.00') * 100` dá
 * 499,99…, e arredondar depois é justamente a aritmética de ponto flutuante
 * que a regra 6 existe para evitar. Aqui os centavos são lidos como dígitos.
 */
function paraCentavos(digitado: string): number | null {
  const limpo = digitado.trim().replace(/[R$\s.]/g, '').replace(',', '.');

  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;

  const [inteiros, centavos = ''] = limpo.split('.');

  return Number(inteiros) * 100 + Number(centavos.padEnd(2, '0'));
}

const dinheiro = z
  .string()
  .trim()
  .min(1, 'Informe o valor')
  .transform((valor, ctx) => {
    const minor = paraCentavos(valor);

    if (minor === null) {
      ctx.addIssue({ code: 'custom', message: 'Valor inválido. Use o formato 1.234,56' });

      return z.NEVER;
    }

    return minor;
  });

// --- Planos ----------------------------------------------------------------

export interface EstadoDoPlano {
  erro?: string;
  salvo?: boolean;
  valores?: Record<string, string>;
}

/**
 * A coerência entre modelo e valores fica com a API.
 *
 * Aqui só se valida o que a pessoa consegue corrigir olhando o próprio campo.
 * Duplicar a regra de coerência criaria dois lugares para mudá-la, e o dia em
 * que um mudasse sem o outro a tela recusaria o que a API aceita — ou pior, o
 * contrário.
 */
const esquemaDePlano = z.object({
  name: z.string().trim().min(1, 'Informe o nome do plano').max(120, 'Nome longo demais'),
  model: z.enum(['PER_STUDENT', 'FIXED_MONTHLY']),
  /*
   * `'sim'`/`'nao'` -> booleano. A API quer `boolean`; o `<select>` só sabe
   * mandar texto. Converter aqui e não na tela mantém o formulário sem estado:
   * ele reexibe exatamente o que foi enviado quando a ação recusa.
   */
  mobileEnabled: z.enum(['sim', 'nao']).transform((valor) => valor === 'sim'),
  kioskEnabled: z.enum(['sim', 'nao']).transform((valor) => valor === 'sim'),
});

export async function salvarPlano(
  _anterior: EstadoDoPlano,
  formulario: FormData,
): Promise<EstadoDoPlano> {
  const id = texto(formulario, 'id');
  const model = texto(formulario, 'model');

  const valores = {
    name: texto(formulario, 'name'),
    model,
    activeStudentPrice: texto(formulario, 'activeStudentPrice'),
    inactiveStudentPrice: texto(formulario, 'inactiveStudentPrice'),
    fixedPrice: texto(formulario, 'fixedPrice'),
    mobileEnabled: texto(formulario, 'mobileEnabled'),
    kioskEnabled: texto(formulario, 'kioskEnabled'),
  };

  const validado = esquemaDePlano.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.', valores };
  }

  /*
   * Os campos de dinheiro são lidos conforme o MODELO escolhido.
   *
   * O formulário esconde os que não valem, e campo escondido não pode ser
   * `required` nativo — ele morre calado, com o navegador recusando o envio
   * sem dizer por quê. A validação de presença é aqui.
   */
  let precos: Record<string, number>;

  if (validado.data.model === 'PER_STUDENT') {
    const ativo = dinheiro.safeParse(valores.activeStudentPrice);
    const inativo = dinheiro.safeParse(valores.inactiveStudentPrice);

    if (!ativo.success) {
      return { erro: `Preço do aluno ativo: ${ativo.error.issues[0]?.message}`, valores };
    }

    if (!inativo.success) {
      return { erro: `Preço do aluno inativo: ${inativo.error.issues[0]?.message}`, valores };
    }

    precos = {
      activeStudentPriceMinor: ativo.data,
      inactiveStudentPriceMinor: inativo.data,
    };
  } else {
    const fixo = dinheiro.safeParse(valores.fixedPrice);

    if (!fixo.success) {
      return { erro: `Valor mensal: ${fixo.error.issues[0]?.message}`, valores };
    }

    precos = { fixedPriceMinor: fixo.data };
  }

  const corpo = {
    name: validado.data.name,
    model: validado.data.model,
    mobileEnabled: validado.data.mobileEnabled,
    kioskEnabled: validado.data.kioskEnabled,
    ...precos,
  };

  const resposta = id
    ? await chamarApi<{ id: string }>(`/api/v1/platform/plans/${encodeURIComponent(id)}`, {
        metodo: 'PATCH',
        corpo,
      })
    : await chamarApi<{ id: string }>('/api/v1/platform/plans', { metodo: 'POST', corpo });

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível salvar o plano'), valores };
  }

  revalidatePath('/platform/planos');

  return { salvo: true };
}

export interface EstadoSimplesDaAcao {
  erro?: string;
  salvo?: boolean;
}

export async function arquivarPlano(
  _anterior: EstadoSimplesDaAcao,
  formulario: FormData,
): Promise<EstadoSimplesDaAcao> {
  const id = texto(formulario, 'id');

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/platform/plans/${encodeURIComponent(id)}/archive`,
    { metodo: 'POST', corpo: {} },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível arquivar o plano') };
  }

  revalidatePath('/platform/planos');

  return { salvo: true };
}

// --- Contratos -------------------------------------------------------------

const diaCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD');

const esquemaDeContrato = z.object({
  planId: z.string().uuid('Escolha o plano'),
  baseDate: diaCivil,
  startsAt: diaCivil,
  anniversaryDay: z.coerce.number().int().min(1).max(31),
  anniversaryMonth: z.coerce.number().int().min(1).max(12),
  /*
   * Para em 28 pela mesma razão do vencimento da mensalidade: existir em
   * fevereiro sem regra de exceção.
   */
  issueDay: z.coerce.number().int().min(1, 'Dia de emissão entre 1 e 28').max(28, 'Dia de emissão entre 1 e 28'),
  graceDays: z.coerce.number().int().min(0).max(180),
  indexCode: z.string().trim().min(1).max(24),
  /* `'sim'`/`'nao'` -> booleano, pelo mesmo motivo do formulário de plano. */
  mobileEnabled: z.enum(['sim', 'nao']).transform((valor) => valor === 'sim'),
  kioskEnabled: z.enum(['sim', 'nao']).transform((valor) => valor === 'sim'),
});

export interface EstadoDoContrato {
  erro?: string;
  salvo?: boolean;
  valores?: Record<string, string>;
}

export async function criarContrato(
  _anterior: EstadoDoContrato,
  formulario: FormData,
): Promise<EstadoDoContrato> {
  const tenantId = texto(formulario, 'tenantId');

  const valores = {
    planId: texto(formulario, 'planId'),
    baseDate: texto(formulario, 'baseDate'),
    startsAt: texto(formulario, 'startsAt'),
    anniversaryDay: texto(formulario, 'anniversaryDay'),
    anniversaryMonth: texto(formulario, 'anniversaryMonth'),
    issueDay: texto(formulario, 'issueDay'),
    graceDays: texto(formulario, 'graceDays'),
    indexCode: texto(formulario, 'indexCode'),
    mobileEnabled: texto(formulario, 'mobileEnabled'),
    kioskEnabled: texto(formulario, 'kioskEnabled'),
  };

  const validado = esquemaDeContrato.safeParse(valores);

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.', valores };
  }

  const resposta = await chamarApi<{ id: string }>('/api/v1/platform/contracts', {
    metodo: 'POST',
    corpo: { tenantId, ...validado.data },
  });

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível abrir o contrato'), valores };
  }

  revalidatePath(`/platform/${tenantId}`);
  revalidatePath(`/platform/${tenantId}/contratos`);

  return { salvo: true };
}

export async function ativarContrato(
  _anterior: EstadoSimplesDaAcao,
  formulario: FormData,
): Promise<EstadoSimplesDaAcao> {
  const id = texto(formulario, 'id');
  const tenantId = texto(formulario, 'tenantId');

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/platform/contracts/${encodeURIComponent(id)}/activate`,
    { metodo: 'POST', corpo: {} },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível fechar o contrato') };
  }

  revalidatePath(`/platform/${tenantId}/contratos`);

  return { salvo: true };
}

export async function encerrarContrato(
  _anterior: EstadoSimplesDaAcao,
  formulario: FormData,
): Promise<EstadoSimplesDaAcao> {
  const id = texto(formulario, 'id');
  const tenantId = texto(formulario, 'tenantId');

  const validado = diaCivil.safeParse(texto(formulario, 'encerradoEm'));

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Informe a data de encerramento.' };
  }

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/platform/contracts/${encodeURIComponent(id)}/terminate`,
    { metodo: 'POST', corpo: { encerradoEm: validado.data } },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível encerrar o contrato') };
  }

  revalidatePath(`/platform/${tenantId}/contratos`);

  return { salvo: true };
}

/**
 * Descarta um contrato em rascunho — F68.
 *
 * O RASCUNHO SOME, e é por isso que a tela confirma antes: ele nunca teve PDF
 * nem gerou fatura, mas os valores digitados se perdem, e a API não tem
 * desfazer. Contrato fechado nunca chega aqui — a rota recusa com 409, e a
 * tela sequer oferece a ação.
 */
export async function descartarContrato(
  _anterior: EstadoSimplesDaAcao,
  formulario: FormData,
): Promise<EstadoSimplesDaAcao> {
  const id = texto(formulario, 'id');
  const tenantId = texto(formulario, 'tenantId');

  const motivo = texto(formulario, 'reason');

  if (motivo.trim().length < 10) {
    return { erro: 'Descreva o motivo do descarte em ao menos 10 caracteres.' };
  }

  const resposta = await chamarApi<unknown>(
    `/api/v1/platform/contracts/${encodeURIComponent(id)}`,
    { metodo: 'DELETE', corpo: { reason: motivo } },
  );

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível descartar o rascunho') };
  }

  revalidatePath(`/platform/${tenantId}/contratos`);

  return { salvo: true };
}

// --- Histórico do índice ---------------------------------------------------

export interface EstadoDoIndice {
  erro?: string;
  salvo?: boolean;
}

const esquemaDeIndice = z.object({
  code: z.string().trim().min(1, 'Informe o código do índice').max(24),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Informe a competência no formato AAAA-MM'),
  /*
   * A variação é digitada em PORCENTO (`0,44`) e vai em milésimos de ponto
   * percentual (`440`). Pedir o número interno na tela transformaria a pessoa
   * na conversora — e o IBGE publica em porcento.
   *
   * ACEITA NEGATIVO: deflação existe, e recusá-la impediria cadastrar o mês em
   * que o IPCA fechou abaixo de zero.
   */
  variacao: z
    .string()
    .trim()
    .min(1, 'Informe a variação do mês')
    .transform((valor, ctx) => {
      const limpo = valor.replace('%', '').replace(',', '.').trim();

      if (!/^-?\d+(\.\d{1,3})?$/.test(limpo)) {
        ctx.addIssue({ code: 'custom', message: 'Variação inválida. Use o formato 0,44' });

        return z.NEVER;
      }

      return Math.round(Number(limpo) * 1000);
    }),
});

export async function registrarValorDeIndice(
  _anterior: EstadoDoIndice,
  formulario: FormData,
): Promise<EstadoDoIndice> {
  const validado = esquemaDeIndice.safeParse({
    code: texto(formulario, 'code'),
    competencia: texto(formulario, 'competencia'),
    variacao: texto(formulario, 'variacao'),
  });

  if (!validado.success) {
    return { erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ id: string }>('/api/v1/platform/index-values', {
    metodo: 'POST',
    corpo: {
      code: validado.data.code,
      competencia: validado.data.competencia,
      variationBasisPoints: validado.data.variacao,
    },
  });

  if (!resposta.ok) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível registrar o índice') };
  }

  revalidatePath('/platform/indices');

  return { salvo: true };
}
