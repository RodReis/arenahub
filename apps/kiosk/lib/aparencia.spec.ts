import { describe, expect, it } from 'vitest';

import { contrasteEfetivo } from './aparencia.js';

describe('precedencia do alto contraste (ADR-042, Decisao 6)', () => {
  it('sem escolha do aluno, vale o padrao da unidade', () => {
    expect(contrasteEfetivo(null, false)).toBe(false);
    expect(contrasteEfetivo(null, true)).toBe(true);
  });

  /**
   * O caso que a Decisao 6 existe para garantir: a unidade desligou, o aluno
   * ligou. Quem esta na frente do totem vence.
   */
  it('o aluno LIGANDO vence a unidade desligada', () => {
    expect(contrasteEfetivo(true, false)).toBe(true);
  });

  it('o aluno DESLIGANDO vence a unidade ligada', () => {
    expect(contrasteEfetivo(false, true)).toBe(false);
  });
});
