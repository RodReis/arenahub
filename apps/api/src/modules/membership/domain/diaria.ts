import { inicioDoDiaLocal } from '../../health/domain/periodo.js';
import { momentoLocal, type JanelaDeAcesso } from './plan.js';

/**
 * Funcoes puras da diaria avulsa (F86): sem banco, sem relogio -- o "agora"
 * entra por parametro (`CLAUDE.md`).
 */

const UMA_HORA_EM_MS = 3_600_000;

/**
 * O FIM da diaria: 00:00 local do dia seguinte, EXCLUSIVO (igual a
 * `Entitlement.endsAt`: o direito vale ate o instante, nao nele). Dito para
 * humano: "ate 23:59".
 *
 * Reusa `inicioDoDiaLocal` -- unico lugar que sabe converter fuso em meia-noite
 * -- e nao refaz aritmetica de offset. 36h depois da meia-noite de hoje cai
 * SEMPRE no meio do dia seguinte, mesmo num fuso com salto de horario de verao
 * na virada; dai a meia-noite local daquele dia e a do dia seguinte ao de hoje.
 *
 * Fuso invalido LANCA (herdado de `inicioDoDiaLocal`, ADR-019: sem fallback).
 */
export function fimDaDiaria(agora: Date, fuso: string): Date {
  const meiaNoiteDeHoje = inicioDoDiaLocal(agora, fuso);

  return inicioDoDiaLocal(new Date(meiaNoiteDeHoje.getTime() + 36 * UMA_HORA_EM_MS), fuso);
}

/**
 * Existe, na unidade, alguma janela do plano que ainda cobre um pedaco de hoje
 * (do minuto atual ate a meia-noite)? So o dia e o fim importam: o aluno pode
 * chegar antes da abertura, e e a janela quem decide, na catraca, se ele passa.
 *
 * Recusar a venda aqui evita cobrar R$ 30,00 de quem a catraca vai negar
 * (domingo com plano seg-sex, ou depois do fechamento).
 */
export function haJanelaAteOFimDoDia(
  agora: Date,
  fuso: string,
  gymUnitId: string,
  janelas: readonly JanelaDeAcesso[],
): boolean {
  const { dayOfWeek, minute } = momentoLocal(agora, fuso);

  return janelas.some(
    (j) => j.gymUnitId === gymUnitId && j.dayOfWeek === dayOfWeek && j.endMinute > minute,
  );
}
