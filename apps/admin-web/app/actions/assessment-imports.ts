'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Revisao de campos multiarquivo e confirmacao da sessao (Task 9, F-multiarquivo).
 *
 * Duas acoes desta tela:
 *
 *   1. REVISAR um campo divergente -- escolhe qual valor vale
 *      (`POST .../fields/:fieldId`).
 *   2. CONFIRMAR a sessao inteira -- cria UMA avaliacao com as medidas de
 *      todos os arquivos (`POST .../confirm`).
 *
 * Nenhuma das duas decide sozinha: a Regra 1 do brief (nao pre-selecionar)
 * vive na tela, nao aqui -- esta acao so manda o que o avaliador escolheu.
 */

const MENSAGEM: Record<string, string> = {
  VALIDATION_FAILED: 'Confira os dados informados.',
  IMPORT_NOT_FOUND: 'Importacao nao encontrada nesta academia.',
  IMPORT_ALREADY_FINALIZED: 'Esta importacao ja foi confirmada ou descartada.',
  SESSION_NOT_FOUND: 'Sessao de revisao nao encontrada.',
  SESSION_EMPTY: 'A sessao nao tem nenhum arquivo processado ainda.',
  BIOIMPEDANCE_REQUIRED: 'Falta o arquivo da balanca de bioimpedancia nesta sessao.',
  DIVERGENCE_UNRESOLVED: 'Escolha qual valor vale para cada campo divergente antes de confirmar.',
  FORBIDDEN: 'Seu perfil nao tem permissao para esta acao.',
};

function mensagemDe(code: string | undefined, padrao: string): string {
  return (code ? MENSAGEM[code] : undefined) ?? padrao;
}

/**
 * `"importId:fieldId"` -- a sessao de revisao (`GET .../sessions/:id`) nao
 * devolve o import de cada campo, so por arquivo; o par completo e a unica
 * forma de descartar o concorrente CERTO quando ele vem de outro arquivo.
 */
const PAR_IMPORT_CAMPO = /^([0-9a-f-]{36}):([0-9a-f-]{36})$/i;

const esquemaDeRevisao = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  importId: z.string().uuid(),
  fieldId: z.string().uuid(),
  state: z.enum(['CONFIRMED', 'CORRECTED', 'DISCARDED']),
  reviewedValue: z.coerce.number().finite().positive().optional(),
  reviewedUnit: z.string().optional(),
  // Os outros campos da MESMA linha divergente -- escolher um vencedor
  // (CONFIRMED) exige descartar os concorrentes, senao eles ficam PENDING
  // para sempre e `sessaoPodeConfirmar` nunca libera a sessao
  // (`sessao-de-revisao.ts`).
  discardPairs: z.array(z.string().regex(PAR_IMPORT_CAMPO)).default([]),
});

const esquemaDeConfirmacao = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  assessedAt: z.string().min(1, 'Informe a data da medicao'),
});

const esquemaDeDescarte = z.object({
  studentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  importIds: z.array(z.string().uuid()).min(1),
});

export interface EstadoDaRevisao {
  erro?: string;
}

export interface EstadoDaConfirmacao {
  erro?: string;
  sucesso?: { assessmentId: string };
}

export interface EstadoDoDescarte {
  erro?: string;
  sucesso?: boolean;
}

