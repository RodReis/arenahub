import { describe, expect, it } from '@jest/globals';

import {
  janelaPadrao,
  JanelaDoResumoInvalidaError,
  MINIMO_DE_PONTOS_DA_SERIE,
  montarSerie,
  taxaDeInadimplencia,
  ticketMedio,
  validarJanela,
} from './resumo-financeiro.js';

const AGORA = new Date('2026-09-01T12:00:00.000Z');

describe('validarJanela', () => {
  it('aceita janela fechada e bem ordenada', () => {
    expect(() =>
      validarJanela(new Date('2026-08-01T00:00:00.000Z'), new Date('2026-09-01T00:00:00.000Z'), AGORA),
    ).not.toThrow();
  });

  it('recusa fim anterior ao inicio', () => {
    expect(() =>
      validarJanela(new Date('2026-09-01T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z'), AGORA),
    ).toThrow(JanelaDoResumoInvalidaError);
  });

  it('recusa janela de duracao zero', () => {
    const instante = new Date('2026-08-01T00:00:00.000Z');

    expect(() => validarJanela(instante, instante, AGORA)).toThrow(JanelaDoResumoInvalidaError);
  });

  /**
   * O caso que a `SPEC-054` §3.1 existe para impedir: periodo em curso produz
   * numero que muda embaixo de quem esta lendo.
   */
  it('recusa janela que ainda nao fechou', () => {
    expect(() =>
      validarJanela(new Date('2026-08-01T00:00:00.000Z'), new Date('2026-09-30T00:00:00.000Z'), AGORA),
    ).toThrow(JanelaDoResumoInvalidaError);
  });

  /** O limite exato: `ate === agora` e a janela que acabou de fechar. */
  it('aceita janela que fecha exatamente agora', () => {
    expect(() => validarJanela(new Date('2026-08-01T00:00:00.000Z'), AGORA, AGORA)).not.toThrow();
  });

  it('recusa um milissegundo alem de agora', () => {
    const umMsAlem = new Date(AGORA.getTime() + 1);

    expect(() => validarJanela(new Date('2026-08-01T00:00:00.000Z'), umMsAlem, AGORA)).toThrow(
      JanelaDoResumoInvalidaError,
    );
  });
});

describe('ticketMedio', () => {
  it('divide o recebido pelos pagamentos confirmados', () => {
    expect(ticketMedio(45_000, 3)).toBe(15_000);
  });

  it('arredonda para centavo inteiro', () => {
    // 10.000 / 3 = 3333,33... -- nao existe fracao de centavo (INV-065).
    expect(ticketMedio(10_000, 3)).toBe(3333);
    expect(Number.isInteger(ticketMedio(10_000, 3))).toBe(true);
  });

  /**
   * O CASO QUE DECIDE SE A TELA MENTE. Zero pagamentos nao e ticket zero: e
   * ticket que nao existe. Ver o comentario da funcao.
   */
  it('devolve null quando nao houve pagamento, nunca zero', () => {
    expect(ticketMedio(0, 0)).toBeNull();
  });

  it('nao confunde recebido zero com ausencia de pagamento', () => {
    // Um pagamento confirmado de valor zero e improvavel, mas se existir o
    // ticket E zero -- ha do que tirar media. Nao pode virar `null`.
    expect(ticketMedio(0, 1)).toBe(0);
  });
});

describe('taxaDeInadimplencia', () => {
  it('calcula o percentual com uma casa', () => {
    expect(taxaDeInadimplencia(1, 3)).toBe(33.3);
  });

  it('devolve 100 quando todo pagante esta inadimplente', () => {
    expect(taxaDeInadimplencia(40, 40)).toBe(100);
  });

  it('devolve zero quando ha pagante e ninguem deve', () => {
    expect(taxaDeInadimplencia(0, 340)).toBe(0);
  });

  /** Academia sem assinatura nao tem 0% de inadimplencia -- ver a funcao. */
  it('devolve null quando nao ha pagante algum, nunca zero', () => {
    expect(taxaDeInadimplencia(0, 0)).toBeNull();
  });
});

