import { describe, expect, it } from '@jest/globals';

import {
  POLITICA_DE_STREAK,
  avaliarSemanas,
  inicioDaSemanaLocal,
  resumirStreak,
  type DiaTreinado,
  type PausaAprovada,
} from './semana-de-consistencia.js';

const FUSO = 'America/Sao_Paulo';

/** Politica de referencia dos testes -- 3 sessoes, semana de segunda. */
const POLITICA = POLITICA_DE_STREAK;

function dia(dataLocal: string): DiaTreinado {
  return { dataLocal };
}

describe('inicioDaSemanaLocal', () => {
  it('devolve a segunda-feira da semana do dia', () => {
    // 2026-08-27 e uma quinta; a segunda da semana e 2026-08-24.
    expect(inicioDaSemanaLocal('2026-08-27')).toBe('2026-08-24');
  });

  it('trata a propria segunda como inicio, nao como fim da anterior', () => {
    expect(inicioDaSemanaLocal('2026-08-24')).toBe('2026-08-24');
  });

  it('trata domingo como ULTIMO dia da semana, nao como primeiro', () => {
    // 2026-08-30 e domingo -- pertence a semana que comecou em 24/08.
    expect(inicioDaSemanaLocal('2026-08-30')).toBe('2026-08-24');
  });

  it('atravessa a virada de mes sem cair no mes errado', () => {
    // 2026-09-01 e terca; a segunda e 31/08, mes anterior.
    expect(inicioDaSemanaLocal('2026-09-01')).toBe('2026-08-31');
  });

  it('atravessa a virada de ano', () => {
    // 2027-01-01 e sexta; a segunda e 28/12/2026.
    expect(inicioDaSemanaLocal('2027-01-01')).toBe('2026-12-28');
  });

  it('nao desloca o dia por fuso -- a entrada JA e dia local', () => {
    // Se a funcao construisse Date pelo relogio local do processo, um runtime
    // em UTC-3 devolveria o dia anterior. `AAAA-MM-DD` entra e sai como texto.
    expect(inicioDaSemanaLocal('2026-03-01')).toBe('2026-02-23');
  });
});

describe('avaliarSemanas', () => {
  it('qualifica a semana por DIAS elegiveis, nao por numero de passagens', () => {
    // Tres dias distintos -- qualifica. O numero de passagens de cada dia nem
    // chega aqui: `StudentAttendanceSession` (F24) ja deduplicou por dia local.
    const semanas = avaliarSemanas(
      [dia('2026-08-24'), dia('2026-08-26'), dia('2026-08-28')],
      [],
      POLITICA,
      '2026-08-30',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-24')).toMatchObject({
      status: 'QUALIFICADA',
      diasTreinados: 3,
    });
  });

  it('NAO qualifica com dias repetidos -- o mesmo dia nao conta duas vezes', () => {
    // `hoje` na semana SEGUINTE: com a semana ainda aberta o status correto
    // seria `EM_ANDAMENTO`, e o teste nao provaria nada sobre a contagem.
    const semanas = avaliarSemanas(
      [dia('2026-08-24'), dia('2026-08-24'), dia('2026-08-24')],
      [],
      POLITICA,
      '2026-09-02',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-24')).toMatchObject({
      status: 'PERDIDA',
      diasTreinados: 1,
    });
  });

  it('nunca premia treino ilimitado: sete dias valem o mesmo que tres', () => {
    // `M5-BR-005`. Uma semana e UMA semana no streak -- o excesso nao vira
    // credito nem antecipa a semana seguinte.
    const setePorSemana = [
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ].map(dia);

    const cheia = resumirStreak(avaliarSemanas(setePorSemana, [], POLITICA, '2026-08-30'));

    const exata = resumirStreak(
      avaliarSemanas(
        [dia('2026-08-24'), dia('2026-08-26'), dia('2026-08-28')],
        [],
        POLITICA,
        '2026-08-30',
      ),
    );

    expect(cheia.atual).toBe(exata.atual);
  });

  it('marca como PERDIDA a semana fechada abaixo da meta', () => {
    const semanas = avaliarSemanas(
      [dia('2026-08-24'), dia('2026-08-26')],
      [],
      POLITICA,
      '2026-09-02',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-24')).toMatchObject({
      status: 'PERDIDA',
      diasTreinados: 2,
    });
  });

  it('marca a semana CORRENTE abaixo da meta como EM_ANDAMENTO, nunca perdida', () => {
    // A semana ainda nao acabou -- chama-la de perdida culparia o aluno por um
    // prazo que ainda corre (§13 do PRD: sem linguagem de culpa).
    const semanas = avaliarSemanas([dia('2026-08-24')], [], POLITICA, '2026-08-26');

    expect(semanas.find((s) => s.inicio === '2026-08-24')).toMatchObject({
      status: 'EM_ANDAMENTO',
      diasTreinados: 1,
    });
  });

  it('mantem QUALIFICADA a semana corrente que ja bateu a meta', () => {
    const semanas = avaliarSemanas(
      [dia('2026-08-24'), dia('2026-08-25'), dia('2026-08-26')],
      [],
      POLITICA,
      '2026-08-26',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-24')?.status).toBe('QUALIFICADA');
  });

  it('preenche semana SEM NENHUM treino entre duas semanas treinadas', () => {
    // Sem isso o streak somaria semanas nao adjacentes: quem treinou em agosto
    // e voltou em setembro teria "2 semanas seguidas".
    const semanas = avaliarSemanas(
      [dia('2026-08-24'), dia('2026-09-07')],
      [],
      POLITICA,
      '2026-09-13',
    );

    expect(semanas.map((s) => s.inicio)).toEqual(['2026-08-24', '2026-08-31', '2026-09-07']);
    expect(semanas[1]).toMatchObject({ status: 'PERDIDA', diasTreinados: 0 });
  });
});

