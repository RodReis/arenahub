import { describe, expect, it } from '@jest/globals';

import {
  agregarFrequencia,
  consistencia,
  POLITICA_DE_SESSAO,
  projetarSessoes,
  rotuloDoBalde,
  semanaIso,
  type PassagemElegivel,
} from './frequencia.js';
import { dataLocalIso } from './periodo.js';

const SP = 'America/Sao_Paulo';
const UNIDADE = 'unit-centro';
const OUTRA = 'unit-bairro';

function passagem(
  passageId: string,
  occurredAt: string,
  gymUnitId = UNIDADE,
): PassagemElegivel {
  return {
    passageId,
    accessEventId: `evt-${passageId}`,
    gymUnitId,
    occurredAt: new Date(occurredAt),
  };
}

/** Projeta com o `dataLocalIso` de verdade -- o mesmo que a producao usa. */
function projetar(passagens: readonly PassagemElegivel[], fuso = SP) {
  return projetarSessoes(passagens, fuso, dataLocalIso);
}

describe('projetarSessoes -- agrupamento por dia civil (M3-BR-008)', () => {
  it('tres entradas no mesmo dia viram UMA sessao', () => {
    const sessoes = projetar([
      passagem('p1', '2026-08-17T09:00:00Z'),
      passagem('p2', '2026-08-17T13:00:00Z'),
      passagem('p3', '2026-08-17T22:00:00Z'),
    ]);

    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]!.passagens).toBe(3);
    expect(sessoes[0]!.passageIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('preserva os ids brutos -- a sessao nao substitui a passagem', () => {
    const sessoes = projetar([
      passagem('p1', '2026-08-17T09:00:00Z'),
      passagem('p2', '2026-08-17T13:00:00Z'),
    ]);

    // `M3-BR-008`: agrupar "sem apagar eventos brutos". A projecao aponta para
    // eles; nao os consome.
    expect(sessoes[0]!.passageIds).toEqual(['p1', 'p2']);
  });

  it('grava a versao da politica em cada sessao', () => {
    const sessoes = projetar([passagem('p1', '2026-08-17T09:00:00Z')]);

    expect(sessoes[0]!.policyVersion).toBe(POLITICA_DE_SESSAO);
  });

  it('nao produz duracao -- so os extremos do dia', () => {
    const sessoes = projetar([
      passagem('p1', '2026-08-17T09:00:00Z'),
      passagem('p2', '2026-08-17T22:00:00Z'),
    ]);

    // A Slice 3.4 proibe inferir duracao sem saida confiavel. Os extremos
    // existem para AUDITAR o agrupamento, e o tipo nao oferece onde guardar
    // um total -- subtrair um do outro seria decisao de quem consome, contra
    // o que esta escrito no topo do modulo.
    expect(sessoes[0]).not.toHaveProperty('duracao');
    expect(sessoes[0]!.primeiraEm).toEqual(new Date('2026-08-17T09:00:00Z'));
    expect(sessoes[0]!.ultimaEm).toEqual(new Date('2026-08-17T22:00:00Z'));
  });

  it('dias diferentes viram sessoes diferentes', () => {
    const sessoes = projetar([
      passagem('p1', '2026-08-17T09:00:00Z'),
      passagem('p2', '2026-08-18T09:00:00Z'),
    ]);

    expect(sessoes.map((s) => s.dataLocal)).toEqual(['2026-08-17', '2026-08-18']);
  });

  it('mesma data em unidades diferentes vira DUAS sessoes', () => {
    const sessoes = projetar([
      passagem('p1', '2026-08-17T09:00:00Z', UNIDADE),
      passagem('p2', '2026-08-17T22:00:00Z', OUTRA),
    ]);

    // Somar as duas apagaria onde a pessoa estava, que e o que uma rede
    // multiunidade precisa saber.
    expect(sessoes).toHaveLength(2);
    expect(sessoes.map((s) => s.gymUnitId).sort()).toEqual([OUTRA, UNIDADE]);
  });

  it('devolve lista vazia sem passagens -- nunca um dia com zero', () => {
    expect(projetar([])).toEqual([]);
  });
});

describe('projetarSessoes -- o dia e LOCAL, nao UTC', () => {
  /**
   * 2026-08-18T02:00Z ainda e 17/08 as 23:00 em Sao Paulo (UTC-3). Agrupar
   * por dia UTC quebraria a sessao em duas e diria que o aluno treinou dois
   * dias -- inflando a frequencia de quem treina a noite, que e a maioria.
   */
  it('passagem tarde da noite fica no dia local, e nao no dia UTC seguinte', () => {
    const sessoes = projetar([
      passagem('p1', '2026-08-17T22:00:00Z'), // 19:00 local, 17/08
      passagem('p2', '2026-08-18T02:00:00Z'), // 23:00 local, AINDA 17/08
    ]);

    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]!.dataLocal).toBe('2026-08-17');
  });

  it('fuso diferente produz agrupamento diferente para os mesmos instantes', () => {
    const passagens = [
      passagem('p1', '2026-08-17T22:00:00Z'),
      passagem('p2', '2026-08-18T02:00:00Z'),
    ];

    // Em UTC os dois instantes caem em dias distintos; em Sao Paulo, no mesmo.
    expect(projetar(passagens, 'UTC')).toHaveLength(2);
    expect(projetar(passagens, SP)).toHaveLength(1);
  });
});

