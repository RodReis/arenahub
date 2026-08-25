import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { limparEstadoDaSessao } from './use-sessao.js';

describe('limpeza de sessao (M4-BR-006)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('esvazia sessionStorage e localStorage', () => {
    sessionStorage.setItem('nome', 'Aluno A');
    localStorage.setItem('cpf', '00000000191');

    limparEstadoDaSessao();

    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('limpa o clipboard quando a API existe', () => {
    const escrever = vi.fn().mockResolvedValue(undefined);

    Object.assign(navigator, { clipboard: { writeText: escrever } });

    limparEstadoDaSessao();

    expect(escrever).toHaveBeenCalledWith('');
  });

  /**
   * O clipboard e OPCIONAL no navegador (e o de quiosque pode nega-lo). Se
   * uma rejeicao dele derrubasse a limpeza, o encerramento pararia no meio
   * -- justamente com o storage ainda cheio, que e o que o aceite mede.
   */
  it('clipboard que rejeita nao impede a limpeza do storage', () => {
    sessionStorage.setItem('nome', 'Aluno A');

    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) },
    });

    expect(() => {
      limparEstadoDaSessao();
    }).not.toThrow();
    expect(sessionStorage.length).toBe(0);
  });

  it('funciona sem a API de clipboard', () => {
    sessionStorage.setItem('nome', 'Aluno A');

    Object.assign(navigator, { clipboard: undefined });

    expect(() => {
      limparEstadoDaSessao();
    }).not.toThrow();
    expect(sessionStorage.length).toBe(0);
  });
});
