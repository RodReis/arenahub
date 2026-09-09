import { resolverHoraLocal } from '@arenahub/access-policy';

export interface SituacaoDeCobranca {
  /** `null` quando nao ha fatura vencida. */
  readonly vencidaEm: Date | null;
  /** Instante em que o gate fecha. `null` quando nao ha vencida. */
  readonly suspendeEm: Date | null;
  /** Dias inteiros que faltam. Negativo depois de esgotada; `null` sem vencida. */
  readonly diasRestantes: number | null;
  /** Soma das faturas vencidas, na menor unidade monetaria. */
  readonly emAbertoMinor: number;
  /** Carencia esgotada E ja passou das 6h locais. */
  readonly deveSuspender: boolean;
}

/**
 * Calcula quantos dias faltam para o gate de tenant fechar a catraca,
 * a partir das faturas vencidas da plataforma.
 *
 * Funcao pura: sem banco, sem relogio proprio. O "agora" entra por parametro.
 *
 * @param entrada Entrada com faturas vencidas, grace period, instante atual e timezone
 * @returns Situacao de cobranca com decisao sobre suspensao
 */
export function avaliarCarencia(entrada: {
  readonly faturasVencidas: readonly { readonly dueAt: Date; readonly totalMinor: number }[];
  readonly graceDays: number;
  readonly agora: Date;
  readonly timezone: string;
}): SituacaoDeCobranca {
  const { faturasVencidas, graceDays, agora, timezone } = entrada;

  // Sem faturas vencidas, retornar estado limpo.
  if (faturasVencidas.length === 0) {
    return {
      vencidaEm: null,
      suspendeEm: null,
      diasRestantes: null,
      emAbertoMinor: 0,
      deveSuspender: false,
    };
  }

  // Encontrar a fatura MAIS ANTIGA (vencidaEm).
  const vencidaEm = faturasVencidas.reduce((maisAntiga, fatura) => {
    return fatura.dueAt < maisAntiga.dueAt ? fatura : maisAntiga;
  }).dueAt;

  // Calcular suspendeEm: vencidaEm + graceDays dias, com ajuste especial para graceDays=0.
  // Quando graceDays=0, adiciona mais 1 dia para garantir que a suspensao seja no DIA
  // SEGUINTE ao vencimento (nunca no dia do vencimento). A suspensao so vale apos as
  // 6h locais (decisao D3 do PI).
  const efetivoDays = graceDays === 0 ? 1 : graceDays;
  const suspendeEm = new Date(vencidaEm);
  suspendeEm.setUTCDate(suspendeEm.getUTCDate() + efetivoDays);
  suspendeEm.setUTCHours(0, 0, 0, 0);

  // diasRestantes = Math.ceil((suspendeEm - agora) / 86_400_000)
  // "faltam 0 dias" = "fecha hoje", nao "ja fechou".
  const diasRestantes = Math.ceil((suspendeEm.getTime() - agora.getTime()) / 86_400_000);

  // Resolver a hora local da academia.
  const horaLocal = resolverHoraLocal(agora, timezone);
  // 6h locais = 360 minutos do dia.
  const jaPassouDas6hLocais = horaLocal.minuteOfDay >= 360;

  // Suspender se: carencia esgotada (diasRestantes <= 0) AND ja passou das 6h locais.
  const deveSuspender = diasRestantes <= 0 && jaPassouDas6hLocais;

  // Somar TODAS as faturas vencidas.
  const emAbertoMinor = faturasVencidas.reduce((soma, fatura) => soma + fatura.totalMinor, 0);

  return {
    vencidaEm,
    suspendeEm,
    diasRestantes,
    emAbertoMinor,
    deveSuspender,
  };
}