describe('projetarSessoes -- determinismo', () => {
  it('a ordem de entrada nao muda a saida', () => {
    const passagens = [
      passagem('p3', '2026-08-19T09:00:00Z'),
      passagem('p1', '2026-08-17T09:00:00Z'),
      passagem('p2', '2026-08-18T09:00:00Z'),
    ];

    expect(projetar(passagens)).toEqual(projetar([...passagens].reverse()));
  });

  /**
   * Dois leitores podem gravar o MESMO milissegundo. Sem desempate por id, a
   * ordem viria do banco -- que nao promete nenhuma -- e `passageIds` mudaria
   * entre execucoes, quebrando a reprojecao idempotente.
   */
  it('desempata instantes iguais por id, e nao pela ordem do banco', () => {
    const a = passagem('p-aaa', '2026-08-17T09:00:00Z');
    const b = passagem('p-bbb', '2026-08-17T09:00:00Z');

    expect(projetar([a, b])[0]!.passageIds).toEqual(['p-aaa', 'p-bbb']);
    expect(projetar([b, a])[0]!.passageIds).toEqual(['p-aaa', 'p-bbb']);
  });
});

describe('semanaIso', () => {
  it('numera a semana pela quinta-feira (ISO-8601)', () => {
    // 2026-08-17 e uma segunda; a quinta da mesma semana e 20/08.
    expect(semanaIso('2026-08-17')).toBe('2026-W34');
    expect(semanaIso('2026-08-23')).toBe('2026-W34'); // domingo, mesma semana
    expect(semanaIso('2026-08-24')).toBe('2026-W35'); // segunda seguinte
  });

  /**
   * A virada de ano e o unico lugar onde uma conta caseira erra de forma
   * visivel: 1 de janeiro pode pertencer a ultima semana do ano ANTERIOR.
   */
  it('atribui 01/01 a semana do ano anterior quando o ISO manda', () => {
    // 2027-01-01 e uma sexta -- pertence a W53 de 2026.
    expect(semanaIso('2027-01-01')).toBe('2026-W53');
  });

  it('domingo pertence a semana que comecou na segunda', () => {
    // Sem o `|| 7`, `getUTCDay()` daria 0 e puxaria o domingo para a semana
    // anterior -- o erro classico de quem trata domingo como inicio.
    expect(semanaIso('2026-01-04')).toBe('2026-W01');
  });
});

describe('rotuloDoBalde', () => {
  it('usa o rotulo certo por granularidade', () => {
    expect(rotuloDoBalde('2026-08-17', 'SEMANAL')).toBe('2026-W34');
    expect(rotuloDoBalde('2026-08-17', 'MENSAL')).toBe('2026-08');
    expect(rotuloDoBalde('2026-08-17', 'ANUAL')).toBe('2026');
  });
});

