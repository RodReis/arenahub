import { describe, expect, it } from '@jest/globals';

import {
  PERIODOS,
  dataLocalIso,
  inicioDoDiaLocal,
  inicioDoPeriodo,
  type Periodo,
} from './periodo.js';

/**
 * F18 -- filtro de periodo do grafico (`M3-FR-008`: 30D, 90D, 6M, 1A e todo
 * o periodo).
 *
 * O que estes testes defendem nao e "subtrai 30 dias" -- e que o corte cai
 * na MEIA-NOITE LOCAL da unidade. Cortar pelo instante UTC faria a avaliacao
 * da manha do trigesimo dia entrar ou sair conforme a hora em que o aluno
 * abriu a tela, e o mesmo grafico mudaria de conteudo sozinho.
 *
 * `America/Sao_Paulo` (UTC-3) e o fuso de todos os casos abaixo: meia-noite
 * local e 03:00 UTC do mesmo dia.
 */

const SP = 'America/Sao_Paulo';
const AGORA = new Date('2026-08-20T15:00:00.000Z');

describe('PERIODOS', () => {
  it('cobre exatamente os cinco periodos do M3-FR-008', () => {
    expect([...PERIODOS]).toEqual(['30D', '90D', '6M', '1Y', 'ALL']);
  });
});

/**
 * `dataLocalIso` existe porque o painel NAO pode formatar data por conta
 * propria (regra 5 de lint). Se ela errar o fuso, o eixo do grafico carimba a
 * medicao de ontem como hoje -- exatamente o bug que aquela regra evita.
 */
describe('dataLocalIso', () => {
  it('devolve a data local em AAAA-MM-DD', () => {
    expect(dataLocalIso(new Date('2026-06-10T12:00:00.000Z'), SP)).toBe('2026-06-10');
  });

  it('usa o fuso da unidade, nao UTC', () => {
    // 02:00 UTC ainda e o dia ANTERIOR em Sao Paulo (UTC-3).
    expect(dataLocalIso(new Date('2026-06-10T02:00:00.000Z'), SP)).toBe('2026-06-09');
  });

  it('fusos diferentes dao dias diferentes para o mesmo instante', () => {
    const instante = new Date('2026-06-10T02:00:00.000Z');

    expect(dataLocalIso(instante, SP)).toBe('2026-06-09');
    expect(dataLocalIso(instante, 'Europe/Lisbon')).toBe('2026-06-10');
  });

  it('preenche mes e dia com zero a esquerda', () => {
    // Janeiro e onde codigo de data costuma errar: `1` em vez de `01` faria o
    // recorte do eixo devolver "/1" no painel.
    expect(dataLocalIso(new Date('2026-01-05T12:00:00.000Z'), SP)).toBe('2026-01-05');
  });
});

describe('inicioDoPeriodo', () => {
  it('ALL nao tem corte -- devolve null, nunca a origem do tempo', () => {
    // `null` e nao `new Date(0)`: uma data de 1970 seria um corte de
    // verdade, e o repositorio filtraria por ela sem necessidade.
    expect(inicioDoPeriodo('ALL', AGORA, SP)).toBeNull();
  });

  it('30D corta na meia-noite local de 30 dias atras', () => {
    const inicio = inicioDoPeriodo('30D', AGORA, SP);

    // 21/07 00:00 em Sao Paulo = 21/07 03:00 UTC.
    expect(inicio?.toISOString()).toBe('2026-07-21T03:00:00.000Z');
  });

  it('90D corta na meia-noite local de 90 dias atras', () => {
    expect(inicioDoPeriodo('90D', AGORA, SP)?.toISOString()).toBe('2026-05-22T03:00:00.000Z');
  });

  it('6M conta em meses de calendario, nao em 180 dias', () => {
    // Meses tem tamanhos diferentes. "6 meses" para o aluno e "20 de
    // fevereiro", nao "algum dia perto de fevereiro".
    expect(inicioDoPeriodo('6M', AGORA, SP)?.toISOString()).toBe('2026-02-20T03:00:00.000Z');
  });

  it('1Y conta um ano de calendario', () => {
    expect(inicioDoPeriodo('1Y', AGORA, SP)?.toISOString()).toBe('2025-08-20T03:00:00.000Z');
  });

  it('o corte independe da hora em que a tela foi aberta', () => {
    // O mesmo dia, duas horas diferentes, tem de produzir o MESMO corte --
    // ou o grafico ganha e perde pontos conforme o horario da consulta.
    const manha = inicioDoPeriodo('30D', new Date('2026-08-20T11:00:00.000Z'), SP);
    const noite = inicioDoPeriodo('30D', new Date('2026-08-20T23:00:00.000Z'), SP);

    expect(manha?.toISOString()).toBe(noite?.toISOString());
  });

  it('respeita o fuso da unidade, nao o do servidor', () => {
    // Mesma chamada, fusos diferentes: Lisboa (UTC+1 no verao) tem meia-noite
    // duas horas antes da de Sao Paulo.
    const sp = inicioDoPeriodo('30D', AGORA, SP);
    const lisboa = inicioDoPeriodo('30D', AGORA, 'Europe/Lisbon');

    expect(sp?.toISOString()).not.toBe(lisboa?.toISOString());
    expect(lisboa?.toISOString()).toBe('2026-07-20T23:00:00.000Z');
  });

  it('atravessa a virada do horario de verao sem errar a meia-noite', () => {
    // Sao Paulo nao tem mais horario de verao, mas Nova York tem: 30 dias
    // antes de 20/08 e 21/07, ainda em EDT (UTC-4). Aritmetica de offset
    // fixo erraria uma hora em metade do ano.
    const inicio = inicioDoPeriodo('30D', AGORA, 'America/New_York');

    expect(inicio?.toISOString()).toBe('2026-07-21T04:00:00.000Z');
  });

  it('6M a partir de 31 de agosto nao cai num 31 de fevereiro', () => {
    // Fevereiro nao tem dia 31. Sem tratamento, a data transbordaria para
    // marco e o periodo ficaria mais curto do que o pedido.
    const inicio = inicioDoPeriodo('6M', new Date('2026-08-31T15:00:00.000Z'), SP);

    expect(inicio?.toISOString()).toBe('2026-02-28T03:00:00.000Z');
  });

  it('1Y a partir de 29 de fevereiro cai em 28 no ano comum', () => {
    const inicio = inicioDoPeriodo('1Y', new Date('2028-02-29T15:00:00.000Z'), SP);

    expect(inicio?.toISOString()).toBe('2027-02-28T03:00:00.000Z');
  });

  it('recusa fuso invalido em vez de cair num padrao (ADR-019)', () => {
    // Sem fuso valido nao ha meia-noite definida. Assumir UTC produziria um
    // corte errado e silencioso -- o ADR-019 exige fuso da unidade SEM
    // fallback.
    expect(() => inicioDoPeriodo('30D', AGORA, 'Fuso/Inventado')).toThrow();
  });

  it('todo periodo com corte devolve instante anterior ao agora', () => {
    const comCorte = PERIODOS.filter((p): p is Exclude<Periodo, 'ALL'> => p !== 'ALL');

    for (const periodo of comCorte) {
      const inicio = inicioDoPeriodo(periodo, AGORA, SP);

      expect(inicio).not.toBeNull();
      expect(inicio!.getTime()).toBeLessThan(AGORA.getTime());
    }
  });
});

