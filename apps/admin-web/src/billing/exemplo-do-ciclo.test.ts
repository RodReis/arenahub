import { describe, expect, it } from 'vitest';

import { exemploDoCiclo } from './exemplo-do-ciclo';

describe('exemploDoCiclo', () => {
  it('padrao 1/10/5 em novembro de 2026', () => {
    expect(exemploDoCiclo({ invoiceGenerationDay: 1, dueDay: 10, graceDays: 5 }, { ano: 2026, mes: 11 })).toEqual({
      competencia: 'nov/26', gerada: '01/11', vence: '10/11', bloqueia: '15/11',
    });
  });
  it('bloqueio que passa do fim do mes cai no mes seguinte', () => {
    expect(exemploDoCiclo({ invoiceGenerationDay: 1, dueDay: 28, graceDays: 5 }, { ano: 2026, mes: 11 }).bloqueia).toBe('03/12');
  });
  it('virada de ano', () => {
    expect(exemploDoCiclo({ invoiceGenerationDay: 1, dueDay: 28, graceDays: 10 }, { ano: 2026, mes: 12 }).bloqueia).toBe('07/01');
  });
});
