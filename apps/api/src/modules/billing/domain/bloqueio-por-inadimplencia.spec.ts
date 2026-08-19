import { describe, expect, it } from '@jest/globals';

import {
  ANCORA_DE_BLOQUEIO_PADRAO,
  deveBloquear,
  instanteDeBloqueio,
  type PoliticaDeBloqueio,
} from './bloqueio-por-inadimplencia.js';

/**
 * Prova a conta do ADR-019, nao a implementacao.
 *
 * O caso que da nome ao ADR e o primeiro: a Especificacao 42 dizia "vencimento
 * 10/08, carencia 3 dias, bloqueio 14/08", e 10 + 3 = 13. Se alguem "corrigir"
 * a funcao para o exemplo errado, este arquivo reprova.
 */
const SAO_PAULO = 'America/Sao_Paulo';

function politica(parcial: Partial<PoliticaDeBloqueio> = {}): PoliticaDeBloqueio {
  return {
    ancora: ANCORA_DE_BLOQUEIO_PADRAO,
    diasDeCarencia: 3,
    fusoDaUnidade: SAO_PAULO,
    ...parcial,
  };
}

describe('instanteDeBloqueio -- a conta do ADR-019', () => {
  it('vencimento 10/08 com carencia de 3 dias bloqueia em 13/08 as 00:00 locais', () => {
    /**
     * O CASO QUE MOTIVOU O ADR. Sao Paulo e UTC-3, entao meia-noite local de
     * 13/08 e 03:00Z. O aluno tem 11 e 12 livres.
     */
    const bloqueio = instanteDeBloqueio(new Date('2026-08-10T14:00:00.000Z'), politica());

    expect(bloqueio.toISOString()).toBe('2026-08-13T03:00:00.000Z');
  });

  it('NAO bloqueia em 14/08 -- o exemplo da Especificacao 42 erra a conta', () => {
    const bloqueio = instanteDeBloqueio(new Date('2026-08-10T14:00:00.000Z'), politica());

    expect(bloqueio.toISOString()).not.toBe('2026-08-14T03:00:00.000Z');
  });

  it('carencia zero bloqueia na meia-noite do PROPRIO dia do vencimento', () => {
    const bloqueio = instanteDeBloqueio(
      new Date('2026-08-10T14:00:00.000Z'),
      politica({ diasDeCarencia: 0 }),
    );

    expect(bloqueio.toISOString()).toBe('2026-08-10T03:00:00.000Z');
  });

  it('conta o dia no fuso da UNIDADE, nao em UTC', () => {
    /**
     * O CASO QUE O FALLBACK ESCONDERIA. 22h em Sao Paulo no dia 10 ja e o dia
     * 11 em UTC (01:00Z). Contar a carencia sobre o dia de UTC adiantaria o
     * bloqueio em 24 horas -- aluno negado um dia antes do combinado, na
     * frente da recepcao.
     */
    const bloqueio = instanteDeBloqueio(new Date('2026-08-11T01:00:00.000Z'), politica());

    expect(bloqueio.toISOString()).toBe('2026-08-13T03:00:00.000Z');
  });

  it('fuso diferente da mesma rede muda o instante', () => {
    /**
     * Manaus e UTC-4. A mesma invoice, na mesma rede, bloqueia numa hora
     * diferente -- e por isso o ADR-019 proibe fallback: a unidade sabe, o
     * tenant nao.
     */
    const bloqueio = instanteDeBloqueio(
      new Date('2026-08-10T14:00:00.000Z'),
      politica({ fusoDaUnidade: 'America/Manaus' }),
    );

    expect(bloqueio.toISOString()).toBe('2026-08-13T04:00:00.000Z');
  });

  it('atravessa a virada de mes sem aritmetica manual', () => {
    const bloqueio = instanteDeBloqueio(
      new Date('2026-08-30T14:00:00.000Z'),
      politica({ diasDeCarencia: 5 }),
    );

    expect(bloqueio.toISOString()).toBe('2026-09-04T03:00:00.000Z');
  });

  it('atravessa a virada de ano', () => {
    const bloqueio = instanteDeBloqueio(
      new Date('2026-12-30T14:00:00.000Z'),
      politica({ diasDeCarencia: 5 }),
    );

    expect(bloqueio.toISOString()).toBe('2027-01-04T03:00:00.000Z');
  });

  it('funciona num fuso COM horario de verao', () => {
    /**
     * Lisboa entra em horario de verao no ultimo domingo de marco. Uma
     * carencia que atravessa a virada tem de cair na meia-noite LOCAL do dia
     * de destino, e nao 23h ou 01h -- que e o que a soma em milissegundos
     * produziria.
     */
    const bloqueio = instanteDeBloqueio(
      new Date('2026-03-27T12:00:00.000Z'),
      politica({ diasDeCarencia: 3, fusoDaUnidade: 'Europe/Lisbon' }),
    );

    // 30/03 ja e horario de verao (UTC+1): meia-noite local = 23:00Z do dia 29.
    expect(bloqueio.toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });

  it('recusa carencia negativa em vez de bloquear no passado', () => {
    expect(() => instanteDeBloqueio(new Date('2026-08-10T14:00:00.000Z'), politica({ diasDeCarencia: -1 }))).toThrow(
      RangeError,
    );
  });

  it('recusa vencimento invalido em vez de devolver Invalid Date', () => {
    expect(() => instanteDeBloqueio(new Date('nao-e-data'), politica())).toThrow(RangeError);
  });

  it('recusa fuso inexistente em vez de cair num padrao silencioso', () => {
    /**
     * ADR-019 3: sem fallback. Unidade mal cadastrada tem de FALHAR ALTO --
     * um `?? 'America/Sao_Paulo'` bloquearia na hora errada e ninguem
     * descobriria ate a reclamacao no balcao.
     */
    expect(() =>
      instanteDeBloqueio(new Date('2026-08-10T14:00:00.000Z'), politica({ fusoDaUnidade: 'Nao/Existe' })),
    ).toThrow();
  });
});

describe('deveBloquear', () => {
  const VENCIMENTO = new Date('2026-08-10T14:00:00.000Z');

  it('nao bloqueia durante a carencia', () => {
    expect(deveBloquear(VENCIMENTO, politica(), new Date('2026-08-12T23:59:59.000Z'))).toBe(false);
  });

  it('bloqueia NO PRIMEIRO INSTANTE -- meia-noite exata ja conta', () => {
    /**
     * `>=` e nao `>`. Com `>`, o aluno teria a madrugada inteira de sobra por
     * causa de um sinal -- e o ADR-019 diz "primeiro instante".
     */
    expect(deveBloquear(VENCIMENTO, politica(), new Date('2026-08-13T03:00:00.000Z'))).toBe(true);
  });

  it('um milissegundo antes NAO bloqueia', () => {
    expect(deveBloquear(VENCIMENTO, politica(), new Date('2026-08-13T02:59:59.999Z'))).toBe(false);
  });

  it('segue bloqueando depois', () => {
    expect(deveBloquear(VENCIMENTO, politica(), new Date('2026-09-01T00:00:00.000Z'))).toBe(true);
  });
});
