import { describe, expect, it } from '@jest/globals';

import {
  contarSemanasQualificadas,
  contarSessoes,
} from './engagement-ranking.repository.js';
import { POLITICA_DE_STREAK } from './domain/semana-de-consistencia.js';

/** Sessão num dia local, no formato que o Prisma devolve (`@db.Date`). */
function em(dia: string): { studentId: string; sessionDate: Date } {
  return { studentId: 'a', sessionDate: new Date(`${dia}T00:00:00.000Z`) };
}

function de(studentId: string, dias: readonly string[]) {
  return dias.map((dia) => ({ studentId, sessionDate: new Date(`${dia}T00:00:00.000Z`) }));
}

describe('contarSessoes -- categoria FREQUENCIA', () => {
  it('conta uma por sessao', () => {
    const r = contarSessoes(de('a', ['2026-08-03', '2026-08-05', '2026-08-07']));
    expect(r[0]?.points).toBe(3);
  });

  it('guarda a sessao MAIS RECENTE como desempate', () => {
    // `lastEntryAt` e o criterio 2 de `classificar()`: quem chegou ao numero
    // primeiro ganha. Guardar a mais antiga inverteria o desempate.
    const r = contarSessoes(de('a', ['2026-08-03', '2026-08-20', '2026-08-10']));
    expect(r[0]?.lastEntryAt.toISOString().slice(0, 10)).toBe('2026-08-20');
  });
});

describe('contarSemanasQualificadas -- categoria CONSISTENCIA', () => {
  it('a meta e a da politica versionada, nao um numero fixo aqui', () => {
    // Trava o acoplamento: se a academia mudar a meta, este teste muda junto
    // ou falha -- em vez de a contagem silenciosamente medir outra coisa.
    expect(POLITICA_DE_STREAK.diasPorSemana).toBe(3);
  });

  it('conta a semana que ATINGE a meta', () => {
    // Semana de 03/08 (seg) a 09/08: tres dias.
    const r = contarSemanasQualificadas(de('a', ['2026-08-03', '2026-08-05', '2026-08-07']));
    expect(r[0]?.points).toBe(1);
  });

  it('O CANARIO DA CATEGORIA: semana com menos que a meta NAO conta', () => {
    // O defeito que a revisao adversarial achou. Contar semanas "tocadas"
    // faria quem aparece 1x por semana empatar com quem bate a meta toda
    // semana -- e a categoria existe justamente para separar os dois.
    const r = contarSemanasQualificadas(
      de('a', ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']),
    );

    expect(r).toHaveLength(0);
  });

  it('regularidade REAL vence presenca esporadica espalhada', () => {
    // O caso que o comentario da funcao promete e o codigo precisa cumprir:
    // 12 dias em 4 semanas cheias (C) contra 4 dias espalhados (D).
    const regular = de('c', [
      '2026-08-03', '2026-08-05', '2026-08-07',
      '2026-08-10', '2026-08-12', '2026-08-14',
      '2026-08-17', '2026-08-19', '2026-08-21',
      '2026-08-24', '2026-08-26', '2026-08-28',
    ]);
    const esporadico = de('d', ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']);

    const r = contarSemanasQualificadas([...regular, ...esporadico]);
    const porAluno = Object.fromEntries(r.map((x) => [x.studentId, x.points]));

    expect(porAluno['c']).toBe(4);
    // O esporadico nem aparece -- nenhuma semana dele bateu a meta.
    expect(porAluno['d']).toBeUndefined();
  });

  it('volume numa semana so nao vira varias semanas', () => {
    // `M5-BR-005`: a unidade e a SEMANA. Seis treinos numa semana valem UMA.
    const r = contarSemanasQualificadas(
      de('a', ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08']),
    );
    expect(r[0]?.points).toBe(1);
  });

  it('a semana comeca na SEGUNDA -- domingo fecha a semana anterior', () => {
    // Se domingo abrisse semana propria, quem treina sexta/sabado/domingo
    // teria duas semanas de uma tacada, e nenhuma delas qualificada.
    const r = contarSemanasQualificadas(de('a', ['2026-08-07', '2026-08-08', '2026-08-09']));
    expect(r[0]?.points).toBe(1);
  });

  it('so conta o aluno que qualificou ao menos uma semana', () => {
    const r = contarSemanasQualificadas([
      ...de('a', ['2026-08-03', '2026-08-05', '2026-08-07']),
      ...de('b', ['2026-08-04']),
    ]);

    expect(r.map((x) => x.studentId)).toEqual(['a']);
  });

  it('lastEntryAt e a sessao mais recente DENTRE as semanas qualificadas', () => {
    // Se viesse de uma semana nao qualificada, o desempate usaria um dia que
    // nao contribuiu para a pontuacao.
    const r = contarSemanasQualificadas(
      de('a', [
        '2026-08-03', '2026-08-05', '2026-08-07',
        '2026-08-31',
      ]),
    );

    expect(r[0]?.points).toBe(1);
    expect(r[0]?.lastEntryAt.toISOString().slice(0, 10)).toBe('2026-08-07');
  });

  it('sem sessao nenhuma, devolve lista vazia', () => {
    expect(contarSemanasQualificadas([])).toEqual([]);
    expect(contarSessoes([])).toEqual([]);
  });

  it('nao conta a mesma sessao duas vezes', () => {
    expect(contarSessoes([em('2026-08-03'), em('2026-08-03')])[0]?.points).toBe(2);
  });
});
