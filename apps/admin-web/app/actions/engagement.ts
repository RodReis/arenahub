'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';

/**
 * Moderação de apelido público -- F30, Task 9; `HIDDEN` na F35.
 *
 * `HIDDEN` era estado sem NENHUM caminho de escrita desde a F30, esperando o
 * canal de denúncia (ADR-046, Decisão 6). A F35 decidiu que o canal não é do
 * aluno: a secretaria oculta quando alguém reclama na recepção (ADR-049,
 * Decisão 5).
 *
 * Rejeitar e ocultar são atos diferentes: rejeitar recusa um apelido que
 * nunca apareceu; ocultar retira um que já estava em circulação.
 */
const esquemaDeModeracao = z.object({
  perfilId: z.string().uuid(),
  decisao: z.enum(['APPROVED', 'REJECTED', 'HIDDEN']),
  rejectionReason: z
    .enum(['OFENSIVO', 'CONTEM_PII', 'IMPERSONACAO', 'SPAM_OU_PROPAGANDA', 'ILEGIVEL'])
    .nullish(),
});

export interface EstadoDaModeracao {
  erro?: string;
  sucesso?: { perfilId: string };
}

/**
 * Mensagem por codigo estavel -- nunca a mensagem crua do servidor.
 *
 * `ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO` e o erro que o moderador encontra de
 * verdade (dois alunos escolhendo o mesmo apelido, o segundo chegando na
 * fila depois do primeiro ja aprovado): a mensagem explica o que aconteceu,
 * nao so o codigo.
 */
const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  RAZAO_DE_RECUSA_OBRIGATORIA: 'Escolha um motivo antes de rejeitar ou ocultar o apelido.',
  RAZAO_DE_RECUSA_INVALIDA: 'Motivo de rejeição inválido.',
  ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO:
    'Outro aluno já tem este apelido aprovado. Rejeite ou peça para este aluno escolher outro.',
};

function mensagemDe(code: string | undefined, padrao: string): string {
  return (code ? MENSAGEM[code] : undefined) ?? padrao;
}

/** Espelha `SnapshotDto` de `engagement-xp.controller.ts`. */
export interface SnapshotDto {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'WITHHELD';
  publishedAt: string | null;
  entries: { studentId: string; position: number; points: number }[];
}

/**
 * Placar mensal e ajuste de XP -- F31, Task 11.
 *
 * NAO HA ACAO DE EDITAR aqui: `gerarPlacar` e `publicarPlacar` so avancam o
 * snapshot pelos estados que a API aceita (DRAFT/WITHHELD -> PUBLISHED), e
 * `ajustarXp` sempre GRAVA um movimento novo. O ledger append-only e o
 * snapshot imutavel apos publicado sao garantidos no backend (Task 1, Task 8)
 * -- este arquivo so traduz o que a API ja recusa em mensagem de tela.
 */
const MENSAGEM_DO_PLACAR: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  RANKING_SNAPSHOT_IMUTAVEL:
    'Este placar já foi publicado e não pode ser publicado de novo — ele é definitivo.',
  RANKING_SNAPSHOT_NAO_ENCONTRADO: 'Placar não encontrado. Gere um novo antes de publicar.',
};

const MENSAGEM_DO_AJUSTE: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  ALUNO_NAO_ENCONTRADO: 'Aluno não encontrado.',
  CATALOGO_DE_XP_VAZIO: 'Este tenant ainda não tem nenhuma regra de XP cadastrada.',
};

export interface EstadoDoGerar {
  erro?: string;
  snapshot?: SnapshotDto;
}

const esquemaDeGerar = z.object({
  gymUnitId: z.string().uuid(),
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
});

export async function gerarPlacar(
  _anterior: EstadoDoGerar,
  formulario: FormData,
): Promise<EstadoDoGerar> {
  const analisado = esquemaDeGerar.safeParse({
    gymUnitId: formulario.get('gymUnitId'),
    mes: formulario.get('mes'),
  });

  if (!analisado.success) {
    return { erro: 'Escolha a unidade e o mês antes de gerar o placar.' };
  }

  const resposta = await chamarApi<SnapshotDto>(
    `/api/v1/engagement/rankings/${analisado.data.gymUnitId}/${analisado.data.mes}/gerar`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível gerar o placar.') };
  }

  return { snapshot: resposta.dados };
}

