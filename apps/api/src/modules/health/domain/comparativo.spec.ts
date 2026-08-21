import { describe, expect, it } from '@jest/globals';

import {
  compararSerie,
  selecionarFolhas,
  type AvaliacaoDaSerie,
  type MetaDaSerie,
} from './comparativo.js';

/**
 * F18 -- historico e comparativos.
 *
 * O aceite da Slice 3.2 e literal: "os mesmos dados sempre geram o mesmo
 * comparativo, inclusive em unidades e arredondamento". Entao o que estes
 * testes defendem nao e "calcula a diferenca" -- e:
 *
 * - **INV-102** correcao vinculada substitui a original NA SERIE. Plotar as
 *   duas mostraria o numero errado e o certo lado a lado, como se fossem
 *   duas medicoes;
 * - **INV-104** ausencia nao e zero. Falta de baseline devolve `null` com
 *   razao, nunca `0` nem `-100%`;
 * - **INV-106** o calculo usa a precisao recebida. Arredondar aqui
 *   contaminaria a comparacao.
 */

function avaliacao(
  id: string,
  assessedAt: string,
  valor: number | null,
  extras: Partial<AvaliacaoDaSerie> = {},
): AvaliacaoDaSerie {
  return {
    id,
    assessedAt: new Date(assessedAt),
    supersededById: null,
    valor,
    ...extras,
  };
}

