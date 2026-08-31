import { describe, expect, it } from '@jest/globals';

import {
  EFEITOS_ADVERSOS,
  analisarPorIntencaoDeTratar,
  type ParticipanteDoExperimento,
} from './analise-itt.js';

const p = (parcial: Partial<ParticipanteDoExperimento> = {}): ParticipanteDoExperimento => ({
  studentId: 'e1',
  grupo: 'TRATAMENTO',
  permaneceu: true,
  adversos: [],
  ...parcial,
});

describe('analisarPorIntencaoDeTratar', () => {
  it('conta permanencia nos dois grupos e devolve a diferenca', () => {
    const resultado = analisarPorIntencaoDeTratar([
      p({ studentId: 'a', grupo: 'TRATAMENTO', permaneceu: true }),
      p({ studentId: 'b', grupo: 'TRATAMENTO', permaneceu: true }),
      p({ studentId: 'c', grupo: 'TRATAMENTO', permaneceu: false }),
      p({ studentId: 'd', grupo: 'TRATAMENTO', permaneceu: true }),
      p({ studentId: 'e', grupo: 'CONTROLE', permaneceu: true }),
      p({ studentId: 'f', grupo: 'CONTROLE', permaneceu: false }),
    ]);

    expect(resultado.tratamento).toMatchObject({ participantes: 4, permaneceram: 3 });
    expect(resultado.controle).toMatchObject({ participantes: 2, permaneceram: 1 });
    expect(resultado.tratamento.taxaDePermanencia).toBeCloseTo(0.75);
    expect(resultado.controle.taxaDePermanencia).toBeCloseTo(0.5);
    expect(resultado.diferencaEmPontos).toBeCloseTo(25);
  });

  it('conta TODO alocado, mesmo quem nunca foi contatado -- e o que ITT significa', () => {
    // O aluno de tratamento que ninguem conseguiu ligar CONTA como tratamento.
    // Move-lo para o controle (ou remove-lo) e o vies classico: sobrariam no
    // tratamento so os que atenderam, que sao justamente os mais engajados.
    const resultado = analisarPorIntencaoDeTratar([
      p({ studentId: 'a', grupo: 'TRATAMENTO', permaneceu: false, contatado: false }),
      p({ studentId: 'b', grupo: 'TRATAMENTO', permaneceu: true, contatado: true }),
      p({ studentId: 'c', grupo: 'CONTROLE', permaneceu: true }),
    ]);

    expect(resultado.tratamento.participantes).toBe(2);
    expect(resultado.tratamento.taxaDePermanencia).toBeCloseTo(0.5);
  });

  it('reporta quantos do tratamento foram de fato contatados', () => {
    const resultado = analisarPorIntencaoDeTratar([
      p({ studentId: 'a', grupo: 'TRATAMENTO', contatado: true }),
      p({ studentId: 'b', grupo: 'TRATAMENTO', contatado: false }),
      p({ studentId: 'c', grupo: 'TRATAMENTO', contatado: true }),
    ]);

    // Sem isso, um efeito nulo seria indistinguivel de "ninguem ligou".
    expect(resultado.tratamento.contatados).toBe(2);
    expect(resultado.tratamento.taxaDeContato).toBeCloseTo(2 / 3);
  });

  it('agrega efeitos adversos por grupo -- M6-AC-011', () => {
    const resultado = analisarPorIntencaoDeTratar([
      p({ studentId: 'a', grupo: 'TRATAMENTO', adversos: ['OPT_OUT', 'RECUSOU'] }),
      p({ studentId: 'b', grupo: 'TRATAMENTO', adversos: ['CANCELOU'] }),
      p({ studentId: 'c', grupo: 'CONTROLE', adversos: ['CANCELOU'] }),
    ]);

    expect(resultado.tratamento.adversos).toEqual({
      OPT_OUT: 1,
      CANCELOU: 1,
      RECUSOU: 1,
      SUPRESSAO_SOLICITADA: 0,
    });
    expect(resultado.controle.adversos).toEqual({
      OPT_OUT: 0,
      CANCELOU: 1,
      RECUSOU: 0,
      SUPRESSAO_SOLICITADA: 0,
    });
  });

  it('nao conta o mesmo efeito duas vezes para o mesmo aluno', () => {
    const resultado = analisarPorIntencaoDeTratar([
      p({ grupo: 'TRATAMENTO', adversos: ['OPT_OUT', 'OPT_OUT'] }),
    ]);

    expect(resultado.tratamento.adversos.OPT_OUT).toBe(1);
  });

  it('devolve taxa zero, e nao NaN, quando um grupo esta vazio', () => {
    const resultado = analisarPorIntencaoDeTratar([p({ grupo: 'TRATAMENTO' })]);

    expect(resultado.controle.participantes).toBe(0);
    expect(resultado.controle.taxaDePermanencia).toBe(0);
    expect(Number.isNaN(resultado.diferencaEmPontos)).toBe(false);
  });

  it('marca o resultado como NAO CONCLUSIVO quando falta gente', () => {
    // Trinta alunos num braco nao sustentam conclusao. Dizer "o tratamento
    // funcionou" com essa amostra e o cherry-picking que o aceite proibe.
    const poucos = Array.from({ length: 20 }, (_, i) =>
      p({ studentId: `t${i}`, grupo: 'TRATAMENTO' }),
    );
    const resultado = analisarPorIntencaoDeTratar([
      ...poucos,
      p({ studentId: 'c1', grupo: 'CONTROLE' }),
    ]);

    expect(resultado.conclusivo).toBe(false);
  });

  it('marca como conclusivo quando os dois bracos tem tamanho minimo', () => {
    const participantes = [
      ...Array.from({ length: 200 }, (_, i) => p({ studentId: `t${i}`, grupo: 'TRATAMENTO' as const })),
      ...Array.from({ length: 60 }, (_, i) => p({ studentId: `c${i}`, grupo: 'CONTROLE' as const })),
    ];

    expect(analisarPorIntencaoDeTratar(participantes).conclusivo).toBe(true);
  });

  it('e deterministico para a mesma entrada', () => {
    const entrada = [p({ studentId: 'a' }), p({ studentId: 'b', grupo: 'CONTROLE' })];

    expect(analisarPorIntencaoDeTratar(entrada)).toEqual(analisarPorIntencaoDeTratar(entrada));
  });

  it('tem lista fechada de efeitos adversos', () => {
    expect([...EFEITOS_ADVERSOS]).toEqual([
      'OPT_OUT',
      'CANCELOU',
      'RECUSOU',
      'SUPRESSAO_SOLICITADA',
    ]);
  });
});
