/** Avaliação como `GET /students/:id/assessments` devolve — só o que a ficha lê. */
export interface AvaliacaoDaApi {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  assessedAt: string;
  notes: string | null;
  supersedesAssessmentId: string | null;
  measurements: { type: string; canonicalValue: number }[];
}

/**
 * Medidas por tipo, no valor CANÔNICO (kg, cm, %).
 *
 * Não o original: avaliação gravada pela API ou importada pode ter vindo em
 * lb ou m, e altura 1,75 lida como centímetro faria o IMC dar "obesidade grau
 * III" em silêncio (revisão da F91).
 */
export function medidasPorTipo(avaliacao: AvaliacaoDaApi): Record<string, number> {
  return Object.fromEntries(avaliacao.measurements.map((m) => [m.type, m.canonicalValue]));
}

/**
 * As fichas publicadas que contam na série, da mais antiga para a mais recente.
 *
 * A original corrigida continua PUBLISHED (INV-102), mas na série quem vale é a
 * correção PUBLICADA — a mesma regra da evolução corporal. Sem isto o número
 * errado e o certo apareceriam lado a lado, e a variação seguinte seria
 * calculada contra o errado. Correção ainda em rascunho não substitui nada.
 */
export function serieDoHistorico(avaliacoes: readonly AvaliacaoDaApi[]): AvaliacaoDaApi[] {
  const publicadas = avaliacoes.filter((a) => a.status === 'PUBLISHED');
  const corrigidas = new Set(publicadas.flatMap((a) => a.supersedesAssessmentId ?? []));

  return publicadas
    .filter((a) => !corrigidas.has(a.id))
    .sort((a, b) => a.assessedAt.localeCompare(b.assessedAt));
}
