import { describe, expect, it } from '@jest/globals';

import { autorizarCorrecao, TETO_ILIMITADO } from './correcao.js';

describe('autorizarCorrecao', () => {
  it('autoriza correcao dentro do teto', () => {
    expect(() => autorizarCorrecao({ pontos: 50, teto: 100 })).not.toThrow();
  });

  it('autoriza correcao exatamente no teto -- o limite e inclusivo', () => {
    // Teto de 100 significa "ate 100", nao "menos de 100". Exclusivo faria a
    // secretaria digitar 99 para corrigir 100, e ninguem entende por que.
    expect(() => autorizarCorrecao({ pontos: 100, teto: 100 })).not.toThrow();
  });

  it('RECUSA acima do teto, nunca enfileira para aprovacao', () => {
    // ADR-049, Decisao 2: nao existe segundo ator. Acima do teto e erro de
    // dominio, nao pedido pendente.
    expect(() => autorizarCorrecao({ pontos: 101, teto: 100 })).toThrow(
      'CORRECAO_ACIMA_DO_TETO',
    );
  });

  it('o teto vale para o VALOR ABSOLUTO -- tirar 500 pontos e tao grave quanto dar 500', () => {
    // O canario da fatia. Comparar `pontos > teto` sem `Math.abs` deixaria
    // qualquer correcao NEGATIVA passar por qualquer teto: -5000 > 100 e
    // falso. Zerar o saldo de um aluno passaria calado.
    expect(() => autorizarCorrecao({ pontos: -101, teto: 100 })).toThrow(
      'CORRECAO_ACIMA_DO_TETO',
    );
    expect(() => autorizarCorrecao({ pontos: -100, teto: 100 })).not.toThrow();
  });

  it('teto nulo significa sem teto, nao teto zero', () => {
    // `null` e "esta academia nao configurou limite". Tratar como 0 barraria
    // toda correcao num tenant que nunca mexeu na configuracao -- ou seja,
    // em todos eles, ja que a coluna nasce nula.
    expect(() => autorizarCorrecao({ pontos: 99999, teto: TETO_ILIMITADO })).not.toThrow();
    expect(() => autorizarCorrecao({ pontos: -99999, teto: TETO_ILIMITADO })).not.toThrow();
  });

  it('teto zero barra qualquer correcao diferente de zero', () => {
    // Zero e configuracao legitima e distinta de nulo: "ninguem corrige XP
    // nesta academia".
    expect(() => autorizarCorrecao({ pontos: 1, teto: 0 })).toThrow('CORRECAO_ACIMA_DO_TETO');
    expect(() => autorizarCorrecao({ pontos: -1, teto: 0 })).toThrow('CORRECAO_ACIMA_DO_TETO');
  });

  it('recusa correcao de zero pontos -- movimento que nao move', () => {
    // Gravaria uma linha no ledger append-only que nao muda saldo nenhum, e
    // ela nunca poderia ser apagada.
    expect(() => autorizarCorrecao({ pontos: 0, teto: 100 })).toThrow('CORRECAO_SEM_EFEITO');
  });

  it('recusa pontuacao fracionada -- XP e inteiro', () => {
    expect(() => autorizarCorrecao({ pontos: 1.5, teto: 100 })).toThrow('CORRECAO_NAO_INTEIRA');
  });
});
