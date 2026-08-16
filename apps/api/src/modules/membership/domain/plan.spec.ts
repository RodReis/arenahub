import { describe, expect, it } from '@jest/globals';

import {
  instanteDentroDaJanela,
  interseccaoDeJanelas,
  JanelaDeAcessoInvalidaError,
  momentoLocal,
  ordenarJanelas,
  validarJanelas,
  type JanelaDeAcesso,
} from './plan.js';

const UNIDADE = '11111111-1111-1111-1111-111111111111';
const OUTRA_UNIDADE = '22222222-2222-2222-2222-222222222222';
const SP = 'America/Sao_Paulo';

function janela(
  dayOfWeek: number,
  startMinute: number,
  endMinute: number,
  gymUnitId = UNIDADE,
): JanelaDeAcesso {
  return { gymUnitId, dayOfWeek, startMinute, endMinute };
}

/** 08:00 = 480, 12:00 = 720, 18:00 = 1080, 22:00 = 1320. */
describe('validarJanelas', () => {
  it('aceita conjunto sem sobreposicao e devolve ordenado', () => {
    const validadas = validarJanelas([janela(3, 480, 720), janela(1, 480, 720)]);

    expect(validadas.map((j) => j.dayOfWeek)).toEqual([1, 3]);
  });

  it('recusa dia da semana fora de 1..7', () => {
    expect(() => validarJanelas([janela(0, 480, 720)])).toThrow(JanelaDeAcessoInvalidaError);
    expect(() => validarJanelas([janela(8, 480, 720)])).toThrow(JanelaDeAcessoInvalidaError);
  });

  it('recusa janela de duracao zero', () => {
    expect(() => validarJanelas([janela(1, 480, 480)])).toThrow(JanelaDeAcessoInvalidaError);
  });

  /**
   * Virada de dia entra como DUAS janelas. Aceitar fim menor que inicio
   * obrigaria todo consumidor -- inclusive o motor de F9 -- a lembrar do
   * caso especial.
   */
  it('recusa fim menor que inicio, em vez de interpretar como virada de dia', () => {
    expect(() => validarJanelas([janela(1, 1320, 120)])).toThrow(JanelaDeAcessoInvalidaError);
  });

  it('aceita virada de dia representada como duas janelas', () => {
    const validadas = validarJanelas([janela(1, 1320, 1440), janela(2, 0, 120)]);

    expect(validadas).toHaveLength(2);
  });

  it('recusa horario fora do intervalo de um dia', () => {
    expect(() => validarJanelas([janela(1, -1, 720)])).toThrow(JanelaDeAcessoInvalidaError);
    expect(() => validarJanelas([janela(1, 480, 1441)])).toThrow(JanelaDeAcessoInvalidaError);
  });

  it('recusa sobreposicao na mesma unidade e mesmo dia', () => {
    expect(() => validarJanelas([janela(1, 480, 720), janela(1, 600, 900)])).toThrow(
      JanelaDeAcessoInvalidaError,
    );
  });

  /** Fim exclusivo: 08:00-12:00 e 12:00-18:00 nao se sobrepoem. */
  it('aceita janelas que apenas se encostam', () => {
    expect(validarJanelas([janela(1, 480, 720), janela(1, 720, 1080)])).toHaveLength(2);
  });

  it('nao confunde sobreposicao entre unidades diferentes', () => {
    const validadas = validarJanelas([
      janela(1, 480, 720),
      janela(1, 600, 900, OUTRA_UNIDADE),
    ]);

    expect(validadas).toHaveLength(2);
  });

  it('nao confunde sobreposicao entre dias diferentes', () => {
    expect(validarJanelas([janela(1, 480, 720), janela(2, 600, 900)])).toHaveLength(2);
  });
});

describe('ordenarJanelas', () => {
  it('e deterministico: mesma entrada, mesma saida', () => {
    const entrada = [janela(2, 600, 900), janela(1, 480, 720), janela(1, 60, 120)];

    expect(ordenarJanelas(entrada)).toEqual(ordenarJanelas([...entrada].reverse()));
  });

  it('nao muta a entrada', () => {
    const entrada = [janela(2, 600, 900), janela(1, 480, 720)];
    ordenarJanelas(entrada);

    expect(entrada[0]!.dayOfWeek).toBe(2);
  });
});