/**
 * F57 -- o corte de "hoje" do dashboard operacional.
 *
 * O que estes testes defendem e que o dia da academia comeca a meia-noite
 * LOCAL. Contar em UTC faz o contador zerar as 21h de Brasilia, na frente do
 * operador e no pico do movimento; contar as ultimas 24 h corridas faz o
 * numero das 9h da manha incluir metade do movimento de ontem.
 */
describe('inicioDoDiaLocal', () => {
  it('devolve a meia-noite local, que em Sao Paulo e 03:00 UTC', () => {
    const inicio = inicioDoDiaLocal(new Date('2026-08-20T15:00:00.000Z'), SP);

    expect(inicio.toISOString()).toBe('2026-08-20T03:00:00.000Z');
  });

  /*
   * O defeito que motivou a mudanca: as 21h de Brasilia ja e dia 21 em UTC.
   * Com corte UTC o contador do dia zeraria aqui -- tres horas antes do fim
   * do expediente.
   */
  it('as 21h de Brasilia ainda e o dia 20, embora em UTC ja seja 21', () => {
    const vinteEUmaEmSP = new Date('2026-08-21T00:30:00.000Z');

    expect(vinteEUmaEmSP.toISOString().slice(0, 10)).toBe('2026-08-21');
    expect(inicioDoDiaLocal(vinteEUmaEmSP, SP).toISOString()).toBe('2026-08-20T03:00:00.000Z');
  });

  it('logo depois da meia-noite local, o dia ja virou', () => {
    const inicio = inicioDoDiaLocal(new Date('2026-08-20T03:01:00.000Z'), SP);

    expect(inicio.toISOString()).toBe('2026-08-20T03:00:00.000Z');
  });

  it('o corte nunca esta no futuro, em nenhuma hora do dia', () => {
    for (let hora = 0; hora < 24; hora += 1) {
      const agora = new Date(Date.UTC(2026, 7, 20, hora, 0, 0));

      expect(inicioDoDiaLocal(agora, SP).getTime()).toBeLessThanOrEqual(agora.getTime());
    }
  });

  /*
   * Offset diferente do de Brasilia: aritmetica de offset fixo (-3h chumbado)
   * acertaria Sao Paulo e erraria aqui, e o erro so apareceria no dia em que
   * abrisse unidade fora do fuso.
   */
  it('respeita fuso com outro offset -- Fernando de Noronha e UTC-2', () => {
    const inicio = inicioDoDiaLocal(new Date('2026-08-20T15:00:00.000Z'), 'America/Noronha');

    expect(inicio.toISOString()).toBe('2026-08-20T02:00:00.000Z');
  });

  it('recusa fuso invalido em vez de cair em UTC (ADR-019)', () => {
    expect(() => inicioDoDiaLocal(AGORA, 'Fuso/Inventado')).toThrow();
  });
});
