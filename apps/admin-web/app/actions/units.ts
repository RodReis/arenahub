'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Cadastro de unidade — a metade que faltava.
 *
 * `POST /api/v1/units` existe na API com validação de fuso IANA e auditoria,
 * e nunca teve um chamador no painel. A tela `/units` só listava, e o próprio
 * estado vazio dela mandava "cadastre a primeira unidade" sem oferecer
 * caminho nenhum.
 *
 * A validação daqui NÃO substitui a da API: ela existe para a recepção ver o
 * erro sem perder o que digitou. A API valida de novo, e é ela que manda —
 * Server Action é superfície pública tanto quanto um endpoint.
 */
const esquemaDeUnidade = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Informe o código da unidade')
    .max(32, 'Código longo demais'),
  name: z.string().trim().min(1, 'Informe o nome da unidade').max(120, 'Nome longo demais'),
  /*
   * O fuso é validado de novo no servidor contra a base IANA do runtime
   * (ADR-019): o bloqueio por inadimplência depende dele, sem fallback, e
   * fuso inválido gravado hoje vira decisão de acesso errada depois. Aqui a
   * checagem é só de presença -- a lista da tela já é fechada.
   */
  timezone: z.string().min(1, 'Selecione o fuso horário da unidade'),
});

/**
 * Edição de unidade.
 *
 * `code` FICA DE FORA, e não por esquecimento: `PATCH /units/:id` não o
 * aceita. Ele é o identificador estável que aparece em tela, relatório e
 * conversa da operação — trocá-lo depois de a unidade existir quebraria a
 * referência de quem já o decorou.
 */
const esquemaDeEdicaoDeUnidade = z.object({
  unitId: z.string().uuid(),
  name: z.string().trim().min(1, 'Informe o nome da unidade').max(120, 'Nome longo demais'),
  timezone: z.string().min(1, 'Selecione o fuso horário da unidade'),
});

export interface EstadoDaUnidade {
  erro?: string;
  sucesso?: { id: string; name: string };
  /** Devolvidos para o formulário não perder o preenchimento em erro. */
  valores?: { code?: string; name?: string; timezone?: string };
}

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os dados informados.',
  FORBIDDEN: 'Seu perfil não tem permissão para cadastrar unidades.',
  /*
   * `code` é único por tenant no banco. A API responde 409 e a frase precisa
   * dizer QUAL campo repetiu -- "erro ao salvar" mandaria a recepção conferir
   * os três campos.
   */
  UNIT_CODE_TAKEN: 'Já existe uma unidade com este código nesta academia.',
};

function texto(formulario: FormData, campo: string): string {
  const valor = formulario.get(campo);

  return typeof valor === 'string' ? valor : '';
}

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

export async function cadastrarUnidade(
  _anterior: EstadoDaUnidade,
  formulario: FormData,
): Promise<EstadoDaUnidade> {
  const valores = {
    code: texto(formulario, 'code'),
    name: texto(formulario, 'name'),
    timezone: texto(formulario, 'timezone'),
  };

  const validado = esquemaDeUnidade.safeParse(valores);

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const resposta = await chamarApi<{ id: string; name: string }>('/api/v1/units', {
    metodo: 'POST',
    corpo: {
      code: validado.data.code,
      name: validado.data.name,
      timezone: validado.data.timezone,
      /*
       * HORÁRIO VAZIO, como o seed faz. Quem controla acesso é a janela do
       * PLANO (regra de arquitetura nº 1: entitlement decide), não o horário
       * declarado da unidade -- então nascer sem ele não impede nada. O
       * formulário de sete dias com faixas fica para quando existir tela que
       * o consuma; `PATCH /units/:id` já aceita a alteração.
       */
      openingHours: {},
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível cadastrar a unidade'), valores };
  }

  revalidatePath('/units');

  return { sucesso: { id: resposta.dados.id, name: resposta.dados.name } };
}

export async function editarUnidade(
  _anterior: EstadoDaUnidade,
  formulario: FormData,
): Promise<EstadoDaUnidade> {
  const unitId = texto(formulario, 'unitId');

  const valores = {
    name: texto(formulario, 'name'),
    timezone: texto(formulario, 'timezone'),
  };

  const validado = esquemaDeEdicaoDeUnidade.safeParse({ unitId, ...valores });

  if (!validado.success) {
    return {
      erro: validado.error.issues[0]?.message ?? 'Confira os dados informados.',
      valores,
    };
  }

  const resposta = await chamarApi<{ id: string; name: string }>(`/api/v1/units/${unitId}`, {
    metodo: 'PATCH',
    /*
     * SÓ nome e fuso. `openingHours` fica de fora de propósito: o schema o
     * declara opcional, e mandá-lo vazio aqui APAGARIA o horário de uma
     * unidade que já o tivesse — campo ausente é "não mexer", campo presente
     * e vazio é "esvazie".
     */
    corpo: { name: validado.data.name, timezone: validado.data.timezone },
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: frase(resposta.erro?.code ?? '', 'Não foi possível salvar a unidade'), valores };
  }

  revalidatePath('/units');

  return { sucesso: { id: resposta.dados.id, name: resposta.dados.name } };
}

/**
 * Inativação e reativação de unidade — o mais perto de "excluir" que existe.
 *
 * NÃO HÁ `DELETE /units/:id`, e não deve haver: dez tabelas referenciam
 * `GymUnit` com `onDelete: Cascade`, e apagar levaria junto dispositivo,
 * evento de acesso e avaliação física — o histórico da operação inteira.
 * `Student.gymUnit` é `Restrict` e já registrava a intenção do desenho.
 *
 * Inativar é ação sensível (DS-PAINEL.md §5.1): motivo obrigatório, e o
 * motivo é GRAVADO — vai para o `metadata` do `AuditLog`. Reativar não exige,
 * pelo mesmo critério: a exigência protege a ação que tira de operação.
 */
export async function alternarSituacaoDaUnidade(
  _anterior: EstadoDaUnidade,
  formulario: FormData,
): Promise<EstadoDaUnidade> {
  const unitId = texto(formulario, 'unitId');
  const inativando = texto(formulario, 'situacao') === 'INACTIVE';
  const motivo = texto(formulario, 'reason').trim();

  if (inativando && motivo.length < 10) {
    return { erro: 'Escreva o motivo da inativação (ao menos 10 caracteres).' };
  }

  const resposta = await chamarApi<{ id: string; name: string }>(`/api/v1/units/${unitId}`, {
    metodo: 'PATCH',
    corpo: {
      status: inativando ? 'INACTIVE' : 'ACTIVE',
      /*
       * Motivo SÓ quando inativa. A API o recusaria? Não — ele é opcional
       * lá. Mas mandar um motivo vazio na reativação gravaria uma string em
       * branco na auditoria, que é pior que campo ausente: parece que alguém
       * respondeu e não respondeu nada.
       */
      ...(inativando ? { reason: motivo } : {}),
    },
  });

  if (!resposta.ok || !resposta.dados) {
    return {
      erro: frase(
        resposta.erro?.code ?? '',
        inativando ? 'Não foi possível inativar a unidade' : 'Não foi possível reativar a unidade',
      ),
    };
  }

  revalidatePath('/units');

  return { sucesso: { id: resposta.dados.id, name: resposta.dados.name } };
}