describe('momentoLocal', () => {
  it('converte instante UTC para dia e minuto no fuso da unidade', () => {
    // 2026-08-17 e uma segunda-feira. 12:00Z = 09:00 em Sao Paulo (UTC-3).
    const { dayOfWeek, minute } = momentoLocal(new Date('2026-08-17T12:00:00Z'), SP);

    expect(dayOfWeek).toBe(1);
    expect(minute).toBe(9 * 60);
  });

  /**
   * A virada de dia no fuso local muda o DIA DA SEMANA, nao so a hora:
   * 2026-08-18T02:00Z ainda e segunda 23:00 em Sao Paulo. Avaliar em UTC
   * daria terca -- e negaria acesso a quem tem janela de segunda.
   */
  it('respeita a virada de dia local, e nao a de UTC', () => {
    const { dayOfWeek, minute } = momentoLocal(new Date('2026-08-18T02:00:00Z'), SP);

    expect(dayOfWeek).toBe(1);
    expect(minute).toBe(23 * 60);
  });

  it('trata meia-noite local como minuto 0', () => {
    const { minute } = momentoLocal(new Date('2026-08-17T03:00:00Z'), SP);

    expect(minute).toBe(0);
  });

  /**
   * COMPORTAMENTO REGISTRADO DA BASE DE TIMEZONE (exigido pelo plano de
   * apoio, Task 3 passo 3): o Brasil ABOLIU o horario de verao em 2019
   * (Decreto 9.772/2019), entao `America/Sao_Paulo` fica em UTC-3 o ano
   * inteiro -- inclusive em fevereiro, quando havia DST ate 2018.
   *
   * Se este teste falhar, a base IANA do runtime mudou ou o Brasil
   * reinstituiu o horario de verao. Nos dois casos a conversao de janela
   * precisa ser reavaliada, nao o teste ajustado.
   */
  it('registra que America/Sao_Paulo nao tem mais horario de verao', () => {
    const verao = momentoLocal(new Date('2026-02-15T12:00:00Z'), SP);
    const inverno = momentoLocal(new Date('2026-07-15T12:00:00Z'), SP);

    expect(verao.minute).toBe(9 * 60);
    expect(inverno.minute).toBe(9 * 60);
  });

  /**
   * Fuso que AINDA tem DST, para provar que a conversao usa a base IANA e
   * nao offset fixo. Nova York: UTC-5 no inverno, UTC-4 no verao.
   */
  it('acompanha o DST de um fuso que ainda o pratica', () => {
    const ny = 'America/New_York';
    const inverno = momentoLocal(new Date('2026-01-15T17:00:00Z'), ny);
    const verao = momentoLocal(new Date('2026-07-15T17:00:00Z'), ny);

    expect(inverno.minute).toBe(12 * 60);
    expect(verao.minute).toBe(13 * 60);
  });
});

describe('instanteDentroDaJanela', () => {
  const janelas = [janela(1, 480, 720)];

  it('aceita o instante inicial (inicio inclusivo)', () => {
    expect(instanteDentroDaJanela(new Date('2026-08-17T11:00:00Z'), SP, UNIDADE, janelas)).toBe(
      true,
    );
  });

  it('recusa o instante final (fim exclusivo)', () => {
    expect(instanteDentroDaJanela(new Date('2026-08-17T15:00:00Z'), SP, UNIDADE, janelas)).toBe(
      false,
    );
  });

  it('aceita instante no meio', () => {
    expect(instanteDentroDaJanela(new Date('2026-08-17T13:00:00Z'), SP, UNIDADE, janelas)).toBe(
      true,
    );
  });

  it('recusa instante antes da janela', () => {
    expect(instanteDentroDaJanela(new Date('2026-08-17T10:00:00Z'), SP, UNIDADE, janelas)).toBe(
      false,
    );
  });

  it('recusa janela de outra unidade, mesmo no horario certo', () => {
    expect(
      instanteDentroDaJanela(new Date('2026-08-17T13:00:00Z'), SP, OUTRA_UNIDADE, janelas),
    ).toBe(false);
  });

  it('recusa dia da semana diferente', () => {
    // 2026-08-18 e terca.
    expect(instanteDentroDaJanela(new Date('2026-08-18T13:00:00Z'), SP, UNIDADE, janelas)).toBe(
      false,
    );
  });

  it('recusa quando nao ha janela nenhuma', () => {
    expect(instanteDentroDaJanela(new Date('2026-08-17T13:00:00Z'), SP, UNIDADE, [])).toBe(
      false,
    );
  });
});

describe('interseccaoDeJanelas', () => {
  /** INV-034 e `M1-BR-006`: a mais restritiva prevalece. */
  it('devolve o tempo em que ambas permitem, nunca a uniao', () => {
    const resultado = interseccaoDeJanelas([janela(1, 480, 1080)], [janela(1, 600, 720)]);

    expect(resultado).toEqual([janela(1, 600, 720)]);
  });

  it('devolve vazio quando as janelas nao se cruzam', () => {
    expect(interseccaoDeJanelas([janela(1, 480, 600)], [janela(1, 720, 1080)])).toEqual([]);
  });

  it('devolve vazio para janelas que apenas se encostam', () => {
    expect(interseccaoDeJanelas([janela(1, 480, 720)], [janela(1, 720, 1080)])).toEqual([]);
  });

  it('nao cruza unidades diferentes', () => {
    expect(
      interseccaoDeJanelas([janela(1, 480, 1080)], [janela(1, 600, 720, OUTRA_UNIDADE)]),
    ).toEqual([]);
  });

  it('nao cruza dias diferentes', () => {
    expect(interseccaoDeJanelas([janela(1, 480, 1080)], [janela(2, 600, 720)])).toEqual([]);
  });

  it('cruza multiplas janelas do mesmo dia', () => {
    const resultado = interseccaoDeJanelas(
      [janela(1, 480, 720), janela(1, 900, 1200)],
      [janela(1, 600, 1000)],
    );

    expect(resultado).toEqual([janela(1, 600, 720), janela(1, 900, 1000)]);
  });

  it('e comutativa', () => {
    const a = [janela(1, 480, 1080)];
    const b = [janela(1, 600, 720)];

    expect(interseccaoDeJanelas(a, b)).toEqual(interseccaoDeJanelas(b, a));
  });
});