export interface EstadoDoPublicar {
  erro?: string;
  snapshot?: SnapshotDto;
}

const esquemaDePublicar = z.object({ snapshotId: z.string().trim().min(1) });

export async function publicarPlacar(
  _anterior: EstadoDoPublicar,
  formulario: FormData,
): Promise<EstadoDoPublicar> {
  const analisado = esquemaDePublicar.safeParse({ snapshotId: formulario.get('snapshotId') });

  if (!analisado.success) {
    return { erro: 'Placar inválido.' };
  }

  const resposta = await chamarApi<SnapshotDto>(
    `/api/v1/engagement/rankings/${analisado.data.snapshotId}/publicar`,
    { metodo: 'POST' },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: (resposta.erro?.code ? MENSAGEM_DO_PLACAR[resposta.erro.code] : undefined) ?? 'Não foi possível publicar o placar.' };
  }

  revalidatePath('/engagement/placar');

  return { snapshot: resposta.dados };
}

export interface EstadoDoAjuste {
  erro?: string;
  sucesso?: boolean;
}

/**
 * Motivo obrigatorio e nao-vazio JA no boundary do cliente -- a API repete a
 * checagem (`M5-FR-007`), mas duplicar aqui devolve o erro sem round-trip
 * para o caso mais comum de digitacao (campo deixado em branco).
 */
const esquemaDeAjuste = z.object({
  studentId: z.string().uuid(),
  pontos: z.coerce.number().int().refine((valor) => valor !== 0, 'pontos nao pode ser zero'),
  motivo: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
});

