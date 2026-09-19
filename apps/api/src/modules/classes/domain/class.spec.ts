import { describe, expect, it } from '@jest/globals';

import {
  GradeDeAulaInvalidaError,
  resolverOcorrencia,
  validarGrade,
  type Excecao,
  type GradeDeAula,
} from './class.js';

const GRADE_BASE: GradeDeAula = {
  dayOfWeek: 1,
  startMinute: 480,
  durationMinutes: 60,
  capacity: 20,
};

describe('validarGrade', () => {
  it('aceita grade valida', () => {
    expect(() => validarGrade(GRADE_BASE)).not.toThrow();
  });

  it('recusa dia da semana fora de 0..6', () => {
    expect(() => validarGrade({ ...GRADE_BASE, dayOfWeek: 7 })).toThrow(
      GradeDeAulaInvalidaError,
    );
  });

  it('recusa horario de inicio negativo', () => {
    expect(() => validarGrade({ ...GRADE_BASE, startMinute: -1 })).toThrow(
      GradeDeAulaInvalidaError,
    );
  });

  it('recusa duracao zero ou negativa', () => {
    expect(() => validarGrade({ ...GRADE_BASE, durationMinutes: 0 })).toThrow(
      GradeDeAulaInvalidaError,
    );
  });

  it('recusa capacidade zero ou negativa', () => {
    expect(() => validarGrade({ ...GRADE_BASE, capacity: 0 })).toThrow(
      GradeDeAulaInvalidaError,
    );
  });

  it('recusa aula que atravessa a virada do dia', () => {
    // 23:30 + 90min passaria de 24:00 -- vira o dia, e a spec so cobre
    // grade recorrente dentro de um unico dia da semana (mesma regra de
    // `PlanAccessWindow`, sem intervalo de fim menor que inicio).
    expect(() =>
      validarGrade({ ...GRADE_BASE, startMinute: 1410, durationMinutes: 90 }),
    ).toThrow(GradeDeAulaInvalidaError);
  });
});

describe('resolverOcorrencia', () => {
  const trainerDaGrade = '11111111-1111-1111-1111-111111111111';
  const trainerSubstituto = '22222222-2222-2222-2222-222222222222';
  const data = new Date('2026-09-21T00:00:00.000Z');

  it('sem excecao, devolve o professor da grade e ocorre normalmente', () => {
    const resolvida = resolverOcorrencia(trainerDaGrade, data, []);

    expect(resolvida).toEqual({ ocorre: true, trainerId: trainerDaGrade });
  });

  it('excecao de cancelamento no dia recusa a ocorrencia', () => {
    const excecoes: Excecao[] = [
      { occurrenceDate: data, type: 'CANCELLED', overrideTrainerId: null },
    ];

    const resolvida = resolverOcorrencia(trainerDaGrade, data, excecoes);

    expect(resolvida).toEqual({ ocorre: false, trainerId: null });
  });

  it('excecao de troca de professor no dia substitui so aquele dia', () => {
    const excecoes: Excecao[] = [
      {
        occurrenceDate: data,
        type: 'TRAINER_OVERRIDE',
        overrideTrainerId: trainerSubstituto,
      },
    ];

    const resolvida = resolverOcorrencia(trainerDaGrade, data, excecoes);

    expect(resolvida).toEqual({ ocorre: true, trainerId: trainerSubstituto });
  });

  it('excecao de outro dia nao afeta a ocorrencia consultada', () => {
    const outroDia = new Date('2026-09-22T00:00:00.000Z');
    const excecoes: Excecao[] = [
      { occurrenceDate: outroDia, type: 'CANCELLED', overrideTrainerId: null },
    ];

    const resolvida = resolverOcorrencia(trainerDaGrade, data, excecoes);

    expect(resolvida).toEqual({ ocorre: true, trainerId: trainerDaGrade });
  });
});
