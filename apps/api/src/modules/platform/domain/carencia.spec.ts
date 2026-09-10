import { describe, expect, it } from '@jest/globals';

import { avaliarCarencia } from './carencia.js';

const SAO_PAULO = 'America/Sao_Paulo';

function fatura(dueAt: string, totalMinor = 100_00) {
  return { dueAt: new Date(dueAt), totalMinor };
}

describe('avaliarCarencia -- F65, ADR-053', () => {
  it('sem fatura vencida, nao ha contagem nem valor', () => {
    const s = avaliarCarencia({
      faturasVencidas: [],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s).toEqual({
      vencidaEm: null,
      suspendeEm: null,
      diasRestantes: null,
      emAbertoMinor: 0,
      deveSuspender: false,
    });
  });

  it('conta a carencia a partir do vencimento', () => {
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-09-01T00:00:00Z')],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.diasRestantes).toBe(7);
  });

  it('ancora na fatura MAIS ANTIGA quando ha varias', () => {
    /*
     * Ancorar na mais recente daria ao inadimplente uma carencia nova a cada
     * mes que ele deixasse de pagar -- a divida cresceria e o prazo nunca
     * chegaria ao fim.
     */
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-08-01T00:00:00Z'), fatura('2026-09-01T00:00:00Z')],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.vencidaEm).toEqual(new Date('2026-08-01T00:00:00Z'));
    expect(s.diasRestantes).toBeLessThan(0);
  });

  it('soma TODAS as vencidas no valor em aberto', () => {
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-08-01T00:00:00Z', 500_00), fatura('2026-09-01T00:00:00Z', 300_00)],
      graceDays: 15,
      agora: new Date('2026-09-09T12:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.emAbertoMinor).toBe(800_00);
  });

  it('graceDays zero suspende no dia seguinte ao vencimento, nao no mesmo', () => {
    // Carencia zero e legitima (o campo aceita 0). Ainda assim a janela das
    // 6h vale: quem vence hoje fecha amanha de manha, nunca agora.
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-09-09T00:00:00Z')],
      graceDays: 0,
      agora: new Date('2026-09-09T20:00:00Z'),
      timezone: SAO_PAULO,
    });

    expect(s.deveSuspender).toBe(false);
  });

  it('graceDays zero suspende no dia seguinte apos 6h locais', () => {
    // Carencia zero: vence em 09/09, suspendeEm = 09/09 (vencidaEm + 0).
    // Mas deveSuspender so fica true quando diasRestantes <= 0 AND passou das 6h.
    // Este teste valida o dia SEGUINTE (09/10 09:00Z = 06:00 Sao Paulo): ja passou
    // da carencia e ja passou das 6h locais, entao deve suspender.
    const s = avaliarCarencia({
      faturasVencidas: [fatura('2026-09-09T00:00:00Z')],
      graceDays: 0,
      agora: new Date('2026-09-10T09:00:00Z'), // day after, 06:00 Sao Paulo
      timezone: SAO_PAULO,
    });

    expect(s.deveSuspender).toBe(true);
  });

  describe('a janela das 6h locais (decisao D3 do PI)', () => {
    it('NAO suspende as 5h locais, mesmo com a carencia esgotada', () => {
      // 08:00Z = 05:00 em Sao Paulo (UTC-3).
      const s = avaliarCarencia({
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-09-09T08:00:00Z'),
        timezone: SAO_PAULO,
      });

      expect(s.diasRestantes).toBeLessThan(0);
      expect(s.deveSuspender).toBe(false);
    });

    it('suspende as 6h locais', () => {
      // 09:00Z = 06:00 em Sao Paulo.
      const s = avaliarCarencia({
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-09-09T09:00:00Z'),
        timezone: SAO_PAULO,
      });

      expect(s.deveSuspender).toBe(true);
    });

    it('NAO suspende as 21h locais, com a academia aberta e cheia', () => {
      /*
       * O caso que a comparacao em UTC errava. `dueAt` 01/08 + 15 dias de
       * carencia fecha o prazo em 16/08; as 00:30Z do dia 16 ainda sao 21:30
       * do dia 15 em Sao Paulo (UTC-3) -- um dia inteiro antes.
       *
       * E exatamente o instante em que o job diario roda (00:00Z, sem
       * `timeZone`), entao o erro nao era teorico: suspendia toda academia
       * brasileira a noite, aberta, um dia mais cedo.
       */
      const s = avaliarCarencia({
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-08-16T00:30:00Z'),
        timezone: SAO_PAULO,
      });

      expect(s.deveSuspender).toBe(false);
    });

    it('suspende as 6h locais do dia seguinte ao fim da carencia', () => {
      // Mesma carencia do teste acima, agora no dia certo: 09:00Z do dia 17
      // = 06:00 em Sao Paulo, ja passada a meia-noite LOCAL do fim do prazo.
      const s = avaliarCarencia({
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-08-17T09:00:00Z'),
        timezone: SAO_PAULO,
      });

      expect(s.deveSuspender).toBe(true);
    });

    it('graceDays 0 e 1 nao decidem no mesmo dia', () => {
      /*
       * Guarda contra o hack que compensava o erro de fuso forcando
       * `graceDays` 0 a valer 1: os dois viravam a mesma coisa, e um contrato
       * sem carencia ficava indistinguivel de um com um dia.
       */
      const entrada = {
        faturasVencidas: [fatura('2026-09-09T00:00:00Z')],
        agora: new Date('2026-09-10T09:00:00Z'), // 06:00 Sao Paulo, dia seguinte
        timezone: SAO_PAULO,
      };

      expect(avaliarCarencia({ ...entrada, graceDays: 0 }).deveSuspender).toBe(true);
      expect(avaliarCarencia({ ...entrada, graceDays: 1 }).deveSuspender).toBe(false);
    });

    it('a janela e do fuso da ACADEMIA, nao do servidor', () => {
      /*
       * Manaus e UTC-4. As 09:00Z sao 05:00 la e 06:00 em Sao Paulo -- a
       * mesma chamada tem de decidir diferente nos dois, ou a academia do
       * Amazonas fecharia uma hora antes de abrir.
       */
      const entrada = {
        faturasVencidas: [fatura('2026-08-01T00:00:00Z')],
        graceDays: 15,
        agora: new Date('2026-09-09T09:00:00Z'),
      };

      expect(avaliarCarencia({ ...entrada, timezone: 'America/Sao_Paulo' }).deveSuspender).toBe(true);
      expect(avaliarCarencia({ ...entrada, timezone: 'America/Manaus' }).deveSuspender).toBe(false);
    });
  });
});
