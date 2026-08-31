import { describe, expect, it } from '@jest/globals';

import {
  FRACAO_DE_CONTROLE_PADRAO,
  GRUPOS_DO_EXPERIMENTO,
  posicaoDeterministica,
  sortearGrupo,
} from './randomizacao.js';

describe('posicaoDeterministica', () => {
  it('devolve o mesmo numero para a mesma semente e o mesmo aluno', () => {
    expect(posicaoDeterministica('exp-1', 'aluno-a')).toBe(posicaoDeterministica('exp-1', 'aluno-a'));
  });

  it('devolve numero diferente para alunos diferentes', () => {
    expect(posicaoDeterministica('exp-1', 'aluno-a')).not.toBe(
      posicaoDeterministica('exp-1', 'aluno-b'),
    );
  });

  it('devolve numero diferente para sementes diferentes', () => {
    // Dois experimentos sobre a mesma base nao podem repetir a mesma divisao --
    // se repetissem, o aluno que ficou no controle uma vez ficaria sempre, e o
    // vies se acumularia em cima das mesmas pessoas.
    expect(posicaoDeterministica('exp-1', 'aluno-a')).not.toBe(
      posicaoDeterministica('exp-2', 'aluno-a'),
    );
  });

  it('fica sempre no intervalo [0, 1)', () => {
    for (let i = 0; i < 500; i += 1) {
      const valor = posicaoDeterministica('exp-1', `aluno-${i}`);
      expect(valor).toBeGreaterThanOrEqual(0);
      expect(valor).toBeLessThan(1);
    }
  });

  it('distribui de forma aproximadamente uniforme', () => {
    // Sem isso, um hash ruim poderia jogar quase todo mundo no mesmo lado e o
    // "experimento" compararia 900 contra 3.
    const total = 4000;
    const abaixoDeMeio = Array.from({ length: total }, (_, i) =>
      posicaoDeterministica('exp-uniforme', `aluno-${i}`),
    ).filter((valor) => valor < 0.5).length;

    expect(abaixoDeMeio / total).toBeGreaterThan(0.46);
    expect(abaixoDeMeio / total).toBeLessThan(0.54);
  });
});

describe('sortearGrupo', () => {
  it('poe no controle quem cai abaixo da fracao', () => {
    expect(sortearGrupo('exp-1', 'aluno-a', 1)).toBe('CONTROLE');
  });

  it('poe no tratamento quando a fracao de controle e zero', () => {
    expect(sortearGrupo('exp-1', 'aluno-a', 0)).toBe('TRATAMENTO');
  });

  it('e estavel: o mesmo aluno cai sempre no mesmo grupo', () => {
    const grupos = new Set(
      Array.from({ length: 20 }, () => sortearGrupo('exp-1', 'aluno-a', 0.2)),
    );

    expect(grupos.size).toBe(1);
  });

  it('respeita aproximadamente a fracao pedida', () => {
    const total = 4000;
    const controles = Array.from({ length: total }, (_, i) =>
      sortearGrupo('exp-alocacao', `aluno-${i}`, 0.2),
    ).filter((grupo) => grupo === 'CONTROLE').length;

    // 20% pedidos, com folga para a variacao do hash.
    expect(controles / total).toBeGreaterThan(0.17);
    expect(controles / total).toBeLessThan(0.23);
  });

  it('recusa fracao fora de [0, 1]', () => {
    expect(() => sortearGrupo('exp-1', 'aluno-a', -0.1)).toThrow('FRACAO_INVALIDA');
    expect(() => sortearGrupo('exp-1', 'aluno-a', 1.5)).toThrow('FRACAO_INVALIDA');
  });

  it('tem os dois grupos, e so os dois', () => {
    expect([...GRUPOS_DO_EXPERIMENTO]).toEqual(['CONTROLE', 'TRATAMENTO']);
  });

  it('tem 20% de controle como padrao -- decisao do PI de 31/08/2026', () => {
    expect(FRACAO_DE_CONTROLE_PADRAO).toBe(0.2);
  });
});
