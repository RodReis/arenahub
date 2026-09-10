import { resolverDiaLocal, resolverHoraLocal } from '@arenahub/access-policy';

export interface SituacaoDeCobranca {
  /** `null` quando nao ha fatura vencida. */
  readonly vencidaEm: Date | null;
  /** Ultimo instante de carencia: meia-noite do fim do prazo. `null` sem vencida. */
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

  // Fim da carencia: vencidaEm + graceDays dias, a meia-noite.
  const suspendeEm = new Date(vencidaEm);
  suspendeEm.setUTCDate(suspendeEm.getUTCDate() + graceDays);
  suspendeEm.setUTCHours(0, 0, 0, 0);

  // diasRestantes = Math.ceil((suspendeEm - agora) / 86_400_000)
  // "faltam 0 dias" = "fecha hoje", nao "ja fechou".
  const diasRestantes = Math.ceil((suspendeEm.getTime() - agora.getTime()) / 86_400_000);

  /*
   * A decisao compara DIAS LOCAIS, nunca instantes UTC.
   *
   * Comparar com a meia-noite UTC de `suspendeEm` erra o dia inteiro em todo
   * fuso negativo -- meia-noite UTC e 21h (Sao Paulo) ou 20h (Manaus) do dia
   * ANTERIOR local. O job diario roda as 00:00Z; com a comparacao em UTC ele
   * suspenderia a academia as 21h, aberta e cheia, um dia antes do prazo --
   * exatamente o que a janela das 6h (decisao D3 do PI) existe para evitar.
   *
   * A carencia so se esgota no DIA SEGUINTE ao fim do prazo, no fuso da
   * academia: quem vence hoje com `graceDays` 0 fecha amanha de manha, nunca
   * hoje a noite. Por isso `>`, e nao `>=`.
   *
   * Os dois lados leem o mesmo eixo de calendario, apesar de origens
   * diferentes: `dueAt` e uma DATA de vencimento gravada como meia-noite UTC,
   * entao a fatia UTC dela E a data pretendida -- converte-la para o fuso da
   * academia a jogaria para o dia anterior. Ja `agora` e um INSTANTE, e o dia
   * dele so existe depois de resolvido no fuso da academia.
   */
  const diaDoFimDaCarencia = suspendeEm.toISOString().slice(0, 10);
  const diaLocalDeAgora = resolverDiaLocal(agora, timezone);
  const carenciaEsgotada = diaLocalDeAgora > diaDoFimDaCarencia;

  // 6h locais = 360 minutos do dia.
  const horaLocal = resolverHoraLocal(agora, timezone);
  const jaPassouDas6hLocais = horaLocal.minuteOfDay >= 360;

  const deveSuspender = carenciaEsgotada && jaPassouDas6hLocais;

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