describe('selecionarFolhas', () => {
  it('mantem avaliacao sem correcao vinculada', () => {
    const serie = [avaliacao('a', '2026-01-10T09:00:00.000Z', 80)];

    expect(selecionarFolhas(serie).map((a) => a.id)).toEqual(['a']);
  });

  it('descarta a original quando existe correcao (INV-102)', () => {
    // A original permanece PUBLICADA no banco -- e o que prova que o numero
    // errado circulou. Mas na serie ela nao entra: dois pontos no mesmo
    // instante leriam como duas medicoes do aluno.
    const serie = [
      avaliacao('errada', '2026-01-10T09:00:00.000Z', 80, { supersededById: 'certa' }),
      avaliacao('certa', '2026-01-10T09:00:00.000Z', 88),
    ];

    expect(selecionarFolhas(serie).map((a) => a.id)).toEqual(['certa']);
  });

  it('mantem so a folha numa cadeia de correcoes', () => {
    // Corrigir a correcao forma CADEIA, nao leque (`correcaoPermitida`).
    const serie = [
      avaliacao('v1', '2026-01-10T09:00:00.000Z', 80, { supersededById: 'v2' }),
      avaliacao('v2', '2026-01-10T09:00:00.000Z', 88, { supersededById: 'v3' }),
      avaliacao('v3', '2026-01-10T09:00:00.000Z', 86),
    ];

    expect(selecionarFolhas(serie).map((a) => a.id)).toEqual(['v3']);
  });

  it('ordena por instante da MEDICAO, do mais antigo para o mais recente', () => {
    // `assessedAt`, nunca `createdAt`: avaliacao de ontem digitada hoje
    // ordena por ontem, ou o comparativo mente (schema.prisma).
    const serie = [
      avaliacao('mar', '2026-03-01T09:00:00.000Z', 78),
      avaliacao('jan', '2026-01-01T09:00:00.000Z', 80),
      avaliacao('fev', '2026-02-01T09:00:00.000Z', 79),
    ];

    expect(selecionarFolhas(serie).map((a) => a.id)).toEqual(['jan', 'fev', 'mar']);
  });

  it('desempata por id quando duas medicoes tem o mesmo instante', () => {
    // Sem desempate estavel, a mesma entrada geraria ordens diferentes entre
    // chamadas -- e o aceite exige comparativo identico para dados identicos.
    const serie = [
      avaliacao('b', '2026-01-10T09:00:00.000Z', 80),
      avaliacao('a', '2026-01-10T09:00:00.000Z', 81),
    ];

    expect(selecionarFolhas(serie).map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('compararSerie', () => {
  const META: MetaDaSerie = { alvo: 75, unidade: 'kg' };

  it('devolve primeira, anterior e atual de uma serie com tres medicoes', () => {
    const serie = [
      avaliacao('p', '2026-01-01T09:00:00.000Z', 90),
      avaliacao('m', '2026-02-01T09:00:00.000Z', 85),
      avaliacao('u', '2026-03-01T09:00:00.000Z', 80),
    ];

    const comparativo = compararSerie(serie, null);

    expect(comparativo.primeira?.id).toBe('p');
    expect(comparativo.anterior?.id).toBe('m');
    expect(comparativo.atual?.id).toBe('u');
  });

  it('calcula variacao absoluta e percentual contra a primeira', () => {
    const serie = [
      avaliacao('p', '2026-01-01T09:00:00.000Z', 90),
      avaliacao('u', '2026-03-01T09:00:00.000Z', 81),
    ];

    const { desdeAPrimeira } = compararSerie(serie, null);

    expect(desdeAPrimeira.absoluta).toBe(-9);
    expect(desdeAPrimeira.percentual).toBe(-10);
  });

  it('nao arredonda -- devolve a precisao do calculo (INV-106)', () => {
    // 1/3 nao fecha em decimal. Se esta funcao arredondasse, quem exibe nao
    // teria como escolher a precisao, e somar valores ja arredondados
    // afastaria o total do real.
    const serie = [
      avaliacao('p', '2026-01-01T09:00:00.000Z', 3),
      avaliacao('u', '2026-03-01T09:00:00.000Z', 4),
    ];

    expect(compararSerie(serie, null).desdeAPrimeira.percentual).toBeCloseTo(33.3333333, 6);
  });

  it('serie vazia devolve tudo ausente, nunca zero (INV-104)', () => {
    const comparativo = compararSerie([], null);

    expect(comparativo.atual).toBeNull();
    expect(comparativo.primeira).toBeNull();
    expect(comparativo.anterior).toBeNull();
    expect(comparativo.desdeAPrimeira.absoluta).toBeNull();
    expect(comparativo.desdeAPrimeira.razao).toBe('SEM_BASELINE');
  });

  it('uma unica medicao nao tem anterior nem variacao', () => {
    // Primeira avaliacao do aluno: comparar contra ela mesma daria 0, e zero
    // aqui leria como "nao mudou" em vez de "nao ha com o que comparar".
    const serie = [avaliacao('u', '2026-03-01T09:00:00.000Z', 80)];

    const comparativo = compararSerie(serie, null);

    expect(comparativo.atual?.id).toBe('u');
    expect(comparativo.anterior).toBeNull();
    expect(comparativo.desdeAAnterior.absoluta).toBeNull();
    expect(comparativo.desdeAAnterior.razao).toBe('SEM_BASELINE');
  });

  it('baseline zero devolve absoluta mas recusa percentual', () => {
    // Divisao por zero. A diferenca absoluta continua verdadeira; a
    // percentual nao existe, e `Infinity` na tela nao significa nada.
    const serie = [
      avaliacao('p', '2026-01-01T09:00:00.000Z', 0),
      avaliacao('u', '2026-03-01T09:00:00.000Z', 5),
    ];

    const { desdeAPrimeira } = compararSerie(serie, null);

    expect(desdeAPrimeira.absoluta).toBe(5);
    expect(desdeAPrimeira.percentual).toBeNull();
    expect(desdeAPrimeira.razao).toBe('BASELINE_ZERO');
  });

  it('medicao sem o tipo pedido nao entra na serie (INV-104)', () => {
    // Avaliacao so de circunferencia nao tem peso. Tratar como 0 faria o
    // grafico de peso despencar num dia em que ninguem pesou o aluno.
    const serie = [
      avaliacao('p', '2026-01-01T09:00:00.000Z', 90),
      avaliacao('sem', '2026-02-01T09:00:00.000Z', null),
      avaliacao('u', '2026-03-01T09:00:00.000Z', 80),
    ];

    const comparativo = compararSerie(serie, null);

    expect(comparativo.atual?.id).toBe('u');
    expect(comparativo.anterior?.id).toBe('p');
    expect(comparativo.pontos.map((p) => p.id)).toEqual(['p', 'u']);
  });

  it('sem meta cadastrada, a comparacao com meta e ausente com razao (INV-104)', () => {
    const serie = [avaliacao('u', '2026-03-01T09:00:00.000Z', 80)];

    const { ateAMeta } = compararSerie(serie, null);

    expect(ateAMeta.absoluta).toBeNull();
    expect(ateAMeta.razao).toBe('SEM_META');
  });

  it('com meta, mede o que falta do valor atual ate o alvo', () => {
    const serie = [
      avaliacao('p', '2026-01-01T09:00:00.000Z', 90),
      avaliacao('u', '2026-03-01T09:00:00.000Z', 80),
    ];

    const { ateAMeta } = compararSerie(serie, META);

    // Falta perder 5 kg: 75 - 80.
    expect(ateAMeta.absoluta).toBe(-5);
  });

  it('meta sem nenhuma medicao continua ausente -- meta nao inventa ponto', () => {
    const { ateAMeta } = compararSerie([], META);

    expect(ateAMeta.absoluta).toBeNull();
    expect(ateAMeta.razao).toBe('SEM_BASELINE');
  });

  it('cada valor aponta a avaliacao que o sustenta (M3-NFR-006)', () => {
    // Proveniencia consultavel: numero na tela sem origem nao pode ser
    // conferido pelo aluno nem contestado pelo avaliador.
    const serie = [
      avaliacao('p', '2026-01-01T09:00:00.000Z', 90),
      avaliacao('u', '2026-03-01T09:00:00.000Z', 80),
    ];

    const { desdeAPrimeira } = compararSerie(serie, null);

    expect(desdeAPrimeira.deId).toBe('p');
    expect(desdeAPrimeira.paraId).toBe('u');
  });

  it('usa a correcao, nao a original, para o valor atual (INV-102)', () => {
    const serie = [
      avaliacao('errada', '2026-03-01T09:00:00.000Z', 999, { supersededById: 'certa' }),
      avaliacao('certa', '2026-03-01T09:00:00.000Z', 80),
      avaliacao('p', '2026-01-01T09:00:00.000Z', 90),
    ];

    const comparativo = compararSerie(serie, null);

    expect(comparativo.atual?.id).toBe('certa');
    expect(comparativo.atual?.valor).toBe(80);
    expect(comparativo.desdeAPrimeira.absoluta).toBe(-10);
  });

  it('a mesma entrada gera o mesmo comparativo (aceite da Slice 3.2)', () => {
    const serie = [
      avaliacao('b', '2026-01-10T09:00:00.000Z', 80),
      avaliacao('a', '2026-01-10T09:00:00.000Z', 81),
      avaliacao('c', '2026-03-01T09:00:00.000Z', 77),
    ];

    expect(compararSerie(serie, META)).toEqual(compararSerie([...serie].reverse(), META));
  });
});