export async function revisarCampo(
  _anterior: EstadoDaRevisao,
  formulario: FormData,
): Promise<EstadoDaRevisao> {
  const analisado = esquemaDeRevisao.safeParse({
    studentId: formulario.get('studentId'),
    sessionId: formulario.get('sessionId'),
    importId: formulario.get('importId'),
    fieldId: formulario.get('fieldId'),
    state: formulario.get('state'),
    reviewedValue: formulario.get('reviewedValue') || undefined,
    reviewedUnit: formulario.get('reviewedUnit') || undefined,
    discardPairs: formulario.getAll('discardPair'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi(
    `/api/v1/assessment-imports/${analisado.data.importId}/fields/${analisado.data.fieldId}`,
    {
      metodo: 'POST',
      corpo: {
        state: analisado.data.state,
        reviewedValue: analisado.data.reviewedValue ?? null,
        reviewedUnit: analisado.data.reviewedUnit ?? null,
      },
    },
  );

  if (!resposta.ok) {
    return { erro: mensagemDe(resposta.erro?.code, 'Nao foi possivel salvar a revisao.') };
  }

  // Descarta os concorrentes DEPOIS do vencedor confirmar -- se o primeiro
  // POST falhar, os concorrentes continuam PENDING e a tela mostra o erro,
  // em vez de a sessao ficar sem NENHUM valor para aquela medida.
  for (const par of analisado.data.discardPairs) {
    const [, outroImportId, outroFieldId] = PAR_IMPORT_CAMPO.exec(par) ?? [];

    if (outroImportId === undefined || outroFieldId === undefined) continue;

    const descarte = await chamarApi(
      `/api/v1/assessment-imports/${outroImportId}/fields/${outroFieldId}`,
      { metodo: 'POST', corpo: { state: 'DISCARDED' } },
    );

    if (!descarte.ok) {
      return { erro: mensagemDe(descarte.erro?.code, 'Nao foi possivel salvar a revisao.') };
    }
  }

  revalidatePath(
    `/students/${analisado.data.studentId}/health/imports/${analisado.data.sessionId}`,
  );

  return {};
}

export async function confirmarSessao(
  _anterior: EstadoDaConfirmacao,
  formulario: FormData,
): Promise<EstadoDaConfirmacao> {
  const analisado = esquemaDeConfirmacao.safeParse({
    studentId: formulario.get('studentId'),
    sessionId: formulario.get('sessionId'),
    assessedAt: formulario.get('assessedAt'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  const resposta = await chamarApi<{ assessmentId: string }>(
    `/api/v1/assessment-imports/sessions/${analisado.data.sessionId}/confirm`,
    {
      metodo: 'POST',
      corpo: { assessedAt: new Date(analisado.data.assessedAt).toISOString() },
    },
  );

  if (!resposta.ok || !resposta.dados) {
    return { erro: mensagemDe(resposta.erro?.code, 'Nao foi possivel confirmar a avaliacao.') };
  }

  revalidatePath(`/students/${analisado.data.studentId}/health`);

  return { sucesso: { assessmentId: resposta.dados.assessmentId } };
}

/**
 * Descarta a sessao INTEIRA -- botao "Descartar extração" do mock do PI.
 *
 * A API nao tem rota de descarte por sessao (so `POST .../:id/discard`, por
 * import): esta acao chama o endpoint UMA VEZ por arquivo. Se um descarte no
 * meio falhar, os arquivos ja descartados ficam descartados (a acao de
 * descartar e idempotente do lado da API) e o erro aparece na tela -- quem
 * usa tenta de novo, e os que ja foram nao duplicam efeito.
 */
export async function descartarSessao(
  _anterior: EstadoDoDescarte,
  formulario: FormData,
): Promise<EstadoDoDescarte> {
  const analisado = esquemaDeDescarte.safeParse({
    studentId: formulario.get('studentId'),
    sessionId: formulario.get('sessionId'),
    importIds: formulario.getAll('importId'),
  });

  if (!analisado.success) {
    return { erro: analisado.error.issues[0]?.message ?? 'Confira os dados informados.' };
  }

  for (const importId of analisado.data.importIds) {
    const resposta = await chamarApi(`/api/v1/assessment-imports/${importId}/discard`, {
      metodo: 'POST',
    });

    if (!resposta.ok) {
      return { erro: mensagemDe(resposta.erro?.code, 'Não foi possível descartar a extração.') };
    }
  }

  revalidatePath(`/students/${analisado.data.studentId}/health`);

  return { sucesso: true };
}

export interface EstadoDoEnvio {
  erro?: string;
  sucesso?: { sessionId: string; enviados: number };
}

/**
 * Envia os arquivos do mes e abre UMA sessao de revisao com todos.
 *
 * O primeiro arquivo cria a sessao; os demais entram nela pelo
 * `reviewSessionId` que a API devolveu. Em serie, e nao em paralelo, de
 * proposito: a sessao so existe DEPOIS que o primeiro upload responde, e
 * disparar os tres juntos abriria tres sessoes -- exatamente as tres
 * avaliacoes separadas que esta fatia existe para impedir.
 *
 * Falha no meio NAO desfaz o que subiu: os arquivos ja processados ficam na
 * sessao, e a tela de revisao mostra o que chegou. Apagar seria pior -- quem
 * enviou tres laudos e viu o terceiro falhar prefere revisar os dois que
 * subiram a recomecar do zero.
 */
export async function enviarArquivos(
  _anterior: EstadoDoEnvio,
  formulario: FormData,
): Promise<EstadoDoEnvio> {
  const studentId = formulario.get('studentId');
  const arquivos = formulario.getAll('arquivos').filter((a): a is File => a instanceof File);

  if (typeof studentId !== 'string' || studentId === '') {
    return { erro: 'Aluno não informado.' };
  }

  if (arquivos.length === 0) {
    return { erro: 'Escolha ao menos um arquivo.' };
  }

  let sessionId: string | undefined;
  let enviados = 0;

  for (const [indice, arquivo] of arquivos.entries()) {
    const ultimo = indice === arquivos.length - 1;
    const envio = new FormData();
    envio.append('file', arquivo);
    if (sessionId !== undefined) envio.append('reviewSessionId', sessionId);
    // Só o ÚLTIMO publica (ADR-039). Marcar todos faria o primeiro arquivo
    // confirmar a sessão sozinho, criando uma avaliação com um laudo só --
    // e os demais chegariam numa sessão já fechada.
    envio.append('ultimoDaSessao', ultimo ? 'true' : 'false');
    // O rotulo de origem e o nome do arquivo sem extensao: e o que o
    // avaliador reconhece na coluna "Origem" ao conferir contra o papel.
    envio.append('sourceLabel', arquivo.name.replace(/\.[^.]+$/, '').slice(0, 120));

    const resposta = await chamarApi<{ reviewSessionId: string }>(
      `/api/v1/students/${studentId}/assessment-imports`,
      { metodo: 'POST', formulario: envio },
    );

    if (!resposta.ok) {
      const detalhe = mensagemDe(resposta.erro?.code, 'Não foi possível enviar o arquivo.');

      return {
        erro:
          enviados === 0
            ? detalhe
            : `${detalhe} ${enviados} arquivo(s) já entraram na sessão e podem ser revisados.`,
        ...(sessionId === undefined ? {} : { sucesso: { sessionId, enviados } }),
      };
    }

    sessionId ??= resposta.dados?.reviewSessionId;
    enviados += 1;
  }

  if (sessionId === undefined) {
    return { erro: 'A API não devolveu a sessão de revisão.' };
  }

  revalidatePath(`/students/${studentId}/health`);

  return { sucesso: { sessionId, enviados } };
}