export async function ajustarXp(
  _anterior: EstadoDoAjuste,
  formulario: FormData,
): Promise<EstadoDoAjuste> {
  const analisado = esquemaDeAjuste.safeParse({
    studentId: formulario.get('studentId'),
    pontos: formulario.get('pontos'),
    motivo: formulario.get('motivo'),
    idempotencyKey: formulario.get('idempotencyKey'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados do ajuste.' };
  }

  const resposta = await chamarApi<{ ajustado: boolean }>(
    `/api/v1/engagement/xp/${analisado.data.studentId}/ajustar`,
    {
      metodo: 'POST',
      corpo: {
        pontos: analisado.data.pontos,
        motivo: analisado.data.motivo,
        idempotencyKey: analisado.data.idempotencyKey,
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro:
        (resposta.erro?.code ? MENSAGEM_DO_AJUSTE[resposta.erro.code] : undefined) ??
        'Não foi possível registrar o ajuste.',
    };
  }

  return { sucesso: true };
}

export async function moderarAlias(
  _anterior: EstadoDaModeracao,
  formulario: FormData,
): Promise<EstadoDaModeracao> {
  const analisado = esquemaDeModeracao.safeParse({
    perfilId: formulario.get('perfilId'),
    decisao: formulario.get('decisao'),
    rejectionReason: formulario.get('rejectionReason') || null,
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/engagement/aliases/${analisado.data.perfilId}`,
    {
      metodo: 'PATCH',
      corpo: {
        decisao: analisado.data.decisao,
        ...(analisado.data.rejectionReason
          ? { rejectionReason: analisado.data.rejectionReason }
          : {}),
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível registrar a decisão.') };
  }

  revalidatePath('/engagement/aliases');

  return { sucesso: { perfilId: resposta.dados.id } };
}

/* -------------------------------------------------------------------------
 * Desafios -- F34, Slice 5.5, ADR-048.
 * ------------------------------------------------------------------------- */

/** Espelha o item de `GET /engagement/challenges/templates`. */
export interface TemplateDeDesafioDto {
  id: string;
  code: string;
  version: number;
  name: string;
  maxSessoesPorSemana: number;
  maxJanelaEmDias: number;
}

/** Espelha o item de `GET /engagement/challenges`. */
export interface DesafioDaListagemDto {
  id: string;
  title: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  targetValue: number;
  startsOn: string;
  endsOn: string;
  templateName: string;
  participantes: number;
  gymUnitId: string | null;
}

export interface EstadoDoDesafio {
  erro?: string;
  sucesso?: { id: string; titulo: string };
}

/** `AAAA-MM-DD` -- o mesmo formato que a API exige (dia local da unidade). */
const REGEX_DO_DIA = /^\d{4}-\d{2}-\d{2}$/u;

const esquemaDeCriacaoDeDesafio = z.object({
  templateVersionId: z.string().trim().min(1),
  /** Vazio no formulario = tenant inteiro. */
  gymUnitId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(120),
  targetValue: z.coerce.number().int().positive(),
  startsOn: z.string().regex(REGEX_DO_DIA),
  endsOn: z.string().regex(REGEX_DO_DIA),
});

/**
 * Mensagem por codigo estavel -- nunca a mensagem crua do servidor.
 *
 * `CHALLENGE_FREQUENCIA_ACIMA_DO_LIMITE` e o erro que a secretaria encontra
 * de verdade: a meta que ela digitou exige mais treino por semana do que o
 * template permite (`M5-BR-011`). A frase diz o que fazer -- baixar a meta ou
 * alongar a janela -- em vez de repetir o codigo.
 */
const MENSAGEM_DE_DESAFIO: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  CHALLENGE_TEMPLATE_NAO_ENCONTRADO: 'Escolha um modelo de desafio válido.',
  CHALLENGE_FREQUENCIA_ACIMA_DO_LIMITE:
    'A meta exige mais treinos por semana do que este modelo permite. Reduza a meta ou alongue o período.',
  CHALLENGE_JANELA_LONGA_DEMAIS: 'O período é mais longo do que este modelo permite.',
  CHALLENGE_JANELA_INVALIDA: 'A data final precisa ser igual ou posterior à inicial.',
  CHALLENGE_META_INVALIDA: 'A meta precisa ser um número inteiro maior que zero.',
  CHALLENGE_NAO_ENCONTRADO: 'Desafio não encontrado.',
  CHALLENGE_JA_ATIVADO: 'Este desafio já foi aberto.',
  CHALLENGE_TEM_PARTICIPANTE:
    'Alunos já se inscreveram. Cancele o desafio — assim o histórico deles é preservado.',
  CHALLENGE_DESAFIO_ENCERRADO: 'Este desafio já terminou e não pode mais ser alterado.',
};

function mensagemDeDesafio(code: string | undefined, padrao: string): string {
  return (code ? MENSAGEM_DE_DESAFIO[code] : undefined) ?? padrao;
}

/**
 * Cria o desafio em RASCUNHO.
 *
 * Nao abre a inscricao: `ativarDesafio` e um segundo ato deliberado, para que
 * um erro de digitacao na meta nao esteja recebendo aluno antes de alguem
 * reler.
 */
export async function criarDesafio(
  _anterior: EstadoDoDesafio,
  formulario: FormData,
): Promise<EstadoDoDesafio> {
  const unidade = formulario.get('gymUnitId');

  const analisado = esquemaDeCriacaoDeDesafio.safeParse({
    templateVersionId: formulario.get('templateVersionId'),
    // Campo vazio significa "todas as unidades", nao string vazia.
    gymUnitId: typeof unidade === 'string' && unidade.length > 0 ? unidade : null,
    title: formulario.get('title'),
    targetValue: formulario.get('targetValue'),
    startsOn: formulario.get('startsOn'),
    endsOn: formulario.get('endsOn'),
  });

  if (!analisado.success) {
    return { erro: 'Preencha modelo, título, meta e o período do desafio.' };
  }

  const resposta = await chamarApi<{ id: string }>('/api/v1/engagement/challenges', {
    metodo: 'POST',
    corpo: analisado.data,
  });

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDeDesafio(resposta.erro?.code, 'Não foi possível criar o desafio.') };
  }

  revalidatePath('/engagement/desafios');

  return { sucesso: { id: resposta.dados.id, titulo: analisado.data.title } };
}

const esquemaDeAtivacao = z.object({ challengeId: z.string().trim().min(1) });

/** Abre a inscricao. A partir daqui o aluno ve o desafio no totem. */
export async function ativarDesafio(
  _anterior: EstadoDoDesafio,
  formulario: FormData,
): Promise<EstadoDoDesafio> {
  const analisado = esquemaDeAtivacao.safeParse({
    challengeId: formulario.get('challengeId'),
  });

  if (!analisado.success) {
    return { erro: 'Desafio inválido.' };
  }

  const resposta = await chamarApi<{ ok: boolean }>(
    `/api/v1/engagement/challenges/${analisado.data.challengeId}/activate`,
    { metodo: 'POST' },
  );

  if (!resposta.ok) {
    return { erro: mensagemDeDesafio(resposta.erro?.code, 'Não foi possível abrir o desafio.') };
  }

  revalidatePath('/engagement/desafios');

  return { sucesso: { id: analisado.data.challengeId, titulo: '' } };
}

const esquemaDeEdicaoDeDesafio = z.object({
  challengeId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120),
  targetValue: z.coerce.number().int().positive(),
  startsOn: z.string().regex(REGEX_DO_DIA),
  endsOn: z.string().regex(REGEX_DO_DIA),
});

/**
 * Edita titulo, meta e janela.
 *
 * O modelo NAO e editavel: trocar o modelo trocaria o teto de seguranca por
 * baixo do desafio, e o limite foi validado contra o modelo original.
 */
export async function editarDesafio(
  _anterior: EstadoDoDesafio,
  formulario: FormData,
): Promise<EstadoDoDesafio> {
  const analisado = esquemaDeEdicaoDeDesafio.safeParse({
    challengeId: formulario.get('challengeId'),
    title: formulario.get('title'),
    targetValue: formulario.get('targetValue'),
    startsOn: formulario.get('startsOn'),
    endsOn: formulario.get('endsOn'),
  });

  if (!analisado.success) {
    return { erro: 'Preencha título, meta e o período do desafio.' };
  }

  const { challengeId, ...dados } = analisado.data;

  const resposta = await chamarApi<{ ok: boolean }>(
    `/api/v1/engagement/challenges/${challengeId}`,
    { metodo: 'PATCH', corpo: dados },
  );

  if (!resposta.ok) {
    return { erro: mensagemDeDesafio(resposta.erro?.code, 'Não foi possível salvar o desafio.') };
  }

  revalidatePath('/engagement/desafios');

  return { sucesso: { id: challengeId, titulo: dados.title } };
}

const esquemaPorId = z.object({ challengeId: z.string().trim().min(1) });

/** Exclui de vez -- a API recusa se alguém já se inscreveu. */
export async function excluirDesafio(
  _anterior: EstadoDoDesafio,
  formulario: FormData,
): Promise<EstadoDoDesafio> {
  const analisado = esquemaPorId.safeParse({ challengeId: formulario.get('challengeId') });

  if (!analisado.success) return { erro: 'Desafio inválido.' };

  const resposta = await chamarApi<{ ok: boolean }>(
    `/api/v1/engagement/challenges/${analisado.data.challengeId}`,
    { metodo: 'DELETE' },
  );

  if (!resposta.ok) {
    return { erro: mensagemDeDesafio(resposta.erro?.code, 'Não foi possível excluir o desafio.') };
  }

  revalidatePath('/engagement/desafios');

  return { sucesso: { id: analisado.data.challengeId, titulo: '' } };
}

/** Fecha a porta SEM apagar: a adesão e o histórico do aluno continuam. */
export async function cancelarDesafio(
  _anterior: EstadoDoDesafio,
  formulario: FormData,
): Promise<EstadoDoDesafio> {
  const analisado = esquemaPorId.safeParse({ challengeId: formulario.get('challengeId') });

  if (!analisado.success) return { erro: 'Desafio inválido.' };

  const resposta = await chamarApi<{ ok: boolean }>(
    `/api/v1/engagement/challenges/${analisado.data.challengeId}/cancel`,
    { metodo: 'POST' },
  );

  if (!resposta.ok) {
    return { erro: mensagemDeDesafio(resposta.erro?.code, 'Não foi possível cancelar o desafio.') };
  }

  revalidatePath('/engagement/desafios');

  return { sucesso: { id: analisado.data.challengeId, titulo: '' } };
}

/* -------------------------------------------------------------------------
 * Contestações -- F35, Slice 5.6, ADR-049.
 * ------------------------------------------------------------------------- */

/** Espelha o item de `GET /engagement/contestacoes`. */
export interface ContestacaoDaFila {
  readonly id: string;
  readonly studentId: string;
  readonly alunoNome: string;
  readonly subject: string;
  readonly descricao: string;
  readonly status: string;
  readonly resolucao: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface EstadoDaResolucao {
  erro?: string;
  sucesso?: { id: string };
}

const esquemaDeResolucao = z.object({
  id: z.string().uuid(),
  desfecho: z.enum(['CORRIGIDA', 'IMPROCEDENTE']),
  resolucao: z.string().trim().min(1),
});

const MENSAGEM_DA_RESOLUCAO: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  CONTESTACAO_NAO_ENCONTRADA: 'Contestação não encontrada.',
  CONTESTACAO_JA_RESOLVIDA:
    'Esta contestação já foi resolvida por outra pessoa. Recarregue a fila para ver o desfecho.',
  CONTESTACAO_RESOLUCAO_OBRIGATORIA: 'Escreva a resposta que o aluno vai ler.',
};

/**
 * Registra o desfecho de uma contestação.
 *
 * A resposta é obrigatória nos DOIS desfechos: improcedente sem explicação é
 * silêncio com carimbo, e o aluno que não sabe por que perdeu reclama de novo.
 */
export async function resolverContestacao(
  _anterior: EstadoDaResolucao,
  formulario: FormData,
): Promise<EstadoDaResolucao> {
  const analisado = esquemaDeResolucao.safeParse({
    id: formulario.get('id'),
    desfecho: formulario.get('desfecho'),
    resolucao: formulario.get('resolucao'),
  });

  if (!analisado.success) {
    return { erro: 'Escreva a resposta que o aluno vai ler antes de concluir.' };
  }

  const resposta = await chamarApi<{ id: string }>(
    `/api/v1/engagement/contestacoes/${analisado.data.id}/resolver`,
    {
      metodo: 'POST',
      corpo: {
        desfecho: analisado.data.desfecho,
        resolucao: analisado.data.resolucao,
      },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro:
        MENSAGEM_DA_RESOLUCAO[resposta.erro?.code ?? ''] ??
        'Não foi possível registrar o desfecho.',
    };
  }

  revalidatePath('/engagement/contestacoes');

  return { sucesso: { id: resposta.dados.id } };
}

/* -------------------------------------------------------------------------
 * Configuração do engajamento -- F35, ADR-049 Decisão 3.
 * ------------------------------------------------------------------------- */

export interface ConfiguracaoDeEngajamento {
  readonly rankingEnabled: boolean;
  readonly challengesEnabled: boolean;
  readonly achievementsEnabled: boolean;
  readonly correctionLimitPoints: number | null;
}

export interface EstadoDaConfiguracao {
  erro?: string;
  sucesso?: true;
}

const MENSAGEM_DA_CONFIGURACAO: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  TETO_INVALIDO: 'O limite precisa ser um número inteiro a partir de zero, ou vazio para sem limite.',
};

/**
 * Grava só o campo que o operador mexeu.
 *
 * `correctionLimitPoints` distingue TRÊS estados que a tela poderia colapsar:
 * ausente (não mexeu), vazio (sem teto) e zero (ninguém corrige). Tratar vazio
 * como zero desligaria a correção de uma academia que só queria tirar o limite.
 */
export async function salvarConfiguracaoDeEngajamento(
  _anterior: EstadoDaConfiguracao,
  formulario: FormData,
): Promise<EstadoDaConfiguracao> {
  const corpo: Record<string, unknown> = {};

  for (const campo of ['rankingEnabled', 'challengesEnabled', 'achievementsEnabled'] as const) {
    const valor = formulario.get(campo);
    if (valor !== null) corpo[campo] = valor === 'true';
  }

  const teto = formulario.get('correctionLimitPoints');
  // `FormData.get` devolve `File | string | null`; sem estreitar para string,
  // um `File` viraria "[object Object]" e passaria a validacao numerica.
  if (typeof teto === 'string') {
    const texto = teto.trim();

    if (texto === '') {
      corpo['correctionLimitPoints'] = null;
    } else {
      const numero = Number(texto);
      if (!Number.isInteger(numero) || numero < 0) {
        return { erro: MENSAGEM_DA_CONFIGURACAO['TETO_INVALIDO'] as string };
      }
      corpo['correctionLimitPoints'] = numero;
    }
  }

  const resposta = await chamarApi<ConfiguracaoDeEngajamento>(
    '/api/v1/engagement/configuracao',
    { metodo: 'POST', corpo },
  );

  if (!resposta.ok || !resposta.dados) {
    return {
      erro:
        MENSAGEM_DA_CONFIGURACAO[resposta.erro?.code ?? ''] ??
        'Não foi possível salvar a configuração.',
    };
  }

  revalidatePath('/engagement');

  return { sucesso: true };
}
