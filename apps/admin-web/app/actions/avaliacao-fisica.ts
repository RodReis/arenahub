'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { chamarApi } from '../../lib/api/server-client';
import { MENSAGEM_DE_SESSAO } from '../../src/auth/mensagem-de-sessao';
import { calcularIndicadores, hojeEmBrasilia } from '../../src/health/indicadores';

/**
 * Ficha de avaliação física do professor — F91 (SPEC-091).
 *
 * Grava pelo fluxo que já existe (F17): rascunho → publicar (INV-102). A ficha
 * inteira — antropometria, pressão, FC de repouso e VO₂máx — vira UMA
 * `BodyAssessment`, então publicar leva tudo junto ou nada.
 *
 * MG, MLG e RCQ são RECALCULADOS aqui, e não aceitos da tela: o navegador é
 * quem digita os números, não quem decide a conta que vai para o histórico.
 */

const medida = z.number().finite().positive('Use valores maiores que zero.').nullable();

const esquemaDaFicha = z.object({
  studentId: z.string().uuid(),
  /** Rascunho em edição. Ausente = ficha nova. */
  assessmentId: z.string().uuid().optional(),
  assessedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data da avaliação'),
  notes: z.string().trim().max(2_000, 'Observação longa demais').optional(),
  publicar: z.boolean(),
  entradas: z.object({
    pesoKg: medida,
    estaturaCm: medida,
    cinturaCm: medida,
    quadrilCm: medida,
    gorduraPct: medida,
    pas: medida,
    pad: medida,
    fcRepouso: medida,
    vo2max: medida,
  }),
});

export type DadosDaFicha = z.input<typeof esquemaDaFicha>;

export type ResultadoDaFicha =
  | { ok: true; assessmentId: string; publicada: boolean }
  /** `assessmentId` presente quando o rascunho FOI salvo e só a publicação falhou. */
  | { ok: false; error: string; assessmentId?: string };

const MENSAGEM: Record<string, string> = {
  ...MENSAGEM_DE_SESSAO,
  VALIDATION_FAILED: 'Confira os valores digitados.',
  STUDENT_NOT_FOUND: 'Aluno não encontrado nesta academia.',
  HEALTH_INVALID_MEASUREMENT:
    'Algum valor está fora do possível para a medida — confira vírgula e unidade.',
  HEALTH_ASSESSMENT_IMMUTABLE: 'Esta avaliação já foi publicada e não aceita edição.',
  HEALTH_ASSESSMENT_NOT_FOUND: 'Rascunho não encontrado. Recarregue a ficha.',
  HEALTH_ASSESSMENT_EMPTY: 'Preencha ao menos uma medida antes de publicar.',
};

function frase(codigo: string, padrao: string): string {
  return MENSAGEM[codigo] ?? `${padrao} (${codigo || 'erro'}).`;
}

interface MedidaDaApi {
  type: string;
  value: number;
  unit: string | null;
}

/** Entradas + calculados que o histórico e o gráfico de evolução já sabem ler. */
function medidasDa(entradas: z.infer<typeof esquemaDaFicha>['entradas']): MedidaDaApi[] {
  const calculados = calcularIndicadores(entradas, { sexo: null, idade: null });

  const pares: [string, number | null, string | null][] = [
    ['WEIGHT', entradas.pesoKg, 'kg'],
    ['HEIGHT', entradas.estaturaCm, 'cm'],
    ['WAIST_CIRCUMFERENCE', entradas.cinturaCm, 'cm'],
    ['HIP_CIRCUMFERENCE', entradas.quadrilCm, 'cm'],
    ['BODY_FAT_PERCENT', entradas.gorduraPct, 'percent'],
    ['BODY_FAT_MASS', calculados.massaGorda.valor, 'kg'],
    ['LEAN_BODY_MASS', calculados.massaMagra.valor, 'kg'],
    ['WAIST_HIP_RATIO', calculados.rcq.valor, null],
    ['BLOOD_PRESSURE_SYSTOLIC', entradas.pas, null],
    ['BLOOD_PRESSURE_DIASTOLIC', entradas.pad, null],
    ['HEART_RATE', entradas.fcRepouso, null],
    ['VO2_MAX', entradas.vo2max, null],
  ];

  return pares
    .filter((par): par is [string, number, string | null] => par[1] !== null)
    .map(([type, value, unit]) => ({ type, value, unit }));
}

export async function salvarFicha(dados: DadosDaFicha): Promise<ResultadoDaFicha> {
  const lido = esquemaDaFicha.safeParse(dados);

  if (!lido.success) {
    return { ok: false, error: lido.error.issues[0]?.message ?? 'Confira os valores digitados.' };
  }

  const { studentId, assessmentId, assessedOn, notes, publicar, entradas } = lido.data;
  const { pas, pad } = entradas;

  // Pressão é par: uma metade só é leitura incompleta, e a ficha não a guarda.
  if ((pas === null) !== (pad === null)) {
    return { ok: false, error: 'Informe a pressão sistólica e a diastólica juntas.' };
  }

  // Sistólica é sempre a maior: igual ou menor é campo trocado, e publicada não se edita.
  if (pas !== null && pad !== null && pas <= pad) {
    return { ok: false, error: 'A sistólica precisa ser maior que a diastólica. Confira os campos.' };
  }

  if (assessedOn > hojeEmBrasilia()) {
    return { ok: false, error: 'A data da avaliação não pode ser no futuro.' };
  }

  const measurements = medidasDa(entradas);

  if (measurements.length === 0) {
    return { ok: false, error: 'Preencha ao menos uma medida.' };
  }

  // String vazia é intenção: apagar a observação do rascunho. `undefined` o PATCH ignoraria.
  const corpo = { notes: notes ?? '', measurements };

  /*
   * Meio-dia UTC: a data é o que o professor escolheu, e meio-dia UTC cai no
   * mesmo dia em qualquer fuso do Brasil. Meia-noite UTC viraria o dia
   * anterior no fuso da academia.
   */
  const salvo = assessmentId
    ? await chamarApi<{ id: string }>(`/api/v1/assessments/${assessmentId}/draft`, {
        metodo: 'PATCH',
        corpo,
      })
    : await chamarApi<{ id: string }>(`/api/v1/students/${studentId}/assessments`, {
        metodo: 'POST',
        corpo: { ...corpo, assessedAt: `${assessedOn}T12:00:00.000Z` },
      });

  if (!salvo.ok || !salvo.dados) {
    return { ok: false, error: frase(salvo.erro?.code ?? '', 'Não foi possível salvar a ficha') };
  }

  const id = salvo.dados.id;

  if (publicar) {
    const publicado = await chamarApi(`/api/v1/assessments/${id}/publish`, { metodo: 'POST' });

    revalidatePath(`/students/${studentId}/avaliacao`);

    if (!publicado.ok) {
      // O rascunho ficou salvo: dizer isso evita o professor digitar tudo de novo.
      return {
        ok: false,
        error: `Rascunho salvo, mas não publicado: ${frase(publicado.erro?.code ?? '', 'falha ao publicar')}`,
        assessmentId: id,
      };
    }
  }

  revalidatePath(`/students/${studentId}/avaliacao`);
  revalidatePath(`/students/${studentId}/health`);

  return { ok: true, assessmentId: id, publicada: publicar };
}
