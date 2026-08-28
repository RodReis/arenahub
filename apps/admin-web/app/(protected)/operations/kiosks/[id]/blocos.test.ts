import { describe, expect, it } from 'vitest';
import { TIPOS_DE_BLOCO, type BlocoDaTelaPublica } from '@arenahub/api-contracts';

import { blocoNovo, mover, remover, substituir, tiposDisponiveis } from './blocos';

function tres(): readonly BlocoDaTelaPublica[] {
  return [blocoNovo('VIDEO', 'a'), blocoNovo('EVENTOS', 'b'), blocoNovo('INSTAGRAM', 'c')];
}

const ids = (itens: readonly BlocoDaTelaPublica[]) => itens.map((b) => b.id);

describe('blocoNovo', () => {
  it('nasce DESLIGADO -- acrescentar e publicar sao decisoes distintas', () => {
    expect(blocoNovo('VIDEO', 'a').habilitado).toBe(false);
  });

  it('video nasce com legenda -- o contrato exige, DS-TOTEM §4 tambem', () => {
    const bloco = blocoNovo('VIDEO', 'a');

    expect(bloco.tipo === 'VIDEO' && bloco.legenda.length > 0).toBe(true);
  });
});

describe('mover', () => {
  it('sobe uma posicao', () => {
    expect(ids(mover(tres(), 1, 'cima'))).toEqual(['b', 'a', 'c']);
  });

  it('desce uma posicao', () => {
    expect(ids(mover(tres(), 1, 'baixo'))).toEqual(['a', 'c', 'b']);
  });

  it('subir a PRIMEIRA nao embaralha -- devolve a lista intacta', () => {
    expect(ids(mover(tres(), 0, 'cima'))).toEqual(['a', 'b', 'c']);
  });

  it('descer a ULTIMA nao embaralha', () => {
    expect(ids(mover(tres(), 2, 'baixo'))).toEqual(['a', 'b', 'c']);
  });

  it('indice fora da lista nao lanca nem corrompe', () => {
    expect(ids(mover(tres(), 9, 'cima'))).toEqual(['a', 'b', 'c']);
    expect(ids(mover(tres(), -1, 'baixo'))).toEqual(['a', 'b', 'c']);
  });

  it('nao muta a lista de entrada', () => {
    const original = tres();

    mover(original, 1, 'cima');

    expect(ids(original)).toEqual(['a', 'b', 'c']);
  });

  it('subir e depois descer volta ao ponto de partida', () => {
    expect(ids(mover(mover(tres(), 2, 'cima'), 1, 'baixo'))).toEqual(['a', 'b', 'c']);
  });
});

describe('substituir', () => {
  it('troca o bloco PRESERVANDO a posicao', () => {
    const editado = { ...tres()[1]!, habilitado: true };

    const resultado = substituir(tres(), editado);

    expect(ids(resultado)).toEqual(['a', 'b', 'c']);
    expect(resultado[1]?.habilitado).toBe(true);
  });

  it('id inexistente nao acrescenta nada', () => {
    expect(substituir(tres(), blocoNovo('MATERIAL', 'z'))).toHaveLength(3);
  });
});

describe('remover', () => {
  it('tira so o id pedido', () => {
    expect(ids(remover(tres(), 'b'))).toEqual(['a', 'c']);
  });
});

describe('tiposDisponiveis', () => {
  it('esconde os tipos ja usados -- um de cada', () => {
    expect(tiposDisponiveis(tres())).toEqual(['MATERIAL', 'INFORMACOES', 'DESAFIO']);
  });

  /*
   * DERIVADO DE `TIPOS_DE_BLOCO`, nao um numero cravado: a versao anterior
   * dizia "os cinco" e quebrou quando a F34 acrescentou o sexto tipo. O que
   * o teste quer afirmar e "lista vazia oferece TODOS", nao "oferece 5".
   */
  it('lista vazia oferece todos os tipos do contrato', () => {
    expect(tiposDisponiveis([])).toHaveLength(TIPOS_DE_BLOCO.length);
  });
});
