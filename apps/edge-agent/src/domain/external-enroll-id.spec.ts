import { describe, expect, it } from '@jest/globals';

import {
  ExternalEnrollIdInvalidoError,
  ehExternalEnrollIdValido,
  gerarExternalEnrollId,
  validarExternalEnrollId,
} from './external-enroll-id.js';

describe('gerarExternalEnrollId', () => {
  it('gera identificador valido', () => {
    expect(ehExternalEnrollIdValido(gerarExternalEnrollId())).toBe(true);
  });

  it('nao repete', () => {
    // Colisao no dispositivo faria uma pessoa abrir a catraca no lugar de
    // outra. O aceite da Slice 0.2 exige "sem colisao".
    const gerados = new Set(Array.from({ length: 1000 }, gerarExternalEnrollId));

    expect(gerados.size).toBe(1000);
  });
});

describe('validarExternalEnrollId — a regra do CPF', () => {
  // A Slice 0.2 exige: externalEnrollId NAO derivado do CPF. Derivar
  // transformaria o dispositivo num oraculo -- com a base de CPFs e o mesmo
  // algoritmo, qualquer um confirma quem esta cadastrado.

  it('recusa CPF cru', () => {
    expect(() => validarExternalEnrollId('12345678901')).toThrow(ExternalEnrollIdInvalidoError);
  });

  it('recusa CPF mascarado', () => {
    expect(() => validarExternalEnrollId('123.456.789-01')).toThrow(ExternalEnrollIdInvalidoError);
  });

  it('recusa CPF escondido no meio de outra coisa', () => {
    expect(() => validarExternalEnrollId('user-12345678901')).toThrow(
      ExternalEnrollIdInvalidoError,
    );
  });

  it('a mensagem diz o que fazer, nao so o que esta errado', () => {
    try {
      validarExternalEnrollId('12345678901');
      throw new Error('deveria ter falhado');
    } catch (erro: unknown) {
      expect((erro as Error).message).toContain('gerarExternalEnrollId');
    }
  });

  it('recusa vazio', () => {
    expect(() => validarExternalEnrollId('')).toThrow(ExternalEnrollIdInvalidoError);
  });

  it('recusa formato fora do esperado', () => {
    expect(() => validarExternalEnrollId('abc')).toThrow(ExternalEnrollIdInvalidoError);
    expect(() => validarExternalEnrollId('X'.repeat(32))).toThrow(ExternalEnrollIdInvalidoError);
  });

  it('aceita TODO id que o proprio gerador produz', () => {
    // REGRESSAO. A primeira versao do filtro de CPF recusava 5,65% dos ids
    // legitimos: `\d{3}\.?\d{3}\.?\d{3}-?\d{2}` sem ancora casa 11 digitos
    // seguidos em qualquer posicao, e num hexadecimal de 32 caracteres isso
    // acontece o tempo todo.
    //
    // O teste antigo gerava UM id -- entao tinha 5,65% de chance de falhar
    // sozinho no CI, com cara de flakiness em vez de bug. Por isso este roda
    // em lote: 5.000 ids, e qualquer recusa e falha determinista.
    const recusados: string[] = [];

    for (let i = 0; i < 5000; i += 1) {
      const id = gerarExternalEnrollId();
      try {
        validarExternalEnrollId(id);
      } catch {
        recusados.push(id);
      }
    }

    expect(recusados).toEqual([]);
  });

  it('nao confunde hexadecimal com CPF so porque tem digitos', () => {
    // O alfabeto hex e majoritariamente digito. Suspeitar de qualquer
    // sequencia numerica dentro dele torna o filtro inutil.
    expect(() => validarExternalEnrollId('12345678901abcdef0123456789abcde')).not.toThrow();
  });
});
