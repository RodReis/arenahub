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

describe('meia-noite local -- os fusos que costumam quebrar', () => {
  /**
   * A revisao de codigo suspeitou que a correcao de deslocamento nao
   * convergiria em fusos de meia hora no dia da transicao. Varri 2026 inteiro
   * nestes fusos e nao houve divergencia -- mas o caso fica aqui para que a
   * proxima mudanca na conta seja obrigada a continuar valendo neles.
   */
  const DIFICEIS = [
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'Australia/Sydney',
    'Pacific/Auckland',
    'America/Santiago',
    'Asia/Tehran',
    'Asia/Kolkata',
  ];

  it.each(DIFICEIS)('resolve o ano inteiro de 2026 em %s sem falhar', (fuso) => {
    for (let mes = 1; mes <= 12; mes += 1) {
      for (let dia = 1; dia <= 28; dia += 1) {
        const vencimento = new Date(Date.UTC(2026, mes - 1, dia, 12, 0, 0));

        const bloqueio = instanteDeBloqueio(
          vencimento,
          politica({ diasDeCarencia: 3, fusoDaUnidade: fuso }),
        );

        expect(Number.isFinite(bloqueio.getTime())).toBe(true);
      }
    }
  });

  it('06/09/2026 em Santiago: o dia em que a MEIA-NOITE NAO EXISTE', () => {
    /**
     * O ACHADO DA VARREDURA, e o caso mais dificil deste arquivo.
     *
     * O horario de verao do Chile comeca a meia-noite: o relogio pula de
     * 23:59 direto para 01:00, e as 00:00 daquele dia SIMPLESMENTE NAO
     * ACONTECEM. Nao ha ponto fixo -- o laco de correcao oscila entre 03:00Z
     * e 04:00Z para sempre, e um algoritmo que aceitasse o ultimo palpite
     * devolveria um ou outro conforme a PARIDADE do numero de passadas.
     *
     * Bloqueio uma hora deslocado, sem erro, uma vez por ano. A funcao devolve
     * o PRIMEIRO INSTANTE QUE EXISTE naquele dia -- 01:00 local --, que e a
     * leitura fiel do ADR-019: o dia comecou, so comecou mais tarde.
     */
    const bloqueio = instanteDeBloqueio(
      new Date('2026-09-03T12:00:00.000Z'),
      politica({ diasDeCarencia: 3, fusoDaUnidade: 'America/Santiago' }),
    );

    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(bloqueio);

    /** Dia 06, como pedido -- e 01:00, porque 00:00 nao existe. */
    expect(local).toContain('2026-09-06');
    expect(local).toContain('01:00');
  });

  it('o resultado E meia-noite local, e nao um instante qualquer', () => {
    /**
     * O que a funcao promete. Sem esta verificacao, uma conta que devolvesse
     * 23h ou 01h locais passaria em todos os casos acima -- eles so provam
     * que ela nao explode.
     */
    for (const fuso of DIFICEIS) {
      const bloqueio = instanteDeBloqueio(
        new Date('2026-06-01T12:00:00.000Z'),
        politica({ diasDeCarencia: 3, fusoDaUnidade: fuso }),
      );

      const local = new Intl.DateTimeFormat('en-CA', {
        timeZone: fuso,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(bloqueio);

      expect(local).toBe('00:00');
    }
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