describe('montarSerie', () => {
  it('ordena as competencias e cruza os dois lados', () => {
    const serie = montarSerie(
      new Map([
        ['2026-08', 50_000],
        ['2026-06', 30_000],
        ['2026-07', 40_000],
      ]),
      new Map([
        ['2026-06', 30_000],
        ['2026-07', 15_000],
      ]),
    );

    expect(serie.pontos).toEqual([
      { competencia: '2026-06', faturadoMinor: 30_000, recebidoMinor: 30_000 },
      { competencia: '2026-07', faturadoMinor: 40_000, recebidoMinor: 15_000 },
      { competencia: '2026-08', faturadoMinor: 50_000, recebidoMinor: 0 },
    ]);
  });

  /**
   * O risco da `SPEC-054` §5.1, e o estado em que a base REAL nasce hoje: um
   * mes de dado. Menos de tres pontos nao vira linha.
   */
  it('marca serie de um ponto como insuficiente para virar linha', () => {
    const serie = montarSerie(new Map([['2026-08', 50_000]]), new Map());

    expect(serie.pontos).toHaveLength(1);
    expect(serie.suficienteParaLinha).toBe(false);
  });

  it('marca serie de dois pontos como insuficiente -- reta entre dois pontos parece tendencia', () => {
    const serie = montarSerie(
      new Map([
        ['2026-07', 40_000],
        ['2026-08', 50_000],
      ]),
      new Map(),
    );

    expect(serie.suficienteParaLinha).toBe(false);
  });

  it('libera a linha a partir do terceiro ponto', () => {
    const serie = montarSerie(
      new Map([
        ['2026-06', 30_000],
        ['2026-07', 40_000],
        ['2026-08', 50_000],
      ]),
      new Map(),
    );

    expect(serie.pontos).toHaveLength(MINIMO_DE_PONTOS_DA_SERIE);
    expect(serie.suficienteParaLinha).toBe(true);
  });

  it('devolve serie vazia e insuficiente quando nao ha movimento algum', () => {
    const serie = montarSerie(new Map(), new Map());

    expect(serie.pontos).toEqual([]);
    expect(serie.suficienteParaLinha).toBe(false);
  });

  /**
   * A serie itera a UNIAO das duas chaves, nao as do faturado.
   *
   * Os dois lados vem de consultas independentes, e nada garante que toda
   * competencia exista nos dois mapas. Iterar so o faturado perderia, calada,
   * a competencia que so o recebido conhece -- e o teste falha se alguem
   * "simplificar" para um lado so.
   */
  it('inclui competencia presente so no recebido', () => {
    const serie = montarSerie(new Map(), new Map([['2026-08', 12_000]]));

    expect(serie.pontos).toEqual([
      { competencia: '2026-08', faturadoMinor: 0, recebidoMinor: 12_000 },
    ]);
  });
});

describe('janelaPadrao', () => {
  it('devolve o ultimo mes fechado', () => {
    const { de, ate } = janelaPadrao(new Date('2026-09-14T18:30:00.000Z'));

    expect(de.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(ate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('atravessa a virada de ano', () => {
    const { de, ate } = janelaPadrao(new Date('2026-01-07T03:00:00.000Z'));

    expect(de.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(ate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  /**
   * O default NAO pode cair na janela que a validacao recusa -- senao a tela
   * abriria em erro sem ninguem ter pedido nada de errado.
   */
  it('produz janela que a propria validacao aceita', () => {
    const agora = new Date('2026-09-14T18:30:00.000Z');
    const { de, ate } = janelaPadrao(agora);

    expect(() => validarJanela(de, ate, agora)).not.toThrow();
  });

  it('produz janela valida tambem no primeiro instante de um mes', () => {
    // O caso de borda: `agora` exatamente em 01/09 00:00 faz `ate === agora`,
    // que e o limite que `validarJanela` aceita por um fio.
    const agora = new Date('2026-09-01T00:00:00.000Z');
    const { de, ate } = janelaPadrao(agora);

    expect(() => validarJanela(de, ate, agora)).not.toThrow();
  });
});
