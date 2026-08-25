'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { paraCentavos } from '../../src/billing/dinheiro';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Plano, assinatura e direito de acesso — F7, Slice 1.2.
 *
 * Regra que esta fatia materializa (ADR-003): **pagamento não controla acesso,
 * entitlement controla**. Aqui a concessão é manual; o automático chega no
 * MVP 2. Nenhuma tela desta fatia fala em dinheiro — `Plan` não tem campo
 * monetário, e inventar um aqui criaria um contrato que o servidor não honra.
 */
const esquemaDeJanela = z.object({
  gymUnitId: z.string().uuid(),
  // 0 = domingo ... 6 = sabado -- eixo do motor de decisao. Ver #129.
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startMinute: z.coerce.number().int().min(0).max(1440),
  endMinute: z.coerce.number().int().min(0).max(1440),
});

const esquemaDePlano = z.object({
  name: z.string().trim().min(1, 'Informe o nome do plano').max(120, 'Nome longo demais'),
  description: z.string().trim().max(500, 'Descrição longa demais').optional(),
  gymUnitIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma unidade'),
});

const esquemaDeAssinatura = z.object({
  studentId: z.string().uuid(),
  planId: z.string().uuid('Selecione o plano'),
  startsAt: z.string().min(1, 'Informe o início da vigência'),
  endsAt: z.string().min(1, 'Informe o fim da vigência'),
  reason: z
    .string()
    .trim()
    .min(3, 'Descreva o motivo — a auditoria depende disso')
    .max(300, 'Motivo longo demais'),
  /**
   * Assinatura vigente a SUBSTITUIR, quando existe.
   *
   * Presentes juntos ou ausentes juntos: cancelar exige id e versão, e ter
   * um sem o outro é sempre erro de montagem da tela, nunca entrada da
   * recepção. Ausentes = o aluno não tem plano, e isto é uma atribuição
   * comum.
   */
  substituiSubscriptionId: z.string().uuid().optional(),
  substituiVersion: z.coerce.number().int().min(0).optional(),
});

export interface EstadoDoPlano {
  erro?: string;
  sucesso?: { planId: string; name: string };
  valores?: { name?: string; description?: string; amountMinor?: string };
}

export interface EstadoDoReajuste {
  erro?: string;
  sucesso?: { amountMinor: number; validFrom: string };
  valores?: { amountMinor?: string; validFrom?: string };
}

