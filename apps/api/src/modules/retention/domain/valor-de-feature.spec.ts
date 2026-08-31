import { describe, expect, it } from '@jest/globals';

import { ausente, completude, observado } from './valor-de-feature.js';

describe('valor de feature', () => {
  /*
   * `M6-BR-002` e o PRD §9: "feature ausente e marcada como ausente, nao
   * zero". Se estes dois colapsarem, o aluno que se matriculou ontem herda o
   * risco de quem faltou o mes inteiro, e a fila liga para o recem-chegado.
   */
  it('mantem ausente distinto de zero observado', () => {
    const zero = observado('attendance_days_30d', 0);
    const semDado = ausente('attendance_days_30d', 'SEM_HISTORICO');

    expect(zero).not.toEqual(semDado);
    expect(zero.valor).toBe(0);
    expect(semDado.valor).toBeNull();
  });

  it('exige razao em todo valor ausente e nenhuma no presente', () => {
    expect(ausente('days_past_due', 'FONTE_INDISPONIVEL').razao).toBe('FONTE_INDISPONIVEL');
    expect(observado('days_past_due', 3).razao).toBeNull();
  });

  it('marca AS_OF por padrao e ESTADO_CORRENTE so quando declarado', () => {
    /*
     * A marca que a decisao do PI de 31/08/2026 exige: o default e o caminho
     * seguro, e a excecao precisa ser escrita a mao. Invertido, uma feature
     * nova nasceria suspeita por esquecimento.
     */
    expect(observado('attendance_days_7d', 2).procedencia).toBe('AS_OF');
    expect(observado('payment_failure_count_90d', 1, 'ESTADO_CORRENTE').procedencia).toBe(
      'ESTADO_CORRENTE',
    );
    expect(ausente('payment_failure_count_90d', 'SEM_HISTORICO', 'ESTADO_CORRENTE').procedencia).toBe(
      'ESTADO_CORRENTE',
    );
  });
});

describe('completude', () => {
  it('e a fracao de features observadas', () => {
    const valores = [
      observado('a', 1),
      observado('b', 0),
      ausente('c', 'SEM_HISTORICO'),
      ausente('d', 'FONTE_INDISPONIVEL'),
    ];

    // Zero OBSERVADO conta como presente -- e um fato, nao uma lacuna.
    expect(completude(valores)).toBe(0.5);
  });

  it('vale 1 quando tudo foi observado', () => {
    expect(completude([observado('a', 1), observado('b', 2)])).toBe(1);
  });

  it('vale 0 sem features, em vez de NaN', () => {
    /*
     * Divisao por zero viraria `NaN`, que contamina toda media do dashboard
     * em silencio: `NaN` nao lanca, nao compara e se propaga.
     */
    expect(completude([])).toBe(0);
    expect(Number.isNaN(completude([]))).toBe(false);
  });
});
