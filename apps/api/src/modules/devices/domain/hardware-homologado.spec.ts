import { describe, expect, it } from '@jest/globals';

import { HARDWARE_HOMOLOGADO, verificarHomologacao } from './hardware-homologado.js';

/**
 * A lista de homologacao existe para BARRAR, nao para aceitar.
 *
 * O comentario do proprio modulo e explicito: "o proposito da checagem e
 * justamente impedir que um leitor nao testado chegue a producao pela porta
 * do cadastro". Estes testes guardam essa fronteira.
 */
describe('verificarHomologacao', () => {
  it('aceita o leitor facial da bancada do MVP 0', () => {
    const resultado = verificarHomologacao({ kind: 'FACIAL_READER', model: 'Inner Fit' });

    expect(resultado.homologado).toBe(true);
  });

  /**
   * A CATRACA entrou em 24/08/2026, por decisao do PI, com o inventario lido
   * no painel fisico do equipamento (`field-notes/2026-08-15`): Topdata
   * Inner, serial 247000797, firmware 7.05.00. E a mesma catraca que o ciclo
   * facial ao vivo de 17/08 girou 28 vezes com confirmacao de sensor.
   */
  it('aceita a catraca Topdata Inner da unidade', () => {
    const resultado = verificarHomologacao({ kind: 'TURNSTILE', model: 'Inner' });

    expect(resultado.homologado).toBe(true);
  });

  /**
   * O PAR importa, nao cada campo sozinho.
   *
   * "Inner" e catraca e "Inner Fit" e leitor facial -- trocar o `kind` entre
   * eles descreve um equipamento que nao existe, e aceitar isso deixaria o
   * inventario dizer que ha uma catraca onde ha um leitor.
   */
  it('recusa o par trocado: catraca declarada como leitor facial', () => {
    const resultado = verificarHomologacao({ kind: 'FACIAL_READER', model: 'Inner' });

    expect(resultado).toEqual({ homologado: false, motivo: 'DEVICE_UNSUPPORTED_HARDWARE' });
  });

  it('recusa o par trocado: leitor facial declarado como catraca', () => {
    const resultado = verificarHomologacao({ kind: 'TURNSTILE', model: 'Inner Fit' });

    expect(resultado).toEqual({ homologado: false, motivo: 'DEVICE_UNSUPPORTED_HARDWARE' });
  });

  /**
   * O CASO QUE DA RAZAO A LISTA EXISTIR: hardware que ninguem testou nao
   * entra, mesmo com `kind` valido.
   */
  it('recusa modelo que nao passou pela bancada', () => {
    const resultado = verificarHomologacao({ kind: 'TURNSTILE', model: 'Catraca Generica X' });

    expect(resultado).toEqual({ homologado: false, motivo: 'DEVICE_UNSUPPORTED_HARDWARE' });
  });

  /**
   * "Inner" e prefixo de "Inner Fit". A comparacao e por IGUALDADE, e este
   * teste e o que impede alguem de trocar por `startsWith` numa refatoracao
   * -- o que faria "Inner Fit" casar com a entrada de catraca.
   */
  it('compara o modelo por igualdade, nao por prefixo', () => {
    const soCatraca = [{ kind: 'TURNSTILE' as const, model: 'Inner', firmwares: [] }];

    const resultado = verificarHomologacao({ kind: 'TURNSTILE', model: 'Inner Fit' }, soCatraca);

    expect(resultado.homologado).toBe(false);
  });

  it('ignora espaco em volta e diferenca de caixa', () => {
    const resultado = verificarHomologacao({ kind: 'TURNSTILE', model: '  inner  ' });

    expect(resultado.homologado).toBe(true);
  });

  /** Os dois equipamentos da unidade, e nada alem deles. */
  it('o catalogo tem exatamente os dois modelos da bancada', () => {
    expect(HARDWARE_HOMOLOGADO).toHaveLength(2);
  });
});
