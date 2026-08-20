import { describe, expect, it } from 'vitest';

import { ehRegistroDeTeste, montarSnapshot } from './importar.js';

/**
 * `ehRegistroDeTeste` e a unica decisao pura que mora no nucleo de gravacao
 * (o resto vive em `dominio.ts`, ja coberto). Ela decide se uma linha e
 * IGNORADA por inteiro -- errar para um lado deixa lixo do Pacto virando
 * gente com acesso; errar para o outro apaga uma pessoa de verdade da
 * importacao sem virar nem pendencia. A gravacao contra banco e da Task 7.
 */
describe('ehRegistroDeTeste', () => {
  it('descarta nome vazio ou so espaco', () => {
    expect(ehRegistroDeTeste('')).toBe(true);
    expect(ehRegistroDeTeste('   ')).toBe(true);
  });

  it('descarta nome que e so numero -- lixo tipico do extrator', () => {
    expect(ehRegistroDeTeste('123')).toBe(true);
    expect(ehRegistroDeTeste('  0099 ')).toBe(true);
  });

  it('descarta o marcador de POC, em qualquer caixa', () => {
    expect(ehRegistroDeTeste('TESTE-01')).toBe(true);
    expect(ehRegistroDeTeste('teste catraca')).toBe(true);
    expect(ehRegistroDeTeste('Teste')).toBe(true);
  });

  it('MANTEM pessoa de verdade, inclusive nome com numero no meio', () => {
    expect(ehRegistroDeTeste('Maria da Silva')).toBe(false);
    expect(ehRegistroDeTeste('Joao Paulo II')).toBe(false);
    // O prefixo e o criterio, nao a presenca da palavra: quem se chama
    // "Ernesto Teste" nao pode sumir da importacao.
    expect(ehRegistroDeTeste('Ernesto Teste')).toBe(false);
  });
});

/**
 * O defeito C1 da F48: o caminho de PLANO gravava `janelas: []`, e como
 * `unitIds` da projecao sai EXCLUSIVAMENTE das linhas de
 * `EntitlementUnitWindow`, todo aluno importado seria negado com
 * `WRONG_UNIT`. O comentario do codigo afirmava que janela vazia significava
 * "sem restricao" -- e verdade para HORARIO (passo 6 do motor), falso para
 * UNIDADE (passo 5, que nao tem fallback).
 *
 * Hoje plano e vinculo usam o MESMO construtor, entao o defeito nao tem como
 * voltar por divergencia entre dois. Este teste tranca a invariante que
 * importa: nenhuma unidade do direito pode ficar sem janela.
 */
describe('montarSnapshot', () => {
  const unidades = ['u-2', 'u-1'];

  it('cobre TODA unidade, nos sete dias, para plano E para vinculo', () => {
    for (const plano of [{ id: 'p-1', name: 'Programa Adultos e Idosos' }, null]) {
      const snapshot = montarSnapshot(plano, 'STUDENT', unidades);

      expect(snapshot.gymUnitIds).toEqual(['u-1', 'u-2']);

      for (const unidade of snapshot.gymUnitIds) {
        const dias = snapshot.janelas
          .filter((j) => j.gymUnitId === unidade)
          .map((j) => j.dayOfWeek)
          .sort((a, b) => a - b);

        // EIXO DO MOTOR: 0 = domingo ... 6 = sabado (`Date.getDay()`), e NAO
        // o ISO-8601 que o schema declara. Quem decide se a porta abre e o
        // motor -- ver o bloco em `montarSnapshot`. Gravar ISO nega todo
        // mundo no domingo, e so no domingo.
        expect(dias).toEqual([0, 1, 2, 3, 4, 5, 6]);
      }

      // Sem janela = `unitIds: []` = todo mundo negado. Nunca vazio.
      expect(snapshot.janelas.length).toBe(unidades.length * 7);
    }
  });

  it('o dia inteiro, para nao inventar grade que a base do Pacto nao traz', () => {
    for (const janela of montarSnapshot(null, 'TRAINER', ['u-1']).janelas) {
      expect(janela.startMinute).toBe(0);
      expect(janela.endMinute).toBe(1440);
    }
  });

  it('so a identidade do plano distingue os dois caminhos', () => {
    expect(montarSnapshot({ id: 'p-1', name: 'Plano X' }, 'STUDENT', ['u-1'])).toMatchObject({
      planId: 'p-1',
      planName: 'Plano X',
    });
    expect(montarSnapshot(null, 'STAFF', ['u-1'])).toMatchObject({
      planId: null,
      planName: 'Vinculo STAFF',
    });
  });
});
