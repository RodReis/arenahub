import { inicioDoDiaLocal } from '../../health/domain/periodo.js';

/**
 * A hora em que o "dia" do painel de operação vira -- decisão do PI,
 * 04/10/2026 (issue #549): **23h, quando a academia fecha**.
 *
 * Antes o corte era meia-noite UTC, ou seja, 21h em Brasília: a "Taxa do dia"
 * zerava com a academia ainda aberta, e o avaliador de alertas comparava a
 * taxa de sincronização de um dia que não era o da recepção.
 */
export const HORA_DE_VIRADA_DO_DIA = 23;

const UMA_HORA_MS = 3_600_000;
const ANTECIPACAO_MS = (24 - HORA_DE_VIRADA_DO_DIA) * UMA_HORA_MS;

/**
 * O instante UTC em que o dia operacional da unidade COMEÇOU: a última vez
 * que o relógio da unidade marcou 23h.
 *
 * Reusa `inicioDoDiaLocal` em vez de refazer a aritmética de fuso: avança o
 * relógio até a meia-noite seguinte à virada, pega o início daquele dia local
 * e volta o mesmo tanto. Às 23h30 isso dá as 23h de hoje; às 10h, as 23h de
 * ontem.
 *
 * ponytail: deslocamento fixo em horas; num fuso com horário de verão que
 * mudasse exatamente à meia-noite o corte sairia uma hora fora no dia da
 * troca. O Brasil não tem horário de verão desde 2019 -- se uma unidade
 * entrar num fuso que tenha, trocar por `meiaNoiteLocalEmUtc` com a hora.
 *
 * Fuso inválido LANÇA, herdado de `inicioDoDiaLocal` (ADR-019: sem fallback).
 */
export function inicioDoDiaOperacional(agora: Date, fuso: string): Date {
  const meiaNoiteSeguinte = inicioDoDiaLocal(new Date(agora.getTime() + ANTECIPACAO_MS), fuso);

  return new Date(meiaNoiteSeguinte.getTime() - ANTECIPACAO_MS);
}
