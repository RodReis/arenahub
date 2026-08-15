import { describe, expect, it } from '@jest/globals';

import {
  ENROLL_ID_MAXIMO,
  ENROLL_ID_MINIMO,
  ExternalEnrollIdInvalidoError,
  ehExternalEnrollIdValido,
  gerarExternalEnrollId,
  validarExternalEnrollId,
} from './external-enroll-id.js';

describe('gerarExternalEnrollId', () => {
  it('gera identificador valido', () => {
    expect(ehExternalEnrollIdValido(gerarExternalEnrollId())).toBe(true);
  });

  it('gera sempre 12 digitos, dentro da faixa do equipamento', () => {
    // Tamanho fixo mantem log e tela do equipamento legiveis, e o piso alto
    // evita colidir com os numeros baixos que o software de fabrica usa.
    for (let i = 0; i < 500; i += 1) {
      const id = gerarExternalEnrollId();
      expect(id).toHaveLength(12);
      expect(Number(id)).toBeGreaterThanOrEqual(ENROLL_ID_MINIMO);
      expect(Number(id)).toBeLessThanOrEqual(ENROLL_ID_MAXIMO);
    }
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
    expect(() => validarExternalEnrollId('0')).toThrow(ExternalEnrollIdInvalidoError);
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

  it('aceita numero de 12 digitos, que e o que o equipamento pede', () => {
    // O manual: "valor deve estar compreendido entre 1 e 999.999.999.999".
    expect(() => validarExternalEnrollId('123456789012')).not.toThrow();
  });

  it('recusa numero acima do limite do equipamento', () => {
    // Passar disso o leitor recusa -- melhor falhar aqui que na bancada.
    expect(() => validarExternalEnrollId('1000000000000')).toThrow(ExternalEnrollIdInvalidoError);
  });

  it('recusa nao-numerico, porque o enrollid do equipamento e numerico', () => {
    // O UUID hexadecimal da primeira versao cai aqui -- e esse e o ponto.
    expect(() => validarExternalEnrollId('a'.repeat(32))).toThrow(ExternalEnrollIdInvalidoError);
  });
});
