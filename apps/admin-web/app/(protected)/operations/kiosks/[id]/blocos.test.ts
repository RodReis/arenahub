import { describe, expect, it } from 'vitest';
import { TIPOS_DE_BLOCO, type BlocoDaTelaPublica } from '@arenahub/api-contracts';

import {
  blocoNovo,
  mover,
  problemasDoRascunho,
  remover,
  substituir,
  tiposDisponiveis,
} from './blocos';

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

/**
 * O RASCUNHO E RECUSADO ANTES DE SAIR DO NAVEGADOR.
 *
 * Relatado pelo PI em 28/08/2026: salvar devolvia dois toasts
 * "Nao foi possivel salvar o rascunho (VALIDATION_FAILED)" sem dizer o que
 * corrigir. A causa era uma linha de patrocinador em branco -- o botao
 * "+ Patrocinador" cria `{ nome: '', logotipoKey: null }` e o contrato exige
 * `nome.min(1)`, entao QUALQUER linha nao preenchida bloqueava o salvamento
 * inteiro.
 *
 * O servidor continua validando (ele e a autoridade). O que muda e que o
 * painel para antes e diz QUAL linha e O QUE fazer.
 */
describe('problemasDoRascunho', () => {
  const semMarcas = { habilitado: false, rotulo: '', marcas: [] };

  it('nao reclama de rascunho sem patrocinador nenhum', () => {
    expect(problemasDoRascunho({ patrocinio: semMarcas })).toEqual([]);
  });

  it('aponta a linha do patrocinador sem nome, com o numero que a tela mostra', () => {
    const problemas = problemasDoRascunho({
      patrocinio: {
        ...semMarcas,
        marcas: [
          { nome: 'EPG', logotipoKey: null },
          { nome: '', logotipoKey: null },
        ],
      },
    });

    expect(problemas).toHaveLength(1);
    // "2" e nao "1": o indice do array e interno, o gerente conta a partir de 1.
    expect(problemas[0]).toMatch(/patrocinador 2/i);
    expect(problemas[0]).toMatch(/nome/i);
  });

  /** Espaco em branco nao e nome -- o contrato usa `min(1)` apos o trim da UI. */
  it('trata nome so com espacos como vazio', () => {
    expect(
      problemasDoRascunho({
        patrocinio: { ...semMarcas, marcas: [{ nome: '   ', logotipoKey: null }] },
      }),
    ).toHaveLength(1);
  });

  it('aceita a linha preenchida', () => {
    expect(
      problemasDoRascunho({
        patrocinio: { ...semMarcas, marcas: [{ nome: 'EPG', logotipoKey: null }] },
      }),
    ).toEqual([]);
  });

  /** Uma mensagem POR linha: duas em branco sao dois problemas a corrigir. */
  it('lista uma mensagem por linha em branco', () => {
    expect(
      problemasDoRascunho({
        patrocinio: {
          ...semMarcas,
          marcas: [
            { nome: '', logotipoKey: null },
            { nome: '', logotipoKey: null },
          ],
        },
      }),
    ).toHaveLength(2);
  });
});
