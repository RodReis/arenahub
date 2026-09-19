import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';
import { MINUTOS_POR_DIA } from '../../membership/domain/plan.js';

/**
 * Grade de aula e resolucao de ocorrencia -- F77 (SPEC-077, ADR-061).
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora"/a data
 * entram por parametro.
 *
 * NAO DECIDE ACESSO. A catraca nao consulta nada deste arquivo -- ADR-061
 * decisao no 2. Ele so resolve "esta aula ocorre neste dia, e com qual
 * professor", para a tela mostrar a semana.
 */

export interface GradeDeAula {
  /** 0 = domingo ... 6 = sabado, mesmo eixo de `PlanAccessWindow` (#129). */
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
}

export class GradeDeAulaInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('CLASS_SCHEDULE_INVALID', 422, motivo);
  }
}

/**
 * Valida a grade recorrente.
 *
 * Mesma disciplina de `validarJanelaIsolada` (`membership/domain/plan.ts`):
 * a aula nao pode atravessar a virada do dia -- `startMinute +
 * durationMinutes` tem de caber no mesmo dia da semana. Aula 23h-01h entraria
 * como caso especial que ninguem pediu; a recepcao cadastra como duas linhas
 * se precisar.
 */
export function validarGrade(grade: GradeDeAula): void {
  if (!Number.isInteger(grade.dayOfWeek) || grade.dayOfWeek < 0 || grade.dayOfWeek > 6) {
    throw new GradeDeAulaInvalidaError('dia da semana deve estar entre 0 e 6 (0 = domingo)');
  }

  if (!Number.isInteger(grade.startMinute) || grade.startMinute < 0) {
    throw new GradeDeAulaInvalidaError('horario de inicio deve ser inteiro de minutos, >= 0');
  }

  if (!Number.isInteger(grade.durationMinutes) || grade.durationMinutes <= 0) {
    throw new GradeDeAulaInvalidaError('duracao deve ser inteiro de minutos, maior que zero');
  }

  if (!Number.isInteger(grade.capacity) || grade.capacity <= 0) {
    throw new GradeDeAulaInvalidaError('capacidade deve ser inteiro maior que zero');
  }

  if (grade.startMinute + grade.durationMinutes > MINUTOS_POR_DIA) {
    throw new GradeDeAulaInvalidaError(
      'aula nao pode atravessar a virada do dia; cadastre como duas linhas de grade',
    );
  }
}

export type TipoDeExcecao = 'CANCELLED' | 'TRAINER_OVERRIDE';

export interface Excecao {
  occurrenceDate: Date;
  type: TipoDeExcecao;
  /** So preenchido quando `type === 'TRAINER_OVERRIDE'`. */
  overrideTrainerId: string | null;
}

export interface OcorrenciaResolvida {
  ocorre: boolean;
  trainerId: string | null;
}

/**
 * Resolve a ocorrencia de UM dia: aplica a excecao daquele dia sobre a
 * grade, se existir.
 *
 * `data` e comparada por dia de calendario (`toDateString`), nao por
 * instante exato: a exceção e "o feriado de 21/09", nao um timestamp preciso,
 * e comparar `Date` por igualdade estrita quebraria com qualquer diferenca
 * de hora entre o que foi salvo e o que foi consultado.
 */
export function resolverOcorrencia(
  trainerIdDaGrade: string | null,
  data: Date,
  excecoes: readonly Excecao[],
): OcorrenciaResolvida {
  const doDia = excecoes.find((e) => e.occurrenceDate.toDateString() === data.toDateString());

  if (!doDia) return { ocorre: true, trainerId: trainerIdDaGrade };

  if (doDia.type === 'CANCELLED') return { ocorre: false, trainerId: null };

  return { ocorre: true, trainerId: doDia.overrideTrainerId };
}
