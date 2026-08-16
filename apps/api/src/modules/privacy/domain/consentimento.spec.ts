import { describe, expect, it } from '@jest/globals';

import {
  avaliarConsentimento,
  calcularIdadeEmAnos,
  calcularVencimentoDoExpurgo,
  sujeitoExigido,
  type DecisaoRegistrada,
} from './consentimento.js';

const data = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('calcularIdadeEmAnos', () => {
  it('conta anos completos', () => {
    expect(calcularIdadeEmAnos(data('2000-05-10'), data('2026-08-15'))).toBe(26);
  });

  it('nao conta o ano do aniversario ainda nao ocorrido', () => {
    // Subtrair anos direto diria 26 -- e um aluno de 17 anos e 11 meses
    // apareceria como maior de idade, que e o caso que o INV-143 protege.
    expect(calcularIdadeEmAnos(data('2000-12-25'), data('2026-08-15'))).toBe(25);
  });

  it('conta o aniversario no proprio dia', () => {
    expect(calcularIdadeEmAnos(data('2008-08-15'), data('2026-08-15'))).toBe(18);
  });

  it('nao conta na vespera do aniversario de 18', () => {
    expect(calcularIdadeEmAnos(data('2008-08-15'), data('2026-08-14'))).toBe(17);
  });
});

describe('sujeitoExigido', () => {
  it('exige responsavel legal para menor de 18 (INV-143)', () => {
    expect(sujeitoExigido(17)).toBe('LEGAL_GUARDIAN');
  });

  it('nao abre excecao para quem esta perto de completar 18', () => {
    // A lei nao tem faixa cinzenta.
    expect(sujeitoExigido(17)).toBe('LEGAL_GUARDIAN');
  });

  it('aceita o proprio aluno a partir dos 18', () => {
    expect(sujeitoExigido(18)).toBe('STUDENT');
  });
});

describe('avaliarConsentimento', () => {
  const aceiteDeMaior: DecisaoRegistrada = {
    decision: 'ACCEPTED',
    subjectKind: 'STUDENT',
    subjectAgeYears: 26,
    supersededAt: null,
    documentRetiredAt: null,
  };

  it('autoriza aceite valido de maior de idade', () => {
    expect(avaliarConsentimento(aceiteDeMaior, 26)).toEqual({ valido: true });
  });

  it('recusa quando nao ha decisao registrada (INV-017)', () => {
    expect(avaliarConsentimento(null, 26)).toEqual({
      valido: false,
      motivo: 'CONSENT_MISSING',
    });
  });

  it('recusa quando o titular recusou', () => {
    expect(
      avaliarConsentimento({ ...aceiteDeMaior, decision: 'REFUSED' }, 26),
    ).toEqual({ valido: false, motivo: 'CONSENT_REFUSED' });
  });

  it('recusa decisao ja substituida', () => {
    expect(
      avaliarConsentimento({ ...aceiteDeMaior, supersededAt: data('2026-08-01') }, 26),
    ).toEqual({ valido: false, motivo: 'CONSENT_SUPERSEDED' });
  });

  it('recusa consentimento preso a documento aposentado', () => {
    expect(
      avaliarConsentimento({ ...aceiteDeMaior, documentRetiredAt: data('2026-08-01') }, 26),
    ).toEqual({ valido: false, motivo: 'CONSENT_DOCUMENT_RETIRED' });
  });

  describe('virada dos 18 (INV-143)', () => {
    const aceiteDeResponsavel: DecisaoRegistrada = {
      decision: 'ACCEPTED',
      subjectKind: 'LEGAL_GUARDIAN',
      // Congelada: o responsavel consentiu quando o aluno tinha 16.
      subjectAgeYears: 16,
      supersededAt: null,
      documentRetiredAt: null,
    };

    it('vale enquanto o aluno e menor', () => {
      expect(avaliarConsentimento(aceiteDeResponsavel, 17)).toEqual({ valido: true });
    });

    it('exige revalidacao quando o aluno completa 18', () => {
      // A prova do que aconteceu continua valida; o que caduca e a
      // AUTORIZACAO -- quem decide sobre o proprio corpo passa a ser ele.
      expect(avaliarConsentimento(aceiteDeResponsavel, 18)).toEqual({
        valido: false,
        motivo: 'CONSENT_REVALIDATION_REQUIRED',
      });
    });

    it('exige revalidacao quando um menor consentiu por si mesmo', () => {
      expect(
        avaliarConsentimento({ ...aceiteDeMaior, subjectAgeYears: 15 }, 15),
      ).toEqual({ valido: false, motivo: 'CONSENT_REVALIDATION_REQUIRED' });
    });
  });
});

describe('calcularVencimentoDoExpurgo', () => {
  it('soma o prazo configurado ao fim do vinculo (INV-142)', () => {
    expect(calcularVencimentoDoExpurgo(data('2026-08-15'), 30)).toEqual(
      data('2026-09-14'),
    );
  });

  it('respeita prazo diferente do padrao, porque o prazo e parametro', () => {
    // 30 dias e o PADRAO do tenant, nao a constante do produto: quem decide e
    // a academia controladora (art. 39).
    expect(calcularVencimentoDoExpurgo(data('2026-08-15'), 15)).toEqual(
      data('2026-08-30'),
    );
  });

  it('atravessa a virada do ano sem erro de mes', () => {
    expect(calcularVencimentoDoExpurgo(data('2026-12-20'), 30)).toEqual(
      data('2027-01-19'),
    );
  });
});
