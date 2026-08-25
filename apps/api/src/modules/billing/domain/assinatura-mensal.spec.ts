import { describe, expect, it } from '@jest/globals';

import { AdesaoInvalidaError, cartaoVenceEm, validarAdesao } from './assinatura-mensal.js';
import type { CandidatoAAdesao } from './assinatura-mensal.js';

function candidato(sobrescritas: Partial<CandidatoAAdesao> = {}): CandidatoAAdesao {
  return {
    modalidadeDoPlano: 'ASSINATURA',
    planoTemPrecoVigente: true,
    cpfDoAluno: '52998224725',
    temCartaoAtivo: true,
    jaAderiu: false,
    aceitouRecorrencia: true,
    statusDaAssinatura: 'ACTIVE',
    ...sobrescritas,
  };
}

function codigoDaRecusa(entrada: Partial<CandidatoAAdesao>): string {
  try {
    validarAdesao(candidato(entrada));
  } catch (erro) {
    if (erro instanceof AdesaoInvalidaError) {
      return erro.code;
    }

    throw erro;
  }

  return 'NAO_RECUSOU';
}

describe('validarAdesao', () => {
  it('aceita o candidato completo', () => {
    expect(() => validarAdesao(candidato())).not.toThrow();
  });

  it.each([
    ['plano avulso', { modalidadeDoPlano: 'AVULSO' as const }, 'PLAN_NOT_SUBSCRIPTION'],
    ['assinatura cancelada', { statusDaAssinatura: 'CANCELLED' }, 'SUBSCRIPTION_NOT_ADHERABLE'],
    ['assinatura expirada', { statusDaAssinatura: 'EXPIRED' }, 'SUBSCRIPTION_NOT_ADHERABLE'],
    ['ja aderiu', { jaAderiu: true }, 'RECURRENCE_ALREADY_ACTIVE'],
    ['sem preco vigente', { planoTemPrecoVigente: false }, 'PLAN_WITHOUT_ACTIVE_PRICE'],
    ['aluno sem CPF', { cpfDoAluno: null }, 'STUDENT_CPF_REQUIRED'],
    ['CPF em branco', { cpfDoAluno: '   ' }, 'STUDENT_CPF_REQUIRED'],
    ['sem cartao ativo', { temCartaoAtivo: false }, 'PAYMENT_METHOD_MISSING'],
    ['sem aceite', { aceitouRecorrencia: false }, 'RECURRENCE_CONSENT_REQUIRED'],
  ])('recusa %s com codigo estavel', (_nome, entrada, codigo) => {
    expect(codigoDaRecusa(entrada)).toBe(codigo);
  });

  /*
   * Aluno em atraso que cadastra cartao e adere e EXATAMENTE quem se quer de
   * volta ao dia. Recusar ali manteria inadimplente alguem tentando pagar.
   */
  it('aceita adesao de assinatura em atraso', () => {
    expect(() => validarAdesao(candidato({ statusDaAssinatura: 'PAST_DUE' }))).not.toThrow();
  });

  /*
   * A ORDEM e a mensagem: quem esta no balcao age pela PRIMEIRA recusa. Se o
   * aceite viesse antes do CPF, o operador marcaria o aceite para so entao
   * descobrir que falta o cadastro -- e o aluno teria autorizado uma cobranca
   * que nao aconteceu.
   */
  it('reclama do cadastro antes de reclamar do aceite', () => {
    expect(codigoDaRecusa({ cpfDoAluno: null, aceitouRecorrencia: false })).toBe(
      'STUDENT_CPF_REQUIRED',
    );
  });

  it('reclama da modalidade antes de tudo', () => {
    expect(
      codigoDaRecusa({
        modalidadeDoPlano: 'AVULSO',
        cpfDoAluno: null,
        temCartaoAtivo: false,
        aceitouRecorrencia: false,
      }),
    ).toBe('PLAN_NOT_SUBSCRIPTION');
  });
});

describe('cartaoVenceEm', () => {
  const AGOSTO_25 = new Date('2026-08-25T12:00:00.000Z');

  it('devolve nulo quando o provedor nao informou a validade', () => {
    expect(cartaoVenceEm({ expMonth: null, expYear: 2027 }, AGOSTO_25)).toBeNull();
    expect(cartaoVenceEm({ expMonth: 8, expYear: null }, AGOSTO_25)).toBeNull();
  });

  it('devolve nulo para validade fora de faixa', () => {
    expect(cartaoVenceEm({ expMonth: 13, expYear: 2027 }, AGOSTO_25)).toBeNull();
    expect(cartaoVenceEm({ expMonth: 0, expYear: 2027 }, AGOSTO_25)).toBeNull();
  });

  /*
   * O cartao vale ate o ULTIMO INSTANTE do mes de vencimento. Tratar 08/2026
   * como 01/08 mataria o cartao um mes cedo -- e o aluno seria recusado com o
   * cartao ainda bom.
   */
  it('considera valido o cartao que vence NESTE mes', () => {
    expect(cartaoVenceEm({ expMonth: 8, expYear: 2026 }, AGOSTO_25)).toEqual({
      vencido: false,
      venceEmBreve: true,
    });
  });

  it('marca vencido a partir do primeiro dia do mes seguinte', () => {
    const setembro = new Date('2026-09-01T00:00:00.000Z');

    expect(cartaoVenceEm({ expMonth: 8, expYear: 2026 }, setembro)).toEqual({
      vencido: true,
      venceEmBreve: false,
    });
  });

  it('avisa dentro da janela e cala fora dela', () => {
    // Vence 30/09 -- 36 dias, dentro dos 45.
    expect(cartaoVenceEm({ expMonth: 9, expYear: 2026 }, AGOSTO_25)?.venceEmBreve).toBe(true);
    // Vence 31/12 -- 128 dias, fora.
    expect(cartaoVenceEm({ expMonth: 12, expYear: 2026 }, AGOSTO_25)?.venceEmBreve).toBe(false);
  });

  /* Dezembro rola para janeiro do ano seguinte sem `if` de virada de ano. */
  it('atravessa a virada de ano', () => {
    const dezembro = new Date('2026-12-20T00:00:00.000Z');

    expect(cartaoVenceEm({ expMonth: 12, expYear: 2026 }, dezembro)).toEqual({
      vencido: false,
      venceEmBreve: true,
    });
    expect(cartaoVenceEm({ expMonth: 12, expYear: 2026 }, new Date('2027-01-01T00:00:00.000Z'))).toEqual({
      vencido: true,
      venceEmBreve: false,
    });
  });
});