describe('pausa aprovada', () => {
  const pausa = (inicio: string, fim: string | null): PausaAprovada => ({ inicio, fim });

  it('marca como PAUSADA a semana inteiramente dentro da pausa', () => {
    const semanas = avaliarSemanas(
      [dia('2026-08-17'), dia('2026-08-19'), dia('2026-08-21')],
      [pausa('2026-08-24', '2026-09-06')],
      POLITICA,
      '2026-09-07',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-24')?.status).toBe('PAUSADA');
    expect(semanas.find((s) => s.inicio === '2026-08-31')?.status).toBe('PAUSADA');
  });

  it('pausa NAO rompe o streak -- semana pausada e neutra, nao zera', () => {
    // `M5-FR-009`. Uma semana qualificada antes e outra depois continuam sendo
    // duas semanas seguidas.
    const semanas = avaliarSemanas(
      [
        dia('2026-08-17'),
        dia('2026-08-19'),
        dia('2026-08-21'),
        dia('2026-09-07'),
        dia('2026-09-09'),
        dia('2026-09-11'),
      ],
      [pausa('2026-08-24', '2026-09-06')],
      POLITICA,
      '2026-09-13',
    );

    expect(resumirStreak(semanas).atual).toBe(2);
  });

  it('pausa PARCIAL nao isenta a semana -- ela continua valendo pela meta', () => {
    // Pausa que cobre so parte da semana deixa dias treinaveis de fora. Isentar
    // a semana inteira daria isencao gratis a quem pausou um dia.
    const semanas = avaliarSemanas(
      [dia('2026-08-24')],
      [pausa('2026-08-26', '2026-08-27')],
      POLITICA,
      '2026-09-02',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-24')?.status).toBe('PERDIDA');
  });

  it('pausa em aberto (`fim: null`) cobre daquele dia em diante', () => {
    const semanas = avaliarSemanas(
      [dia('2026-08-17'), dia('2026-08-19'), dia('2026-08-21')],
      [pausa('2026-08-24', null)],
      POLITICA,
      '2026-09-07',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-31')?.status).toBe('PAUSADA');
  });

  it('semana pausada em que o aluno treinou mesmo assim QUALIFICA', () => {
    // Pausar nao proibe treinar. Quem bateu a meta ganha a semana; a pausa so
    // protege quem NAO treinou.
    const semanas = avaliarSemanas(
      [dia('2026-08-24'), dia('2026-08-26'), dia('2026-08-28')],
      [pausa('2026-08-24', '2026-08-30')],
      POLITICA,
      '2026-09-02',
    );

    expect(semanas.find((s) => s.inicio === '2026-08-24')?.status).toBe('QUALIFICADA');
  });
});

describe('resumirStreak', () => {
  it('conta o streak atual a partir da semana mais recente para tras', () => {
    const semanas = avaliarSemanas(
      [
        dia('2026-08-17'),
        dia('2026-08-19'),
        dia('2026-08-21'),
        dia('2026-08-24'),
        dia('2026-08-26'),
        dia('2026-08-28'),
      ],
      [],
      POLITICA,
      '2026-08-30',
    );

    expect(resumirStreak(semanas)).toMatchObject({ atual: 2, recorde: 2 });
  });

  it('a semana corrente EM_ANDAMENTO nao rompe o streak das anteriores', () => {
    // Segunda-feira de manha o aluno tem 0 dias na semana nova. Se isso zerasse
    // o streak, toda segunda seria um recomeco.
    const semanas = avaliarSemanas(
      [dia('2026-08-17'), dia('2026-08-19'), dia('2026-08-21')],
      [],
      POLITICA,
      '2026-08-24',
    );

    expect(resumirStreak(semanas)).toMatchObject({ atual: 1 });
  });

  it('semana PERDIDA zera o atual mas preserva o recorde', () => {
    const semanas = avaliarSemanas(
      [
        dia('2026-08-03'),
        dia('2026-08-05'),
        dia('2026-08-07'),
        dia('2026-08-10'),
        dia('2026-08-12'),
        dia('2026-08-14'),
        // 17/08 vazia -- rompe.
        dia('2026-08-24'),
        dia('2026-08-26'),
        dia('2026-08-28'),
      ],
      [],
      POLITICA,
      '2026-08-30',
    );

    expect(resumirStreak(semanas)).toMatchObject({ atual: 1, recorde: 2 });
  });

  it('devolve zero em aluno sem nenhuma sessao', () => {
    expect(resumirStreak(avaliarSemanas([], [], POLITICA, '2026-08-30'))).toMatchObject({
      atual: 0,
      recorde: 0,
    });
  });

  it('e deterministico com dias fora de ordem cronologica', () => {
    const ordenado = [dia('2026-08-24'), dia('2026-08-26'), dia('2026-08-28')];
    const embaralhado = [dia('2026-08-28'), dia('2026-08-24'), dia('2026-08-26')];

    expect(resumirStreak(avaliarSemanas(embaralhado, [], POLITICA, '2026-08-30'))).toEqual(
      resumirStreak(avaliarSemanas(ordenado, [], POLITICA, '2026-08-30')),
    );
  });
});

describe('POLITICA_DE_STREAK', () => {
  it('e SEMANAL e versionada -- nunca uma contagem de dias seguidos', () => {
    // `M5-BR-005`, fechado por construcao: nao ha campo que permita configurar
    // cadencia diaria.
    expect(POLITICA_DE_STREAK.versao).toBe('semana-civil-local@1');
    expect(POLITICA_DE_STREAK.diasPorSemana).toBe(3);
  });
});

describe('fuso', () => {
  it('o fuso da unidade nao entra no calculo -- o dia local ja vem resolvido', () => {
    // A protecao contra dupla aplicacao de fuso: quem chama converte UMA vez
    // (`sessionDate` da F24 ja e `@db.Date` local) e este arquivo nunca
    // reconverte. Se `avaliarSemanas` aceitasse `Date`, este teste nao
    // existiria e o bug apareceria so na virada do mes.
    expect(FUSO).toBe('America/Sao_Paulo');
    expect(avaliarSemanas([dia('2026-08-24')], [], POLITICA, '2026-08-24')[0]?.inicio).toBe(
      '2026-08-24',
    );
  });
});