describe('agregarFrequencia', () => {
  const sessoes = projetar([
    passagem('p1', '2026-08-17T12:00:00Z'), // seg, W34
    passagem('p2', '2026-08-17T20:00:00Z'), // mesmo dia -- nao conta de novo
    passagem('p3', '2026-08-19T12:00:00Z'), // qua, W34
    passagem('p4', '2026-08-25T12:00:00Z'), // ter, W35
  ]);

  it('conta DIAS treinados, nao passagens', () => {
    const baldes = agregarFrequencia(sessoes, 'SEMANAL');

    expect(baldes).toEqual([
      { rotulo: '2026-W34', sessoes: 2, passagens: 3 },
      { rotulo: '2026-W35', sessoes: 1, passagens: 1 },
    ]);
  });

  it('agrega por mes e por ano', () => {
    expect(agregarFrequencia(sessoes, 'MENSAL')).toEqual([
      { rotulo: '2026-08', sessoes: 3, passagens: 4 },
    ]);
    expect(agregarFrequencia(sessoes, 'ANUAL')).toEqual([
      { rotulo: '2026', sessoes: 3, passagens: 4 },
    ]);
  });

  /**
   * Balde vazio NAO entra. Emitir `{sessoes: 0}` afirmaria "nao treinou nesta
   * semana", e a afirmacao e falsa quando a semana esta fora do periodo ou a
   * fonte estava degradada -- mesma distincao ausencia/zero do INV-104.
   */
  it('nao inventa balde de semana sem sessao', () => {
    const comLacuna = projetar([
      passagem('p1', '2026-08-17T12:00:00Z'), // W34
      passagem('p2', '2026-09-07T12:00:00Z'), // W37 -- W35 e W36 vazias
    ]);

    expect(agregarFrequencia(comLacuna, 'SEMANAL').map((b) => b.rotulo)).toEqual([
      '2026-W34',
      '2026-W37',
    ]);
  });

  it('sem sessoes devolve lista vazia', () => {
    expect(agregarFrequencia([], 'SEMANAL')).toEqual([]);
  });

  it('sai ordenado por rotulo, e nao pela ordem de insercao', () => {
    const fora = projetar([
      passagem('p2', '2026-08-25T12:00:00Z'),
      passagem('p1', '2026-08-17T12:00:00Z'),
    ]);

    expect(agregarFrequencia(fora, 'SEMANAL').map((b) => b.rotulo)).toEqual([
      '2026-W34',
      '2026-W35',
    ]);
  });
});

describe('consistencia', () => {
  it('e a proporcao de semanas elegiveis com ao menos uma sessao', () => {
    const sessoes = projetar([
      passagem('p1', '2026-08-17T12:00:00Z'), // W34
      passagem('p2', '2026-08-19T12:00:00Z'), // W34 -- mesma semana
      passagem('p3', '2026-08-25T12:00:00Z'), // W35
    ]);

    expect(consistencia(sessoes, 4)).toEqual({
      semanasComSessao: 2,
      semanasElegiveis: 4,
      proporcao: 0.5,
    });
  });

  /**
   * `semanasElegiveis` vem de FORA porque so quem conhece o periodo sabe
   * quantas semanas ele tem. Contar as semanas com sessao e dividir por si
   * mesmo devolveria 100% para quem treinou uma unica vez.
   */
  it('nao divide pelas semanas que ele mesmo contou', () => {
    const umaSemana = projetar([passagem('p1', '2026-08-17T12:00:00Z')]);

    expect(consistencia(umaSemana, 12).proporcao).toBe(0.0833);
    expect(consistencia(umaSemana, 12).proporcao).not.toBe(1);
  });

  it('periodo sem semana elegivel devolve null, e nao zero nem NaN', () => {
    const r = consistencia([], 0);

    // Zero afirmaria "consistencia zero"; dividir por zero daria NaN na tela.
    expect(r.proporcao).toBeNull();
    expect(r.semanasElegiveis).toBe(0);
  });

  it('nenhuma sessao num periodo real e zero de verdade', () => {
    expect(consistencia([], 4)).toEqual({
      semanasComSessao: 0,
      semanasElegiveis: 4,
      proporcao: 0,
    });
  });

  it('nao passa de 1 quando ha mais semanas com sessao que elegiveis', () => {
    // Entrada incoerente (elegiveis menor que o real) nao deve produzir
    // percentual acima de 100 sem sinal -- aqui ele aparece, e e proposital:
    // esconder indicaria consistencia perfeita para um periodo mal calculado.
    const sessoes = projetar([
      passagem('p1', '2026-08-17T12:00:00Z'),
      passagem('p2', '2026-08-25T12:00:00Z'),
    ]);

    expect(consistencia(sessoes, 1).proporcao).toBe(2);
  });
});
