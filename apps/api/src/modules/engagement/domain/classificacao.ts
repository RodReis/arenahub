/**
 * Classificacao do placar -- DETERMINISTICA, nunca sorteio.
 *
 * `M5-BR-008`: "empate usa criterio estavel publicado; sorteio nao ocorre
 * silenciosamente". Os tres criterios, nesta ordem:
 *
 *   1. mais XP;
 *   2. quem atingiu primeiro (`lastEntryAt` ascendente) -- premia
 *      consistencia, nao o acaso;
 *   3. `studentId`, o unico criterio que nunca empata.
 *
 * O criterio 3 existe porque `Array.prototype.sort` so garante estabilidade
 * em relacao a ORDEM DE ENTRADA, e a ordem de entrada aqui e a ordem que o
 * Postgres devolveu -- que muda depois de um UPDATE. Sem ele, dois alunos
 * totalmente empatados trocariam de lugar entre duas leituras sem que nada
 * tivesse acontecido.
 *
 * PURA: sem banco, sem relogio. Nao muta a entrada.
 */

export interface SaldoParaClassificar {
  studentId: string;
  points: number;
  lastEntryAt: Date;
}

export interface PosicaoNoPlacar {
  position: number;
  studentId: string;
  points: number;
  lastEntryAt: Date;
}

export function classificar(
  saldos: readonly SaldoParaClassificar[],
): readonly PosicaoNoPlacar[] {
  return [...saldos]
    .sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points;

      const tempo = a.lastEntryAt.getTime() - b.lastEntryAt.getTime();
      if (tempo !== 0) return tempo;

      return a.studentId.localeCompare(b.studentId);
    })
    .map((saldo, indice) => ({
      position: indice + 1,
      studentId: saldo.studentId,
      points: saldo.points,
      lastEntryAt: saldo.lastEntryAt,
    }));
}