export interface EstadoDaAssinatura {
  erro?: string;
  sucesso?: { subscriptionId: string; entitlementId: string };
  valores?: { planId?: string; startsAt?: string; endsAt?: string; reason?: string };
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  PLAN_NOT_FOUND: 'Plano não encontrado nesta academia.',
  PLAN_UNIT_NOT_FOUND: 'Uma das unidades selecionadas não existe nesta academia.',
  PLAN_WINDOW_UNIT_NOT_IN_PLAN:
    'Há janela de horário para uma unidade que não faz parte do plano.',
  PLAN_INVALID_ACCESS_WINDOW:
    'Janela de horário inválida: verifique se o fim é depois do início e se não há sobreposição no mesmo dia.',
  STUDENT_NOT_FOUND: 'Aluno não encontrado nesta academia.',
  // A recepção precisa saber POR QUE não pode: bloqueado, cancelado ou
  // arquivado. Suspenso NÃO entra aqui — continua elegível (INV-033).
  STUDENT_NOT_ELIGIBLE:
    'Este aluno está bloqueado, cancelado ou arquivado — regularize a situação antes de atribuir o plano.',
  SUBSCRIPTION_NOT_FOUND: 'Assinatura não encontrada.',
  SUBSCRIPTION_VERSION_CONFLICT:
    'Alguém alterou esta assinatura enquanto você editava. Recarregue a ficha e tente de novo.',
  FORBIDDEN: 'Seu perfil não tem permissão para esta ação.',
  PLAN_PRICE_VALID_FROM_TAKEN: 'Já existe um preço cadastrado para esta data de início.',
  /*
   * A recusa que protege ACESSO: desativar plano com aluno usando o tiraria
   * da lista enquanto alguem ainda depende dele, e a recepcao descobriria na
   * catraca. A frase diz O QUE FAZER -- a API ja conta quantas assinaturas
   * seguram o plano.
   */
  PLAN_IN_USE:
    'Este plano tem assinatura em vigor. Encerre ou troque o plano dos alunos antes de desativá-lo.',
  PLAN_PRICE_RETROACTIVE:
    'A data de início não pode estar no passado — reajuste retroativo não é permitido.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

/**
 * Converte `datetime-local` em ISO com fuso.
 *
 * O input entrega `2026-08-16T18:00` sem fuso; a API exige ISO completo. Sem a
 * conversão o valor seria recusado como formato inválido, e o operador veria
 * "confira os dados" sem entender qual dado.
 */
function instanteIso(valor: string): string {
  if (valor === '') return '';

  const data = new Date(valor);

  return Number.isFinite(data.getTime()) ? data.toISOString() : '';
}

/**
 * Lê as janelas de acesso do formulário.
 *
 * Os campos vêm repetidos (`janelaDia`, `janelaInicio`, `janelaFim`, um por
 * linha), e `getAll` preserva a ordem — é o que amarra dia, início e fim da
 * mesma linha. Linha em branco é descartada: a operadora que adiciona três
 * linhas e preenche duas não deve ver erro de validação por causa da terceira.
 */
function janelasDoFormulario(
  formulario: FormData,
  unidadePadrao: string,
): { gymUnitId: string; dayOfWeek: number; startMinute: number; endMinute: number }[] {
  const dias = formulario.getAll('janelaDia');
  const inicios = formulario.getAll('janelaInicio');
  const fins = formulario.getAll('janelaFim');
  const unidades = formulario.getAll('janelaUnidade');

  const janelas: {
    gymUnitId: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }[] = [];

  for (let linha = 0; linha < dias.length; linha += 1) {
    const dia = dias[linha];
    const inicio = inicios[linha];
    const fim = fins[linha];
    const unidade = unidades[linha];

    if (typeof dia !== 'string' || typeof inicio !== 'string' || typeof fim !== 'string') continue;
    if (dia === '' || inicio === '' || fim === '') continue;

    const validada = esquemaDeJanela.safeParse({
      gymUnitId: typeof unidade === 'string' && unidade !== '' ? unidade : unidadePadrao,
      dayOfWeek: dia,
      startMinute: minutoDaHora(inicio),
      endMinute: minutoDaHora(fim),
    });

    if (validada.success) janelas.push(validada.data);
  }

  return janelas;
}

/** `"18:00"` → `1080`. Formato do input `time`, unidade da API. */
function minutoDaHora(hora: string): number {
  const partes = hora.split(':');
  const h = Number(partes[0]);
  const m = Number(partes[1]);

  if (!Number.isInteger(h) || !Number.isInteger(m)) return -1;

  return h * 60 + m;
}

export async function cadastrarPlano(
  _anterior: EstadoDoPlano,
  formulario: FormData,
): Promise<EstadoDoPlano> {
  const unidades = formulario
    .getAll('gymUnitIds')
    .filter((valor): valor is string => typeof valor === 'string' && valor !== '');

  const bruto = {
    name: texto(formulario, 'name'),
    description: texto(formulario, 'description'),
    gymUnitIds: unidades,
  };

  const amountMinorDigitado = texto(formulario, 'amountMinor');
  const valores = {
    name: bruto.name,
    description: bruto.description,
    amountMinor: amountMinorDigitado,
  };

  const validado = esquemaDePlano.safeParse(bruto);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  // F53: plano sem preco nao pode existir. A API recusa (`amountMinor`
  // obrigatorio, > 0) -- barrar aqui evita o round-trip e da a frase certa,
  // em vez de "confira os dados informados" sem dizer qual dado.
  if (amountMinorDigitado.trim() === '') {
    return { erro: 'Informe o preço do plano.', valores };
  }

  const amountMinor = paraCentavos(amountMinorDigitado);

  if (amountMinor === null || amountMinor <= 0) {
    return { erro: 'Preço inválido — use até duas casas decimais, por exemplo 150,00.', valores };
  }

  const janelas = janelasDoFormulario(formulario, unidades[0]!);

  if (janelas.length === 0) {
    // A API exige ao menos uma janela. Barrar aqui dá a frase certa; deixar
    // passar devolveria `VALIDATION_FAILED` sem dizer que o problema é o
    // horário.
    return { erro: 'Informe ao menos uma janela de horário para o plano.', valores };
  }

  const resposta = await chamarApi<{ id: string; name: string }>('/api/v1/plans', {
    metodo: 'POST',
    // `janelas` em pt-BR é o nome do campo no contrato da API, não descuido.
    corpo: {
      name: validado.data.name,
      ...(bruto.description !== '' ? { description: bruto.description } : {}),
      gymUnitIds: validado.data.gymUnitIds,
      janelas,
      amountMinor,
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível criar o plano'), valores };
  }

  revalidatePath('/plans');

  return { sucesso: { planId: resposta.dados.id, name: resposta.dados.name } };
}

/**
 * Reajuste — F53, item 6 do brief. Nova linha de vigência, sem tocar em
 * invoice já emitida (INV-068). `validFrom` no passado é recusado pela API
 * com 422 `PLAN_PRICE_RETROACTIVE` — a mensagem já sai em português claro,
 * sem o código (ver `MENSAGEM`).
 */
export async function reajustarPreco(
  _anterior: EstadoDoReajuste,
  formulario: FormData,
): Promise<EstadoDoReajuste> {
  const planId = texto(formulario, 'planId');
  const amountMinorDigitado = texto(formulario, 'amountMinor');
  const validFromDigitado = texto(formulario, 'validFrom');

  const valores = { amountMinor: amountMinorDigitado, validFrom: validFromDigitado };

  if (amountMinorDigitado.trim() === '') {
    return { erro: 'Informe o novo preço.', valores };
  }

  const amountMinor = paraCentavos(amountMinorDigitado);

  if (amountMinor === null || amountMinor <= 0) {
    return { erro: 'Preço inválido — use até duas casas decimais, por exemplo 150,00.', valores };
  }

  const validFrom = instanteIso(validFromDigitado);

  if (validFrom === '') {
    return { erro: 'Informe a data de início do reajuste.', valores };
  }

  const resposta = await chamarApi<{ amountMinor: number; currency: string; validFrom: string }>(
    `/api/v1/plans/${planId}/prices`,
    { metodo: 'POST', corpo: { amountMinor, validFrom } },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível reajustar o preço'), valores };
  }

  // So `/plans`: nao ha ficha de plano (`/plans/:id`) nesta fatia -- ver
  // `AcaoDeReajuste`, que vive na propria listagem.
  revalidatePath('/plans');

  return { sucesso: { amountMinor: resposta.dados.amountMinor, validFrom: resposta.dados.validFrom } };
}

export async function atribuirPlano(
  _anterior: EstadoDaAssinatura,
  formulario: FormData,
): Promise<EstadoDaAssinatura> {
  const substituiId = texto(formulario, 'substituiSubscriptionId');
  const substituiVersao = texto(formulario, 'substituiVersion');

  const bruto = {
    studentId: texto(formulario, 'studentId'),
    planId: texto(formulario, 'planId'),
    startsAt: texto(formulario, 'startsAt'),
    endsAt: texto(formulario, 'endsAt'),
    reason: texto(formulario, 'reason'),
    ...(substituiId ? { substituiSubscriptionId: substituiId } : {}),
    ...(substituiVersao ? { substituiVersion: substituiVersao } : {}),
  };

  const valores = {
    planId: bruto.planId,
    startsAt: bruto.startsAt,
    endsAt: bruto.endsAt,
    reason: bruto.reason,
  };

  const validado = esquemaDeAssinatura.safeParse(bruto);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const inicio = instanteIso(bruto.startsAt);
  const fim = instanteIso(bruto.endsAt);

  if (inicio === '' || fim === '') {
    return { erro: 'Informe datas de vigência válidas.', valores };
  }

  if (new Date(fim).getTime() <= new Date(inicio).getTime()) {
    return { erro: 'O fim da vigência precisa ser depois do início.', valores };
  }

  /*
   * TROCA DE PLANO: cancela a anterior ANTES de criar a nova.
   *
   * `POST /subscriptions` não substitui nada — cria. Atribuir um segundo
   * plano sem cancelar o primeiro deixa DUAS assinaturas e DOIS entitlements
   * ativos, e a catraca segue honrando o antigo pela união das janelas: a
   * tela mostra o plano novo (a lista lê a assinatura mais recente) enquanto
   * o acesso continua valendo pelo velho. Bug silencioso, no caminho da
   * catraca.
   *
   * A ORDEM não é indiferente. Cancelar depois de criar deixaria os dois
   * ativos se o cancelamento falhasse — exatamente o estado que este código
   * existe para impedir. Cancelando antes, a falha inversa (cancelou e a
   * criação falhou) deixa o aluno SEM plano: visível na hora, na própria
   * ficha, e corrigível atribuindo de novo. Entre um erro que se vê e um que
   * some, escolhe-se o que se vê.
   *
   * O `CANCEL` revoga o entitlement na mesma transação da API
   * (`alterarAssinatura`), então não há janela em que a assinatura esteja
   * cancelada e o direito de acesso continue de pé.
   */
  if (validado.data.substituiSubscriptionId !== undefined) {
    if (validado.data.substituiVersion === undefined) {
      return { erro: 'Não foi possível identificar a assinatura atual. Recarregue a ficha.', valores };
    }

    const cancelamento = await chamarApi<{ id: string; status: string }>(
      `/api/v1/subscriptions/${validado.data.substituiSubscriptionId}/actions`,
      {
        metodo: 'POST',
        corpo: {
          action: 'CANCEL',
          version: validado.data.substituiVersion,
          reason: validado.data.reason,
        },
      },
    );

    if (!cancelamento.ok) {
      return {
        erro: frase(
          cancelamento.erro?.code ?? '',
          'Não foi possível encerrar o plano atual, e por isso o novo não foi atribuído',
        ),
        valores,
      };
    }
  }

  // ATENÇÃO: esta rota NÃO é idempotente — decisão registrada na issue #7,
  // aval do PI em 15/08/2026. Duplo clique cria duas assinaturas e dois
  // direitos de acesso. A defesa vive no formulário, que desabilita o botão
  // enquanto a submissão está em voo (`useFormStatus`). Quando o
  // `Idempotency-Key` transversal chegar (INV-087, card [INFRA] antes de F12),
  // esta chamada passa a mandar a chave e a defesa deixa de depender da tela.
  const resposta = await chamarApi<{
    subscriptionId: string;
    entitlement: { id: string };
  }>('/api/v1/subscriptions', {
    metodo: 'POST',
    corpo: {
      studentId: validado.data.studentId,
      planId: validado.data.planId,
      startsAt: inicio,
      endsAt: fim,
      reason: validado.data.reason,
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível atribuir o plano'), valores };
  }

  revalidatePath(`/students/${bruto.studentId}`);

  return {
    sucesso: {
      subscriptionId: resposta.dados.subscriptionId,
      entitlementId: resposta.dados.entitlement.id,
    },
  };
}

/*
 * PAUSAR, RETOMAR E CANCELAR ASSINATURA NÃO ENTRARAM NESTA FATIA.
 *
 * `POST /api/v1/subscriptions/:id/actions` existe desde o PR #70, mas o
 * aceite da Slice 1.2 fala em *atribuir* plano — não em administrar o ciclo de
 * vida da assinatura. Uma action pronta sem tela que a chame seria código sem
 * consumidor e sem teste, e o contrato só se confirma quando alguém o exerce.
 *
 * Falta também o dado: a rota exige a `version` da assinatura, e o
 * `EntitlementDto` que a ficha recebe traz `subscriptionId` mas não a versão.
 * Construir a tela exige rota nova ou campo novo — decisão de escopo, do PI.
 */

export interface EstadoDaAtivacaoDePlano {
  erro?: string;
  sucesso?: { planId: string; isActive: boolean };
}

const esquemaDeAtivacaoDePlano = z.object({
  planId: z.string().uuid(),
  /*
   * Vem do formulário como string: `FormData` não tem booleano. A conversão
   * é explícita porque `Boolean('false')` é `true` -- o erro clássico que
   * faria "desativar" ativar.
   */
  isActive: z.enum(['true', 'false']).transform((valor) => valor === 'true'),
});

/**
 * Liga e desliga o plano da lista de escolha.
 *
 * DESATIVA, NÃO APAGA (decisão do PI, 24/08/2026): apagar deixaria invoice e
 * timeline antigas citando um plano inexistente, e o histórico financeiro é
 * auditado.
 *
 * A recusa por plano em uso vem da API (`PLAN_IN_USE`) e não é replicada
 * aqui: contar assinatura no cliente exigiria uma segunda chamada e ainda
 * assim correria por fora — entre a contagem e o clique, alguém pode
 * assinar. A guarda vive onde a decisão é atômica.
 */
export async function alterarAtivacaoDePlano(
  _anterior: EstadoDaAtivacaoDePlano,
  formulario: FormData,
): Promise<EstadoDaAtivacaoDePlano> {
  const validado = esquemaDeAtivacaoDePlano.safeParse({
    planId: texto(formulario, 'planId'),
    isActive: texto(formulario, 'isActive'),
  });

  if (!validado.success) {
    return { erro: 'Não foi possível identificar o plano. Recarregue a página.' };
  }

  const resposta = await chamarApi<{ id: string; isActive: boolean }>(
    `/api/v1/plans/${validado.data.planId}/activation`,
    { metodo: 'PATCH', corpo: { isActive: validado.data.isActive } },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(
        resposta.erro?.code ?? '',
        validado.data.isActive
          ? 'Não foi possível reativar o plano'
          : 'Não foi possível desativar o plano',
      ),
    };
  }

  revalidatePath('/plans');

  return { sucesso: { planId: resposta.dados.id, isActive: resposta.dados.isActive } };
}

export interface EstadoDaEdicaoDePlano {
  erro?: string;
  sucesso?: { planId: string; name: string };
  valores?: { name?: string; description?: string };
}

/**
 * Edita nome, descrição, unidades e janelas do plano.
 *
 * PREÇO NÃO ENTRA: tem rota própria com histórico de vigência
 * (`reajustarPreco`), e trocar o valor por aqui apagaria a linha do tempo
 * que o INV-068 preserva. A API é `.strict()` e recusa `amountMinor` no
 * corpo — a omissão aqui não é esquecimento.
 *
 * UNIDADES E JANELAS VIAJAM JUNTAS porque a janela aponta para `gymUnitId`:
 * mandar só as unidades deixaria janela para uma unidade que saiu do plano
 * — regra nunca avaliada, gravada como se valesse.
 */
export async function editarPlano(
  _anterior: EstadoDaEdicaoDePlano,
  formulario: FormData,
): Promise<EstadoDaEdicaoDePlano> {
  const planId = texto(formulario, 'planId');

  const unidades = formulario
    .getAll('gymUnitIds')
    .filter((valor): valor is string => typeof valor === 'string' && valor !== '');

  const valores = {
    name: texto(formulario, 'name'),
    description: texto(formulario, 'description'),
  };

  const validado = esquemaDePlano.safeParse({ ...valores, gymUnitIds: unidades });

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const janelas = janelasDoFormulario(formulario, unidades[0]!);

  if (janelas.length === 0) {
    return { erro: 'Informe ao menos uma janela de horário.', valores };
  }

  const resposta = await chamarApi<{ id: string; name: string }>(`/api/v1/plans/${planId}`, {
    metodo: 'PATCH',
    corpo: {
      name: validado.data.name,
      ...(validado.data.description ? { description: validado.data.description } : {}),
      gymUnitIds: validado.data.gymUnitIds,
      janelas,
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível salvar o plano'), valores };
  }

  revalidatePath('/plans');

  return { sucesso: { planId: resposta.dados.id, name: resposta.dados.name } };
}
