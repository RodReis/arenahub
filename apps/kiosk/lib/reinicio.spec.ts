import { describe, expect, it } from 'vitest';

import { decidirReinicio } from './reinicio.js';

describe('decidirReinicio', () => {
  it('versao igual: nada acontece', () => {
    expect(decidirReinicio({ versaoDoBoot: 3, versaoAtual: 3, emSessao: false })).toBe('nada');
  });

  it('versao diferente e SEM sessao: reinicia', () => {
    expect(decidirReinicio({ versaoDoBoot: 3, versaoAtual: 4, emSessao: false })).toBe(
      'reiniciar',
    );
  });

  it('versao diferente e COM sessao: aguarda o encerramento', () => {
    expect(decidirReinicio({ versaoDoBoot: 3, versaoAtual: 4, emSessao: true })).toBe('aguardar');
  });

  it('versao do boot ainda desconhecida: nada -- nao reinicia por nao saber', () => {
    expect(decidirReinicio({ versaoDoBoot: null, versaoAtual: 4, emSessao: false })).toBe('nada');
  });

  it('versao que RECUOU tambem reinicia -- despublicacao muda a config efetiva', () => {
    expect(decidirReinicio({ versaoDoBoot: 5, versaoAtual: 4, emSessao: false })).toBe(
      'reiniciar',
    );
  });
});
