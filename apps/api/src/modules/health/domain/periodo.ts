/**
 * Periodo do grafico de historico (`M3-FR-008`).
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" e o fuso da
 * unidade entram por parametro.
 *
 * O corte cai na MEIA-NOITE LOCAL da unidade, nao no instante da consulta.
 * Cortar pelo instante faria a avaliacao da manha do trigesimo dia entrar ou
 * sair conforme a hora em que o aluno abriu a tela -- o mesmo grafico
 * mudaria de conteudo sozinho ao longo do dia, e o aceite da Slice 3.2 exige
 * o oposto ("os mesmos dados sempre geram o mesmo comparativo").
 */

/** Os cinco periodos do `M3-FR-008`. */
export const PERIODOS = ['30D', '90D', '6M', '1Y', 'ALL'] as const;

export type Periodo = (typeof PERIODOS)[number];

export function ehPeriodo(valor: string): valor is Periodo {
  return (PERIODOS as readonly string[]).includes(valor);
}

/** Quanto recuar em cada periodo, na unidade em que o aluno pensa. */
const RECUO: Readonly<Record<Exclude<Periodo, 'ALL'>, { dias?: number; meses?: number }>> = {
  '30D': { dias: 30 },
  '90D': { dias: 90 },
  // Meses de CALENDARIO, nao 180 dias: "6 meses" para o aluno e "20 de
  // fevereiro", nao "algum dia perto de fevereiro".
  '6M': { meses: 6 },
  '1Y': { meses: 12 },
};

/**
 * Data local (ano, mes, dia) de um instante, no fuso pedido.
 *
 * `Intl.DateTimeFormat` usa a base IANA do runtime em vez de aritmetica de
 * offset -- offset fixo erraria em todo pais com horario de verao, e o
 * ADR-019 ja exige fuso da unidade sem fallback.
 */
function dataLocal(instante: Date, fuso: string): { ano: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);

  const buscar = (tipo: string): number =>
    Number(partes.find((p) => p.type === tipo)?.value ?? Number.NaN);

  return { ano: buscar('year'), mes: buscar('month'), dia: buscar('day') };
}

/**
 * A DATA local de um instante, como `AAAA-MM-DD`.
 *
 * Serve ao rotulo do eixo do grafico: o painel nao pode formatar data por
 * conta propria (regra 5 de lint reserva isso ao `TenantDateTime`, que
 * renderiza `<time>` e nao cabe dentro de um SVG), entao o servidor -- que ja
 * conhece o fuso da unidade -- entrega o dia pronto.
 *
 * `en-CA` porque o locale canadense JA formata em `AAAA-MM-DD`: montar a
 * string por concatenacao exigiria zero-padding manual, que e onde este tipo
 * de codigo costuma errar em janeiro.
 */
export function dataLocalIso(instante: Date, fuso: string): string {
  const { ano, mes, dia } = dataLocal(instante, fuso);

  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Ultimo dia do mes -- fevereiro tem 28 ou 29, e nenhum mes tem 31 sempre. */
function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * O instante UTC da meia-noite local de uma data, no fuso pedido.
 *
 * Nao existe formula fechada: o offset do fuso naquela data e justamente o
 * que queremos descobrir. Entao chutamos a meia-noite em UTC, perguntamos
 * que hora local aquilo e, e corrigimos pela diferenca. Uma correcao basta
 * para todo offset real (todos abaixo de 24h).
 */
function meiaNoiteLocalEmUtc(ano: number, mes: number, dia: number, fuso: string): Date {
  const chute = Date.UTC(ano, mes - 1, dia, 0, 0, 0, 0);

  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(chute));

  const buscar = (tipo: string): number =>
    Number(partes.find((p) => p.type === tipo)?.value ?? Number.NaN);

  // `hour12: false` produz "24" para meia-noite em alguns runtimes.
  const comoUtc = Date.UTC(
    buscar('year'),
    buscar('month') - 1,
    buscar('day'),
    buscar('hour') % 24,
    buscar('minute'),
    buscar('second'),
  );

  return new Date(chute + (chute - comoUtc));
}

/**
 * Instante a partir do qual as avaliacoes entram no grafico.
 *
 * `ALL` devolve `null` -- ausencia de corte, nao `new Date(0)`: uma data de
 * 1970 seria um corte de verdade, e o repositorio filtraria por ela sem
 * necessidade.
 *
 * Recusa fuso invalido em vez de cair num padrao: sem fuso valido nao ha
 * meia-noite definida, e assumir UTC produziria um corte errado e silencioso
 * (ADR-019, fuso da unidade SEM fallback).
 */
export function inicioDoPeriodo(periodo: Periodo, agora: Date, fuso: string): Date | null {
  if (periodo === 'ALL') {
    return null;
  }

  // `Intl` aceita fuso invalido em algumas versoes e lanca em outras; a
  // checagem explicita torna o comportamento o mesmo em qualquer runtime.
  if (!Intl.supportedValuesOf('timeZone').includes(fuso)) {
    throw new RangeError(`fuso horario desconhecido: ${fuso}`);
  }

  const hoje = dataLocal(agora, fuso);
  const recuo = RECUO[periodo];

  if (recuo.dias !== undefined) {
    // Aritmetica em UTC so para achar a DATA -- o instante sai da meia-noite
    // local logo abaixo.
    const alvo = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia - recuo.dias));

    return meiaNoiteLocalEmUtc(
      alvo.getUTCFullYear(),
      alvo.getUTCMonth() + 1,
      alvo.getUTCDate(),
      fuso,
    );
  }

  const meses = recuo.meses ?? 0;
  const alvo = new Date(Date.UTC(hoje.ano, hoje.mes - 1 - meses, 1));
  const ano = alvo.getUTCFullYear();
  const mes = alvo.getUTCMonth() + 1;

  // 31 de agosto menos 6 meses nao e "31 de fevereiro": sem esta trava a data
  // transbordaria para marco e o periodo ficaria mais curto que o pedido.
  const dia = Math.min(hoje.dia, ultimoDiaDoMes(ano, mes));

  return meiaNoiteLocalEmUtc(ano, mes, dia, fuso);
}
